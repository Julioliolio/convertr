import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  base: './',
  root: '.',
  publicDir: 'static',
  build: {
    outDir: 'public-built',
    target: 'esnext',
  },
  server: {
    port: parseInt(process.env.PORT || '5173'),
    proxy: (() => {
      const target = `http://localhost:${process.env.VITE_SERVER_PORT || '3000'}`;
      return Object.fromEntries(
        ['/convert', '/convert-fetched', '/fetch', '/progress', '/serve', '/download'].map(r => [r, target])
      );
    })(),
  },
});
