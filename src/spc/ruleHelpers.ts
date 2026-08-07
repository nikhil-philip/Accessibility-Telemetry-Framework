/**
 * Shared pattern-matching primitives behind both westernElectricRules.ts
 * and nelsonRules.ts. Every WECO/Nelson rule reduces to one of a small
 * number of pattern shapes -- "K of the last N points beyond a sigma
 * threshold", "N points in a row on one side", "N points in a row
 * trending", etc. Implementing each shape exactly once here means WECO
 * rule 2 and Nelson rule 5 (which are the *same* pattern -- 2 of 3 beyond
 * 2-sigma -- just published under two different names in two different
 * decades) can't silently drift out of sync with each other.
 *
 * All zone thresholds are expressed in sigma-hat units, relative to the
 * chart's center line -- the classic SPC "zone" partition:
 *   Zone C: within 1 sigma      Zone B: 1-2 sigma      Zone A: 2-3 sigma
 *   Beyond Zone A: > 3 sigma (out of control)
 */

export interface PatternMatch {
  triggered: boolean;
  /** Index of the most recent point completing the pattern, if triggered. */
  triggeredAtIndex: number | null;
  involvedIndices: number[];
}

const NO_MATCH: PatternMatch = { triggered: false, triggeredAtIndex: null, involvedIndices: [] };

function signedSigmaDistance(value: number, centerLine: number, sigma: number): number {
  if (sigma === 0) return 0;
  return (value - centerLine) / sigma;
}

/**
 * "At least `n` of the last `m` points are beyond `k` sigma from the
 * center line, on the same side." Covers WECO rules 1-3 and Nelson rules
 * 1, 5, 6 (rule 1 is the degenerate case n=1, m=1).
 */
export function nOfMBeyondSigma(
  values: number[],
  centerLine: number,
  sigma: number,
  k: number,
  n: number,
  m: number,
): PatternMatch {
  if (values.length < m) return NO_MATCH;

  for (let windowEnd = m - 1; windowEnd < values.length; windowEnd++) {
    const windowStart = windowEnd - m + 1;
    const above: number[] = [];
    const below: number[] = [];

    for (let i = windowStart; i <= windowEnd; i++) {
      // Non-null: i is bounded by windowStart..windowEnd, and windowEnd < values.length by the loop condition above.
      const d = signedSigmaDistance(values[i]!, centerLine, sigma);
      if (d >= k) above.push(i);
      else if (d <= -k) below.push(i);
    }

    const offenders = above.length >= n ? above : below.length >= n ? below : null;
    if (offenders) {
      return { triggered: true, triggeredAtIndex: windowEnd, involvedIndices: offenders };
    }
  }
  return NO_MATCH;
}

/** `n` consecutive points on the same side of the center line (WECO rule 4, Nelson rule 2). */
export function nConsecutiveSameSide(values: number[], centerLine: number, n: number): PatternMatch {
  if (values.length < n) return NO_MATCH;

  for (let end = n - 1; end < values.length; end++) {
    const window = values.slice(end - n + 1, end + 1);
    const allAbove = window.every((v) => v > centerLine);
    const allBelow = window.every((v) => v < centerLine);
    if (allAbove || allBelow) {
      const indices = Array.from({ length: n }, (_, i) => end - n + 1 + i);
      return { triggered: true, triggeredAtIndex: end, involvedIndices: indices };
    }
  }
  return NO_MATCH;
}

/** `n` consecutive points steadily increasing, or steadily decreasing (Nelson rule 3). */
export function nConsecutiveTrend(values: number[], n: number): PatternMatch & { direction: 'up' | 'down' | null } {
  if (values.length < n) return { ...NO_MATCH, direction: null };

  for (let end = n - 1; end < values.length; end++) {
    const window = values.slice(end - n + 1, end + 1);
    let increasing = true;
    let decreasing = true;
    for (let i = 1; i < window.length; i++) {
      if (window[i]! <= window[i - 1]!) increasing = false;
      if (window[i]! >= window[i - 1]!) decreasing = false;
    }
    if (increasing || decreasing) {
      const indices = Array.from({ length: n }, (_, i) => end - n + 1 + i);
      return { triggered: true, triggeredAtIndex: end, involvedIndices: indices, direction: increasing ? 'up' : 'down' };
    }
  }
  return { ...NO_MATCH, direction: null };
}

/** `n` consecutive points alternating strictly up/down/up/down (Nelson rule 4 -- systematic oscillation). */
export function nConsecutiveAlternating(values: number[], n: number): PatternMatch {
  if (values.length < n) return NO_MATCH;

  for (let end = n - 1; end < values.length; end++) {
    const window = values.slice(end - n + 1, end + 1);

    // Reduce the window to a sequence of step signs (+1 / -1); a tie
    // (equal consecutive values) breaks the pattern outright, and a valid
    // alternation requires every sign to differ from the one before it.
    const signs: number[] = [];
    let tied = false;
    for (let i = 1; i < window.length; i++) {
      const diff = window[i]! - window[i - 1]!;
      if (diff === 0) {
        tied = true;
        break;
      }
      signs.push(diff > 0 ? 1 : -1);
    }

    const alternating = !tied && signs.every((s, i) => i === 0 || s !== signs[i - 1]);
    if (alternating) {
      const indices = Array.from({ length: n }, (_, i) => end - n + 1 + i);
      return { triggered: true, triggeredAtIndex: end, involvedIndices: indices };
    }
  }
  return NO_MATCH;
}

/** `n` consecutive points all within `k` sigma of the center line, either side (Nelson rule 7 -- stratification). */
export function nConsecutiveWithinSigma(values: number[], centerLine: number, sigma: number, k: number, n: number): PatternMatch {
  if (values.length < n) return NO_MATCH;

  for (let end = n - 1; end < values.length; end++) {
    const window = values.slice(end - n + 1, end + 1);
    const allWithin = window.every((v) => Math.abs(signedSigmaDistance(v, centerLine, sigma)) < k);
    if (allWithin) {
      const indices = Array.from({ length: n }, (_, i) => end - n + 1 + i);
      return { triggered: true, triggeredAtIndex: end, involvedIndices: indices };
    }
  }
  return NO_MATCH;
}

/** `n` consecutive points all beyond `k` sigma of the center line on EITHER side -- none within it (Nelson rule 8 -- mixture). */
export function nConsecutiveBeyondSigmaEitherSide(
  values: number[],
  centerLine: number,
  sigma: number,
  k: number,
  n: number,
): PatternMatch {
  if (values.length < n) return NO_MATCH;

  for (let end = n - 1; end < values.length; end++) {
    const window = values.slice(end - n + 1, end + 1);
    const allBeyond = window.every((v) => Math.abs(signedSigmaDistance(v, centerLine, sigma)) > k);
    if (allBeyond) {
      const indices = Array.from({ length: n }, (_, i) => end - n + 1 + i);
      return { triggered: true, triggeredAtIndex: end, involvedIndices: indices };
    }
  }
  return NO_MATCH;
}
