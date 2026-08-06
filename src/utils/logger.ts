/**
 * A minimal, dependency-free leveled logger. A "production-grade" framework
 * needs structured, timestamped output for CI log triage, but pulling in a
 * logging library (winston/pino) for a test suite that just needs to print
 * to stdout is more than this scope justifies -- console.* under the hood,
 * with a consistent, greppable prefix format.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function format(level: LogLevel, scope: string, message: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`;
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** `createLogger('CartPage')` scopes every line so multi-worker output stays attributable. */
export function createLogger(scope: string): Logger {
  const log = (level: LogLevel, message: string, meta?: unknown) => {
    if (!shouldLog(level)) return;
    const line = format(level, scope, message);
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (meta !== undefined) {
      consoleFn(line, meta);
    } else {
      consoleFn(line);
    }
  };

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
  };
}
