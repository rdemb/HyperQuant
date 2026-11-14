import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
// Z rozszerzeniem `.ts`: konfigurację wczyta też natywny loader Vite (bez rozwiązywania ścieżek bez rozszerzenia)
import { OPENBOT_DIR, openbotFiles } from './integrations/agents/openbot.ts';

const ROOT = import.meta.dirname;
/** Surowe bajty pliku repo; czytane przy każdym buildzie i żądaniu, więc `npm run dev` podaje bieżącą treść. */
const readRepo = (p: string) => readFileSync(path.join(ROOT, p));
const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

/**
 * Pliki instalacji w OpenBocie (`agents/openbot/…`, lista z `openbotFiles`): w buildzie zasoby `dist` pod stałą nazwą
 * (`fileName` jest względem `outDir`, bez hasha i bez wpływu `base`), w `npm run dev` ten sam adres z middleware.
 */
function openbotFilesPlugin(): Plugin {
  return {
    name: 'hq-openbot-files',
    generateBundle() {
      for (const f of openbotFiles(readRepo)) this.emitFile({ type: 'asset', fileName: `${OPENBOT_DIR}/${f.path}`, source: f.content });
    },
    configureServer(server) {
      const prefix = `/${OPENBOT_DIR}/`;
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split(/[?#]/)[0];
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (!pathname.startsWith(prefix)) return next();
        const file = openbotFiles(readRepo).find((f) => f.path === pathname.slice(prefix.length));
        if (!file) return next();
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file.path)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : file.content);
      });
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), openbotFilesPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1500,
      // Manifest pakietu (dist/.vite/manifest.json) dla kontroli granic: scripts/build/granice-pakietu.mjs
      manifest: true,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
