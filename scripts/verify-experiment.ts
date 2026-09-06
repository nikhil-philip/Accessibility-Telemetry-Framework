/**
 * Deterministic verification for the synthetic SPC validation cohort
 * generator (src/telemetry/experimentGenerator.ts), in the same `check()`
 * style as verify-spc.ts / verify-gates.ts. Self-contained: performs its
 * own write of the experiment cohort (so it doesn't depend on
 * scripts/generate-experiment.ts having been run first) but never writes
 * to, or reads for mutation, anything outside telemetry/experiments/
 * except telemetry/history/ -- which it only ever reads, to prove it was
 * left untouched.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/verify-experiment.js
 */
import * as fs from 'fs';
import {
  EXPERIMENT_BUILD_COUNT,
  EXPERIMENT_DIR_RELATIVE,
  EXPERIMENT_PHASES,
  EXPERIMENT_SEED,
  generateExperimentRecords,
  phaseForBuild,
} from '../src/telemetry/experimentGenerator';
import { computeDefectScore } from '../src/telemetry/collector';
import { writeTelemetryRecordTo } from '../src/telemetry/writer';
import { repoPath } from '../src/utils/paths';
import { computeSpcReport, loadTelemetryHistory } from '../src/spc/spcEngine';
import { evaluateQualityGate } from '../src/gates/qualityGateEvaluator';
import { runAnalysis, selectHistoryWindow, summarizeResults, rule1Triggered, DEFAULT_TRAILING_WINDOW_SIZE } from '../src/spc/experimentAnalysis';

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
const EXPERIMENT_DIR = repoPath(EXPERIMENT_DIR_RELATIVE);

// --- 1. Reproducibility --------------------------------------------------

console.log('=== 1. Reproducibility ===');
{
  const runA = generateExperimentRecords(EXPERIMENT_SEED);
  const runB = generateExperimentRecords(EXPERIMENT_SEED);
  check('same seed -> identical record count', runA.length === runB.length && runA.length === EXPERIMENT_BUILD_COUNT);
  check('same seed -> byte-identical JSON across two independent generations', JSON.stringify(runA) === JSON.stringify(runB));

  const runC = generateExperimentRecords(EXPERIMENT_SEED + 1);
  check('a different seed produces a different sequence (generator is not accidentally constant)', JSON.stringify(runA) !== JSON.stringify(runC));
}

// --- 2. Correct severity weighting ---------------------------------------

console.log('\n=== 2. Correct severity weighting (10/5/2/1, unmodified) ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);
  const allConsistent = records.every((r) => r.defectScore === computeDefectScore(r.violationsBySeverity));
  check('every record.defectScore matches computeDefectScore(violationsBySeverity)', allConsistent);

  // Independent hand-check against the literal 10/5/2/1 formula, on one
  // concrete record, so a bug inside computeDefectScore() itself (not just
  // a generator/computeDefectScore mismatch) would also be caught.
  const sample = records[0]!;
  const { critical, serious, moderate, minor } = sample.violationsBySeverity;
  const handComputed = critical * 10 + serious * 5 + moderate * 2 + minor * 1;
  check(`hand-computed 10/5/2/1 score matches record 1's defectScore (${sample.defectScore})`, handComputed === sample.defectScore, {
    critical, serious, moderate, minor, handComputed, actual: sample.defectScore,
  });
}

// --- 3. Schema validity ---------------------------------------------------

console.log('\n=== 3. Schema validity ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);
  check('exactly 30 records generated', records.length === 30);

  const wellFormed = records.every((r) => {
    const { critical, serious, moderate, minor } = r.violationsBySeverity;
    const nonNegativeInts = [critical, serious, moderate, minor].every((v) => Number.isInteger(v) && v >= 0);
    const totalMatches = r.totalNodesFailed === critical + serious + moderate + minor;
    return (
      typeof r.buildId === 'string' &&
      typeof r.commitSha === 'string' &&
      r.branch === 'experiment/spc-validation-cohort' &&
      r.triggeredBy === 'manual' &&
      r.wcagLevel === 'AA' &&
      Array.isArray(r.violationsByRule) &&
      r.violationsByRule.length === 0 &&
      nonNegativeInts &&
      totalMatches &&
      r.defectScore >= 0
    );
  });
  check('every record is schema-conformant (required fields, non-negative integer counts, totalNodesFailed sum)', wellFormed);

  const timestamps = records.map((r) => r.timestamp);
  const strictlyIncreasing = timestamps.every((t, i) => i === 0 || t > timestamps[i - 1]!);
  check('timestamps are strictly increasing build-over-build', strictlyIncreasing);

  const buildIdPattern = records.every((r, i) => r.buildId === `exp-${String(i + 1).padStart(3, '0')}` && r.commitSha === r.buildId);
  check('buildId/commitSha follow the deterministic exp-NNN convention, unambiguous vs. real git SHAs', buildIdPattern);
}

// --- 4. Correct phase assignment ------------------------------------------

console.log('\n=== 4. Correct phase assignment ===');
{
  const expectedRanges: Record<string, [number, number]> = { A: [1, 8], B: [9, 15], C: [16, 22], D: [23, 25], E: [26, 30] };
  check('EXPERIMENT_PHASES covers all 30 builds with no gaps/overlaps', EXPERIMENT_PHASES.every((p) => expectedRanges[p.phase]![0] === p.firstBuild && expectedRanges[p.phase]![1] === p.lastBuild));

  let allCorrect = true;
  for (let buildNumber = 1; buildNumber <= EXPERIMENT_BUILD_COUNT; buildNumber++) {
    const phase = phaseForBuild(buildNumber).phase;
    const expected = (Object.entries(expectedRanges).find(([, [lo, hi]]) => buildNumber >= lo && buildNumber <= hi) ?? [null])[0];
    if (phase !== expected) allCorrect = false;
  }
  check('phaseForBuild(n) returns the correct phase for every build 1..30', allCorrect);

  let threw = false;
  try {
    phaseForBuild(31);
  } catch {
    threw = true;
  }
  check('phaseForBuild() rejects an out-of-range build number rather than silently misclassifying it', threw);
}

// --- 5. No mutation of existing historical telemetry ----------------------

console.log('\n=== 5. No mutation of telemetry/history/ (production data) ===');
{
  const before = loadTelemetryHistory(HISTORY_DIR);
  const beforeSnapshot = JSON.stringify(before);
  check(`telemetry/history/ has records before this run (sanity: ${before.length} found)`, before.length > 0, before.length);

  // This script's own write cycle -- self-contained, targets ONLY the
  // experiment directory, guarded the same way generate-experiment.ts is.
  const normalized = EXPERIMENT_DIR.replace(/\\/g, '/');
  if (!normalized.includes('/telemetry/experiments/spc-validation-cohort')) {
    throw new Error(`Refusing to write to "${EXPERIMENT_DIR}" -- does not look like the experiment directory.`);
  }
  fs.rmSync(EXPERIMENT_DIR, { recursive: true, force: true });
  const records = generateExperimentRecords(EXPERIMENT_SEED);
  for (const record of records) writeTelemetryRecordTo(EXPERIMENT_DIR, record);

  const after = loadTelemetryHistory(HISTORY_DIR);
  const afterSnapshot = JSON.stringify(after);
  check('telemetry/history/ record count is unchanged after writing the experiment cohort', after.length === before.length, { before: before.length, after: after.length });
  check('telemetry/history/ content is byte-identical before and after (no mutation, no accidental co-mingling)', beforeSnapshot === afterSnapshot);

  const experimentFiles = fs.readdirSync(EXPERIMENT_DIR).filter((f) => f.endsWith('.json'));
  check('experiment directory contains exactly 30 files, separate from telemetry/history/', experimentFiles.length === 30, experimentFiles.length);
}

// --- 6. Compatibility with L5 (SPC engine) ---------------------------------

console.log('\n=== 6. Compatibility with L5 (SPC engine) ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);
  let report;
  let threw = false;
  try {
    report = computeSpcReport(records, { usl: 40 });
  } catch {
    threw = true;
  }
  check('computeSpcReport() does not throw over the full 30-build cohort', !threw);
  check('sampleSize reflects all 30 builds', report?.sampleSize === 30, report?.sampleSize);
  check(
    'processState is a valid enum value',
    report !== undefined && ['IN_CONTROL', 'OUT_OF_CONTROL', 'INSUFFICIENT_DATA'].includes(report.processState),
    report?.processState,
  );

  // Walk-forward robustness: every prefix length (including the
  // INSUFFICIENT_DATA boundary at n=1) must evaluate without throwing.
  let anyPrefixThrew = false;
  for (let i = 1; i <= records.length; i++) {
    try {
      computeSpcReport(records.slice(0, i), { usl: 40 });
    } catch {
      anyPrefixThrew = true;
    }
  }
  check('computeSpcReport() does not throw for any walk-forward prefix (n=1..30)', !anyPrefixThrew);
}

// --- 7. Compatibility with L6 (Quality Gate) -------------------------------

console.log('\n=== 7. Compatibility with L6 (Quality Gate) ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);
  const report = computeSpcReport(records, { usl: 40 });
  const latest = records[records.length - 1]!;

  let verdict;
  let threw = false;
  try {
    verdict = evaluateQualityGate(latest, report);
  } catch {
    threw = true;
  }
  check('evaluateQualityGate() does not throw against the generated cohort', !threw);
  check('verdict.status is a valid GateStatus', verdict !== undefined && ['PASS', 'WARN', 'FAIL'].includes(verdict.status), verdict?.status);
  check(
    'every reason is well-formed (ruleId string, severity WARN|FAIL, numeric actual/threshold)',
    verdict !== undefined &&
      verdict.reasons.every(
        (r) => typeof r.ruleId === 'string' && ['WARN', 'FAIL'].includes(r.severity) && typeof r.actual === 'number' && typeof r.threshold === 'number',
      ),
    verdict?.reasons,
  );

  let anyPrefixThrew = false;
  for (let i = 1; i <= records.length; i++) {
    try {
      const prefix = records.slice(0, i);
      const prefixReport = computeSpcReport(prefix, { usl: 40 });
      evaluateQualityGate(prefix[prefix.length - 1]!, prefixReport);
    } catch {
      anyPrefixThrew = true;
    }
  }
  check('evaluateQualityGate() does not throw for any walk-forward prefix (n=1..30)', !anyPrefixThrew);
}

// --- 8. Phase-distribution sanity (Part 1 revision) ------------------------

console.log('\n=== 8. Phase-distribution sanity (Part 1: revised severity targets) ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);
  const byPhase = (phase: string) => records.filter((_, i) => phaseForBuild(i + 1).phase === phase);
  const avgDefectScore = (rs: typeof records) => rs.reduce((s, r) => s + r.defectScore, 0) / rs.length;

  const phaseA = byPhase('A');
  const phaseC = byPhase('C');
  const phaseD = byPhase('D');
  const phaseE = byPhase('E');

  check('Phase A (poor/unstable) has a materially higher mean defectScore than Phase C (stable)', avgDefectScore(phaseA) > avgDefectScore(phaseC) + 15, {
    phaseA: avgDefectScore(phaseA),
    phaseC: avgDefectScore(phaseC),
  });

  const phaseCCriticalZeroCount = phaseC.filter((r) => r.violationsBySeverity.critical === 0).length;
  check(
    `Phase C critical defects are "normally zero": at least 5 of ${phaseC.length} Phase C builds have critical=0`,
    phaseCCriticalZeroCount >= 5,
    { phaseCCriticalZeroCount, phaseCCriticalCounts: phaseC.map((r) => r.violationsBySeverity.critical) },
  );

  check('Phase D (deliberate regression) has a measurably higher mean defectScore than Phase C', avgDefectScore(phaseD) > avgDefectScore(phaseC) + 20, {
    phaseD: avgDefectScore(phaseD),
    phaseC: avgDefectScore(phaseC),
  });

  // Recovery is expressed as a 5-build linear interpolation from Phase D's
  // level down to a near-Phase-C target (targetForBuild()'s 'E' case) --
  // early Phase E builds are expected to still carry an elevated critical
  // mean by design, so "normally zero" is checked at the tail of the
  // phase (where the interpolation has actually completed), not averaged
  // across the whole phase.
  const phaseETail = phaseE.slice(-2);
  const phaseETailCriticalZeroCount = phaseETail.filter((r) => r.violationsBySeverity.critical === 0).length;
  check('Phase E (recovery) critical defects have returned to zero by the last 2 builds', phaseETailCriticalZeroCount === phaseETail.length, {
    phaseECriticalCounts: phaseE.map((r) => r.violationsBySeverity.critical),
  });

  // "Gradual, not an artificial single-step reset" is a claim about the
  // underlying MEAN trajectory (a smooth 5-point linear interpolation, per
  // targetForBuild()), not about individual noisy samples -- per-build
  // Gaussian noise can and does make one particular build read unusually
  // low or high (that is exactly the "meaningful variation" the brief
  // also requires), so a strict per-step bound on sampled defectScore
  // would be testing noise, not mechanism. Checked instead as an overall
  // first-half vs. second-half trend, which tolerates individual outliers.
  const phaseEFirstHalfAvg = avgDefectScore(phaseE.slice(0, 2));
  const phaseESecondHalfAvg = avgDefectScore(phaseE.slice(-2));
  check('Phase E trends downward overall (first-half vs. second-half mean), consistent with gradual interpolation rather than a reset then plateau', phaseEFirstHalfAvg > phaseESecondHalfAvg, {
    phaseEFirstHalfAvg,
    phaseESecondHalfAvg,
    phaseEScores: phaseE.map((r) => r.defectScore),
  });
}

// --- 9. selectHistoryWindow() correctness (Part 3) --------------------------

console.log('\n=== 9. selectHistoryWindow() correctness ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);

  check('EXPANDING_HISTORY at build 20 returns all 20 records regardless of windowSize', selectHistoryWindow(records, 20, 'EXPANDING_HISTORY', 15).length === 20);
  check('EXPANDING_HISTORY at build 1 returns exactly 1 record', selectHistoryWindow(records, 1, 'EXPANDING_HISTORY', DEFAULT_TRAILING_WINDOW_SIZE).length === 1);

  check('TRAILING_WINDOW at build 10 (fewer than windowSize=15 exist) returns all 10 available records', selectHistoryWindow(records, 10, 'TRAILING_WINDOW', 15).length === 10);
  const w20 = selectHistoryWindow(records, 20, 'TRAILING_WINDOW', 15);
  check('TRAILING_WINDOW at build 20 (windowSize=15) returns exactly 15 records', w20.length === 15);
  check('TRAILING_WINDOW at build 20 excludes builds 1-4 and includes builds 6-20', w20[0]!.buildId === 'exp-006' && w20[w20.length - 1]!.buildId === 'exp-020');

  check('EXPANDING_HISTORY and TRAILING_WINDOW agree while fewer than windowSize builds exist (build 10)', JSON.stringify(selectHistoryWindow(records, 10, 'EXPANDING_HISTORY', 15)) === JSON.stringify(selectHistoryWindow(records, 10, 'TRAILING_WINDOW', 15)));
  check('EXPANDING_HISTORY and TRAILING_WINDOW diverge once windowSize is exceeded (build 20)', selectHistoryWindow(records, 20, 'EXPANDING_HISTORY', 15).length !== selectHistoryWindow(records, 20, 'TRAILING_WINDOW', 15).length);

  let threw = false;
  try {
    selectHistoryWindow(records, 31, 'EXPANDING_HISTORY', DEFAULT_TRAILING_WINDOW_SIZE);
  } catch {
    threw = true;
  }
  check('selectHistoryWindow() rejects an out-of-range buildNumber', threw);
}

// --- 10. runAnalysis() / summarizeResults() compatibility with L5+L6 -------

console.log('\n=== 10. Comparative analysis (runAnalysis/summarizeResults) compatibility ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);

  let expandingResults: ReturnType<typeof runAnalysis> = [];
  let trailingResults: ReturnType<typeof runAnalysis> = [];
  let threw = false;
  try {
    expandingResults = runAnalysis(records, 'EXPANDING_HISTORY', { spcOptions: { usl: 40 } });
    trailingResults = runAnalysis(records, 'TRAILING_WINDOW', { windowSize: DEFAULT_TRAILING_WINDOW_SIZE, spcOptions: { usl: 40 } });
  } catch {
    threw = true;
  }
  check('runAnalysis() does not throw for either method over the full cohort', !threw);
  check('runAnalysis() produces exactly one result per build, for both methods', expandingResults.length === 30 && trailingResults.length === 30);
  check('every EXPANDING_HISTORY result is tagged with its method', expandingResults.every((r) => r.method === 'EXPANDING_HISTORY'));
  check('every TRAILING_WINDOW result is tagged with its method', trailingResults.every((r) => r.method === 'TRAILING_WINDOW'));
  check(
    'TRAILING_WINDOW windowLength never exceeds windowSize=15',
    trailingResults.every((r) => r.windowLength <= DEFAULT_TRAILING_WINDOW_SIZE),
    trailingResults.map((r) => r.windowLength),
  );
  check(
    'every result carries a well-formed GateVerdict',
    [...expandingResults, ...trailingResults].every((r) => ['PASS', 'WARN', 'FAIL'].includes(r.gateVerdict.status)),
  );

  const expandingSummary = summarizeResults(expandingResults);
  const trailingSummary = summarizeResults(trailingResults);
  check('summarizeResults() PASS+WARN+FAIL counts sum to 30, for both methods', expandingSummary.passCount + expandingSummary.warnCount + expandingSummary.failCount === 30 && trailingSummary.passCount + trailingSummary.warnCount + trailingSummary.failCount === 30);
  check('summarizeResults() tags each summary with the correct method', expandingSummary.method === 'EXPANDING_HISTORY' && trailingSummary.method === 'TRAILING_WINDOW');
  check('the two methods are never silently mixed: their summaries are independent objects', expandingSummary !== (trailingSummary as unknown));

  check(
    'rule1Triggered() agrees with the underlying westernElectric rule-1 RuleEvaluation directly',
    expandingResults.every((r) => rule1Triggered(r.spcReport) === (r.spcReport.westernElectric.find((rule) => rule.rule === 1)?.triggered ?? false)),
  );

  check(
    'EXPANDING_HISTORY and TRAILING_WINDOW report the identical SPC state for build 5 (fewer than windowSize=15 builds exist yet)',
    expandingResults[4]!.spcReport.processState === trailingResults[4]!.spcReport.processState,
  );
}

// --- 11. Cpk is excluded from Experiment A (Part 1) ------------------------

console.log('\n=== 11. Cpk excluded from Experiment A (no usl supplied -> capability is a no-op everywhere) ===');
{
  const records = generateExperimentRecords(EXPERIMENT_SEED);
  // Deliberately no spcOptions -- this is scripts/generate-experiment.ts's
  // actual production configuration for Experiment A as of Part 1.
  const expandingResults = runAnalysis(records, 'EXPANDING_HISTORY');
  const trailingResults = runAnalysis(records, 'TRAILING_WINDOW', { windowSize: DEFAULT_TRAILING_WINDOW_SIZE });

  check(
    'capability.usl is null for every build, both methods (the existing, unmodified "usl undefined" code path)',
    [...expandingResults, ...trailingResults].every((r) => r.spcReport.capability.usl === null && r.spcReport.capability.cpu === null && r.spcReport.capability.capable === null),
  );
  check(
    'CPK_CAPABILITY never appears among the gate reasons for any build, either method',
    [...expandingResults, ...trailingResults].every((r) => !r.gateVerdict.reasons.some((reason) => reason.ruleId === 'CPK_CAPABILITY')),
  );
}

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
