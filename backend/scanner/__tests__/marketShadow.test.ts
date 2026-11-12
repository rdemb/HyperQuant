import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLiqMap } from '../../../src/utils/liqMap.ts';
import { parseCoinPosition } from '../positions.ts';
import { FLOW_SETTLE_MS, FlowFile, FlowMinutes, M0_WINDOW_MS, MarketShadow, OI_MAX_AGE_MS, parseOpenInterest, readFlowDay } from '../marketShadow.ts';

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
    states.forEach((st, i) => s.onScan(`a${i}`, st));
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
    s.onScan('a', state(pos('ETH', 10), pos('xyz:NVDA', 5)));
    s.onScan('b', state(pos('ETH', 30)));
    s.setOi({ ETH: 100, BTC: 5 }, T0);
    const st = s.status(T0 + MIN, { inBook: (a) => a === 'a', btc: { coin: 'BTC', coverage: 0.61234 } });
    expect(st.markets).toEqual({
      BTC: { coverage: 0.6123, unseenShare: null },
      ETH: { coverage: 0.05, unseenShare: null },
      'xyz:NVDA': { coverage: null, unseenShare: null },
    });
    expect(s.status(T0 + OI_MAX_AGE_MS + 1, { inBook: () => true }).markets.ETH.coverage).toBeNull();
  });

  it('odczyt bez pozycji kasuje stare pozycje konta, nieudany (zły kształt) nie', () => {
    const s = new MarketShadow();
    s.setCoins(['ETH']);
    s.setOi({ ETH: 50 }, T0);
    s.onScan('a', state(pos('ETH', 10)));
    s.onScan('a', null);
    expect(s.status(T0, { inBook: () => true }).markets.ETH.coverage).toBe(0.1);
    s.onScan('a', state());
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
    expect(s.status(T0 + 2 * MIN, { inBook }).markets).toEqual({ ETH: { coverage: null, unseenShare: 0.125 }, SOL: { coverage: null, unseenShare: null } });
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
    s.onScan('k1', state(pos('ETH', 4)));
    s.setOi({ ETH: 20 }, T0);
    s.onTrade(trade('xyz:NVDA', ['k1', 'u1'], 10, 10, T0), inBook);
    s.onTrade(trade('ETH', ['u2', 'k1'], 5, 10, T0 + HOUR), inBook);
    const back = MarketShadow.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), T0 + 2 * HOUR);
    back.setCoins(['ETH', 'xyz:NVDA']);
    expect(back.status(T0 + 2 * HOUR, { inBook })).toEqual(s.status(T0 + 2 * HOUR, { inBook }));
    expect(MarketShadow.fromJSON({ v: 9 }, T0).toJSON().pos).toEqual([]);
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

  it('przycinanie do 14 dób: usuwa doby całe starsze, zostawia resztę i obce pliki', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-flow-'));
    const f = new FlowFile(dir);
    const day0 = Date.UTC(2026, 10, 1);
    for (let d = 0; d < 16; d++) f.append([row(day0 + d * DAY, ['BTC'], [1, 1])]);
    writeFileSync(join(dir, 'notatka.txt'), 'x');
    const now = day0 + 15 * DAY + 12 * HOUR;
    expect(f.prune(now)).toBe(1);
    expect(f.prune(now)).toBe(0);
    const left = readdirSync(dir).sort();
    expect(left[0]).toBe('2026-11-02.jsonl');
    expect(left).toContain('notatka.txt');
    expect(left.length).toBe(16);
  });
});
