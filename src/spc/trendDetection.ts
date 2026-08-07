import { TrendResult } from './types';
import { nConsecutiveTrend } from './ruleHelpers';

/**
 * Trend detection combines two independent signals on purpose:
 *
 * 1. Nelson Rule 3 (nConsecutiveTrend, imported from ruleHelpers) -- a
 *    strict pattern test: 6 consecutive points, every single one strictly
 *    more (or less) than the last. It's a hard yes/no with zero false
 *    positives by construction, but it's brittle -- one single flat or
 *    reversed point anywhere in the run resets it to zero, even if the
 *    process is obviously trending overall.
 *
 * 2. Ordinary least-squares linear regression of value against build
 *    index, over the most recent DEFAULT_TREND_WINDOW points. This is the
 *    general statistical tool for "is there a line here" and tolerates
 *    noise around an overall direction, which Nelson Rule 3 cannot.
 *
 * A trend is reported if EITHER fires -- Rule 3 catches a clean, textbook
 * monotonic run; the regression catches a noisier but still real slope
 * that never happens to string together 6 perfectly monotonic points.
 *
 * --- Regression formulas ---
 * For points (i, y_i), i = 0..n-1 the build index, y_i the defect score:
 *
 *   i-bar = mean(i),  y-bar = mean(y)
 *   slope       = sum((i - i-bar)(y_i - y-bar)) / sum((i - i-bar)^2)
 *   correlation = sum((i - i-bar)(y_i - y-bar))
 *                 / sqrt( sum((i - i-bar)^2) * sum((y_i - y-bar)^2) )
 *
 * `correlation` (Pearson's r) is in [-1, 1]; |r| close to 1 means the
 * points sit close to a straight line. A slope near zero or a low |r|
 * means "no meaningful trend," regardless of Rule 3.
 */

const DEFAULT_TREND_WINDOW = 10;

function linearRegression(series: number[]): { slope: number; correlation: number } {
  const n = series.length;
  if (n < 2) return { slope: 0, correlation: 0 };

  const xs = series.map((_, i) => i);
  const xBar = xs.reduce((s, x) => s + x, 0) / n;
  const yBar = series.reduce((s, y) => s + y, 0) / n;

  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - xBar;
    const dy = series[i]! - yBar;
    sumXY += dx * dy;
    sumXX += dx * dx;
    sumYY += dy * dy;
  }

  const slope = sumXX === 0 ? 0 : sumXY / sumXX;
  const denom = Math.sqrt(sumXX * sumYY);
  const correlation = denom === 0 ? 0 : sumXY / denom;

  return { slope, correlation };
}

export function detectTrend(
  values: number[],
  options: { correlationThreshold?: number; minWindow?: number } = {},
): TrendResult {
  const correlationThreshold = options.correlationThreshold ?? 0.7;
  const minWindow = options.minWindow ?? 5;

  const nelson = nConsecutiveTrend(values, 6);

  const window = values.slice(-DEFAULT_TREND_WINDOW);
  const { slope, correlation } = linearRegression(window);
  const regressionSignificant = window.length >= minWindow && Math.abs(correlation) >= correlationThreshold && slope !== 0;

  const detected = nelson.triggered || regressionSignificant;

  let direction: TrendResult['direction'] = 'NONE';
  if (detected) {
    const worsening = nelson.triggered ? nelson.direction === 'up' : slope > 0;
    direction = worsening ? 'WORSENING' : 'IMPROVING';
  }

  return {
    slope,
    correlation,
    direction,
    nelsonRule3Triggered: nelson.triggered,
    regressionSignificant,
    detected,
  };
}
