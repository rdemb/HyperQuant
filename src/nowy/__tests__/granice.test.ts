import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Pliki źródłowe (ts, tsx) pod katalogiem, bez testów. */
function pliki(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'plugins' ? [] : pliki(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

const SRC = 'src';
const NOWY = join(SRC, 'nowy');
const wszystkie = pliki(SRC);
const nowe = wszystkie.filter((p) => p.startsWith(NOWY));

describe('granice nowego wyglądu (src/nowy)', () => {
  it('poza App.tsx nic nie importuje src/nowy; App.tsx tylko leniwie (import())', () => {
    const zle = wszystkie
      .filter((p) => !p.startsWith(NOWY))
      .flatMap((p) => {
        const s = readFileSync(p, 'utf8');
        const statyczne = [...s.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
        return statyczne.filter((x) => /(^|\/)nowy(\/|$)/.test(x)).map((x) => `${relative('.', p)} → ${x}`);
      });
    expect(zle).toEqual([]);
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).toMatch(/import\('\.\/nowy\/NowaPowloka'\)/);
  });

  it('w src/nowy nie ma własnych zapytań do sieci: dane tylko z hooków aplikacji', () => {
    const zle = nowe.filter((p) => /\bfetch\s*\(|\bWebSocket\b|XMLHttpRequest|api\.hyperliquid|https?:\/\/(?!www\.tradingview\.com)/.test(readFileSync(p, 'utf8')));
    expect(zle.map((p) => relative('.', p))).toEqual([]);
  });

  it('teksty nowego wyglądu bez słowa „sygnał” / „signal” (zasada publikacji)', () => {
    const zle = nowe.filter((p) => /sygna[łl]|signal/i.test(readFileSync(p, 'utf8')));
    expect(zle.map((p) => relative('.', p))).toEqual([]);
  });
});
