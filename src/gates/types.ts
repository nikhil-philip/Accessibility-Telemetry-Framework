/**
 * Shared types for the Quality Gate Engine (ARCHITECTURE.md Layer 6).
 * Deliberately imports SPC types rather than redeclaring them -- the gate
 * engine consumes an already-computed SpcReport (src/spc/spcEngine.ts) and
 * never recomputes control limits, sigma, CUSUM, or Cpk itself.
 */
import { ProcessState, RuleSetName, SpcEngineOptions, StabilityStatus } from '../spc/types';

export type GateStatus = 'PASS' | 'WARN' | 'FAIL';

/** A GateReason only ever carries a contributing (non-passing) severity -- a check that passes emits no reason. */
export type GateReasonSeverity = 'WARN' | 'FAIL';

export interface GateReason {
  ruleId: string;
  severity: GateReasonSeverity;
  message: string;
  actual: number;
  threshold: number;
}

/** The Quality Gate Engine's entry-point output: exactly one overall status plus the machine-readable reasons behind it. */
export interface GateVerdict {
  status: GateStatus;
  reasons: GateReason[];
  buildId: string;
  commitSha: string;
  generatedAt: string;
  defectScore: number;
  spcProcessState: ProcessState;
  spcStabilityStatus: StabilityStatus;
}

/** WARN/FAIL thresholds for the weighted defect score (TelemetryRecord.defectScore -- see collector.ts). */
export interface WeightedScorePolicy {
  /** score >= warnAt (and < failAt) => WARN. */
  warnAt: number;
  /** score >= failAt => FAIL. */
  failAt: number;
}

/** Identifies one specific WECO/Nelson rule (see src/spc/types.ts RuleEvaluation). */
export interface SpcGateRuleRef {
  ruleSet: RuleSetName;
  rule: number;
}

export interface SpcStabilityPolicy {
  /** Whether the latest point falling outside [lclX, uclX] (SpcReport.uclViolation) is a FAIL. */
  failOnUclViolation: boolean;
  /** Specific WECO/Nelson rules that FAIL the build when triggered. */
  failRules: SpcGateRuleRef[];
  /** Whether any OTHER triggered rule (not in failRules) is reported as a WARN. */
  warnOnOtherTriggeredRules: boolean;
}

export type SignalPolicy = 'IGNORE' | 'WARN' | 'FAIL';

export interface DirectionalSignalPolicy {
  onDetected: SignalPolicy;
  /** When true, a signal in the IMPROVING direction is not reported -- only WORSENING triggers the configured policy. */
  onlyWorsening: boolean;
}

export interface CapabilityPolicy {
  /** cpu < warnBelowCpu (and >= failBelowCpu) => WARN. */
  warnBelowCpu: number;
  /** cpu < failBelowCpu => FAIL. */
  failBelowCpu: number;
}

/**
 * The full, declarative Quality Gate policy. Every threshold is data, not
 * code (ARCHITECTURE.md Layer 6's stated responsibility), so a policy
 * change never requires touching qualityGateEvaluator.ts.
 */
export interface GatePolicyConfig {
  /** critical defect count > maxCriticalDefects => FAIL. Default 0 (ARCHITECTURE.md: "Critical > 0 => FAIL"). */
  maxCriticalDefects: number;
  /** serious defect count > maxSeriousDefects => FAIL. */
  maxSeriousDefects: number;
  defectScore: WeightedScorePolicy;
  spc: SpcStabilityPolicy;
  regression: { onDetected: SignalPolicy };
  trend: DirectionalSignalPolicy;
  drift: DirectionalSignalPolicy;
  capability: CapabilityPolicy;
  /** Passed straight through to computeSpcReport() -- e.g. `usl` for capability, trend correlation tuning. */
  spcOptions?: SpcEngineOptions;
}
