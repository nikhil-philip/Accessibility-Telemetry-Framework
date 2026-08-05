# ShopSmart Seeded-Violation Catalog

This is the ground-truth documentation for every accessibility defect intentionally seeded into the ShopSmart demo application (`apps/shopsmart/`). It exists so the accessibility-telemetry framework's real axe-core scan output can be cross-validated against a known-correct answer key (`catalog.json`), and so the 5-build quality trend used in the dissertation's evaluation chapter is auditable rather than asserted.

## ⚠️ Critical dependency for the scanning framework

Five of the 24 rules below — `heading-order`, `landmark-one-main`, `region`, `tabindex`, `aria-dialog-name` — are axe-core **`best-practice`**-tagged rules. They carry **no WCAG success-criterion tag**. If the framework's `axe.config.ts` (built separately, see `docs/architecture/ARCHITECTURE.md` Layer 3) scopes `runOnly` to only `['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']`, these 5 rule types will **never appear in scan results**, regardless of whether the markup is broken — and Build 3's violation count will fall below its intended 20+ threshold.

**Required configuration**: `axe.config.ts` must set:

```ts
runOnly: {
  type: 'tag',
  values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']
}
```

This is documented as a deliberate methodology choice for the dissertation: *"WCAG 2.2 Level A/AA conformance, plus axe-core's best-practice rule set for structural robustness."* Do not scope to WCAG tags alone.

## What's deliberately out of scope

WCAG 2.2's behavioral criteria — 2.4.11 (Focus Not Obscured), 2.5.7 (Dragging Movements), 3.2.6 (Consistent Help), 3.3.7 (Redundant Entry), 3.3.8 (Accessible Authentication) — have **no axe-core rule** and are not seeded here. Static DOM analysis cannot judge whether re-entering an address in checkout is "redundant" or whether a login form's cognitive-function test qualifies as accessible authentication; these require behavioral/interaction judgment. This is stated explicitly as a **threat to validity of automated tooling** in the dissertation, not an oversight — axe-core (and by extension this framework) cannot claim full WCAG 2.2 coverage, only what's statically detectable.

## Catalog structure

`catalog.json` holds one record per seeded *instance* (a specific element on a specific page), not per rule — the same rule (e.g. `label`) fires on 6 different elements across the app, so it has 6 instance records. Every record carries:

- `axeRuleId` — the exact axe-core rule ID this instance triggers
- `wcagCriteria` — WCAG 2.2 success criteria (empty array for best-practice-only rules)
- `impact` — axe-core's default severity: `critical` / `serious` / `moderate`
- `page`, `elementDescription`, `remediation`
- `introducedInBuild` / `fixedInBuild` — which git-tagged build first has the bug, and which build first fixes it (`null` = never fixed, an accepted backlog item)
- `regressionInstance` — `true` for the 9 instances introduced in Build 4's Wishlist/Quick-View/Sale-badge feature, not present in Builds 1–3

**Activation rule**: an instance is active in build *N* if `introducedInBuild`'s index ≤ *N*'s index, AND (`fixedInBuild` is `null` OR `fixedInBuild`'s index > *N*'s index). `build-N-manifest.json` files are this rule applied and filtered per tag.

## Remediation waves

- **Wave A** (fixed by Build 2) — tier-1, "entirely inaccessible to assistive technology": `image-alt`, `label`, `button-name`, `link-name`, `document-title`, `html-has-lang`, `meta-viewport`, `aria-valid-attr-value`. 28 instances.
- **Wave B** (fixed by Build 3) — tier-2/3, structural robustness: `color-contrast` (base instances only), `aria-required-attr`, `heading-order`, `landmark-one-main`, `region`, `duplicate-id-aria`. 17 instances.
- **Remaining debt** (fixed by Build 5, except the accepted backlog) — `aria-hidden-focus`, `autocomplete-valid`, `target-size` (2 of 4), `tabindex`, `aria-dialog-name`, `scrollable-region-focusable`, `nested-interactive`, `th-has-data-cells`, `form-field-multiple-labels`. 26 instances.
- **Accepted backlog** (never fixed) — `frame-title` (contact page map iframe), `target-size` (2 of 4: pagination buttons, checkout radio hit-area).
- **Build 4 regression** — a new Wishlist feature, Quick View modal, and a Sale-badge visual redesign ship without an accessibility review, adding 9 fresh instances across `color-contrast`, `aria-dialog-name`, `scrollable-region-focusable`, `nested-interactive`, `target-size`.

## Build totals

Figures below are from an actual `@axe-core/playwright` 4.12.1 scan of the built app (`runOnly` = `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice`), not hand-counted — see "Empirical corrections" below for how the catalog changed once real scanning began.

| Build | Total active (measured) | Threshold |
|---|---|---|
| build-1 | 87 | 40+ |
| build-2 | TBD after remediation | 30+ |
| build-3 | TBD after remediation | 20+ |
| build-4 | TBD after regression | higher than build-3 |
| build-5 | TBD after stabilization | low / in-control |

## Empirical corrections (design vs. real axe-core behavior)

The catalog was first designed by hand, then verified against a real scan of Build 1. Several assumptions about how specific rules trigger turned out to be wrong; they're recorded here because they're genuinely useful methodology findings, not just implementation notes:

- **`autocomplete-valid` fires on an incorrect *value*, not a missing attribute.** A field with no `autocomplete` attribute at all is not flagged. Every seeded instance uses a syntactically-present-but-wrong token (e.g. `autocomplete="user-name"` instead of `"username"`).
- **`aria-required-attr` only fires for attributes the ARIA spec formally mandates for a role** (e.g. `aria-checked` for `role="checkbox"`/`role="switch"`, `aria-expanded` for `role="combobox"`). Roles like `tab`, `option`, and `listbox` have no formally *required* state, so a "missing `aria-selected`" design targeting a tab doesn't trigger this rule — the catalog uses `role="checkbox"`/`role="switch"` custom toggles instead.
- **`placeholder` counts as a fallback accessible name** (per HTML-AAM), so a text input with a placeholder and no `<label>` does **not** trigger the `label` rule. Every seeded `label` instance has no placeholder either.
- **`document-title` only fires on a missing/empty `<title>`**, not a merely non-descriptive one. `"ShopSmart"` on every page would not be flagged; the two seeded instances use a genuinely empty `<title>`.
- **Elements hidden via `display:none` (or `visibility:hidden`) are excluded from scanning entirely** — this affects anything closed-by-default: modals, dropdown menus, off-canvas panels. All of ShopSmart's overlay components (`.modal-overlay`, `.dropdown-menu`) use a `max-height:0; overflow:hidden; opacity:0` closed state instead, which axe still evaluates, so `aria-dialog-name` and similar checks work on closed-by-default widgets without needing Playwright to click them open first.
- **`target-size` only fires when an undersized target sits with near-zero spacing next to another target.** An isolated undersized button, even alone on the page, passes under WCAG 2.5.8's spacing exception. Every seeded `target-size` instance is one element in an adjacent (zero-gap) pair or group.
- **`scrollable-region-focusable` requires the region to actually overflow** — a `overflow-x:auto` container whose content is narrower than the container never scrolls, so it's never flagged. `.scroll-strip` has an explicit `max-width` chosen to be smaller than its content.
- **`nested-interactive` only fired for a `<button>` wrapping an `<a>`** in this axe-core version, not the reverse (an `<a>` wrapping a `<button>`, despite being at least as common a real-world bug). All seeded instances use "outer button, inner link."
- **`th-has-data-cells` did not fire** for a plain header row of `<td>` elements (no `<th>` at all) in any table size tested. It was replaced with **`scope-attr-valid`** (`scope="col"` placed on a `<td>` instead of a `<th>`), which reliably fires and covers the same WCAG 1.3.1 territory.
- **`duplicate-id-aria` and `form-field-multiple-labels` were confirmed axe-core rules that this catalog intentionally seeds, but both consistently resolved as `incomplete` ("needs review") rather than a confirmed `violation`** for the constructions tried here. They remain in the app's markup (real, defensible bugs) but are **not counted** in the build totals above (`countedAsViolation: false` in `catalog.json`) — a genuine finding about the limits of fully-automated confirmation, worth citing directly as a threat-to-validity data point for RQ3.
- **`region` fires once per top-level content chunk not inside a landmark**, not once per page. A page with no `<main>` at all (dashboard.html, contact.html) produces far more `region` violations (8 and 12 respectively) than the one-per-page count originally assumed. This is still fully remediated by Build 3 (adding `<main>`), it's just a larger number in Builds 1–2 than originally planned.
- **An `<iframe>` with no explicit document (e.g. blank `src`) still gets its own accessibility scan**, and its trivial internal `<html>` has no `<main>` — this adds one incidental `landmark-one-main` hit on the Contact page beyond the two intentionally-seeded instances. Documented rather than engineered around.

## Full rule reference

See `catalog.json` for all 80 instance records. Rule-level summary:

| axe-core rule | WCAG 2.2 | Impact |
|---|---|---|
| `image-alt` | 1.1.1 | critical |
| `label` | 1.3.1, 4.1.2 | critical |
| `button-name` | 4.1.2 | critical |
| `link-name` | 2.4.4, 4.1.2 | serious |
| `document-title` | 2.4.2 | serious |
| `html-has-lang` | 3.1.1 | serious |
| `meta-viewport` | 1.4.4, 1.4.10 | critical |
| `aria-valid-attr-value` | 4.1.2 | critical |
| `color-contrast` | 1.4.3 | serious |
| `aria-required-attr` | 4.1.2 | critical |
| `heading-order` | best-practice | moderate |
| `landmark-one-main` | best-practice | moderate |
| `region` | best-practice | moderate |
| `duplicate-id-aria` | 4.1.2 | moderate |
| `aria-hidden-focus` | 4.1.2 | serious |
| `frame-title` | 4.1.2 | serious |
| `autocomplete-valid` | 1.3.5 | moderate |
| `target-size` | 2.5.8 *(new in WCAG 2.2)* | moderate |
| `tabindex` | best-practice | serious |
| `aria-dialog-name` | best-practice | serious |
| `scrollable-region-focusable` | 2.1.1 | moderate |
| `nested-interactive` | 4.1.2 | serious |
| `th-has-data-cells` | 1.3.1 | serious |
| `form-field-multiple-labels` | 3.3.2 | moderate |
