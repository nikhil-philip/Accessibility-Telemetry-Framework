/**
 * Verification for the L7 Dashboard's data layer (src/dashboard/), in the
 * same `check()` style as verify-spc.ts / verify-gates.ts /
 * verify-experiment.ts / verify-stable-cohort.ts.
 *
 * What this checks:
 *  1. buildDashboardData() never mutates telemetry/history/ or
 *     telemetry/experiments/ (read-only presentation layer).
 *  2. Every number in DashboardData is byte-identical to calling the real
 *     L4/L5/L6/experiment-analysis functions directly -- i.e. the builder
 *     performs no computation of its own, only orchestration.
 *  3. The known, previously-validated results (Experiment A's PASS/WARN/FAIL
 *     counts, Experiment B's Cpu) still hold through the dashboard's data
 *     path -- a regression guard tying this layer back to the project's
 *     already-recorded findings. Experiment A/B are frozen, fixed-size
 *     research cohorts, so asserting their exact size/statistics is a
 *     genuine invariant. Production telemetry/history/ is append-only by
 *     design (ARCHITECTURE.md) -- a real CI run legitimately adds new
 *     records -- so its regression guard instead asserts the original 4
 *     baseline builds (by commit SHA) are still present and the count has
 *     never shrunk below 4, not that the count is fixed at 4.
 *  4. scripts/generate-dashboard.ts's on-disk output (dashboard/, telemetry/aggregated/)
 *     is well-formed and internally consistent.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/verify-dashboard.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildDashboardData, EXPERIMENT_B_USL } from '../src/dashboard/dashboardDataBuilder';
import { DashboardData } from '../src/dashboard/types';
import { loadTelemetryHistory, computeSpcReport } from '../src/spc/spcEngine';
import { evaluateLatestBuild } from '../src/gates/qualityGateEvaluator';
import { runAnalysis, summarizeResults } from '../src/spc/experimentAnalysis';
import { EXPERIMENT_DIR_RELATIVE } from '../src/telemetry/experimentGenerator';
import { STABLE_COHORT_DIR_RELATIVE } from '../src/telemetry/stableProcessGenerator';
import { repoPath } from '../src/utils/paths';

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

const HISTORY_DIR = repoPath('telemetry/history');

/**
 * The four production builds telemetry/history/ was seeded with (ShopSmart
 * Builds 1-5's worst/remediated states -- see docs/violations/). Unlike
 * Experiment A/B (frozen, fixed-size research cohorts -- their `=== 30`
 * checks below are genuine invariants), production telemetry/history/ is
 * append-only by design (ARCHITECTURE.md): a real CI run legitimately adds
 * a 5th, 6th, ... record. So the correct regression guard here is "the
 * original baseline is still present and un-mutated", not "there are
 * exactly 4 records" -- the latter would fail the very first time L1 CI
 * does its job.
 */
const ORIGINAL_BASELINE_COMMIT_SHAS = [
  '66a0c96c269e114d0a2f73eb203c4683baf00ea7',
  'a8169fceefcc8356403a1ac1c0dcc549fc9903f9',
  'b4f83d0ba34fcf5d751b1d461d6a25f8dfc507a4',
  'de20fcf2b2ef76cf2b3894dd3759eab883f54a94',
];
const EXPERIMENT_A_DIR = repoPath(EXPERIMENT_DIR_RELATIVE);
const STABLE_DIR = repoPath(STABLE_COHORT_DIR_RELATIVE);
const DASHBOARD_DIR = repoPath('dashboard');
const AGGREGATED_DIR = repoPath('telemetry/aggregated');

/** Strips fields that are expected to differ run-to-run (generatedAt timestamps) so two independently-built reports can be compared for equality. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, v) => (key === 'generatedAt' ? undefined : v));
}

// --- 1. No mutation of source-of-truth telemetry --------------------------

console.log('=== 1. buildDashboardData() never mutates telemetry/history/ or telemetry/experiments/ ===');
{
  const historyBefore = JSON.stringify(loadTelemetryHistory(HISTORY_DIR));
  const expABefore = JSON.stringify(loadTelemetryHistory(EXPERIMENT_A_DIR));
  const stableBefore = JSON.stringify(loadTelemetryHistory(STABLE_DIR));

  buildDashboardData();
  buildDashboardData(); // twice, to catch any accidental accumulation/side effect

  const historyAfter = JSON.stringify(loadTelemetryHistory(HISTORY_DIR));
  const expAAfter = JSON.stringify(loadTelemetryHistory(EXPERIMENT_A_DIR));
  const stableAfter = JSON.stringify(loadTelemetryHistory(STABLE_DIR));

  check('telemetry/history/ (production, 4 original records) is byte-identical after buildDashboardData()', historyBefore === historyAfter);
  check('telemetry/experiments/spc-validation-cohort/ is byte-identical after buildDashboardData()', expABefore === expAAfter);
  check('telemetry/experiments/stable-capability-cohort/ is byte-identical after buildDashboardData()', stableBefore === stableAfter);
}

// --- 2. Production section is a pure re-composition of L4/L5/L6 output ----

console.log('\n=== 2. Production section matches calling L4/L5/L6 directly (no recomputation) ===');
{
  const data = buildDashboardData();
  const expectedHistory = loadTelemetryHistory();
  const expectedSpc = computeSpcReport(expectedHistory);
  const expectedVerdict = evaluateLatestBuild(expectedHistory);

  check('production.history matches loadTelemetryHistory() exactly', JSON.stringify(data.production.history) === JSON.stringify(expectedHistory));
  check('production.spcReport matches computeSpcReport(history) exactly (modulo generatedAt)', stableJson(data.production.spcReport) === stableJson(expectedSpc));
  check('production.gateVerdict matches evaluateLatestBuild(history) exactly (modulo generatedAt)', stableJson(data.production.gateVerdict) === stableJson(expectedVerdict));
  // Append-only invariant (not a frozen-dataset invariant -- see
  // ORIGINAL_BASELINE_COMMIT_SHAS above): the baseline can only grow, and
  // every original record must still be identifiable by commit SHA,
  // however many newer builds now sit alongside it.
  check('production telemetry/history/ has at least the 4 original baseline records', data.production.history.length >= 4, data.production.history.length);
  const presentShas = new Set(data.production.history.map((r) => r.commitSha));
  const missingBaselineShas = ORIGINAL_BASELINE_COMMIT_SHAS.filter((sha) => !presentShas.has(sha));
  check('all 4 original baseline build SHAs are still present in production history', missingBaselineShas.length === 0, missingBaselineShas);
}

// --- 3. Experiment A section matches runAnalysis()/summarizeResults() directly ---

console.log('\n=== 3. Experiment A section matches calling experimentAnalysis.ts directly ===');
{
  const data = buildDashboardData();
  const records = loadTelemetryHistory(EXPERIMENT_A_DIR);
  const expectedExpanding = runAnalysis(records, 'EXPANDING_HISTORY');
  const expectedTrailing = runAnalysis(records, 'TRAILING_WINDOW');

  check('experimentA.expandingHistory.results matches runAnalysis(records, EXPANDING_HISTORY) exactly (modulo generatedAt)', stableJson(data.experimentA.expandingHistory.results) === stableJson(expectedExpanding));
  check('experimentA.trailingWindow.results matches runAnalysis(records, TRAILING_WINDOW) exactly (modulo generatedAt)', stableJson(data.experimentA.trailingWindow.results) === stableJson(expectedTrailing));
  check('experimentA.expandingHistory.summary matches summarizeResults() exactly', JSON.stringify(data.experimentA.expandingHistory.summary) === JSON.stringify(summarizeResults(expectedExpanding)));
  check('experimentA.trailingWindow.summary matches summarizeResults() exactly', JSON.stringify(data.experimentA.trailingWindow.summary) === JSON.stringify(summarizeResults(expectedTrailing)));

  // Regression guard: ties this layer back to the project's already-recorded, validated results.
  const es = data.experimentA.expandingHistory.summary;
  const ts = data.experimentA.trailingWindow.summary;
  check('EXPANDING_HISTORY summary matches the recorded validated result (1 PASS / 3 WARN / 26 FAIL)', es.passCount === 1 && es.warnCount === 3 && es.failCount === 26, es);
  check('TRAILING_WINDOW summary matches the recorded validated result (1 PASS / 5 WARN / 24 FAIL)', ts.passCount === 1 && ts.warnCount === 5 && ts.failCount === 24, ts);
  check('experimentA cohort has the required 30 builds', records.length === 30, records.length);
}

// --- 4. Experiment B section matches computeSpcReport({ usl }) directly ---

console.log('\n=== 4. Experiment B section matches calling computeSpcReport({ usl }) directly ===');
{
  const data = buildDashboardData();
  const records = loadTelemetryHistory(STABLE_DIR);
  const expectedSpc = computeSpcReport(records, { usl: EXPERIMENT_B_USL });

  check('experimentB.spcReport matches computeSpcReport(records, { usl }) exactly (modulo generatedAt)', stableJson(data.experimentB.spcReport) === stableJson(expectedSpc));
  check('experimentB.usl is 40 (matches scripts/verify-stable-cohort.ts\'s capability USL)', data.experimentB.usl === 40);
  check('experimentB cohort has the required 30 builds', records.length === 30, records.length);

  const cpu = data.experimentB.spcReport.capability.cpu;
  check('Experiment B Cpu matches the recorded validated result (~2.9811)', cpu !== null && Math.abs(cpu - 2.9811) < 0.001, cpu);
  check('Experiment B capable === true, matching the recorded validated result', data.experimentB.spcReport.capability.capable === true);
}

// --- 5. Dashboard data contract introduces no new score/statistic ---------

console.log('\n=== 5. Dashboard introduces no new severity weighting or second score ===');
{
  const data: DashboardData = buildDashboardData();
  const latest = data.production.history[data.production.history.length - 1]!;
  const { critical, serious, moderate, minor } = latest.violationsBySeverity;
  const expectedScore = 10 * critical + 5 * serious + 2 * moderate + 1 * minor;
  check('defectScore on the latest production build still equals 10c+5s+2m+1mi (the one authoritative formula)', latest.defectScore === expectedScore, { latest, expectedScore });
}

// --- 6. Generated static output is well-formed -----------------------------

console.log('\n=== 6. scripts/generate-dashboard.ts output (if present) is well-formed ===');
{
  if (!fs.existsSync(DASHBOARD_DIR)) {
    console.log('  SKIP  dashboard/ does not exist yet -- run `npm run generate:dashboard` first.');
  } else {
    const indexPath = path.join(DASHBOARD_DIR, 'index.html');
    const cssPath = path.join(DASHBOARD_DIR, 'assets', 'dashboard.css');
    const jsPath = path.join(DASHBOARD_DIR, 'assets', 'dashboard.js');
    const dataPath = path.join(DASHBOARD_DIR, 'data.json');

    check('dashboard/index.html exists', fs.existsSync(indexPath));
    check('dashboard/assets/dashboard.css exists', fs.existsSync(cssPath));
    check('dashboard/assets/dashboard.js exists', fs.existsSync(jsPath));
    check('dashboard/data.json exists', fs.existsSync(dataPath));

    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      let parsed: DashboardData | undefined;
      let parseError = false;
      try {
        parsed = JSON.parse(raw) as DashboardData;
      } catch {
        parseError = true;
      }
      check('dashboard/data.json parses as valid JSON', !parseError);
      check('dashboard/data.json has the DashboardData shape (production/experimentA/experimentB present)', !!parsed && !!parsed.production && !!parsed.experimentA && !!parsed.experimentB);

      if (fs.existsSync(AGGREGATED_DIR)) {
        const aggregatedPath = path.join(AGGREGATED_DIR, 'dashboard-data.json');
        if (fs.existsSync(aggregatedPath)) {
          const aggregatedRaw = fs.readFileSync(aggregatedPath, 'utf-8');
          check('dashboard/data.json is byte-identical to telemetry/aggregated/dashboard-data.json (same generation, two copies)', raw === aggregatedRaw);
        }
      }
    }

    const html = fs.readFileSync(indexPath, 'utf-8');
    check('index.html references assets/dashboard.css', html.includes('assets/dashboard.css'));
    check('index.html references assets/dashboard.js', html.includes('assets/dashboard.js'));
  }
}

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
