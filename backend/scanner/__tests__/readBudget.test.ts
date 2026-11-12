import { describe, expect, it } from 'vitest';
import { AddressBook } from '../addressBook.ts';
import { loadConfig } from '../config.ts';
import { HlRest } from '../hl.ts';
import { WeightLimiter } from '../rateLimiter.ts';
import { LiqConfirmer } from '../liqDetect.ts';
import { loadPositionsFixture, simulateReads } from '../readBudgetSim.ts';
import { Scanner } from '../scanner.ts';

const MIN = 60_000;
const pos = (szi: number, at = 0, liqPx = 50_000) => ({ szi, entryPx: 100_000, liqPx, scannedAt: at });

describe('budżet odczytów (a): osobne limitery dla potwierdzeń likwidacji i prognoz', () => {
  const base = { HQ_STATE_DIR: '/s', HQ_OUT_DIR: '/o' };
  it('domyślnie 90 wag/min na potwierdzenia i 120 na prognozy i archiwum; razem z pozycjami i wielorybami ≤ 800', () => {
    const r = loadConfig(base);
    expect(r.ok && [r.config.weightPerMin, r.config.liqWeightPerMin, r.config.forecastWeightPerMin]).toEqual([240, 90, 120]);
    const w = loadConfig({ ...base, HQ_WHALE_TOP: '200', HQ_WHALE_WEIGHT_PER_MIN: '200' });
    expect(w.ok).toBe(true);
    const over = loadConfig({ ...base, HQ_WHALE_TOP: '200', HQ_WHALE_WEIGHT_PER_MIN: '400', HQ_FORECAST_WEIGHT_PER_MIN: '200' });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.errors.join(' ')).toMatch(/razem najwyżej 800 wag\/min/);
  });

  it('limitery są niezależne: 429 na potwierdzeniach wstrzymuje tylko je, odczyty pozycji idą dalej bez czekania', async () => {
    const liq = new WeightLimiter(90);
    const positions = new WeightLimiter(240);
    const busy = new HlRest(liq, async () => new Response('', { status: 429 }), () => 1000, async () => {});
    expect(await busy.info({ type: 'userFillsByTime', user: '0x1' }, 20)).toBeNull();
    expect(liq.reserve(2, 2000)).toBeGreaterThanOrEqual(29_000);
    expect(positions.reserve(2, 2000)).toBe(0);
  });

  it('potwierdzenia likwidacji idą przez własny klient (własny limiter), nie przez budżet skanu pozycji', async () => {
    const calls: string[] = [];
    const client = (name: string) => ({ info: async (b: { type: string }) => (calls.push(`${name}:${b.type}`), []), charge: () => {}, healthy: () => true, errors: 0 }) as unknown as HlRest;
    const confirmer = new LiqConfirmer({ coin: 'BTC', maxPerMin: 3 });
    const now = 10 * MIN;
    confirmer.enqueue({ addr: '0xa', prev: pos(1, 0), from: 0, to: now - MIN });
    const s = new Scanner({ coin: 'BTC', book: new AddressBook(), rest: client('pozycje'), liqRest: client('likwidacje'), outDir: '/tmp/x', r2: null, now: () => now, confirmer, tapeSince: 0 });
    expect(await s.confirmLiquidations()).toBe(1);
    expect(calls).toEqual(['likwidacje:userFillsByTime']);
  });
});

describe('budżet odczytów (b): kolejka bez zagłodzenia', () => {
  it('konta po transakcji: (czas od ostatniego odczytu) × √wartość — małe konto czekające 12 min przed dużym czytanym 30 s temu', () => {
    const b = new AddressBook();
    for (const a of ['0xbig', '0xsmall']) b.recordTrade([a, '0xmm'], 1, 0);
    b.updatePosition('0xmm', null, 0);
    b.updatePosition('0xbig', pos(50), 0); // 5 mln USD
    b.updatePosition('0xsmall', pos(0.1), 0); // 10 tys. USD
    const t = 12 * MIN;
    b.updatePosition('0xbig', pos(50, t - 30_000), t - 30_000);
    b.recordTrade(['0xsmall', '0xmm'], 1000, MIN);
    b.recordTrade(['0xbig', '0xnew'], 5000, t - 10_000);
    // small 12 min × √10 tys. = 1200, big 0,5 min × √5 mln ≈ 1118; nowy adres: (1/6 + 1 min) × √5 tys. ≈ 82
    expect(b.due(t, 1)).toEqual(['0xsmall']);
    expect(b.due(t, 10).filter((a) => a !== '0xmm').slice(0, 3)).toEqual(['0xsmall', '0xbig', '0xnew']);
  });

  it('konto po transakcji czekające 15 min i dłużej: na początek tej kolejki (najdłużej czekające pierwsze), przed większymi', () => {
    const b = new AddressBook();
    b.recordTrade(['0xsmall', '0xbig'], 1, 0);
    b.updatePosition('0xsmall', pos(0.01), 0); // 1 tys. USD
    b.updatePosition('0xbig', pos(5), 0); // 500 tys. USD
    b.recordTrade(['0xsmall', '0xbig'], 1000, MIN);
    const t = 16 * MIN;
    b.updatePosition('0xbig', pos(5, t - 10_000), t - 10_000);
    for (let i = 0; i < 5; i++) b.recordTrade([`0xn${i}`, '0xbig'], 1e8, t - 5000);
    // small: 15 min od transakcji; big i nowe adresy z dużo wyższym priorytetem wartości, ale krócej czekające
    expect(b.due(t, 1)).toEqual(['0xsmall']);
    expect(b.due(t - 1000, 1)).not.toEqual(['0xsmall']);
  });

  it('przeciążenie: małe konto po transakcji odczytane w ok. 15 min, choć 300 większych kont handluje bez przerwy', () => {
    const b = new AddressBook(10_000);
    b.recordTrade(['0xwhale', '0xsmall'], 1, 0);
    b.updatePosition('0xwhale', pos(1000), 0); // 100 mln USD: górna połowa nominału
    b.updatePosition('0xsmall', pos(0.05), 0); // 5 tys. USD
    const mids = Array.from({ length: 300 }, (_, i) => `0xm${i}`);
    for (const a of mids) b.updatePosition(a, pos(2), 0); // 200 tys. USD
    b.recordTrade(['0xsmall', '0xmid-other'], 1000, MIN);
    let readAt: number | null = null;
    for (let t = MIN; t <= 6 * 60 * MIN && readAt === null; t += 20_000) {
      for (let i = 0; i < mids.length; i += 2) b.recordTrade([mids[i], mids[i + 1]], 1000, t);
      for (const a of b.due(t, 6)) {
        if (a === '0xsmall') readAt = t;
        b.updatePosition(a, a === '0xwhale' ? pos(1000, t) : a === '0xsmall' ? pos(0.05, t) : a.startsWith('0xm') && a !== '0xmid-other' ? pos(2, t) : null, t);
      }
    }
    expect(readAt).not.toBeNull();
    expect(readAt! - MIN).toBeLessThanOrEqual(20 * MIN);
  });

  it('górna połowa nominału: konto odczytane najpóźniej co 3 min, przed kontami po transakcji', () => {
    const b = new AddressBook();
    b.recordTrade(['0xwhale', '0xsmall'], 1, 0);
    b.updatePosition('0xwhale', pos(500), 0); // 50 mln USD
    b.updatePosition('0xsmall', pos(0.1), 0);
    // Nowe adresy z dużym obrotem od dawna czekają na odczyt (wysoki priorytet w kolejce po transakcji)
    for (let i = 0; i < 20; i++) b.recordTrade([`0xn${i}`, `0xo${i}`], 1e9, 0);
    expect(b.due(2.9 * MIN, 1)).not.toEqual(['0xwhale']);
    expect(b.due(3 * MIN, 1)).toEqual(['0xwhale']);
  });

  it('pozycje bez transakcji: wiek × √nominał × bliskość ceny likwidacji (8× do 1%, 4× do 3%, od 25 tys. USD), bez terminów 2/10/30 min', () => {
    const b = new AddressBook();
    const at = (liqPx: number, szi: number) => ({ szi, entryPx: 100_000, liqPx, scannedAt: 0 });
    for (const a of ['0xnear', '0xmid', '0xfar', '0xdust']) b.recordTrade([a, '0xz'], 1, 0);
    b.updatePosition('0xz', null, 0);
    b.updatePosition('0xnear', at(99_500, 0.3), 0); // 30 tys. USD, 0,5% od mark: ×8
    b.updatePosition('0xmid', at(97_800, 0.3), 0); // 2,2%: ×4
    b.updatePosition('0xfar', at(80_000, 0.3), 0); // 20%
    b.updatePosition('0xdust', at(99_500, 0.2), 0); // 20 tys. USD — poniżej progu, bez promocji
    // Minuta po odczycie (dawniej nic nie było należne przed 30 min): 1 × √30 tys. × 8 ≈ 1386, × 4 ≈ 693, ≈ 173; pył ≈ 141
    expect(b.due(MIN, 10, 100_000)).toEqual(['0xnear', '0xmid', '0xfar', '0xdust']);
    expect(b.due(MIN, 2, 100_000)).toEqual(['0xnear', '0xmid']);
    // Bez ceny mark bez promocji: kolejność wg wiek × √nominał
    expect(b.due(MIN, 10).slice(-1)).toEqual(['0xdust']);
    // Wiek kompensuje wielkość: pył czytany dawniej wyprzedza większą pozycję
    b.updatePosition('0xnear', at(99_500, 0.3), 9 * MIN);
    b.updatePosition('0xmid', at(97_800, 0.3), 9 * MIN);
    b.updatePosition('0xfar', at(80_000, 0.3), 9 * MIN);
    expect(b.due(10 * MIN, 1)).toEqual(['0xdust']); // 10 × √20 tys. ≈ 1414 > 1 × √30 tys. ≈ 173
  });
});

describe('budżet odczytów (d): kolejka kont po transakcji bez odczytu (`dirty` w status.json)', () => {
  it('liczba i czekanie od pierwszej transakcji po odczycie (p50, p90); odczyt zdejmuje z kolejki; zasiew się nie liczy', () => {
    const b = new AddressBook();
    expect(b.dirtyStats(0)).toEqual({ n: 0, waitP50Min: 0, waitP90Min: 0 });
    b.recordTrade(['0xa', '0xb'], 1000, 0);
    b.recordTrade(['0xb', '0xc'], 1000, 8 * MIN); // 0xb czeka od pierwszej transakcji (0), nie od ostatniej
    b.recordTrade(['0xd', '0xc'], 1000, 8 * MIN);
    b.updatePosition('0xa', null, 9 * MIN);
    b.seed('0xranked', 5e6, 0);
    // czekają: 0xb 10 min, 0xc 2 min, 0xd 2 min → p50 2, p90 2 + 0,8 × 8 = 8,4
    const s = b.dirtyStats(10 * MIN);
    expect(s.n).toBe(3);
    expect(s.waitP50Min).toBeCloseTo(2, 9);
    expect(s.waitP90Min).toBeCloseTo(8.4, 9);
    // przetrwa zapis i odczyt stanu
    expect(AddressBook.fromJSON(JSON.parse(JSON.stringify(b.toJSON()))).dirtyStats(10 * MIN)).toEqual(s);
    // znów handluje po odczycie: czeka od tej transakcji
    b.recordTrade(['0xa', '0xb'], 1000, 9.5 * MIN);
    expect(b.dirtyStats(10 * MIN).n).toBe(4);
  });
});

describe('budżet odczytów (c): model obciążenia z rozkładem wielkości z danych (24 h, skala 1/5, 120 odczytów/min)', () => {
  it('fikstura zgodna z danymi 12.11: 32 421 pozycji, od 1 mln USD ok. 79% nominału (322 pozycje), od 10 mln ok. 51,5% (43)', () => {
    const f = loadPositionsFixture();
    const all = [...f.decades.map((d) => [d.lo, d.n, d.ntlUsd] as const), ...f.top.map(([u]) => [u, 1, u] as const)];
    const n = all.reduce((s, x) => s + x[1], 0);
    const total = all.reduce((s, x) => s + x[2], 0);
    const from = (lo: number) => all.filter((x) => x[0] >= lo);
    expect(n).toBe(32_421);
    expect(from(1e6).reduce((s, x) => s + x[1], 0)).toBe(322);
    expect(from(1e6).reduce((s, x) => s + x[2], 0) / total).toBeCloseTo(0.79, 2);
    expect(f.top.filter(([u]) => u >= 1e7)).toHaveLength(43);
    expect(f.top.filter(([u]) => u >= 1e7).reduce((s, [u]) => s + u, 0) / total).toBeCloseTo(0.515, 2);
  });

  // Kryteria (też po wdrożeniu): ageNtlP50Min < 10 w każdej minucie; mediana wieku wg liczby nie gorsza niż 1,5 × stan
  // przed zmianą; kolejka po transakcji: p90 czekania < 30 min. Stan przed w modelu: dawny harmonogram przy 73 odczytach
  // na minutę (617 min; na serwerze zmierzono 347 — model jest bardziej pesymistyczny, więc porównanie względne).
  // Przy 70 kontach/min (350 w skali rzeczywistej) budżet 120 odczytów/min nie nadąża z kolejką po transakcji —
  // sprawdzane tylko pierwsze kryterium.
  const OPTS = { readsPerMin: 24, minutes: 24 * 60 + 360, warmupMin: 360 };
  const BEFORE_P50 = loadPositionsFixture().calibration.modelAgeMin.p50;

  it.each([20, 40])('%i kont handlujących na minutę: ntlP50 < 10 min co minutę, mediana wg liczby ≤ 1,5 × stan przed, p90 czekania po transakcji < 30 min', (tradersPerMin) => {
    const r = simulateReads({ ...OPTS, tradersPerMin });
    expect(r.ntlP50).toHaveLength(24 * 60);
    expect(r.ntlP50Max).toBeLessThan(10);
    expect(r.p50Median).toBeLessThanOrEqual(1.5 * BEFORE_P50);
    expect(r.dirtyWaitP90Max).toBeLessThan(30);
    // bez zagłodzenia: konta każdej wielkości czekają po transakcji w medianie kilka minut
    for (const k of ['big', 'mid', 'small'] as const) expect(r.wait[k].p50).toBeLessThan(10);
  }, 120_000);

  it('70 kont handlujących na minutę (ponad budżet): ntlP50 nadal < 10 min co minutę, kolejka po transakcji bez zagłodzenia (p90 < 6 h)', () => {
    const r = simulateReads({ ...OPTS, tradersPerMin: 70 });
    expect(r.ntlP50Max).toBeLessThan(10);
    expect(r.dirtyWaitP90Max).toBeLessThan(360);
  }, 120_000);
});
