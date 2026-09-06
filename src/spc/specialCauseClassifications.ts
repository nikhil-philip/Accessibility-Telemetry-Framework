/**
 * Declarative registry of known special-cause records (ARCHITECTURE.md
 * §8.1's "special cause variation" -- a signal that something
 * structurally, non-recurringly changed).
 *
 * SPC control limits (src/spc/controlChart.ts) describe *normal* process
 * variation. A record listed here is a human, out-of-band assertion that
 * a specific build's defect score does NOT represent normal variation --
 * it has a known, already-investigated, non-recurring cause -- so it is
 * excluded from control-limit calculation while remaining, unmodified, in
 * telemetry history and on the dashboard for historical traceability.
 *
 * This is deliberately NOT automatic outlier detection: a record is
 * excluded only when its commitSha is explicitly listed here. An
 * unclassified record, however statistically extreme, remains fully
 * eligible for control-limit calculation -- see controlChart.ts.
 */
export type SpecialCauseClassification = 'SPECIAL_CAUSE_HISTORICAL';

interface SpecialCauseEntry {
  classification: SpecialCauseClassification;
  reason: string;
}

const SPECIAL_CAUSE_REGISTRY: Record<string, SpecialCauseEntry> = {
  a8169fceefcc8356403a1ac1c0dcc549fc9903f9: {
    classification: 'SPECIAL_CAUSE_HISTORICAL',
    reason:
      'Deliberately seeded worst-case accessibility state (defectScore 427) used to validate scoring and detection; not representative of normal process variation.',
  },
};

export function getSpecialCauseClassification(commitSha: string): SpecialCauseClassification | undefined {
  return SPECIAL_CAUSE_REGISTRY[commitSha]?.classification;
}

export function getSpecialCauseReason(commitSha: string): string | undefined {
  return SPECIAL_CAUSE_REGISTRY[commitSha]?.reason;
}
