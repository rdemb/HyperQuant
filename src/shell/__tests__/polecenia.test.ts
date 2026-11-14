import { describe, expect, it } from 'vitest';
import { doSzukania, filtruj, type Polecenie } from '../polecenia';

const L: Polecenie[] = [
  { id: 'v-before', grupa: 'Widoki', etykieta: 'Przed sesją', akcja: { typ: 'widok', id: 'before' } },
  { id: 'v-charts', grupa: 'Widoki', etykieta: 'W sesji', slowa: 'wykresy charts', akcja: { typ: 'widok', id: 'charts' } },
  { id: 'v-sources', grupa: 'Widoki', etykieta: 'Źródła', akcja: { typ: 'widok', id: 'sources' } },
  { id: 'm-ETH', grupa: 'Wykres rynku', etykieta: 'ETH', slowa: 'Hyperliquid', akcja: { typ: 'rynek', coin: 'ETH' } },
  { id: 'm-xyz:NVDA', grupa: 'Wykres rynku', etykieta: 'NVDA', slowa: 'xyz', akcja: { typ: 'rynek', coin: 'xyz:NVDA' } },
  { id: 'l-en', grupa: 'Język', etykieta: 'English', akcja: { typ: 'jezyk', lang: 'en' } },
];

const ids = (q: string) => filtruj(L, q).map((p) => p.id);

describe('paleta poleceń: wyszukiwanie', () => {
  it('bez polskich znaków i wielkości liter', () => {
    expect(doSzukania('Źródła Łódź')).toBe('zrodla lodz');
    expect(ids('zrodla')).toEqual(['v-sources']);
    expect(ids('SESJ')).toEqual(['v-before', 'v-charts']);
  });

  it('puste zapytanie: wszystkie polecenia w kolejności listy', () => {
    expect(ids('')).toEqual(L.map((p) => p.id));
    expect(ids('   ')).toEqual(L.map((p) => p.id));
  });

  it('każde słowo musi pasować; grupa i słowa kluczowe też się liczą', () => {
    expect(ids('wykres eth')).toEqual(['m-ETH']);
    expect(ids('xyz')).toEqual(['m-xyz:NVDA']);
    expect(ids('charts')).toEqual(['v-charts']);
    expect(ids('jezyk')).toEqual(['l-en']);
    expect(ids('btc')).toEqual([]);
  });
});
