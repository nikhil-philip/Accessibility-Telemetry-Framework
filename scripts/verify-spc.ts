/**
 * Lightweight correctness verification for the SPC engine (src/spc/).
 * Not a formal test framework (the repo has none for pure-logic code
 * yet -- only Playwright, which is E2E-oriented) -- this constructs a
 * synthetic series designed to trigger each rule/detector in isolation
 * and asserts it does, then runs the engine against the real telemetry
 * history as an end-to-end sanity check. Run with:
 *
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/verify-spc.js
 *
 * (plain ts-node is not used here -- it's incompatible with the
 * TypeScript 7.x prerelease this repo's package.json pins)
 *
 * Tests 1-9 (WECO/Nelson rule matching) evaluate against a FIXED,
 * hand-chosen center line and sigma rather than recomputing them from the
 * constructed series. That's deliberate: computeControlChart() derives
 * center line/sigma from the *entire* series including whatever anomaly
 * is appended, so an anomaly big enough to trigger a rule also shifts the
 * very center line/sigma the rule is evaluated against -- self-reference
 * that makes precise test construction unnecessarily fragile. Rule
 * matching and control-chart calculation are two independent concerns;
 * testing rule matching against known-fixed statistics isolates it
 * cleanly. computeControlChart() itself is verified separately (test 0,
 * and end-to-end in tests 14-15).
 */
import { computeControlChart } from '../src/spc/controlChart';
import { evaluateWesternElectricRules } from '../src/spc/westernElectricRules';
import { evaluateNelsonRules } from '../src/spc/nelsonRules';
import { detectTrend } from '../src/spc/trendDetection';
import { detectRegressionSpike } from '../src/spc/regressionSpikeDetection';
import { detectDrift } from '../src/spc/driftDetection';
import { analyzeCapability } from '../src/spc/capabilityAnalysis';
import { computeSpcReport, loadTelemetryHistory, toSummary } from '../src/spc/spcEngine';
import { ControlChartResult, DataPoint } from '../src/spc/types';
import { TelemetryRecord } from '../src/telemetry/schema';

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

function toPoints(values: number[]): DataPoint[] {
  return values.map((value, i) => ({
    buildId: `synthetic-${i}`,
    commitSha: `sha-${i}`,
    timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
    value,
  }));
}

function stats(values: number[]): ControlChartResult {
  return computeControlChart(toPoints(values));
}

/** An irregular, bounded baseline (NOT alternating, NOT monotonic) so it doesn't accidentally satisfy a run-based rule by construction. */
function baseline(n: number, base: number, spread: number): number[] {
  return Array.from({ length: n }, (_, i) => base + Math.round(Math.sin(i * 1.37) * spread));
}

// Fixed reference statistics for tests 1-9 -- see the file header for why these are fixed, not derived.
const C = 20; // center line
const S = 2; // sigma

console.log('=== 0. Baseline sanity: an irregular stable series should trigger nothing ===');
{
  const values = baseline(30, 20, 2);
  const chart = stats(values);
  const weco = evaluateWesternElectricRules(values, chart.centerLine, chart.sigma);
  const nelson = evaluateNelsonRules(values, chart.centerLine, chart.sigma);
  check('WECO: no rule triggers', weco.every((r) => !r.triggered), weco.filter((r) => r.triggered));
  check('Nelson: no rule triggers', nelson.every((r) => !r.triggered), nelson.filter((r) => r.triggered));
}

console.log('\n=== 1. WECO/Nelson Rule 1: one point beyond 3-sigma ===');
{
  const values = [...baseline(20, C, 1), C + 3.5 * S];
  const weco = evaluateWesternElectricRules(values, C, S);
  const nelson = evaluateNelsonRules(values, C, S);
  check('WECO rule 1 triggers', weco[0]!.triggered && weco[0]!.triggeredAtIndex === values.length - 1);
  check('Nelson rule 1 triggers', nelson[0]!.triggered && nelson[0]!.triggeredAtIndex === values.length - 1);
}

console.log('\n=== 2. WECO Rule 2 / Nelson Rule 5: 2 of 3 beyond 2-sigma, same side ===');
{
  const values = [...baseline(20, C, 1), C + 2.3 * S, C, C + 2.3 * S];
  const weco = evaluateWesternElectricRules(values, C, S);
  const nelson = evaluateNelsonRules(values, C, S);
  check('WECO rule 2 triggers', weco[1]!.triggered, weco[1]);
  check('Nelson rule 5 triggers', nelson[4]!.triggered, nelson[4]);
}

console.log('\n=== 3. WECO Rule 3 / Nelson Rule 6: 4 of 5 beyond 1-sigma, same side ===');
{
  const values = [...baseline(20, C, 1), C + 1.3 * S, C + 1.3 * S, C, C + 1.3 * S, C + 1.3 * S];
  const weco = evaluateWesternElectricRules(values, C, S);
  const nelson = evaluateNelsonRules(values, C, S);
  check('WECO rule 3 triggers', weco[2]!.triggered, weco[2]);
  check('Nelson rule 6 triggers', nelson[5]!.triggered, nelson[5]);
}

console.log('\n=== 4. WECO Rule 4: 8 consecutive points same side of center line ===');
{
  const values = [...baseline(20, C, 1), ...Array(8).fill(C + 1)];
  const weco = evaluateWesternElectricRules(values, C, S);
  check('WECO rule 4 triggers', weco[3]!.triggered, weco[3]);
}

console.log('\n=== 5. Nelson Rule 2: 9 consecutive points same side of center line ===');
{
  const values = [...baseline(20, C, 1), ...Array(9).fill(C + 1)];
  const nelson = evaluateNelsonRules(values, C, S);
  check('Nelson rule 2 triggers', nelson[1]!.triggered, nelson[1]);
}

console.log('\n=== 6. Nelson Rule 3: 6 consecutive strictly trending ===');
{
  const values = [...baseline(20, C, 1), C + 1, C + 3, C + 5, C + 7, C + 9, C + 11];
  const nelson = evaluateNelsonRules(values, C, S);
  check('Nelson rule 3 triggers (upward)', nelson[2]!.triggered, nelson[2]);
}

console.log('\n=== 7. Nelson Rule 4: 14 consecutive alternating up/down ===');
{
  const alternating = Array.from({ length: 14 }, (_, i) => C + (i % 2 === 0 ? 3 : -3));
  const values = [...baseline(10, C, 1), ...alternating];
  const nelson = evaluateNelsonRules(values, C, S);
  check('Nelson rule 4 triggers', nelson[3]!.triggered, nelson[3]);
}

console.log('\n=== 8. Nelson Rule 7: 15 consecutive within 1-sigma (stratification) ===');
{
  const tiny = S * 0.1;
  const tight = Array.from({ length: 15 }, (_, i) => C + (i % 2 === 0 ? tiny : -tiny));
  const values = [...baseline(20, C, 1), ...tight];
  const nelson = evaluateNelsonRules(values, C, S);
  check('Nelson rule 7 triggers', nelson[6]!.triggered, nelson[6]);
}

console.log('\n=== 9. Nelson Rule 8: 8 consecutive beyond 1-sigma, either side (mixture) ===');
{
  const mixture = Array.from({ length: 8 }, (_, i) => C + (i % 2 === 0 ? 2 * S : -2 * S));
  const values = [...baseline(20, C, 1), ...mixture];
  const nelson = evaluateNelsonRules(values, C, S);
  check('Nelson rule 8 triggers', nelson[7]!.triggered, nelson[7]);
}

console.log('\n=== 10. Trend detection: noisy-but-real upward trend (not strictly monotonic) ===');
{
  const values = [10, 12, 11, 14, 16, 15, 18, 20, 19, 22];
  const trend = detectTrend(values);
  check('slope is positive', trend.slope > 0, trend.slope);
  check('regression-based signal fires even though not strictly monotonic', trend.regressionSignificant, trend);
  check('overall detected = true, direction = WORSENING', trend.detected && trend.direction === 'WORSENING');
}
{
  const values = baseline(15, 20, 2);
  const trend = detectTrend(values);
  check('no trend on a flat/noisy series', !trend.detected, trend);
}

console.log('\n=== 11. Regression spike detection ===');
{
  const values = [...baseline(20, 20, 2), 90]; // sudden large worsening jump
  const chart = stats(values);
  const spike = detectRegressionSpike(values, chart.movingRanges, chart.uclMr);
  check('spike detected on a sudden worsening jump', spike.detected, spike);
  check('percentChange is positive', (spike.percentChange ?? 0) > 0);
}
{
  const values = [...baseline(20, 90, 2), 20]; // sudden large IMPROVEMENT
  const chart = stats(values);
  const spike = detectRegressionSpike(values, chart.movingRanges, chart.uclMr);
  check('a large IMPROVEMENT is not flagged as a regression spike', !spike.detected, spike);
}

console.log('\n=== 12. Process drift detection (CUSUM) ===');
{
  // Establish center line/sigma from a stable REFERENCE period only (15
  // points) -- standard SPC practice ("historical/reference limits"): once
  // a process is characterized, new data is monitored against that frozen
  // baseline rather than continuously recomputed limits that the drift
  // itself would also pull along. A sustained +1.2-sigma shift (relative
  // to that frozen baseline) for 15 more points should accumulate past h.
  const referencePeriod = baseline(15, 20, 2);
  const referenceChart = stats(referencePeriod);
  const shiftedPeriod = baseline(15, 20 + referenceChart.sigma * 1.2, 2);
  const values = [...referencePeriod, ...shiftedPeriod];

  const drift = detectDrift(values, referenceChart.centerLine, referenceChart.sigma);
  check('CUSUM accumulates and crosses h on a sustained shift', drift.detected, {
    cPlusTail: drift.cPlus.slice(-5).map((v) => Number(v.toFixed(2))),
    h: Number(drift.h.toFixed(2)),
  });
  check('drift direction reported as WORSENING', drift.direction === 'WORSENING');
}
{
  const values = baseline(20, 20, 2);
  const chart = stats(values);
  const drift = detectDrift(values, chart.centerLine, chart.sigma);
  check('no drift on a flat/noisy series', !drift.detected, drift);
}

console.log('\n=== 13. Process capability (Cpk/Cpu) ===');
{
  const values = baseline(20, 20, 2);
  const chart = stats(values);
  const roomy = analyzeCapability(chart.centerLine, chart.sigma, 100);
  const tight = analyzeCapability(chart.centerLine, chart.sigma, 21);
  check('a distant USL is reported capable', roomy.capable === true, roomy);
  check('a near USL is reported not capable', tight.capable === false, tight);
}

function toTelemetryRecord(buildId: string, value: number, dayOffset: number): TelemetryRecord {
  return {
    buildId,
    commitSha: `sha-${buildId}`,
    branch: 'main',
    triggeredBy: 'manual',
    timestamp: new Date(2026, 0, 1 + dayOffset).toISOString(),
    wcagLevel: 'AA',
    pagesScanned: 8,
    violationsBySeverity: { critical: 0, serious: 0, moderate: 0, minor: value },
    violationsByRule: [],
    defectScore: value,
    totalNodesFailed: value,
  };
}

console.log('\n=== 14. End-to-end: computeSpcReport() flags a regression at the point it happens ===');
{
  // A realistic mature-process scenario: 10 builds stable around 26
  // (ShopSmart's real, verified Build 3 state -- see docs/violations/
  // catalog.md), then one build spikes to 35 (the real, verified Build 4
  // regression magnitude). Unlike replaying ShopSmart's full 5-build
  // history verbatim (which includes a much larger, noisier initial
  // remediation arc that legitimately widens the control limits enough to
  // absorb a +9 jump -- itself a correct, worth-knowing SPC lesson, not a
  // bug), this isolates the specific "stable, then regresses" shape the
  // regression-spike detector is designed to catch.
  const stableBuilds = baseline(10, 26, 1).map((v, i) => toTelemetryRecord(`stable-${i}`, v, i));
  const regressedBuild = toTelemetryRecord('regressed', 35, 10);
  const report = computeSpcReport([...stableBuilds, regressedBuild]);
  console.log('  Summary:', toSummary(report));
  check('regressionDetected is true at the point of regression', report.regressionDetected);
  check('stabilityStatus is REGRESSED', report.stabilityStatus === 'REGRESSED');
}
{
  // The same 5-point ShopSmart arc as literal history -- included to show
  // (and document) the control-limit-widening effect above, not to assert
  // a spike is found. This is intentionally an assertion about *why* it's
  // not flagged, so the behavior stays understood rather than silently
  // relied upon.
  const history = [71, 43, 26, 35, 6];
  const records = history.map((v, i) => toTelemetryRecord(`build-${i + 1}`, v, i));
  const report = computeSpcReport(records);
  console.log('  Full-history summary (for comparison):', toSummary(report));
  check(
    "full noisy history: Build 4's +9 jump is absorbed by wide limits from the earlier remediation swings (documented behavior, not a defect)",
    report.chart.uclMr > 35,
    { uclMr: report.chart.uclMr },
  );
}

console.log('\n=== 15. Real telemetry/history/ data (informational -- too few points for most rules) ===');
{
  const records = loadTelemetryHistory();
  console.log(`  Loaded ${records.length} real telemetry record(s).`);
  if (records.length >= 2) {
    const report = computeSpcReport(records);
    console.log('  Summary:', toSummary(report));
    console.log(
      `  X-bar=${report.chart.centerLine.toFixed(2)} MR-bar=${report.chart.mrBar.toFixed(2)} sigma=${report.chart.sigma.toFixed(2)} ` +
        `UCL_X=${report.chart.uclX.toFixed(2)} LCL_X=${report.chart.lclX.toFixed(2)}`,
    );
  } else {
    console.log('  Fewer than 2 records on disk -- INSUFFICIENT_DATA is the statistically correct outcome, not a bug.');
  }
}

console.log('\n=== 16. Known special-cause exclusion (specialCauseClassifications.ts) ===');
{
  // The specified ShopSmart scenario: 4 baseline-eligible builds (22, 22,
  // 22, 32) plus the deliberately-seeded worst-case build (defectScore
  // 427, commit a8169fce...) that specialCauseClassifications.ts
  // explicitly classifies as SPECIAL_CAUSE_HISTORICAL. Chronological order
  // matters for MR-bar.
  const SPECIAL_CAUSE_SHA = 'a8169fceefcc8356403a1ac1c0dcc549fc9903f9';
  function pt(buildId: string, commitSha: string, value: number, dayOffset: number): DataPoint {
    return { buildId, commitSha, timestamp: new Date(2026, 0, 1 + dayOffset).toISOString(), value };
  }
  const points: DataPoint[] = [
    pt('b1', 'sha-1', 22, 0),
    pt('b2', SPECIAL_CAUSE_SHA, 427, 1),
    pt('b3', 'sha-3', 22, 2),
    pt('b4', 'sha-4', 22, 3),
    pt('b5', 'sha-5', 32, 4),
  ];
  const chart = computeControlChart(points);

  check('the special-cause record is annotated on the returned individuals', chart.individuals[1]!.specialCause === 'SPECIAL_CAUSE_HISTORICAL', chart.individuals[1]);
  check('all 5 records remain present in individuals -- nothing removed from history', chart.individuals.length === 5, chart.individuals.length);
  check('the 427 value itself is unchanged/still present', chart.individuals[1]!.value === 427);

  check('center line excludes the special cause: mean(22,22,22,32) = 24.50', Math.abs(chart.centerLine - 24.5) < 0.01, chart.centerLine);
  check('MR-bar excludes the special cause: mean(0,0,10) = 3.33', Math.abs(chart.mrBar - 3.3333) < 0.01, chart.mrBar);
  check('UCL_X is approximately 33.37', Math.abs(chart.uclX - 33.37) < 0.01, chart.uclX);
  check('LCL_X is approximately 15.63', Math.abs(chart.lclX - 15.63) < 0.01, chart.lclX);
}
{
  // A hypothetical build with an extreme, but UNCLASSIFIED, defect score
  // must NOT be auto-excluded -- exclusion happens only for a commitSha
  // explicitly listed in specialCauseClassifications.ts. Compared directly
  // against the naive/unfiltered I-MR formula.
  const points: DataPoint[] = [22, 22, 22, 900].map((value, i) => ({
    buildId: `unclassified-${i}`,
    commitSha: `sha-unclassified-${i}`,
    timestamp: new Date(2026, 1, 1 + i).toISOString(),
    value,
  }));
  const chart = computeControlChart(points);
  const naiveMean = (22 + 22 + 22 + 900) / 4;

  check('an unclassified outlier (900) is NOT excluded -- center line reflects it', Math.abs(chart.centerLine - naiveMean) < 0.001, chart.centerLine);
  check('an unclassified outlier is NOT excluded -- MR-bar reflects the big jump', chart.mrBar > 100, chart.mrBar);
}
{
  // Real telemetry/history/ data: confirms the exclusion mechanism is
  // wired into the actual production loader/engine, not just a fixture.
  // telemetry/history/ is real, append-only production data (ARCHITECTURE.md
  // -- a real CI run, or a fresh accessibility scan after a fix, legitimately
  // adds a new build over time; see scripts/verify-dashboard.ts's
  // ORIGINAL_BASELINE_COMMIT_SHAS for the same append-only reasoning), so
  // this independently HAND-COMPUTES the expected X-bar/MR-bar/UCL/LCL from
  // whatever's actually on disk right now (excluding the one known
  // special-cause commit) instead of asserting a number frozen to a
  // specific historical record count -- a literal count/value here would
  // break every time a build is legitimately added, which is not a
  // regression in computeControlChart() itself.
  const SPECIAL_CAUSE_SHA = 'a8169fceefcc8356403a1ac1c0dcc549fc9903f9';
  const records = loadTelemetryHistory();
  const report = computeSpcReport(records);
  const specialCausePoint = report.chart.individuals.find((p) => p.commitSha === SPECIAL_CAUSE_SHA);

  check('the real 427 build is present in telemetry history and on the chart', !!specialCausePoint && specialCausePoint.value === 427, specialCausePoint);
  check('it is annotated as SPECIAL_CAUSE_HISTORICAL', specialCausePoint?.specialCause === 'SPECIAL_CAUSE_HISTORICAL', specialCausePoint);

  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const eligible = sorted.filter((r) => r.commitSha !== SPECIAL_CAUSE_SHA).map((r) => r.defectScore);
  const expectedCenterLine = eligible.reduce((s, v) => s + v, 0) / eligible.length;
  const eligibleMovingRanges: number[] = [];
  for (let i = 1; i < eligible.length; i++) eligibleMovingRanges.push(Math.abs(eligible[i]! - eligible[i - 1]!));
  const expectedMrBar = eligibleMovingRanges.reduce((s, v) => s + v, 0) / eligibleMovingRanges.length;
  const expectedUclX = expectedCenterLine + (3 / 1.128) * expectedMrBar;
  const expectedLclX = Math.max(0, expectedCenterLine - (3 / 1.128) * expectedMrBar);

  check(
    `real data control limits exclude the special cause: X-bar = ${expectedCenterLine.toFixed(2)}, MR-bar = ${expectedMrBar.toFixed(2)} (hand-computed from ${eligible.length} currently-eligible on-disk records)`,
    Math.abs(report.chart.centerLine - expectedCenterLine) < 0.01 && Math.abs(report.chart.mrBar - expectedMrBar) < 0.01,
    { actual: { centerLine: report.chart.centerLine, mrBar: report.chart.mrBar }, expected: { centerLine: expectedCenterLine, mrBar: expectedMrBar } },
  );
  check(
    `real data control limits: UCL_X ~= ${expectedUclX.toFixed(2)}, LCL_X ~= ${expectedLclX.toFixed(2)}`,
    Math.abs(report.chart.uclX - expectedUclX) < 0.01 && Math.abs(report.chart.lclX - expectedLclX) < 0.01,
    { actual: { uclX: report.chart.uclX, lclX: report.chart.lclX }, expected: { uclX: expectedUclX, lclX: expectedLclX } },
  );
}

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
