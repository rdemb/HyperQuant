/**
 * Pliki do publikacji (cała paczka MCP bez bundla, integracje, widok szablonów agentów na stronie) bez ścieżek domowych,
 * sekretów, identyfikatorów i słów wewnętrznego procesu pracy. Wzorce są ogólne: plik jest publiczny.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUARDS } from '../../src/utils/safeguards.mjs';
import { ROOT, readRepo } from './markdown';

/** Katalogi czytane w całości (jeśli są), bez zbudowanego bundla i zależności. */
const DIRS = ['mcp', 'integrations', 'src/views/agents'];
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

// Klasy znaków w nawiasach w słowach procesu: wzorzec nie trafia we własny zapis w tym pliku (on też jest czytany)
const PATTERNS: { why: string; re: RegExp }[] = [
  // Ścieżka domowa Windows także z podwójnym ukośnikiem wstecznym (JSON, literał w kodzie) i z ukośnikami zwykłymi
  { why: 'ścieżka domowa (Windows)', re: /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\s"']+/i },
  // Katalog domowy macOS albo Linuksa jako początek ścieżki (nie fragment adresu URL)
  { why: 'ścieżka domowa (macOS, Linux)', re: /(?<![\w.-])\/(?:Users|home)\/[^/\s"'`]+/ },
  { why: 'adres portfela', re: /0x[0-9a-fA-F]{40}/ },
  { why: 'hash albo klucz (64 hex)', re: /[0-9a-fA-F]{64}/ },
  { why: 'sekret przypisany wprost', re: /(api[_-]?key|secret|token)\s*[:=]\s*\S{8,}/i },
  { why: 'słowo procesu pracy', re: /\b(Review[ ]Focus|sub[a]gent|ledger[ ]file|task[ ]brief)\b/i },
  { why: 'katalog notatek procesu', re: /\.super[p]owers/i },
  { why: 'katalog notatek procesu', re: /docs\/super[p]owers/i },
  // Bezpieczniki prywatności bloga i strony (m.in. tokeny i klucze dostępu w znanych formatach); IP i e-mail osobno niżej
  ...GUARDS.filter((g) => g.kind === 'privacy' && g.en !== 'an IP address' && g.en !== 'an e-mail address').map((g) => ({ why: g.why, re: g.re })),
];

const IP = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
/** Dozwolone w przykładach: pętla zwrotna, 0.0.0.0 i zakresy do dokumentacji (RFC 5737). */
const EXAMPLE_IP = /^(?:127\.\d+\.\d+\.\d+|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/gi;
/** Dozwolone w przykładach: domeny zarezerwowane do testów i dokumentacji (RFC 2606, RFC 6761). */
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[\w-]+\.(?:test|example|invalid|localhost))$/i;

/** Trafienia w tekście: powód i fragment z kontekstem. */
function hitsIn(text: string): string[] {
  const out: string[] = [];
  const hit = (why: string, at: number, len: number) => out.push(`${why} (${text.slice(Math.max(0, at - 20), at + len + 20).replace(/\s+/g, ' ')})`);
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) hit(p.why, m.index, m[0].length);
  }
  for (const m of text.matchAll(IP)) if (!EXAMPLE_IP.test(m[0])) hit('adres IP', m.index, m[0].length);
  for (const m of text.matchAll(EMAIL)) if (!EXAMPLE_DOMAIN.test(m[1])) hit('adres e-mail', m.index, m[0].length);
  return out;
}

describe('pliki do publikacji', () => {
  it('lista plików obejmuje całą paczkę MCP (bez bundla), skill i szablony agentów', () => {
    for (const f of [
      'mcp/src/tools/index.ts',
      'mcp/README.md',
      'mcp/package.json',
      'mcp/vite.config.ts',
      'mcp/scripts/stdio-smoke.mjs',
      'mcp/__tests__/sources.test.ts',
      'integrations/skills/hyperquant/SKILL.md',
      'integrations/agents/index.ts',
      'integrations/agents/hyperquant-desk.md',
      'integrations/agents/big-hands.md',
      'integrations/agents/session-review.md',
      'integrations/__tests__/publishable.test.ts',
    ]) {
      expect(PUBLISHED, f).toContain(f);
    }
    expect(PUBLISHED.filter((f) => /(?:^|\/)(?:dist|node_modules)\//.test(f))).toEqual([]);
  });

  it('bez ścieżek domowych, sekretów, adresów, e-maili i słów procesu pracy', () => {
    expect(PUBLISHED.flatMap((f) => hitsIn(readRepo(f)).map((h) => `${f}: ${h}`))).toEqual([]);
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
