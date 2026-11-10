import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (mode === 'native') {
    // The apps talk to one server; refuse to build an app that points nowhere or over plain HTTP.
    const origin = env.VITE_API_ORIGIN ?? '';
    const local = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(origin);
    if (!/^https:\/\/[^/]+$/.test(origin) && !local) {
      throw new Error(`VITE_API_ORIGIN must be the server origin over HTTPS (e.g. https://app.example.sa); got "${origin}"`);
    }
  }
  return {
    plugins: [react()],
    server: { proxy: { '/api': 'http://localhost:3000' } },
    // No source maps inside the store apps.
    build: { outDir: 'dist', sourcemap: mode !== 'native' },
  };
});
