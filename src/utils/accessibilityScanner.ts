/**
 * Accessibility Scanning Utility (@axe-core/playwright integration).
 *
 * This module is the single place that constructs an AxeBuilder and the
 * single place that decides what a "scan result" looks like. Both
 * src/fixtures/index.ts's `makeAxeBuilder` fixture and every spec that
 * wants a richly-typed result go through here, so there is exactly one
 * source of truth for axe configuration (see axe.config.ts) and exactly
 * one shape engineers can rely on when they read a scan's output.
 *
 * Relationship to src/telemetry/: that pipeline consumes a deliberately
 * slim, rollup-oriented shape (PageAxeResult/RawAxeViolation, matching
 * ARCHITECTURE.md Appendix A) because it feeds a future SPC engine that
 * only needs counts. This module's AccessibilityScanResult is the richer,
 * human/audit-facing counterpart -- full description, help URL, and every
 * affected element -- for engineers who need to know *why* something
 * failed and *where*, not just how many. `toTelemetryAttachment()` at the
 * bottom bridges the two without duplicating axe-config logic.
 */
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { NodeResult, Result } from 'axe-core';
import { AXE_TAGS } from '../config/axe.config';
import { PageAxeResult } from '../telemetry/schema';
import { createLogger } from './logger';

const logger = createLogger('AccessibilityScanner');

export type ImpactLevel = 'critical' | 'serious' | 'moderate' | 'minor' | null;

/** One DOM node axe flagged for a given rule -- requirement 5's "Affected elements". */
export interface AffectedElement {
  /** CSS selector path axe used to locate the node (may cross shadow DOM / iframe boundaries). */
  target: string[];
  /** outerHTML snippet of the failing node, truncated defensively (see MAX_HTML_SNIPPET_LENGTH). */
  html: string;
  /** axe's human-readable "Fix any of the following:" remediation text for this specific node. */
  failureSummary: string | null;
}

/** One rule violated on a page, with every field requirement 5 asks for. */
export interface AccessibilityViolation {
  ruleId: string;
  impact: ImpactLevel;
  description: string;
  help: string;
  helpUrl: string;
  wcagTags: string[];
  affectedElements: AffectedElement[];
  /** Convenience -- equals affectedElements.length, exposed so callers don't recompute it. */
  totalOccurrences: number;
}

export interface AccessibilityScanResult {
  /** Human-readable page name (matches SiteRoute.name from sites.config.ts where applicable). */
  pageName: string;
  url: string;
  scannedAt: string;
  /**
   * Labels *what state the page was in* when scanned -- 'default' for a
   * plain page-load scan, or a description like "quick view modal open"
   * for a scan taken after an interaction (requirement 2, dynamic content).
   */
  scanContext: string;
  violations: AccessibilityViolation[];
  /** Rules axe checked and found no issue with -- useful to prove coverage, not just failures. */
  passesCount: number;
  /** Rules axe couldn't automatically confirm either way; worth a manual look. */
  incompleteCount: number;
  totalViolationNodes: number;
}

export interface ScanOptions {
  /** Restricts the scan to a CSS selector (e.g. scan only a modal while it's open). */
  include?: string[];
  /** Excludes a CSS selector from the scan (e.g. a known third-party widget). */
  exclude?: string[];
  /** Extra axe tags beyond axe.config.ts's defaults, for one-off scans that need a wider net. */
  extraTags?: string[];
  /** axe rule IDs to skip entirely, for a documented, deliberate exception -- use sparingly. */
  disableRules?: string[];
}

const MAX_HTML_SNIPPET_LENGTH = 300;

/**
 * The one place `new AxeBuilder(...)` is called. Centralizing this is what
 * lets axe.config.ts's tag list (which MUST include 'best-practice' --
 * see that file) apply uniformly whether a test uses the `makeAxeBuilder`
 * fixture, `scanPage`, or any future caller.
 */
export function createAxeBuilder(page: Page, options: ScanOptions = {}): AxeBuilder {
  let builder = new AxeBuilder({ page }).withTags([...AXE_TAGS, ...(options.extraTags ?? [])]);

  if (options.include) {
    for (const selector of options.include) builder = builder.include(selector);
  }
  if (options.exclude) {
    for (const selector of options.exclude) builder = builder.exclude(selector);
  }
  if (options.disableRules?.length) {
    builder = builder.disableRules(options.disableRules);
  }

  return builder;
}

function truncate(html: string): string {
  return html.length > MAX_HTML_SNIPPET_LENGTH ? `${html.slice(0, MAX_HTML_SNIPPET_LENGTH)}…` : html;
}

function toAffectedElement(node: NodeResult): AffectedElement {
  return {
    target: node.target as string[],
    html: truncate(node.html),
    failureSummary: node.failureSummary ?? null,
  };
}

function toViolation(result: Result): AccessibilityViolation {
  const affectedElements = result.nodes.map(toAffectedElement);
  return {
    ruleId: result.id,
    impact: (result.impact ?? null) as ImpactLevel,
    description: result.description,
    help: result.help,
    helpUrl: result.helpUrl,
    wcagTags: result.tags.filter((tag) => tag.startsWith('wcag') || tag === 'best-practice'),
    affectedElements,
    totalOccurrences: affectedElements.length,
  };
}

/**
 * The reusable scan function (requirement: "Reusable scan function").
 * Takes a `page` that's already navigated (and, for an authenticated page,
 * already carrying the storageState session -- see requirement 1 below) and
 * returns every violation axe found, fully detailed. Capturing *everything*
 * axe returns (requirement 4) is the default -- ScanOptions only lets a
 * caller narrow scope, never silently drops results.
 *
 * Requirement 1, authenticated pages: this function has no opinion about
 * auth -- it scans whatever DOM state `page` is currently in. Playwright's
 * `chromium` project (playwright.config.ts) applies
 * `storageState: 'playwright/.auth/user.json'` to every test by default,
 * so a test calling scanPage() against e.g. profile.html or cart.html is,
 * by construction, scanning as the authenticated user set up in
 * tests/auth.setup.ts -- no special-casing needed here.
 */
export async function scanPage(
  page: Page,
  params: { pageName: string; scanContext?: string } & ScanOptions,
): Promise<AccessibilityScanResult> {
  const { pageName, scanContext = 'default', ...scanOptions } = params;

  const results = await createAxeBuilder(page, scanOptions).analyze();
  const violations = results.violations.map(toViolation);
  const totalViolationNodes = violations.reduce((sum, v) => sum + v.totalOccurrences, 0);

  logger.info(
    `${pageName} [${scanContext}]: ${violations.length} rule(s) violated, ${totalViolationNodes} node(s), ` +
      `${results.passes.length} rule(s) passed, ${results.incomplete.length} incomplete`,
  );

  return {
    pageName,
    url: page.url(),
    scannedAt: new Date().toISOString(),
    scanContext,
    violations,
    passesCount: results.passes.length,
    incompleteCount: results.incomplete.length,
    totalViolationNodes,
  };
}

/**
 * Requirement 2, dynamic content: scans a page in whatever state `interact`
 * leaves it in, rather than the state it loads in. `interact` runs first
 * (open a modal, expand an accordion, switch a tab, toggle a mobile nav --
 * anything that changes the DOM/ARIA state without a full navigation), then
 * the scan runs against that resulting state. `scanContext` should describe
 * the state in plain language; it ends up in the result and in reports.
 */
export async function scanDynamicState(
  page: Page,
  pageName: string,
  scanContext: string,
  interact: (page: Page) => Promise<void>,
  scanOptions: ScanOptions = {},
): Promise<AccessibilityScanResult> {
  await interact(page);
  return scanPage(page, { pageName, scanContext, ...scanOptions });
}

export interface ScannableRoute {
  name: string;
  path: string;
}

/**
 * Requirement 3, multiple pages automatically: navigates `page` to each
 * route in turn and scans it, returning one AccessibilityScanResult per
 * route. Callers typically pass `SITES` from sites.config.ts, but this
 * takes a plain {name, path}[] so it isn't coupled to that specific
 * registry -- any route list works, including a filtered subset.
 */
export async function scanMultiplePages(
  page: Page,
  routes: readonly ScannableRoute[],
  scanOptions: ScanOptions = {},
): Promise<AccessibilityScanResult[]> {
  const results: AccessibilityScanResult[] = [];
  for (const route of routes) {
    await page.goto(route.path);
    await page.waitForLoadState('domcontentloaded');
    results.push(await scanPage(page, { pageName: route.name, ...scanOptions }));
  }
  return results;
}

/**
 * Bridges this module's rich result into the shape
 * src/telemetry/reporter.ts expects (PageAxeResult, ARCHITECTURE.md
 * Appendix A's rollup contract) -- so a spec that only has an
 * AccessibilityScanResult can still feed the SPC-facing telemetry pipeline
 * via `testInfo.attach('axe-results', ...)` without hand-rolling the
 * mapping itself.
 */
export function toTelemetryAttachment(result: AccessibilityScanResult): PageAxeResult {
  return {
    page: result.pageName,
    violations: result.violations.map((v) => ({
      id: v.ruleId,
      impact: v.impact,
      tags: v.wcagTags,
      nodes: v.affectedElements.map((el) => ({ target: el.target })),
    })),
  };
}
