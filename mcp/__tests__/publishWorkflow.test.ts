/**
 * Publikacja paczki do npm (`.github/workflows/npm-publish.yml`): zaufany wydawca npm przez OIDC, bez tokenu w sekretach.
 * Tylko ręczne uruchomienie, testy i test stdio przed publikacją, a wersja z mcp/package.json nie może już być w npm.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FILE = path.join(ROOT, '.github', 'workflows', 'npm-publish.yml');
const text = readFileSync(FILE, 'utf8');

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, unknown> };
const wf = parse(text) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { 'runs-on': string; permissions?: unknown; steps: Step[] }>;
};
const jobs = Object.values(wf.jobs);
const steps = jobs[0].steps;
const at = (pred: (s: Step) => boolean) => steps.findIndex(pred);
const runs = (cmd: string) => (s: Step) => (s.run ?? '').split('\n').some((l) => l.trim() === cmd);

describe('publikacja hyperquant-mcp do npm', () => {
  it('tylko ręczne uruchomienie (bez push, tagów i harmonogramu)', () => {
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
  });

  it('OIDC zamiast tokenu: uprawnienia tylko contents: read i id-token: write, żadnych sekretów ani NODE_AUTH_TOKEN', () => {
    expect(wf.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].permissions).toBeUndefined();
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/);
    // Atestacja pochodzenia wymaga runnera GitHuba
    expect(jobs[0]['runs-on']).toBe('ubuntu-latest');
  });

  it('Node 22.14+ i npm CLI 11.5.1+ (wymóg zaufanego wydawcy), rejestr npmjs', () => {
    const node = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(Number(node?.with?.['node-version'])).toBeGreaterThanOrEqual(24);
    expect(node?.with?.['registry-url']).toBe('https://registry.npmjs.org');
    expect(at(runs('npm install -g npm@11'))).toBeGreaterThan(-1);
  });

  it('kolejność: zależności, typy, testy MCP, bundle, test stdio, nowa wersja, publikacja', () => {
    const order = [
      at(runs('npm ci --legacy-peer-deps')),
      at(runs('npm run lint')),
      at(runs('npx vitest run mcp integrations')),
      at(runs('npm run mcp:build')),
      at(runs('node mcp/scripts/stdio-smoke.mjs mcp/dist/hyperquant-mcp.mjs')),
      at((s) => s.name === 'Check Version Is New'),
      at(runs('npm publish -w mcp --access public')),
    ];
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order.at(-1)).toBe(steps.length - 1);
  });

  it('wersja z mcp/package.json, która jest już w npm, zatrzymuje publikację', () => {
    const check = steps.find((s) => s.name === 'Check Version Is New')?.run ?? '';
    expect(check).toContain(`node -p "require('./mcp/package.json').version"`);
    expect(check).toContain('npm view "hyperquant-mcp@$v" version');
    expect(check).toMatch(/then[\s\S]*exit 1[\s\S]*fi/);
  });
});
