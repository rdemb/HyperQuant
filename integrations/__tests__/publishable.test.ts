/**
 * Pliki do publikacji (cała paczka MCP bez bundla, integracje, zakładka Agenci AI na stronie, skrypt paczki `.mcpb`) bez
 * ścieżek domowych, sekretów, kluczy, adresów i e-maili (ogólne wzorce w `publishPatterns.ts`), z poleceniami instalacji
 * z przypiętą wersją paczki.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, readRepo } from './markdown';
import { PATTERN_WHYS, publishHits as hitsIn } from './publishPatterns';

/** Katalogi czytane w całości (jeśli są), bez zbudowanego bundla i zależności. */
const DIRS = ['mcp', 'integrations', 'src/views/agents', 'scripts/mcp'];
const SKIP = new Set(['dist', 'node_modules']);
const TEXT = /\.(?:ts|tsx|mts|mjs|js|json|md)$/;

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return TEXT.test(rel) ? [rel] : [];
  return readdirSync(abs)
    .filter((n) => !SKIP.has(n))
    .flatMap((n) => walk(`${rel}/${n}`));
}

const PUBLISHED = DIRS.flatMap(walk);

describe('pliki do publikacji', () => {
  it('lista plików obejmuje całą paczkę MCP (bez bundla), skill, szablony agentów, zakładkę Agenci AI i skrypt .mcpb', () => {
    for (const f of [
      'mcp/src/tools/index.ts',
      'mcp/README.md',
      'mcp/package.json',
      'mcp/vite.config.ts',
      'mcp/scripts/stdio-smoke.mjs',
      'mcp/__tests__/sources.test.ts',
      'mcp/mcpb/manifest.json',
      'integrations/skills/hyperquant/SKILL.md',
      'integrations/agents/index.ts',
      'integrations/agents/hyperquant-desk.md',
      'integrations/agents/big-hands.md',
      'integrations/agents/session-review.md',
      'integrations/__tests__/publishable.test.ts',
      'integrations/__tests__/publishPatterns.ts',
      'src/views/agents/AgentsView.tsx',
      'src/views/agents/installLinks.ts',
      'scripts/mcp/bundle-mcpb.mjs',
    ]) {
      expect(PUBLISHED, f).toContain(f);
    }
    expect(PUBLISHED.filter((f) => /(?:^|\/)(?:dist|node_modules)\//.test(f))).toEqual([]);
  });

  it('bez ścieżek domowych, sekretów, adresów i e-maili', () => {
    expect(PUBLISHED.flatMap((f) => hitsIn(readRepo(f)).map((h) => `${f}: ${h}`))).toEqual([]);
  });

  it('wzorce w publicznym pliku tylko ogólne: ścieżki domowe, sekrety i klucze, adresy (oraz IP i e-mail osobno)', () => {
    expect(PATTERN_WHYS).toEqual([
      'ścieżka domowa (Windows)',
      'ścieżka domowa (macOS, Linux)',
      'adres portfela',
      'hash albo klucz (64 hex)',
      'sekret przypisany wprost',
      'adres portfela lub hash transakcji',
      'token lub klucz dostępu',
    ]);
  });

  it('polecenia instalacji z npm tylko z wersją przypiętą: hyperquant-mcp@<wersja z mcp/package.json>', () => {
    const version = (JSON.parse(readRepo('mcp/package.json')) as { version: string }).version;
    // Nazwa składana z części: wzorzec w tym pliku (też czytanym) nie trafia sam w siebie
    const name = ['hyperquant', 'mcp'].join('-');
    const unpinned = new RegExp(`npx -y ${name}(?!@)|"-y",\\s*"${name}(?!@)`, 'g');
    const bad = PUBLISHED.flatMap((f) => {
      const text = readRepo(f);
      const loose = [...text.matchAll(unpinned)].map((m) => m[0]);
      const other = [...text.matchAll(/hyperquant-mcp@(\d+\.\d+\.\d+(?:-[\w.]+)?)/g)].filter((m) => m[1] !== version).map((m) => m[0]);
      return [...loose, ...other].map((m) => `${f}: ${m}`);
    });
    expect(bad).toEqual([]);
  });

  it('ścieżka domowa jest trafieniem także w zapisie z ucieczką; przykłady „/path/to” i adresy URL przechodzą', () => {
    // Składane z części: ten plik też jest czytany
    const one = '\\';
    const two = one + one;
    const homes = [
      ['C:', 'Users', 'someone', 'repo'].join(one),
      ['C:', 'Users', 'someone', 'repo'].join(two),
      ['d:', 'Users', 'someone', 'repo'].join('/'),
      `"${['C:', 'Users', 'someone'].join(two)}"`,
      ['', 'Users', 'someone', 'repo'].join('/'),
      ['', 'home', 'someone', 'repo'].join('/'),
    ];
    for (const h of homes) expect(hitsIn(h), h).not.toEqual([]);
    for (const ok of ['/path/to/HyperQuant/mcp/dist/hyperquant-mcp.mjs', 'https://github.com/rdemb/HyperQuant', 'https://example.com/home/page']) expect(hitsIn(ok), ok).toEqual([]);
  });

  it('adres IP i e-mail: przykłady (pętla zwrotna, RFC 5737, domeny testowe) przechodzą, każdy inny adres jest trafieniem', () => {
    expect(hitsIn('np. http://127.0.0.1:8080 albo 192.0.2.10; https://user@example.test/data, b@site.test')).toEqual([]);
    const ip = [10, 20, 30, 40].join('.');
    const mail = ['someone', 'mail.com'].join('@');
    expect(hitsIn(`serwer ${ip}`)).toHaveLength(1);
    expect(hitsIn(`kontakt ${mail}`)).toHaveLength(1);
  });
});
