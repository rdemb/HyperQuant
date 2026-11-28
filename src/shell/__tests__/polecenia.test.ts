import { describe, expect, it } from 'vitest';
import { INNE_RYNKI_MAX, doSzukania, filtruj, type Polecenie, zInnymiRynkami } from '../polecenia';

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

describe('paleta: rynki spoza głównych tylko przy wyszukiwaniu', () => {
  const p = (id: string, etykieta: string): Polecenie => ({ id, grupa: 'g', etykieta, akcja: { typ: 'widok', id: 'charts' } });
  const base = [p('v-charts', 'Wykresy'), p('m-BTC', 'BTC'), p('l-x', 'Blog')];
  const inne = Array.from({ length: 20 }, (_, i) => p(`m-COIN${i}`, `COIN${i}`));

  it('puste zapytanie — bez rynków spoza głównych', () => {
    expect(zInnymiRynkami(base, inne, '  ').map((x) => x.id)).toEqual(['v-charts', 'm-BTC', 'l-x']);
  });

  it('trafienia zaraz za głównymi rynkami, najwyżej INNE_RYNKI_MAX', () => {
    const out = zInnymiRynkami(base, inne, 'coin');
    expect(out.slice(0, 2).map((x) => x.id)).toEqual(['v-charts', 'm-BTC']);
    expect(out.filter((x) => x.id.startsWith('m-COIN'))).toHaveLength(INNE_RYNKI_MAX);
    expect(out.at(-1)!.id).toBe('l-x');
    expect(zInnymiRynkami([p('v-charts', 'Wykresy')], inne, 'COIN1').map((x) => x.id)).toEqual(['v-charts', 'm-COIN1', 'm-COIN10', 'm-COIN11', 'm-COIN12', 'm-COIN13', 'm-COIN14', 'm-COIN15', 'm-COIN16']);
  });
});
