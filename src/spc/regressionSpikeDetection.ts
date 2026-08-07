import { RegressionSpikeResult } from './types';

/**
 * A "regression spike" is a different question from "is the latest point
 * out of control" (that's WECO/Nelson rule 1, evaluated against the
 * I-chart). This asks: was the *jump between the last two builds itself*
 * abnormally large? That's exactly what the MR-chart is for -- the
 * moving range chart monitors point-to-point volatility, independently
 * of where the level of the process happens to sit.
 *
 * A build can regress hard (a big spike) while still landing under
 * UCL_X, if the process had been running with a lot of headroom below
 * its historical center line -- WECO/Nelson rule 1 would miss that build
 * entirely. The MR-chart catches it because 3->35 is a huge jump in
 * absolute terms even if 35 alone isn't statistically extreme yet.
 *
 * Formula: flag the latest build if
 *
 *   MR_n > UCL_MR        (the jump itself is a statistical outlier), AND
 *   X_n > X_(n-1)         (the score got WORSE, not better)
 *
 * The second condition matters because MR is an absolute value -- a big
 * *improvement* (a large drop in defect score) produces an equally large
 * MR_n and must not be reported as a regression.
 */
export function detectRegressionSpike(values: number[], movingRanges: number[], uclMr: number): RegressionSpikeResult {
  if (values.length < 2 || movingRanges.length === 0) {
    return { detected: false, latestMovingRange: null, uclMr, percentChange: null };
  }

  // Non-null: guarded by the length checks above (values.length >= 2, movingRanges.length >= 1).
  const latest = values[values.length - 1]!;
  const previous = values[values.length - 2]!;
  const latestMovingRange = movingRanges[movingRanges.length - 1]!;

  const worsened = latest > previous;
  const detected = latestMovingRange > uclMr && worsened;

  const percentChange = previous === 0 ? null : (latest - previous) / previous;

  return { detected, latestMovingRange, uclMr, percentChange };
}
