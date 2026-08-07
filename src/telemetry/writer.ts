import * as fs from 'fs';
import * as path from 'path';
import { TelemetryRecord } from './schema';
import { createLogger } from '../utils/logger';
import { repoPath } from '../utils/paths';

const logger = createLogger('TelemetryWriter');

// Repo-root-relative, matching ARCHITECTURE.md §5's `telemetry/history/`.
// See src/utils/paths.ts for why this is cwd-relative, not __dirname-relative.
const HISTORY_DIR = repoPath('telemetry/history');

/**
 * Writes one immutable record per build. Never overwrites -- if a record
 * for this commitSha already exists (e.g. a re-run of the same commit),
 * a short numeric suffix is appended rather than clobbering history, since
 * ARCHITECTURE.md's data-at-rest contract for telemetry/history/ is
 * append-only.
 */
export function writeTelemetryRecord(record: TelemetryRecord): string {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  let filename = `build-${record.commitSha}.json`;
  let attempt = 1;
  while (fs.existsSync(path.join(HISTORY_DIR, filename))) {
    attempt += 1;
    filename = `build-${record.commitSha}-${attempt}.json`;
  }

  const outPath = path.join(HISTORY_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n');
  logger.info(`Wrote telemetry record: ${filename} (defectScore=${record.defectScore}, totalNodesFailed=${record.totalNodesFailed})`);
  return outPath;
}
