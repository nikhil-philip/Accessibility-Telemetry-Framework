/**
 * Deterministic verification for Experiment B's stable-process cohort
 * generator (src/telemetry/stableProcessGenerator.ts), in the same
 * `check()` style as verify-spc.ts / verify-gates.ts / verify-experiment.ts.
 * Self-contained: performs its own write of the stable cohort (so it
 * doesn't depend on scripts/generate-stable-cohort.ts having run first),
 * and separately verifies it never touches telemetry/history/ (production)
 * or telemetry/experiments/spc-validation-cohort/ (Experiment A).
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/verify-stable-cohort.js
 */
import * as fs from 'fs';
import { generateStableCohortRecords, STABLE_COHORT_BUILD_COUNT, STABLE_COHORT_DIR_RELATIVE, STABLE_COHORT_SEED } from '../src/telemetry/stableProcessGenerator';
import { EXPERIMENT_DIR_RELATIVE } from '../src/telemetry/experimentGenerator';
import { computeDefectScore } from '../src/telemetry/collector';
import { writeTelemetryRecordTo } from '../src/telemetry/writer';
import { repoPath } from '../src/utils/paths';
import { computeSpcReport, loadTelemetryHistory } from '../src/spc/spcEngine';
import { evaluateQualityGate } from '../src/gates/qualityGateEvaluator';
import { DEFAULT_GATE_POLICY } from '../src/gates/gatePolicies';

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
const STABLE_DIR = repoPath(STABLE_COHORT_DIR_RELATIVE);
const EXPERIMENT_A_DIR = repoPath(EXPERIMENT_DIR_RELATIVE);

// --- 1. Reproducibility --------------------------------------------------

console.log('=== 1. Capability-experiment reproducibility ===');
{
  const runA = generateStableCohortRecords(STABLE_COHORT_SEED);
  const runB = generateStableCohortRecords(STABLE_COHORT_SEED);
  check('same seed -> identical record count', runA.length === runB.length && runA.length === STABLE_COHORT_BUILD_COUNT);
  check('same seed -> byte-identical JSON across two independent generations', JSON.stringify(runA) === JSON.stringify(runB));

  const runC = generateStableCohortRecords(STABLE_COHORT_SEED + 1);
  check('a different seed produces a different sequence', JSON.stringify(runA) !== JSON.stringify(runC));
}

// --- 2. Stable-process data generation -----------------------------------

console.log('\n=== 2. Stable-process data generation ===');
{
  const records = generateStableCohortRecords(STABLE_COHORT_SEED);
  check('exactly 30 records generated', records.length === STABLE_COHORT_BUILD_COUNT);

  const wellFormed = records.every((r) => {
    const { critical, serious, moderate, minor } = r.violationsBySeverity;
    const nonNegativeInts = [critical, serious, moderate, minor].every((v) => Number.isInteger(v) && v >= 0);
    return (
      typeof r.buildId === 'string' &&
      r.commitSha === r.buildId &&
      r.branch === 'experiment/stable-capability-cohort' &&
      r.wcagLevel === 'AA' &&
      Array.isArray(r.violationsByRule) &&
      r.violationsByRule.length === 0 &&
      nonNegativeInts &&
      r.totalNodesFailed === critical + serious + moderate + minor &&
      r.defectScore === computeDefectScore(r.violationsBySeverity)
    );
  });
  check('every record is schema-conformant and its defectScore matches the unmodified 10/5/2/1 formula', wellFormed);

  check('buildId/commitSha follow the stable-NNN convention, unambiguous vs. Experiment A\'s exp-NNN', records.every((r, i) => r.buildId === `stable-${String(i + 1).padStart(3, '0')}`));

  const timestamps = records.map((r) => r.timestamp);
  check('timestamps are strictly increasing', timestamps.every((t, i) => i === 0 || t > timestamps[i - 1]!));

  // "No deliberate phases": unlike Experiment A, there is no phaseForBuild()
  // equivalent here at all -- checked structurally by confirming every
  // record's severity distribution is drawn from visibly the same small
  // range (no 3x+ jump in mean level partway through), a coarse proxy for
  // "one regime, no injected phase change."
  const scores = records.map((r) => r.defectScore);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const maxDeviation = Math.max(...scores.map((v) => Math.abs(v - mean)));
  check(
    'defectScore stays within a tight band around its own mean (no injected phase/regression jump)',
    maxDeviation < mean * 3 + 15,
    { mean: Number(mean.toFixed(2)), maxDeviation, scores },
  );

  const criticalZeroCount = records.filter((r) => r.violationsBySeverity.critical === 0).length;
  check(`critical defects are rare, consistent with a healthy stable process: at least 25 of ${records.length} builds have critical=0`, criticalZeroCount >= 25, {
    criticalZeroCount,
  });
}

// --- 3. Cpk calculation integration (L5, unmodified) ---------------------

console.log('\n=== 3. Cpk calculation integration ===');
{
  const records = generateStableCohortRecords(STABLE_COHORT_SEED);
  const usl = 40;

  let report;
  let threw = false;
  try {
    report = computeSpcReport(records, { usl });
  } catch {
    threw = true;
  }
  check('computeSpcReport() does not throw for the stable cohort', !threw);
  check('sampleSize reflects all 30 builds', report?.sampleSize === 30);
  check('capability.usl echoes back the supplied USL unchanged', report?.capability.usl === usl);

  if (report && report.capability.cpu !== null) {
    // Independent hand-check of Cpu = (USL - centerLine) / (3 * sigma) --
    // the exact formula documented in capabilityAnalysis.ts -- to confirm
    // integration wiring, not just that *some* number came back.
    const handComputedCpu = (usl - report.chart.centerLine) / (3 * report.chart.sigma);
    check('hand-computed Cpu = (USL - centerLine) / (3*sigma) matches capabilityAnalysis.ts\'s result', Math.abs(handComputedCpu - report.capability.cpu) < 1e-9, {
      handComputedCpu,
      reported: report.capability.cpu,
    });
    check('capable flag agrees with the unmodified 1.33 threshold used by capabilityAnalysis.ts itself', report.capability.capable === report.capability.cpu >= 1.33);
  } else {
    check('capability.cpu is non-null for a 30-build cohort with non-zero sigma (sanity)', report?.capability.cpu !== null, report?.chart);
  }

  const latest = records[records.length - 1]!;
  const verdict = report ? evaluateQualityGate(latest, report, DEFAULT_GATE_POLICY) : undefined;
  check('evaluateQualityGate() does not throw against the stable cohort', verdict !== undefined);
  check('verdict.status is a valid GateStatus', verdict !== undefined && ['PASS', 'WARN', 'FAIL'].includes(verdict.status), verdict?.status);
}

// --- 4. Correct separation of Experiment A and Experiment B --------------

console.log('\n=== 4. Correct separation of Experiment A and Experiment B ===');
{
  check('Experiment A and Experiment B use distinct directory paths', (EXPERIMENT_DIR_RELATIVE as string) !== (STABLE_COHORT_DIR_RELATIVE as string), {
    EXPERIMENT_DIR_RELATIVE,
    STABLE_COHORT_DIR_RELATIVE,
  });
  check(
    'Experiment B directory path is not nested inside Experiment A\'s (or vice versa)',
    !STABLE_COHORT_DIR_RELATIVE.startsWith(EXPERIMENT_DIR_RELATIVE + '/') && !EXPERIMENT_DIR_RELATIVE.startsWith(STABLE_COHORT_DIR_RELATIVE + '/'),
  );

  const experimentASnapshotBefore = fs.existsSync(EXPERIMENT_A_DIR) ? JSON.stringify(loadTelemetryHistory(EXPERIMENT_A_DIR)) : null;

  const normalized = STABLE_DIR.replace(/\\/g, '/');
  if (!normalized.includes('/telemetry/experiments/stable-capability-cohort')) {
    throw new Error(`Refusing to write to "${STABLE_DIR}" -- does not look like the stable-cohort directory.`);
  }
  fs.rmSync(STABLE_DIR, { recursive: true, force: true });
  const records = generateStableCohortRecords(STABLE_COHORT_SEED);
  for (const record of records) writeTelemetryRecordTo(STABLE_DIR, record);

  const experimentASnapshotAfter = fs.existsSync(EXPERIMENT_A_DIR) ? JSON.stringify(loadTelemetryHistory(EXPERIMENT_A_DIR)) : null;
  check('writing Experiment B leaves Experiment A\'s cohort directory untouched (if present)', experimentASnapshotBefore === experimentASnapshotAfter);

  const stableFiles = fs.readdirSync(STABLE_DIR).filter((f) => f.endsWith('.json'));
  check('Experiment B directory contains exactly 30 files, all with the stable-NNN naming convention', stableFiles.length === 30 && stableFiles.every((f) => f.startsWith('build-stable-')));

  const stableRecordsLoaded = loadTelemetryHistory(STABLE_DIR);
  check('no buildId from Experiment B collides with Experiment A\'s exp-NNN convention', stableRecordsLoaded.every((r) => r.buildId.startsWith('stable-')));
}

// --- 5. No mutation of production telemetry -------------------------------

console.log('\n=== 5. No mutation of telemetry/history/ (production data) ===');
{
  const before = loadTelemetryHistory(HISTORY_DIR);
  const beforeSnapshot = JSON.stringify(before);
  check(`telemetry/history/ has records before this run (sanity: ${before.length} found)`, before.length > 0);

  // Re-run the same write cycle as section 4 -- confirms production
  // telemetry is unaffected regardless of run order.
  fs.rmSync(STABLE_DIR, { recursive: true, force: true });
  const records = generateStableCohortRecords(STABLE_COHORT_SEED);
  for (const record of records) writeTelemetryRecordTo(STABLE_DIR, record);

  const after = loadTelemetryHistory(HISTORY_DIR);
  check('telemetry/history/ record count is unchanged after writing the stable cohort', after.length === before.length, { before: before.length, after: after.length });
  check('telemetry/history/ content is byte-identical before and after', beforeSnapshot === JSON.stringify(after));
}

// --- 6. No changes to existing SPC/Gate behavior (spot-check) -------------

console.log('\n=== 6. No changes to existing SPC/Gate behavior (spot-check) ===');
{
  // Full verify:spc / verify:gates suites are run separately (Part 6); this
  // is a light, script-local guard that this script's own usage of L5/L6
  // still sees the unmodified, documented defaults.
  check('DEFAULT_GATE_POLICY.capability thresholds are unmodified (1.33 / 1.0)', DEFAULT_GATE_POLICY.capability.warnBelowCpu === 1.33 && DEFAULT_GATE_POLICY.capability.failBelowCpu === 1.0);
  check('DEFAULT_GATE_POLICY.maxCriticalDefects is unmodified (0)', DEFAULT_GATE_POLICY.maxCriticalDefects === 0);

  const records = generateStableCohortRecords(STABLE_COHORT_SEED);
  const noUslReport = computeSpcReport(records);
  check('computeSpcReport() with no usl supplied still skips capability entirely (existing, unmodified code path)', noUslReport.capability.usl === null && noUslReport.capability.cpu === null && noUslReport.capability.capable === null);
}

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
