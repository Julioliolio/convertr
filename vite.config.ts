import { defineConfig, Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only plugin: POST /api/apply-highlight patches EditorView.tsx and HMR picks it up
function applyHighlightPlugin(): Plugin {
  return {
    name: 'apply-highlight',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/apply-highlight', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { dur, x1, y1, x2, y2 } = JSON.parse(body) as Record<string, number>;
            const filePath = path.resolve(process.cwd(), 'src/components/views/EditorView.tsx');
            let src = fs.readFileSync(filePath, 'utf8');

            // Replace first element of each highlight array (the live default value)
            const patch = (prop: string, val: number) => {
              src = src.replace(
                new RegExp(`(highlight:[\\s\\S]{0,400}?${prop}:\\s*\\[)([^,]+)`),
                `$1${val.toFixed(3)}`
              );
            };

            patch('dur', dur / 1000);
            patch('x1', x1);
            patch('y1', y1);
            patch('x2', x2);
            patch('y2', y2);

            fs.writeFileSync(filePath, src);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), applyHighlightPlugin()],
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
        ['/convert', '/convert-fetched', '/fetch', '/progress', '/serve', '/input', '/download', '/upload', '/estimate'].map(r => [r, target])
      );
    })(),
  },
});
