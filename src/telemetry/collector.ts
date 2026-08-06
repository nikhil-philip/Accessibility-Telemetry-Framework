import { PageAxeResult, Severity, TelemetryRecord, ViolationByRule, ViolationsBySeverity } from './schema';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

interface CollectorInput {
  buildId: string;
  commitSha: string;
  branch: string;
  triggeredBy: TelemetryRecord['triggeredBy'];
  wcagLevel: TelemetryRecord['wcagLevel'];
  pageResults: PageAxeResult[];
}

/**
 * Raw axe-core output -> a schema-conformant TelemetryRecord. This is pure
 * data transformation (no I/O, no Playwright API) so it's trivial to unit
 * test in isolation from a live browser.
 */
export function collectTelemetry(input: CollectorInput): TelemetryRecord {
  const violationsBySeverity: ViolationsBySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byRule = new Map<string, ViolationByRule>();

  for (const pageResult of input.pageResults) {
    for (const violation of pageResult.violations) {
      const occurrences = violation.nodes.length;
      const impact = (violation.impact ?? 'minor') as Severity;

      if (impact in violationsBySeverity) {
        violationsBySeverity[impact] += occurrences;
      }

      const existing = byRule.get(violation.id);
      // axe tags follow its own scheme (e.g. "wcag143"), not dotted SC
      // numbers -- kept as-is rather than guessed at with a fragile regex.
      const wcagCriteria = violation.tags.filter((tag) => tag.startsWith('wcag'));

      if (existing) {
        existing.occurrences += occurrences;
        if (!existing.pages.includes(pageResult.page)) existing.pages.push(pageResult.page);
      } else {
        byRule.set(violation.id, {
          ruleId: violation.id,
          impact: violation.impact,
          wcagCriteria,
          occurrences,
          pages: [pageResult.page],
        });
      }
    }
  }

  const totalNodesFailed =
    violationsBySeverity.critical + violationsBySeverity.serious + violationsBySeverity.moderate + violationsBySeverity.minor;

  const defectScore =
    violationsBySeverity.critical * SEVERITY_WEIGHT.critical +
    violationsBySeverity.serious * SEVERITY_WEIGHT.serious +
    violationsBySeverity.moderate * SEVERITY_WEIGHT.moderate +
    violationsBySeverity.minor * SEVERITY_WEIGHT.minor;

  return {
    buildId: input.buildId,
    commitSha: input.commitSha,
    branch: input.branch,
    triggeredBy: input.triggeredBy,
    timestamp: new Date().toISOString(),
    wcagLevel: input.wcagLevel,
    pagesScanned: input.pageResults.length,
    violationsBySeverity,
    violationsByRule: Array.from(byRule.values()).sort((a, b) => b.occurrences - a.occurrences),
    defectScore,
    totalNodesFailed,
  };
}
