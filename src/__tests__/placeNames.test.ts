import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Pliki źródłowe aplikacji bez testów. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** Kod bez komentarzy (blokowych i liniowych; numery linii zostają), żeby szukać tylko w tekstach i kodzie. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/**
 * Odwołania do dawnej zakładki „Wykresy” / „Charts” jako miejsca, bez względu na wielkość liter. Adres statycznej strony
 * `wykresy/` nie jest miejscem w aplikacji (wycinany przed sprawdzeniem).
 */
const OLD_CHARTS = [
  /zakładk\S* wykres/i,
  /\bcharts tab\b/i,
  /\b(na|w) wykresach\b/i,
  /\b(in|on) charts\b/i,
  /\bcharts replay\b/i,
  /\bwidok\S* wykresy\b/i,
  /\bcharts view\b/i,
  /\bwykresy mają/i,
  /\bcharts now\b/i,
];

describe('nazwy miejsc w tekstach interfejsu', () => {
  const lines = sources('src').flatMap((f) =>
    code(readFileSync(f, 'utf8'))
      .split('\n')
      .map((l, i) => ({ at: `${f}:${i + 1}`, l }))
  );

  it('bez dawnej zakładki „Desk”: miejsca to Przed sesją, W sesji, Po sesji, Badania; „desk” jako opis produktu zostaje', () => {
    // Słowo „Desk” wielką literą (nazwa zakładki), nie identyfikatory (useDesk, DeskLedgerPanel) ani CoinDesk; małe „desk”
    // to słowo produktu, więc ten wzorzec rozróżnia wielkość liter
    const hits = lines.filter(({ l }) => /\bDesk(u|iem|owi)?\b/.test(l) || /zakładc\S* desku|desk tab\b|\bDesk →/i.test(l));
    expect(hits.map(({ at, l }) => `${at}: ${l.trim().slice(0, 120)}`)).toEqual([]);
  });

  it('bez dawnej zakładki „Wykresy” / „Charts” jako miejsca (PL i EN, dowolna wielkość liter)', () => {
    const hits = lines.filter(({ l }) => OLD_CHARTS.some((re) => re.test(l.replace(/wykresy\//gi, ''))));
    expect(hits.map(({ at, l }) => `${at}: ${l.trim().slice(0, 120)}`)).toEqual([]);
  });

  it('wzorce łapią dawne brzmienia, a nie łapią adresu strony `wykresy/` ani słowa produktu', () => {
    const bad = ['Wykresy mają teraz układy faz dnia', 'Każdy wskaźnik z zakładki Wykresy', 'Every indicator from the Charts tab', 'Na Wykresach', 'In Charts there is', 'na wykresach też', 'Engine of the Charts view'];
    for (const t of bad) expect(OLD_CHARTS.some((re) => re.test(t)), t).toBe(true);
    for (const t of ["href={`${root}wykresy/`}", 'Darmowy desk do day tradingu', 'na wykresie W sesji']) expect(OLD_CHARTS.some((re) => re.test(t.replace(/wykresy\//gi, ''))), t).toBe(false);
  });

  it('strona 404 bloga: link do aplikacji podpisany nazwą widoku, nie „Desk”', () => {
    const pages = readFileSync('scripts/blog/pages.mjs', 'utf8');
    expect(pages).not.toMatch(/link\('', 'Desk'\)/);
  });
});
