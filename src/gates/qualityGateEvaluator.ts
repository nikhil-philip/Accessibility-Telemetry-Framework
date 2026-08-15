import { TelemetryRecord } from '../telemetry/schema';
import { computeSpcReport, loadTelemetryHistory } from '../spc/spcEngine';
import { RuleEvaluation, SpcReport } from '../spc/types';
import { createLogger } from '../utils/logger';
import { DEFAULT_GATE_POLICY } from './gatePolicies';
import { GatePolicyConfig, GateReason, GateReasonSeverity, GateStatus, GateVerdict } from './types';

const logger = createLogger('QualityGateEvaluator');

/**
 * The Quality Gate Engine (ARCHITECTURE.md Layer 6). Pure policy
 * evaluation: given one build's telemetry and the SPC report already
 * computed for it (src/spc/spcEngine.ts), decide PASS/WARN/FAIL and why.
 *
 * Deliberately takes an already-computed SpcReport rather than raw
 * history -- this function does zero data collection or SPC math itself
 * (no file reads, no control-limit/CUSUM/Cpk computation), which is what
 * makes it trivially unit-testable with hand-built SpcReport fixtures and
 * keeps L5 (analysis) and L6 (policy) independently testable, per
 * ARCHITECTURE.md SS3's stated design goal.
 */
export function evaluateQualityGate(
  record: TelemetryRecord,
  spcReport: SpcReport,
  policy: GatePolicyConfig = DEFAULT_GATE_POLICY,
): GateVerdict {
  const reasons: GateReason[] = [
    checkCriticalDefects(record, policy),
    checkSeriousDefects(record, policy),
    checkWeightedScore(record, policy),
    checkUclViolation(spcReport, policy),
    ...checkTriggeredRules(spcReport, policy),
    checkRegression(spcReport, policy),
    checkTrend(spcReport, policy),
    checkDrift(spcReport, policy),
    checkCapability(spcReport, policy),
  ].filter((reason): reason is GateReason => reason !== null);

  const status = deriveStatus(reasons);

  logger.info(
    `Gate verdict: ${status} for build ${record.buildId} (${reasons.length} reason(s), spcState=${spcReport.processState})`,
  );

  return {
    status,
    reasons,
    buildId: record.buildId,
    commitSha: record.commitSha,
    generatedAt: new Date().toISOString(),
    defectScore: record.defectScore,
    spcProcessState: spcReport.processState,
    spcStabilityStatus: spcReport.stabilityStatus,
  };
}

/**
 * Convenience composition for callers that hold raw telemetry history
 * (e.g. a future CI step): sorts chronologically, computes the SPC report
 * for that history via the existing L5 engine (loadTelemetryHistory /
 * computeSpcReport are reused verbatim, not reimplemented here), and
 * evaluates the gate against the latest record. Still contains no CI/CD
 * or file-writing logic of its own.
 */
export function evaluateLatestBuild(history: TelemetryRecord[], policy: GatePolicyConfig = DEFAULT_GATE_POLICY): GateVerdict {
  if (history.length === 0) {
    throw new Error('evaluateLatestBuild: history must contain at least one TelemetryRecord.');
  }

  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latest = sorted[sorted.length - 1]!;
  const spcReport = computeSpcReport(sorted, policy.spcOptions);

  return evaluateQualityGate(latest, spcReport, policy);
}

/** Same as evaluateLatestBuild, but reads telemetry/history/ from disk via the existing L4/L5 loader. */
export function evaluateFromDisk(policy: GatePolicyConfig = DEFAULT_GATE_POLICY): GateVerdict {
  return evaluateLatestBuild(loadTelemetryHistory(), policy);
}

function deriveStatus(reasons: GateReason[]): GateStatus {
  if (reasons.some((r) => r.severity === 'FAIL')) return 'FAIL';
  if (reasons.some((r) => r.severity === 'WARN')) return 'WARN';
  return 'PASS';
}

// --- Individual policy layers -----------------------------------------
// Each returns one GateReason if its layer contributes a WARN/FAIL, or
// null if it passes / does not apply (e.g. insufficient SPC data). Kept
// as small, independently testable pure functions.

function checkCriticalDefects(record: TelemetryRecord, policy: GatePolicyConfig): GateReason | null {
  const actual = record.violationsBySeverity.critical;
  if (actual <= policy.maxCriticalDefects) return null;

  return {
    ruleId: 'CRITICAL_DEFECTS',
    severity: 'FAIL',
    message: `${actual} critical accessibility defect(s) found (must be <= ${policy.maxCriticalDefects}).`,
    actual,
    threshold: policy.maxCriticalDefects,
  };
}

function checkSeriousDefects(record: TelemetryRecord, policy: GatePolicyConfig): GateReason | null {
  const actual = record.violationsBySeverity.serious;
  if (actual <= policy.maxSeriousDefects) return null;

  return {
    ruleId: 'SERIOUS_DEFECTS',
    severity: 'FAIL',
    message: `${actual} serious accessibility defect(s) found, exceeding the configured threshold of ${policy.maxSeriousDefects}.`,
    actual,
    threshold: policy.maxSeriousDefects,
  };
}

/**
 * Reuses TelemetryRecord.defectScore as-is -- the weighted score already
 * computed by src/telemetry/collector.ts using the project's one existing
 * severity-weighting model (critical=10, serious=5, moderate=2, minor=1;
 * ARCHITECTURE.md SS8.2). This layer does not recompute a second,
 * differently-weighted score.
 */
function checkWeightedScore(record: TelemetryRecord, policy: GatePolicyConfig): GateReason | null {
  const actual = record.defectScore;

  if (actual >= policy.defectScore.failAt) {
    return {
      ruleId: 'WEIGHTED_DEFECT_SCORE',
      severity: 'FAIL',
      message: `Weighted defect score ${actual} is at or above the fail threshold of ${policy.defectScore.failAt}.`,
      actual,
      threshold: policy.defectScore.failAt,
    };
  }

  if (actual >= policy.defectScore.warnAt) {
    return {
      ruleId: 'WEIGHTED_DEFECT_SCORE',
      severity: 'WARN',
      message: `Weighted defect score ${actual} is at or above the warn threshold of ${policy.defectScore.warnAt}.`,
      actual,
      threshold: policy.defectScore.warnAt,
    };
  }

  return null;
}

/** SpcReport.processState is INSUFFICIENT_DATA below 2 history points -- every SPC-derived layer is a no-op in that case, by construction of computeSpcReport(). */
function hasSufficientSpcData(spcReport: SpcReport): boolean {
  return spcReport.processState !== 'INSUFFICIENT_DATA';
}

function latestValue(spcReport: SpcReport): number | null {
  const individuals = spcReport.chart.individuals;
  return individuals.length > 0 ? individuals[individuals.length - 1]!.value : null;
}

function checkUclViolation(spcReport: SpcReport, policy: GatePolicyConfig): GateReason | null {
  if (!policy.spc.failOnUclViolation) return null;
  if (!hasSufficientSpcData(spcReport)) return null;
  if (!spcReport.uclViolation) return null;

  const actual = latestValue(spcReport) ?? spcReport.chart.centerLine;
  const beyondUpper = actual > spcReport.chart.uclX;
  const threshold = beyondUpper ? spcReport.chart.uclX : spcReport.chart.lclX;

  return {
    ruleId: 'SPC_UCL_VIOLATION',
    severity: 'FAIL',
    message: `Latest build's defect score (${actual}) falls outside the I-chart control limits [${spcReport.chart.lclX.toFixed(2)}, ${spcReport.chart.uclX.toFixed(2)}].`,
    actual,
    threshold,
  };
}

function isFailRule(rule: RuleEvaluation, policy: GatePolicyConfig): boolean {
  return policy.spc.failRules.some((ref) => ref.ruleSet === rule.ruleSet && ref.rule === rule.rule);
}

/** Evaluates every triggered Western Electric / Nelson rule against the configured fail-list; anything else triggered is a WARN if the policy allows it. */
function checkTriggeredRules(spcReport: SpcReport, policy: GatePolicyConfig): GateReason[] {
  if (!hasSufficientSpcData(spcReport)) return [];

  const allRules = [...spcReport.westernElectric, ...spcReport.nelson];
  const reasons: GateReason[] = [];

  for (const rule of allRules) {
    if (!rule.triggered) continue;

    const severity: GateReasonSeverity | null = isFailRule(rule, policy)
      ? 'FAIL'
      : policy.spc.warnOnOtherTriggeredRules
        ? 'WARN'
        : null;

    if (severity === null) continue;

    reasons.push({
      ruleId: `SPC_RULE_${rule.ruleSet}_${rule.rule}`,
      severity,
      message: `${rule.ruleSet} rule ${rule.rule} ("${rule.name}") triggered: ${rule.description}`,
      actual: 1,
      threshold: 0,
    });
  }

  return reasons;
}

function checkRegression(spcReport: SpcReport, policy: GatePolicyConfig): GateReason | null {
  if (policy.regression.onDetected === 'IGNORE') return null;
  if (!hasSufficientSpcData(spcReport)) return null;
  if (!spcReport.regressionSpike.detected) return null;

  const actual = spcReport.regressionSpike.latestMovingRange ?? 0;

  return {
    ruleId: 'REGRESSION_SPIKE',
    severity: policy.regression.onDetected,
    message: `A regression spike was detected: the latest build-to-build jump (${actual}) exceeds the moving-range control limit (${spcReport.regressionSpike.uclMr.toFixed(2)}) and the score worsened.`,
    actual,
    threshold: spcReport.regressionSpike.uclMr,
  };
}

function checkTrend(spcReport: SpcReport, policy: GatePolicyConfig): GateReason | null {
  if (policy.trend.onDetected === 'IGNORE') return null;
  if (!hasSufficientSpcData(spcReport)) return null;
  if (!spcReport.trend.detected) return null;
  if (policy.trend.onlyWorsening && spcReport.trend.direction !== 'WORSENING') return null;

  return {
    ruleId: 'TREND_DETECTED',
    severity: policy.trend.onDetected,
    message: `A ${spcReport.trend.direction.toLowerCase()} trend was detected across recent builds (slope=${spcReport.trend.slope.toFixed(3)}, correlation=${spcReport.trend.correlation.toFixed(3)}).`,
    actual: Number(spcReport.trend.slope.toFixed(4)),
    threshold: 0,
  };
}

function checkDrift(spcReport: SpcReport, policy: GatePolicyConfig): GateReason | null {
  if (policy.drift.onDetected === 'IGNORE') return null;
  if (!hasSufficientSpcData(spcReport)) return null;
  if (!spcReport.drift.detected) return null;
  if (policy.drift.onlyWorsening && spcReport.drift.direction !== 'WORSENING') return null;

  const actual = spcReport.drift.direction === 'IMPROVING'
    ? (spcReport.drift.cMinus[spcReport.drift.cMinus.length - 1] ?? 0)
    : (spcReport.drift.cPlus[spcReport.drift.cPlus.length - 1] ?? 0);

  return {
    ruleId: 'PROCESS_DRIFT',
    severity: policy.drift.onDetected,
    message: `CUSUM process drift detected (direction=${spcReport.drift.direction}); cumulative deviation ${actual.toFixed(2)} exceeds the decision interval h=${spcReport.drift.h.toFixed(2)}.`,
    actual: Number(actual.toFixed(4)),
    threshold: Number(spcReport.drift.h.toFixed(4)),
  };
}

function checkCapability(spcReport: SpcReport, policy: GatePolicyConfig): GateReason | null {
  const { capability } = spcReport;
  if (capability.usl === null) return null; // no USL configured -- capability not evaluated
  if (!hasSufficientSpcData(spcReport)) return null;

  // cpu === null only when sigma-hat is 0 (a perfectly flat series) -- capability.capable still
  // carries the correct verdict in that edge case (see capabilityAnalysis.ts), just without a ratio to compare.
  if (capability.cpu === null) {
    if (capability.capable) return null;
    return {
      ruleId: 'CPK_CAPABILITY',
      severity: 'FAIL',
      message: `Process is flat (sigma=0) but its center line (${spcReport.chart.centerLine}) already exceeds the USL (${capability.usl}).`,
      actual: spcReport.chart.centerLine,
      threshold: capability.usl,
    };
  }

  if (capability.cpu < policy.capability.failBelowCpu) {
    return {
      ruleId: 'CPK_CAPABILITY',
      severity: 'FAIL',
      message: `Process capability Cpu=${capability.cpu.toFixed(3)} is below the fail threshold of ${policy.capability.failBelowCpu} -- the process cannot reliably meet the specification even absent a special-cause event.`,
      actual: Number(capability.cpu.toFixed(4)),
      threshold: policy.capability.failBelowCpu,
    };
  }

  if (capability.cpu < policy.capability.warnBelowCpu) {
    return {
      ruleId: 'CPK_CAPABILITY',
      severity: 'WARN',
      message: `Process capability Cpu=${capability.cpu.toFixed(3)} is below the "capable" threshold of ${policy.capability.warnBelowCpu}.`,
      actual: Number(capability.cpu.toFixed(4)),
      threshold: policy.capability.warnBelowCpu,
    };
  }

  return null;
}
