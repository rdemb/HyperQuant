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

/**
 * Fonty w pliku HTML zamiast osobnego, blokującego arkusza: przy buildzie deklaracje `@font-face` z
 * `public/fonts/fonts.css` (adresy względem strony: `./fonts/…`) trafiają do <style> w <head>, a fonty pierwszego
 * ekranu (tytuł: Bricolage Grotesque, tekst: Plus Jakarta Sans, łacina) mają preload. Pierwsze malowanie nie czeka na
 * dodatkowe żądanie. Plik `fonts.css` zostaje dla stron statycznych (blog, wyniki). W `npm run dev` bez zmian.
 */
/** Link arkusza fontów w index.html (po przepisaniu adresów przez Vite: `/fonts/…` albo `./fonts/…`). */
const FONTS_LINK = /<link href="\.?\/fonts\/fonts\.css" rel="stylesheet">/;
const FONT_PRELOAD = ['bricolage-grotesque-latin-wdth-normal.woff2', 'plus-jakarta-sans-latin-400-normal.woff2'];
function inlineFontsPlugin(): Plugin {
  return {
    name: 'hq-inline-fonts',
    apply: 'build',
    transformIndexHtml(html, context) {
      if (context.filename !== path.join(ROOT, 'index.html')) return html;
      if (!FONTS_LINK.test(html)) throw new Error('index.html: brak linku do fonts/fonts.css (zmieniony sposób ładowania fontów)');
      const css = readRepo('public/fonts/fonts.css')
        .toString('utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/url\(\.\//g, 'url(./fonts/')
        .replace(/\s*\n\s*/g, '');
      const preload = FONT_PRELOAD.map((f) => `<link rel="preload" href="./fonts/${f}" as="font" type="font/woff2" crossorigin>`).join('');
      return html.replace(FONTS_LINK, `${preload}<style>${css}</style>`);
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), openbotFilesPlugin(), inlineFontsPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: { input: { app: path.join(ROOT, 'index.html'), workbench: path.join(ROOT, 'stanowisko/index.html') } },
      chunkSizeWarningLimit: 1500,
      // Manifest pakietu (dist/.vite/manifest.json) dla kontroli granic: scripts/ui/granice-pakietu.mjs
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
