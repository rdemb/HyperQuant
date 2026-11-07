import { describe, expect, it } from 'vitest';
import type { Candle } from '../../../charts/pro/hl/parse';
import type { InputSeries, InputStore } from '../../../charts/pro/chart/layoutInputs';
import { previousSameSession } from '../../../utils/sessionDay';
import { reviewCards } from '../../../utils/sessionReview';
import { isAbsent } from '../../../utils/sessionText';
import { cardBars1m } from '../reviewInputs';

const MIN = 60_000;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026 16:20 UTC — sesja NY w toku; karty: Londyn 3.11, NY 2.11 (zamknięte) i NY 3.11 (w toku) */
const NOW = at(2026, 11, 3, 16, 20);

/** Magazyn z serią 1m od `first`, której starsza strona się nie wczytała (`olderFailed`). */
function store(first: number, olderFailed: boolean): InputStore {
  const list: Candle[] = [];
  for (let t = first; t <= NOW; t += MIN) list.push({ t, o: 100_000, h: 100_005, l: 99_995, c: 100_000, v: 1, n: 1 });
  const s: InputSeries = { loadState: 'ready', load: async () => {}, candlesNow: () => list, historyExhausted: false, olderFailed };
  return {
    coin: 'BTC',
    serverNow: () => NOW,
    lastPrice: () => 100_000,
    series: () => s,
    indicatorCandles: () => list,
    exactBook: () => null,
    zeroKnown: { covers: () => false },
    orders: { range: () => [] },
  };
}

describe('Rozliczenie: świece 1m każdej karty osobno', () => {
  const { cards } = reviewCards(NOW);

  it('nieudana starsza strona wygasza tylko karty, którym brakuje minut; karta w toku zostaje przy swoich świecach', () => {
    // Świece od otwarcia NY 2.11 — tyle potrzebuje karta w toku (poprzednia sesja NY), Londynowi 3.11 brakuje Londynu 2.11
    const st = store(previousSameSession(cards[2].s).start, true);
    const got = cards.map((c) => cardBars1m(st, c.s, NOW));
    expect(cards.map((c) => [c.s.id, c.inProgress])).toEqual([
      ['ny', false],
      ['london', false],
      ['ny', true],
    ]);
    expect(got.map((g) => g !== undefined && isAbsent(g))).toEqual([true, true, false]);
    expect(got[2]).toHaveLength((NOW - previousSameSession(cards[2].s).start) / MIN + 1);
    expect(got[0]).toEqual({ why: 'Nie udało się pobrać starszych świec 1m — kolejna próba za ≤ 30 s' });
  });

  it('bez błędu karta, której brakuje minut, czeka (undefined), a nie dostaje liczby z części danych', () => {
    const st = store(previousSameSession(cards[2].s).start, false);
    expect(cards.map((c) => cardBars1m(st, c.s, NOW) === undefined)).toEqual([true, true, false]);
  });
});
