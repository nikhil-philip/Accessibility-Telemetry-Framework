/**
 * Comparative SPC baseline-methodology tooling for the experimental
 * cohort ONLY (src/telemetry/experimentGenerator.ts). This module is
 * explicitly experiment-analysis tooling, not part of the production SPC
 * engine: it never redefines control-limit math, never re-implements a
 * WECO/Nelson rule, and never changes a gate threshold. It calls the
 * existing, unmodified computeSpcReport() (spcEngine.ts) and
 * evaluateQualityGate() (gates/qualityGateEvaluator.ts) twice per build --
 * once per history-selection method -- and reports both results side by
 * side so the *effect of baseline methodology* can be inspected as data,
 * not asserted.
 *
 * Two methods, both walk-forward (a build's report only ever sees builds
 * up to and including itself -- never future data):
 *
 * EXPANDING_HISTORY
 *   - All available historical observations are included at every step.
 *   - The center line and sigma-hat estimates evolve as additional
 *     builds arrive -- they are recomputed from scratch, over strictly
 *     more data, at every build.
 *   - Earlier special-cause observations (e.g. Phase A's instability)
 *     remain part of the historical series indefinitely; they are never
 *     excluded once the process later stabilizes.
 *   - A direct consequence: as later, lower-variance data narrows
 *     sigma-hat, earlier observations that were unremarkable under the
 *     wider limits computed at the time can retroactively read as
 *     beyond-3-sigma outliers relative to the new, tighter limits --
 *     process improvement can make history look anomalous in hindsight.
 *
 * TRAILING_WINDOW
 *   - Only the most recent `windowSize` builds (default 15 here, via
 *     DEFAULT_TRAILING_WINDOW_SIZE) are included at each step, via
 *     selectHistoryWindow() (spcEngine.ts -- re-exported below for
 *     backward compatibility). This module always pre-slices the window
 *     itself before calling computeSpcReport(), so its own windowing
 *     behavior is unaffected by computeSpcReport()'s separate, independent
 *     `options.windowSize` (used by the production CI gate path instead;
 *     see spcEngine.ts's computeSpcReport() doc comment).
 *   - Older observations age out of every calculation once more than
 *     windowSize builds have occurred, so the baseline reflects recent
 *     process behavior rather than the entire project history.
 *
 * Neither method is asserted to be "correct" here -- that is exactly the
 * open comparison this module exists to let the caller make from the
 * evidence (ARCHITECTURE.md RQ2/RQ3).
 */
import { TelemetryRecord } from '../telemetry/schema';
import { computeSpcReport, selectHistoryWindow, AnalysisMethod } from './spcEngine';
import { SpcEngineOptions, SpcReport } from './types';
import { evaluateQualityGate } from '../gates/qualityGateEvaluator';
import { DEFAULT_GATE_POLICY } from '../gates/gatePolicies';
import { GatePolicyConfig, GateVerdict } from '../gates/types';

/** Re-exported for backward compatibility -- both now live in spcEngine.ts (see selectHistoryWindow's doc comment there for why). */
export type { AnalysisMethod };
export { selectHistoryWindow };

export const DEFAULT_TRAILING_WINDOW_SIZE = 15;

export const ANALYSIS_METHOD_NOTES: Record<AnalysisMethod, { label: string; notes: readonly string[] }> = {
  EXPANDING_HISTORY: {
    label: 'Expanding history (all observations to date)',
    notes: [
      'All available historical observations are included in every calculation.',
      'Center line and variation (sigma-hat) estimates evolve as additional builds arrive.',
      'Earlier special-cause observations remain part of the historical series indefinitely.',
      'Process improvement can cause earlier observations to appear anomalous relative to a tighter, later baseline.',
    ],
  },
  TRAILING_WINDOW: {
    label: 'Trailing window (most recent N builds only)',
    notes: [
      'Only the most recent windowSize builds are included in each calculation.',
      'Older observations age out of the baseline once more than windowSize builds have occurred.',
      'Control limits reflect recent process behavior rather than the entire project history.',
    ],
  },
};

export interface BuildAnalysisResult {
  method: AnalysisMethod;
  buildNumber: number;
  buildId: string;
  /** 0-indexed, inclusive -- first record index included in this build's window. */
  windowStart: number;
  /** Number of records actually included (<= windowSize for TRAILING_WINDOW once it has filled). */
  windowLength: number;
  spcReport: SpcReport;
  gateVerdict: GateVerdict;
}

export interface RunAnalysisOptions {
  windowSize?: number;
  spcOptions?: SpcEngineOptions;
  gatePolicy?: GatePolicyConfig;
}

/**
 * Runs one full walk-forward pass over `records` under one method,
 * reusing computeSpcReport()/evaluateQualityGate() verbatim at each step.
 * Every build is evaluated (including build 1, which is INSUFFICIENT_DATA
 * under both methods identically -- windowing cannot manufacture data
 * that doesn't exist yet).
 */
export function runAnalysis(records: TelemetryRecord[], method: AnalysisMethod, options: RunAnalysisOptions = {}): BuildAnalysisResult[] {
  const windowSize = options.windowSize ?? DEFAULT_TRAILING_WINDOW_SIZE;
  const gatePolicy = options.gatePolicy ?? DEFAULT_GATE_POLICY;
  const results: BuildAnalysisResult[] = [];

  for (let buildNumber = 1; buildNumber <= records.length; buildNumber++) {
    const windowRecords = selectHistoryWindow(records, buildNumber, method, windowSize);
    const latest = windowRecords[windowRecords.length - 1]!;
    const spcReport = computeSpcReport(windowRecords, options.spcOptions);
    const gateVerdict = evaluateQualityGate(latest, spcReport, gatePolicy);

    results.push({
      method,
      buildNumber,
      buildId: latest.buildId,
      windowStart: buildNumber - windowRecords.length,
      windowLength: windowRecords.length,
      spcReport,
      gateVerdict,
    });
  }

  return results;
}

export interface AnalysisSummary {
  method: AnalysisMethod;
  totalBuilds: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  regressionDetections: number;
  driftDetections: number;
  trendDetections: number;
  controlLimitViolations: number;
}

/** Tallies the 7 requested summary metrics from a runAnalysis() result set -- pure aggregation, no new SPC/gate logic. */
export function summarizeResults(results: BuildAnalysisResult[]): AnalysisSummary {
  const method = results[0]?.method ?? 'EXPANDING_HISTORY';
  return {
    method,
    totalBuilds: results.length,
    passCount: results.filter((r) => r.gateVerdict.status === 'PASS').length,
    warnCount: results.filter((r) => r.gateVerdict.status === 'WARN').length,
    failCount: results.filter((r) => r.gateVerdict.status === 'FAIL').length,
    regressionDetections: results.filter((r) => r.spcReport.regressionSpike.detected).length,
    driftDetections: results.filter((r) => r.spcReport.drift.detected).length,
    trendDetections: results.filter((r) => r.spcReport.trend.detected).length,
    controlLimitViolations: results.filter((r) => r.spcReport.uclViolation).length,
  };
}

/** WECO rule 1 and Nelson rule 1 are the same pattern (nOfMBeyondSigma(...,3,1,1) -- see ruleHelpers.ts) and therefore always agree; WECO's is read as the representative "Rule 1" signal. */
export function rule1Triggered(report: SpcReport): boolean {
  return report.westernElectric.find((r) => r.rule === 1)?.triggered ?? false;
}
