/**
 * Instalacja serwera MCP ze strony: linki Cursora i VS Code (formaty z dokumentacji edytorów), ustawienia OpenBota
 * i JSON klientów. Przed publikacją paczki w npm (`'repo'`) linki są wyłączone, a polecenie prowadzi do bundla z repo;
 * po publikacji (`'npm'`) wszystko używa `npx -y hyperquant-mcp`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OUT } from '../../../../scripts/mcp/bundle-mcpb.mjs';
import {
  BUNDLE_PATH,
  MCPB_URL,
  MCP_STATUS,
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

const NPX = { command: 'npx', args: ['-y', 'hyperquant-mcp'] };
const CURSOR = 'cursor://anysphere.cursor-deeplink/mcp/install?name=hyperquant&config=';
const VSCODE = 'vscode:mcp/install?';

/** Parametr `config` linku Cursora tak, jak stoi w adresie (przed dekodowaniem). */
const rawConfig = (link: string) => link.slice(link.indexOf('&config=') + '&config='.length);
/** Konfiguracja z linku Cursora: adres dekoduje parametr, potem base64 → JSON. */
const cursorConfig = (link: string): unknown => JSON.parse(atob(new URL(link).searchParams.get('config') ?? ''));
/** Konfiguracja z linku VS Code: JSON zakodowany w URL po „?”. */
const vscodeConfig = (link: string): unknown => JSON.parse(decodeURIComponent(link.slice(VSCODE.length)));

describe('instalacja po publikacji w npm', () => {
  it('serwer to npx -y hyperquant-mcp', () => {
    expect(serverConfig('npm')).toEqual(NPX);
  });

  it('Cursor: cursor://anysphere.cursor-deeplink/mcp/install?name=hyperquant&config=<base64 JSON-a w URL> → {command, args}', () => {
    const link = cursorLink('npm');
    expect(link?.startsWith(CURSOR)).toBe(true);
    expect(new URL(link ?? '').searchParams.get('name')).toBe('hyperquant');
    expect(cursorConfig(link ?? '')).toEqual(NPX);
  });

  it('VS Code: vscode:mcp/install?<JSON w URL> z nazwą, transportem stdio i tą samą komendą', () => {
    const link = vscodeLink('npm');
    expect(link?.startsWith(VSCODE)).toBe(true);
    expect(vscodeConfig(link ?? '')).toEqual({ name: 'hyperquant', type: 'stdio', ...NPX });
    expect(decodeURIComponent(link ?? '')).toContain('"command":"npx","args":["-y","hyperquant-mcp"]');
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

  it('stan dziś: paczki nie ma w npm (README), więc strona prowadzi przez repo', () => {
    expect(README).toMatch(/not published on npm yet/);
    expect(MCP_STATUS).toBe('repo');
  });
});

describe('plik .mcpb na stronie', () => {
  it('adres pliku to miejsce, w które npm run mcp:mcpb zapisuje archiwum w dist', () => {
    expect(MCPB_URL).toBe('./agents/hyperquant.mcpb');
    expect(DEFAULT_OUT).toBe('dist/agents/hyperquant.mcpb');
    expect(`./${DEFAULT_OUT.replace(/^dist\//, '')}`).toBe(MCPB_URL);
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['mcp:mcpb']).toBe('node scripts/mcp/bundle-mcpb.mjs');
  });
});
