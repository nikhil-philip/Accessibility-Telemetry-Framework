import * as path from 'path';

/**
 * Resolves a path relative to the repo root. Deliberately based on
 * `process.cwd()`, not `__dirname` -- a `__dirname`-relative path (e.g.
 * `path.resolve(__dirname, '../../telemetry/history')`) silently breaks
 * the moment a file's depth from the repo root changes between execution
 * modes: Playwright runs TypeScript "in place" (no separate output
 * directory, so __dirname is the real src/... location), but `tsc`
 * compiling to `dist-ts/` mirrors the whole source tree underneath it,
 * shifting every file one level deeper and quietly pointing `__dirname`-
 * relative paths at the wrong directory. `process.cwd()` is stable across
 * both, as long as the process is launched from the repo root -- true for
 * `npm test`, `npm run <script>`, and every `node ...`/`npx ...`
 * invocation documented in this repo.
 */
export function repoPath(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}
