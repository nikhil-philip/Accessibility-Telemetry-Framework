/**
 * Local verification for L1 (CI/CD Orchestration), in the same `check()`
 * style as verify-spc.ts / verify-gates.ts / verify-dashboard.ts. GitHub
 * Actions itself can't be exercised locally, so this script covers what
 * can be: the CI adapter's pure PASS/WARN/FAIL -> exit-code mapping
 * (src/gates/ciAdapter.ts), and static validation of
 * .github/workflows/accessibility-ci.yml -- does it parse, does every
 * `npm run X` it invokes exist in package.json, does every script file
 * those commands resolve to exist on disk, and is it free of the
 * failure-hiding anti-patterns (`|| true`, `continue-on-error: true`)
 * the project's CI design principles rule out.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/verify-ci.js
 */
import * as fs from 'fs';
import { parse as parseYaml } from 'yaml';
import { formatGateVerdictForCi } from '../src/gates/ciAdapter';
import { GateVerdict } from '../src/gates/types';
import { repoPath } from '../src/utils/paths';
import pkg from '../package.json';

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}`, detail ?? '');
  }
}

// --- Fixtures --------------------------------------------------------------

function mkVerdict(overrides: Partial<GateVerdict> = {}): GateVerdict {
  return {
    status: 'PASS',
    reasons: [],
    buildId: 'b1',
    commitSha: 'sha1',
    generatedAt: new Date().toISOString(),
    defectScore: 10,
    spcProcessState: 'IN_CONTROL',
    spcStabilityStatus: 'STABLE',
    ...overrides,
  };
}

// --- 1. CI adapter: PASS/WARN/FAIL -> exit code, deterministic fixtures ----

console.log('=== 1. formatGateVerdictForCi(): PASS/WARN/FAIL -> exit code ===');
{
  const pass = formatGateVerdictForCi(mkVerdict({ status: 'PASS', reasons: [] }));
  check('PASS -> exitCode 0', pass.exitCode === 0, pass);
  check('PASS with no reasons -> a single notice annotation', pass.annotations.length === 1 && pass.annotations[0]!.level === 'notice', pass.annotations);
}
{
  const warnVerdict = mkVerdict({
    status: 'WARN',
    reasons: [{ ruleId: 'TREND_DETECTED', severity: 'WARN', message: 'worsening trend', actual: 1, threshold: 0 }],
  });
  const warn = formatGateVerdictForCi(warnVerdict);
  check('WARN -> exitCode 0 (WARN must never fail CI)', warn.exitCode === 0, warn);
  check('WARN reason -> "warning" annotation level, not "error"', warn.annotations.length === 1 && warn.annotations[0]!.level === 'warning', warn.annotations);
}
{
  const failVerdict = mkVerdict({
    status: 'FAIL',
    reasons: [{ ruleId: 'CRITICAL_DEFECTS', severity: 'FAIL', message: '1 critical defect', actual: 1, threshold: 0 }],
  });
  const fail = formatGateVerdictForCi(failVerdict);
  check('FAIL -> exitCode 1', fail.exitCode === 1, fail);
  check('FAIL reason -> "error" annotation level', fail.annotations.length === 1 && fail.annotations[0]!.level === 'error', fail.annotations);
}
{
  // Mixed reasons: a FAIL verdict can still carry WARN-severity reasons alongside its FAIL reason(s).
  const mixed = mkVerdict({
    status: 'FAIL',
    reasons: [
      { ruleId: 'CRITICAL_DEFECTS', severity: 'FAIL', message: 'x', actual: 1, threshold: 0 },
      { ruleId: 'TREND_DETECTED', severity: 'WARN', message: 'y', actual: 1, threshold: 0 },
    ],
  });
  const report = formatGateVerdictForCi(mixed);
  check('mixed FAIL+WARN reasons -> exitCode still 1 (FAIL dominates)', report.exitCode === 1);
  check(
    'each reason maps to its own annotation level independently',
    report.annotations.find((a) => a.message.includes('CRITICAL_DEFECTS'))?.level === 'error' &&
      report.annotations.find((a) => a.message.includes('TREND_DETECTED'))?.level === 'warning',
    report.annotations,
  );
}
{
  const verdict = mkVerdict({ status: 'PASS', buildId: 'b42', commitSha: 'deadbeef', defectScore: 7 });
  const report = formatGateVerdictForCi(verdict);
  check('summaryMarkdown carries the build id, commit, and defect score through', report.summaryMarkdown.includes('b42') && report.summaryMarkdown.includes('deadbeef') && report.summaryMarkdown.includes('7'), report.summaryMarkdown);
}

// --- 2. Workflow file exists and parses as valid YAML ----------------------

console.log('\n=== 2. .github/workflows/accessibility-ci.yml exists and parses ===');
const WORKFLOW_PATH = repoPath('.github/workflows/accessibility-ci.yml');
let workflow: any = undefined;
{
  const exists = fs.existsSync(WORKFLOW_PATH);
  check('workflow file exists', exists, WORKFLOW_PATH);

  if (exists) {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    let parseError: unknown = null;
    try {
      workflow = parseYaml(raw);
    } catch (err) {
      parseError = err;
    }
    check('workflow file parses as valid YAML', workflow !== undefined && parseError === null, parseError);
    check('workflow has a top-level "jobs" section', !!workflow?.jobs, workflow);
    // The YAML parser reads the `on:` key as the boolean `true` (YAML 1.1
    // treats bare `on` as a boolean literal) -- both spellings are checked.
    check('workflow has a top-level trigger ("on") section', !!(workflow?.on ?? workflow?.true), workflow);
  }
}

// --- 3. Every `npm run <script>` the workflow invokes exists in package.json

console.log('\n=== 3. Every "npm run <script>" referenced in the workflow exists in package.json ===');
{
  const rawWorkflow = fs.existsSync(WORKFLOW_PATH) ? fs.readFileSync(WORKFLOW_PATH, 'utf-8') : '';
  const npmRunPattern = /npm run ([a-zA-Z0-9:_-]+)/g;
  const referenced = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = npmRunPattern.exec(rawWorkflow)) !== null) {
    referenced.add(match[1]!);
  }

  check('at least one "npm run" command was found in the workflow', referenced.size > 0, [...referenced]);

  const knownScripts = new Set(Object.keys((pkg as { scripts: Record<string, string> }).scripts));
  for (const scriptName of referenced) {
    check(`"npm run ${scriptName}" is a real package.json script`, knownScripts.has(scriptName));
  }

  // The inverse: the CI-specific scripts this L1 layer adds must actually be wired up and invoked.
  check('workflow invokes the Quality Gate CI adapter ("gate:ci")', referenced.has('gate:ci'));
  check('workflow invokes the accessibility scan ("test:a11y")', referenced.has('test:a11y'));
  check('workflow invokes dashboard generation ("generate:dashboard")', referenced.has('generate:dashboard'));
}

// --- 4. Every dist-ts script those npm scripts resolve to has a real .ts source

console.log('\n=== 4. Every scripts/*.ts source file behind an invoked npm script exists ===');
{
  const scripts = (pkg as { scripts: Record<string, string> }).scripts;
  const distPattern = /dist-ts\/scripts\/([a-zA-Z0-9_-]+)\.js/;

  for (const [name, command] of Object.entries(scripts)) {
    const m = distPattern.exec(command);
    if (!m) continue; // not a tsc-then-run script (e.g. plain `playwright test ...`) -- nothing to resolve.
    const sourceFile = repoPath('scripts', `${m[1]}.ts`);
    check(`"${name}" -> scripts/${m[1]}.ts exists`, fs.existsSync(sourceFile), sourceFile);
  }
}

// --- 5. New L1 source files exist (the adapter this layer actually adds) ---

console.log('\n=== 5. L1 adapter files exist ===');
{
  check('src/gates/ciAdapter.ts exists', fs.existsSync(repoPath('src/gates/ciAdapter.ts')));
  check('scripts/run-quality-gate.ts exists', fs.existsSync(repoPath('scripts/run-quality-gate.ts')));
}

// --- 6. No failure-hiding anti-patterns in the workflow --------------------

console.log('\n=== 6. Workflow does not hide failures ===');
{
  const rawWorkflow = fs.existsSync(WORKFLOW_PATH) ? fs.readFileSync(WORKFLOW_PATH, 'utf-8') : '';
  check('no "|| true" anywhere in the workflow', !rawWorkflow.includes('|| true'));
  check('no "continue-on-error: true" anywhere in the workflow', !/continue-on-error:\s*true/.test(rawWorkflow));
}

// --- 7. Structural gate-exit-code sanity (the step CI actually depends on) -

console.log('\n=== 7. The Quality Gate step is structured to actually block the job on FAIL ===');
{
  const job = workflow?.jobs?.['accessibility-quality-gate'];
  const steps: any[] = job?.steps ?? [];
  const gateStepIndex = steps.findIndex((s) => s?.id === 'gate');

  check('a step with id "gate" exists', gateStepIndex !== -1, steps.map((s) => s?.id ?? s?.name));

  if (gateStepIndex !== -1) {
    const gateStep = steps[gateStepIndex];
    check('the "gate" step has no continue-on-error (its exit code must reach the job)', gateStep['continue-on-error'] === undefined, gateStep);

    // Every step after "gate" must run despite an earlier FAIL -- either
    // unconditionally (always()) or specifically on failure (failure(),
    // e.g. an on-failure-only traces upload). Anything else (plain,
    // condition-less) would be silently skipped once the gate step fails.
    const afterGate = steps.slice(gateStepIndex + 1);
    check(
      'every step after "gate" runs despite a FAIL (if: always() or if: failure())',
      afterGate.length > 0 && afterGate.every((s) => s?.if === 'always()' || s?.if === 'failure()'),
      afterGate.map((s) => ({ name: s?.name, if: s?.if })),
    );
  }
}

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
