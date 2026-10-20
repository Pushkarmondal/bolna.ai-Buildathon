import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Every test runs inside the Workers runtime with a fresh local D1, migrated before each file.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Test-only values; Bolna is faked in the tests at https://bolna.test.
          bindings: {
            TEST_MIGRATIONS: migrations,
            LLM_SECRET: 'test-secret',
            GROQ_API_KEY: 'test-key',
            APP_PASSCODE: 'open-sesame',
            COOKIE_SECRET: 'test-cookie-secret',
            TOOL_SECRET: 'test-tool-secret',
            WEBHOOK_SECRET: 'test-hook-secret',
            BOLNA_API_KEY: 'bn-test',
            BOLNA_BASE_URL: 'https://bolna.test',
            BOLNA_DESK_AGENT_ID: 'agent-desk',
            BOLNA_CALLER_AGENT_ID: 'agent-caller',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
