import { ControlChartResult, DataPoint } from './types';

/**
 * Individuals (I) and Moving Range (MR) chart math.
 *
 * WHY an I-MR chart and not an X-bar/R chart: classical Shewhart charts
 * (X-bar/R, X-bar/S) assume measurements arrive in natural SUBGROUPS of
 * several samples per time point (e.g. 5 parts pulled off a line every
 * hour). Accessibility telemetry doesn't have that -- one CI build produces
 * exactly one measurement (the weighted defect score). SPC's answer to
 * "one measurement per time point" is the Individuals-Moving-Range (I-MR)
 * chart: treat each single observation as its own "subgroup of one," and
 * estimate process variation from the *moving range between consecutive
 * points* instead of within-subgroup range.
 *
 * --- Formulas (all standard SPC; see e.g. Montgomery, "Introduction to
 * Statistical Quality Control", ch. 6) ---
 *
 * Individual values:      X_1, X_2, ..., X_n
 * Moving range:            MR_i = |X_i - X_(i-1)|,  i = 2..n   (n-1 values)
 * I-chart center line:      X-bar  = mean(X_1..X_n)
 * MR-chart center line:     MR-bar = mean(MR_2..MR_n)
 *
 * Process sigma is NOT computed as the sample standard deviation of X
 * directly -- that would be inflated by any special-cause variation
 * already present in the data. Instead SPC estimates it from MR-bar using
 * a bias-correction constant:
 *
 *   sigma-hat = MR-bar / d2,   d2 = 1.128   (for a moving range of n=2)
 *
 * d2 is a tabulated constant: the expected value of the range of n
 * samples drawn from a standard normal distribution. For n=2 (a moving
 * range is always a range of exactly 2 consecutive points), d2 = 1.128.
 * This, D3, and D4 below are universal SPC control-chart constants, not
 * something specific to this project -- every SPC textbook tabulates them
 * for subgroup sizes 2 through ~25.
 *
 * I-chart 3-sigma control limits:
 *   UCL_X = X-bar + 3*sigma-hat = X-bar + (3/1.128)*MR-bar = X-bar + 2.66*MR-bar
 *   LCL_X = X-bar - 2.66*MR-bar   (floored at 0 here -- see clampLcl below)
 *
 * MR-chart control limits use their own tabulated constants for n=2:
 *   UCL_MR = D4*MR-bar,  D4 = 3.267
 *   LCL_MR = D3*MR-bar,  D3 = 0        (D3 = 0 for all subgroup sizes <= 6)
 */

/** Range-chart bias-correction constant for a moving range of 2 consecutive points. */
export const D2_CONSTANT = 1.128;
/** MR-chart upper control limit factor for n=2. */
export const D4_CONSTANT = 3.267;
/** MR-chart lower control limit factor for n=2 (always 0 for subgroup sizes <= 6). */
export const D3_CONSTANT = 0;
/** 3 / D2_CONSTANT, precomputed -- the standard shortcut for expressing 3-sigma I-chart limits directly in MR-bar. */
export const I_CHART_SIGMA_FACTOR = 3 / D2_CONSTANT; // 2.6595...

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Accessibility defect scores cannot be negative, so a computed LCL below
 * zero is clamped to 0. This is standard practice for any non-negative
 * count-based or bounded metric -- the *statistical* lower limit may be
 * negative (the process still "could" produce a value that low if it
 * could go negative), but reporting a negative LCL for a defect count is
 * meaningless and misleading on a dashboard.
 */
function clampLowerLimit(value: number): number {
  return Math.max(0, value);
}

export function computeControlChart(points: DataPoint[]): ControlChartResult {
  const individuals = [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const values = individuals.map((p) => p.value);

  const movingRanges: number[] = [];
  for (let i = 1; i < values.length; i++) {
    movingRanges.push(Math.abs(values[i]! - values[i - 1]!));
  }

  const centerLine = mean(values);
  const mrBar = mean(movingRanges);
  const sigma = mrBar / D2_CONSTANT;

  const uclX = centerLine + I_CHART_SIGMA_FACTOR * mrBar;
  const lclX = clampLowerLimit(centerLine - I_CHART_SIGMA_FACTOR * mrBar);
  const uclMr = D4_CONSTANT * mrBar;
  const lclMr = clampLowerLimit(D3_CONSTANT * mrBar);

  return { individuals, movingRanges, centerLine, mrBar, sigma, uclX, lclX, uclMr, lclMr };
}
