import * as path from 'path';
import * as dotenv from 'dotenv';

export type TestEnvironment = 'local' | 'staging' | 'production';

export interface EnvironmentConfig {
  readonly env: TestEnvironment;
  readonly baseURL: string;
  readonly defaultTimeoutMs: number;
  readonly navigationTimeoutMs: number;
  readonly retries: number;
  readonly headless: boolean;
}

const TEST_ENV = (process.env.TEST_ENV as TestEnvironment) || 'local';

// Load `.env.<TEST_ENV>` if present, then fall back to a bare `.env`. Neither
// file is required to exist -- every value below has a safe default, so a
// clean checkout with no .env files at all still runs against ShopSmart.
dotenv.config({ path: path.resolve(__dirname, '../../', `.env.${TEST_ENV}`) });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * One entry per environment ShopSmart (or a future real backend) could run
 * in. Only `local` is concretely reachable today -- `staging`/`production`
 * are stubbed to show new environments are a config change, not a code
 * change, once those URLs exist.
 */
const ENVIRONMENTS: Record<TestEnvironment, Omit<EnvironmentConfig, 'env'>> = {
  local: {
    baseURL: process.env.BASE_URL || 'http://localhost:4300',
    defaultTimeoutMs: 10_000,
    navigationTimeoutMs: 15_000,
    retries: 0,
    headless: true,
  },
  staging: {
    baseURL: process.env.BASE_URL || 'https://staging.shopsmart.example',
    defaultTimeoutMs: 15_000,
    navigationTimeoutMs: 20_000,
    retries: 1,
    headless: true,
  },
  production: {
    baseURL: process.env.BASE_URL || 'https://shopsmart.example',
    defaultTimeoutMs: 20_000,
    navigationTimeoutMs: 30_000,
    retries: 2,
    headless: true,
  },
};

function resolveConfig(): EnvironmentConfig {
  const base = ENVIRONMENTS[TEST_ENV];
  if (!base) {
    throw new Error(
      `Unknown TEST_ENV "${TEST_ENV}". Expected one of: ${Object.keys(ENVIRONMENTS).join(', ')}`,
    );
  }
  return { env: TEST_ENV, ...base };
}

export const envConfig: EnvironmentConfig = resolveConfig();
