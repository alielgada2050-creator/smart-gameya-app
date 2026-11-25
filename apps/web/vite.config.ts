import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const VERSION: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const BUILD = `${VERSION}+${Date.now().toString(36)}`;

/** Writes version.json next to index.html: the open app polls it and offers «تحديث متاح» when a newer build is live. */
const versionFile = () => ({
  name: 'sg-version',
  generateBundle(this: any) { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION, build: BUILD }) }); },
});

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
  const demo = mode === 'demo';
  return {
    plugins: [react(), ...(demo || mode === 'native' ? [] : [versionFile()])],
    define: { __APP_VERSION__: JSON.stringify(VERSION), __BUILD_ID__: JSON.stringify(BUILD) },
    server: { proxy: { '/api': 'http://localhost:3000' } },
    // Demo: a self-contained page (relative paths) whose API runs in the browser; financial-core's hashing via a shim.
    base: demo ? './' : '/',
    resolve: demo ? { alias: { 'node:crypto': new URL('./src/demo/crypto-shim.ts', import.meta.url).pathname } } : undefined,
    // No source maps inside the store apps or the demo.
    build: { outDir: demo ? 'dist-demo' : 'dist', sourcemap: mode !== 'native' && !demo },
  };
});
