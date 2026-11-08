/**
 * Wszystkie teksty zakładki Agenci AI w kodzie (wstęp, karty instalacji, podpisy, zasady, stopka; także przycisk
 * kopiowania): każde wywołanie `tr()` to para literałów albo para pól danych (te sprawdza `catalog.test.ts` i testy
 * szablonów), a każdy literał po polsku i po angielsku przechodzi strażnika treści strony (rady, prywatność).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TITLE_GUARDS, guardHits } from '../../../utils/safeguards.mjs';

const DIR = path.resolve(import.meta.dirname, '..');
const FILES = ['AgentsView.tsx', 'CopyButton.tsx'];
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8');

/** Literał JS w apostrofach, cudzysłowach albo backtickach (bez interpolacji), z ucieczkami. */
const LIT = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|` + '`(?:\\\\.|[^`\\\\$])*`)';
const PAIR = new RegExp(String.raw`\btr\(\s*(${LIT})\s*,\s*(${LIT})\s*,?\s*\)`, 'g');
const FIELDS = /\btr\(\s*[A-Za-z_][\w.]*\s*,\s*[A-Za-z_][\w.]*\s*\)/g;
/** Wartość literału z własnego kodu (wzorzec dopuszcza tylko literał bez interpolacji). */
const value = (lit: string): string => Function(`return ${lit};`)() as string;

function pairs(src: string): { pl: string; en: string }[] {
  return [...src.matchAll(PAIR)].map((m) => ({ pl: value(m[1]), en: value(m[2]) }));
}

describe('teksty zakładki Agenci AI', () => {
  it('każde tr() to para literałów albo para pól danych (żaden tekst nie umyka sprawdzeniu)', () => {
    for (const f of FILES) {
      const src = read(f);
      const calls = (src.match(/\btr\(/g) ?? []).length;
      expect(calls, f).toBeGreaterThan(0);
      expect(pairs(src).length + (src.match(FIELDS) ?? []).length, f).toBe(calls);
    }
    expect(pairs(read('AgentsView.tsx')).length).toBeGreaterThan(40);
  });

  it('po polsku i po angielsku bez trafień strażnika treści (rady kupna i sprzedaży, adresy, klucze)', () => {
    const hits = FILES.flatMap((f) =>
      pairs(read(f)).flatMap(({ pl, en }) => [...guardHits(pl, TITLE_GUARDS), ...guardHits(en, TITLE_GUARDS)].map((h) => `${f}: ${h.guard.en}: ${h.fragment}`))
    );
    expect(hits).toEqual([]);
  });

  it('wstęp: te same funkcje co strona, ale cena z ostatniego zamknięcia 1m, więc liczby mogą się nieco różnić', () => {
    const all = pairs(read('AgentsView.tsx'));
    expect(all.some((p) => /ostatnie zamknięcie świecy 1m/.test(p.pl) && /latest 1-minute close/.test(p.en) && /tymi samymi funkcjami/.test(p.pl))).toBe(true);
  });

  it('ścieżki Windows w JSON: ukośniki zwykłe (C:/…) albo podwójne odwrotne', () => {
    const all = pairs(read('AgentsView.tsx'));
    expect(all.some((p) => p.pl.includes('C:/') && p.en.includes('C:/') && p.pl.includes('\\\\') && p.en.includes('\\\\'))).toBe(true);
  });
});
