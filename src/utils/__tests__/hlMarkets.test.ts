import { describe, expect, it } from 'vitest';
import {
  fundingAprPct,
  fundingZ,
  HIP3_MACRO,
  pairedLogReturns,
  parseCandles,
  parseFundingHistory,
  parseHip3,
  parseMarketMap,
  parsePredictedFundings,
  recentlyFlat,
  rollingBetaR2,
  topWithOther,
} from '../hlMarkets';

// Deterministyczny generator (Mulberry32) + Box-Muller — testy muszą być powtarzalne
function makeRng(seed: number) {
  let s = seed;
  const u = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

const NOW = 1_760_000_000_000;

// Fixture zgodny z dokumentacją `{"type":"predictedFundings"}`
const PREDICTED = [
  [
    'ETH',
    [
      ['BinPerp', { fundingRate: '0.0001', nextFundingTime: NOW + 3_600_000, fundingIntervalHours: 8 }],
      ['HlPerp', { fundingRate: '0.00002', nextFundingTime: NOW + 1_800_000, fundingIntervalHours: 1 }],
    ],
  ],
  [
    'BTC',
    [
      ['BinPerp', { fundingRate: '0.00005', nextFundingTime: NOW + 7_200_000, fundingIntervalHours: 8 }],
      ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: NOW + 1_800_000, fundingIntervalHours: 1 }],
      ['BybitPerp', { fundingRate: '0.00008', nextFundingTime: NOW + 7_200_000 }],
    ],
  ],
];

describe('fundingAprPct', () => {
  it('normalizuje stawkę okresową do APR % (rate·24/h·365·100)', () => {
    expect(fundingAprPct(0.0000125, 1)).toBeCloseTo(10.95, 10);
    expect(fundingAprPct(0.0001, 8)).toBeCloseTo(10.95, 10);
    expect(fundingAprPct(0.0001, 4)).toBeCloseTo(21.9, 10);
  });
});

describe('parsePredictedFundings', () => {
  it('wyciąga BTC per venue z APR, interwałem i czasem płatności oraz spready HL−CEX', () => {
    const r = parsePredictedFundings(PREDICTED)!;
    expect(r.coin).toBe('BTC');
    const hl = r.byVenue.HlPerp!;
    expect(hl.rate).toBeCloseTo(0.0000125, 12);
    expect(hl.intervalH).toBe(1);
    expect(hl.aprPct).toBeCloseTo(10.95, 8);
    expect(hl.nextFundingTime).toBe(NOW + 1_800_000);
    expect(r.byVenue.BinPerp!.aprPct).toBeCloseTo(5.475, 8);
    // Bybit bez fundingIntervalHours → domyślnie 8 h
    expect(r.byVenue.BybitPerp!.intervalH).toBe(8);
    expect(r.byVenue.BybitPerp!.aprPct).toBeCloseTo(8.76, 8);
    expect(r.spreadHlBinancePp).toBeCloseTo(10.95 - 5.475, 8);
    expect(r.spreadHlBybitPp).toBeCloseTo(10.95 - 8.76, 8);
  });

  it('obsługuje inny coin i własny interwał venue', () => {
    const r = parsePredictedFundings(PREDICTED, 'ETH')!;
    expect(r.byVenue.BinPerp!.aprPct).toBeCloseTo(10.95, 8);
    expect(r.byVenue.HlPerp!.aprPct).toBeCloseTo(17.52, 8);
    expect(r.byVenue.BybitPerp).toBeNull();
    expect(r.spreadHlBybitPp).toBeNull();
  });

  it('HL bez fundingIntervalHours → 1 h; venue null lub nieczytelna stawka → null (bez liczby zastępczej)', () => {
    const raw = [
      [
        'BTC',
        [
          ['HlPerp', { fundingRate: '0.00001', nextFundingTime: NOW }],
          ['BinPerp', null],
          ['BybitPerp', { fundingRate: 'abc', nextFundingTime: NOW }],
        ],
      ],
    ];
    const r = parsePredictedFundings(raw)!;
    expect(r.byVenue.HlPerp!.intervalH).toBe(1);
    expect(r.byVenue.HlPerp!.aprPct).toBeCloseTo(8.76, 8);
    expect(r.byVenue.BinPerp).toBeNull();
    expect(r.byVenue.BybitPerp).toBeNull();
    expect(r.spreadHlBinancePp).toBeNull();
    expect(r.spreadHlBybitPp).toBeNull();
  });

  it('brak coina albo śmieciowa odpowiedź → null', () => {
    expect(parsePredictedFundings(PREDICTED, 'DOGE')).toBeNull();
    expect(parsePredictedFundings(null)).toBeNull();
    expect(parsePredictedFundings({ error: 'x' })).toBeNull();
    expect(parsePredictedFundings([['BTC', 'zle']])).toBeNull();
  });
});

// Fixture zgodny z dokumentacją `{"type":"metaAndAssetCtxs"}` — wartości jako stringi
const META_MAIN = [
  {
    universe: [
      { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
      { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
      { name: 'OLD', szDecimals: 0, maxLeverage: 3, isDelisted: true },
      { name: 'DEAD', szDecimals: 0, maxLeverage: 3 },
      { name: 'NOPX', szDecimals: 0, maxLeverage: 3 },
    ],
  },
  [
    { funding: '0.0000125', openInterest: '30000', oraclePx: '100000', markPx: '100000', midPx: '100001', premium: '0.00005', dayNtlVlm: '2000000000', prevDayPx: '98000', impactPxs: ['99999', '100002'] },
    { funding: '-0.00001', openInterest: '500000', oraclePx: '3900', markPx: '3900', midPx: null, premium: null, dayNtlVlm: '900000000', prevDayPx: '4000', impactPxs: null },
    { funding: '0', openInterest: '10', oraclePx: '1', markPx: '1', midPx: null, premium: null, dayNtlVlm: '5', prevDayPx: '1', impactPxs: null },
    { funding: '0', openInterest: '0', oraclePx: '2', markPx: '2', midPx: null, premium: null, dayNtlVlm: '0', prevDayPx: '2', impactPxs: null },
    { funding: '0', openInterest: '100', oraclePx: '0', markPx: '0', midPx: null, premium: null, dayNtlVlm: '100', prevDayPx: '0', impactPxs: null },
  ],
];

describe('parseMarketMap', () => {
  it('liczy OI w USD (monety × mark), zmianę 24h, funding APR i premię w bps; odfiltrowuje puste i wycofane', () => {
    const rows = parseMarketMap(META_MAIN);
    expect(rows.map((r) => r.coin)).toEqual(['BTC', 'ETH']);
    const btc = rows[0];
    expect(btc.markPx).toBe(100000);
    expect(btc.oiUsd).toBeCloseTo(3e9, 2);
    expect(btc.volume24hUsd).toBe(2e9);
    expect(btc.change24hPct).toBeCloseTo((2000 / 98000) * 100, 8);
    expect(btc.fundingAprPct).toBeCloseTo(10.95, 8);
    expect(btc.premiumBps).toBeCloseTo(0.5, 8);
    const eth = rows[1];
    expect(eth.change24hPct).toBeCloseTo(-2.5, 8);
    expect(eth.fundingAprPct).toBeCloseTo(-8.76, 8);
    expect(eth.premiumBps).toBeNull();
  });

  it('niewyrównane tablice → tylko wspólny zakres; śmieci → []', () => {
    const short = [META_MAIN[0], (META_MAIN[1] as unknown[]).slice(0, 1)];
    expect(parseMarketMap(short).map((r) => r.coin)).toEqual(['BTC']);
    expect(parseMarketMap(null)).toEqual([]);
    expect(parseMarketMap([{}, {}])).toEqual([]);
  });
});

const META_XYZ = [
  {
    universe: [
      { name: 'xyz:XYZ100', szDecimals: 4, maxLeverage: 20 },
      { name: 'xyz:SP500', szDecimals: 3, maxLeverage: 20 },
      { name: 'xyz:GOLD', szDecimals: 4, maxLeverage: 20 },
      { name: 'xyz:CL', szDecimals: 3, maxLeverage: 10 },
      { name: 'xyz:JPY', szDecimals: 0, maxLeverage: 10 },
    ],
  },
  [
    { funding: '0.00001', openInterest: '100', oraclePx: '25000', markPx: '25100', midPx: '25100', premium: '0.0001', dayNtlVlm: '50000000', prevDayPx: '25000', impactPxs: null },
    { funding: '0.000005', openInterest: '200', oraclePx: '6700', markPx: '6600', midPx: null, premium: null, dayNtlVlm: '20000000', prevDayPx: '6700', impactPxs: null },
    { funding: '0', openInterest: '50', oraclePx: '4000', markPx: '4000', midPx: null, premium: null, dayNtlVlm: '0', prevDayPx: '4000', impactPxs: null },
    { funding: '0', openInterest: '50', oraclePx: 'x', markPx: 'x', midPx: null, premium: null, dayNtlVlm: '10', prevDayPx: '70', impactPxs: null },
    { funding: '0', openInterest: '50', oraclePx: '150', markPx: '150', midPx: null, premium: null, dayNtlVlm: '10', prevDayPx: '151', impactPxs: null },
  ],
];

describe('parseHip3', () => {
  it('rozwiązuje rynki po sufiksie w runtime; brak rynku = coin null (kafel n/a)', () => {
    const tiles = parseHip3(META_XYZ, HIP3_MACRO);
    expect(tiles.map((t) => t.key)).toEqual(HIP3_MACRO.map((s) => s.key));
    const sp = tiles.find((t) => t.key === 'SP500')!;
    expect(sp.coin).toBe('xyz:SP500');
    expect(sp.markPx).toBe(6600);
    expect(sp.change24hPct).toBeCloseTo((-100 / 6700) * 100, 8);
    expect(sp.oiUsd).toBeCloseTo(200 * 6600, 6);
    expect(sp.quiet).toBe(false);
    const ndx = tiles.find((t) => t.key === 'XYZ100')!;
    expect(ndx.coin).toBe('xyz:XYZ100');
    expect(ndx.change24hPct).toBeCloseTo(0.4, 8);
    // Zerowy wolumen 24h → podejrzenie zamkniętej sesji
    expect(tiles.find((t) => t.key === 'GOLD')!.quiet).toBe(true);
    // Nieczytelna cena → rynek znany, wartości null
    const cl = tiles.find((t) => t.key === 'CL')!;
    expect(cl.coin).toBe('xyz:CL');
    expect(cl.markPx).toBeNull();
    expect(cl.change24hPct).toBeNull();
    const eur = tiles.find((t) => t.key === 'EUR')!;
    expect(eur.coin).toBeNull();
    expect(eur.markPx).toBeNull();
  });

  it('dopasowuje aliasy sufiksu bez względu na wielkość liter; śmieci → wszystkie n/a', () => {
    const meta = [{ universe: [{ name: 'xyz:nas100' }] }, [{ markPx: '20000', prevDayPx: '20000', dayNtlVlm: '1', openInterest: '1', funding: '0' }]];
    const tiles = parseHip3(meta, [{ key: 'XYZ100', label: 'Nasdaq-100', aliases: ['XYZ100', 'NAS100'] }]);
    expect(tiles[0].coin).toBe('xyz:nas100');
    expect(parseHip3(null, HIP3_MACRO).every((t) => t.coin === null)).toBe(true);
  });
});

describe('parseCandles / parseFundingHistory', () => {
  it('parsuje świece ze stringów, sortuje po czasie i pomija uszkodzone', () => {
    const raw = [
      { t: 2000, T: 2999, s: 'BTC', i: '1m', o: '2', c: '3', h: '4', l: '1', v: '10', n: 5 },
      { t: 1000, T: 1999, s: 'BTC', i: '1m', o: '1', c: '2', h: '2', l: '1', v: '5', n: 2 },
      { t: 3000, T: 3999, s: 'BTC', i: '1m', o: 'x', c: 'y', h: '4', l: '1', v: '10', n: 5 },
    ];
    const c = parseCandles(raw);
    expect(c.map((x) => x.t)).toEqual([1000, 2000]);
    expect(c[1]).toMatchObject({ o: 2, c: 3, h: 4, l: 1, v: 10 });
    expect(parseCandles(null)).toEqual([]);
  });

  it('parsuje historię fundingu HL', () => {
    const h = parseFundingHistory([
      { coin: 'BTC', fundingRate: '0.0000125', premium: '0.0001', time: 2 },
      { coin: 'BTC', fundingRate: 'bad', premium: '0', time: 3 },
      { coin: 'BTC', fundingRate: '-0.00001', premium: '0', time: 1 },
    ]);
    expect(h).toEqual([
      { time: 1, rate: -0.00001 },
      { time: 2, rate: 0.0000125 },
    ]);
  });
});

describe('pairedLogReturns / rollingBetaR2', () => {
  const STEP = 300_000;
  function series(returns: number[], t0 = NOW, start = 100) {
    const out = [{ t: t0, c: start }];
    for (let i = 0; i < returns.length; i++) out.push({ t: t0 + (i + 1) * STEP, c: out[i].c * Math.exp(returns[i]) });
    return out;
  }

  it('dokładna zależność r_btc = 2·r_proxy → β = 2, R² = 1', () => {
    const rnd = makeRng(7);
    const rp = Array.from({ length: 100 }, () => rnd() * 0.001);
    const fit = rollingBetaR2(series(rp.map((r) => 2 * r)), series(rp, NOW, 5000))!;
    expect(fit.n).toBe(100);
    expect(fit.beta).toBeCloseTo(2, 8);
    expect(fit.r2).toBeCloseTo(1, 8);
  });

  it('zależność z szumem → β blisko prawdziwego, R² w (0,1); nieposortowane wejście', () => {
    const rnd = makeRng(42);
    const rp = Array.from({ length: 288 }, () => rnd() * 0.001);
    const rb = rp.map((r) => 1.5 * r + rnd() * 0.0015);
    const btc = series(rb).reverse();
    const fit = rollingBetaR2(btc, series(rp, NOW, 5000))!;
    expect(fit.n).toBe(288);
    expect(fit.beta).toBeGreaterThan(1.2);
    expect(fit.beta).toBeLessThan(1.8);
    // Teoretycznie R² = 2.25/(2.25+2.25) = 0.5
    expect(fit.r2).toBeGreaterThan(0.35);
    expect(fit.r2).toBeLessThan(0.65);
    expect(fit.corr).toBeCloseTo(Math.sqrt(fit.r2), 10);
  });

  it('wyrównuje po czasie i pomija zwroty przez lukę (np. brak notowań proxy)', () => {
    const rnd = makeRng(3);
    const rp = Array.from({ length: 60 }, () => rnd() * 0.001);
    const btc = series(rp.map((r) => r * 1.1));
    // Proxy bez świec 20..29 (luka) — zwroty przez lukę nie są parowane
    const proxy = series(rp, NOW, 5000).filter((_, i) => i < 20 || i >= 30);
    const pairs = pairedLogReturns(btc, proxy);
    expect(pairs.length).toBe(60 - 11);
    const fit = rollingBetaR2(btc, proxy)!;
    expect(fit.beta).toBeCloseTo(1.1, 8);
  });

  it('n < 30 albo zerowa wariancja (rynek stoi) → null', () => {
    const rnd = makeRng(9);
    const rp = Array.from({ length: 20 }, () => rnd() * 0.001);
    expect(rollingBetaR2(series(rp), series(rp, NOW, 5000))).toBeNull();
    const rb = Array.from({ length: 80 }, () => rnd() * 0.001);
    const flat = series(Array(80).fill(0), NOW, 5000);
    expect(rollingBetaR2(series(rb), flat)).toBeNull();
    expect(rollingBetaR2([], [])).toBeNull();
  });
});

describe('fundingZ', () => {
  const H = 3_600_000;
  it('z-score bieżącej stawki HL względem ostatnich 7 dni (próbkowe σ)', () => {
    // Naprzemiennie 1e-5 i 3e-5 → średnia 2e-5, σ ≈ 1e-5
    const hist = Array.from({ length: 168 }, (_, i) => ({ time: NOW - (168 - i) * H, rate: i % 2 ? 3e-5 : 1e-5 }));
    const z = fundingZ(hist, 4e-5, NOW)!;
    expect(z.n).toBe(168);
    expect(z.mean).toBeCloseTo(2e-5, 12);
    const sd = Math.sqrt((168 * 1e-10) / 167);
    expect(z.sd).toBeCloseTo(sd, 12);
    expect(z.z).toBeCloseTo((4e-5 - 2e-5) / sd, 8);
  });

  it('pomija stawki starsze niż 7 dni; za mało danych albo σ = 0 → null', () => {
    const old = Array.from({ length: 100 }, (_, i) => ({ time: NOW - 8 * 24 * H - i * H, rate: 1 }));
    const recent = Array.from({ length: 30 }, (_, i) => ({ time: NOW - i * H, rate: i % 2 ? 2e-5 : 0 }));
    expect(fundingZ([...old, ...recent], 1e-5, NOW)!.n).toBe(30);
    expect(fundingZ(recent.slice(0, 10), 1e-5, NOW)).toBeNull();
    expect(fundingZ(recent.map((r) => ({ ...r, rate: 1e-5 })), 1e-5, NOW)).toBeNull();
  });
});

describe('recentlyFlat', () => {
  const H = 3_600_000;
  const c = (t: number, h: number, l: number, v: number) => ({ t, o: l, c: h, h, l, v });
  it('wykrywa rynek bez ruchu: brak świec od ≥ 3 interwałów albo 3 ostatnie bez zakresu/wolumenu', () => {
    const live = [c(NOW - 3 * H, 11, 10, 5), c(NOW - 2 * H, 12, 10, 5), c(NOW - H, 12, 11, 5)];
    expect(recentlyFlat(live, NOW, H)).toBe(false);
    expect(recentlyFlat(live.map((x) => ({ ...x, t: x.t - 5 * H })), NOW, H)).toBe(true);
    const flat = [c(NOW - 3 * H, 10, 10, 0), c(NOW - 2 * H, 10, 10, 0), c(NOW - H, 10, 10, 0)];
    expect(recentlyFlat(flat, NOW, H)).toBe(true);
    expect(recentlyFlat([], NOW, H)).toBeNull();
  });
});

describe('topWithOther', () => {
  it('zostawia top N malejąco, resztę sumuje do „Inne”', () => {
    const rows = [{ v: 1 }, { v: 5 }, { v: 3 }, { v: 0 }, { v: 2 }];
    const r = topWithOther(rows, (x) => x.v, 2);
    expect(r.top.map((x) => x.v)).toEqual([5, 3]);
    expect(r.other).toEqual({ count: 2, total: 3 });
    expect(topWithOther(rows, (x) => x.v, 10).other).toBeNull();
  });
});
