/**
 * Shared types for the SPC Analytics Engine (ARCHITECTURE.md Layer 5).
 * Field names for chart-level values (centerLine, mrBar, sigma, uclX,
 * lclX, uclMr) intentionally match ARCHITECTURE.md Appendix B's "SPC
 * Summary Schema" so this implementation is a strict extension of the
 * already-documented contract, not a departure from it.
 */

/** One individual measurement in the I-chart's time series -- one per build. */
export interface DataPoint {
  buildId: string;
  commitSha: string;
  timestamp: string;
  /** The individual value X_i. For this project, TelemetryRecord.defectScore. */
  value: number;
}

export type ProcessState = 'IN_CONTROL' | 'OUT_OF_CONTROL' | 'INSUFFICIENT_DATA';

export type StabilityStatus = 'STABLE' | 'DRIFTING' | 'OUT_OF_CONTROL' | 'REGRESSED' | 'INSUFFICIENT_DATA';

export type RuleSetName = 'WESTERN_ELECTRIC' | 'NELSON';

/** The result of checking one WECO/Nelson rule against the full series. */
export interface RuleEvaluation {
  ruleSet: RuleSetName;
  rule: number;
  name: string;
  description: string;
  triggered: boolean;
  /** Index (0-based, into the I-chart series) of the last point that completes the pattern, if triggered. */
  triggeredAtIndex: number | null;
  /** All series indices participating in the triggering pattern, if triggered. */
  involvedIndices: number[];
}

export interface ControlChartResult {
  /** X_1..X_n, in build order. */
  individuals: DataPoint[];
  /** MR_2..MR_n -- one shorter than `individuals`; movingRanges[i] = |individuals[i+1].value - individuals[i].value|. */
  movingRanges: number[];
  /** X-bar: the I-chart center line. */
  centerLine: number;
  /** MR-bar: the MR-chart center line. */
  mrBar: number;
  /** sigma-hat, the process standard deviation estimated from mrBar (mrBar / d2, d2 = 1.128). */
  sigma: number;
  uclX: number;
  lclX: number;
  uclMr: number;
  lclMr: number;
}

export interface TrendResult {
  /** Slope of the best-fit line through (buildIndex, value) over the analysis window. Positive = worsening. */
  slope: number;
  /** Pearson correlation coefficient of the fit, in [-1, 1]. Magnitude is the "how confidently is this a line" signal. */
  correlation: number;
  direction: 'IMPROVING' | 'WORSENING' | 'NONE';
  /** Nelson Rule 3's hard 6-point monotonic-run signal. */
  nelsonRule3Triggered: boolean;
  /** The softer, general-purpose signal: |correlation| >= threshold over a long-enough window. */
  regressionSignificant: boolean;
  detected: boolean;
}

export interface RegressionSpikeResult {
  detected: boolean;
  latestMovingRange: number | null;
  uclMr: number;
  /** (X_n - X_{n-1}) / X_{n-1}, null if X_{n-1} is 0 (percent change undefined). */
  percentChange: number | null;
}

export interface DriftResult {
  /** Upper CUSUM series, one value per point after the first. */
  cPlus: number[];
  /** Lower CUSUM series, one value per point after the first. */
  cMinus: number[];
  /** Reference value k = 0.5 * sigma (detects a ~1-sigma sustained shift efficiently -- see driftDetection.ts). */
  k: number;
  /** Decision interval H = 5 * sigma (standard default, comparable ARL to a 3-sigma Shewhart chart). */
  h: number;
  detected: boolean;
  direction: 'WORSENING' | 'IMPROVING' | 'NONE';
}

export interface CapabilityResult {
  usl: number | null;
  /** One-sided upper capability index: (USL - centerLine) / (3 * sigma). Null if usl is not configured. */
  cpu: number | null;
  /** Cpu >= 1.33 is conventionally "capable" (ARCHITECTURE.md SS8.4). */
  capable: boolean | null;
}

/** The literal output contract requested: a quick-glance summary. */
export interface SpcSummary {
  processState: ProcessState;
  uclViolation: boolean;
  trendDetected: boolean;
  regressionDetected: boolean;
  stabilityStatus: StabilityStatus;
}

/** The full report: SpcSummary's fields plus every supporting calculation. */
export interface SpcReport extends SpcSummary {
  generatedAt: string;
  sampleSize: number;
  chart: ControlChartResult;
  westernElectric: RuleEvaluation[];
  nelson: RuleEvaluation[];
  trend: TrendResult;
  regressionSpike: RegressionSpikeResult;
  drift: DriftResult;
  capability: CapabilityResult;
}

export interface SpcEngineOptions {
  /** Upper specification limit for process capability (ARCHITECTURE.md SS8.4). Undefined = capability not computed. */
  usl?: number;
  /** Correlation-coefficient threshold for trendDetection's regression-based signal. Default 0.7. */
  trendCorrelationThreshold?: number;
  /** Minimum window size for the regression-based trend signal to be considered meaningful. Default 5. */
  trendMinWindow?: number;
}
