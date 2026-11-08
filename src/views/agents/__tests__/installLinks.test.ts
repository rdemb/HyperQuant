/**
 * Instalacja serwera MCP ze strony: linki Cursora i VS Code (formaty z dokumentacji edytorów), ustawienia OpenBota
 * i JSON klientów. Przed publikacją paczki w npm (`'repo'`) linki są wyłączone, a polecenie prowadzi do bundla z repo;
 * po publikacji (`'npm'`) wszystko używa `npx -y hyperquant-mcp@<wersja>` (wersja przypięta, z mcp/package.json).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OUT } from '../../../../scripts/mcp/bundle-mcpb.mjs';
import {
  BUNDLE_PATH,
  MCPB_SHA256_URL,
  MCPB_URL,
  MCP_STATUS,
  NPM_SPEC,
  NPX_COMMAND,
  REPO_DIR,
  REPO_STEPS,
  claudeDesktopJson,
  cursorInstallLink,
  cursorLink,
  openbotConfig,
  serverConfig,
  vscodeLink,
} from '../installLinks';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const README = read('mcp/README.md');

const MCP_PKG = JSON.parse(read('mcp/package.json')) as { name: string; version: string };
/** Polecenie po publikacji w npm: paczka z przypiętą wersją z mcp/package.json. */
const PINNED = `hyperquant-mcp@${MCP_PKG.version}`;
const NPX = { command: 'npx', args: ['-y', PINNED] };
const CURSOR = 'cursor://anysphere.cursor-deeplink/mcp/install?name=hyperquant&config=';
const VSCODE_REDIRECT = 'https://vscode.dev/redirect?url=';
const VSCODE = 'vscode:mcp/install?';

/** Parametr `config` linku Cursora tak, jak stoi w adresie (przed dekodowaniem). */
const rawConfig = (link: string) => link.slice(link.indexOf('&config=') + '&config='.length);
/** Konfiguracja z linku Cursora: adres dekoduje parametr, potem base64 → JSON. */
const cursorConfig = (link: string): unknown => JSON.parse(atob(new URL(link).searchParams.get('config') ?? ''));
/** Link `vscode:` z opakowania vscode.dev (parametr `url`). */
const vscodeInner = (link: string): string => new URL(link).searchParams.get('url') ?? '';
/** Konfiguracja z linku VS Code: JSON zakodowany w URL po „?”. */
const vscodeConfig = (inner: string): unknown => JSON.parse(decodeURIComponent(inner.slice(VSCODE.length)));

describe('instalacja po publikacji w npm', () => {
  it('serwer to npx -y hyperquant-mcp@<wersja z mcp/package.json>: jedna stała z wersją paczki', () => {
    expect(MCP_PKG.name).toBe('hyperquant-mcp');
    expect(NPM_SPEC).toBe(PINNED);
    expect(NPX_COMMAND).toBe(`npx -y ${PINNED}`);
    expect(serverConfig('npm')).toEqual(NPX);
  });

  it('Cursor: cursor://anysphere.cursor-deeplink/mcp/install?name=hyperquant&config=<base64 JSON-a w URL> → {command, args}', () => {
    const link = cursorLink('npm');
    expect(link?.startsWith(CURSOR)).toBe(true);
    expect(new URL(link ?? '').searchParams.get('name')).toBe('hyperquant');
    expect(cursorConfig(link ?? '')).toEqual(NPX);
  });

  it('VS Code: opakowanie https://vscode.dev/redirect?url= (zalecane dla stron) z linkiem vscode:mcp/install?<JSON w URL>', () => {
    const link = vscodeLink('npm') ?? '';
    expect(link.startsWith(VSCODE_REDIRECT)).toBe(true);
    // Cały link vscode: zakodowany jako jeden parametr (bez surowych „:”, „?”, „{”)
    expect(link.slice(VSCODE_REDIRECT.length)).toMatch(/^[A-Za-z0-9%._~-]+$/);
    const inner = vscodeInner(link);
    expect(inner.startsWith(VSCODE)).toBe(true);
    expect(vscodeConfig(inner)).toEqual({ name: 'hyperquant', type: 'stdio', ...NPX });
    expect(decodeURIComponent(inner)).toContain(`"command":"npx","args":["-y","${PINNED}"]`);
  });

  it('base64 w linku Cursora jest zakodowany w URL: „+”, „/” i „=” nie psują parametru', () => {
    const cfg = { command: '???>>>', args: ['ab'] };
    // Warunek wstępny: ten JSON w base64 ma wszystkie trzy znaki
    const b64 = btoa(JSON.stringify(cfg));
    for (const c of ['+', '/', '=']) expect(b64, c).toContain(c);
    const link = cursorInstallLink('x', cfg);
    expect(rawConfig(link)).toMatch(/^[A-Za-z0-9%]+$/);
    expect(cursorConfig(link)).toEqual(cfg);
    expect(rawConfig(cursorLink('npm') ?? '')).toMatch(/^[A-Za-z0-9%]+$/);
  });

  it('OpenBot: STDIO z tą samą komendą; JSON klientów (mcpServers.hyperquant) się parsuje', () => {
    expect(openbotConfig('npm')).toEqual({ transport: 'STDIO', ...NPX });
    expect(JSON.parse(claudeDesktopJson('npm'))).toEqual({ mcpServers: { hyperquant: NPX } });
  });
});

describe('instalacja z repozytorium (przed publikacją w npm)', () => {
  it('linki Cursora i VS Code wyłączone; serwer to node z bundlem w katalogu repo', () => {
    expect(cursorLink('repo')).toBeNull();
    expect(vscodeLink('repo')).toBeNull();
    expect(serverConfig('repo')).toEqual({ command: 'node', args: [`${REPO_DIR}/${BUNDLE_PATH}`] });
    expect(REPO_DIR).toBe('/path/to/HyperQuant');
  });

  it('OpenBot i JSON klientów z tym samym poleceniem', () => {
    expect(openbotConfig('repo')).toEqual({ transport: 'STDIO', ...serverConfig('repo') });
    expect(JSON.parse(claudeDesktopJson('repo'))).toEqual({ mcpServers: { hyperquant: serverConfig('repo') } });
  });

  it('kroki i ścieżka bundla jak w README paczki i w jej package.json', () => {
    expect(REPO_STEPS).toEqual(['git clone https://github.com/rdemb/HyperQuant.git', 'cd HyperQuant', 'npm ci --legacy-peer-deps', 'npm run mcp:build']);
    for (const s of REPO_STEPS) expect(README, s).toContain(s);
    expect(README).toContain(`node ${BUNDLE_PATH}`);
    const pkg = JSON.parse(read('mcp/package.json')) as { bin: Record<string, string> };
    expect(`mcp/${pkg.bin['hyperquant-mcp']}`).toBe(BUNDLE_PATH);
  });

  it('stan dziś: paczka jest w npm (README mówi to samo), więc strona prowadzi przez npx z wersją przypiętą', () => {
    // Stan strony i README zmieniają się razem: README bez zdania sprzed publikacji, z poleceniem npx tej wersji
    expect(README).toMatch(/published on npm/);
    expect(README).not.toMatch(/not (?:yet )?published/);
    expect(README).toContain(`npx -y ${PINNED}`);
    expect(MCP_STATUS).toBe('npm');
    expect(cursorLink(MCP_STATUS)).not.toBeNull();
    expect(vscodeLink(MCP_STATUS)).not.toBeNull();
  });
});

describe('plik .mcpb na stronie', () => {
  it('suma SHA-256 obok pliku: <adres paczki>.sha256 (skrypt zapisuje <archiwum>.sha256)', () => {
    expect(MCPB_SHA256_URL).toBe(`${MCPB_URL}.sha256`);
  });

  it('adres pliku to miejsce, w które npm run mcp:mcpb zapisuje archiwum w dist', () => {
    expect(MCPB_URL).toBe('./agents/hyperquant.mcpb');
    expect(DEFAULT_OUT).toBe('dist/agents/hyperquant.mcpb');
    expect(`./${DEFAULT_OUT.replace(/^dist\//, '')}`).toBe(MCPB_URL);
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['mcp:mcpb']).toBe('node scripts/mcp/bundle-mcpb.mjs');
  });
});
