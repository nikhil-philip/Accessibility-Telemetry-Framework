import { GatePolicyConfig } from './types';

/**
 * The default Quality Gate policy (ARCHITECTURE.md Layer 6). Encodes the
 * framework's poka-yoke stance (ARCHITECTURE.md SS8.5): block the merge on
 * a statistically confirmed regression, warn on a softer or still-forming
 * signal, stay silent on ordinary common-cause noise.
 *
 * - Any critical defect, a serious-defect overrun, a high weighted score,
 *   a hard 3-sigma/UCL violation, or a confirmed regression spike are all
 *   FAIL by default -- each is either a single-build defect count or a
 *   pattern with essentially zero false-positive rate by construction.
 * - Trend and drift are WARN by default -- both are "worth investigating"
 *   signals (ARCHITECTURE.md SS8.3 Rule 4, SS8.2's "slow debt creep") but
 *   are individually softer/slower-forming than an outright rule trigger,
 *   so blocking a merge on them by default would be too aggressive.
 * - Capability (Cpk) is a WARN/FAIL band rather than a flat FAIL, because
 *   capabilityAnalysis.ts's own doc comment is explicit that a low Cpu is
 *   "a signal about the baseline or the policy, not about any individual
 *   build" -- not something an individual PR can fix by itself.
 */
export const DEFAULT_GATE_POLICY: GatePolicyConfig = {
  maxCriticalDefects: 0,
  maxSeriousDefects: 5,
  defectScore: {
    warnAt: 30,
    failAt: 50,
  },
  spc: {
    failOnUclViolation: true,
    failRules: [
      { ruleSet: 'WESTERN_ELECTRIC', rule: 1 },
      { ruleSet: 'NELSON', rule: 1 },
    ],
    warnOnOtherTriggeredRules: true,
  },
  regression: {
    onDetected: 'FAIL',
  },
  trend: {
    onDetected: 'WARN',
    onlyWorsening: true,
  },
  drift: {
    onDetected: 'WARN',
    onlyWorsening: true,
  },
  capability: {
    warnBelowCpu: 1.33,
    failBelowCpu: 1.0,
  },
};

/**
 * Shallow-merges a partial policy over DEFAULT_GATE_POLICY, one level deep
 * per nested config group -- so `mergeGatePolicy({ trend: { onDetected:
 * 'FAIL' } })` only needs to specify the field that changed, without
 * having to also repeat `onlyWorsening` or any unrelated group.
 */
export function mergeGatePolicy(overrides: Partial<GatePolicyConfig> = {}): GatePolicyConfig {
  return {
    ...DEFAULT_GATE_POLICY,
    ...overrides,
    defectScore: { ...DEFAULT_GATE_POLICY.defectScore, ...overrides.defectScore },
    spc: { ...DEFAULT_GATE_POLICY.spc, ...overrides.spc },
    regression: { ...DEFAULT_GATE_POLICY.regression, ...overrides.regression },
    trend: { ...DEFAULT_GATE_POLICY.trend, ...overrides.trend },
    drift: { ...DEFAULT_GATE_POLICY.drift, ...overrides.drift },
    capability: { ...DEFAULT_GATE_POLICY.capability, ...overrides.capability },
    spcOptions: { ...DEFAULT_GATE_POLICY.spcOptions, ...overrides.spcOptions },
  };
}
