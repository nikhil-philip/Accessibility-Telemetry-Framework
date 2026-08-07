import { DriftResult } from './types';

/**
 * Process drift detection via the tabular CUSUM (cumulative sum) scheme
 * -- Montgomery, "Introduction to Statistical Quality Control", ch. 9.
 *
 * WHY this is a separate technique from the I-MR chart and WECO/Nelson
 * rules above: Shewhart-type charts (which is what the I-chart, WECO, and
 * Nelson rules all are, however many extra pattern tests get layered on)
 * are built to catch LARGE shifts fast -- roughly 1.5 sigma or more. They
 * are provably slow at catching SMALL, sustained shifts (on the order of
 * 0.5-1 sigma): individually, a run of slightly-elevated points can look
 * like ordinary noise for a long time before any Shewhart-style rule
 * fires. CUSUM is the classical complement, purpose-built for exactly
 * that gap -- it accumulates small deviations over time instead of
 * judging each point in isolation, so a persistent small shift builds up
 * a signal even though no single point (or short run) looks unusual.
 * This is precisely the "quiet accessibility debt creep" scenario
 * ARCHITECTURE.md's introduction is concerned with: a team's defect score
 * drifting up by a little each build, never once triggering an I-chart
 * rule, until it's meaningfully worse than where it started.
 *
 * --- Formulas (two-sided tabular CUSUM) ---
 *
 *   k = reference value ("slack"), standard default 0.5 * sigma-hat
 *       (tuned to detect a ~1-sigma sustained shift efficiently)
 *   h = decision interval, standard default 5 * sigma-hat
 *       (gives out-of-control run-length properties comparable to a
 *       3-sigma Shewhart chart, but detects small persistent shifts in
 *       far fewer samples)
 *
 *   C+_0 = 0
 *   C+_i = max(0, X_i - (X-bar + k) + C+_(i-1))     -- accumulates upward (worsening) deviation
 *
 *   C-_0 = 0
 *   C-_i = max(0, (X-bar - k) - X_i + C-_(i-1))     -- accumulates downward (improving) deviation
 *
 * The process is flagged as drifting the moment either accumulator
 * exceeds h -- C+ crossing h means a sustained upward (worsening) drift;
 * C- crossing h means a sustained downward (improving) one.
 */

const K_SIGMA_MULTIPLIER = 0.5;
const H_SIGMA_MULTIPLIER = 5;

export function detectDrift(values: number[], centerLine: number, sigma: number): DriftResult {
  const k = K_SIGMA_MULTIPLIER * sigma;
  const h = H_SIGMA_MULTIPLIER * sigma;

  const cPlus: number[] = [];
  const cMinus: number[] = [];

  let runningPlus = 0;
  let runningMinus = 0;

  for (const x of values) {
    runningPlus = Math.max(0, x - (centerLine + k) + runningPlus);
    runningMinus = Math.max(0, centerLine - k - x + runningMinus);
    cPlus.push(runningPlus);
    cMinus.push(runningMinus);
  }

  const latestPlus = cPlus[cPlus.length - 1] ?? 0;
  const latestMinus = cMinus[cMinus.length - 1] ?? 0;

  let direction: DriftResult['direction'] = 'NONE';
  if (latestPlus > h) direction = 'WORSENING';
  else if (latestMinus > h) direction = 'IMPROVING';

  return { cPlus, cMinus, k, h, detected: direction !== 'NONE', direction };
}
