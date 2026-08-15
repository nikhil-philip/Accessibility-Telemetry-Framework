/**
 * Deterministic generator for Experiment B's stable-process cohort --
 * a SEPARATE, single-regime cohort used only to evaluate process
 * capability (Cpk/Cpu). Deliberately distinct from
 * src/telemetry/experimentGenerator.ts (Experiment A's five-phase
 * non-stationary cohort): no phases, no interpolation, no deliberate
 * regression -- one flat severity target sampled independently per build,
 * so the process is, by construction, the single homogeneous regime Cpk
 * analysis assumes (see ARCHITECTURE.md SS8.4 / capabilityAnalysis.ts).
 *
 * Pure logic only -- no file I/O, no console output -- mirroring
 * experimentGenerator.ts's separation between generation (this file) and
 * the entry-point script that writes/analyzes it
 * (scripts/generate-stable-cohort.ts).
 */
import { TelemetryRecord, ViolationsBySeverity } from './schema';
import { computeDefectScore } from './collector';
import { mulberry32, sampleCount } from './syntheticRandom';

/** Deliberately different from EXPERIMENT_SEED (experimentGenerator.ts) so the two cohorts can never be confused for the same generation run. */
export const STABLE_COHORT_SEED = 71430901;

export const STABLE_COHORT_BUILD_COUNT = 30;

/** Repo-root-relative, a sibling of -- and never inside -- telemetry/experiments/spc-validation-cohort/ (Experiment A) or telemetry/history/ (production). */
export const STABLE_COHORT_DIR_RELATIVE = 'telemetry/experiments/stable-capability-cohort';

/**
 * One flat severity target for the whole cohort -- low mean, small
 * spread, representing a healthy, already-remediated accessibility
 * process with only ordinary build-to-build (common-cause) variation.
 * Mean weighted score (10/5/2/1, unmodified) ~= 10(0.03)+5(1.0)+2(1.2)+1(1.0)
 * = 8.7 -- small and, by construction, sampled from one unchanging
 * distribution for all 30 builds (no phase, no trend, no injected
 * regression).
 */
const STABLE_TARGET = {
  critical: { mean: 0.03, spread: 0.2 },
  serious: { mean: 1.0, spread: 0.6 },
  moderate: { mean: 1.2, spread: 0.6 },
  minor: { mean: 1.0, spread: 0.5 },
};

function sampleSeverityCounts(rand: () => number): ViolationsBySeverity {
  // Fixed sampling order (critical, serious, moderate, minor), same
  // convention as experimentGenerator.ts, is itself part of what makes
  // generation deterministic given a seed.
  return {
    critical: sampleCount(rand, STABLE_TARGET.critical.mean, STABLE_TARGET.critical.spread),
    serious: sampleCount(rand, STABLE_TARGET.serious.mean, STABLE_TARGET.serious.spread),
    moderate: sampleCount(rand, STABLE_TARGET.moderate.mean, STABLE_TARGET.moderate.spread),
    minor: sampleCount(rand, STABLE_TARGET.minor.mean, STABLE_TARGET.minor.spread),
  };
}

/** A different base date than experimentGenerator.ts's (2026-01-01), purely so the two cohorts are unambiguous even if their JSON were ever inspected side by side outside their (already-separate) directories. */
const STABLE_COHORT_BASE_TIMESTAMP_MS = Date.UTC(2026, 3, 1); // 2026-04-01T00:00:00Z
const ONE_DAY_MS = 86_400_000;

/**
 * Generates STABLE_COHORT_BUILD_COUNT TelemetryRecords, deterministic for
 * a given seed, all drawn from the single STABLE_TARGET distribution --
 * no phases, no regression, no trend by construction. Schema-conformant
 * exactly like generateExperimentRecords() (experimentGenerator.ts);
 * `violationsByRule` is left empty for the same reason (neither L5 nor L6
 * read it).
 */
export function generateStableCohortRecords(seed: number = STABLE_COHORT_SEED): TelemetryRecord[] {
  const rand = mulberry32(seed);
  const records: TelemetryRecord[] = [];

  for (let buildNumber = 1; buildNumber <= STABLE_COHORT_BUILD_COUNT; buildNumber++) {
    const violationsBySeverity = sampleSeverityCounts(rand);
    const defectScore = computeDefectScore(violationsBySeverity);
    const totalNodesFailed =
      violationsBySeverity.critical + violationsBySeverity.serious + violationsBySeverity.moderate + violationsBySeverity.minor;
    const buildId = `stable-${String(buildNumber).padStart(3, '0')}`;

    records.push({
      buildId,
      commitSha: buildId,
      branch: 'experiment/stable-capability-cohort',
      triggeredBy: 'manual',
      timestamp: new Date(STABLE_COHORT_BASE_TIMESTAMP_MS + (buildNumber - 1) * ONE_DAY_MS).toISOString(),
      wcagLevel: 'AA',
      pagesScanned: 8,
      violationsBySeverity,
      violationsByRule: [],
      defectScore,
      totalNodesFailed,
    });
  }

  return records;
}
