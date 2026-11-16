import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Candle } from '../hl/parse';
import { type DayFrame, STATE_DAYS, STATE_KEYS, type StateHistory, type StateKey } from '../core/dayFrame';
import type { Levels } from '../core/pbRanges';
import { FRAME_RULES, type FrameInput, frameChips, stateDistribution } from '../chart/dayFrameText';
import { FRAME_HISTORY_DAYS, type InputSeries, type InputStore, frameInputOf } from '../chart/layoutInputs';
import { DayFrameBar } from '../chart/DayFrameBar';
import type { ProStore } from '../store/proStore';
import { indicatorDef } from '../indicators/registry';
import { DASH } from '../../../ui/format';
import { tradeSessionOn } from '../../../utils/sessionDay';

const MIN = 60_000;
const DAY = 86_400_000;
const D = Date.UTC(2026, 10, 16);
const OPEN = tradeSessionOn(D, 'ny').start;
const NOW = OPEN + 75 * MIN;
const PREV: Levels = { poc: 105, vah: 110, val: 100, lvn: [] };

const counts = (o: Partial<Record<StateKey, number>>) => Object.fromEntries(STATE_KEYS.map((k) => [k, o[k] ?? 0])) as Record<StateKey, number>;
const hist = (n: number, o: Partial<Record<StateKey, number>> = {}): StateHistory => ({ n, counts: counts(o), early: false });

const frame = (over: Partial<DayFrame> = {}): DayFrame => ({
  day: D,
  prev: PREV,
  value: { today: { val: 104, vah: 114 }, migration: 'overlap-higher', overlap: 0.6 },
  acceptance: { state: { kind: 'accepted', side: 1 }, run: 3, runSide: 1, above: 0.42, below: 0, minutesOutside: 95, periods: 30, close: 113, closeAt: NOW },
  history: hist(STATE_DAYS, { 'accepted-up': 11, inside: 49 }),
  ivb: {
    kind: 'ok',
    ivb: { start: OPEN, end: OPEN + 30 * MIN, sessionEnd: D + DAY, hi: 112, lo: 108, complete: true, through: OPEN + 30 * MIN },
    status: { kind: 'broke', side: 1, since: NOW - 25 * MIN },
    width: { kind: 'ok', ratio: 0.31, atr: 12.9, p: 35.2, n: 20, median: 0.4 },
  },
  ...over,
});
const chips = (f: FrameInput['frame'], extra: Partial<FrameInput> = {}) => frameChips({ coin: 'BTC', now: NOW, frame: f, ...extra }, 30);
const byId = (f: FrameInput['frame'], extra: Partial<FrameInput> = {}) => Object.fromEntries(chips(f, extra).map((c) => [c.id, c]));

describe('Pasek „Rama dnia”: liczby i plakietki', () => {
  it('cztery liczby: wartość i status IVB LIVE, aukcja i szerokość IVB MODEL z nazwą reguły', () => {
    const c = byId(frame());
    expect(chips(frame()).map((x) => x.id)).toEqual(['value', 'auction', 'ivb', 'ivbWidth']);
    expect(c.value).toMatchObject({ badge: 'LIVE', value: 'częściowo wyżej · 60%' });
    expect(c.auction).toMatchObject({ badge: 'MODEL', value: 'przyjęcie nad · 18% dób' });
    expect(c.auction.hint).toMatch(/^MODEL · przyjęcie poza wartością \(Dalton\)/);
    expect(c.auction.hint).toContain('w 11 z 60 poprzednich dób');
    expect(c.ivb).toMatchObject({ badge: 'LIVE', value: 'wybicie nad · 25 min', label: 'IVB 30' });
    expect(c.ivbWidth).toMatchObject({ badge: 'MODEL', value: '0,31 ATR · p35' });
    expect(c.ivbWidth.hint).toMatch(/^MODEL · szerokość IVB w ATR doby, percentyl 20 sesji/);
  });

  it('krótka historia: stan i szerokość bez częstości i percentyla, z liczbą dób albo sesji', () => {
    const c = byId(frame({ history: hist(12, { inside: 12 }), ivb: { ...(frame().ivb as Extract<DayFrame['ivb'], { kind: 'ok' }>), width: { kind: 'short', ratio: 0.31, atr: 12.9, n: 7 } } }));
    expect(c.auction.value).toBe('przyjęcie nad · krótka historia (12 dób)');
    expect(c.auction.value).not.toMatch(/%/);
    expect(c.ivbWidth.value).toBe('0,31 ATR · krótka historia (7 sesji)');
    expect(c.ivbWidth.value).not.toMatch(/p\d/);
  });

  it('bez historii 30m (błąd pobrania): stan bez częstości, szerokość „—” z powodem', () => {
    const c = byId(frame(), { historyWhy: 'nie udało się pobrać świec 30m' });
    expect(c.auction.value).toBe('przyjęcie nad');
    expect(c.auction.hint).toContain('nie udało się pobrać świec 30m');
    expect(c.ivbWidth.value).toBe(DASH);
  });

  it('niesklasyfikowane z powodem w podpowiedzi', () => {
    const c = byId(frame({ acceptance: { ...frame().acceptance!, state: { kind: 'unclassified', why: 'both-sides' } }, history: hist(60, { unclassified: 3, inside: 57 }) }));
    expect(c.auction.value).toBe('niesklasyfikowane · 5% dób');
    expect(c.auction.hint).toContain('przyjęcie po obu stronach');
  });

  it('brak danych: „—” z powodem, bez plakietki udającej dane', () => {
    for (const c of chips(undefined)) expect(c.value).toBe(DASH);
    const c = byId({ why: 'Nie udało się pobrać świec 5m' });
    expect(c.value.hint).toBe('Nie udało się pobrać świec 5m');
    expect(c.auction.hint).toBe('MODEL · przyjęcie poza wartością (Dalton): Nie udało się pobrać świec 5m');
    expect(byId(frame({ prev: null, value: null, acceptance: null })).value.value).toBe(DASH);
  });

  it('IVB nie dotyczy rynku: obie liczby IVB „—” z powodem', () => {
    const c = byId(frame({ ivb: { kind: 'na', why: 'no-rth' } }));
    expect(c.ivb.value).toBe(DASH);
    expect(c.ivb.hint).toContain('nie ma sesji regularnej NYSE');
    expect(c.ivbWidth.value).toBe(DASH);
    const w = byId(frame({ ivb: { kind: 'state', state: { kind: 'outside', next: OPEN + DAY } } }));
    expect(w.ivb.hint).toMatch(/^Poza sesją NY: najbliższe otwarcie o/);
  });

  it('IVB w budowie: status bez szerokości', () => {
    const f = frame().ivb as Extract<DayFrame['ivb'], { kind: 'ok' }>;
    const c = byId(frame({ ivb: { ...f, ivb: { ...f.ivb, complete: false }, status: { kind: 'forming' } } }));
    expect(c.ivb.value).toBe('w budowie');
    expect(c.ivbWidth.value).toBe(DASH);
  });

  it('opis bez prognozy i bez wskazań: żadnych słów o tym, co będzie dalej', () => {
    const text = [...chips(frame()), ...chips(frame({ acceptance: { ...frame().acceptance!, state: { kind: 'attempt', side: -1 } } }))].map((c) => `${c.value} ${c.hint}`).join(' ') + FRAME_RULES;
    expect(text).not.toMatch(/\b(kup|sprzedaj|long|short|wejd|cel |będzie rosn|będzie spad|prawdopodobnie)/i);
    expect(FRAME_RULES).toContain('nie mówi, co będzie dalej');
  });

  it('rozkład stanów o tej porze: tylko obecne stany, od najczęstszego', () => {
    expect(stateDistribution(hist(60, { inside: 40, 'accepted-up': 11, return: 9 })).map((d) => [d.key, d.n])).toEqual([
      ['inside', 40],
      ['accepted-up', 11],
      ['return', 9],
    ]);
    expect(stateDistribution(hist(0))).toEqual([]);
  });

  it('karta IVB opisuje pasek i jego zamrożone progi', () => {
    const c = indicatorDef('ivb').convention;
    expect(c).toContain('Rama dnia');
    expect(c).toContain('2 kolejne zamknięcia 30m');
    expect(c).toContain('30% wolumenu');
  });

  it('pasek przed pierwszym przeliczeniem: tytuł i cztery „—”', () => {
    const html = renderToStaticMarkup(createElement(DayFrameBar, { store: { coin: 'BTC' } as ProStore, narrow: false, minutes: 30 }));
    expect(html).toContain('Rama dnia');
    expect(html.match(/data-rama-liczba/g)).toHaveLength(4);
  });
});

/** Atrapa magazynu: serie świec według interwału (jak w layoutInputs.test). */
function fakeStore(now: number, series: Record<string, { state?: InputSeries['loadState']; list?: Candle[]; exhausted?: boolean }>) {
  const made = new Map<string, InputSeries>();
  const st: InputStore = {
    coin: 'BTC',
    serverNow: () => now,
    lastPrice: () => 100,
    series(id) {
      let s = made.get(id);
      if (!s) {
        const spec = series[id] ?? { state: 'loading' };
        s = { loadState: spec.state ?? 'ready', load: async () => {}, candlesNow: () => spec.list ?? [], historyExhausted: spec.exhausted ?? false };
        made.set(id, s);
      }
      return s;
    },
    indicatorCandles: (id) => st.series(id).candlesNow(),
    exactBook: () => null,
    zeroKnown: { covers: () => false },
    orders: { range: () => [] },
  };
  return st;
}

const candles = (from: number, to: number, ms: number): Candle[] => {
  const out: Candle[] = [];
  for (let t = from; t < to; t += ms) out.push({ t, o: 100, h: 100.5, l: 99.5, c: 100, v: 1, n: 1 });
  return out;
};

describe('Pasek „Rama dnia”: wejście z magazynu', () => {
  it('świece 5m albo historia 30m w drodze: czekamy (bez liczb z części danych)', () => {
    expect(frameInputOf(fakeStore(NOW, {}), 30).frame).toBeUndefined();
    expect(frameInputOf(fakeStore(NOW, { '5m': { list: candles(D - DAY, NOW, 5 * MIN) } }), 30).frame).toBeUndefined();
  });

  it('historia 30m z błędem: rama liczona, z powodem braku historii', () => {
    const x = frameInputOf(fakeStore(NOW, { '5m': { list: candles(D - DAY, NOW, 5 * MIN) }, '30m': { state: 'error' } }), 30);
    expect(x.frame && 'prev' in x.frame && x.frame.prev).toBeTruthy();
    expect(x.historyWhy).toMatch(/30m/);
  });

  it('komplet: VA wczoraj, stan doby i historia z 76 dób świec 30m', () => {
    const c30 = candles(D - FRAME_HISTORY_DAYS * DAY, NOW, 30 * MIN);
    const x = frameInputOf(fakeStore(NOW, { '5m': { list: candles(D - DAY, NOW, 5 * MIN) }, '30m': { list: c30 } }), 30);
    const f = x.frame as DayFrame;
    expect(f.prev).not.toBeNull();
    expect(f.acceptance?.state).toEqual({ kind: 'inside' });
    expect(f.history.n).toBe(STATE_DAYS);
    expect(x.historyWhy).toBeNull();
    expect(f.ivb.kind).toBe('ok');
  });
});
