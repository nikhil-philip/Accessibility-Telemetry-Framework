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

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
