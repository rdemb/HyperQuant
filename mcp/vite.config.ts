/**
 * Bundle paczki `hyperquant-mcp`: jeden plik ESM `mcp/dist/hyperquant-mcp.mjs` dla Node (build SSR Vite) z kodem
 * `src/` w środku. Na zewnątrz zostają tylko `@modelcontextprotocol/server` i `zod` (zależności paczki).
 * Uruchamiane z katalogu repo: `npm run mcp:build`.
 */
import path from 'node:path';
import { type Plugin, defineConfig } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const I18N = path.join(root, 'src', 'i18n.ts');
const I18N_NODE = path.join(root, 'mcp', 'src', 'i18nNode.ts');

/** Ten sam plik: ścieżki znormalizowane (Vite podaje „C:/…”), na Windows bez różnicy wielkości liter (litera dysku). */
const sameFile = (a: string, b: string): boolean => {
  const n = (p: string) => path.resolve(p.split('?')[0]);
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/**
 * Alias `src/i18n.ts` → `mcp/src/i18nNode.ts` po rozwiązanej ścieżce pliku: moduły `src/` importują i18n względnie
 * (`../i18n`, `../../../i18n`), więc zwykły alias po tekście importu by ich nie złapał. Gdyby mimo to `src/i18n.ts`
 * trafił do bundla (np. nowy sposób importu), `load` przerywa build — zamiast po cichu wydać serwer po polsku.
 */
function i18nNode(): Plugin {
  return {
    name: 'hq-i18n-node',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!/(?:^|\/)i18n(?:\.ts)?$/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r && sameFile(r.id, I18N) ? I18N_NODE : null;
    },
    load(id) {
      if (sameFile(id, I18N)) this.error(`src/i18n.ts w bundlu MCP: alias na mcp/src/i18nNode.ts nie zadziałał (${id})`);
      return null;
    },
  };
}

export default defineConfig({
  root,
  // Bez plików `.env*` i katalogu `public/` w bundlu paczki npm
  envDir: false,
  publicDir: false,
  plugins: [i18nNode()],
  resolve: {
    alias: { '@': root },
  },
  // React z `src/state/useBlogMaps.ts` (tylko import, hooki się nie wykonują) w wersji produkcyjnej
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  ssr: {
    noExternal: true,
    external: ['@modelcontextprotocol/server', '@modelcontextprotocol/server/stdio', 'zod'],
  },
  build: {
    ssr: 'mcp/src/main.ts',
    outDir: 'mcp/dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      output: {
        format: 'es',
        entryFileNames: 'hyperquant-mcp.mjs',
        banner: '#!/usr/bin/env node',
        codeSplitting: false,
      },
    },
  },
});
