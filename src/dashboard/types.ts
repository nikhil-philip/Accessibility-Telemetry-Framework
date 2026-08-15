/**
 * Data contract for the Engineering Quality Dashboard (ARCHITECTURE.md
 * Layer 7). Every field here is a re-export or a plain grouping of a type
 * already defined by L4 (telemetry/schema.ts), L5 (spc/types.ts), L6
 * (gates/types.ts), or the experiment-analysis tooling
 * (spc/experimentAnalysis.ts, telemetry/experimentGenerator.ts). This file
 * declares zero new score, statistic, or threshold types -- it only says
 * "here is how those existing outputs are bundled for the dashboard to
 * render."
 */
import { TelemetryRecord } from '../telemetry/schema';
import { SpcReport } from '../spc/types';
import { GateVerdict } from '../gates/types';
import { AnalysisMethod, AnalysisSummary, BuildAnalysisResult, ANALYSIS_METHOD_NOTES } from '../spc/experimentAnalysis';
import { PhaseDefinition } from '../telemetry/experimentGenerator';

/** Production telemetry (telemetry/history/) as-is: the real, immutable build history. */
export interface ProductionDashboardData {
  history: TelemetryRecord[];
  /** computeSpcReport(history) -- unmodified L5 output. */
  spcReport: SpcReport;
  /** evaluateLatestBuild(history) -- unmodified L6 output, default policy. */
  gateVerdict: GateVerdict;
}

/** One baseline method's full walk-forward run, exactly as produced by src/spc/experimentAnalysis.ts. */
export interface ExperimentMethodResult {
  method: AnalysisMethod;
  results: BuildAnalysisResult[];
  summary: AnalysisSummary;
}

/** Experiment A: 30-build five-phase cohort, EXPANDING_HISTORY vs TRAILING_WINDOW (ARCHITECTURE.md / experimentAnalysis.ts). Cpk deliberately not evaluated here -- the process is non-stationary by design. */
export interface ExperimentADashboardData {
  phases: readonly PhaseDefinition[];
  /** Verbatim from experimentAnalysis.ts -- the dashboard's methodology copy is the same text verify-experiment.ts's authors already wrote, not a re-description of it. */
  methodNotes: typeof ANALYSIS_METHOD_NOTES;
  expandingHistory: ExperimentMethodResult;
  trailingWindow: ExperimentMethodResult;
}

/** Experiment B: 30-build stable-process cohort, evaluated once (single baseline method) specifically for Cpk capability analysis. */
export interface ExperimentBDashboardData {
  history: TelemetryRecord[];
  spcReport: SpcReport;
  gateVerdict: GateVerdict;
  /** Upper specification limit supplied to computeSpcReport({ usl }) for this cohort -- see dashboardDataBuilder.ts. */
  usl: number;
}

/** The dashboard's single JSON contract: everything dashboard.js needs, and nothing it needs to (re)compute. */
export interface DashboardData {
  generatedAt: string;
  production: ProductionDashboardData;
  experimentA: ExperimentADashboardData;
  experimentB: ExperimentBDashboardData;
}
