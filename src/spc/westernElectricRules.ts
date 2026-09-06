import { RuleEvaluation } from './types';
import { nOfMBeyondSigma, nConsecutiveSameSide } from './ruleHelpers';

/**
 * The Western Electric Rules -- published 1956 in the "Statistical
 * Quality Control Handbook" (Western Electric Company), the original set
 * of pattern tests for a Shewhart control chart. They ask a sharper
 * question than "is the latest point beyond 3-sigma": a process can be
 * clearly drifting out of control while every individual point is still
 * technically inside the 3-sigma limits -- these four rules catch that.
 *
 * All four are evaluated against the I-chart's zone structure (1-sigma,
 * 2-sigma, 3-sigma bands either side of the center line):
 *
 *   Rule 1: 1 point beyond Zone A       (> 3 sigma from center line)
 *   Rule 2: 2 of 3 consecutive points in Zone A or beyond, same side (>= 2 sigma)
 *   Rule 3: 4 of 5 consecutive points in Zone B or beyond, same side (>= 1 sigma)
 *   Rule 4: 8 consecutive points on the same side of the center line (any zone)
 *
 * Lloyd Nelson's 1984 rules (nelsonRules.ts) refine and extend this same
 * idea -- rules 1, 5, and 6 there are these same three patterns, and
 * Nelson's rule 2 tightens WECO rule 4's run length from 8 to 9. Both are
 * implemented here (not just one) because they are, formally, two
 * different published rule sets with two different run-length thresholds
 * for the "consecutive same side" test, even though they overlap.
 *
 * NOT consumed by the Quality Gate (gates/qualityGateEvaluator.ts): every
 * WECO rule here is a duplicate of, or a strict subset of, a Nelson rule
 * (Nelson is a strict superset -- see nelsonRules.ts), so the Lean gate
 * model evaluates Nelson's rules exclusively and would otherwise raise a
 * second, redundant reason for the same underlying statistical event.
 * `evaluateWesternElectricRules()` and its results (`SpcReport.westernElectric`)
 * are retained for informational/dashboard display only.
 */
export function evaluateWesternElectricRules(values: number[], centerLine: number, sigma: number): RuleEvaluation[] {
  const rule1 = nOfMBeyondSigma(values, centerLine, sigma, 3, 1, 1);
  const rule2 = nOfMBeyondSigma(values, centerLine, sigma, 2, 2, 3);
  const rule3 = nOfMBeyondSigma(values, centerLine, sigma, 1, 4, 5);
  const rule4 = nConsecutiveSameSide(values, centerLine, 8);

  return [
    {
      ruleSet: 'WESTERN_ELECTRIC',
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
      ruleSet: 'WESTERN_ELECTRIC',
      rule: 2,
      name: '2 of 3 beyond 2-sigma',
      description: 'Two of three consecutive points fall beyond 2 standard deviations on the same side -- an emerging shift.',
      triggered: rule2.triggered,
      triggeredAtIndex: rule2.triggeredAtIndex,
      involvedIndices: rule2.involvedIndices,
      culminatesAtLatest: rule2.culminatesAtLatest,
      occurrences: rule2.occurrences,
    },
    {
      ruleSet: 'WESTERN_ELECTRIC',
      rule: 3,
      name: '4 of 5 beyond 1-sigma',
      description: 'Four of five consecutive points fall beyond 1 standard deviation on the same side -- early drift.',
      triggered: rule3.triggered,
      triggeredAtIndex: rule3.triggeredAtIndex,
      involvedIndices: rule3.involvedIndices,
      culminatesAtLatest: rule3.culminatesAtLatest,
      occurrences: rule3.occurrences,
    },
    {
      ruleSet: 'WESTERN_ELECTRIC',
      rule: 4,
      name: '8 consecutive same side',
      description: 'Eight consecutive points fall on the same side of the center line -- a sustained process shift.',
      triggered: rule4.triggered,
      triggeredAtIndex: rule4.triggeredAtIndex,
      involvedIndices: rule4.involvedIndices,
      direction: rule4.direction ?? undefined,
      culminatesAtLatest: rule4.culminatesAtLatest,
      occurrences: rule4.occurrences,
    },
  ];
}
