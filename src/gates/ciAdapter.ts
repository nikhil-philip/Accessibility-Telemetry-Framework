import { GateVerdict } from './types';

/**
 * Layer 1 (CI/CD Orchestration)'s only piece of gate-related logic: turning
 * an already-computed GateVerdict (src/gates/qualityGateEvaluator.ts, L6)
 * into what a CI runner needs -- an exit code, human-readable annotations,
 * and a step-summary block. This file computes no thresholds, re-derives no
 * PASS/WARN/FAIL decision, and reads no telemetry -- it is pure formatting
 * over a verdict that already exists by the time it's called.
 *
 * Kept pure (no fs, no process.*, no console.*) so it's trivially unit
 * testable (scripts/verify-ci.ts) without needing a real telemetry/history/
 * on disk or a real CI environment.
 */

export type CiAnnotationLevel = 'error' | 'warning' | 'notice';

export interface CiAnnotation {
  level: CiAnnotationLevel;
  message: string;
}

export interface CiGateReport {
  /** 0 for PASS/WARN, 1 for FAIL -- WARN must never fail the CI job (ARCHITECTURE.md SS8.5 / project policy). */
  exitCode: 0 | 1;
  annotations: CiAnnotation[];
  /** Markdown block suitable for $GITHUB_STEP_SUMMARY. */
  summaryMarkdown: string;
}

function annotationLevelFor(severity: 'WARN' | 'FAIL'): CiAnnotationLevel {
  return severity === 'FAIL' ? 'error' : 'warning';
}

/**
 * PASS -> exit 0, WARN -> exit 0, FAIL -> exit non-zero. Conceptually the
 * "CI adapter" step in: existing evaluator -> GateVerdict -> CI adapter ->
 * exit code.
 */
export function formatGateVerdictForCi(verdict: GateVerdict): CiGateReport {
  const exitCode: 0 | 1 = verdict.status === 'FAIL' ? 1 : 0;

  const annotations: CiAnnotation[] =
    verdict.reasons.length > 0
      ? verdict.reasons.map((reason) => ({
          level: annotationLevelFor(reason.severity),
          message: `[${reason.ruleId}] ${reason.message}`,
        }))
      : [{ level: 'notice', message: 'Quality Gate: no reasons triggered -- clean build.' }];

  const reasonLines =
    verdict.reasons.length > 0
      ? verdict.reasons.map((r) => `- **${r.severity}** \`${r.ruleId}\`: ${r.message}`).join('\n')
      : '_No gate reasons triggered._';

  const summaryMarkdown = [
    `### Quality Gate: ${verdict.status}`,
    '',
    `| Field | Value |`,
    `|---|---|`,
    `| Build | \`${verdict.buildId}\` |`,
    `| Commit | \`${verdict.commitSha}\` |`,
    `| Defect score | ${verdict.defectScore} |`,
    `| SPC process state | ${verdict.spcProcessState} |`,
    `| SPC stability status | ${verdict.spcStabilityStatus} |`,
    `| Generated at | ${verdict.generatedAt} |`,
    '',
    '**Reasons**',
    '',
    reasonLines,
  ].join('\n');

  return { exitCode, annotations, summaryMarkdown };
}
