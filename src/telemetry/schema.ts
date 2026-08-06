/**
 * Verbatim from docs/architecture/ARCHITECTURE.md, Appendix A. This is the
 * single source of truth for a build's telemetry record -- both this
 * framework and (later) the SPC engine import this type, so a field never
 * drifts between "what the scanner produces" and "what the analytics layer
 * expects" without a compiler error.
 */
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export interface ViolationsBySeverity {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

export interface ViolationByRule {
  ruleId: string;
  impact: Severity | null;
  wcagCriteria: string[];
  occurrences: number;
  pages: string[];
}

export interface TelemetryRecord {
  buildId: string;
  commitSha: string;
  branch: string;
  triggeredBy: 'push' | 'pull_request' | 'schedule' | 'manual';
  timestamp: string;
  wcagLevel: 'A' | 'AA' | 'AAA';
  pagesScanned: number;
  violationsBySeverity: ViolationsBySeverity;
  violationsByRule: ViolationByRule[];
  /** Severity-weighted defect score per ARCHITECTURE.md §8.2: 10c + 5s + 2m + 1mi. */
  defectScore: number;
  totalNodesFailed: number;
}

/** One page's raw axe-core result, as attached to the test report by the axe fixture. */
export interface PageAxeResult {
  page: string;
  violations: RawAxeViolation[];
}

export interface RawAxeViolation {
  id: string;
  impact: Severity | null;
  tags: string[];
  nodes: { target: string[] }[];
}
