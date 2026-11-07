import { describe, expect, it } from 'vitest';
import { GUARDS, TITLE_GUARDS, guardHits, guardViolations } from '../safeguards';
// Walidator bloga korzysta z tego samego modułu (jedna lista bezpieczników)
import { GUARDS as BLOG_GUARDS, guardViolations as blogViolations } from '../../../scripts/blog/posts.mjs';

describe('bezpieczniki treści: wspólny moduł bloga i strony', () => {
  it('blog używa tej samej listy i tej samej funkcji', () => {
    expect(BLOG_GUARDS).toBe(GUARDS);
    expect(blogViolations).toBe(guardViolations);
  });

  it('komunikat walidatora bloga bez zmian: powód po polsku i fragment z kontekstem', () => {
    expect(guardViolations('Kupujcie, póki tanio.')).toEqual(['wezwanie do transakcji: „…Kupujcie, póki tanio.…”']);
    expect(guardViolations('Long od 80 500 z celem wyżej.')).toEqual(['gotowe wejście (long/short od ceny): „…Long od 80 500 z celem wyżej.…”']);
    expect(guardViolations('Cena spadła — znowu.')).toEqual(['myślnik: „…Cena spadła — znowu.…”']);
  });

  it('każdy wzorzec ma rodzaj i powód po polsku i angielsku', () => {
    for (const g of [...GUARDS, ...TITLE_GUARDS]) {
      expect(g.kind).toMatch(/^(privacy|advice|style)$/);
      expect(g.why.length).toBeGreaterThan(3);
      expect(g.en.length).toBeGreaterThan(3);
    }
  });
});

describe('bezpieczniki tytułu Klatki (TITLE_GUARDS)', () => {
  const kinds = (t: string) => guardHits(t, TITLE_GUARDS).map((h) => h.guard.kind);

  it.each([
    ['kup', 'Kup teraz, VWAP +1,2σ'],
    ['sprzedaj', 'Sprzedaj przy 82 000'],
    ['wejdź w longa', 'Wejdź w longa nad VAH'],
    ['long od ceny', 'Long od 80 500'],
    ['long przy cenie bez przyimka', 'Long 80 500, klaster 4,2M'],
    ['short z @', 'short @ 82000'],
    ['TP/SL', 'TP 82000, SL 80100'],
    ['buy (EN)', 'Buy the dip: VWAP −2,1σ'],
    ['sell (EN)', 'Sell now, RVOL 3,2×'],
    ['go long (EN)', 'Go long above 80,500'],
    ['enter a short (EN)', 'Enter a short at the VAH'],
    ['long from (EN)', 'Long from 80,500'],
  ])('rada „%s” jest blokowana', (_, t) => {
    expect(kinds(t)).toContain('advice');
  });

  it('prywatność też: adres portfela w tytule', () => {
    expect(kinds('Wieloryb 0x1234567890abcdef1234567890abcdef12345678 dokupił')).toContain('privacy');
  });

  it('bez reguł stylu bloga: „—” to brak liczby w nagłówku, nie myślnik', () => {
    expect(guardHits('Klaster likw.: — (tylko BTC); RVOL: 1,3× (MODEL)', TITLE_GUARDS)).toEqual([]);
    expect(TITLE_GUARDS.some((g) => g.kind === 'style')).toBe(false);
  });

  it.each([
    'Kto teraz naciska, kto przyjmuje uderzenia i co stoi w kolejce?',
    'Saldo wielorybów: +4,2M (LIVE); Klaster likw.: +1,23% · 4,2M (LIVE, 4 min)',
    'Presja kupujących osłabła, sprzedający wrzucili 120 BTC w minutę',
    'Likwidacje longów 23,7M pod ceną, shorty wyżej',
    'Buy volume and sell volume are even; buyers absorbed 120 BTC',
    'Longs 4.2M, shorts 3.9M: the whale balance is flat',
    'Short squeeze? IB up · 1,8×',
  ])('zwykły opis rynku przechodzi: %s', (t) => {
    expect(guardHits(t, TITLE_GUARDS)).toEqual([]);
  });

  it('trafienie ma fragment tekstu z dopasowaniem', () => {
    const [h] = guardHits('Wykres BTC. Kup teraz, póki tanio.', TITLE_GUARDS);
    expect(h.fragment).toContain('Kup');
  });
});
