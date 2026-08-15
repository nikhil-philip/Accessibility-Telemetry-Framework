/**
 * Minimal, dependency-free static file server for the generated dashboard/
 * folder (ARCHITECTURE.md Layer 7). Exists only so
 * playwright.dashboard.config.ts's webServer can load the dashboard in a
 * real browser for testing -- fetch('data.json') is blocked by Chromium
 * over file://, so the folder must be served over http. Uses Node's
 * built-in http/fs rather than adding a `serve`/`http-server` dependency,
 * matching this project's stated preference for staying lightweight
 * (ARCHITECTURE.md §7).
 *
 * This is test/dev infrastructure only -- it does not read telemetry, does
 * not compute anything, and is not part of the L7 dashboard architecture
 * (src/dashboard/). It only serves whatever scripts/generate-dashboard.ts
 * already wrote to dashboard/.
 *
 * Run with:
 *   npx tsc -p tsconfig.json && node dist-ts/scripts/serve-dashboard.js
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { repoPath } from '../src/utils/paths';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('ServeDashboard');

const ROOT = repoPath('dashboard');
const PORT = Number(process.env.DASHBOARD_PORT) || 4310;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Maps a request URL to a file under dashboard/, refusing to escape ROOT (defends against a "../" path). */
function resolveFilePath(requestUrl: string): string {
  const decoded = decodeURIComponent(requestUrl.split('?')[0] ?? '/');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.normalize(path.join(ROOT, relative));
  if (!resolved.startsWith(ROOT)) {
    throw new Error(`Refusing to serve path outside dashboard/: ${requestUrl}`);
  }
  return resolved;
}

const server = http.createServer((req, res) => {
  try {
    const filePath = resolveFilePath(req.url ?? '/');
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const contentType = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    logger.warn(`Blocked request for ${req.url}`, err);
  }
});

server.listen(PORT, () => {
  logger.info(`Dashboard server listening on http://localhost:${PORT} (serving ${ROOT})`);
});
