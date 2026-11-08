/**
 * Paczka `.mcpb` dla Claude Desktop (MANIFEST.md, wersja manifestu 0.3, repo modelcontextprotocol/mcpb): skrypt
 * `npm run mcp:mcpb` na świeżym bundlu zbudowanym w katalogu tymczasowym (bez wyścigu z innymi testami o `mcp/dist`).
 * Archiwum ma manifest z polami wymaganymi przez specyfikację, bundle jako punkt wejścia i `node_modules` tylko
 * z zależnościami wykonania paczki (SDK serwera MCP z jego rdzeniem i zod), bez trafień wzorców publikacji. Rozpakowane
 * w obcym katalogu startuje przez prawdziwe stdio na samych dołączonych zależnościach.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { homePathHits, publishHits } from '../../integrations/__tests__/publishPatterns';
import { TOOLS } from '../src/tools/index';
import { type ZipEntry, readZip } from './zip';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'mcp', 'bundle-mcpb.mjs');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const SMOKE = path.join(ROOT, 'mcp', 'scripts', 'stdio-smoke.mjs');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const PKG = JSON.parse(read('mcp/package.json')) as { version: string; engines: { node: string }; dependencies: Record<string, string> };

const ENTRY = 'server/hyperquant-mcp.mjs';
/** Zależności wykonania paczki: dwie bezpośrednie z mcp/package.json i rdzeń SDK (zależność `@modelcontextprotocol/server`). */
const RUNTIME = ['@modelcontextprotocol/core', '@modelcontextprotocol/server', 'zod'];
/** Pola najwyższego poziomu dozwolone przez schemat manifestu 0.3 (`additionalProperties: false`). */
const V03_KEYS = new Set([
  '$schema',
  'dxt_version',
  'manifest_version',
  'name',
  'display_name',
  'version',
  'description',
  'long_description',
  'author',
  'repository',
  'homepage',
  'documentation',
  'support',
  'icon',
  'icons',
  'screenshots',
  'localization',
  'server',
  'tools',
  'tools_generated',
  'prompts',
  'prompts_generated',
  'keywords',
  'license',
  'privacy_policies',
  'compatibility',
  'user_config',
  '_meta',
]);

interface Manifest {
  manifest_version: string;
  name: string;
  version: string;
  description: string;
  author: Record<string, string>;
  server: { type: string; entry_point: string; mcp_config: { command: string; args: string[]; env?: Record<string, string> } };
  tools: Record<string, string>[];
  compatibility: { platforms: string[]; runtimes: Record<string, string> };
  [k: string]: unknown;
}

const node = (args: string[], cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60_000 });

let tmp = '';
let bundle = '';
let archive = '';
let entries: ZipEntry[] = [];
const entry = (name: string) => entries.find((e) => e.name === name);
const manifest = () => JSON.parse(entry('manifest.json')?.data.toString('utf8') ?? 'null') as Manifest;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'hq-mcpb-'));
  const outDir = path.join(tmp, 'build');
  const b = spawnSync(process.execPath, [VITE, 'build', '--config', 'mcp/vite.config.ts', '--outDir', outDir, '--logLevel', 'warn'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (b.status !== 0) throw new Error(`vite build: ${b.status}\n${b.stdout}\n${b.stderr}`);
  bundle = path.join(outDir, 'hyperquant-mcp.mjs');
  archive = path.join(tmp, 'out', 'hyperquant.mcpb');
  const r = node([SCRIPT, '--bundle', bundle, '--out', archive]);
  if (r.status !== 0) throw new Error(`bundle-mcpb: ${r.status}\n${r.stdout}\n${r.stderr}`);
  entries = readZip(readFileSync(archive));
}, 180_000);
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('archiwum .mcpb', () => {
  it('manifest.json z polami wymaganymi przez MANIFEST.md 0.3, wersją paczki i 10 narzędziami serwera', () => {
    const m = manifest();
    expect(Object.keys(m).filter((k) => !V03_KEYS.has(k))).toEqual([]);
    expect(m.manifest_version).toBe('0.3');
    for (const k of ['name', 'version', 'description'] as const) expect(m[k].trim().length, k).toBeGreaterThan(0);
    expect(m.name).toBe('hyperquant-mcp');
    expect(m.version).toBe(PKG.version);
    expect(m.author.name.trim().length).toBeGreaterThan(0);
    expect(Object.keys(m.author).filter((k) => !['name', 'email', 'url'].includes(k))).toEqual([]);
    expect(m.author.email).toBeUndefined();
    expect(m.server).toEqual({ type: 'node', entry_point: ENTRY, mcp_config: { command: 'node', args: [`\${__dirname}/${ENTRY}`] } });
    expect(m.compatibility).toEqual({ platforms: ['darwin', 'win32'], runtimes: { node: '>=20.0.0' } });
    expect(PKG.engines.node).toBe('>=20');
    expect(m.tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of m.tools) expect(Object.keys(t).sort(), t.name).toEqual(['description', 'name']);
    expect(m.description).toContain('not investment advice');
    // Te same funkcje co strona, ale cena z ostatniego zamknięcia 1m: liczby mogą się nieco różnić w tej samej chwili
    expect(m.long_description).toMatch(/same functions as the site[^.]*latest 1-minute close[^.]*differ slightly/);
    // Serwer nie wysyła danych użytkownika (tylko User-Agent z wersją paczki): bez privacy_policies
    expect(m.privacy_policies).toBeUndefined();
    // W archiwum ten sam manifest co w repo
    expect(m).toEqual(JSON.parse(read('mcp/mcpb/manifest.json')));
  });

  it('entry_point jest w archiwum i to bajt w bajt zbudowany bundle, bez Reacta', () => {
    const e = entry(manifest().server.entry_point);
    expect(e).toBeDefined();
    expect(e?.data.equals(readFileSync(bundle))).toBe(true);
    const text = e?.data.toString('utf8') ?? '';
    for (const banned of ['node_modules/react', 'react.production', 'useSyncExternalStore']) expect(text, banned).not.toContain(banned);
  });

  it('pliki: tylko manifest, licencja paczki, bundle i node_modules zależności wykonania (bez map, typów i źródeł TS), ścieżki względne', () => {
    const names = entries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    const pkgOf = (n: string) => RUNTIME.find((p) => n.startsWith(`node_modules/${p}/`));
    expect(names.filter((n) => n !== 'manifest.json' && n !== 'LICENSE' && n !== ENTRY && !pkgOf(n))).toEqual([]);
    // Licencja MIT paczki w katalogu głównym archiwum (ta sama co mcp/LICENSE), zaraz po manifeście
    expect(names.slice(0, 3)).toEqual(['manifest.json', 'LICENSE', ENTRY]);
    expect(entry('LICENSE')?.data.toString('utf8').replace(/\r\n/g, '\n')).toBe(read('mcp/LICENSE'));
    expect([...new Set(names.map(pkgOf).filter(Boolean))].sort()).toEqual(RUNTIME);
    expect(names.filter((n) => /^[/\\]|^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/.test(n))).toEqual([]);
    expect(names.filter((n) => /\.(?:map|[cm]?ts)$/.test(n))).toEqual([]);
    expect(names.filter((n) => /(?:^|\/)node_modules\/.*\/node_modules\//.test(n))).toEqual([]);
    // Wersje jak w zależnościach paczki; rdzeń SDK to zależność serwera
    const pkgJson = (p: string) => JSON.parse(entry(`node_modules/${p}/package.json`)?.data.toString('utf8') ?? 'null') as { version: string; dependencies?: Record<string, string> };
    expect(pkgJson('@modelcontextprotocol/server').version).toBe(PKG.dependencies['@modelcontextprotocol/server']);
    expect(Object.keys(pkgJson('@modelcontextprotocol/server').dependencies ?? {}).sort()).toEqual(['@modelcontextprotocol/core', 'zod']);
    expect(pkgJson('zod').version.startsWith('4.')).toBe(true);
    for (const p of RUNTIME) expect(entry(`node_modules/${p}/LICENSE`), p).toBeDefined();
  });

  it('bez trafień wzorców publikacji: manifest i bundle w całości, zależności bez ścieżek domowych', () => {
    for (const name of ['manifest.json', ENTRY]) expect(publishHits(entry(name)?.data.toString('utf8') ?? ''), name).toEqual([]);
    expect(entries.flatMap((e) => homePathHits(e.data.toString('utf8')).map((h) => `${e.name}: ${h}`))).toEqual([]);
  });

  it('rozpakowane w obcym katalogu: zależności z archiwum, start przez prawdziwe stdio (initialize + tools/list, 10 narzędzi)', () => {
    const dir = path.join(tmp, 'installed');
    for (const e of entries) {
      const file = path.join(dir, ...e.name.split('/'));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, e.data);
    }
    // Rozwiązanie importu z katalogu instalacji trafia w dołączone node_modules, nie w zależności repo
    const resolved = spawnSync(process.execPath, ['--input-type=module', '-e', "console.log(import.meta.resolve('@modelcontextprotocol/server'))"], {
      cwd: path.join(dir, 'server'),
      encoding: 'utf8',
    });
    expect(resolved.status, resolved.stderr).toBe(0);
    // Ścieżki rzeczywiste po obu stronach (Windows: katalog tymczasowy bywa w krótkiej nazwie 8.3)
    const real = (p: string) => realpathSync.native(p).toLowerCase();
    expect(real(fileURLToPath(resolved.stdout.trim())).startsWith(real(dir))).toBe(true);
    const r = node([SMOKE, path.join(dir, ...ENTRY.split('/'))], dir);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('10 tools');
  });

  it('obok archiwum plik <archiwum>.sha256 z sumą SHA-256 w formacie sha256sum („<hex>  hyperquant.mcpb”)', () => {
    const sum = readFileSync(`${archive}.sha256`, 'utf8');
    expect(sum).toBe(`${createHash('sha256').update(readFileSync(archive)).digest('hex')}  hyperquant.mcpb\n`);
  });

  it('ten sam wynik przy każdym uruchomieniu (stałe daty i kolejność plików); rozmiar do pobrania z rozsądnym zapasem', () => {
    const again = path.join(tmp, 'again.mcpb');
    const r = node([SCRIPT, '--bundle', bundle, '--out', again]);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(again).equals(readFileSync(archive))).toBe(true);
    // Ta sama suma, z nazwą swojego pliku
    expect(readFileSync(`${again}.sha256`, 'utf8')).toBe(readFileSync(`${archive}.sha256`, 'utf8').replace('hyperquant.mcpb', 'again.mcpb'));
    expect(readFileSync(archive).length).toBeLessThan(4 * 1024 * 1024);
  });

  it('bez bundla: błąd z poleceniem, które go buduje', () => {
    const r = node([SCRIPT, '--bundle', path.join(tmp, 'brak.mjs'), '--out', path.join(tmp, 'x.mcpb')]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('npm run mcp:build');
  });
});

describe('wdrożenie strony (static.yml)', () => {
  type Step = { name?: string; run?: string; if?: string };
  const steps = (parse(read('.github/workflows/static.yml')) as { jobs: { build: { steps: Step[] } } }).jobs.build.steps;
  const at = (cmd: string) => steps.findIndex((s) => s.run?.trim() === cmd);

  it('npm run mcp:mcpb po npm run build (dist już zbudowany), pod tym samym warunkiem wdrożenia', () => {
    const build = at('npm run build');
    const mcpb = at('npm run mcp:mcpb');
    expect(build).toBeGreaterThan(-1);
    expect(mcpb).toBeGreaterThan(build);
    expect(steps[mcpb].if).toBe("steps.gate.outputs.deploy == 'true'");
    expect(steps[mcpb].if).toBe(steps[build].if);
    // Bundle zbudowany i sprawdzony testem stdio przed buildem strony
    expect(at('npm run mcp:build')).toBeGreaterThan(-1);
    expect(at('npm run mcp:build')).toBeLessThan(mcpb);
  });

  it('bramka wdrożenia bez zmian', () => {
    const gate = steps.find((s) => s.name === 'Decide Deploy');
    expect(gate?.run).toContain('if [ "$EVENT" != schedule ] || [ "$CHANGED" = true ]; then');
    expect(gate?.run).toContain('echo "deploy=true" >> "$GITHUB_OUTPUT"');
  });
});
