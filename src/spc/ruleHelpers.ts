import { RulePatternOccurrence } from './types';

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
  /** Index of the MOST RECENT point completing the pattern, if triggered anywhere in the series -- equivalent to `occurrences[occurrences.length - 1].endIndex`. */
  triggeredAtIndex: number | null;
  /** Series indices participating in the most recent triggering occurrence -- equivalent to `occurrences[occurrences.length - 1].involvedIndices`. */
  involvedIndices: number[];
  /**
   * True only when the most recent occurrence's completing index is the
   * series' last index (values.length - 1) -- i.e. the pattern is active on
   * the current/latest point, not merely present somewhere earlier in
   * history. Always false when `triggered` is false.
   */
  culminatesAtLatest: boolean;
  /**
   * EVERY completed occurrence found while scanning the series, oldest
   * first. `triggeredAtIndex`/`involvedIndices`/`culminatesAtLatest` above
   * always describe `occurrences[occurrences.length - 1]` -- that invariant
   * is what lets a caller that only wants "is this active right now"
   * (gates/qualityGateEvaluator.ts) keep using the root fields unchanged,
   * while a caller that wants the full historical picture (the dashboard)
   * can read `occurrences` instead. Empty when `triggered` is false.
   */
  occurrences: RulePatternOccurrence[];
}

const NO_MATCH: PatternMatch = { triggered: false, triggeredAtIndex: null, involvedIndices: [], culminatesAtLatest: false, occurrences: [] };

function signedSigmaDistance(value: number, centerLine: number, sigma: number): number {
  if (sigma === 0) return 0;
  return (value - centerLine) / sigma;
}

/**
 * "At least `n` of the last `m` points are beyond `k` sigma from the
 * center line, on the same side." Covers WECO rules 1-3 and Nelson rules
 * 1, 5, 6 (rule 1 is the degenerate case n=1, m=1).
 *
 * Scans every window in the series (does NOT stop at the first historical
 * match, and does NOT overwrite earlier matches) so that `occurrences`
 * captures every historical instance of the pattern -- e.g. for full-history
 * dashboard annotation. The root-level `triggeredAtIndex`/`involvedIndices`/
 * `culminatesAtLatest` always describe the LAST (most recent) occurrence, so
 * a caller that only cares about the current/latest build (see
 * `culminatesAtLatest`) can keep reading just those fields unchanged.
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

  const occurrences: RulePatternOccurrence[] = [];

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
      occurrences.push({ startIndex: windowStart, endIndex: windowEnd, involvedIndices: offenders });
    }
  }

  if (occurrences.length === 0) return NO_MATCH;
  const last = occurrences[occurrences.length - 1]!;
  return {
    triggered: true,
    triggeredAtIndex: last.endIndex,
    involvedIndices: last.involvedIndices,
    culminatesAtLatest: last.endIndex === values.length - 1,
    occurrences,
  };
}

/**
 * `n` consecutive points on the same side of the center line (WECO rule 4,
 * Nelson rule 2). Reports which side triggered ('above' = worsening for a
 * defect score where higher is worse, 'below' = improving) so callers can
 * gate only on the worsening direction. Scans the full series and records
 * every occurrence (see nOfMBeyondSigma's doc comment) -- the root-level
 * `triggeredAtIndex`/`direction` always describe the most recent one.
 */
export function nConsecutiveSameSide(values: number[], centerLine: number, n: number): PatternMatch & { direction: 'above' | 'below' | null } {
  if (values.length < n) return { ...NO_MATCH, direction: null };

  const occurrences: (RulePatternOccurrence & { direction: 'above' | 'below' })[] = [];

  for (let end = n - 1; end < values.length; end++) {
    const window = values.slice(end - n + 1, end + 1);
    const allAbove = window.every((v) => v > centerLine);
    const allBelow = window.every((v) => v < centerLine);
    if (allAbove || allBelow) {
      const indices = Array.from({ length: n }, (_, i) => end - n + 1 + i);
      occurrences.push({ startIndex: end - n + 1, endIndex: end, involvedIndices: indices, direction: allAbove ? 'above' : 'below' });
    }
  }

  if (occurrences.length === 0) return { ...NO_MATCH, direction: null };
  const last = occurrences[occurrences.length - 1]!;
  return {
    triggered: true,
    triggeredAtIndex: last.endIndex,
    involvedIndices: last.involvedIndices,
    culminatesAtLatest: last.endIndex === values.length - 1,
    direction: last.direction,
    occurrences,
  };
}

/**
 * `n` consecutive points steadily increasing, or steadily decreasing
 * (Nelson rule 3). Scans the full series and records every occurrence (see
 * nOfMBeyondSigma's doc comment) -- the root-level `triggeredAtIndex`/
 * `direction` always describe the most recent one.
 */
export function nConsecutiveTrend(values: number[], n: number): PatternMatch & { direction: 'up' | 'down' | null } {
  if (values.length < n) return { ...NO_MATCH, direction: null };

  const occurrences: (RulePatternOccurrence & { direction: 'up' | 'down' })[] = [];

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
      occurrences.push({ startIndex: end - n + 1, endIndex: end, involvedIndices: indices, direction: increasing ? 'up' : 'down' });
    }
  }

  if (occurrences.length === 0) return { ...NO_MATCH, direction: null };
  const last = occurrences[occurrences.length - 1]!;
  return {
    triggered: true,
    triggeredAtIndex: last.endIndex,
    involvedIndices: last.involvedIndices,
    culminatesAtLatest: last.endIndex === values.length - 1,
    direction: last.direction,
    occurrences,
  };
}

/**
 * `n` consecutive points alternating strictly up/down/up/down (Nelson rule
 * 4 -- systematic oscillation). Unlike the three helpers above, this still
 * returns on the FIRST historical match (earliest occurrence): Nelson rule
 * 4 is excluded from the Lean gate model entirely (see
 * gates/qualityGateEvaluator.ts), so only `triggered` (informational,
 * dashboard-facing) is load-bearing here -- `culminatesAtLatest` is still
 * populated for type consistency with PatternMatch, but reflects the
 * earliest match, not the latest.
 */
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
      return {
        triggered: true,
        triggeredAtIndex: end,
        involvedIndices: indices,
        culminatesAtLatest: end === values.length - 1,
        occurrences: [{ startIndex: end - n + 1, endIndex: end, involvedIndices: indices }],
      };
    }
  }
  return NO_MATCH;
}

/**
 * `n` consecutive points all within `k` sigma of the center line, either
 * side (Nelson rule 7 -- stratification). Still returns on the FIRST
 * historical match (earliest occurrence) -- Nelson rule 7 is excluded from
 * the Lean gate model entirely (see gates/qualityGateEvaluator.ts), so only
 * `triggered` (informational, dashboard-facing) is load-bearing here.
 */
export function nConsecutiveWithinSigma(values: number[], centerLine: number, sigma: number, k: number, n: number): PatternMatch {
  if (values.length < n) return NO_MATCH;

  for (let end = n - 1; end < values.length; end++) {
    const window = values.slice(end - n + 1, end + 1);
    const allWithin = window.every((v) => Math.abs(signedSigmaDistance(v, centerLine, sigma)) < k);
    if (allWithin) {
      const indices = Array.from({ length: n }, (_, i) => end - n + 1 + i);
      return {
        triggered: true,
        triggeredAtIndex: end,
        involvedIndices: indices,
        culminatesAtLatest: end === values.length - 1,
        occurrences: [{ startIndex: end - n + 1, endIndex: end, involvedIndices: indices }],
      };
    }
  }
  return NO_MATCH;
}

/**
 * `n` consecutive points all beyond `k` sigma of the center line on EITHER
 * side -- none within it (Nelson rule 8 -- mixture). Still returns on the
 * FIRST historical match (earliest occurrence) -- Nelson rule 8 is excluded
 * from the Lean gate model entirely (see gates/qualityGateEvaluator.ts), so
 * only `triggered` (informational, dashboard-facing) is load-bearing here.
 */
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
      return {
        triggered: true,
        triggeredAtIndex: end,
        involvedIndices: indices,
        culminatesAtLatest: end === values.length - 1,
        occurrences: [{ startIndex: end - n + 1, endIndex: end, involvedIndices: indices }],
      };
    }
  }
  return NO_MATCH;
}
