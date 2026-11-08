/**
 * Pliki do publikacji (serwer MCP, jego README i package.json, integracje, widok szablonów agentów na stronie) bez ścieżek
 * domowych, sekretów, identyfikatorów i słów wewnętrznego procesu pracy. Wzorce są ogólne: plik jest publiczny.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUARDS } from '../../src/utils/safeguards.mjs';
import { ROOT, readRepo } from './markdown';

/** Katalogi czytane w całości (jeśli są) i pojedyncze pliki (jeśli są). */
const DIRS = ['mcp/src', 'integrations', 'src/views/agents'];
const FILES = ['mcp/README.md', 'mcp/package.json'];
const TEXT = /\.(?:ts|tsx|mts|mjs|js|json|md)$/;

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return TEXT.test(rel) ? [rel] : [];
  return readdirSync(abs).flatMap((n) => walk(`${rel}/${n}`));
}

const PUBLISHED = [...DIRS.flatMap(walk), ...FILES.filter((f) => existsSync(path.join(ROOT, f)))];

// Klasy znaków w nawiasach w słowach procesu: wzorzec nie trafia we własny zapis w tym pliku (on też jest czytany)
const PATTERNS: { why: string; re: RegExp }[] = [
  { why: 'ścieżka domowa (Windows)', re: /[A-Za-z]:\\Users\\[^\\\s]+/i },
  { why: 'ścieżka domowa (macOS)', re: /\/Users\/[^/\s]+\// },
  { why: 'ścieżka domowa (Linux)', re: /\/home\/[^/\s]+\// },
  { why: 'adres portfela', re: /0x[0-9a-fA-F]{40}/ },
  { why: 'hash albo klucz (64 hex)', re: /[0-9a-fA-F]{64}/ },
  { why: 'sekret przypisany wprost', re: /(api[_-]?key|secret|token)\s*[:=]\s*\S{8,}/i },
  { why: 'adres e-mail', re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i },
  { why: 'słowo procesu pracy', re: /\b(Review[ ]Focus|sub[a]gent|ledger[ ]file|task[ ]brief)\b/i },
  { why: 'katalog notatek procesu', re: /\.super[p]owers/i },
  { why: 'katalog notatek procesu', re: /docs\/super[p]owers/i },
  // Bezpieczniki prywatności bloga i strony (m.in. tokeny i klucze dostępu w znanych formatach); adres IP osobno niżej
  ...GUARDS.filter((g) => g.kind === 'privacy' && g.en !== 'an IP address').map((g) => ({ why: g.why, re: g.re })),
];

const IP = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
/** Dozwolone w przykładach: pętla zwrotna, 0.0.0.0 i zakresy do dokumentacji (RFC 5737). */
const EXAMPLE_IP = /^(?:127\.\d+\.\d+\.\d+|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;

describe('pliki do publikacji', () => {
  it('lista plików obejmuje serwer, README, package.json, skill i szablony agentów', () => {
    for (const f of [
      'mcp/src/tools/index.ts',
      'mcp/README.md',
      'mcp/package.json',
      'integrations/skills/hyperquant/SKILL.md',
      'integrations/agents/index.ts',
      'integrations/agents/hyperquant-desk.md',
      'integrations/agents/big-hands.md',
      'integrations/agents/session-review.md',
      'integrations/__tests__/publishable.test.ts',
    ]) {
      expect(PUBLISHED, f).toContain(f);
    }
  });

  it('bez ścieżek domowych, sekretów, adresów, e-maili i słów procesu pracy', () => {
    const hits: string[] = [];
    const hit = (f: string, why: string, text: string, at: number, len: number) =>
      hits.push(`${f}: ${why} (${text.slice(Math.max(0, at - 20), at + len + 20).replace(/\s+/g, ' ')})`);
    for (const f of PUBLISHED) {
      const text = readRepo(f);
      for (const p of PATTERNS) {
        const m = p.re.exec(text);
        if (m) hit(f, p.why, text, m.index, m[0].length);
      }
      for (const m of text.matchAll(IP)) if (!EXAMPLE_IP.test(m[0])) hit(f, 'adres IP', text, m.index, m[0].length);
    }
    expect(hits).toEqual([]);
  });

  it('adres IP: przykład z pętli zwrotnej przechodzi, każdy inny adres jest trafieniem', () => {
    const ips = (s: string) => [...s.matchAll(IP)].map((m) => m[0]).filter((x) => !EXAMPLE_IP.test(x));
    expect(ips('np. http://127.0.0.1:8080 albo 192.0.2.10')).toEqual([]);
    // Składane z części: ten plik też jest czytany
    const a = [10, 20, 30, 40].join('.');
    const b = [8, 8, 4, 4].join('.');
    expect(ips(`serwer ${a} i ${b}`)).toEqual([a, b]);
  });
});
