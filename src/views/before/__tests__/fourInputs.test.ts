import { describe, expect, it } from 'vitest';
import type { Candle } from '../../../charts/pro/hl/parse';
import type { InputSeries, InputStore } from '../../../charts/pro/chart/layoutInputs';
import { dayVwapOf, vwapNum } from '../../../charts/pro/chart/layoutNumbers';
import type { VBar } from '../../../utils/auction';
import { ALL, LIQ_MAP, MIN, NOW, NY, PUB, READY, at, bars, inputs } from '../../../utils/__tests__/fixtures/fourNumbers';
import { fourNumbers, fuelNum, readFourInputs, vwapFour } from '../fourInputs';

describe('fuelNum (2): paliwo 1% pod i nad ceną z mapy likwidacji skanera', () => {
  it('LIVE z mapą świeżą; po 2 min wiek migawki zamiast LIVE; opóźniona mapa z uwagą', () => {
    const n = fuelNum(inputs());
    expect(n).toMatchObject({ id: 'fuel', title: 'Paliwo ±1%', value: 'pod 3,5M · nad 3,4M', badge: 'LIVE' });
    expect(n.note).toBeUndefined();
    expect(n.hint).toContain('pozycji on-chain');
    const old = fuelNum(inputs({ liq: { status: 'ready', map: { ...LIQ_MAP, asOf: NOW - 5 * MIN } } }));
    expect(old.note).toBe('5 min');
    expect(fuelNum(inputs({ liq: { status: 'delayed', map: LIQ_MAP } })).note).toBe('opóźnione');
  });

  it('brak mapy likwidacji: „—, tylko BTC” poza BTC albo „—” z powodem', () => {
    const eth = fuelNum(inputs({ coin: 'ETH' }));
    expect(eth).toMatchObject({ value: '—', note: 'tylko BTC' });
    expect(eth.hint).toContain('Tylko BTC');
    expect(fuelNum(inputs({ liq: { status: 'unconfigured', map: null } }))).toMatchObject({ value: '—', hint: 'Mapa likwidacji niedostępna w tej wersji strony' });
    expect(fuelNum(inputs({ liq: { status: 'error', map: null } })).hint).toBe('Nie udało się pobrać mapy likwidacji');
    expect(fuelNum(inputs({ liq: { status: 'loading', map: null } })).hint).toContain('Czekam na dane');
    expect(fuelNum(inputs({ liq: { status: 'stale', map: LIQ_MAP } })).value).toBe('—');
    expect(fuelNum(inputs({ price: undefined })).value).toBe('—');
  });
});

describe('vwapFour (4): odległość od VWAP doby w σ — ta sama liczba co w nagłówku Kokpitu', () => {
  const c1m = (from: number, to: number, f: (t: number) => number): Candle[] =>
    bars(from, to, f).map((b) => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, n: 1 }));
  const day = at(2026, 11, 7, 0);
  const list = c1m(day, NOW, (t) => 100_000 + ((t - day) / MIN) * 0.5);

  it('z VWAP doby UTC i ceną: wartość i plakietka jak vwapNum, tytuł Czwórki', () => {
    const dayVwap = dayVwapOf(list, NOW);
    const n = vwapFour(inputs({ dayVwap, price: 100_250 }));
    const head = vwapNum({ coin: 'BTC', now: NOW, price: 100_250, dayVwap });
    expect(n).toMatchObject({ id: 'vwap', title: 'Od VWAP', value: head.value, badge: 'LIVE', hint: head.hint });
    expect(n.value).toMatch(/σ$/);
  });

  it('bez świec od 00:00 UTC — „—” z powodem', () => {
    const n = vwapFour(inputs({ dayVwap: dayVwapOf(list.slice(10), NOW) }));
    expect(n.value).toBe('—');
    expect(n.hint).toContain('00:00 UTC');
  });
});

describe('fourNumbers', () => {
  it('cztery pozycje w stałej kolejności, każda z plakietką', () => {
    const n = fourNumbers(inputs());
    expect(n.coin).toBe('BTC');
    expect(n.now).toBe(NOW);
    expect(n.items.map((i) => i.id)).toEqual(['clarity', 'fuel', 'hourWidth', 'vwap']);
    for (const i of n.items) expect(['LIVE', 'MODEL']).toContain(i.badge);
  });
});

describe('readFourInputs: świece z magazynu rynku jak nagłówek układu', () => {
  type Spec = { state?: InputSeries['loadState']; list?: Candle[] };
  const toCandles = (bs: VBar[]): Candle[] => bs.map((b) => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, n: 1 }));
  function fakeStore(coin: string, series: Record<string, Spec>) {
    const older: Record<string, number[]> = {};
    const made = new Map<string, InputSeries>();
    const st: InputStore & { older: Record<string, number[]> } = {
      older,
      coin,
      serverNow: () => NOW,
      lastPrice: () => 100_950,
      series(id: string): InputSeries {
        let s = made.get(id);
        if (!s) {
          const spec = series[id] ?? { state: 'loading' };
          s = { loadState: spec.state ?? 'ready', load: async () => {}, candlesNow: () => spec.list ?? [], historyExhausted: false, olderFailed: false };
          made.set(id, s);
        }
        return s;
      },
      indicatorCandles(id: string, from: number) {
        (older[id] ??= []).push(from);
        return st.series(id).candlesNow();
      },
      exactBook: () => null,
      zeroKnown: { covers: () => false },
      orders: { range: () => [] },
    };
    return st;
  }

  it('1m od wpisu Mapy dnia (wcześniej niż otwarcie NY), 1h od 20 dni przed sesją najbliższej godziny', () => {
    const store = fakeStore('BTC', { '1m': { list: toCandles(ALL) }, '1h': { list: [] } });
    const x = readFourInputs(store, { status: 'ready', map: LIQ_MAP }, READY);
    expect(store.older['1m']).toContain(PUB);
    // Otwarcie Londynu 7.11 o 08:00 UTC; 20 sesji wstecz od 18.10 (wtedy otwarcie o 07:00 UTC, czas letni)
    expect(store.older['1h']).toContain(at(2026, 10, 18, 7));
    expect(x).toMatchObject({ coin: 'BTC', now: NOW, price: 100_950 });
    expect(Array.isArray(x.bars1m)).toBe(true);
    // 1h nie sięga 20 dni wstecz, a historia trwa — czekamy
    expect(x.bars1h).toBeUndefined();
    expect(fourNumbers(x).items[0].value).toBe('trendowy · mapa 2/4');
  });

  it('poza BTC bez map z bloga: 1m od otwarcia NY; świece w drodze — undefined', () => {
    const store = fakeStore('ETH', { '1m': { state: 'loading' } });
    const x = readFourInputs(store, { status: 'ready', map: LIQ_MAP }, READY);
    expect(x.bars1m).toBeUndefined();
    expect(x.dayVwap).toBeUndefined();
    const ok = fakeStore('ETH', { '1m': { list: toCandles(ALL) } });
    readFourInputs(ok, { status: 'ready', map: LIQ_MAP }, READY);
    expect(ok.older['1m']).toContain(NY.start);
    expect(ok.older['1m']).not.toContain(PUB);
  });
});
