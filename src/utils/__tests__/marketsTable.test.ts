import { describe, expect, it } from 'vitest';
import type { ChartMarket } from '../marketRegistry';
import {
  type DexState,
  MARKETS_STALE_MS,
  WeightMeter,
  bareName,
  fmtMarketPrice,
  fundingHourPct,
  fundingYearPct,
  isFresh,
  marketRows,
  marketTableModel,
  openInterestUsd,
  parseDexCtxs,
  registryDexes,
  rowWhyText,
  sortRows,
} from '../marketsTable';

const btc: ChartMarket = { coin: 'BTC', dex: '', szDecimals: 5, maxLeverage: 40, scanner: 'full' };
const eth: ChartMarket = { coin: 'ETH', dex: '', szDecimals: 4, maxLeverage: 25, scanner: 'none' };
const nvda: ChartMarket = { coin: 'xyz:NVDA', dex: 'xyz', szDecimals: 3, maxLeverage: 10, scanner: 'none' };
const gold: ChartMarket = { coin: 'io:GOLD', dex: 'io', szDecimals: 2, maxLeverage: 10, scanner: 'none' };

const ctx = (markPx: string, openInterest: string, dayNtlVlm = '1000', funding = '0.0000125') => ({ markPx, openInterest, dayNtlVlm, funding, oraclePx: markPx });
const NOW = Date.UTC(2026, 10, 13, 21, 0, 0);

describe('przeliczenia tabeli „Rynki”', () => {
  it('otwarte pozycje w USD: openInterest × markPx; brak albo zła liczba → null', () => {
    expect(openInterestUsd(31_000, 80_000)).toBe(2_480_000_000);
    expect(openInterestUsd(0, 80_000)).toBe(0);
    expect(openInterestUsd(null, 80_000)).toBeNull();
    expect(openInterestUsd(10, null)).toBeNull();
    expect(openInterestUsd(-1, 80_000)).toBeNull();
  });

  it('funding: godzina w % i rok przeliczony (× 24 × 365, bez składania)', () => {
    expect(fundingHourPct(0.0000125)).toBeCloseTo(0.00125, 12);
    expect(fundingYearPct(0.0000125)).toBeCloseTo(10.95, 10);
    expect(fundingYearPct(-0.0001)).toBeCloseTo(-87.6, 10);
    expect(fundingHourPct(null)).toBeNull();
    expect(fundingYearPct(null)).toBeNull();
  });

  it('cena z szDecimals: poniżej 0,01 najwyżej 6 − szDecimals miejsc, powyżej 100 000 bez miejsc po przecinku', () => {
    // Polski zapis: twarda spacja tysięcy, przecinek dziesiętny
    expect(fmtMarketPrice(0.004512, 0)).toBe('0,004512');
    expect(fmtMarketPrice(0.004512, 1)).toBe('0,00451');
    expect(fmtMarketPrice(0.0000123, 0)).toBe('0,000012');
    expect(fmtMarketPrice(104_523.7, 5)).toBe('104 524');
    expect(fmtMarketPrice(1_234_567.8, 0)).toBe('1 234 568');
    expect(fmtMarketPrice(3_912.36, 4)).toBe('3 912,4');
    expect(fmtMarketPrice(41.2346, 2)).toBe('41,235');
    expect(fmtMarketPrice(null, 2)).toBe('—');
  });

  it('świeżość: odczyt do 3 min — świeży, starszy — nie; brak odczytu — nie', () => {
    expect(isFresh(NOW - MARKETS_STALE_MS, NOW)).toBe(true);
    expect(isFresh(NOW - MARKETS_STALE_MS - 1, NOW)).toBe(false);
    expect(isFresh(null, NOW)).toBe(false);
  });

  it('świeżość: odczyt „z przyszłości” (cofnięty zegar) świeży do 60 s, dalej — nie', () => {
    expect(isFresh(NOW + 60_000, NOW)).toBe(true);
    expect(isFresh(NOW + 60_001, NOW)).toBe(false);
  });

  it('nazwa bez przedrostka giełdy i giełdy z listy (główna pierwsza, bez powtórzeń)', () => {
    expect(bareName(nvda)).toBe('NVDA');
    expect(bareName(btc)).toBe('BTC');
    expect(registryDexes([nvda, btc, gold, eth, { ...nvda, coin: 'xyz:TSLA' }])).toEqual(['', 'xyz', 'io']);
    expect(registryDexes([nvda])).toEqual(['xyz']);
  });
});

describe('odpowiedź giełdy → liczby rynków', () => {
  it('nazwy z przedrostkiem i bez; złe pola → null, zła odpowiedź → null', () => {
    const raw = [{ universe: [{ name: 'NVDA' }, { name: 'xyz:TSLA' }, { name: 'BAD' }] }, [ctx('180.5', '1000'), ctx('250', '20'), { markPx: 'x', openInterest: '-3', funding: 'nope' }]];
    const m = parseDexCtxs(raw, 'xyz');
    expect(m?.get('xyz:NVDA')).toEqual({ markPx: 180.5, openInterest: 1000, dayNtlVlm: 1000, funding: 0.0000125 });
    expect(m?.get('xyz:TSLA')?.markPx).toBe(250);
    expect(m?.get('xyz:BAD')).toEqual({ markPx: null, openInterest: null, dayNtlVlm: null, funding: null });
    expect(parseDexCtxs(null, '')).toBeNull();
    expect(parseDexCtxs({}, '')).toBeNull();
    expect(parseDexCtxs([{ universe: 'x' }, []], '')).toBeNull();
  });
});

describe('wiersze tabeli', () => {
  const main = parseDexCtxs([{ universe: [{ name: 'BTC' }, { name: 'ETH' }] }, [ctx('80000', '31000', '2500000000'), ctx('3900', '500000', '900000000')]], '')!;
  const xyz = parseDexCtxs([{ universe: [{ name: 'xyz:NVDA' }] }, [ctx('180', '1000000', '50000000')]], 'xyz')!;
  const ok = (ctxs: ReadonlyMap<string, never> | Map<string, unknown>, at = NOW - 10_000): DexState => ({ at, ctxs: ctxs as DexState['ctxs'], failedAt: null });

  it('świeży odczyt: liczby i OI w USD; rynek z rejestru bez wiersza w odpowiedzi: „—” z powodem', () => {
    const rows = marketRows([btc, eth, nvda, { ...nvda, coin: 'xyz:TSLA' }], { '': ok(main), xyz: ok(xyz) }, NOW);
    expect(rows.map((r) => [r.name, r.oiUsd, r.why])).toEqual([
      ['BTC', 2_480_000_000, null],
      ['ETH', 1_950_000_000, null],
      ['NVDA', 180_000_000, null],
      ['TSLA', null, 'not-listed'],
    ]);
    expect(rows[0].at).toBe(NOW - 10_000);
    expect(rowWhyText('not-listed', 'xyz')).toBe('rynku nie ma w odpowiedzi giełdy');
  });

  it('giełda bez odpowiedzi: wiersze jej rynków „—” z powodem, pozostałe z liczbami', () => {
    const rows = marketRows([btc, nvda], { '': ok(main), xyz: { at: null, ctxs: null, failedAt: NOW - 5_000 } }, NOW);
    expect(rows.map((r) => r.why)).toEqual([null, 'no-response']);
    expect(rows[1].ctx).toBeNull();
    expect(rowWhyText('no-response', 'xyz')).toBe('giełda xyz (HIP-3) nie odpowiedziała');
  });

  it('przed pierwszą odpowiedzią: „—” (czekam), bez liczb', () => {
    const rows = marketRows([btc, gold], { '': ok(main) }, NOW);
    expect(rows[1]).toMatchObject({ why: 'waiting', ctx: null, oiUsd: null, at: null });
  });

  it('odczyt starszy niż 3 min: „—”; nieudana próba po starym odczycie — giełda nie odpowiada', () => {
    const old = NOW - MARKETS_STALE_MS - 1;
    expect(marketRows([btc], { '': ok(main, old) }, NOW)[0]).toMatchObject({ why: 'stale', ctx: null, oiUsd: null, at: old });
    expect(marketRows([btc], { '': { at: old, ctxs: main, failedAt: NOW - 1000 } }, NOW)[0].why).toBe('no-response');
    // Nieudana próba, ale poprzedni odczyt jeszcze świeży: liczby zostają z godziną tamtego odczytu
    expect(marketRows([btc], { '': { at: NOW - 70_000, ctxs: main, failedAt: NOW - 10_000 } }, NOW)[0]).toMatchObject({ why: null, at: NOW - 70_000 });
  });

  it('sortowanie: malejąco według OI (domyślnie) albo obrotu, wiersze bez liczby na końcu w kolejności rejestru', () => {
    const rows = marketRows([gold, nvda, eth, btc, { ...nvda, coin: 'xyz:TSLA' }], { '': ok(main), xyz: ok(xyz) }, NOW);
    expect(sortRows(rows).map((r) => r.name)).toEqual(['BTC', 'ETH', 'NVDA', 'GOLD', 'TSLA']);
    expect(sortRows(rows, 'volume').map((r) => r.name)).toEqual(['BTC', 'ETH', 'NVDA', 'GOLD', 'TSLA']);
    const swapped = marketRows([btc, eth], { '': ok(parseDexCtxs([{ universe: [{ name: 'BTC' }, { name: 'ETH' }] }, [ctx('80000', '1', '5'), ctx('3900', '1', '9')]], '')!) }, NOW);
    expect(sortRows(swapped).map((r) => r.name)).toEqual(['BTC', 'ETH']);
    expect(sortRows(swapped, 'volume').map((r) => r.name)).toEqual(['ETH', 'BTC']);
  });
});

describe('model tabeli (gotowe teksty dla widoku)', () => {
  const main = parseDexCtxs([{ universe: [{ name: 'BTC' }, { name: 'ETH' }] }, [ctx('80000', '31000', '2500000000'), ctx('3900', '500000', '900000000', '-0.0001')]], '')!;
  const deps = {
    groupsOf: (list: readonly ChartMarket[]) =>
      (['crypto', 'hip3'] as const).map((id) => ({ id, title: id, markets: list.filter((m) => (m.dex === '') === (id === 'crypto')) })).filter((g) => g.markets.length > 0),
    fmtTime: (ms: number) => `t${ms}`,
    scannerWhy: (coin: string) => `bez skanera ${coin}`,
  };

  it('wiersz z liczbami: cena, obrót, OI, funding godzinowy i roczny, godzina odczytu, link, skaner', () => {
    const groups = marketTableModel([eth, btc, nvda], { '': { at: NOW - 1000, ctxs: main, failedAt: null } }, NOW, 'oi', deps);
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.coin)])).toEqual([
      ['crypto', ['BTC', 'ETH']],
      ['hip3', ['xyz:NVDA']],
    ]);
    expect(groups[0].rows[0]).toEqual({
      coin: 'BTC',
      name: 'BTC',
      exchange: 'Hyperliquid',
      exchangeTitle: 'Hyperliquid (główna)',
      price: '80 000',
      volume: '$2,50B',
      openInterest: '$2,48B',
      fundingHour: '+0,0013%',
      fundingYear: '+11,0%',
      readAt: `t${NOW - 1000}`,
      why: null,
      chartHref: '#charts?m=BTC',
      scanner: { text: 'mapa likwidacji', why: null },
    });
    expect(groups[0].rows[1]).toMatchObject({ fundingHour: '−0,0100%', fundingYear: '−87,6%', scanner: { text: '—', why: 'bez skanera ETH' } });
  });

  it('wiersz bez danych: same „—”, bez godziny, z powodem', () => {
    const [, hip3] = marketTableModel([btc, nvda], { '': { at: NOW - 1000, ctxs: main, failedAt: null } }, NOW, 'oi', deps);
    expect(hip3.rows[0]).toMatchObject({
      name: 'NVDA',
      exchange: 'xyz',
      price: '—',
      volume: '—',
      openInterest: '—',
      fundingHour: '—',
      fundingYear: null,
      readAt: null,
      why: 'czekam na pierwszą odpowiedź giełdy',
      chartHref: '#charts?m=xyz:NVDA',
    });
  });
});

describe('licznik wag', () => {
  it('suma z ostatnich 60 s i od otwarcia strony', () => {
    const m = new WeightMeter();
    m.add(0, 20);
    m.add(30_000, 20);
    m.add(60_000, 20);
    expect(m.lastMinute(60_000)).toBe(40);
    expect(m.lastMinute(89_999)).toBe(40);
    expect(m.lastMinute(90_000)).toBe(20);
    expect(m.total).toBe(60);
  });
});
