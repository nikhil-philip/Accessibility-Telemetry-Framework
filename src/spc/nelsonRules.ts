import { RuleEvaluation } from './types';
import {
  nOfMBeyondSigma,
  nConsecutiveSameSide,
  nConsecutiveTrend,
  nConsecutiveAlternating,
  nConsecutiveWithinSigma,
  nConsecutiveBeyondSigmaEitherSide,
} from './ruleHelpers';

/**
 * The Nelson Rules -- Lloyd S. Nelson, "The Shewhart Control Chart --
 * Tests for Special Causes", Journal of Quality Technology, 1984. An
 * 8-rule superset of the Western Electric rules: rules 1, 5, and 6 below
 * are the same patterns as WECO rules 1, 2, and 3; Nelson's rule 2
 * tightens WECO's "8 consecutive same side" to 9; and rules 3, 4, 7, 8
 * are new patterns WECO didn't test for. Each catches a distinct failure
 * mode a raw 3-sigma limit check misses:
 *
 *   Rule 1: 1 point beyond 3-sigma                     -- sudden, large shift
 *   Rule 2: 9 points in a row, same side of center      -- sustained shift
 *   Rule 3: 6 points in a row, steadily trending         -- gradual drift
 *   Rule 4: 14 points in a row, alternating up/down       -- systematic (non-random) variation
 *   Rule 5: 2 of 3 points beyond 2-sigma, same side       -- emerging shift
 *   Rule 6: 4 of 5 points beyond 1-sigma, same side       -- early drift
 *   Rule 7: 15 points in a row within 1-sigma, either side -- stratification
 *   Rule 8: 8 points in a row beyond 1-sigma, either side (none within) -- mixture
 *
 * Rules 7 and 8 are the two rules most teams overlook, because they don't
 * look like "bad" patterns at a glance -- they flag the process for
 * looking *too clean* (rule 7) or *bimodal* (rule 8), both of which
 * usually mean the control limits were computed wrong, or two different
 * processes are being plotted on one chart, rather than that quality is
 * actually fine. For this project that would look like, e.g., two very
 * different applications' scans accidentally being appended to the same
 * telemetry history.
 *
 * Lean Quality Gate model (gates/qualityGateEvaluator.ts): only rules 1, 2,
 * and 3 ever contribute a gate FAIL/WARN, and only when they culminate at
 * the latest build (`culminatesAtLatest`) -- rule 1 as a FAIL, rules 2 and
 * 3 as a WARN and only in the worsening direction (`direction: 'above'`/
 * `'up'`). Rules 4, 5, 6, 7, and 8 remain fully computed and reported here
 * (informational/dashboard display, and available to any caller that wants
 * the full WECO/Nelson picture) but never reach the gate -- rules 7 and 8
 * in particular are measurement-system health signals, not per-build
 * defect-regression signals, and rules 4/5/6 are either off-topic
 * (alternation) or subsumed by the culminates-at-latest-scoped rule 1/2/3
 * trio for this project's purposes.
 */
export function evaluateNelsonRules(values: number[], centerLine: number, sigma: number): RuleEvaluation[] {
  const rule1 = nOfMBeyondSigma(values, centerLine, sigma, 3, 1, 1);
  const rule2 = nConsecutiveSameSide(values, centerLine, 9);
  const rule3 = nConsecutiveTrend(values, 6);
  const rule4 = nConsecutiveAlternating(values, 14);
  const rule5 = nOfMBeyondSigma(values, centerLine, sigma, 2, 2, 3);
  const rule6 = nOfMBeyondSigma(values, centerLine, sigma, 1, 4, 5);
  const rule7 = nConsecutiveWithinSigma(values, centerLine, sigma, 1, 15);
  const rule8 = nConsecutiveBeyondSigmaEitherSide(values, centerLine, sigma, 1, 8);

  return [
    {
      ruleSet: 'NELSON',
      rule: 1,
      name: 'Beyond 3-sigma',
      description: 'One point falls beyond 3 standard deviations from the center line -- a single large, sudden shift.',
      triggered: rule1.triggered,
      triggeredAtIndex: rule1.triggeredAtIndex,
      involvedIndices: rule1.involvedIndices,
      culminatesAtLatest: rule1.culminatesAtLatest,
      occurrences: rule1.occurrences,
    },
    {
      ruleSet: 'NELSON',
      rule: 2,
      name: '9 consecutive same side',
      description: 'Nine consecutive points fall on the same side of the center line -- a sustained process shift.',
      triggered: rule2.triggered,
      triggeredAtIndex: rule2.triggeredAtIndex,
      involvedIndices: rule2.involvedIndices,
      direction: rule2.direction ?? undefined,
      culminatesAtLatest: rule2.culminatesAtLatest,
      occurrences: rule2.occurrences,
    },
    {
      ruleSet: 'NELSON',
      rule: 3,
      name: '6 consecutive trending',
      description: 'Six consecutive points steadily increase, or steadily decrease -- a gradual, directional drift.',
      triggered: rule3.triggered,
      triggeredAtIndex: rule3.triggeredAtIndex,
      involvedIndices: rule3.involvedIndices,
      direction: rule3.direction ?? undefined,
      culminatesAtLatest: rule3.culminatesAtLatest,
      occurrences: rule3.occurrences,
    },
    {
      ruleSet: 'NELSON',
      rule: 4,
      name: '14 consecutive alternating',
      description: 'Fourteen consecutive points alternate up and down -- variation too regular to be random (e.g. two interleaved processes).',
      triggered: rule4.triggered,
      triggeredAtIndex: rule4.triggeredAtIndex,
      involvedIndices: rule4.involvedIndices,
      culminatesAtLatest: rule4.culminatesAtLatest,
      occurrences: rule4.occurrences,
    },
    {
      ruleSet: 'NELSON',
      rule: 5,
      name: '2 of 3 beyond 2-sigma',
      description: 'Two of three consecutive points fall beyond 2 standard deviations on the same side -- an emerging shift.',
      triggered: rule5.triggered,
      triggeredAtIndex: rule5.triggeredAtIndex,
      involvedIndices: rule5.involvedIndices,
      culminatesAtLatest: rule5.culminatesAtLatest,
      occurrences: rule5.occurrences,
    },
    {
      ruleSet: 'NELSON',
      rule: 6,
      name: '4 of 5 beyond 1-sigma',
      description: 'Four of five consecutive points fall beyond 1 standard deviation on the same side -- early drift.',
      triggered: rule6.triggered,
      triggeredAtIndex: rule6.triggeredAtIndex,
      involvedIndices: rule6.involvedIndices,
      culminatesAtLatest: rule6.culminatesAtLatest,
      occurrences: rule6.occurrences,
    },
    {
      ruleSet: 'NELSON',
      rule: 7,
      name: '15 consecutive within 1-sigma',
      description: 'Fifteen consecutive points fall within 1 standard deviation of the center line -- suspiciously low variation (stratification); often a sign the control limits or sampling are wrong, not that quality genuinely improved.',
      triggered: rule7.triggered,
      triggeredAtIndex: rule7.triggeredAtIndex,
      involvedIndices: rule7.involvedIndices,
      culminatesAtLatest: rule7.culminatesAtLatest,
      occurrences: rule7.occurrences,
    },
    {
      ruleSet: 'NELSON',
      rule: 8,
      name: '8 consecutive beyond 1-sigma (either side)',
      description: 'Eight consecutive points fall beyond 1 standard deviation with none within it -- a mixture of two different processes plotted on one chart.',
      triggered: rule8.triggered,
      triggeredAtIndex: rule8.triggeredAtIndex,
      involvedIndices: rule8.involvedIndices,
      culminatesAtLatest: rule8.culminatesAtLatest,
      occurrences: rule8.occurrences,
    },
  ];
}
