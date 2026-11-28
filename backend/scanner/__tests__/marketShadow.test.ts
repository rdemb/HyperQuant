import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLiqMap } from '../../../src/utils/liqMap.ts';
import { parseCoinPosition } from '../positions.ts';
import { FLOW_SETTLE_MS, FlowFile, FlowMinutes, K2_KEEP_DAYS, M0_WINDOW_MS, M1_MAX_AGE_MIN, M1_METHOD, M1_MIN_POSITIONS, M1_MIN_SHARE, MarketShadow, OI_MAX_AGE_MS, PRICE_MAX_AGE_MS, ShadowGate, parseOpenInterest, publishableMap, readFlowDay } from '../marketShadow.ts';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 12, 10, 0, 0);

const pos = (coin: string, szi: number, entryPx = 100) => ({ position: { coin, szi: String(szi), entryPx: String(entryPx), liquidationPx: null } });
const state = (...ps: ReturnType<typeof pos>[]) => ({ assetPositions: ps });
const trade = (coin: string, users: [string, string], px: number, sz: number, time: number, side = 'B') => ({ coin, users, px: String(px), sz: String(sz), time, side });

describe('MarketShadow — pokrycie rynków głównych', () => {
  it('ta sama miara co coverage mapy likwidacji BTC (|szi| / 2·OI) dla każdego rynku głównego', () => {
    const states = [state(pos('BTC', 2), pos('ETH', 30)), state(pos('BTC', -1.5), pos('ETH', -10)), state(pos('SOL', 400))];
    const s = new MarketShadow();
    s.setCoins(['BTC', 'ETH', 'SOL']);
    states.forEach((st, i) => s.onScan(`a${i}`, st, T0));
    s.setOi({ BTC: 10, ETH: 200, SOL: 100 }, T0);
    const btcMap = buildLiqMap(states.map((st) => parseCoinPosition(st, 'BTC', T0)).filter((p) => p !== null), { coin: 'BTC', markPx: 100, oiBtc: 10, asOf: T0, addresses: 3 });
    const ethMap = buildLiqMap(states.map((st) => parseCoinPosition(st, 'ETH', T0)).filter((p) => p !== null), { coin: 'ETH', markPx: 100, oiBtc: 200, asOf: T0, addresses: 3 });
    const st = s.status(T0, { inBook: () => true });
    expect(st.markets.BTC.coverage).toBeCloseTo(btcMap.coverage.share, 4);
    expect(st.markets.ETH.coverage).toBeCloseTo(ethMap.coverage.share, 4);
    expect(st.markets.SOL.coverage).toBe(1); // 400 / (2·100) obcięte do 1
  });

  it('BTC bierze coverage statusu; konto spoza księgi nie liczy się; HIP-3 i stary OI → null', () => {
    const s = new MarketShadow();
    s.setCoins(['BTC', 'ETH', 'xyz:NVDA']);
    s.onScan('a', state(pos('ETH', 10), pos('xyz:NVDA', 5)), T0);
    s.onScan('b', state(pos('ETH', 30)), T0);
    s.setOi({ ETH: 100, BTC: 5 }, T0);
    const st = s.status(T0 + MIN, { inBook: (a) => a === 'a', btc: { coin: 'BTC', coverage: 0.61234 } });
    expect(st.markets).toEqual({
      BTC: { coverage: 0.6123, unseenShare: null, ageP50Min: null },
      ETH: { coverage: 0.05, unseenShare: null, ageP50Min: 1 },
      'xyz:NVDA': { coverage: null, unseenShare: null, ageP50Min: null },
    });
    expect(s.status(T0 + OI_MAX_AGE_MS + 1, { inBook: () => true }).markets.ETH.coverage).toBeNull();
  });

  it('unseenShare rynku skanera zawsze null (zależy od kolejności obsługi dwóch połączeń); pozostałe rynki liczone', () => {
    const s = new MarketShadow();
    s.setCoins(['BTC', 'ETH']);
    const inBook = (a: string) => a === 'k';
    s.onTrade(trade('BTC', ['k', 'u'], 100, 1, T0), inBook);
    s.onTrade(trade('ETH', ['k', 'u'], 10, 1, T0), inBook);
    const st = s.status(T0 + MIN, { inBook, btc: { coin: 'BTC', coverage: 0.5 } });
    expect(st.markets.BTC).toEqual({ coverage: 0.5, unseenShare: null, ageP50Min: null });
    expect(st.markets.ETH.unseenShare).toBe(0.5);
  });

  it('odczyt bez pozycji kasuje stare pozycje konta, nieudany (zły kształt) nie', () => {
    const s = new MarketShadow();
    s.setCoins(['ETH']);
    s.setOi({ ETH: 50 }, T0);
    s.onScan('a', state(pos('ETH', 10)), T0);
    s.onScan('a', null, T0);
    expect(s.status(T0, { inBook: () => true }).markets.ETH.coverage).toBe(0.1);
    s.onScan('a', state(), T0);
    expect(s.status(T0, { inBook: () => true }).markets.ETH.coverage).toBe(0);
  });

  it('OI z metaAndAssetCtxs giełdy głównej w jednostkach rynku; śmieci → null', () => {
    const raw = [{ universe: [{ name: 'BTC' }, { name: 'ETH' }, { name: 'X' }] }, [{ openInterest: '30000.5' }, { openInterest: 12 }, { openInterest: 'zły' }]];
    expect(parseOpenInterest(raw)).toEqual({ BTC: 30000.5, ETH: 12 });
    expect(parseOpenInterest({})).toBeNull();
  });
});

describe('MarketShadow — udział nieznanych kont i konta xyz (7 dni)', () => {
  const known = new Set(['k1', 'k2']);
  const inBook = (a: string) => known.has(a);

  it('obrót obu stron transakcji; konto spoza księgi liczy się w unseenShare', () => {
    const s = new MarketShadow();
    s.setCoins(['ETH', 'SOL']);
    s.onTrade(trade('ETH', ['k1', 'u1'], 100, 1, T0), inBook); // 100 nieznany z 200
    s.onTrade(trade('ETH', ['k1', 'k2'], 100, 3, T0 + MIN), inBook); // 0 z 600
    expect(s.status(T0 + 2 * MIN, { inBook }).markets).toEqual({ ETH: { coverage: null, unseenShare: 0.125, ageP50Min: null }, SOL: { coverage: null, unseenShare: null, ageP50Min: null } });
  });

  it('kubełki starsze niż 7 dni wypadają z okna i ze stanu', () => {
    const s = new MarketShadow();
    s.setCoins(['ETH']);
    s.onTrade(trade('ETH', ['u1', 'u2'], 1, 1, T0), inBook);
    s.onTrade(trade('ETH', ['k1', 'k2'], 1, 1, T0 + 2 * HOUR), inBook);
    const late = T0 + M0_WINDOW_MS + HOUR;
    expect(s.status(late, { inBook }).markets.ETH.unseenShare).toBe(0);
    expect(s.status(late, { inBook }).marketsHours).toBe(1);
    s.prune(late);
    expect(s.toJSON().hours.map(([h]) => h)).toEqual([T0 + 2 * HOUR]);
  });

  it('xyz: różne konta z taśm xyz, ile z nich w księdze, udział nieznanych i udział xyz w obrocie', () => {
    const s = new MarketShadow();
    s.setCoins(['ETH', 'xyz:NVDA', 'xyz:GOLD']);
    s.onTrade(trade('xyz:NVDA', ['k1', 'u1'], 10, 10, T0), inBook); // 100 na stronę
    s.onTrade(trade('xyz:GOLD', ['u1', 'u2'], 10, 10, T0 + MIN), inBook);
    s.onTrade(trade('ETH', ['k1', 'k2'], 10, 20, T0 + MIN), inBook); // 200 na stronę
    const st = s.status(T0 + 2 * MIN, { inBook });
    expect(st.xyz).toEqual({ accounts: 3, inBook: 1, unseenShare: 0.75, share: 0.5 });
    expect(s.status(T0 + M0_WINDOW_MS + MIN + 1, { inBook }).xyz.accounts).toBe(0);
  });

  it('restart: stan z JSON daje ten sam status', () => {
    const s = new MarketShadow();
    s.setCoins(['ETH', 'xyz:NVDA']);
    s.onScan('k1', state(pos('ETH', 4)), T0);
    s.setOi({ ETH: 20 }, T0);
    s.onTrade(trade('xyz:NVDA', ['k1', 'u1'], 10, 10, T0), inBook);
    s.onTrade(trade('ETH', ['u2', 'k1'], 5, 10, T0 + HOUR), inBook);
    const back = MarketShadow.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), T0 + 2 * HOUR);
    back.setCoins(['ETH', 'xyz:NVDA']);
    expect(back.status(T0 + 2 * HOUR, { inBook })).toEqual(s.status(T0 + 2 * HOUR, { inBook }));
    expect(MarketShadow.fromJSON({ v: 9 }, T0).toJSON().pos).toEqual([]);
  });

  it('stan v1 (bez czasu odczytu): pokrycie zostaje, wiek nieznany do kolejnego odczytu konta', () => {
    const v1 = { v: 1, pos: [['k1', { ETH: 4 }]], hours: [], xyz: [], oi: { at: T0, byCoin: { ETH: 20 } } };
    const back = MarketShadow.fromJSON(v1, T0);
    back.setCoins(['ETH']);
    expect(back.status(T0, { inBook })).toMatchObject({ markets: { ETH: { coverage: 0.1, ageP50Min: null } } });
    back.onScan('k1', state(pos('ETH', 4)), T0);
    expect(back.status(T0 + 5 * MIN, { inBook }).markets.ETH.ageP50Min).toBe(5);
  });
});

describe('MarketShadow — mapy likwidacji innych rynków (M1)', () => {
  const lp = (coin: string, szi: number, entryPx: number, liq: number | null) => ({ position: { coin, szi: String(szi), entryPx: String(entryPx), liquidationPx: liq === null ? null : String(liq) } });
  /** `n` kont z pozycją w `coin` (naprzemiennie long i short wokół 3000), odczytanych `ageMs` przed T0 (co sekundę starsze). */
  function scanMany(s: MarketShadow, coin: string, n: number, ageMs = 0, prefix = coin) {
    const states = Array.from({ length: n }, (_, i) => ({ assetPositions: [lp(coin, i % 2 ? 2 : -3, 3000, i % 2 ? 2700 - i : 3300 + i)] }));
    states.forEach((st, i) => s.onScan(`${prefix}${i}`, st, T0 - ageMs - i * 1000));
    return states;
  }
  const all = { inBook: () => true, addresses: 1000 };

  it('ta sama mapa co droga BTC (parseCoinPosition + buildLiqMap) z tych samych odczytów; cena z ostatniej transakcji taśmy', () => {
    const s = new MarketShadow();
    s.setCoins(['BTC', 'ETH']);
    s.setOi({ ETH: 150 }, T0);
    const states = scanMany(s, 'ETH', 60);
    s.onTrade(trade('ETH', ['x', 'y'], 3005, 1, T0 - 9000), () => true);
    s.onTrade(trade('ETH', ['x', 'y'], 3010, 1, T0 - 2000), () => true);
    const ref = buildLiqMap(states.map((st, i) => parseCoinPosition(st, 'ETH', T0 - i * 1000)).filter((p) => p !== null), { coin: 'ETH', markPx: 3010, oiBtc: 150, asOf: T0, addresses: 1000, ctxAt: T0 - 2000 });
    expect(s.liqMap('ETH', T0, all)).toEqual({ ...ref, method: M1_METHOD });
  });

  it('progi publikacji: pokrycie ≥ 30%, mediana wieku ≤ 30 min, ≥ 50 pozycji; bez rynku skanera i bez HIP-3', () => {
    expect([M1_MIN_SHARE, M1_MAX_AGE_MIN, M1_MIN_POSITIONS]).toEqual([0.3, 30, 50]);
    const s = new MarketShadow();
    s.setCoins(['BTC', 'ETH', 'SOL', 'NEAR', 'ZEC', 'xyz:GOLD']);
    scanMany(s, 'BTC', 60);
    scanMany(s, 'ETH', 60); // pokrycie 150 / (2·150) = 50%, świeże
    scanMany(s, 'SOL', 60); // OI 1000 → pokrycie 7,5%
    scanMany(s, 'NEAR', 60, 40 * MIN); // odczyty sprzed 40 min
    scanMany(s, 'ZEC', 49); // za mało pozycji
    s.setOi({ BTC: 150, ETH: 150, SOL: 1000, NEAR: 150, ZEC: 100 }, T0);
    for (const c of ['BTC', 'ETH', 'SOL', 'NEAR', 'ZEC', 'xyz:GOLD']) s.onTrade(trade(c, ['x', 'y'], 3000, 1, T0 - MIN), () => true);
    expect(s.maps(T0, { ...all, exclude: 'BTC' }).map(([c]) => c)).toEqual(['ETH']);
    expect(publishableMap(s.liqMap('ZEC', T0, all)!)).toBe(false);
    expect(s.liqMap('ZEC', T0, all)!.coverage.positions).toBe(49);
    expect(s.liqMap('NEAR', T0, all)!.ageMin.ntlP50).toBeGreaterThan(30);
    expect(s.liqMap('xyz:GOLD', T0, all)).toBeNull();
  });

  it('bez świeżej ceny (> 5 min), bez OI albo z OI starszym niż 3 h — brak mapy; konto spoza księgi się nie liczy', () => {
    const s = new MarketShadow();
    s.setCoins(['ETH']);
    scanMany(s, 'ETH', 60);
    expect(s.liqMap('ETH', T0, all)).toBeNull(); // ani ceny, ani OI
    s.setOi({ ETH: 150 }, T0);
    s.onTrade(trade('ETH', ['x', 'y'], 3000, 1, T0 - PRICE_MAX_AGE_MS - 1), () => true);
    expect(s.liqMap('ETH', T0, all)).toBeNull();
    s.onTrade(trade('ETH', ['x', 'y'], 3000, 1, T0), () => true);
    expect(s.liqMap('ETH', T0, all)?.coverage.positions).toBe(60);
    expect(s.liqMap('ETH', T0 + OI_MAX_AGE_MS + 1, all)).toBeNull();
    expect(s.liqMap('ETH', T0, { inBook: (a) => a !== 'ETH0', addresses: 1000 })?.coverage.positions).toBe(59);
    // Starsza transakcja przychodząca później nie cofa ceny
    s.onTrade(trade('ETH', ['x', 'y'], 1, 1, T0 - MIN), () => true);
    expect(s.liqMap('ETH', T0, all)?.markPx).toBe(3000);
  });

  it('stan v2 (same rozmiary): pokrycie zostaje, mapa dopiero z pozycji po kolejnym odczycie konta; v3 w obie strony', () => {
    const v2 = { v: 2, pos: [['k1', { t: T0, s: { ETH: 4 } }]], hours: [], xyz: [], oi: { at: T0, byCoin: { ETH: 20 } } };
    const back = MarketShadow.fromJSON(v2, T0);
    back.setCoins(['ETH']);
    back.onTrade(trade('ETH', ['x', 'y'], 100, 1, T0), () => true);
    expect(back.status(T0, { inBook: () => true }).markets.ETH.coverage).toBe(0.1);
    expect(back.liqMap('ETH', T0, all)).toBeNull();
    back.onScan('k1', state(pos('ETH', -4, 110)), T0);
    expect(back.liqMap('ETH', T0, all)?.coverage.shortBtc).toBe(4);
    const v3 = MarketShadow.fromJSON(JSON.parse(JSON.stringify(back.toJSON())), T0);
    v3.setCoins(['ETH']);
    expect(v3.toJSON().pos).toEqual(back.toJSON().pos);
  });
});

describe('MarketShadow — świeżość pozycji na rynek (ageP50Min)', () => {
  it('mediana wieku odczytu ważona |rozmiarem|: duża stara pozycja przeważa wiele małych świeżych; konto spoza księgi nie liczy się', () => {
    const s = new MarketShadow();
    s.setCoins(['BTC', 'ETH', 'SOL']);
    s.onScan('big', state(pos('ETH', -60), pos('BTC', 1)), T0); // 120 min przed odczytem statusu
    s.onScan('s1', state(pos('ETH', 10)), T0 + 110 * MIN);
    s.onScan('s2', state(pos('ETH', 10), pos('BTC', 3)), T0 + 115 * MIN);
    s.onScan('out', state(pos('SOL', 99)), T0 + 119 * MIN);
    const st = s.status(T0 + 120 * MIN, { inBook: (a) => a !== 'out' });
    expect(st.markets.ETH.ageP50Min).toBe(120); // 60 z 80 jednostek ma 120 min
    expect(st.markets.BTC.ageP50Min).toBe(5); // 3 z 4 jednostek ma 5 min
    expect(st.markets.SOL.ageP50Min).toBeNull();
  });
});

describe('FlowMinutes — przepływ minutowy K2', () => {
  it('suma kupna (B) i sprzedaży (A) agresywnej na minutę i rynek; minuta zamykana 30 s po końcu', () => {
    const f = new FlowMinutes();
    f.setCoins(['BTC', 'ETH'], T0 - HOUR);
    f.onState(true, T0 - 10_000);
    f.onTrade('BTC', 'B', 100, T0 + 1_000);
    f.onTrade('BTC', 'A', 40.4, T0 + 2_000);
    f.onTrade('ETH', 'B', 7, T0 + 59_000);
    f.onTrade('BTC', 'B', 1, T0 + MIN + 1); // następna minuta, także dowód, że połączenie żyło po końcu pierwszej
    expect(f.flush(T0 + MIN + FLOW_SETTLE_MS - 1)).toEqual([]);
    expect(f.flush(T0 + MIN + FLOW_SETTLE_MS)).toEqual([{ t: T0, coins: ['BTC', 'ETH'], v: [100, 40, 7, 0] }]);
    // spóźniona transakcja do wydanej minuty nie zmienia niczego
    f.onTrade('BTC', 'B', 5, T0 + 3_000);
    f.onTrade('BTC', 'B', 1, T0 + 2 * MIN + 1);
    expect(f.flush(T0 + 2 * MIN + FLOW_SETTLE_MS).map((r) => r.v)).toEqual([[1, 0, 0, 0]]);
  });

  it('minuty niepełnego połączenia bez wiersza; minuta bez transakcji z zerami; rynek dopisany w trakcie minuty → null', () => {
    const f = new FlowMinutes();
    f.setCoins(['BTC'], T0 - HOUR);
    f.onState(true, T0 + 20_000); // minuta T0 niepełna
    f.onTrade('BTC', 'B', 1, T0 + 30_000);
    f.setCoins(['BTC', 'ETH'], T0 + MIN + 5_000);
    f.onTrade('BTC', 'B', 1, T0 + 3 * MIN + 1);
    f.onState(false, T0 + 3 * MIN + 1);
    f.onState(true, T0 + 5 * MIN + 30_000);
    f.onTrade('BTC', 'A', 2, T0 + 6 * MIN + 10);
    f.onTrade('ETH', 'B', 3, T0 + 7 * MIN);
    const rows = f.flush(T0 + 10 * MIN);
    expect(rows.map((r) => [(r.t - T0) / MIN, r.v])).toEqual([
      [1, [0, 0, null, null]],
      [2, [0, 0, 0, 0]],
      [6, [0, 2, 0, 0]],
    ]);
  });

  it('otwarte połączenie bez transakcji po końcu minuty: minuta czeka (cisza może być zerwaniem)', () => {
    const f = new FlowMinutes();
    f.setCoins(['BTC'], 0);
    f.onState(true, T0);
    f.onTrade('BTC', 'B', 1, T0 + 10);
    expect(f.flush(T0 + 5 * MIN)).toEqual([]);
    f.onState(false, T0 + 10); // strażnik wykrył zerwanie: koniec odcinka na ostatniej wiadomości
    expect(f.flush(T0 + 5 * MIN)).toEqual([]);
    f.onTrade('BTC', 'B', 1, T0 + 10 * MIN);
    expect(f.flush(T0 + 20 * MIN)).toEqual([]);
  });
});

describe('FlowFile — pliki K2 w stanie serwera', () => {
  const row = (t: number, coins: string[], v: (number | null)[]) => ({ t, coins, v });

  it('nagłówek i wiersze na dobę UTC; odczyt po restarcie (nowy nagłówek) i po przerwanym zapisie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-flow-'));
    const a = new FlowFile(dir);
    a.append([row(T0, ['BTC', 'ETH'], [1, 2, 3, 4]), row(T0 + MIN, ['BTC', 'ETH'], [5, 6, 0, 0])]);
    a.append([row(T0 + 2 * MIN, ['BTC'], [7, 8])]); // zmiana rynków → nowy nagłówek
    const path = join(dir, '2026-11-12.jsonl');
    writeFileSync(path, readFileSync(path, 'utf8') + '[123,'); // przerwany zapis
    const b = new FlowFile(dir); // restart
    b.append([row(T0 + 5 * MIN, ['BTC', 'ETH'], [9, 9, null, null]), row(T0 + 14 * HOUR, ['BTC', 'ETH'], [1, 1, 1, 1])]);
    expect(readFlowDay(readFileSync(path, 'utf8'))).toEqual([
      { t: T0, m: { BTC: [1, 2], ETH: [3, 4] } },
      { t: T0 + MIN, m: { BTC: [5, 6], ETH: [0, 0] } },
      { t: T0 + 2 * MIN, m: { BTC: [7, 8] } },
      { t: T0 + 5 * MIN, m: { BTC: [9, 9], ETH: null } },
    ]);
    expect(readFlowDay(readFileSync(join(dir, '2026-11-13.jsonl'), 'utf8'))).toEqual([{ t: T0 + 14 * HOUR, m: { BTC: [1, 1], ETH: [1, 1] } }]);
  });

  it('przycinanie do 21 dób (test po K2 potrzebuje 14 pełnych): usuwa doby całe starsze, zostawia resztę i obce pliki', () => {
    expect(K2_KEEP_DAYS).toBe(21);
    const dir = mkdtempSync(join(tmpdir(), 'hq-flow-'));
    const f = new FlowFile(dir);
    const day0 = Date.UTC(2026, 10, 1);
    for (let d = 0; d < 23; d++) f.append([row(day0 + d * DAY, ['BTC'], [1, 1])]);
    writeFileSync(join(dir, 'notatka.txt'), 'x');
    const now = day0 + 22 * DAY + 12 * HOUR;
    expect(f.prune(now)).toBe(1);
    expect(f.prune(now)).toBe(0);
    const left = readdirSync(dir).sort();
    expect(left[0]).toBe('2026-11-02.jsonl');
    expect(left).toContain('notatka.txt');
    expect(left.length).toBe(23);
  });
});

describe('ShadowGate — pomiar ustępuje głównemu strumieniowi (sztuczny zegar)', () => {
  it('start po 60 s stabilnego głównego; główny w dół 31 s → stop; po powrocie 60 s → start; krótsze przerwy bez zmian', () => {
    const g = new ShadowGate();
    const run = (from: number, to: number, up: boolean) => {
      const acts: [number, string][] = [];
      for (let t = from; t <= to; t += 1_000) {
        const a = g.update(up, t);
        if (a) acts.push([t - T0, a]);
      }
      return acts;
    };
    expect(run(T0, T0 + 59_000, true)).toEqual([]);
    expect(run(T0 + 60_000, T0 + 120_000, true)).toEqual([[60_000, 'start']]);
    // krótka przerwa (30 s) nic nie zmienia
    expect(run(T0 + 121_000, T0 + 151_000, false)).toEqual([]);
    expect(g.active).toBe(true);
    expect(run(T0 + 152_000, T0 + 160_000, true)).toEqual([]);
    // przerwa 31 s → stop
    expect(run(T0 + 161_000, T0 + 192_000, false)).toEqual([[T0 + 192_000 - T0, 'stop']]);
    expect(g.active).toBe(false);
    // powrót na 59 s, potem znów w dół: bez startu
    expect(run(T0 + 193_000, T0 + 251_000, true)).toEqual([]);
    expect(run(T0 + 252_000, T0 + 255_000, false)).toEqual([]);
    // 60 s stabilnego połączenia → start
    expect(run(T0 + 256_000, T0 + 316_000, true)).toEqual([[316_000, 'start']]);
  });
});
