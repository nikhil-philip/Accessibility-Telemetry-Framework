import { execFileSync } from 'child_process';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { PageAxeResult, TelemetryRecord } from './schema';
import { collectTelemetry } from './collector';
import { writeTelemetryRecord } from './writer';
import { WCAG_LEVEL } from '../config/axe.config';
import { createLogger } from '../utils/logger';

const logger = createLogger('TelemetryReporter');
const AXE_ATTACHMENT_NAME = 'axe-results';

// Some Windows shells (this project's dev environment included) don't have
// git on PATH for spawned child processes even though it's installed --
// fall back to the standard install locations rather than silently writing
// "unknown" into every telemetry record's commitSha.
const GIT_CANDIDATES = [
  'git',
  'C:\\Program Files\\Git\\bin\\git.exe',
  'C:\\Program Files\\Git\\cmd\\git.exe',
];

let resolvedGitBinary: string | null = null;

function resolveGitBinary(): string | null {
  if (resolvedGitBinary) return resolvedGitBinary;
  for (const candidate of GIT_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      resolvedGitBinary = candidate;
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function gitValue(args: string[], fallback: string): string {
  const gitBinary = resolveGitBinary();
  if (!gitBinary) return fallback;
  try {
    return execFileSync(gitBinary, args, { encoding: 'utf-8' }).trim();
  } catch {
    return fallback;
  }
}

function resolveBuildId(): string {
  return process.env.GITHUB_RUN_ID || process.env.BUILD_ID || `local-${Date.now()}`;
}

function resolveTriggeredBy(): TelemetryRecord['triggeredBy'] {
  if (!process.env.CI) return 'manual';
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') return 'pull_request';
  if (process.env.GITHUB_EVENT_NAME === 'schedule') return 'schedule';
  return 'push';
}

/**
 * Implements ARCHITECTURE.md's "AxeScanner -> Reporter -> Collector ->
 * Writer -> History" flow (Component Diagram, §3). A custom Playwright
 * Reporter -- rather than writing telemetry inline inside each spec -- is
 * what lets any new accessibility spec get telemetry for free: it only has
 * to attach its axe results; this reporter aggregates every test's
 * attachment in `onTestEnd` and persists exactly one TelemetryRecord for
 * the whole run in `onEnd`.
 */
export default class TelemetryReporter implements Reporter {
  private readonly pageResults: PageAxeResult[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== AXE_ATTACHMENT_NAME || !attachment.body) continue;
      try {
        const parsed = JSON.parse(attachment.body.toString('utf-8')) as PageAxeResult;
        this.pageResults.push(parsed);
      } catch (err) {
        logger.warn(`Failed to parse axe attachment for test "${test.title}"`, err);
      }
    }
  }

  onEnd(result: FullResult): void {
    if (this.pageResults.length === 0) {
      logger.info(`No accessibility scans recorded this run (status: ${result.status}) -- skipping telemetry write.`);
      return;
    }

    const record = collectTelemetry({
      buildId: resolveBuildId(),
      commitSha: gitValue(['rev-parse', 'HEAD'], 'unknown'),
      branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
      triggeredBy: resolveTriggeredBy(),
      wcagLevel: WCAG_LEVEL,
      pageResults: this.pageResults,
    });

    writeTelemetryRecord(record);
  }
}
