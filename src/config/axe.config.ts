/**
 * WCAG 2.2 A/AA Ruleset Config (ARCHITECTURE.md Layer 3).
 *
 * IMPORTANT -- do not remove 'best-practice' from this list. Five of the
 * rules seeded into apps/shopsmart (heading-order, landmark-one-main,
 * region, tabindex, aria-dialog-name) carry no WCAG success-criterion tag
 * at all; they are axe-core `best-practice`-only rules. Scoping this list
 * to WCAG tags alone silently drops them from every scan. This dependency
 * is documented in docs/violations/catalog.md ("Critical dependency for
 * the scanning framework") -- that document is the source of truth if
 * this comment and the code ever drift apart.
 */
export const AXE_TAGS: readonly string[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];

/** Reported as `wcagLevel` in telemetry (ARCHITECTURE.md Appendix A). */
export const WCAG_LEVEL = 'AA' as const;
