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

/** Kod bez komentarzy (blokowych i liniowych), żeby szukać tylko w tekstach i kodzie. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

describe('nazwy miejsc w tekstach interfejsu', () => {
  it('bez dawnej zakładki „Desk”: miejsca to Przed sesją, W sesji, Po sesji, Badania; „desk” jako opis produktu zostaje', () => {
    const hits: string[] = [];
    for (const f of sources('src')) {
      const lines = code(readFileSync(f, 'utf8')).split('\n');
      lines.forEach((l, i) => {
        // Słowo „Desk” wielką literą (nazwa zakładki), nie identyfikatory (useDesk, DeskLedgerPanel) ani CoinDesk
        if (/\bDesk(u|iem|owi)?\b/.test(l) || /zakładc\S* desku|desk tab\b|\bDesk →/.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
        // Dawna zakładka „Wykresy” jako miejsce (strona bloga „Wykresy” jest poza src/)
        if (/\b(na|w) Wykresach\b|\b(in|on) Charts\b|Charts replay/.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('strona 404 bloga: link do aplikacji podpisany nazwą widoku, nie „Desk”', () => {
    const pages = readFileSync('scripts/blog/pages.mjs', 'utf8');
    expect(pages).not.toMatch(/link\('', 'Desk'\)/);
  });
});
