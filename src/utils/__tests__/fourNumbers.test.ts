import { describe, expect, it } from 'vitest';
import type { BlogMap, BlogMapsState } from '../../state/useBlogMaps';
import type { Candle } from '../../charts/pro/hl/parse';
import type { InputSeries, InputStore } from '../../charts/pro/chart/layoutInputs';
import { dayVwapOf, vwapNum } from '../../charts/pro/chart/layoutNumbers';
import { fmtDm, fmtHm } from '../../charts/pro/core/time';
import type { VBar } from '../auction';
import type { LiqMap } from '../liqMap';
import { tradeSessionOn } from '../sessionDay';
import {
  type FourInputs,
  type FourNumbers,
  clarityNum,
  fourNumbers,
  fourNumbersText,
  fuelNum,
  hourWidth,
  hourWidthNum,
  lastClosedNy,
  liqFuel,
  nextSessionHour,
  readFourInputs,
  vwapFour,
} from '../fourNumbers';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 7.11.2026 06:30 UTC, sesja azjatycka (czas zimowy w Londynie i NY: Londyn od 08:00 UTC, NY od 14:30 UTC) */
const NOW = at(2026, 11, 7, 6, 30);
const NY = tradeSessionOn(at(2026, 11, 6, 0), 'ny');

/**
 * Cena w minucie 6.11: do otwarcia NY płasko 99 600; IB NY 100 005 i 100 295 (IB 100 000–100 300), od 15:30 wybicie
 * w górę (100 500), od 18:30 szczyt 100 995 (high 101 000), w ostatniej godzinie zamknięcie 100 950 — dzień trendowy
 * (zakres 1000 = 3,3× IB, zamknięcie w górnych 20%). Po sesji (Azja 7.11) 100 950.
 */
const px = (t: number): number => {
  if (t < NY.start) return 99_600;
  if (t < NY.start + 30 * MIN) return 100_005;
  if (t < NY.ibEnd) return 100_295;
  if (t < NY.start + 4 * H) return 100_500;
  if (t < NY.end - H) return 100_995;
  return 100_950;
};
const bars = (from: number, to: number, f: (t: number) => number = px): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += MIN) out.push({ time: t, open: f(t), high: f(t) + 5, low: f(t) - 5, close: f(t), volume: 1 });
  return out;
};
const ALL = bars(at(2026, 11, 6, 7), NOW + MIN);

const PUB = at(2026, 11, 6, 7, 5) + 20_000;
const DAY_MAP: BlogMap = {
  id: '2026-11-06-mapa-dnia',
  title: 'BTC przed Londynem',
  kind: 'dzien',
  publishedAt: PUB,
  price: 99_600,
  levels: [
    { label: 'Cena wpisu', price: 99_600 },
    { label: 'Szczyt Azji', price: 100_300 },
    { label: 'Luka', price: 100_800 },
    { label: 'VAH tygodnia', price: 102_000 },
  ],
  url: 'blog/2026-11-06-mapa-dnia/',
};
const NY_MAP: BlogMap = { ...DAY_MAP, id: '2026-11-06-przed-ny', title: 'BTC przed NY', kind: 'ny', publishedAt: at(2026, 11, 6, 13), levels: [{ label: 'X', price: 103_000 }] };
const READY: BlogMapsState = { status: 'ready', maps: [NY_MAP, DAY_MAP] };

const LIQ_MAP: LiqMap = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - 30_000,
  markPx: 100_000,
  stepUsd: 100,
  // Środki kubełków longów: 98 950 (poza 1%), 99 050 i 99 850 (pod ceną)
  longs: [
    { px: 98_900, ntlUsd: 9e6, n: 5 },
    { px: 99_000, ntlUsd: 1e6, n: 4 },
    { px: 99_800, ntlUsd: 2e6, n: 6 },
  ],
  // Środki kubełków shortów: 99 950 (pod ceną — strona mapy nie ma znaczenia), 100 050 i 100 950 (nad), 101 050 (poza 1%)
  shorts: [
    { px: 99_900, ntlUsd: 5e5, n: 3 },
    { px: 100_000, ntlUsd: 3e6, n: 7 },
    { px: 100_900, ntlUsd: 4e5, n: 3 },
    { px: 101_000, ntlUsd: 8e6, n: 9 },
  ],
  coverage: { positions: 100, addresses: 80, scannedBtc: 1000, longBtc: 500, shortBtc: 500, wrongSide: 0, oiBtc: 2000, share: 0.25 },
  ageMin: { p50: 3, p90: 8, ntlP50: 4 },
  ctxAt: NOW - 30_000,
  method: 'hl-clearinghouse-v1',
};

const inputs = (patch: Partial<FourInputs> = {}): FourInputs => ({
  coin: 'BTC',
  now: NOW,
  price: 100_000,
  bars1m: ALL,
  maps: READY,
  liq: { status: 'ready', map: LIQ_MAP },
  bars1h: undefined,
  dayVwap: undefined,
  ...patch,
});

describe('lastClosedNy: ostatnia zamknięta sesja NY', () => {
  it('w Azji — NY z poprzedniej doby UTC; w sesji NY — wczorajsza', () => {
    expect(lastClosedNy(NOW)).toEqual(NY);
    expect(lastClosedNy(at(2026, 11, 7, 16))).toEqual(NY);
    expect(lastClosedNy(at(2026, 11, 8, 0, 10))).toEqual(tradeSessionOn(at(2026, 11, 7, 0), 'ny'));
  });
});

describe('clarityNum (1): typ dnia ostatniej sesji NY i trafienia mapy z bloga', () => {
  it('dzień trendowy, Mapa dnia 2/4 dotknięte (pierwszeństwo przed mapą przed NY)', () => {
    const n = clarityNum(inputs());
    expect(n).toMatchObject({ id: 'clarity', title: 'Czytelność wczoraj', value: 'trendowy · mapa 2/4', badge: 'MODEL' });
    expect(n.note).toBeUndefined();
    expect(n.hint).toMatch(/^MODEL · Dalton: /);
    expect(n.hint).toContain(`NY ${fmtDm(NY.start)}`);
    expect(n.hint).toContain('3,3× IB');
    expect(n.hint).toContain('Mapa dnia');
    expect(n.hint).toContain('2/4');
  });

  it('luka w świecach 1m w oknie mapy: „mapa —” z powodem (te same reguły co ✓, bez liczby z części danych)', () => {
    const gap = ALL.filter((b) => b.time < at(2026, 11, 6, 12) || b.time >= at(2026, 11, 6, 12, 5));
    const n = clarityNum(inputs({ bars1m: gap }));
    expect(n.value).toBe('trendowy · mapa —');
    expect(n.hint).toContain('luka w świecach 1m');
    // Dotknięcia sprzed i spoza luki zostają policzone, ale reszta jest nierozliczona
    expect(n.hint).toContain('co najmniej 2 z 4');
  });

  it('bez mapy dla tej sesji, z mapami w drodze, poza BTC — „mapa —” z powodem', () => {
    expect(clarityNum(inputs({ maps: { status: 'ready', maps: [] } }))).toMatchObject({ value: 'trendowy · mapa —' });
    expect(clarityNum(inputs({ maps: { status: 'ready', maps: [] } })).hint).toContain(`Brak mapy z bloga dla sesji NY ${fmtDm(NY.start)}`);
    expect(clarityNum(inputs({ maps: { status: 'loading', maps: [] } })).hint).toContain('Czekam na dane');
    expect(clarityNum(inputs({ maps: { status: 'missing', maps: [] } })).hint).toContain('plik map z bloga niedostępny');
    const eth = clarityNum(inputs({ coin: 'ETH' }));
    expect(eth.value).toBe('trendowy · mapa —');
    expect(eth.hint).toContain('tylko BTC');
    // Mapa tygodnia (bez okna sesji) nie jest rozliczana
    const week = clarityNum(inputs({ maps: { status: 'ready', maps: [{ ...DAY_MAP, kind: 'inne' }] } }));
    expect(week.value).toBe('trendowy · mapa —');
  });

  it('świece nie obejmują sesji albo jeszcze się wczytują — „—” z powodem', () => {
    const late = clarityNum(inputs({ bars1m: ALL.filter((b) => b.time >= NY.start + H) }));
    expect(late.value).toBe('—');
    expect(late.hint).toContain('nie obejmują całej sesji NY');
    const wait = clarityNum(inputs({ bars1m: undefined }));
    expect(wait).toMatchObject({ value: '—', badge: 'MODEL' });
    expect(wait.hint).toContain('Czekam na dane');
    expect(clarityNum(inputs({ bars1m: { why: 'Błąd sieci' } })).hint).toContain('Błąd sieci');
  });
});

describe('liqFuel i fuelNum (2): paliwo 1% pod i nad ceną z mapy likwidacji', () => {
  it('suma kubełków po środku kubełka w [p·0,99, p) i (p, p·1,01], obie strony mapy', () => {
    // Pod: 99 050 (1M) + 99 850 (2M) + 99 950 (0,5M); nad: 100 050 (3M) + 100 950 (0,4M)
    expect(liqFuel(LIQ_MAP, 100_000)).toEqual({ below: 3.5e6, above: 3.4e6 });
    // Kubełek dokładnie na cenie nie należy do żadnej strony
    expect(liqFuel(LIQ_MAP, 100_050)).toEqual({ below: 1e6 + 2e6 + 5e5, above: 4e5 + 8e6 });
  });

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

describe('nextSessionHour i hourWidth (3): typowa szerokość najbliższej godziny sesji', () => {
  it('w Azji — godzina otwarcia Londynu; w sesji — następna pełna godzina; godzina z otwarciem NY — NY', () => {
    expect(nextSessionHour(NOW)).toEqual({ hour: at(2026, 11, 7, 8), s: tradeSessionOn(at(2026, 11, 7, 0), 'london'), opens: true });
    expect(nextSessionHour(at(2026, 11, 7, 7))).toMatchObject({ hour: at(2026, 11, 7, 8), opens: true });
    expect(nextSessionHour(at(2026, 11, 7, 10, 20))).toMatchObject({ hour: at(2026, 11, 7, 11), opens: false, s: { id: 'london' } });
    expect(nextSessionHour(at(2026, 11, 7, 13, 10))).toMatchObject({ hour: at(2026, 11, 7, 14), opens: true, s: { id: 'ny' } });
    expect(nextSessionHour(at(2026, 11, 7, 14, 10))).toMatchObject({ hour: at(2026, 11, 7, 15), opens: false, s: { id: 'ny' } });
    // Koniec NY o północy UTC: następna godzina sesji to otwarcie Londynu
    expect(nextSessionHour(at(2026, 11, 7, 23, 20))).toMatchObject({ hour: at(2026, 11, 8, 8), opens: true, s: { id: 'london' } });
    // Czas letni: Londyn od 07:00 UTC, NY od 13:30 UTC
    expect(nextSessionHour(at(2026, 7, 1, 5, 30))).toMatchObject({ hour: at(2026, 7, 1, 7), opens: true, s: { id: 'london' } });
    expect(nextSessionHour(at(2026, 7, 1, 12, 10))).toMatchObject({ hour: at(2026, 7, 1, 13), opens: true, s: { id: 'ny' } });
  });

  /** Świece 1h przez `days` dni przed 7.11 08:00: o 08:00 UTC zakres 100 + 10·(dni wstecz), inne godziny 1000. */
  const hours = (days: number): VBar[] => {
    const out: VBar[] = [];
    const target = at(2026, 11, 7, 8);
    for (let t = target - days * DAY; t < NOW - H; t += H) {
      const back = Math.round((target - t) / DAY);
      const r = (t - target) % DAY === 0 ? 100 + 10 * back : 1000;
      out.push({ time: t, open: 100_000, high: 100_000 + r / 2, low: 100_000 - r / 2, close: 100_000, volume: 1 });
    }
    return out;
  };

  it('mediana high − low tej godziny UTC z 20 dni; mniej niż 10 próbek — null', () => {
    // 25 dni historii, w oknie 20 dni zakresy 110…300 → mediana (200 + 210) / 2
    expect(hourWidth(hours(25), at(2026, 11, 7, 8), NOW)).toEqual({ median: 205, n: 20 });
    expect(hourWidth(hours(9), at(2026, 11, 7, 8), NOW)).toEqual({ median: null, n: 9 });
    // Świeca bez liczb odpada z próby
    const bad = hours(25).map((b) => (b.time === at(2026, 11, 6, 8) ? { ...b, high: Number.NaN } : b));
    expect(hourWidth(bad, at(2026, 11, 7, 8), NOW).n).toBe(19);
  });

  it('hourWidthNum: MODEL „mediana 20 dni” z godziną i sesją; za mało historii — „—” z powodem', () => {
    const n = hourWidthNum(inputs({ bars1h: hours(25) }));
    expect(n).toMatchObject({ id: 'hourWidth', title: `Szerokość · Londyn ${fmtHm(at(2026, 11, 7, 8))}`, value: '205 USD', badge: 'MODEL' });
    expect(n.hint).toMatch(/^MODEL · mediana 20 dni: /);
    expect(n.hint).toContain('08:00 UTC');
    expect(n.hint).toContain('otwarcie Londyn');
    const few = hourWidthNum(inputs({ bars1h: hours(9) }));
    expect(few).toMatchObject({ value: '—', badge: 'MODEL' });
    expect(few.hint).toContain('min. 10');
    expect(hourWidthNum(inputs({ bars1h: undefined })).hint).toContain('Czekam na dane');
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

describe('fourNumbers i fourNumbersText', () => {
  it('cztery pozycje w stałej kolejności, każda z plakietką', () => {
    const n = fourNumbers(inputs());
    expect(n.coin).toBe('BTC');
    expect(n.now).toBe(NOW);
    expect(n.items.map((i) => i.id)).toEqual(['clarity', 'fuel', 'hourWidth', 'vwap']);
    for (const i of n.items) expect(['LIVE', 'MODEL']).toContain(i.badge);
  });

  it('tekst w jednej linii: wszystkie cztery wartości z plakietkami, brak danych z uwagą', () => {
    const n: FourNumbers = {
      coin: 'BTC',
      now: NOW,
      items: [
        { id: 'clarity', title: 'Czytelność wczoraj', value: 'trendowy · mapa 2/4', badge: 'MODEL', hint: 'h' },
        { id: 'fuel', title: 'Paliwo ±1%', value: 'pod 3,5M · nad 3,4M', badge: 'LIVE', note: '5 min', hint: 'h' },
        { id: 'hourWidth', title: 'Szerokość · Londyn 09:00', value: '—', badge: 'MODEL', hint: 'za mało historii' },
        { id: 'vwap', title: 'Od VWAP', value: '—', badge: 'LIVE', note: 'tylko BTC', hint: 'h' },
      ],
    };
    const text = fourNumbersText(n);
    expect(text).not.toContain('\n');
    expect(text).toContain(`Czwórka BTC, ${fmtDm(NOW)} ${fmtHm(NOW)}`);
    expect(text).toContain('Czytelność wczoraj: trendowy · mapa 2/4 (MODEL)');
    expect(text).toContain('Paliwo ±1%: pod 3,5M · nad 3,4M (LIVE, 5 min)');
    expect(text).toContain('Szerokość · Londyn 09:00: — (brak danych)');
    expect(text).toContain('Od VWAP: — (tylko BTC)');
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

  it('1m od wpisu Mapy dnia (wcześniej niż otwarcie NY), 1h od 20 dni przed godziną otwarcia Londynu', () => {
    const store = fakeStore('BTC', { '1m': { list: toCandles(ALL) }, '1h': { list: [] } });
    const x = readFourInputs(store, { status: 'ready', map: LIQ_MAP }, READY);
    expect(store.older['1m']).toContain(PUB);
    expect(store.older['1h']).toContain(at(2026, 11, 7, 8) - 20 * DAY);
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
