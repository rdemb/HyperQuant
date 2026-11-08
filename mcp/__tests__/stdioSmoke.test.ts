/**
 * Zbudowany bundle przez prawdziwe stdio: skrypt `mcp/scripts/stdio-smoke.mjs` (ten sam co w CI) na `mcp/dist`, skrypt
 * odrzucający zanieczyszczony stdout i złą listę narzędzi, treść bundla wobec zasad publikacji i lista plików paczki npm.
 * Bundle budowany raz przez `npm run mcp:build`, gdy go nie ma albo jest starszy niż kod, z którego powstaje.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BUNDLE = path.join(ROOT, 'mcp', 'dist', 'hyperquant-mcp.mjs');
const SMOKE = path.join(ROOT, 'mcp', 'scripts', 'stdio-smoke.mjs');
const TOOLS = ['day_map', 'session_context', 'session_review', 'liquidation_map', 'liquidation_tape', 'cohort_flow', 'whales', 'twaps', 'forecast_ledger', 'market_brief'];
/** Ścieżka w katalogu domowym dowolnego użytkownika (Windows, macOS, Linux). */
const LOCAL_PATH = /(?<![A-Za-z])[A-Za-z]:[\\/]+Users[\\/]|\/Users\/[A-Za-z]|\/home\/[A-Za-z]/i;

/** Najnowsza zmiana plików, z których powstaje bundle (kod paczki i strony bez testów, konfiguracja buildu). */
function newestSource(): number {
  let newest = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__') walk(p);
      } else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'mcp', 'src'));
  for (const f of ['mcp/vite.config.ts', 'mcp/package.json', 'package.json']) newest = Math.max(newest, statSync(path.join(ROOT, f)).mtimeMs);
  return newest;
}

const node = (args: string[]) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });

let tmp = '';
beforeAll(() => {
  if (!existsSync(BUNDLE) || statSync(BUNDLE).mtimeMs < newestSource()) {
    // Jedno polecenie jako tekst: powłoka potrzebna do „npm” na Windows (npm.cmd), bez tablicy argumentów obok `shell`
    const r = spawnSync('npm run mcp:build', { cwd: ROOT, encoding: 'utf8', shell: true, timeout: 170_000 });
    if (r.status !== 0) throw new Error(`npm run mcp:build: ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  tmp = mkdtempSync(path.join(tmpdir(), 'hq-smoke-'));
}, 180_000);
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/**
 * Fałszywy serwer MCP do sprawdzenia samego skryptu: odpowiada na `initialize` i `tools/list` listą `tools`; `noise` —
 * linia wypisana na stdout przed odpowiedziami (jak `console.log` w imporcie; pusty tekst — pusta linia).
 */
function fakeServer(name: string, tools: readonly string[], noise?: string): string {
  const file = path.join(tmp, `${name}.mjs`);
  writeFileSync(
    file,
    `import { createInterface } from 'node:readline';
${noise === undefined ? '' : `process.stdout.write(${JSON.stringify(noise)} + '\\n');`}
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0.0.0' } } });
  if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: ${JSON.stringify(tools)}.map((name) => ({ name, inputSchema: { type: 'object' } })) } });
});
`
  );
  return file;
}

describe('test dymny stdio', () => {
  it('bundle przez prawdziwe stdio: initialize (2025-11-25) i tools/list — 10 narzędzi, każda linia stdout to JSON-RPC 2.0', () => {
    const r = node([SMOKE, BUNDLE]);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('2025-11-25');
    expect(r.stdout).toContain('10');
  });

  it('skrypt przechodzi z poprawnym serwerem, a odrzuca linię spoza protokołu na stdout (także pustą) i złą listę narzędzi', () => {
    expect(node([SMOKE, fakeServer('ok', TOOLS)]).status).toBe(0);
    const noisy = node([SMOKE, fakeServer('noisy', TOOLS, 'debug: start')]);
    expect(noisy.status).not.toBe(0);
    expect(noisy.stderr).toContain('JSON-RPC');
    const blank = node([SMOKE, fakeServer('blank', TOOLS, '')]);
    expect(blank.status).not.toBe(0);
    expect(blank.stderr).toContain('JSON-RPC');
    expect(node([SMOKE, fakeServer('short', TOOLS.slice(1))]).status).not.toBe(0);
    expect(node([SMOKE, fakeServer('extra', [...TOOLS, 'place_order'])]).status).not.toBe(0);
    expect(node([SMOKE]).status).not.toBe(0);
  });

  it('bundle bez kodu wykresów, map źródeł i ścieżek lokalnych (katalog domowy, dysk Windows)', () => {
    const text = readFileSync(BUNDLE, 'utf8');
    // Bez Reacta (moduły strony z hookami nie trafiają do serwera; strażnik w mcp/vite.config.ts)
    for (const banned of ['lightweight-charts', 'createChart', 'new Worker', 'sourceMappingURL', 'node_modules/react', 'react.production']) {
      expect(text, banned).not.toContain(banned);
    }
    expect(text).not.toMatch(LOCAL_PATH);
    // Ścieżki modułów w komentarzach bundla tylko względem repo (np. „src/utils/…”)
    for (const region of text.match(/^\/\/#region .*$/gm) ?? []) expect(region).not.toMatch(/^\/\/#region (?:[A-Za-z]:|\/)/);
    expect(text.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('import Reacta w kodzie serwera przerywa build bundla (strażnik w konfiguracji Vite), z nazwą modułu w błędzie', () => {
    for (const mod of ['react', 'react/jsx-runtime', 'react-dom']) {
      const dir = mkdtempSync(path.join(tmp, 'react-'));
      const entry = path.join(dir, 'entry.ts');
      writeFileSync(entry, `import * as m from '${mod}';\nconsole.error(Object.keys(m).length);\n`);
      const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'mcp/vite.config.ts', '--ssr', entry, '--outDir', path.join(dir, 'out')], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(r.status, mod).not.toBe(0);
      expect(`${r.stdout}\n${r.stderr}`, mod).toContain(`React w bundlu MCP: ${mod}`);
    }
  }, 120_000);

  it('paczka npm: dokładnie bundle, README, LICENSE i package.json', () => {
    // Bez skryptów paczki: `prepack` przebudowałby mcp/dist w trakcie testów, które czytają bundle (zbudowany w beforeAll);
    // to, że `prepack` buduje bundle, sprawdza package.test.ts
    const r = spawnSync('npm pack --dry-run --json --ignore-scripts -w mcp', { cwd: ROOT, encoding: 'utf8', shell: true, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const [pack] = JSON.parse(r.stdout) as { files: { path: string }[] }[];
    expect(pack.files.map((f) => f.path).sort()).toEqual(['LICENSE', 'README.md', 'dist/hyperquant-mcp.mjs', 'package.json']);
  }, 60_000);
});
