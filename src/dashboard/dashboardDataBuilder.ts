/**
 * The Dashboard Generator's data layer (ARCHITECTURE.md Layer 7). Builds
 * one DashboardData object by calling ONLY existing, unmodified L4/L5/L6
 * and experiment-analysis entry points:
 *
 *  - loadTelemetryHistory()        (spcEngine.ts, L4/L5 loader)
 *  - computeSpcReport()            (spcEngine.ts, L5 -- unmodified)
 *  - evaluateLatestBuild() /
 *    evaluateQualityGate()         (qualityGateEvaluator.ts, L6 -- unmodified)
 *  - runAnalysis() / summarizeResults() (experimentAnalysis.ts -- unmodified)
 *
 * This module performs zero SPC math, zero rule evaluation, zero gate
 * policy logic, and zero score computation of its own -- it only reads
 * telemetry off disk (via the same loader L5 already uses) and groups
 * already-computed results into the shape src/dashboard/types.ts declares.
 * Production telemetry/history/ and telemetry/experiments/ are only ever
 * read here, never written.
 */
import { loadTelemetryHistory, computeSpcReport } from '../spc/spcEngine';
import { evaluateLatestBuild, evaluateQualityGate } from '../gates/qualityGateEvaluator';
import { runAnalysis, summarizeResults, ANALYSIS_METHOD_NOTES } from '../spc/experimentAnalysis';
import { EXPERIMENT_DIR_RELATIVE, EXPERIMENT_PHASES } from '../telemetry/experimentGenerator';
import { STABLE_COHORT_DIR_RELATIVE } from '../telemetry/stableProcessGenerator';
import { repoPath } from '../utils/paths';
import { createLogger } from '../utils/logger';
import { DashboardData } from './types';

const logger = createLogger('DashboardDataBuilder');

/**
 * Experiment B's upper specification limit. Not exported by capabilityAnalysis.ts
 * or spc/types.ts (usl is a per-call option, not a fixed constant) -- this
 * value matches the one scripts/verify-stable-cohort.ts already uses to
 * reproduce the validated Cpu ~= 2.9811 result. Supplying it as an
 * SpcEngineOptions.usl value is the same, unmodified computeSpcReport()
 * option every other caller uses; it does not alter capability math.
 */
export const EXPERIMENT_B_USL = 40;

/** Builds the full dashboard data contract from disk. Pure orchestration -- see file header. */
export function buildDashboardData(): DashboardData {
  const productionHistory = loadTelemetryHistory();
  const productionSpcReport = computeSpcReport(productionHistory);
  const productionGateVerdict = evaluateLatestBuild(productionHistory);

  const experimentARecords = loadTelemetryHistory(repoPath(EXPERIMENT_DIR_RELATIVE));
  const expandingResults = runAnalysis(experimentARecords, 'EXPANDING_HISTORY');
  const trailingResults = runAnalysis(experimentARecords, 'TRAILING_WINDOW');

  const stableCohortRecords = loadTelemetryHistory(repoPath(STABLE_COHORT_DIR_RELATIVE));
  const experimentBSpcReport = computeSpcReport(stableCohortRecords, { usl: EXPERIMENT_B_USL });
  const experimentBLatest = stableCohortRecords[stableCohortRecords.length - 1];
  if (!experimentBLatest) {
    throw new Error('buildDashboardData: stable-capability-cohort has no records -- run `npm run generate:stable-cohort` first.');
  }
  const experimentBGateVerdict = evaluateQualityGate(experimentBLatest, experimentBSpcReport);

  const data: DashboardData = {
    generatedAt: new Date().toISOString(),
    production: {
      history: productionHistory,
      spcReport: productionSpcReport,
      gateVerdict: productionGateVerdict,
    },
    experimentA: {
      phases: EXPERIMENT_PHASES,
      methodNotes: ANALYSIS_METHOD_NOTES,
      expandingHistory: {
        method: 'EXPANDING_HISTORY',
        results: expandingResults,
        summary: summarizeResults(expandingResults),
      },
      trailingWindow: {
        method: 'TRAILING_WINDOW',
        results: trailingResults,
        summary: summarizeResults(trailingResults),
      },
    },
    experimentB: {
      history: stableCohortRecords,
      spcReport: experimentBSpcReport,
      gateVerdict: experimentBGateVerdict,
      usl: EXPERIMENT_B_USL,
    },
  };

  logger.info(
    `Dashboard data built: production n=${productionHistory.length} (${productionGateVerdict.status}), ` +
      `experimentA n=${experimentARecords.length}, experimentB n=${stableCohortRecords.length} (Cpu=${experimentBSpcReport.capability.cpu?.toFixed(4) ?? 'n/a'})`,
  );

  return data;
}
