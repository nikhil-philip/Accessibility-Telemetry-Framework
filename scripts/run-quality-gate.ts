/**
 * L1 CI ADAPTER for the Quality Gate Engine (ARCHITECTURE.md Layer 1 -> 6).
 *
 * This script contains no gate policy and no SPC math. It only:
 *  1. Calls the existing, unmodified evaluateFromDisk() (src/gates/
 *     qualityGateEvaluator.ts) -- reads telemetry/history/ exactly as it
 *     stands on disk at the time this runs (in CI, that includes the build
 *     record the accessibility test step just wrote) and returns a
 *     GateVerdict.
 *  2. Calls formatGateVerdictForCi() (src/gates/ciAdapter.ts) to turn that
 *     verdict into an exit code + annotations + summary -- also pure, also
 *     unmodified gate logic.
 *  3. Does CI-adapter I/O: writes the verdict as a regenerable artifact,
 *     prints GitHub Actions annotations, writes the job step summary and
 *     step output, and exits with the mapped code.
 *
 * Conceptually: existing evaluator -> GateVerdict -> CI adapter -> exit code.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/run-quality-gate.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { evaluateFromDisk } from '../src/gates/qualityGateEvaluator';
import { formatGateVerdictForCi } from '../src/gates/ciAdapter';
import { repoPath } from '../src/utils/paths';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('QualityGateCI');

const AGGREGATED_DIR = repoPath('telemetry/aggregated');
const VERDICT_PATH = path.join(AGGREGATED_DIR, 'gate-verdict.json');

function appendToGithubFile(envVar: string, content: string): void {
  const target = process.env[envVar];
  if (!target) return; // not running under GitHub Actions (e.g. local `npm run gate:ci`) -- silently a no-op.
  fs.appendFileSync(target, content);
}

function emitAnnotation(level: 'error' | 'warning' | 'notice', message: string): void {
  // GitHub Actions workflow-command syntax -- renders as an inline annotation on the PR/run.
  // Falls back to a plain log line locally, where these commands mean nothing.
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::${level}::${message}`);
  } else {
    logger.info(`[${level}] ${message}`);
  }
}

function main(): void {
  console.log('=== L1 CI ADAPTER: Quality Gate ===\n');

  const verdict = evaluateFromDisk();
  const report = formatGateVerdictForCi(verdict);

  fs.mkdirSync(AGGREGATED_DIR, { recursive: true });
  fs.writeFileSync(VERDICT_PATH, JSON.stringify(verdict, null, 2) + '\n');
  logger.info(`Wrote ${VERDICT_PATH}`);

  console.log(`\nGate verdict: ${verdict.status} (build ${verdict.buildId}, commit ${verdict.commitSha})`);
  for (const reason of verdict.reasons) {
    console.log(`  ${reason.severity}  ${reason.ruleId}: ${reason.message}`);
  }
  if (verdict.reasons.length === 0) {
    console.log('  (no reasons triggered)');
  }
  console.log('');

  for (const annotation of report.annotations) {
    emitAnnotation(annotation.level, annotation.message);
  }

  appendToGithubFile('GITHUB_STEP_SUMMARY', report.summaryMarkdown + '\n');
  appendToGithubFile('GITHUB_OUTPUT', `status=${verdict.status}\n`);

  if (report.exitCode === 0) {
    console.log(`Quality Gate: ${verdict.status} -- CI continues.`);
  } else {
    console.error(`Quality Gate: ${verdict.status} -- blocking the build.`);
  }

  process.exit(report.exitCode);
}

main();
