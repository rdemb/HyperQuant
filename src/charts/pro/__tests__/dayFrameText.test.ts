import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Candle } from '../hl/parse';
import { type DayFrame, STATE_DAYS, STATE_KEYS, type StateHistory, type StateKey } from '../core/dayFrame';
import type { ValueRef } from '../core/valueReference';
import { FRAME_RULES, type FrameInput, frameChips, stateDistribution } from '../chart/dayFrameText';
import { FRAME_HISTORY_DAYS, type InputSeries, type InputStore, frameInputOf, readInputs } from '../chart/layoutInputs';
import { readLevelInputs } from '../../../views/desk/nearestInputs';
import { nearestLevels } from '../../../utils/nearestLevels';
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
/** Wczorajsza VA z taśmy (LIVE) i dzisiejsza dotąd. */
const PREV: ValueRef = { kind: 'day', from: D - DAY, to: D, poc: 105, vah: 110, val: 100, source: 'tape', tapeShare: 0.97, bars: 288, through: D, complete: true };
const TODAY: ValueRef = { ...PREV, from: D, to: D + DAY, val: 104, vah: 114, poc: 109, tapeShare: 0.99, bars: 200, through: NOW, complete: false };

const counts = (o: Partial<Record<StateKey, number>>) => Object.fromEntries(STATE_KEYS.map((k) => [k, o[k] ?? 0])) as Record<StateKey, number>;
const hist = (n: number, o: Partial<Record<StateKey, number>> = {}): StateHistory => ({ n, counts: counts(o), early: false });

const frame = (over: Partial<DayFrame> = {}): DayFrame => ({
  day: D,
  ref: 'day',
  prev: PREV,
  value: { today: TODAY, migration: 'overlap-higher', overlap: 0.6 },
  anchor: { from: OPEN, session: 'ny' },
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
    expect(c.value.hint).toContain('dziś taśma 99%, wczoraj taśma 97%');
    expect(c.auction).toMatchObject({ badge: 'MODEL', value: 'przyjęcie nad · 18% dób' });
    expect(c.auction.hint).toMatch(/^MODEL · przyjęcie poza wartością \(Dalton\)/);
    expect(c.auction.hint).toContain('w 11 z 60 poprzednich dób');
    expect(c.auction.hint).toContain(`Liczniki od otwarcia sesji NY o`);
    expect(c.auction.hint).toContain('75 min od otwarcia sesji NY');
    expect(c.ivb).toMatchObject({ badge: 'LIVE', value: 'wybicie nad · 25 min', label: 'IVB 30' });
    expect(c.ivbWidth).toMatchObject({ badge: 'MODEL', value: '0,31 ATR · p35' });
    expect(c.ivbWidth.hint).toMatch(/^MODEL · szerokość IVB w ATR doby, percentyl 20 sesji/);
  });

  it('wartość ze świec (dziś albo wczoraj bez 90% taśmy): MODEL „przybliżenie ze świec” z udziałem taśmy', () => {
    const c = byId(frame({ prev: { ...PREV, source: 'candles', tapeShare: 0.42 } }));
    expect(c.value).toMatchObject({ badge: 'MODEL', value: 'częściowo wyżej · 60%' });
    expect(c.value.hint).toMatch(/^MODEL · przybliżenie ze świec: /);
    expect(c.value.hint).toContain('wczoraj przybliżenie, taśma 42%');
    const t = byId(frame({ value: { today: { ...TODAY, source: 'candles', tapeShare: 0.1 }, migration: 'overlap-higher', overlap: 0.6 } }));
    expect(t.value.badge).toBe('MODEL');
  });

  it('poza sesją: liczniki od 00:00 UTC z dopiskiem „poza sesją”', () => {
    const c = byId(frame({ anchor: { from: D, session: null } }));
    expect(c.auction.value).toBe('przyjęcie nad · poza sesją · 18% dób');
    expect(c.auction.hint).toContain('Poza sesją: liczniki od 00:00 UTC');
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

describe('Jedno źródło wartości: pasek, panel i nagłówek Mapy dnia', () => {
  /** Świece 5m z falującą ceną i taśmą (footprint całej świecy na zamknięciu) od `tapeFrom`. */
  const wave = (from: number, to: number, tapeFrom: number) => {
    const list: Candle[] = [];
    const fps: { t: number; fp: { tick: number; lo: number; buy: number[]; sell: number[] } | null; complete: boolean }[] = [];
    for (let t = from, i = 0; t < to; t += 5 * MIN, i++) {
      const c = 100_000 + 400 * Math.sin(i / 25) + 50 * Math.sin(i / 3);
      const v = 1 + (i % 9);
      list.push({ t, o: c, h: c + 40, l: c - 40, c, v, n: 1 });
      fps.push({ t, fp: t >= tapeFrom ? { tick: 1, lo: Math.round(c), buy: [v / 2], sell: [v / 2] } : null, complete: t >= tapeFrom });
    }
    return { list, fps };
  };
  const store = (tapeFrom: number) => {
    const { list, fps } = wave(D - 15 * DAY, NOW, tapeFrom);
    const st = fakeStore(NOW, { '5m': { list }, '30m': { list: candles(D - FRAME_HISTORY_DAYS * DAY, NOW, 30 * MIN) }, '1m': { list: candles(D, NOW, MIN) } });
    st.lastPrice = () => 100_000;
    const s5 = st.series('5m');
    s5.bars = () => fps;
    return st;
  };
  const scan = { liq: { status: 'loading', map: null }, entry: { status: 'loading', map: null }, ledger: { status: 'loading', summary: null } };
  const blank = { liq: { status: 'loading', map: null }, whales: null, whalesConfigured: false, blog: { state: { status: 'loading' } as never, map: null } };

  for (const [name, tapeFrom, source] of [
    ['z taśmy (cała wczorajsza doba nagrana): LIVE', D - DAY, 'tape'],
    ['ze świec (taśma tylko od dziś): MODEL', D, 'candles'],
  ] as const) {
    it(`te same VAH, VAL i POC wczoraj w pasku, panelu „Najbliższe poziomy” i nagłówku Mapy dnia — ${name}`, () => {
      const st = store(tapeFrom);
      const f = frameInputOf(st, 30).frame as DayFrame;
      expect(f.prev).toMatchObject({ kind: 'day', from: D - DAY, source });
      const lv = nearestLevels(readLevelInputs({ ...st, daily: [] }, scan));
      const at = (id: string) => [...lv.above, ...lv.below].find((l) => l.id === id)!;
      expect(at('vah').px).toBe(f.prev!.vah);
      expect(at('val').px).toBe(f.prev!.val);
      expect(at('poc').px).toBe(f.prev!.poc);
      expect(at('vah').badge).toBe(source === 'tape' ? 'LIVE' : 'MODEL');
      const head = readInputs('day-map', st, blank);
      expect(head.prevDay).toEqual(f.prev);
    });
  }
});
