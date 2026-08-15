/**
 * EXPERIMENT A -- Process-regime / SPC baseline experiment.
 *
 * Purpose: evaluate EXPANDING_HISTORY versus TRAILING_WINDOW SPC analysis
 * across the deliberately changing process conditions of the 30-build,
 * five-phase cohort (src/telemetry/experimentGenerator.ts). Writes the
 * cohort to telemetry/experiments/spc-validation-cohort/ (never
 * telemetry/history/), then runs it through both walk-forward analysis
 * methods (src/spc/experimentAnalysis.ts) and prints a build-by-build
 * comparison of: I-MR/control limits, WECO/Nelson rules, trend,
 * regression, CUSUM, and the Quality Gate verdict.
 *
 * Cpk is NOT used in this experiment. Cpk was excluded from this
 * particular experiment because the experimental cohort intentionally
 * represents a non-stationary process containing multiple process
 * phases. Capability analysis is evaluated separately using a
 * stable-process cohort (see scripts/generate-stable-cohort.ts --
 * Experiment B). Mechanically, this is done by simply never supplying
 * `usl` to computeSpcReport()/the gate policy below -- the existing,
 * unmodified code path in capabilityAnalysis.ts (`if (usl === undefined)
 * return { usl: null, cpu: null, capable: null }`) and
 * qualityGateEvaluator.ts's checkCapability() (`if (capability.usl ===
 * null) return null`) already skip capability analysis entirely in that
 * case. No Cpk algorithm, SPC formula, or gate threshold is touched.
 *
 * Neither analysis method modifies computeSpcReport(), evaluateQualityGate(),
 * any SPC formula, or any gate threshold -- both simply feed the existing,
 * unmodified engine a different slice of the same 30-build history. See
 * experimentAnalysis.ts's file header for the full methodology notes.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/generate-experiment.js
 */
import * as fs from 'fs';
import { EXPERIMENT_DIR_RELATIVE, EXPERIMENT_SEED, generateExperimentRecords, phaseForBuild } from '../src/telemetry/experimentGenerator';
import { writeTelemetryRecordTo } from '../src/telemetry/writer';
import { repoPath } from '../src/utils/paths';
import {
  AnalysisMethod,
  ANALYSIS_METHOD_NOTES,
  BuildAnalysisResult,
  DEFAULT_TRAILING_WINDOW_SIZE,
  rule1Triggered,
  runAnalysis,
  summarizeResults,
} from '../src/spc/experimentAnalysis';
import { DEFAULT_GATE_POLICY } from '../src/gates/gatePolicies';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('GenerateExperiment');

// No `usl` / spcOptions supplied anywhere below -- see file header. The
// unmodified DEFAULT_GATE_POLICY is used as-is (no capability override).

function assertSafeToClear(dir: string): void {
  const normalized = dir.replace(/\\/g, '/');
  if (!normalized.includes('/telemetry/experiments/spc-validation-cohort')) {
    throw new Error(`Refusing to clear "${dir}" -- this does not look like the experiment directory. telemetry/history/ is never touched by this script.`);
  }
}

function writeCohort(): string {
  const dir = repoPath(EXPERIMENT_DIR_RELATIVE);
  assertSafeToClear(dir);

  // Regenerate the directory fresh each run so re-running this script with
  // the same seed reproduces the exact same 30 files, rather than
  // accumulating "-2" collision suffixes from writeTelemetryRecordTo().
  fs.rmSync(dir, { recursive: true, force: true });

  const records = generateExperimentRecords(EXPERIMENT_SEED);
  for (const record of records) {
    writeTelemetryRecordTo(dir, record);
  }

  logger.info(`Wrote ${records.length} synthetic records to ${dir} (seed=${EXPERIMENT_SEED})`);
  return dir;
}

function formatRow(result: BuildAnalysisResult) {
  return {
    spcState: result.spcReport.processState,
    rule1: rule1Triggered(result.spcReport) ? 'TRIGGERED' : 'CLEAR',
    trend: result.spcReport.trend.detected ? result.spcReport.trend.direction : 'NONE',
    regression: result.spcReport.regressionSpike.detected ? 'DETECTED' : 'NONE',
    cusum: result.spcReport.drift.detected ? result.spcReport.drift.direction : 'NONE',
    gate: result.gateVerdict.status,
  };
}

interface ComparisonRow {
  buildId: string;
  phase: string;
  defectScore: number;
  exp_spcState: string;
  exp_rule1: string;
  exp_trend: string;
  exp_regression: string;
  exp_cusum: string;
  exp_gate: string;
  trail_spcState: string;
  trail_rule1: string;
  trail_trend: string;
  trail_regression: string;
  trail_cusum: string;
  trail_gate: string;
}

function buildComparisonRows(
  records: ReturnType<typeof generateExperimentRecords>,
  expanding: BuildAnalysisResult[],
  trailing: BuildAnalysisResult[],
): ComparisonRow[] {
  return records.map((record, i) => {
    const expRow = formatRow(expanding[i]!);
    const trailRow = formatRow(trailing[i]!);
    return {
      buildId: record.buildId,
      phase: phaseForBuild(i + 1).phase,
      defectScore: record.defectScore,
      exp_spcState: expRow.spcState,
      exp_rule1: expRow.rule1,
      exp_trend: expRow.trend,
      exp_regression: expRow.regression,
      exp_cusum: expRow.cusum,
      exp_gate: expRow.gate,
      trail_spcState: trailRow.spcState,
      trail_rule1: trailRow.rule1,
      trail_trend: trailRow.trend,
      trail_regression: trailRow.regression,
      trail_cusum: trailRow.cusum,
      trail_gate: trailRow.gate,
    };
  });
}

function printMethodNotes(method: AnalysisMethod): void {
  const { label, notes } = ANALYSIS_METHOD_NOTES[method];
  console.log(`\n${method} -- ${label}`);
  for (const note of notes) console.log(`  - ${note}`);
}

function main(): void {
  console.log(`=== EXPERIMENT A -- Process-regime / SPC baseline experiment (seed=${EXPERIMENT_SEED}, 30 builds, 5 phases) ===\n`);
  const dir = writeCohort();
  console.log(`Written to: ${dir}\n`);

  console.log(
    'Cpk is NOT used in this experiment: the cohort intentionally represents a non-stationary\n' +
      'process containing multiple process phases, which violates process-capability analysis\'s\n' +
      'stability assumption. Capability analysis is evaluated separately in Experiment B\n' +
      '(scripts/generate-stable-cohort.ts) against a single-regime, stable-process cohort.\n',
  );

  const records = generateExperimentRecords(EXPERIMENT_SEED);

  console.log('=== Methodology ===');
  printMethodNotes('EXPANDING_HISTORY');
  printMethodNotes('TRAILING_WINDOW');
  console.log(`\n(TRAILING_WINDOW windowSize = ${DEFAULT_TRAILING_WINDOW_SIZE})`);

  const expandingResults = runAnalysis(records, 'EXPANDING_HISTORY', { gatePolicy: DEFAULT_GATE_POLICY });
  const trailingResults = runAnalysis(records, 'TRAILING_WINDOW', {
    windowSize: DEFAULT_TRAILING_WINDOW_SIZE,
    gatePolicy: DEFAULT_GATE_POLICY,
  });

  console.log('\n=== Build-by-build comparison: EXPANDING_HISTORY vs TRAILING_WINDOW ===\n');
  console.table(buildComparisonRows(records, expandingResults, trailingResults));

  const expandingSummary = summarizeResults(expandingResults);
  const trailingSummary = summarizeResults(trailingResults);

  console.log('\n=== Summary: EXPANDING_HISTORY ===');
  console.table([expandingSummary]);
  console.log('\n=== Summary: TRAILING_WINDOW ===');
  console.table([trailingSummary]);
}

main();
