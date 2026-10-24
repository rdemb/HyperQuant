import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import { FootprintBuilder } from '../core/footprintBar';
import { StateBar, StateInput, marketState, stateSentence } from '../chart/marketState';

const M5 = 5 * 60_000;
const T0 = 1000 * M5;

const candle = (t: number, c: number): Candle => ({ t, o: c, h: c + 5, l: c - 5, c, v: 10, n: 1 });

/** Świeca z taśmą: kupno `buy` i sprzedaż `sell` agresorów (jednostki rynku). */
const bar = (i: number, buy: number, sell: number, c = 100_000): StateBar => {
  const t = T0 + i * M5;
  const fp = new FootprintBuilder(M5, 10);
  if (buy > 0) fp.add(t + 1, c, buy, 1);
  if (sell > 0) fp.add(t + 2, c, sell, -1);
  return { t, candle: candle(t, c), fp: fp.build() };
};

const base = (bars: StateBar[], patch: Partial<StateInput> = {}): StateInput => ({
  unit: 'BTC',
  bars,
  ms: M5,
  now: bars[bars.length - 1].t + 60_000,
  vwap: null,
  vwapPeriod: 'dnia',
  oiAt: () => null,
  players: null,
  bigPlayerUsd: 1_000_000,
  venues: null,
  book: null,
  ...patch,
});

describe('Stan rynku', () => {
  it('zdanie z faktów w stałej kolejności; czas trwania CVD od początku ciągu świec z deltą w tę samą stronę', () => {
    // 6 świec z przewagą kupna (ostatnie 4 z rzędu na plus), bieżąca też na plus
    const bars = [bar(0, 5, 1), bar(1, 1, 4), bar(2, 6, 2), bar(3, 5, 1), bar(4, 7, 2), bar(5, 4, 1)];
    const x = base(bars, {
      vwap: { vwap: 99_880, sd: 100, start: false },
      oiAt: (t) => (t <= T0 ? 30_000 : 30_150),
      players: { big: 6, rest: -2, bigUsd: 1_500_000, usd: 3_000_000, bigShare: 50, complete: true },
      venues: { binance: 40, bybit: 3 },
      book: { bid: 65, ask: 35 },
    });
    const facts = marketState(x);
    expect(facts.map((f) => f.key)).toEqual(['vwap', 'cvd', 'venues', 'oi', 'players', 'book']);
    expect(stateSentence(facts)).toBe(
      'Cena nad VWAP dnia (+1,2σ), CVD rośnie od 16 min, Binance i Bybit w tę samą stronę, otwarte pozycje rosną, duzi gracze po stronie kupna, reszta po stronie sprzedaży, w arkuszu przewaga bidów.'
    );
    expect(facts.map((f) => f.tone)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(facts[1].why).toContain('Z rzędu 4 świece z deltą dodatnią');
    expect(facts[3].why).toContain('+0,50%');
  });

  it('progi: przy VWAP, bez kierunku, bez zmiany, równowaga; fakt bez danych pominięty', () => {
    const bars = [bar(0, 5, 5), bar(1, 4, 4), bar(2, 3, 3)];
    const facts = marketState(
      base(bars, { vwap: { vwap: 99_980, sd: 100, start: false }, oiAt: () => 30_000, players: { big: 0.1, rest: 0, bigUsd: 2_000_000, usd: 4_000_000, bigShare: 50, complete: true }, book: { bid: 55, ask: 45 } })
    );
    expect(stateSentence(facts)).toBe(
      'Cena przy VWAP dnia (+0,2σ), CVD bez wyraźnego kierunku, otwarte pozycje bez większej zmiany, duzi gracze bez przewagi, arkusz w równowadze.'
    );
    expect(facts.every((f) => f.tone === 0)).toBe(true);
    // Bez taśmy, VWAP, OI, kont i arkusza — nic do powiedzenia
    expect(marketState(base([{ t: T0, candle: candle(T0, 100_000), fp: null }]))).toEqual([]);
  });

  it('progi na liczbach z „skąd?”: +0,46σ to +0,5σ „nad”, delta +4,6% wolumenu to +5% i kierunek', () => {
    const facts = marketState(base([bar(0, 523, 477), bar(1, 523, 477)], { vwap: { vwap: 99_954, sd: 100, start: false } }));
    expect(stateSentence(facts)).toBe('Cena nad VWAP dnia (+0,5σ), CVD rośnie od 6 min.');
    expect(facts[1].why).toContain('(+5% wolumenu)');
  });

  it('bieżąca świeca w przeciwną stronę nie przerywa ciągu; giełdy w różne strony; daleko pod VWAP', () => {
    const bars = [bar(0, 1, 6), bar(1, 1, 5), bar(2, 2, 7), bar(3, 3, 1)];
    const facts = marketState(base(bars, { vwap: { vwap: 100_250, sd: 100, start: false }, venues: { binance: -12, bybit: 2 } }));
    expect(stateSentence(facts)).toBe('Cena daleko pod VWAP dnia (−2,5σ), CVD spada od 16 min, Binance w tę samą stronę, Bybit w przeciwną.');
    expect(facts[2].tone).toBe(0);
  });
});
