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
      venues: { binance: () => 7, bybit: () => 0.5 },
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
    const facts = marketState(base(bars, { vwap: { vwap: 100_250, sd: 100, start: false }, venues: { binance: () => -3, bybit: () => 0.5 } }));
    expect(stateSentence(facts)).toBe('Cena daleko pod VWAP dnia (−2,5σ), CVD spada od 16 min, Binance w tę samą stronę, Bybit w przeciwną.');
    expect(facts[2].tone).toBe(0);
  });

  it('giełdy w tych samych świecach co taśma Hyperliquid; giełda bez delty w części z nich pominięta', () => {
    // 10 świec, taśma Hyperliquid tylko w ostatnich 7; Binance ma deltę we wszystkich (w 3 pierwszych mocno ujemną),
    // Bybit tylko w bieżącej (dane od otwarcia strony)
    const bars = Array.from({ length: 10 }, (_, i) => (i < 3 ? { t: T0 + i * M5, candle: candle(T0 + i * M5, 100_000), fp: null } : bar(i, 6, 2)));
    const last = bars[9].t;
    const facts = marketState(
      base(bars, {
        venues: { binance: (t) => (t < T0 + 3 * M5 ? -2000 : 500), bybit: (t) => (t === last ? 2 : null) },
      })
    );
    const v = facts.find((f) => f.key === 'venues')!;
    expect(v.text).toBe('Binance w tę samą stronę');
    expect(v.why).toBe(
      'Delta w tych samych 7 świecach z taśmy: Hyperliquid +28.0, Binance perp +3.5K BTC. „Ta sama strona” — znak delty jak na Hyperliquid. Bybit pominięty: delta tylko z 1 z 7 świec.'
    );
    // Żadna giełda nie ma delty we wszystkich świecach z taśmy — bez porównania
    expect(marketState(base(bars, { venues: { binance: () => null, bybit: (t) => (t === last ? 2 : null) } })).some((f) => f.key === 'venues')).toBe(false);
  });

  it('CVD z kierunkiem, ale bez ciągu świec — bez „z rzędu 0 świec”', () => {
    const facts = marketState(base([bar(0, 9, 1), bar(1, 8, 2), bar(2, 1, 3)], { now: T0 + 3 * M5 + 1 }));
    expect(facts[0].text).toBe('CVD rośnie');
    expect(facts[0].why).not.toContain('Z rzędu');
  });
});
