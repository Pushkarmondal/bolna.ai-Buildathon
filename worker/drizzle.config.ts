import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations only; Wrangler applies them (`npm run db:migrate:local`).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
