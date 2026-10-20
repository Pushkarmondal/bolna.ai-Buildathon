import { defineConfig } from 'vitest/config';

// The web tests cover plain functions (formatting, the choice, the summary, the chart's maths), so
// they run in Node without a browser. The whole app runs in a real browser in e2e/.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
