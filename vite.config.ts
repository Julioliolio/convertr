import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

// `--mode web` builds the GitHub Pages version: no server, ffmpeg.wasm in the
// browser (see src/web/engine.ts).
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    plugins: [solidPlugin()],
    base: './',
    root: '.',
    publicDir: 'static',
    define: {
      __WEB__: JSON.stringify(web),
    },
    build: {
      outDir: web ? 'dist-web' : 'public-built',
      target: 'esnext',
    },
    // ffmpeg.wasm's worker uses dynamic import(), which iife workers can't do.
    worker: {
      format: 'es',
    },
    // Pre-bundling breaks ffmpeg.wasm's `new URL('./worker.js', import.meta.url)`.
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    server: {
      port: parseInt(process.env.PORT || '5173'),
      proxy: (() => {
        const target = `http://localhost:${process.env.VITE_SERVER_PORT || '3000'}`;
        return Object.fromEntries(
          ['/convert', '/convert-fetched', '/fetch', '/progress', '/serve', '/input', '/download', '/upload', '/estimate', '/preview', '/preview-status'].map(r => [r, target])
        );
      })(),
    },
  };
});
