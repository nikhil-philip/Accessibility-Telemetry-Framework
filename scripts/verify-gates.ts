/**
 * Lightweight correctness verification for the Quality Gate Engine
 * (src/gates/), mirroring scripts/verify-spc.ts's approach: hand-built
 * fixtures plus a minimal `check()` assertion helper (the repo has no
 * formal test framework for pure-logic code). Run with:
 *
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/verify-gates.js
 *
 * Two fixture styles are used, deliberately:
 *  - Hand-built SpcReport objects (baseSpcReport + overrides) for testing
 *    ONE gate layer in isolation, with every other layer held inert. This
 *    is what makes checkTrend/checkDrift/checkCapability/etc. testable
 *    without needing a real multi-build history that happens to trigger
 *    exactly one signal.
 *  - Real computeSpcReport() output over a synthetic TelemetryRecord
 *    history (same pattern as verify-spc.ts's tests 14-15), for
 *    end-to-end checks that the gate composes correctly with the real L5
 *    engine and with telemetry/history/ on disk.
 */
import { evaluateQualityGate, evaluateLatestBuild, evaluateFromDisk } from '../src/gates/qualityGateEvaluator';
import { DEFAULT_GATE_POLICY, mergeGatePolicy } from '../src/gates/gatePolicies';
import { GatePolicyConfig, GateVerdict } from '../src/gates/types';
import { TelemetryRecord } from '../src/telemetry/schema';
import { ControlChartResult, SpcReport } from '../src/spc/types';
import { computeSpcReport, loadTelemetryHistory } from '../src/spc/spcEngine';

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

function hasReason(verdict: GateVerdict, ruleId: string): boolean {
  return verdict.reasons.some((r) => r.ruleId === ruleId);
}

function reasonSeverity(verdict: GateVerdict, ruleId: string): string | undefined {
  return verdict.reasons.find((r) => r.ruleId === ruleId)?.severity;
}

// --- Fixtures -----------------------------------------------------------

function mkRecord(opts: {
  buildId?: string;
  timestamp?: string;
  critical?: number;
  serious?: number;
  moderate?: number;
  minor?: number;
  defectScore: number;
}): TelemetryRecord {
  const critical = opts.critical ?? 0;
  const serious = opts.serious ?? 0;
  const moderate = opts.moderate ?? 0;
  const minor = opts.minor ?? 0;
  const buildId = opts.buildId ?? 'build-x';

  return {
    buildId,
    commitSha: `sha-${buildId}`,
    branch: 'main',
    triggeredBy: 'manual',
    timestamp: opts.timestamp ?? new Date().toISOString(),
    wcagLevel: 'AA',
    pagesScanned: 8,
    violationsBySeverity: { critical, serious, moderate, minor },
    violationsByRule: [],
    defectScore: opts.defectScore,
    totalNodesFailed: critical + serious + moderate + minor,
  };
}

const INERT_CHART: ControlChartResult = {
  individuals: [{ buildId: 'b', commitSha: 's', timestamp: new Date().toISOString(), value: 20 }],
  movingRanges: [2, 1, 2],
  centerLine: 20,
  mrBar: 2,
  sigma: 1.77,
  uclX: 25.32,
  lclX: 14.68,
  uclMr: 6.53,
  lclMr: 0,
};

/** A fully "quiet" SpcReport -- every detector inert -- so a single override exercises exactly one gate layer. */
function baseSpcReport(overrides: Partial<SpcReport> = {}): SpcReport {
  return {
    processState: 'IN_CONTROL',
    uclViolation: false,
    trendDetected: false,
    regressionDetected: false,
    stabilityStatus: 'STABLE',
    generatedAt: new Date().toISOString(),
    sampleSize: 10,
    chart: INERT_CHART,
    westernElectric: [],
    nelson: [],
    trend: { slope: 0, correlation: 0, direction: 'NONE', nelsonRule3Triggered: false, regressionSignificant: false, detected: false },
    regressionSpike: { detected: false, latestMovingRange: null, uclMr: 6.53, percentChange: null },
    drift: { cPlus: [0], cMinus: [0], k: 0.9, h: 8.85, detected: false, direction: 'NONE' },
    capability: { usl: null, cpu: null, capable: null },
    ...overrides,
  };
}

const CLEAN_RECORD = mkRecord({ buildId: 'clean', defectScore: 12 });
const QUIET_REPORT = baseSpcReport();

/** An irregular, bounded synthetic series (mirrors verify-spc.ts's `baseline`) for real computeSpcReport() end-to-end checks. */
function baselineRecords(n: number, base: number, spread: number, startId = 0): TelemetryRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const value = base + Math.round(Math.sin((startId + i) * 1.37) * spread);
    return mkRecord({ buildId: `b${startId + i}`, timestamp: new Date(2026, 0, 1, 0, startId + i).toISOString(), defectScore: value, minor: value });
  });
}

// --- 1. PASS ------------------------------------------------------------

console.log('=== 1. PASS: clean record, quiet SPC report, default policy ===');
{
  const verdict = evaluateQualityGate(CLEAN_RECORD, QUIET_REPORT);
  check('status is PASS', verdict.status === 'PASS', verdict);
  check('reasons is empty', verdict.reasons.length === 0, verdict.reasons);
  check('buildId/commitSha/defectScore carried through', verdict.buildId === 'clean' && verdict.defectScore === 12);
}

// --- 2. FAIL: critical defects -------------------------------------------

console.log('\n=== 2. FAIL: critical defects (rule 1) ===');
{
  const record = mkRecord({ buildId: 'crit', critical: 1, defectScore: 10 });
  const verdict = evaluateQualityGate(record, QUIET_REPORT);
  check('status is FAIL', verdict.status === 'FAIL', verdict);
  check('CRITICAL_DEFECTS reason present, severity FAIL', reasonSeverity(verdict, 'CRITICAL_DEFECTS') === 'FAIL');
  const reason = verdict.reasons.find((r) => r.ruleId === 'CRITICAL_DEFECTS')!;
  check('actual=1, threshold=0', reason.actual === 1 && reason.threshold === 0, reason);
}
{
  // Boundary: exactly 0 critical defects must not fail.
  const record = mkRecord({ buildId: 'crit0', critical: 0, defectScore: 10 });
  const verdict = evaluateQualityGate(record, QUIET_REPORT);
  check('boundary: 0 critical defects => PASS', verdict.status === 'PASS', verdict);
}

// --- 3. FAIL/boundary: serious defects (rule 2, configurable threshold) --

console.log('\n=== 3. Serious defects threshold (configurable) ===');
{
  const atThreshold = mkRecord({ buildId: 'serious-at', serious: DEFAULT_GATE_POLICY.maxSeriousDefects, defectScore: 10 });
  const overThreshold = mkRecord({ buildId: 'serious-over', serious: DEFAULT_GATE_POLICY.maxSeriousDefects + 1, defectScore: 10 });

  const atVerdict = evaluateQualityGate(atThreshold, QUIET_REPORT);
  const overVerdict = evaluateQualityGate(overThreshold, QUIET_REPORT);

  check('boundary: serious === threshold => PASS (not "above")', atVerdict.status === 'PASS', atVerdict);
  check('serious === threshold + 1 => FAIL', overVerdict.status === 'FAIL' && hasReason(overVerdict, 'SERIOUS_DEFECTS'), overVerdict);
}
{
  // Configuration change: tighten the threshold so a previously-passing build now fails.
  const record = mkRecord({ buildId: 'serious-cfg', serious: 2, defectScore: 10 });
  const defaultVerdict = evaluateQualityGate(record, QUIET_REPORT, DEFAULT_GATE_POLICY);
  const strictPolicy = mergeGatePolicy({ maxSeriousDefects: 1 });
  const strictVerdict = evaluateQualityGate(record, QUIET_REPORT, strictPolicy);

  check('serious=2 passes under default policy (max 5)', defaultVerdict.status === 'PASS', defaultVerdict);
  check('same record fails once policy is tightened to max 1', strictVerdict.status === 'FAIL' && hasReason(strictVerdict, 'SERIOUS_DEFECTS'), strictVerdict);
}

// --- 4. Weighted defect score (reuses TelemetryRecord.defectScore) ------

console.log('\n=== 4. Weighted defect score WARN/FAIL bands, with boundaries ===');
{
  const below = mkRecord({ buildId: 'score-below', defectScore: DEFAULT_GATE_POLICY.defectScore.warnAt - 1 });
  const atWarn = mkRecord({ buildId: 'score-warn', defectScore: DEFAULT_GATE_POLICY.defectScore.warnAt });
  const belowFail = mkRecord({ buildId: 'score-belowfail', defectScore: DEFAULT_GATE_POLICY.defectScore.failAt - 1 });
  const atFail = mkRecord({ buildId: 'score-fail', defectScore: DEFAULT_GATE_POLICY.defectScore.failAt });

  check('score = warnAt - 1 => PASS', evaluateQualityGate(below, QUIET_REPORT).status === 'PASS');
  const warnVerdict = evaluateQualityGate(atWarn, QUIET_REPORT);
  check('score = warnAt => WARN', warnVerdict.status === 'WARN' && reasonSeverity(warnVerdict, 'WEIGHTED_DEFECT_SCORE') === 'WARN', warnVerdict);
  const stillWarn = evaluateQualityGate(belowFail, QUIET_REPORT);
  check('score = failAt - 1 => still WARN, not FAIL', stillWarn.status === 'WARN', stillWarn);
  const failVerdict = evaluateQualityGate(atFail, QUIET_REPORT);
  check('score = failAt => FAIL', failVerdict.status === 'FAIL' && reasonSeverity(failVerdict, 'WEIGHTED_DEFECT_SCORE') === 'FAIL', failVerdict);
}

// --- 5. SPC UCL/LCL violation --------------------------------------------

console.log('\n=== 5. SPC process stability: UCL violation ===');
{
  const report = baseSpcReport({ uclViolation: true, processState: 'OUT_OF_CONTROL', stabilityStatus: 'OUT_OF_CONTROL' });
  const verdict = evaluateQualityGate(CLEAN_RECORD, report);
  check('UCL violation => FAIL', verdict.status === 'FAIL' && reasonSeverity(verdict, 'SPC_UCL_VIOLATION') === 'FAIL', verdict);

  const suppressed = mergeGatePolicy({ spc: { ...DEFAULT_GATE_POLICY.spc, failOnUclViolation: false } });
  const suppressedVerdict = evaluateQualityGate(CLEAN_RECORD, report, suppressed);
  check('failOnUclViolation=false suppresses the reason', !hasReason(suppressedVerdict, 'SPC_UCL_VIOLATION'), suppressedVerdict);
}

// --- 6. Lean SPC rule triggers (Nelson 1/2/3 only, latest-build scoped, directional) ---

console.log('\n=== 6. Lean SPC rule triggers: Nelson-only, culminatesAtLatest-scoped, directional ===');
{
  // Nelson rule 1, culminating at the latest build (index 9) => FAIL (default failRules).
  const report = baseSpcReport({
    nelson: [
      { ruleSet: 'NELSON', rule: 1, name: 'Beyond 3-sigma', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [9], culminatesAtLatest: true },
    ],
    westernElectric: [
      // Same underlying event, reported under WECO too -- must NOT also produce a reason (WECO is pruned from gate evaluation entirely).
      { ruleSet: 'WESTERN_ELECTRIC', rule: 1, name: 'Beyond 3-sigma', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [9], culminatesAtLatest: true },
    ],
  });
  const verdict = evaluateQualityGate(CLEAN_RECORD, report);
  check('default failRules: Nelson rule 1 triggered at latest => FAIL', reasonSeverity(verdict, 'SPC_RULE_NELSON_1') === 'FAIL', verdict);
  check('WECO rule 1 (pruned) never produces a reason, even though triggered', !hasReason(verdict, 'SPC_RULE_WESTERN_ELECTRIC_1'), verdict);
  check('overall status is FAIL', verdict.status === 'FAIL');
}
{
  // Nelson rule 2 (shift), worsening direction ('above'), culminating at latest => WARN by default.
  const report = baseSpcReport({
    nelson: [
      { ruleSet: 'NELSON', rule: 2, name: '9 consecutive same side', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [1, 2, 3, 4, 5, 6, 7, 8, 9], direction: 'above', culminatesAtLatest: true },
    ],
  });
  const verdict = evaluateQualityGate(CLEAN_RECORD, report);
  check('Nelson rule 2, worsening (above), culminating at latest => WARN by default', reasonSeverity(verdict, 'SPC_RULE_NELSON_2') === 'WARN', verdict);

  const noWarnPolicy = mergeGatePolicy({ spc: { ...DEFAULT_GATE_POLICY.spc, warnOnOtherTriggeredRules: false } });
  const noWarnVerdict = evaluateQualityGate(CLEAN_RECORD, report, noWarnPolicy);
  check('warnOnOtherTriggeredRules=false suppresses rule 2s WARN', !hasReason(noWarnVerdict, 'SPC_RULE_NELSON_2'), noWarnVerdict);
}
{
  // Nelson rule 2, but IMPROVING direction ('below') -- a genuinely improving run must remain PASS.
  const report = baseSpcReport({
    nelson: [
      { ruleSet: 'NELSON', rule: 2, name: '9 consecutive same side', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [1, 2, 3, 4, 5, 6, 7, 8, 9], direction: 'below', culminatesAtLatest: true },
    ],
  });
  const verdict = evaluateQualityGate(CLEAN_RECORD, report);
  check('Nelson rule 2, improving (below) => no reason, status PASS', !hasReason(verdict, 'SPC_RULE_NELSON_2') && verdict.status === 'PASS', verdict);
}
{
  // Nelson rule 3 (trend), worsening ('up') vs improving ('down'), both culminating at latest.
  const worsening = baseSpcReport({
    nelson: [{ ruleSet: 'NELSON', rule: 3, name: '6 consecutive trending', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [4, 5, 6, 7, 8, 9], direction: 'up', culminatesAtLatest: true }],
  });
  const improving = baseSpcReport({
    nelson: [{ ruleSet: 'NELSON', rule: 3, name: '6 consecutive trending', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [4, 5, 6, 7, 8, 9], direction: 'down', culminatesAtLatest: true }],
  });
  check('Nelson rule 3, worsening (up) => WARN by default', reasonSeverity(evaluateQualityGate(CLEAN_RECORD, worsening), 'SPC_RULE_NELSON_3') === 'WARN');
  check('Nelson rule 3, improving (down) => no reason, status PASS', !hasReason(evaluateQualityGate(CLEAN_RECORD, improving), 'SPC_RULE_NELSON_3') && evaluateQualityGate(CLEAN_RECORD, improving).status === 'PASS');
}
{
  // Recency scoping: a rule triggered somewhere in history but NOT culminating at the latest build must not gate the CURRENT build.
  const report = baseSpcReport({
    nelson: [
      { ruleSet: 'NELSON', rule: 1, name: 'Beyond 3-sigma', description: 'x', triggered: true, triggeredAtIndex: 3, involvedIndices: [3], culminatesAtLatest: false },
    ],
  });
  const verdict = evaluateQualityGate(CLEAN_RECORD, report);
  check('a historical (non-latest) Nelson rule 1 violation does not fail the current build', !hasReason(verdict, 'SPC_RULE_NELSON_1') && verdict.status === 'PASS', verdict);
}
{
  // Rule exclusion: Nelson rules 4 (alternation), 7 (stratification), 8 (mixture) never reach the gate, even triggered at latest.
  const report = baseSpcReport({
    nelson: [
      { ruleSet: 'NELSON', rule: 4, name: '14 consecutive alternating', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [], culminatesAtLatest: true },
      { ruleSet: 'NELSON', rule: 5, name: '2 of 3 beyond 2-sigma', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [], culminatesAtLatest: true },
      { ruleSet: 'NELSON', rule: 6, name: '4 of 5 beyond 1-sigma', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [], culminatesAtLatest: true },
      { ruleSet: 'NELSON', rule: 7, name: '15 consecutive within 1-sigma', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [], culminatesAtLatest: true },
      { ruleSet: 'NELSON', rule: 8, name: '8 consecutive beyond 1-sigma (either side)', description: 'x', triggered: true, triggeredAtIndex: 9, involvedIndices: [], culminatesAtLatest: true },
    ],
  });
  const verdict = evaluateQualityGate(CLEAN_RECORD, report);
  check('Nelson rules 4/5/6/7/8 never contribute a gate reason, even triggered at latest', verdict.reasons.length === 0 && verdict.status === 'PASS', verdict);
}

// --- 7. Regression detection ---------------------------------------------

console.log('\n=== 7. Regression spike detection ===');
{
  const report = baseSpcReport({
    regressionDetected: true,
    stabilityStatus: 'REGRESSED',
    regressionSpike: { detected: true, latestMovingRange: 40, uclMr: 6.53, percentChange: 0.8 },
  });
  const defaultVerdict = evaluateQualityGate(CLEAN_RECORD, report);
  check('default policy: regression => FAIL', defaultVerdict.status === 'FAIL' && reasonSeverity(defaultVerdict, 'REGRESSION_SPIKE') === 'FAIL', defaultVerdict);

  const warnPolicy = mergeGatePolicy({ regression: { onDetected: 'WARN' } });
  const warnVerdict = evaluateQualityGate(CLEAN_RECORD, report, warnPolicy);
  check('policy downgraded to WARN => WARN, not FAIL', warnVerdict.status === 'WARN' && reasonSeverity(warnVerdict, 'REGRESSION_SPIKE') === 'WARN', warnVerdict);

  const ignorePolicy = mergeGatePolicy({ regression: { onDetected: 'IGNORE' } });
  const ignoreVerdict = evaluateQualityGate(CLEAN_RECORD, report, ignorePolicy);
  check('policy set to IGNORE => no reason at all', !hasReason(ignoreVerdict, 'REGRESSION_SPIKE') && ignoreVerdict.status === 'PASS', ignoreVerdict);
}

// --- 8. Trend deterioration -----------------------------------------------

console.log('\n=== 8. Trend deterioration (directional, configurable) ===');
{
  const worsening = baseSpcReport({
    trendDetected: true,
    stabilityStatus: 'DRIFTING',
    trend: { slope: 1.2, correlation: 0.85, direction: 'WORSENING', nelsonRule3Triggered: false, regressionSignificant: true, detected: true },
  });
  const improving = baseSpcReport({
    trendDetected: true,
    stabilityStatus: 'DRIFTING',
    trend: { slope: -1.2, correlation: -0.85, direction: 'IMPROVING', nelsonRule3Triggered: false, regressionSignificant: true, detected: true },
  });

  const worseningVerdict = evaluateQualityGate(CLEAN_RECORD, worsening);
  check('WORSENING trend => WARN by default', worseningVerdict.status === 'WARN' && reasonSeverity(worseningVerdict, 'TREND_DETECTED') === 'WARN', worseningVerdict);

  const improvingVerdict = evaluateQualityGate(CLEAN_RECORD, improving);
  check('IMPROVING trend => no reason (onlyWorsening=true by default)', !hasReason(improvingVerdict, 'TREND_DETECTED') && improvingVerdict.status === 'PASS', improvingVerdict);

  const bothDirectionsPolicy = mergeGatePolicy({ trend: { onDetected: 'WARN', onlyWorsening: false } });
  const improvingWarnVerdict = evaluateQualityGate(CLEAN_RECORD, improving, bothDirectionsPolicy);
  check('onlyWorsening=false => IMPROVING trend also reported', hasReason(improvingWarnVerdict, 'TREND_DETECTED'), improvingWarnVerdict);

  const failPolicy = mergeGatePolicy({ trend: { onDetected: 'FAIL', onlyWorsening: true } });
  const failVerdict = evaluateQualityGate(CLEAN_RECORD, worsening, failPolicy);
  check('policy escalated to FAIL => status FAIL', failVerdict.status === 'FAIL' && reasonSeverity(failVerdict, 'TREND_DETECTED') === 'FAIL', failVerdict);
}

// --- 9. CUSUM drift ---------------------------------------------------------

console.log('\n=== 9. CUSUM process drift (directional, configurable) ===');
{
  const worsening = baseSpcReport({
    stabilityStatus: 'DRIFTING',
    drift: { cPlus: [0, 2, 9.4], cMinus: [0, 0, 0], k: 0.9, h: 8.85, detected: true, direction: 'WORSENING' },
  });
  const improving = baseSpcReport({
    stabilityStatus: 'DRIFTING',
    drift: { cPlus: [0, 0, 0], cMinus: [0, 2, 9.4], k: 0.9, h: 8.85, detected: true, direction: 'IMPROVING' },
  });

  const worseningVerdict = evaluateQualityGate(CLEAN_RECORD, worsening);
  check('WORSENING drift => WARN by default', worseningVerdict.status === 'WARN' && reasonSeverity(worseningVerdict, 'PROCESS_DRIFT') === 'WARN', worseningVerdict);

  const improvingVerdict = evaluateQualityGate(CLEAN_RECORD, improving);
  check('IMPROVING drift => no reason (onlyWorsening=true by default)', !hasReason(improvingVerdict, 'PROCESS_DRIFT'), improvingVerdict);

  const failPolicy = mergeGatePolicy({ drift: { onDetected: 'FAIL', onlyWorsening: true } });
  const failVerdict = evaluateQualityGate(CLEAN_RECORD, worsening, failPolicy);
  check('policy escalated to FAIL => status FAIL', failVerdict.status === 'FAIL' && reasonSeverity(failVerdict, 'PROCESS_DRIFT') === 'FAIL', failVerdict);
}

// --- 10. Cpk capability ------------------------------------------------------

console.log('\n=== 10. Process capability (Cpk/Cpu), configurable bands ===');
{
  const noUsl = baseSpcReport({ capability: { usl: null, cpu: null, capable: null } });
  check('no USL configured => capability layer is a no-op', !hasReason(evaluateQualityGate(CLEAN_RECORD, noUsl), 'CPK_CAPABILITY'));

  const capable = baseSpcReport({ capability: { usl: 100, cpu: 2.0, capable: true } });
  check('comfortably capable (cpu=2.0) => no reason', !hasReason(evaluateQualityGate(CLEAN_RECORD, capable), 'CPK_CAPABILITY'));

  const warnBand = baseSpcReport({ capability: { usl: 40, cpu: 1.1, capable: false } });
  const warnVerdict = evaluateQualityGate(CLEAN_RECORD, warnBand);
  check('cpu between failBelowCpu and warnBelowCpu => WARN', warnVerdict.status === 'WARN' && reasonSeverity(warnVerdict, 'CPK_CAPABILITY') === 'WARN', warnVerdict);

  const failBand = baseSpcReport({ capability: { usl: 40, cpu: 0.6, capable: false } });
  const failVerdict = evaluateQualityGate(CLEAN_RECORD, failBand);
  check('cpu below failBelowCpu => FAIL', failVerdict.status === 'FAIL' && reasonSeverity(failVerdict, 'CPK_CAPABILITY') === 'FAIL', failVerdict);

  // Edge case: flat series (sigma=0), cpu is null but capable carries the real verdict.
  const flatNotCapable = baseSpcReport({ chart: { ...INERT_CHART, sigma: 0, centerLine: 45 }, capability: { usl: 40, cpu: null, capable: false } });
  const flatVerdict = evaluateQualityGate(CLEAN_RECORD, flatNotCapable);
  check('flat series exceeding USL (cpu=null, capable=false) => FAIL', flatVerdict.status === 'FAIL' && hasReason(flatVerdict, 'CPK_CAPABILITY'), flatVerdict);

  // Boundary: exactly at warnBelowCpu (1.33) must NOT warn ("< warnBelowCpu", not "<=").
  const atWarnBoundary = baseSpcReport({ capability: { usl: 40, cpu: DEFAULT_GATE_POLICY.capability.warnBelowCpu, capable: true } });
  check('cpu exactly at warnBelowCpu boundary => no reason', !hasReason(evaluateQualityGate(CLEAN_RECORD, atWarnBoundary), 'CPK_CAPABILITY'));
}

// --- 11. Multiple simultaneous failures --------------------------------------

console.log('\n=== 11. Multiple simultaneous failures ===');
{
  const record = mkRecord({ buildId: 'multi-fail', critical: 2, serious: 12, defectScore: 80 });
  const report = baseSpcReport({
    uclViolation: true,
    processState: 'OUT_OF_CONTROL',
    stabilityStatus: 'REGRESSED',
    regressionDetected: true,
    regressionSpike: { detected: true, latestMovingRange: 55, uclMr: 6.53, percentChange: 1.5 },
  });
  const verdict = evaluateQualityGate(record, report);

  check('status is FAIL', verdict.status === 'FAIL', verdict.status);
  check(
    'all five independent FAIL reasons are present simultaneously',
    ['CRITICAL_DEFECTS', 'SERIOUS_DEFECTS', 'WEIGHTED_DEFECT_SCORE', 'SPC_UCL_VIOLATION', 'REGRESSION_SPIKE'].every((id) => hasReason(verdict, id)),
    verdict.reasons.map((r) => r.ruleId),
  );
  check('reasons.length === 5 (no duplicate or missing entries)', verdict.reasons.length === 5, verdict.reasons);
  check('every reason severity is FAIL', verdict.reasons.every((r) => r.severity === 'FAIL'), verdict.reasons);
}

// --- 12. Missing / insufficient SPC data ------------------------------------

console.log('\n=== 12. Missing/insufficient SPC data (fewer than 2 history points) ===');
{
  const single = [mkRecord({ buildId: 'only', timestamp: new Date(2026, 0, 1).toISOString(), defectScore: 5 })];
  const verdict = evaluateLatestBuild(single);
  check('spcProcessState is INSUFFICIENT_DATA', verdict.spcProcessState === 'INSUFFICIENT_DATA', verdict);
  check('a clean single-build history still PASSes (defect-count layers unaffected)', verdict.status === 'PASS', verdict);
}
{
  const single = [mkRecord({ buildId: 'only-crit', timestamp: new Date(2026, 0, 1).toISOString(), critical: 1, defectScore: 15 })];
  const verdict = evaluateLatestBuild(single);
  check(
    'critical-defect layer still fires even with INSUFFICIENT_DATA (no history dependency)',
    verdict.status === 'FAIL' && hasReason(verdict, 'CRITICAL_DEFECTS'),
    verdict,
  );
  check('no SPC-derived reasons appear when data is insufficient', verdict.reasons.every((r) => r.ruleId === 'CRITICAL_DEFECTS'), verdict.reasons);
}
{
  // evaluateLatestBuild must reject an empty history rather than silently fabricating a verdict.
  let threw = false;
  try {
    evaluateLatestBuild([]);
  } catch {
    threw = true;
  }
  check('evaluateLatestBuild([]) throws rather than fabricating a verdict', threw);
}

// --- 13. mergeGatePolicy preserves untouched defaults -----------------------

console.log('\n=== 13. Configuration changes: mergeGatePolicy is a one-level-deep partial override ===');
{
  const custom: GatePolicyConfig = mergeGatePolicy({ capability: { warnBelowCpu: 2.0, failBelowCpu: 1.5 } });
  check('overridden field applied', custom.capability.warnBelowCpu === 2.0 && custom.capability.failBelowCpu === 1.5);
  check('untouched nested groups (trend, drift, spc, regression) keep their defaults',
    custom.trend.onDetected === DEFAULT_GATE_POLICY.trend.onDetected &&
    custom.drift.onlyWorsening === DEFAULT_GATE_POLICY.drift.onlyWorsening &&
    custom.spc.failOnUclViolation === DEFAULT_GATE_POLICY.spc.failOnUclViolation &&
    custom.regression.onDetected === DEFAULT_GATE_POLICY.regression.onDetected,
    custom,
  );
  check('untouched scalar fields (maxCriticalDefects, maxSeriousDefects) keep their defaults',
    custom.maxCriticalDefects === DEFAULT_GATE_POLICY.maxCriticalDefects && custom.maxSeriousDefects === DEFAULT_GATE_POLICY.maxSeriousDefects);
  check('DEFAULT_GATE_POLICY itself is unmodified by the override (no accidental shared-reference mutation)',
    DEFAULT_GATE_POLICY.capability.warnBelowCpu === 1.33 && DEFAULT_GATE_POLICY.capability.failBelowCpu === 1.0);
}

// --- 14. End-to-end: evaluateLatestBuild() composed with the real L5 engine -

console.log('\n=== 14. End-to-end: evaluateLatestBuild() over a real, synthetic build history ===');
{
  // Same shape as verify-spc.ts test 14: 10 stable builds, then one regressed build.
  const stable = baselineRecords(10, 26, 1);
  const regressed = mkRecord({ buildId: 'regressed', timestamp: new Date(2026, 0, 1, 0, 10).toISOString(), defectScore: 35, minor: 35 });
  const history = [...stable, regressed];

  const spcReport = computeSpcReport(history);
  const verdict = evaluateLatestBuild(history);

  console.log('  SPC summary:', { stabilityStatus: spcReport.stabilityStatus, regressionDetected: spcReport.regressionDetected });
  console.log('  Gate verdict:', { status: verdict.status, reasons: verdict.reasons.map((r) => r.ruleId) });

  check('gate FAILs at the point of a real, detected regression', verdict.status === 'FAIL', verdict);
  check('REGRESSION_SPIKE reason is present end-to-end (no data recomputed differently than L5)', hasReason(verdict, 'REGRESSION_SPIKE'), verdict.reasons);
}
{
  // A stable, quiet history should PASS end-to-end with zero reasons.
  const stable = baselineRecords(15, 20, 2);
  const verdict = evaluateLatestBuild(stable);
  check('a stable, quiet real history PASSes end-to-end', verdict.status === 'PASS', verdict);
}

// --- 15. Real telemetry/history/ data (informational) -----------------------

console.log('\n=== 15. Real telemetry/history/ data (informational sanity check) ===');
{
  const verdict = evaluateFromDisk();
  console.log('  evaluateFromDisk():', { status: verdict.status, spcProcessState: verdict.spcProcessState, reasons: verdict.reasons.map((r) => r.ruleId) });
  check('evaluateFromDisk() returns a well-formed verdict without throwing', ['PASS', 'WARN', 'FAIL'].includes(verdict.status));
}

// --- 16. Real telemetry/history/: the 427 historical spike does not fail a later, clean build ---

console.log('\n=== 16. End-to-end: a historical spike (real build 427) does not fail a later build ===');
{
  // Real production data: 22, 427 [special-cause], 22, 22, 32 (see
  // specialCauseClassifications.ts / verify-spc.ts test 16). 427 is excluded
  // from control-limit calculation but NOT from rule-pattern detection
  // inputs (documented, intentional -- see controlChart.ts), so relative to
  // X-bar=24.50/sigma=2.96 it is still a massive beyond-3-sigma outlier and
  // Nelson rule 1 DOES trigger on it historically (at its own index, not
  // the latest build).
  const records = loadTelemetryHistory();
  const spcReport = computeSpcReport(records);
  const rule1 = spcReport.nelson.find((r) => r.rule === 1);
  const latestIndex = spcReport.chart.individuals.length - 1;

  check('Nelson rule 1 does trigger somewhere in the real history (on the 427 spike)', rule1?.triggered === true, rule1);
  check('...but NOT at the latest index -- it does not culminate at the current build', rule1?.triggeredAtIndex !== latestIndex && rule1?.culminatesAtLatest === false, rule1);

  const verdict = evaluateFromDisk();
  console.log('  evaluateFromDisk() reasons:', verdict.reasons.map((r) => r.ruleId));
  check('the historical spike does not appear as an SPC_RULE_NELSON_1 reason on the current build', !hasReason(verdict, 'SPC_RULE_NELSON_1'), verdict.reasons);
}

// --- 17. A 15-build low-variance run does not warn/fail (Nelson rule 7 excluded) ---

console.log('\n=== 17. A stratified (suspiciously low-variance) run does not warn/fail the gate (Nelson rule 7 excluded) ===');
{
  // Same construction as verify-spc.ts test 8: an irregular baseline, then
  // 15 points oscillating by a tiny amount -- tight enough, relative to the
  // combined series' own self-computed sigma, to satisfy Nelson rule 7
  // (15 consecutive within 1-sigma). Run through the real, unmodified
  // computeSpcReport()/evaluateLatestBuild() (not a hand-built fixture) so
  // this is a genuine end-to-end check, not just an isolated policy-layer test.
  const base = 20;
  const baselineSpread = 2;
  const baseline = Array.from({ length: 20 }, (_, i) => base + Math.round(Math.sin(i * 1.37) * baselineSpread));
  const tinyStep = 0.05; // tiny relative to the baseline's own spread/sigma
  const tight = Array.from({ length: 15 }, (_, i) => base + (i % 2 === 0 ? tinyStep : -tinyStep));
  const values = [...baseline, ...tight];
  const records = values.map((v, i) => mkRecord({ buildId: `strat-${i}`, timestamp: new Date(2026, 2, 1, 0, i).toISOString(), defectScore: v, minor: Math.round(v) }));

  const spcReport = computeSpcReport(records);
  const rule7 = spcReport.nelson.find((r) => r.rule === 7);
  check('Nelson rule 7 (stratification) does trigger on the tight 15-build tail', rule7?.triggered === true, rule7);

  const verdict = evaluateLatestBuild(records);
  console.log('  Gate verdict:', { status: verdict.status, reasons: verdict.reasons.map((r) => r.ruleId) });
  check('the gate never reports SPC_RULE_NELSON_7 (rule 7 is excluded from the Lean gate model)', !hasReason(verdict, 'SPC_RULE_NELSON_7'), verdict.reasons);
  check('a clean, merely-stratified history PASSes the gate end-to-end', verdict.status === 'PASS', verdict);
}

// --- 18. A consecutive run of genuinely improving builds does not warn -----

console.log('\n=== 18. A consecutive run below X-bar (genuine improvement) does not warn the gate ===');
{
  // An irregular, elevated baseline establishes X-bar and sigma, followed by
  // 9 consecutive builds noticeably and consistently BELOW that center line
  // -- a real Nelson rule 2 same-side run, on the improving side. Values stay
  // noisy/irregular (not monotonic) so this exercises rule 2, not rule 3.
  // Kept below the default weighted-defect-score WARN threshold (30) throughout,
  // so the only thing that could possibly warn/fail here is the SPC rule 2 path itself.
  const base = 20;
  const baseline = Array.from({ length: 20 }, (_, i) => base + Math.round(Math.sin(i * 1.37) * 3));
  const improvedLevel = 13; // below the baseline center line (rule 2's same-side test), but NOT extreme enough to also trip the non-directional rule 1 / UCL-LCL check -- this fixture is specifically about the directional rule 2 filter, not rule 1's (correctly) symmetric one
  const improved = [improvedLevel + 1, improvedLevel - 1, improvedLevel, improvedLevel - 2, improvedLevel + 2, improvedLevel - 1, improvedLevel, improvedLevel + 1, improvedLevel];
  const values = [...baseline, ...improved];
  const records = values.map((v, i) => mkRecord({ buildId: `improve-${i}`, timestamp: new Date(2026, 3, 1, 0, i).toISOString(), defectScore: v, minor: v }));

  const spcReport = computeSpcReport(records);
  const rule2 = spcReport.nelson.find((r) => r.rule === 2);
  check('Nelson rule 2 triggers on the improving run, direction=below', rule2?.triggered === true && rule2?.direction === 'below', rule2);

  const verdict = evaluateLatestBuild(records);
  console.log('  Gate verdict:', { status: verdict.status, reasons: verdict.reasons.map((r) => r.ruleId) });
  check('the gate never reports SPC_RULE_NELSON_2 for an improving (below-center) run', !hasReason(verdict, 'SPC_RULE_NELSON_2'), verdict.reasons);
  check('a genuinely improving run PASSes the gate end-to-end (no warning at all)', verdict.status === 'PASS', verdict);
}

console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) process.exit(1);
