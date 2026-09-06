/**
 * Shared types for the SPC Analytics Engine (ARCHITECTURE.md Layer 5).
 * Field names for chart-level values (centerLine, mrBar, sigma, uclX,
 * lclX, uclMr) intentionally match ARCHITECTURE.md Appendix B's "SPC
 * Summary Schema" so this implementation is a strict extension of the
 * already-documented contract, not a departure from it.
 */
import { SpecialCauseClassification } from './specialCauseClassifications';

/** One individual measurement in the I-chart's time series -- one per build. */
export interface DataPoint {
  buildId: string;
  commitSha: string;
  timestamp: string;
  /** The individual value X_i. For this project, TelemetryRecord.defectScore. */
  value: number;
  /**
   * Set (by computeControlChart(), see specialCauseClassifications.ts) when
   * this record is explicitly classified as a special cause. Such records
   * are excluded from control-limit calculation but remain in `individuals`
   * for historical display. Undefined for every unclassified record --
   * unclassified records are always eligible, however extreme their value.
   */
  specialCause?: SpecialCauseClassification;
}

export type ProcessState = 'IN_CONTROL' | 'OUT_OF_CONTROL' | 'INSUFFICIENT_DATA';

export type StabilityStatus = 'STABLE' | 'DRIFTING' | 'OUT_OF_CONTROL' | 'REGRESSED' | 'INSUFFICIENT_DATA';

export type RuleSetName = 'WESTERN_ELECTRIC' | 'NELSON';

/** One completed occurrence of a rule's pattern somewhere in the series -- see RuleEvaluation.occurrences. */
export interface RulePatternOccurrence {
  /** Index (0-based) of the first point participating in this occurrence. */
  startIndex: number;
  /** Index (0-based) of the point that completes this occurrence -- equivalent to a per-occurrence `triggeredAtIndex`. */
  endIndex: number;
  /** Series indices participating in this occurrence. */
  involvedIndices: number[];
  /** Same meaning as RuleEvaluation.direction, but for this specific occurrence. Undefined for rules with no inherent direction. */
  direction?: 'above' | 'below' | 'up' | 'down';
}

/** The result of checking one WECO/Nelson rule against the full series. */
export interface RuleEvaluation {
  ruleSet: RuleSetName;
  rule: number;
  name: string;
  description: string;
  triggered: boolean;
  /** Index (0-based, into the I-chart series) of the MOST RECENT point that completes the pattern, if triggered anywhere in the series. */
  triggeredAtIndex: number | null;
  /** All series indices participating in the most recent triggering pattern, if triggered. */
  involvedIndices: number[];
  /**
   * Which side/direction the triggering pattern is on, for rules where that
   * is meaningful: 'above'/'below' center line (Nelson rule 2 and WECO
   * rule 4's same-side run), 'up'/'down' (Nelson rule 3's trend run).
   * Undefined for rules with no inherent direction (e.g. beyond-3-sigma
   * either side, alternation, stratification, mixture) or when not triggered.
   */
  direction?: 'above' | 'below' | 'up' | 'down';
  /**
   * True only when the most recent occurrence of this pattern ends at the
   * series' last index (values.length - 1) -- i.e. the pattern is active on
   * the CURRENT/latest build, not merely present somewhere earlier in
   * history. False (not undefined) whenever `triggered` is true but the
   * pattern's last occurrence is not the latest point; undefined only when
   * `triggered` is false.
   */
  culminatesAtLatest?: boolean;
  /**
   * EVERY completed occurrence of this pattern found anywhere in the
   * series, oldest first -- for full-history dashboard annotation (a build
   * from months ago that was flagged should stay flagged on the historical
   * chart even after a more recent occurrence supersedes it at the root
   * level). The root-level `involvedIndices`, `direction`, and
   * `culminatesAtLatest` above always describe the LAST element of this
   * array (the most recent occurrence) -- that invariant is what keeps
   * gates/qualityGateEvaluator.ts's latest-build-only gating correct without
   * it ever needing to look at `occurrences` itself. Optional and possibly
   * absent/empty on hand-built RuleEvaluation fixtures (e.g. in
   * scripts/verify-gates.ts) that only need the root fields; always
   * populated by evaluateWesternElectricRules()/evaluateNelsonRules() for
   * rules 1, 2, and 3 (see ruleHelpers.ts). Rules 4, 5, 6, 7, and 8 (and
   * WECO's rules) currently still report only their first historical match
   * as a single-element array -- see those rules' doc comments in
   * ruleHelpers.ts for why full multi-occurrence tracking wasn't extended
   * to them.
   */
  occurrences?: RulePatternOccurrence[];
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
  /**
   * Trailing-window size: when set, computeSpcReport() computes the I-MR
   * chart and every detector over only the most recent `windowSize` records
   * (chronologically), via selectHistoryWindow() (spcEngine.ts). Undefined
   * (the default) means unbounded/expanding history -- computeSpcReport()'s
   * historical, still-supported behavior, which existing callers (the
   * dashboard's production chart, experimentAnalysis.ts's EXPANDING_HISTORY
   * method, scripts/verify-*.ts's full-cohort checks) rely on. The
   * production CI gate path opts into windowing via
   * DEFAULT_GATE_POLICY.spcOptions.windowSize (gates/gatePolicies.ts), not
   * via a default baked in here.
   */
  windowSize?: number;
}
