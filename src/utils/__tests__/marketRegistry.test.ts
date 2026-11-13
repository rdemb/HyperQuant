import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKETS,
  REG_V1,
  buildRegistry,
  emptyRegistryState,
  isCoinName,
  isMarketRegistry,
  isRegistryState,
  marketsOrDefault,
  parseDexMarkets,
  parsePerpDexs,
  pickDexes,
  recordSnapshot,
  type MarketRegistry,
  type MarketSample,
  type RegistryState,
} from '../marketRegistry.ts';

const DAY = 86_400_000;
/** Dzień 0 symulacji: 2026-11-01, próbka w południe UTC */
const T0 = Date.UTC(2026, 10, 1, 12);
const dayStr = (d: number) => new Date(T0 + d * DAY).toISOString().slice(0, 10);

function sample(coin: string, oiUsd: number, over: Partial<MarketSample> = {}): MarketSample {
  const dex = coin.includes(':') ? coin.split(':')[0] : '';
  return { coin, dex, oiUsd, szDecimals: 2, maxLeverage: 10, delisted: false, ...over };
}

/** Stałe rynki z największym OI i 40 rynków tła: F01 = 100, F02 = 99, …, F40 = 61 (mln USD nie mają znaczenia) */
const ALWAYS_OI: Record<string, number> = { BTC: 5000, ETH: 3000, SOL: 1500, HYPE: 1200 };
const FILLERS = Array.from({ length: 40 }, (_, i) => [`F${String(i + 1).padStart(2, '0')}`, 100 - i] as const);
function base(): MarketSample[] {
  return [...Object.entries(ALWAYS_OI).map(([c, v]) => sample(c, v)), ...FILLERS.map(([c, v]) => sample(c, v))];
}

/**
 * Symulacja: jedna próbka dziennie (południe UTC) dla dni 0..days-1; `extra(d)` dokłada albo nadpisuje rynki dnia.
 * Zwraca rejestr po każdym dniu (ocena dnia d−1 następuje przy pierwszej próbce dnia d).
 */
function simulate(days: number, extra: (d: number) => MarketSample[], start: RegistryState = emptyRegistryState()) {
  let state = start;
  const files: MarketRegistry[] = [];
  for (let d = 0; d < days; d++) {
    const byCoin = new Map(base().map((s) => [s.coin, s]));
    for (const s of extra(d)) byCoin.set(s.coin, s);
    const dexes = [...new Set([...byCoin.values()].map((s) => s.dex))];
    state = recordSnapshot(state, { at: T0 + d * DAY, dexes, samples: [...byCoin.values()] });
    files.push(buildRegistry(state, ['BTC']));
  }
  return { state, files };
}
const coins = (r: MarketRegistry) => r.markets.map((m) => m.coin);
const entry = (r: MarketRegistry, coin: string) => r.markets.find((m) => m.coin === coin);

/**
 * Symulacja godzinna: próbka o hh:30 UTC dla dni 0..days-1. `drop(d, h)` usuwa rynki z odpowiedzi pobranych giełd,
 * `dexes(d, h)` zawęża zbiór pobranych giełd (giełda niedostępna albo pominięta w rotacji).
 */
function hourly(
  days: number,
  opts: { extra?: (d: number) => MarketSample[]; drop?: (d: number, h: number) => string[]; dexes?: (d: number, h: number) => string[] | undefined } = {}
) {
  const H0 = Date.UTC(2026, 10, 1, 0, 30);
  let state = emptyRegistryState();
  const files: { d: number; h: number; file: MarketRegistry }[] = [];
  for (let d = 0; d < days; d++)
    for (let h = 0; h < 24; h++) {
      const byCoin = new Map(base().map((s) => [s.coin, s]));
      for (const s of opts.extra?.(d) ?? []) byCoin.set(s.coin, s);
      const dexes = opts.dexes?.(d, h) ?? [...new Set([...byCoin.values()].map((s) => s.dex))];
      const dropped = new Set(opts.drop?.(d, h) ?? []);
      const samples = [...byCoin.values()].filter((s) => dexes.includes(s.dex) && !dropped.has(s.coin));
      state = recordSnapshot(state, { at: H0 + d * DAY + h * 3_600_000, dexes, samples });
      files.push({ d, h, file: buildRegistry(state, ['BTC']) });
    }
  return { state, files };
}

describe('reg-v1: stała reguły', () => {
  it('parametry zgodne z planem', () => {
    expect(REG_V1).toMatchObject({ id: 'reg-v1', top: 20, enterDays: 3, exitRank: 30, exitDays: 7, windowDays: 7 });
    expect(REG_V1.always).toEqual(['BTC', 'ETH', 'SOL', 'HYPE']);
  });
});

describe('recordSnapshot + buildRegistry', () => {
  it('4 stałe rynki od pierwszej próbki, since = pierwszy dzień; rynki tła jeszcze nie wchodzą', () => {
    const { files } = simulate(1, () => []);
    const r = files[0];
    expect(coins(r)).toEqual(['BTC', 'ETH', 'SOL', 'HYPE']);
    expect(r.rule).toBe('reg-v1');
    expect(r.asOf).toBe(T0);
    for (const m of r.markets) expect(m.since).toBe(dayStr(0));
    expect(entry(r, 'BTC')).toMatchObject({ dex: '', rank: 1, oiUsd7d: 5000, scanner: 'full', szDecimals: 2, maxLeverage: 10 });
    expect(entry(r, 'ETH')!.scanner).toBe('none');
    expect(isMarketRegistry(r)).toBe(true);
  });

  it('wejście dopiero po 3 kolejnych dniach w pierwszej 20; since = dzień wejścia', () => {
    // Rynki tła F01–F16 są w pierwszej 20 od dnia 0: oceny dni 0, 1, 2 → wejście przy pierwszej próbce dnia 3
    const { files } = simulate(5, () => []);
    expect(coins(files[2])).not.toContain('F01');
    expect(coins(files[3])).toContain('F01');
    expect(coins(files[3])).toContain('F16');
    expect(coins(files[3])).not.toContain('F17');
    expect(entry(files[3], 'F01')!.since).toBe(dayStr(3));
    expect(entry(files[4], 'F01')!.since).toBe(dayStr(3));
    expect(files[3].markets).toHaveLength(20);
  });

  it('przerwana seria nie wystarcza: rynek 2 dni w pierwszej 20, potem wypchnięty, nie wchodzi', () => {
    // Dzień 0–1: X ogromny (miejsce 1). Od dnia 2 dwadzieścia jeszcze większych rynków spycha X na miejsce ≥ 21.
    const big = Array.from({ length: 20 }, (_, i) => sample(`Y${i}`, 1e7));
    const { files } = simulate(8, (d) => [sample('X', 1e6), ...(d >= 2 ? big : [])]);
    for (const f of files) expect(coins(f)).not.toContain('X');
  });

  it('rynek między 21. a 30. miejscem zostaje; wyjście dopiero po 7 dniach poniżej 30. miejsca', () => {
    // X: ogromne OI w dniach 0–9 (wejście dnia 3), potem 79.5 → od dnia 16 średnia z 7 dni = 79.5 (miejsce 26: 4 stałe
    // + F01–F21 powyżej). Od dnia 30 X = 1 USD: średnia (6 × 79.5 + 1) / 7 ≈ 68.3 < F26 = 75, czyli miejsce > 30 już
    // w dniu 30; siódmy taki dzień to 36, oceniony przy pierwszej próbce dnia 37 → X znika z pliku dnia 37.
    const xOi = (d: number) => (d < 10 ? 1e5 : d < 30 ? 79.5 : 1);
    const { files } = simulate(39, (d) => [sample('X', xOi(d))]);
    expect(entry(files[3], 'X')!.since).toBe(dayStr(3));
    expect(entry(files[25], 'X')!.rank).toBe(26);
    for (let d = 3; d <= 36; d++) expect(coins(files[d]), `dzień ${d}`).toContain('X');
    expect(entry(files[36], 'X')!.rank).toBeGreaterThan(30);
    expect(coins(files[37])).not.toContain('X');
    expect(coins(files[38])).not.toContain('X');
  });

  it('stałe rynki zostają mimo miejsca poza 30', () => {
    const tiny = Object.keys(ALWAYS_OI).map((c) => sample(c, 0.5));
    const { files } = simulate(15, (d) => (d >= 1 ? tiny : []));
    for (const f of files) for (const c of REG_V1.always) expect(coins(f)).toContain(c);
  });

  it('rynki wycofane i z zerowym OI nie wchodzą', () => {
    const { files } = simulate(6, () => [sample('DEL', 1e6, { delisted: true }), sample('ZERO', 0)]);
    const last = files[5];
    expect(coins(last)).not.toContain('DEL');
    expect(coins(last)).not.toContain('ZERO');
    expect(last.markets).toHaveLength(20);
  });

  it('członek wycofany z giełdy wypada od razu', () => {
    const { files } = simulate(6, (d) => [sample('X', 1e5, { delisted: d >= 5 })]);
    expect(coins(files[4])).toContain('X');
    expect(coins(files[5])).not.toContain('X');
  });

  it('kilka giełd: rynek HIP-3 (dex:COIN) wchodzi i jest rangowany razem z rynkami głównymi', () => {
    const { files } = simulate(4, () => [sample('xyz:NVDA', 2000, { szDecimals: 3, maxLeverage: 20 }), sample('io:ANTH', 98.5)]);
    const r = files[3];
    expect(isMarketRegistry(r)).toBe(true);
    expect(entry(r, 'xyz:NVDA')).toMatchObject({ dex: 'xyz', rank: 3, szDecimals: 3, maxLeverage: 20, scanner: 'none', since: dayStr(3) });
    expect(entry(r, 'io:ANTH')).toMatchObject({ dex: 'io', rank: 8 });
    // posortowane po miejscu
    expect(r.markets.map((m) => m.rank)).toEqual([...r.markets.map((m) => m.rank)].sort((a, b) => a - b));
    expect(r.markets).toHaveLength(20);
  });

  it('średnia z 7 dni liczy dzień bez rynku jako zero; kilka próbek dnia uśrednia się', () => {
    let s = emptyRegistryState();
    s = recordSnapshot(s, { at: T0, dexes: [''], samples: [sample('BTC', 100)] });
    s = recordSnapshot(s, { at: T0 + 3_600_000, dexes: [''], samples: [sample('BTC', 300), sample('ETH', 50)] });
    s = recordSnapshot(s, { at: T0 + DAY, dexes: [''], samples: [sample('BTC', 400), sample('ETH', 0)] });
    const r = buildRegistry(s, ['BTC']);
    // BTC: dzień 0 średnio 200, dzień 1 400 → 300; ETH: dzień 0 = 50 (jedna próbka), dzień 1 zero → 25
    expect(entry(r, 'BTC')!.oiUsd7d).toBe(300);
    expect(entry(r, 'ETH')!.oiUsd7d).toBe(25);
  });

  it('stan trzyma najwyżej 10 dni próbek', () => {
    const { state } = simulate(20, () => []);
    expect(Object.keys(state.days)).toHaveLength(10);
    expect(Object.keys(state.days).sort()[0]).toBe(dayStr(10));
  });

  it('restart: stan po JSON daje ten sam dalszy przebieg', () => {
    const a = simulate(2, () => []);
    const restored = JSON.parse(JSON.stringify(a.state)) as unknown;
    expect(isRegistryState(restored)).toBe(true);
    // Dni 2–3 dopisane do odtworzonego stanu dają ten sam plik co przebieg bez przerwy
    const cont = (start: RegistryState) => {
      let s = start;
      for (const d of [2, 3]) s = recordSnapshot(s, { at: T0 + d * DAY, dexes: [''], samples: base() });
      return buildRegistry(s, ['BTC']);
    };
    expect(cont(restored as RegistryState)).toEqual(cont(a.state));
    expect(coins(cont(restored as RegistryState))).toContain('F01');
  });

  it('próbka sprzed ocenionego dnia (cofnięty zegar) jest pomijana', () => {
    const { state } = simulate(3, () => []);
    const back = recordSnapshot(state, { at: T0, dexes: [''], samples: [sample('BTC', 1e12)] });
    expect(back).toBe(state);
  });
});

describe('brak rynku w jednej godzinnej odpowiedzi nie zmienia członków', () => {
  it('rynek z miejsca 20: zostaje w pliku z tym samym since', () => {
    // Pierwsza 20 = 4 stałe + F01–F16 (F16 na miejscu 20); wejście dnia 3; dnia 5 o 10:30 brak F16 w odpowiedzi
    const { files } = hourly(7, { drop: (d, h) => (d === 5 && h === 10 ? ['F16'] : []) });
    for (const { d, h, file } of files.filter((f) => f.d >= 3)) {
      expect(entry(file, 'F16')?.since, `dzień ${d} ${h}:30`).toBe(dayStr(3));
      expect(entry(file, 'F16')!.rank).toBe(20);
    }
  });

  it('członek ze strefy 21–30: zostaje, także w następnych dniach', () => {
    // X: ogromne OI do dnia 9 (wejście dnia 3), potem 79.5 (miejsce 26); dnia 20 o 5:30 brak X w odpowiedzi
    const { files } = hourly(25, { extra: (d) => [sample('X', d < 10 ? 1e5 : 79.5)], drop: (d, h) => (d === 20 && h === 5 ? ['X'] : []) });
    for (const { d, h, file } of files.filter((f) => f.d >= 3)) expect(entry(file, 'X')?.since, `dzień ${d} ${h}:30`).toBe(dayStr(3));
    expect(entry(files[files.length - 1].file, 'X')!.rank).toBe(26);
  });

  it('BTC: zostaje z pierwszym since (także w godzinie bez wiersza)', () => {
    const { files } = hourly(4, { drop: (d, h) => (d === 2 && h === 7 ? ['BTC'] : []) });
    for (const { d, h, file } of files) expect(entry(file, 'BTC')?.since, `dzień ${d} ${h}:30`).toBe(dayStr(0));
  });

  it('członek nieobecny w żadnej próbce zamkniętego dnia (giełda pobrana) wypada przy ocenie tego dnia', () => {
    const { files } = hourly(7, { drop: (d) => (d === 5 ? ['F16'] : []) });
    const at = (d: number, h: number) => files.find((f) => f.d === d && f.h === h)!.file;
    expect(entry(at(5, 23), 'F16')?.since).toBe(dayStr(3));
    expect(coins(at(6, 0))).not.toContain('F16');
  });

  it('giełda niepobrana przez cały dzień (niedostępna albo poza rotacją) nie usuwa swoich rynków', () => {
    const { files } = hourly(7, { extra: () => [sample('xyz:NVDA', 2000)], dexes: (d) => (d === 5 ? [''] : undefined) });
    const last = files[files.length - 1].file;
    expect(entry(last, 'xyz:NVDA')).toMatchObject({ dex: 'xyz', since: dayStr(3) });
  });

  it('wycofany (isDelisted) wypada od razu, także w środku dnia', () => {
    const { files } = hourly(6, { extra: (d) => [sample('X', 1e5, { delisted: d === 5 })] });
    const at = (d: number, h: number) => files.find((f) => f.d === d && f.h === h)!.file;
    expect(coins(at(4, 23))).toContain('X');
    expect(coins(at(5, 0))).not.toContain('X');
  });
});

describe('pickDexes', () => {
  /** Stan z rynkami giełd o zadanym OI (jedna próbka) */
  function withDexes(oi: Record<string, number>): RegistryState {
    const samples = Object.entries(oi).map(([dex, v]) => sample(dex === '' ? 'BTC' : `${dex}:AAA`, v));
    return recordSnapshot(emptyRegistryState(), { at: T0, dexes: Object.keys(oi), samples });
  }

  it('giełda główna pierwsza, potem malejąco według ostatniego OI, nowe giełdy na końcu', () => {
    const s = withDexes({ '': 100, io: 5, xyz: 50, km: 1 });
    expect(pickDexes(s, ['', 'km', 'io', 'nowa', 'xyz'], 19)).toEqual({ dexes: ['', 'xyz', 'io', 'km', 'nowa'], skipped: [] });
    // giełda główna nawet wtedy, gdy nie ma jej na liście
    expect(pickDexes(s, ['xyz'], 19).dexes).toEqual(['', 'xyz']);
  });

  it('limit zapytań: najwyżej `max` giełd (z główną); reszta pominięta i pierwsza w następnym przebiegu', () => {
    const listed = ['', ...Array.from({ length: 24 }, (_, i) => `d${String(i).padStart(2, '0')}`)];
    const first = pickDexes(emptyRegistryState(), listed, 19);
    expect(first.dexes).toHaveLength(19);
    expect(first.dexes[0]).toBe('');
    expect(first.skipped).toHaveLength(6);
    // Przebieg pobrał wybrane giełdy → następny bierze najpierw pominięte
    const after = recordSnapshot(emptyRegistryState(), { at: T0, dexes: first.dexes, samples: [sample('BTC', 1)] });
    const second = pickDexes(after, listed, 19);
    for (const d of first.skipped) expect(second.dexes).toContain(d);
    expect(new Set([...first.dexes, ...second.dexes])).toEqual(new Set(listed));
  });
});

describe('isRegistryState', () => {
  it('odrzuca śmieci i stan innej reguły', () => {
    expect(isRegistryState(null)).toBe(false);
    expect(isRegistryState({})).toBe(false);
    expect(isRegistryState({ ...emptyRegistryState(), rule: 'reg-v0' })).toBe(false);
    expect(isRegistryState({ ...emptyRegistryState(), days: { '2026-11-01': { BTC: { s: 'x', n: 1 } } } })).toBe(false);
    expect(isRegistryState(emptyRegistryState())).toBe(true);
  });
});

describe('parsePerpDexs', () => {
  it('null na początku = giełda główna (""), dalej nazwy giełd HIP-3', () => {
    const raw = [null, { name: 'xyz', fullName: 'XYZ', deployer: '0x' + '1'.repeat(40) }, { name: 'io' }, { bad: 1 }];
    expect(parsePerpDexs(raw)).toEqual(['', 'xyz', 'io']);
  });
  it('bez null na liście giełda główna i tak jest pierwsza; śmieci → null', () => {
    expect(parsePerpDexs([{ name: 'xyz' }])).toEqual(['', 'xyz']);
    expect(parsePerpDexs(null)).toBeNull();
    expect(parsePerpDexs({ error: 'x' })).toBeNull();
  });
});

describe('parseDexMarkets', () => {
  const META = [
    {
      universe: [
        { name: 'xyz:NVDA', szDecimals: 3, maxLeverage: 20 },
        { name: 'GOLD', szDecimals: 4, maxLeverage: 20 },
        { name: 'xyz:OLD', szDecimals: 2, maxLeverage: 5, isDelisted: true },
        { name: 'xyz:BAD', szDecimals: 'x', maxLeverage: 5 },
      ],
      marginTables: [],
      collateralToken: 0,
    },
    [
      { openInterest: '1000', markPx: '180.5', oraclePx: '180' },
      { openInterest: '10', markPx: '4000' },
      { openInterest: '5', markPx: '1' },
      { openInterest: '5', markPx: '1' },
    ],
  ];
  it('OI w USD = openInterest × markPx, nazwa z przedrostkiem giełdy, flaga wycofania', () => {
    expect(parseDexMarkets(META, 'xyz')).toEqual([
      { coin: 'xyz:NVDA', dex: 'xyz', oiUsd: 180_500, szDecimals: 3, maxLeverage: 20, delisted: false },
      { coin: 'xyz:GOLD', dex: 'xyz', oiUsd: 40_000, szDecimals: 4, maxLeverage: 20, delisted: false },
      { coin: 'xyz:OLD', dex: 'xyz', oiUsd: 5, szDecimals: 2, maxLeverage: 5, delisted: true },
    ]);
  });
  it('giełda główna bez przedrostka; śmieci → null', () => {
    const main = [{ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] }, [{ openInterest: '30000', markPx: '100000' }]];
    expect(parseDexMarkets(main, '')).toEqual([{ coin: 'BTC', dex: '', oiUsd: 3e9, szDecimals: 5, maxLeverage: 40, delisted: false }]);
    expect(parseDexMarkets(null, '')).toBeNull();
    expect(parseDexMarkets([{}, []], '')).toBeNull();
  });
});

describe('isMarketRegistry', () => {
  const good = (): MarketRegistry => ({
    asOf: T0,
    rule: 'reg-v1',
    markets: [
      { coin: 'BTC', dex: '', oiUsd7d: 3e9, rank: 1, szDecimals: 5, maxLeverage: 40, since: '2026-11-01', scanner: 'full' },
      { coin: 'xyz:NVDA', dex: 'xyz', oiUsd7d: 5e8, rank: 5, szDecimals: 3, maxLeverage: 20, since: '2026-11-04', scanner: 'none' },
    ],
  });
  it('przyjmuje poprawny plik', () => {
    expect(isMarketRegistry(good())).toBe(true);
  });
  it.each([
    ['null', () => null],
    ['tablica', () => []],
    ['brak asOf', () => ({ ...good(), asOf: undefined })],
    ['inna reguła', () => ({ ...good(), rule: 'reg-v9' })],
    ['pusta lista', () => ({ ...good(), markets: [] })],
    ['scanner spoza listy', () => ({ ...good(), markets: [{ ...good().markets[0], scanner: 'half' }] })],
    ['rank 0', () => ({ ...good(), markets: [{ ...good().markets[0], rank: 0 }] })],
    ['since bez daty', () => ({ ...good(), markets: [{ ...good().markets[0], since: 'wczoraj' }] })],
    ['OI ujemne', () => ({ ...good(), markets: [{ ...good().markets[0], oiUsd7d: -1 }] })],
    ['szDecimals ułamkowe', () => ({ ...good(), markets: [{ ...good().markets[0], szDecimals: 1.5 }] })],
    ['dex niezgodny z nazwą', () => ({ ...good(), markets: [{ ...good().markets[1], dex: 'io' }] })],
    ['dwukropek na giełdzie głównej', () => ({ ...good(), markets: [{ ...good().markets[0], coin: 'xyz:BTC' }] })],
    ['powtórzony rynek', () => ({ ...good(), markets: [good().markets[0], good().markets[0]] })],
  ])('odrzuca: %s', (_name, make) => {
    expect(isMarketRegistry(make())).toBe(false);
  });
});

describe('marketsOrDefault', () => {
  it('brak pliku albo zły format → dzisiejsze 4 rynki (BTC ze skanerem)', () => {
    for (const x of [null, undefined, { rule: 'reg-v1' }, 'x']) {
      const list = marketsOrDefault(x);
      expect(list.map((m) => m.coin)).toEqual(['BTC', 'ETH', 'SOL', 'HYPE']);
      expect(list).toBe(DEFAULT_MARKETS);
    }
    expect(DEFAULT_MARKETS.find((m) => m.coin === 'BTC')!.scanner).toBe('full');
    expect(DEFAULT_MARKETS.filter((m) => m.scanner === 'full')).toHaveLength(1);
  });
  it('poprawny plik → rynki z rejestru w kolejności miejsc; brakujący stały rynek dopisany na końcu', () => {
    const r: MarketRegistry = {
      asOf: T0,
      rule: 'reg-v1',
      markets: [
        { coin: 'BTC', dex: '', oiUsd7d: 3e9, rank: 1, szDecimals: 5, maxLeverage: 40, since: '2026-11-01', scanner: 'full' },
        { coin: 'xyz:NVDA', dex: 'xyz', oiUsd7d: 5e8, rank: 2, szDecimals: 3, maxLeverage: 20, since: '2026-11-04', scanner: 'none' },
        { coin: 'ETH', dex: '', oiUsd7d: 4e8, rank: 3, szDecimals: 4, maxLeverage: 25, since: '2026-11-01', scanner: 'none' },
      ],
    };
    const list = marketsOrDefault(r);
    expect(list.map((m) => m.coin)).toEqual(['BTC', 'xyz:NVDA', 'ETH', 'SOL', 'HYPE']);
    expect(list[1]).toEqual({ coin: 'xyz:NVDA', dex: 'xyz', szDecimals: 3, maxLeverage: 20, scanner: 'none', oiUsd7d: 5e8 });
  });
  it('pole `class` (etap 1): znana klasa przechodzi do listy strony, nieznana i brak — rynek bez klasy', () => {
    const row = (coin: string, rank: number, cls?: unknown) => ({
      coin,
      dex: coin.includes(':') ? coin.split(':')[0] : '',
      oiUsd7d: 1e9 / rank,
      rank,
      szDecimals: 2,
      maxLeverage: 10,
      since: '2026-11-01',
      scanner: 'none',
      ...(cls === undefined ? {} : { class: cls }),
    });
    const r = { asOf: T0, rule: 'reg-v1', markets: [row('BTC', 1, 'crypto'), row('xyz:NVDA', 2, 'equity'), row('xyz:SP500', 3, 'index'), row('xyz:GOLD', 4, 'metal'), row('ETH', 5)] };
    expect(isMarketRegistry(r)).toBe(true);
    const list = marketsOrDefault(r);
    expect(list.map((m) => m.class)).toEqual(['crypto', 'equity', 'index', undefined, undefined, undefined, undefined]);
    expect('class' in list[3]).toBe(false);
  });
});

describe('isCoinName', () => {
  it('rynek główny i HIP-3 z przedrostkiem giełdy', () => {
    for (const x of ['BTC', 'kPEPE', 'xyz:NVDA', 'io:ANTH']) expect(isCoinName(x)).toBe(true);
  });
  it('odrzuca puste, z ukośnikiem, dwoma dwukropkami, spacją i nie-tekst', () => {
    for (const x of ['', ':NVDA', 'xyz:', 'a:b:c', 'BTC/USD', 'BT C', '../x', 'x'.repeat(21), 1, null, undefined]) expect(isCoinName(x)).toBe(false);
  });
});
