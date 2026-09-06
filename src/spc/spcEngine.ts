import * as fs from 'fs';
import * as path from 'path';
import { TelemetryRecord } from '../telemetry/schema';
import { repoPath } from '../utils/paths';
import { computeControlChart } from './controlChart';
import { evaluateWesternElectricRules } from './westernElectricRules';
import { evaluateNelsonRules } from './nelsonRules';
import { detectTrend } from './trendDetection';
import { detectRegressionSpike } from './regressionSpikeDetection';
import { detectDrift } from './driftDetection';
import { analyzeCapability } from './capabilityAnalysis';
import { DataPoint, RuleEvaluation, SpcEngineOptions, SpcReport, SpcSummary } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('SpcEngine');

// ARCHITECTURE.md keeps telemetry/history/ at the repo root, matching
// src/telemetry/writer.ts's HISTORY_DIR (see src/utils/paths.ts for why
// this is cwd-relative, not __dirname-relative).
const HISTORY_DIR = repoPath('telemetry/history');

export type AnalysisMethod = 'EXPANDING_HISTORY' | 'TRAILING_WINDOW';

/**
 * Selects the slice of `records` (already chronologically sorted) a caller
 * should see for `buildNumber` (1-indexed) under the given method.
 * EXPANDING_HISTORY returns every record up to and including buildNumber;
 * TRAILING_WINDOW returns only the most recent `windowSize` of them.
 *
 * Lives here (rather than in experimentAnalysis.ts, which re-exports it for
 * backward compatibility) so computeSpcReport()'s own optional `windowSize`
 * below can reuse it directly without a spcEngine <-> experimentAnalysis
 * circular import -- experimentAnalysis.ts already imports computeSpcReport
 * from this module.
 */
export function selectHistoryWindow(
  records: TelemetryRecord[],
  buildNumber: number,
  method: AnalysisMethod,
  windowSize: number,
): TelemetryRecord[] {
  if (buildNumber < 1 || buildNumber > records.length) {
    throw new Error(`selectHistoryWindow: buildNumber ${buildNumber} out of range 1..${records.length}`);
  }
  if (method === 'EXPANDING_HISTORY') {
    return records.slice(0, buildNumber);
  }
  const start = Math.max(0, buildNumber - windowSize);
  return records.slice(start, buildNumber);
}

/**
 * Input: historical build telemetry JSON. Reads every record written by
 * src/telemetry/writer.ts (one TelemetryRecord per build, see
 * src/telemetry/schema.ts / ARCHITECTURE.md Appendix A) and returns them
 * sorted oldest-first -- the order every calculation below assumes.
 *
 * `windowSize`, if given, trims the result to the most recent `windowSize`
 * records after sorting -- e.g. so a CI caller need not hold the entire
 * on-disk history in memory just to hand it straight to a windowed
 * computeSpcReport() call. Omitted (the default) returns the full history,
 * unchanged from this function's original behavior.
 */
export function loadTelemetryHistory(dir: string = HISTORY_DIR, windowSize?: number): TelemetryRecord[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const records: TelemetryRecord[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      records.push(JSON.parse(raw) as TelemetryRecord);
    } catch (err) {
      logger.warn(`Skipping unreadable telemetry file: ${file}`, err);
    }
  }

  const sorted = records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return windowSize !== undefined && sorted.length > 0 ? selectHistoryWindow(sorted, sorted.length, 'TRAILING_WINDOW', windowSize) : sorted;
}

function toDataPoints(records: TelemetryRecord[]): DataPoint[] {
  return records.map((r) => ({
    buildId: r.buildId,
    commitSha: r.commitSha,
    timestamp: r.timestamp,
    value: r.defectScore,
  }));
}

function insufficientDataReport(sampleSize: number, points: DataPoint[]): SpcReport {
  const emptyChart = {
    individuals: points,
    movingRanges: [],
    centerLine: points[0]?.value ?? 0,
    mrBar: 0,
    sigma: 0,
    uclX: points[0]?.value ?? 0,
    lclX: points[0]?.value ?? 0,
    uclMr: 0,
    lclMr: 0,
  };

  return {
    processState: 'INSUFFICIENT_DATA',
    uclViolation: false,
    trendDetected: false,
    regressionDetected: false,
    stabilityStatus: 'INSUFFICIENT_DATA',
    generatedAt: new Date().toISOString(),
    sampleSize,
    chart: emptyChart,
    westernElectric: [],
    nelson: [],
    trend: { slope: 0, correlation: 0, direction: 'NONE', nelsonRule3Triggered: false, regressionSignificant: false, detected: false },
    regressionSpike: { detected: false, latestMovingRange: null, uclMr: 0, percentChange: null },
    drift: { cPlus: [], cMinus: [], k: 0, h: 0, detected: false, direction: 'NONE' },
    capability: { usl: null, cpu: null, capable: null },
  };
}

/**
 * The SPC Analytics Engine's entry point (ARCHITECTURE.md Layer 5).
 * Takes the historical telemetry (chronologically ordered) and returns a
 * full report: the I-MR chart, every Western Electric and Nelson rule's
 * result, trend/regression-spike/drift detection, and process capability
 * -- with the five-field summary the caller most likely wants
 * (processState, uclViolation, trendDetected, regressionDetected,
 * stabilityStatus) inlined at the top level.
 *
 * A minimum of 2 points is required to compute even a single moving
 * range; below that, INSUFFICIENT_DATA is returned rather than dividing
 * by zero or fabricating control limits from nothing. Several individual
 * rules need far more history than that to ever fire (Nelson rule 7
 * needs 15 points, for instance) -- with fewer points those rules simply
 * report `triggered: false`, which is the statistically correct answer
 * ("not enough evidence yet"), not an error condition.
 *
 * `options.windowSize`, if given, restricts the chart and every detector
 * below to the most recent `windowSize` records (via selectHistoryWindow())
 * -- i.e. a rolling/trailing baseline instead of the full expanding
 * history. Left undefined (the default), behavior is unchanged from
 * before this option existed: unbounded, expanding history. The production
 * CI gate path opts into a 25-build trailing window via
 * DEFAULT_GATE_POLICY.spcOptions (gates/gatePolicies.ts); this function
 * itself defaults to unbounded so existing unwindowed callers (the
 * dashboard's full-history production chart, experimentAnalysis.ts's
 * EXPANDING_HISTORY method, and every full-cohort sanity check in
 * scripts/verify-*.ts) are unaffected.
 */
export function computeSpcReport(records: TelemetryRecord[], options: SpcEngineOptions = {}): SpcReport {
  const sortedRecords = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const windowedRecords =
    options.windowSize !== undefined && sortedRecords.length > 0
      ? selectHistoryWindow(sortedRecords, sortedRecords.length, 'TRAILING_WINDOW', options.windowSize)
      : sortedRecords;

  const points = toDataPoints(windowedRecords);

  if (points.length < 2) {
    return insufficientDataReport(points.length, points);
  }

  const chart = computeControlChart(points);
  const values = chart.individuals.map((p) => p.value);

  const westernElectric = evaluateWesternElectricRules(values, chart.centerLine, chart.sigma);
  const nelson = evaluateNelsonRules(values, chart.centerLine, chart.sigma);

  const trend = detectTrend(values, {
    correlationThreshold: options.trendCorrelationThreshold,
    minWindow: options.trendMinWindow,
  });
  const regressionSpike = detectRegressionSpike(values, chart.movingRanges, chart.uclMr);
  const drift = detectDrift(values, chart.centerLine, chart.sigma);
  const capability = analyzeCapability(chart.centerLine, chart.sigma, options.usl);

  const latest = values[values.length - 1]!; // non-null: points.length >= 2 was checked above
  const uclViolation = latest > chart.uclX || latest < chart.lclX;

  const anyRuleTriggered = (rules: RuleEvaluation[]) => rules.some((r) => r.triggered);
  const outOfControl = anyRuleTriggered(westernElectric) || anyRuleTriggered(nelson);

  // Drift/trend only mark the process DRIFTING when the detected direction
  // is actually WORSENING -- an IMPROVING drift or trend (a genuine, sustained
  // reduction in defect score) must not read as instability on the summary.
  const worseningDrift = drift.detected && drift.direction === 'WORSENING';
  const worseningTrend = trend.detected && trend.direction === 'WORSENING';

  const summary: SpcSummary = {
    processState: outOfControl ? 'OUT_OF_CONTROL' : 'IN_CONTROL',
    uclViolation,
    trendDetected: trend.detected,
    regressionDetected: regressionSpike.detected,
    stabilityStatus: regressionSpike.detected
      ? 'REGRESSED'
      : outOfControl
        ? 'OUT_OF_CONTROL'
        : worseningDrift || worseningTrend
          ? 'DRIFTING'
          : 'STABLE',
  };

  logger.info(
    `SPC report: state=${summary.processState} stability=${summary.stabilityStatus} ` +
      `(n=${points.length}, X-bar=${chart.centerLine.toFixed(2)}, UCL=${chart.uclX.toFixed(2)}, latest=${latest})`,
  );

  return {
    ...summary,
    generatedAt: new Date().toISOString(),
    sampleSize: points.length,
    chart,
    westernElectric,
    nelson,
    trend,
    regressionSpike,
    drift,
    capability,
  };
}

/** Extracts just the literal requested output shape from a full report. */
export function toSummary(report: SpcReport): SpcSummary {
  const { processState, uclViolation, trendDetected, regressionDetected, stabilityStatus } = report;
  return { processState, uclViolation, trendDetected, regressionDetected, stabilityStatus };
}
