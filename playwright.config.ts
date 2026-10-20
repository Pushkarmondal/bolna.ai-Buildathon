// End-to-end tests: the built app on `wrangler dev`, with scripts/fake-bolna.ts standing in for
// Bolna, driven in the installed Google Chrome (no browser download). One worker at a time.
//
//   npm run e2e

import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/** worker/.dev.vars holds local test values only; the fake Bolna needs the same two secrets. */
function devVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync('worker/.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m?.[1]) vars[m[1]] = (m[2] ?? '').replace(/^"|"$/g, '');
  }
  return vars;
}
const vars = devVars();
process.env.E2E_PASSCODE ??= vars.APP_PASSCODE;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8787',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write', 'microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: [
    {
      command: 'npm run dev -w worker',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      command: 'npm run fake-bolna',
      port: 8790,
      reuseExistingServer: true,
      env: { TOOL_SECRET: vars.TOOL_SECRET ?? '', WEBHOOK_SECRET: vars.WEBHOOK_SECRET ?? '' },
    },
  ],
});
