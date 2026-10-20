import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the Worker runs separately under `wrangler dev` on port 8787.
const worker = 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': worker, '/v1': worker, '/tools': worker, '/webhooks': worker },
  },
});
