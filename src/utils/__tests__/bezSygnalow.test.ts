import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Zasada publikacji: w tekstach widocznych dla użytkownika nie ma słowa „sygnał” / „signal” (plan 59, A1).
// Sprawdzane są tylko napisy i tekst JSX, bez komentarzy i identyfikatorów (AbortSignal, HoverSignal, klucz parametru MACD).

function pliki(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'plugins' || n === 'fonts' || n === 'shots' ? [] : pliki(p, ext);
    return ext.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

/** Napisy i tekst JSX pliku, po usunięciu komentarzy. */
export function teksty(src: string): string[] {
  const bez = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  return [...[...bez.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]), ...[...bez.matchAll(/>([^<>{}]+)</g)].map((m) => m[1])];
}

const ZAKAZ = /sygna[łl]|\bsignals?\b/i;
/** Napisy, które są kluczami w kodzie, a nie tekstem (klucz parametru MACD). */
const KLUCZE = new Set(['signal']);
/**
 * `whatsnew.mjs` trzyma sam filtr słów (wzorzec zakazu), więc nie jest tekstem strony.
 */
const POZA = new Set(['scripts/blog/whatsnew.mjs']);

describe('teksty bez słowa „sygnał” (src i strony bloga)', () => {
  it('żaden napis ani tekst JSX nie zawiera „sygnał” / „signal”', () => {
    const wszystkie = [...pliki('src', /\.(ts|tsx|mjs)$/), ...pliki(join('scripts', 'blog'), /\.mjs$/)];
    const zle = wszystkie
      .map((p) => relative('.', p).replace(/\\/g, '/'))
      .filter((p) => !POZA.has(p))
      .flatMap((p) => teksty(readFileSync(p, 'utf8'))
        .filter((t) => !KLUCZE.has(t) && ZAKAZ.test(t))
        .map((t) => `${p}: ${t.slice(0, 80)}`));
    expect(zle).toEqual([]);
  });

  it('sprawdzenie łapie tekst, a pomija identyfikatory i komentarze', () => {
    expect(teksty('const c = new AbortController(); fetch(u, { signal: c.signal });').some((t) => ZAKAZ.test(t))).toBe(false);
    expect(teksty("// To nie sygnał\nconst a = 1;").some((t) => ZAKAZ.test(t))).toBe(false);
    expect(teksty("tr('Bez sygnału', 'No signal')").some((t) => ZAKAZ.test(t))).toBe(true);
    expect(teksty('<p>A buy signal</p>').some((t) => ZAKAZ.test(t))).toBe(true);
    expect(teksty("const u = 'https://x.y/a'; tr('ok', 'ok')").some((t) => ZAKAZ.test(t))).toBe(false);
  });
});
