/**
 * L7 DASHBOARD GENERATOR (ARCHITECTURE.md Layer 7).
 *
 * Builds one DashboardData object via src/dashboard/dashboardDataBuilder.ts
 * (which itself only calls the existing, unmodified L4/L5/L6 and
 * experiment-analysis functions -- see that file's header) and writes it
 * to disk twice:
 *
 *  - telemetry/aggregated/dashboard-data.json -- the regenerable aggregate
 *    artifact ARCHITECTURE.md §4 documents ("recomputed each run from the
 *    rolling window; disposable/regenerable"), already .gitignore'd.
 *  - dashboard/data.json -- a copy alongside the static site so the whole
 *    dashboard/ folder is a single, self-contained deployable unit
 *    (GitHub Pages / workflow artifact, per ARCHITECTURE.md §7). Also
 *    already .gitignore'd -- this script is the only thing that produces it.
 *
 * The static site itself (index.html, dashboard.css, dashboard.js) is
 * copied verbatim from src/dashboard/templates/ -- this script contains no
 * markup or rendering logic of its own, only file I/O.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/generate-dashboard.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildDashboardData } from '../src/dashboard/dashboardDataBuilder';
import { repoPath } from '../src/utils/paths';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('GenerateDashboard');

const AGGREGATED_DIR = repoPath('telemetry/aggregated');
const DASHBOARD_DIR = repoPath('dashboard');
const TEMPLATES_DIR = repoPath('src/dashboard/templates');

function assertSafeToClear(dir: string, mustContain: string): void {
  const normalized = dir.replace(/\\/g, '/');
  if (!normalized.includes(mustContain)) {
    throw new Error(`Refusing to clear "${dir}" -- does not look like a generated dashboard directory.`);
  }
}

function copyTemplates(destDir: string): void {
  const assetsDir = path.join(destDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES_DIR, 'index.html'), path.join(destDir, 'index.html'));
  fs.copyFileSync(path.join(TEMPLATES_DIR, 'dashboard.css'), path.join(assetsDir, 'dashboard.css'));
  fs.copyFileSync(path.join(TEMPLATES_DIR, 'dashboard.js'), path.join(assetsDir, 'dashboard.js'));
}

function main(): void {
  console.log('=== L7 DASHBOARD GENERATOR ===\n');

  const data = buildDashboardData();
  const json = JSON.stringify(data, null, 2) + '\n';

  fs.mkdirSync(AGGREGATED_DIR, { recursive: true });
  fs.writeFileSync(path.join(AGGREGATED_DIR, 'dashboard-data.json'), json);
  logger.info(`Wrote ${path.join(AGGREGATED_DIR, 'dashboard-data.json')}`);

  assertSafeToClear(DASHBOARD_DIR, '/dashboard');
  fs.rmSync(DASHBOARD_DIR, { recursive: true, force: true });
  fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
  copyTemplates(DASHBOARD_DIR);
  fs.writeFileSync(path.join(DASHBOARD_DIR, 'data.json'), json);
  logger.info(`Wrote static site to ${DASHBOARD_DIR}`);

  console.log(`\nProduction:   ${data.production.history.length} builds, gate=${data.production.gateVerdict.status}, spcState=${data.production.spcReport.processState}`);
  console.log(
    `Experiment A: ${data.experimentA.expandingHistory.results.length} builds -- ` +
      `expanding ${data.experimentA.expandingHistory.summary.passCount}/${data.experimentA.expandingHistory.summary.warnCount}/${data.experimentA.expandingHistory.summary.failCount} (P/W/F), ` +
      `trailing ${data.experimentA.trailingWindow.summary.passCount}/${data.experimentA.trailingWindow.summary.warnCount}/${data.experimentA.trailingWindow.summary.failCount} (P/W/F)`,
  );
  console.log(`Experiment B: ${data.experimentB.history.length} builds, Cpu=${data.experimentB.spcReport.capability.cpu?.toFixed(4) ?? 'n/a'}, capable=${data.experimentB.spcReport.capability.capable}`);
  console.log(`\nOpen ${path.join(DASHBOARD_DIR, 'index.html')} in a browser (serve the folder over http:// -- file:// fetch() of data.json is blocked by some browsers).`);
}

main();
