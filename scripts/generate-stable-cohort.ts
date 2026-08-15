/**
 * EXPERIMENT B -- Stable-process capability experiment.
 *
 * Purpose: evaluate Cpk/Cpu under conditions where capability analysis's
 * stability assumption is actually satisfied -- a single-regime, 30-build
 * cohort (src/telemetry/stableProcessGenerator.ts) with no deliberate
 * phases, trend, or regression, kept in its own directory
 * (telemetry/experiments/stable-capability-cohort/), never mixed with
 * Experiment A's five-phase cohort (telemetry/experiments/spc-validation-cohort/)
 * or with telemetry/history/.
 *
 * Steps (unmodified L5/L6 throughout):
 *   1. Compute the defectScore series (10/5/2/1 weighting, unchanged).
 *   2. Compute control limits (computeSpcReport() -> chart).
 *   3. Determine statistical stability (processState/stabilityStatus).
 *   4. Compute Cpu/Cpk (capabilityAnalysis.ts, unmodified) against USL=40
 *      -- the same value ARCHITECTURE.md Appendix B illustrates, reused
 *      here unchanged from Experiment A's original run rather than tuned
 *      to this cohort, to avoid any appearance of picking a number that
 *      manufactures a "capable" result.
 *   5. Compare Cpu against the existing, unmodified gate policy's
 *      capability thresholds (warnBelowCpu=1.33, failBelowCpu=1.0).
 *   6. Report the Quality Gate's actual verdict, including whether
 *      CPK_CAPABILITY appears among its reasons.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/generate-stable-cohort.js
 */
import * as fs from 'fs';
import { generateStableCohortRecords, STABLE_COHORT_DIR_RELATIVE, STABLE_COHORT_SEED } from '../src/telemetry/stableProcessGenerator';
import { writeTelemetryRecordTo } from '../src/telemetry/writer';
import { repoPath } from '../src/utils/paths';
import { computeSpcReport } from '../src/spc/spcEngine';
import { evaluateQualityGate } from '../src/gates/qualityGateEvaluator';
import { DEFAULT_GATE_POLICY } from '../src/gates/gatePolicies';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('GenerateStableCohort');

/** Same value Experiment A originally used before Cpk was excluded from it -- reused unchanged, not tuned to this cohort. See file header, step 4. */
const STABLE_COHORT_USL = 40;

function assertSafeToClear(dir: string): void {
  const normalized = dir.replace(/\\/g, '/');
  if (!normalized.includes('/telemetry/experiments/stable-capability-cohort')) {
    throw new Error(`Refusing to clear "${dir}" -- this does not look like the stable-cohort directory. telemetry/history/ and the Experiment A cohort are never touched by this script.`);
  }
}

function writeCohort(): string {
  const dir = repoPath(STABLE_COHORT_DIR_RELATIVE);
  assertSafeToClear(dir);
  fs.rmSync(dir, { recursive: true, force: true });

  const records = generateStableCohortRecords(STABLE_COHORT_SEED);
  for (const record of records) {
    writeTelemetryRecordTo(dir, record);
  }

  logger.info(`Wrote ${records.length} synthetic records to ${dir} (seed=${STABLE_COHORT_SEED})`);
  return dir;
}

function main(): void {
  console.log(`=== EXPERIMENT B -- Stable-process capability experiment (seed=${STABLE_COHORT_SEED}, 30 builds, single regime) ===\n`);
  const dir = writeCohort();
  console.log(`Written to: ${dir}\n`);

  const records = generateStableCohortRecords(STABLE_COHORT_SEED);

  console.log('=== 1. defectScore series ===\n');
  console.table(records.map((r) => ({ buildId: r.buildId, critical: r.violationsBySeverity.critical, serious: r.violationsBySeverity.serious, moderate: r.violationsBySeverity.moderate, minor: r.violationsBySeverity.minor, defectScore: r.defectScore })));

  const report = computeSpcReport(records, { usl: STABLE_COHORT_USL });

  console.log('\n=== 2. Control limits (I-MR chart) ===');
  console.log({
    centerLine: Number(report.chart.centerLine.toFixed(3)),
    sigma: Number(report.chart.sigma.toFixed(3)),
    uclX: Number(report.chart.uclX.toFixed(3)),
    lclX: Number(report.chart.lclX.toFixed(3)),
    mrBar: Number(report.chart.mrBar.toFixed(3)),
    uclMr: Number(report.chart.uclMr.toFixed(3)),
  });

  console.log('\n=== 3. Statistical stability ===');
  const anyWecoTriggered = report.westernElectric.filter((r) => r.triggered).map((r) => `WECO-${r.rule}`);
  const anyNelsonTriggered = report.nelson.filter((r) => r.triggered).map((r) => `NELSON-${r.rule}`);
  console.log({
    processState: report.processState,
    stabilityStatus: report.stabilityStatus,
    uclViolation: report.uclViolation,
    trendDetected: report.trendDetected,
    regressionDetected: report.regressionDetected,
    triggeredRules: [...anyWecoTriggered, ...anyNelsonTriggered],
  });

  console.log('\n=== 4. Cpu/Cpk (capabilityAnalysis.ts, unmodified) ===');
  console.log({
    usl: report.capability.usl,
    cpu: report.capability.cpu !== null ? Number(report.capability.cpu.toFixed(4)) : null,
    capable: report.capability.capable,
  });

  console.log('\n=== 5. Comparison against the configured (unmodified) capability thresholds ===');
  console.log({
    warnBelowCpu: DEFAULT_GATE_POLICY.capability.warnBelowCpu,
    failBelowCpu: DEFAULT_GATE_POLICY.capability.failBelowCpu,
    cpu: report.capability.cpu !== null ? Number(report.capability.cpu.toFixed(4)) : null,
    aboveWarnThreshold: report.capability.cpu !== null ? report.capability.cpu >= DEFAULT_GATE_POLICY.capability.warnBelowCpu : null,
    aboveFailThreshold: report.capability.cpu !== null ? report.capability.cpu >= DEFAULT_GATE_POLICY.capability.failBelowCpu : null,
  });

  const latest = records[records.length - 1]!;
  const verdict = evaluateQualityGate(latest, report, DEFAULT_GATE_POLICY);
  const capabilityReason = verdict.reasons.find((r) => r.ruleId === 'CPK_CAPABILITY');

  console.log('\n=== 6. Quality Gate capability rule result ===');
  console.log({
    overallGateStatus: verdict.status,
    allReasons: verdict.reasons.map((r) => `${r.ruleId}:${r.severity}`),
    capabilityReason: capabilityReason ? `${capabilityReason.severity} -- ${capabilityReason.message}` : 'none (capability layer did not contribute a WARN/FAIL)',
  });
}

main();
