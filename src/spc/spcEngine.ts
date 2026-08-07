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

/**
 * Input: historical build telemetry JSON. Reads every record written by
 * src/telemetry/writer.ts (one TelemetryRecord per build, see
 * src/telemetry/schema.ts / ARCHITECTURE.md Appendix A) and returns them
 * sorted oldest-first -- the order every calculation below assumes.
 */
export function loadTelemetryHistory(dir: string = HISTORY_DIR): TelemetryRecord[] {
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

  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
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
 */
export function computeSpcReport(records: TelemetryRecord[], options: SpcEngineOptions = {}): SpcReport {
  const points = toDataPoints(records).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

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

  const summary: SpcSummary = {
    processState: outOfControl ? 'OUT_OF_CONTROL' : 'IN_CONTROL',
    uclViolation,
    trendDetected: trend.detected,
    regressionDetected: regressionSpike.detected,
    stabilityStatus: regressionSpike.detected
      ? 'REGRESSED'
      : outOfControl
        ? 'OUT_OF_CONTROL'
        : drift.detected || trend.detected
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
