/**
 * Deterministic generator for a controlled, synthetic SPC validation
 * cohort (30 builds across 5 process phases). Pure logic only -- no file
 * I/O, no console output -- so it can be imported by both the entry-point
 * script (scripts/generate-experiment.ts, which writes the records and
 * prints a report) and the verification script (scripts/verify-experiment.ts,
 * which imports it to test reproducibility without triggering any side
 * effect) without either accidentally re-running the other's job.
 *
 * This module does NOT touch TelemetryRecord.defectScore's definition,
 * the severity weighting, or any SPC/gate logic -- it only produces
 * TelemetryRecord-shaped input data using the existing, unmodified
 * computeDefectScore() (src/telemetry/collector.ts).
 */
import { TelemetryRecord, ViolationsBySeverity } from './schema';
import { computeDefectScore } from './collector';
import { mulberry32, sampleCount } from './syntheticRandom';

/** Arbitrary but fixed -- reproducibility only requires this value never change, not that it mean anything. */
export const EXPERIMENT_SEED = 20260815;

export const EXPERIMENT_BUILD_COUNT = 30;

/** Repo-root-relative, deliberately a sibling of telemetry/history/ and telemetry/aggregated/, never inside either -- see ARCHITECTURE.md SS5's folder structure. */
export const EXPERIMENT_DIR_RELATIVE = 'telemetry/experiments/spc-validation-cohort';

export type ExperimentPhase = 'A' | 'B' | 'C' | 'D' | 'E';

export interface PhaseDefinition {
  phase: ExperimentPhase;
  label: string;
  description: string;
  /** 1-indexed, inclusive. */
  firstBuild: number;
  /** 1-indexed, inclusive. */
  lastBuild: number;
}

export const EXPERIMENT_PHASES: readonly PhaseDefinition[] = [
  { phase: 'A', label: 'Initial unstable process', description: 'Relatively high, meaningfully variable defect counts, with occasional critical defects -- generally expected to read as poor quality.', firstBuild: 1, lastBuild: 8 },
  { phase: 'B', label: 'Quality improvement', description: 'Gradually decreasing severity counts and defectScore, with noise -- a transition from poor toward acceptable quality, not a clean staircase.', firstBuild: 9, lastBuild: 15 },
  { phase: 'C', label: 'Stable process', description: 'Critical defects normally zero; low but non-zero serious/moderate/minor counts; defectScore substantially lower than Phase A; only common-cause variation.', firstBuild: 16, lastBuild: 22 },
  { phase: 'D', label: 'Deliberate regression', description: 'A clear, realistic, sustained regression (e.g. a shipped ARIA/landmark defect) held for 3 builds -- a measurable defectScore increase over Phase C, left for the existing SPC regression detector to find on its own.', firstBuild: 23, lastBuild: 25 },
  { phase: 'E', label: 'Recovery', description: 'Critical defects normally return to zero; severity counts and defectScore decrease gradually build over build, moving back toward -- not snapping to -- the Phase C range.', firstBuild: 26, lastBuild: 30 },
];

export function phaseForBuild(buildNumber: number): PhaseDefinition {
  const phase = EXPERIMENT_PHASES.find((p) => buildNumber >= p.firstBuild && buildNumber <= p.lastBuild);
  if (!phase) {
    throw new Error(`No experiment phase covers build ${buildNumber} (expected 1..${EXPERIMENT_BUILD_COUNT}).`);
  }
  return phase;
}

// --- Phase severity targets ----------------------------------------------
// Documented generation parameters (mean, spread) per severity, per phase.
// Phases A/C/D are flat (constant target for every build in the phase --
// "poor and variable" / "stable" / "sustained regression" are about the
// *level* and *noise*, not a trend within the phase). Phases B/E linearly
// interpolate their per-build mean between two flat endpoints, so the
// trend is real but not a perfectly monotonic staircase once per-build
// Gaussian noise is added on top.

interface SeverityTarget {
  mean: number;
  spread: number;
}

interface PhaseTargets {
  critical: SeverityTarget;
  serious: SeverityTarget;
  moderate: SeverityTarget;
  minor: SeverityTarget;
}

/**
 * Phase A's flat target, and Phase B's interpolation start point.
 *
 * critical mean=0.6 is deliberately "occasional, not universal": with
 * spread=0.7, sampleCount() (round(mean + spread*gaussian), clamped >=0)
 * lands on 0 roughly as often as it lands on >=1 -- some Phase A builds
 * carry a critical defect, some don't, matching "occasional critical
 * defects" rather than "every single build has one."
 * Mean weighted score ~= 10(0.6)+5(5.0)+2(4.5)+1(3.5) = 43.5 -- solidly
 * in the default gate policy's WARN/FAIL range (warnAt=30, failAt=50).
 */
const TARGET_A: PhaseTargets = {
  critical: { mean: 0.6, spread: 0.7 },
  serious: { mean: 5.0, spread: 2.0 },
  moderate: { mean: 4.5, spread: 2.0 },
  minor: { mean: 3.5, spread: 1.6 },
};

/**
 * Phase C's flat target, and Phase B's interpolation end point.
 *
 * critical mean=0.05, spread=0.3 pushes P(round(mean + spread*z) >= 1)
 * down to roughly the "z >= ~3.2" tail (~0.07%) -- critical defects are
 * normally (not absolutely never) zero across Phase C's 7 builds, per the
 * Part 1 requirement. Mean weighted score ~= 10(0.05)+5(1.2)+2(1.5)+1(1.5)
 * = 11 -- substantially below Phase A's ~43.5 and below the gate's
 * warnAt=30, so a clean Phase C build has a real, non-forced path to PASS.
 */
const TARGET_C: PhaseTargets = {
  critical: { mean: 0.05, spread: 0.3 },
  serious: { mean: 1.2, spread: 0.8 },
  moderate: { mean: 1.5, spread: 0.8 },
  minor: { mean: 1.5, spread: 0.7 },
};

/**
 * Phase D's flat target, and Phase E's interpolation start point.
 *
 * Deliberately moderate (not huge) spread, so the regression reads as a
 * clear, realistic step rather than one extreme noise spike. Mean
 * weighted score ~= 10(1.5)+5(5.0)+2(3.0)+1(2.0) = 48 -- a measurable,
 * ~4x increase over Phase C's ~11, left for computeSpcReport()'s existing
 * regression-spike/UCL/rule detectors to find unassisted.
 */
const TARGET_D: PhaseTargets = {
  critical: { mean: 1.5, spread: 0.5 },
  serious: { mean: 5.0, spread: 1.0 },
  moderate: { mean: 3.0, spread: 0.8 },
  minor: { mean: 2.0, spread: 0.7 },
};

/**
 * Phase E's interpolation end point -- close to, but not identical to,
 * TARGET_C: recovery is expressed entirely through Phase E's 5-build
 * linear interpolation from TARGET_D down to this point (see
 * targetForBuild()'s 'E' case below), so the return to a low level is
 * gradual rather than an artificial single-build reset. critical
 * mean=0.1 keeps critical defects "normally zero" by build 30, matching
 * Phase C's own behavior.
 */
const TARGET_E_END: PhaseTargets = {
  critical: { mean: 0.1, spread: 0.3 },
  serious: { mean: 1.5, spread: 0.9 },
  moderate: { mean: 1.8, spread: 0.9 },
  minor: { mean: 1.8, spread: 0.8 },
};

function lerpTarget(start: PhaseTargets, end: PhaseTargets, t: number): PhaseTargets {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    critical: { mean: lerp(start.critical.mean, end.critical.mean), spread: lerp(start.critical.spread, end.critical.spread) },
    serious: { mean: lerp(start.serious.mean, end.serious.mean), spread: lerp(start.serious.spread, end.serious.spread) },
    moderate: { mean: lerp(start.moderate.mean, end.moderate.mean), spread: lerp(start.moderate.spread, end.moderate.spread) },
    minor: { mean: lerp(start.minor.mean, end.minor.mean), spread: lerp(start.minor.spread, end.minor.spread) },
  };
}

function targetForBuild(buildNumber: number, phase: PhaseDefinition): PhaseTargets {
  switch (phase.phase) {
    case 'A':
      return TARGET_A;
    case 'B': {
      const span = phase.lastBuild - phase.firstBuild; // 6
      const t = (buildNumber - phase.firstBuild) / span; // 0..1 across builds 9..15
      return lerpTarget(TARGET_A, TARGET_C, t);
    }
    case 'C':
      return TARGET_C;
    case 'D':
      return TARGET_D;
    case 'E': {
      const span = phase.lastBuild - phase.firstBuild; // 4
      const t = (buildNumber - phase.firstBuild) / span; // 0..1 across builds 26..30
      return lerpTarget(TARGET_D, TARGET_E_END, t);
    }
  }
}

function sampleSeverityCounts(rand: () => number, target: PhaseTargets): ViolationsBySeverity {
  // Fixed sampling order (critical, serious, moderate, minor) is itself
  // part of what makes generation deterministic given a seed.
  return {
    critical: sampleCount(rand, target.critical.mean, target.critical.spread),
    serious: sampleCount(rand, target.serious.mean, target.serious.spread),
    moderate: sampleCount(rand, target.moderate.mean, target.moderate.spread),
    minor: sampleCount(rand, target.minor.mean, target.minor.spread),
  };
}

/** One synthetic "build" per day, starting 2026-01-01T00:00:00Z, strictly increasing -- satisfies computeSpcReport()'s chronological-order assumption without depending on wall-clock time. */
const EXPERIMENT_BASE_TIMESTAMP_MS = Date.UTC(2026, 0, 1);
const ONE_DAY_MS = 86_400_000;

/**
 * Generates EXPERIMENT_BUILD_COUNT TelemetryRecords, deterministic for a
 * given seed. Every record is schema-conformant (same shape/semantics as
 * a real collector.ts output) except `violationsByRule`, which is left
 * empty by design: neither the SPC engine (src/spc/spcEngine.ts) nor the
 * Quality Gate (src/gates/qualityGateEvaluator.ts) read violationsByRule,
 * so this cohort does not fabricate rule-level identity it isn't
 * validating anything against.
 */
export function generateExperimentRecords(seed: number = EXPERIMENT_SEED): TelemetryRecord[] {
  const rand = mulberry32(seed);
  const records: TelemetryRecord[] = [];

  for (let buildNumber = 1; buildNumber <= EXPERIMENT_BUILD_COUNT; buildNumber++) {
    const phase = phaseForBuild(buildNumber);
    const target = targetForBuild(buildNumber, phase);
    const violationsBySeverity = sampleSeverityCounts(rand, target);
    const defectScore = computeDefectScore(violationsBySeverity);
    const totalNodesFailed =
      violationsBySeverity.critical + violationsBySeverity.serious + violationsBySeverity.moderate + violationsBySeverity.minor;
    const buildId = `exp-${String(buildNumber).padStart(3, '0')}`;

    records.push({
      buildId,
      // Deliberately not a real git SHA shape -- unambiguous at a glance vs. any telemetry/history/ filename.
      commitSha: buildId,
      branch: 'experiment/spc-validation-cohort',
      triggeredBy: 'manual',
      timestamp: new Date(EXPERIMENT_BASE_TIMESTAMP_MS + (buildNumber - 1) * ONE_DAY_MS).toISOString(),
      wcagLevel: 'AA',
      pagesScanned: 8, // matches sites.config.ts's SITES.length, for schema realism only -- not consumed by SPC/gate
      violationsBySeverity,
      violationsByRule: [],
      defectScore,
      totalNodesFailed,
    });
  }

  return records;
}
