import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { type HistTrade, decodeBook, decodeTrades, encodeTrades, historyPath, idScopeOf } from '../../../src/utils/tapeHistory.ts';
import { decodeDayProfile, dayProfilePath } from '../../../src/utils/dayProfile.ts';
import { MarketRecorder, SETTLE_MS, historyIndex, pruneHistory } from '../history.ts';
import { prepareHistoryRepo, publishHistory } from '../historyGit.ts';
import type { HlTrade } from '../hl.ts';

vi.setConfig({ testTimeout: 30_000 });

const T0 = Date.UTC(2026, 9, 24, 13, 0, 0);
const MIN = 60_000;
const A = (k: number) => `0x${String(k).padStart(40, '0')}`;
const HASH = (k: number) => `0x${String(k).padStart(64, '1')}`;
const ZERO = `0x${'0'.repeat(64)}`;

const trade = (t: number, tid: number, side: 'B' | 'A', taker: number, maker: number, hash: string, px = 80_000, sz = 0.1): HlTrade => ({
  coin: 'BTC',
  side,
  px: String(px),
  sz: String(sz),
  time: t,
  tid,
  hash,
  users: side === 'B' ? [A(taker), A(maker)] : [A(maker), A(taker)],
});

const read = (dir: string, coin: string, start: number, kind: 'trades' | 'book', part: boolean) =>
  JSON.parse(gunzipSync(readFileSync(join(dir, historyPath(coin, start, kind, part)))).toString('utf8'));

const lv = (px: number, sz: number, n: number) => ({ px: String(px), sz: String(sz), n });

describe('MarketRecorder — nagranie taśmy, arkusza i kontekstu jednego rynku', () => {
  it('pokrycie od najnowszej transakcji migawki; numery zleceń z biorcy i hasha (bez hasha — z milisekundy); część po 5 min + 10 s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, T0);
    r.onTrades([trade(T0 + 1000, 1, 'B', 1, 9, HASH(1)), trade(T0 + 2000, 2, 'B', 1, 8, HASH(1))]); // migawka
    r.onTrades([trade(T0 + 3000, 3, 'A', 2, 9, ZERO), trade(T0 + 3000, 4, 'A', 2, 9, ZERO), trade(T0 + 4000, 5, 'A', 2, 9, ZERO)]);
    r.onCtx({ markPx: 80_000, oiBtc: 30_000, dayNtlVlm: 1e9, funding: 1.25e-5 }, T0 + 5000);
    expect(r.flush(T0 + 5 * MIN + SETTLE_MS - 1)).toBe(0); // część jeszcze otwarta
    expect(r.flush(T0 + 5 * MIN + SETTLE_MS)).toBe(2);
    const f = decodeTrades(read(dir, 'BTC', T0, 'trades', true))!;
    expect(f.spans).toEqual([[T0 + 2000, T0 + 5 * MIN]]);
    // Biorcy i makerzy w jednej numeracji: 1 → 0, 9 → 1, 8 → 2, 2 → 3
    expect(f.trades.map((x) => [x.tid, x.side, x.o, x.k, x.m])).toEqual([
      [1, 'B', 0, 0, 1],
      [2, 'B', 0, 0, 2],
      [3, 'A', 1, 3, 1],
      [4, 'A', 1, 3, 1],
      [5, 'A', 2, 3, 1],
    ]);
    expect(f.ctx).toEqual([{ t: T0, oi: 30_000, funding: 1.25e-5, mark: 80_000 }]);
    // W pliku nie ma adresów ani hashy
    const raw = gunzipSync(readFileSync(join(dir, historyPath('BTC', T0, 'trades', true)))).toString('utf8');
    expect(raw).not.toMatch(/0x/);
  });

  it('hash zerowy: kolumna `z` z indeksami transakcji; godzina scalona z częścią bez kolumny (sprzed jej wprowadzenia) — bez znacznika', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, T0);
    r.onTrades([trade(T0 + 1000, 1, 'B', 1, 9, HASH(1))]); // migawka
    r.onTrades([trade(T0 + 3000, 2, 'A', 2, 9, ZERO), trade(T0 + 4000, 3, 'B', 1, 9, HASH(2)), trade(T0 + 5000, 4, 'B', 3, 9, ZERO)]);
    r.flush(T0 + 5 * MIN + SETTLE_MS);
    const raw = read(dir, 'BTC', T0, 'trades', true);
    expect(raw.z).toEqual([1, 2]); // indeksy 1 i 3, różnicowo
    const f = decodeTrades(raw)!;
    expect(f.zeroKnown).toBe(true);
    expect(f.trades.map((x) => x.z === true)).toEqual([false, true, false, true]);
    // Część zapisana przez rejestrator bez kolumny: po scaleniu godzina bez znacznika (nie wiadomo, które transakcje go miały)
    const p5 = T0 + 5 * MIN;
    const old = encodeTrades('BTC', p5, p5 + 5 * MIN, [[p5, p5 + 5 * MIN]], [{ t: p5 + 1000, px: 80_000, sz: 0.1, side: 'A', tid: 5, o: 9, k: 4, m: 1 }], [], false);
    writeFileSync(join(dir, historyPath('BTC', p5, 'trades', true)), gzipSync(JSON.stringify(old)));
    r.flush(T0 + 60 * MIN + SETTLE_MS);
    const h = decodeTrades(read(dir, 'BTC', T0, 'trades', false))!;
    expect(h.trades.map((x) => x.tid)).toEqual([1, 2, 3, 4, 5]);
    expect(h.zeroKnown).toBe(false);
    expect(h.trades.some((x) => x.z)).toBe(false);
  });

  it('cisza na rynku w trakcie nagrania: pusta część z pokryciem; zerwanie połączenia zamyka odcinek', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('ETH', dir);
    r.onState(true, T0);
    r.onTrades([trade(T0 + 1000, 1, 'B', 1, 2, HASH(2), 2800)]);
    r.flush(T0 + 5 * MIN + SETTLE_MS);
    r.flush(T0 + 10 * MIN + SETTLE_MS);
    expect(decodeTrades(read(dir, 'ETH', T0 + 5 * MIN, 'trades', true))!.spans).toEqual([[T0 + 5 * MIN, T0 + 10 * MIN]]);
    r.onState(false, T0 + 12 * MIN);
    r.flush(T0 + 15 * MIN + SETTLE_MS);
    expect(decodeTrades(read(dir, 'ETH', T0 + 10 * MIN, 'trades', true))!.spans).toEqual([[T0 + 10 * MIN, T0 + 12 * MIN]]);
    r.flush(T0 + 20 * MIN + SETTLE_MS);
    expect(existsSync(join(dir, historyPath('ETH', T0 + 15 * MIN, 'trades', true)))).toBe(false); // bez nagrania — bez pliku
  });

  it('arkusz: agregacja bliska i daleka rozpoznana po siatce cen, dokładny tylko na BTC; agregacje do subskrypcji z ceny', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    expect(r.aggs()).toBeNull();
    r.onCtx({ markPx: 80_000, oiBtc: 1, dayNtlVlm: 1, funding: 0 }, T0);
    expect(r.aggs()).toEqual([{ nSigFigs: 4 }, { nSigFigs: 3 }]); // 10 i 100 USD
    r.onState(true, T0);
    r.onTrades([trade(T0, 1, 'B', 1, 2, HASH(3))]);
    r.onBook(T0 + 100, [[lv(80_000, 1, 3), lv(79_990, 2, 4)], [lv(80_010, 1, 1)]]); // bliska
    r.onBook(T0 + 200, [[lv(80_000, 5, 30), lv(79_900, 6, 40)], [lv(80_100, 7, 20)]]); // daleka
    r.onBook(T0 + 300, [[lv(80_000, 1, 1), lv(79_999, 1, 1)], [lv(80_001, 1, 1)]]); // dokładny (krok 1 USD)
    expect(r.exactBook()).toBe(true);
    r.flush(T0 + 5 * MIN + SETTLE_MS);
    const raw = read(dir, 'BTC', T0, 'book', true);
    // Migawka dokładna ma piąty element, więc starszy odczyt (dokładnie cztery) ją pomija
    expect(raw.frames.map((x: unknown[]) => x.length)).toEqual([4, 4, 5]);
    const b = decodeBook(raw)!;
    expect(b.frames.map((x) => [x.t, x.step, x.bids.length / 3, x.asks.length / 3, x.exact ?? false])).toEqual([
      [T0 + 100, 10, 2, 1, false],
      [T0 + 200, 100, 2, 1, false],
      [T0 + 300, 1, 2, 1, true],
    ]);
    expect(b.frames[0].bids).toEqual([80_000, 1, 3, 79_990, 2, 4]);
    // Inny rynek: arkusz dokładny pominięty, bez subskrypcji
    const dirE = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const e = new MarketRecorder('ETH', dirE);
    expect(e.exactBook()).toBe(false);
    e.onCtx({ markPx: 2_800, oiBtc: 1, dayNtlVlm: 1, funding: 0 }, T0);
    e.onState(true, T0);
    e.onTrades([{ ...trade(T0, 1, 'B', 1, 2, HASH(3)), coin: 'ETH' }]);
    e.onBook(T0 + 100, [[lv(2_800.1, 1, 1), lv(2_799.9, 1, 1)], [lv(2_800.3, 1, 1)]]);
    e.flush(T0 + 5 * MIN + SETTLE_MS);
    expect(decodeBook(read(dirE, 'ETH', T0, 'book', true))?.frames ?? []).toEqual([]);
  });

  it('po zamknięciu godziny części łączą się w plik godzinowy; restart: numeracja dalej, zapisana część scalona, nie nadpisana', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('SOL', dir);
    r.onState(true, T0);
    r.onTrades([trade(T0 + 1000, 1, 'B', 1, 2, HASH(4), 190), trade(T0 + 6 * MIN, 2, 'B', 3, 2, HASH(5), 190)]);
    r.flush(T0 + 10 * MIN + SETTLE_MS);
    // Restart: nowa instancja, migawka powtarza transakcję z zapisanej części i dokłada nową z innym biorcą
    const r2 = new MarketRecorder('SOL', dir);
    r2.onState(true, T0 + 11 * MIN);
    r2.onTrades([trade(T0 + 6 * MIN, 2, 'B', 3, 2, HASH(5), 190), trade(T0 + 11 * MIN, 3, 'A', 7, 2, ZERO, 190)]);
    r2.flush(T0 + 15 * MIN + SETTLE_MS);
    const p5 = decodeTrades(read(dir, 'SOL', T0 + 5 * MIN, 'trades', true))!;
    expect(p5.trades.map((x) => x.tid)).toEqual([2]);
    const p10 = decodeTrades(read(dir, 'SOL', T0 + 10 * MIN, 'trades', true))!;
    expect(p10.trades.map((x) => [x.tid, x.o])).toEqual([[3, 3]]); // po numerach 0–2 z zapisanych części (powtórzona transakcja też dostała numer)
    r2.flush(T0 + 60 * MIN + SETTLE_MS);
    const h = decodeTrades(read(dir, 'SOL', T0, 'trades', false))!;
    expect(h.trades.map((x) => x.tid)).toEqual([1, 2, 3]);
    expect(h.from).toBe(T0);
    expect(h.spans[0][0]).toBe(T0 + 6 * MIN); // od najnowszej transakcji migawki
    expect(existsSync(join(dir, historyPath('SOL', T0, 'trades', true)))).toBe(false);
    expect(existsSync(join(dir, historyPath('SOL', T0, 'book', false)))).toBe(true);
  });
  it('zatrzymanie (SIGTERM): bieżąca część zapisana do chwili zatrzymania; po restarcie dopisana do tej samej części', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, T0);
    r.onTrades([trade(T0 + 1000, 1, 'B', 1, 2, HASH(6))]);
    r.onTrades([trade(T0 + 60_000, 2, 'A', 3, 2, ZERO)]);
    expect(r.flush(T0 + 2 * MIN, true)).toBe(2);
    expect(decodeTrades(read(dir, 'BTC', T0, 'trades', true))!.spans).toEqual([[T0 + 1000, T0 + 2 * MIN]]);
    // Nowy proces: migawka od transakcji sprzed zatrzymania, nagranie dalej w tej samej części
    const r2 = new MarketRecorder('BTC', dir);
    r2.onState(true, T0 + 2 * MIN + 20_000);
    r2.onTrades([trade(T0 + 60_000, 2, 'A', 3, 2, ZERO), trade(T0 + 2 * MIN + 10_000, 3, 'B', 4, 2, HASH(7))]);
    r2.onTrades([trade(T0 + 3 * MIN, 4, 'B', 1, 2, HASH(8))]);
    r2.flush(T0 + 5 * MIN + SETTLE_MS);
    const f = decodeTrades(read(dir, 'BTC', T0, 'trades', true))!;
    // Powtórzona transakcja raz; numeracja dalej od zapisanej części (jak przy każdym restarcie, adresów nie ma w plikach)
    expect(f.trades.map((x) => [x.tid, x.o, x.k])).toEqual([
      [1, 0, 0],
      [2, 1, 2],
      [3, 3, 5],
      [4, 4, 6],
    ]);
    expect([...f.spans].sort((a, b) => a[0] - b[0])).toEqual([
      [T0 + 1000, T0 + 2 * MIN],
      [T0 + 2 * MIN + 10_000, T0 + 5 * MIN],
    ]);
  });
});

describe('numeracja kont i zleceń w obrębie doby UTC', () => {
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const D = Date.UTC(2026, 10, 7);
  const H10 = D + 10 * HOUR;
  const H11 = D + 11 * HOUR;
  /** Konta i hash jako nieprzejrzyste napisy — w testach nie ma adresów ani hashy */
  const deal = (t: number, tid: number, side: 'B' | 'A', taker: string, maker: string, tx: string): HlTrade => ({
    coin: 'BTC',
    side,
    px: '80000',
    sz: '0.1',
    time: t,
    tid,
    hash: tx,
    users: side === 'B' ? [taker, maker] : [maker, taker],
  });
  const row = (t: number, tid: number, o: number, k: number, m: number): HistTrade => ({ t, px: 80_000, sz: 0.1, side: 'B', tid, o, k, m });
  const put = (dir: string, start: number, part: boolean, trades: HistTrade[], idScope?: 'day') => {
    const rel = historyPath('BTC', start, 'trades', part);
    const len = part ? 5 * MIN : HOUR;
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), gzipSync(JSON.stringify(encodeTrades('BTC', start, start + len, [[start, start + len]], trades, [], true, idScope))));
  };
  const ids = (dir: string, start: number, part: boolean) => decodeTrades(read(dir, 'BTC', start, 'trades', part))!.trades.map((x) => [x.tid, x.o, x.k, x.m]);

  it('ten sam biorca o 10:59 i 11:01 UTC ma ten sam numer; plik godzinowy i część z `idScope: "day"`, bez kont i hashy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, H10 + 58 * MIN);
    r.onTrades([deal(H10 + 58 * MIN, 1, 'B', 'acct-X', 'acct-M', 'tx-1')]); // migawka
    r.onTrades([deal(H10 + 59 * MIN, 2, 'B', 'acct-A', 'acct-M', 'tx-2')]);
    r.onTrades([deal(H11 + MIN, 3, 'A', 'acct-A', 'acct-N', 'tx-3')]);
    r.flush(H11 + 5 * MIN + SETTLE_MS);
    // X → 0, M → 1, A → 2 o 10:59 i dalej o 11:01; N → 3; zlecenia dalej w tej samej numeracji
    expect(ids(dir, H10, false)).toEqual([
      [1, 0, 0, 1],
      [2, 1, 2, 1],
    ]);
    expect(ids(dir, H11, true)).toEqual([[3, 2, 2, 3]]);
    const hour = read(dir, 'BTC', H10, 'trades', false);
    const part = read(dir, 'BTC', H11, 'trades', true);
    expect([hour.idScope, part.idScope]).toEqual(['day', 'day']);
    expect([decodeTrades(hour)!.idScope, decodeTrades(part)!.idScope]).toEqual(['day', 'day']);
    for (const [start, isPart] of [[H10, false], [H11, true]] as const) {
      const raw = gunzipSync(readFileSync(join(dir, historyPath('BTC', start, 'trades', isPart)))).toString('utf8');
      expect(raw).not.toMatch(/acct-|tx-/);
    }
  });

  it('nowa doba: po zapisie ostatniej części doby jej mapy zwolnione, o 00:01 numeracja od 0 (konto z poprzedniej doby — nowy numer)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, D + DAY - 2 * MIN);
    r.onTrades([deal(D + DAY - 2 * MIN, 1, 'B', 'acct-X', 'acct-M', 'tx-1')]); // migawka
    r.onTrades([deal(D + DAY - MIN, 2, 'B', 'acct-A', 'acct-M', 'tx-2')]);
    expect(r.heldIds()).toEqual({ days: 1, users: 3, orders: 2 });
    r.flush(D + DAY + SETTLE_MS); // część 23:55 zapisana i połączona w godzinę 23:00
    expect(r.heldIds()).toEqual({ days: 0, users: 0, orders: 0 });
    expect(ids(dir, D + DAY - HOUR, false)).toEqual([
      [1, 0, 0, 1],
      [2, 1, 2, 1],
    ]);
    r.onTrades([deal(D + DAY + MIN, 3, 'B', 'acct-A', 'acct-N', 'tx-3')]);
    expect(r.heldIds()).toEqual({ days: 1, users: 2, orders: 1 });
    r.flush(D + DAY + 5 * MIN + SETTLE_MS);
    expect(ids(dir, D + DAY, true)).toEqual([[3, 0, 0, 1]]);
  });

  it('spóźniona transakcja doby poprzedniej (przed zapisem jej ostatniej części) dostaje numer tamtej doby', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, D + DAY - 2000);
    r.onTrades([deal(D + DAY - 2000, 1, 'B', 'acct-A', 'acct-M', 'tx-1')]); // migawka
    r.onTrades([deal(D + DAY + 1000, 2, 'B', 'acct-B', 'acct-N', 'tx-2')]);
    r.onTrades([deal(D + DAY - 1000, 3, 'B', 'acct-A', 'acct-P', 'tx-3')]);
    expect(r.heldIds().days).toBe(2);
    r.flush(D + DAY + SETTLE_MS);
    expect(r.heldIds()).toEqual({ days: 1, users: 2, orders: 1 });
    expect(ids(dir, D + DAY - HOUR, false)).toEqual([
      [1, 0, 0, 1],
      [3, 1, 0, 2],
    ]);
    r.flush(D + DAY + 5 * MIN + SETTLE_MS);
    expect(ids(dir, D + DAY, true)).toEqual([[2, 0, 0, 1]]);
  });

  it('restart o 11:30: numeracja dalej od największych numerów z plików doby (godzina 10:00 i część 11:00), bez plików doby poprzedniej', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    put(dir, D - HOUR, false, [row(D - HOUR + 1000, 1, 99, 99, 99)], 'day'); // doba poprzednia — nie liczy się
    put(dir, H10, false, [row(H10 + 1000, 10, 20, 7, 9), row(H10 + 2000, 11, 4, 3, 2)], 'day'); // największe `o`
    put(dir, H11, true, [row(H11 + 1000, 12, 5, 3, 30)], 'day'); // największe `m`
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, H11 + 30 * MIN);
    r.onTrades([deal(H11 + 30 * MIN + 1000, 13, 'B', 'acct-A', 'acct-M', 'tx-1')]);
    r.flush(H11 + 35 * MIN + SETTLE_MS);
    expect(ids(dir, H11 + 30 * MIN, true)).toEqual([[13, 21, 31, 32]]);
  });

  it('zlecenia w pamięci tylko z bieżącej i poprzedniej godziny (numer dalej dobowy), konta przez całą dobę', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, H10);
    r.onTrades([deal(H10 + 1000, 1, 'B', 'acct-A', 'acct-M', 'tx-1')]); // migawka
    r.onTrades([deal(H11 + 1000, 2, 'B', 'acct-B', 'acct-M', 'tx-2')]);
    r.onTrades([deal(H11 + HOUR + 1000, 3, 'B', 'acct-A', 'acct-N', 'tx-3')]);
    expect(r.heldIds()).toEqual({ days: 1, users: 4, orders: 2 });
    r.flush(H11 + HOUR + 5 * MIN + SETTLE_MS);
    expect(ids(dir, H11 + HOUR, true)).toEqual([[3, 2, 0, 3]]);
  });

  it('scalenie z plikiem bez pola (sprzed numeracji dobowej): część i godzina z `idScope: "hour"`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    put(dir, H10, true, [row(H10 + 1000, 1, 3, 1, 2)]); // część zapisana przez rejestrator godzinowy
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, H10 + 2 * MIN);
    r.onTrades([deal(H10 + 2 * MIN, 2, 'B', 'acct-A', 'acct-M', 'tx-1')]);
    r.onTrades([deal(H10 + 6 * MIN, 3, 'B', 'acct-A', 'acct-M', 'tx-2')]);
    r.flush(H10 + 10 * MIN + SETTLE_MS);
    expect(ids(dir, H10, true)).toEqual([
      [1, 3, 1, 2],
      [2, 4, 3, 4],
    ]);
    expect(read(dir, 'BTC', H10, 'trades', true).idScope).toBe('hour');
    expect(read(dir, 'BTC', H10 + 5 * MIN, 'trades', true).idScope).toBe('day');
    r.flush(H11 + SETTLE_MS);
    expect(read(dir, 'BTC', H10, 'trades', false).idScope).toBe('hour');
  });
});

describe('format taśmy: zakres numerów `idScope`', () => {
  it('pole zapisane na żądanie; odczyt z polem i bez (bez pola — godzina); nieznana wartość — plik odrzucony', () => {
    const T = Date.UTC(2026, 10, 7, 10);
    const tr: HistTrade = { t: T + 1000, px: 80_000, sz: 0.1, side: 'B', tid: 1, o: 0, k: 0, m: 1 };
    const day = encodeTrades('BTC', T, T + 5 * MIN, [[T, T + 5 * MIN]], [tr], [], true, 'day');
    const legacy = encodeTrades('BTC', T, T + 5 * MIN, [[T, T + 5 * MIN]], [tr], []);
    expect(day.idScope).toBe('day');
    expect('idScope' in legacy).toBe(false);
    expect(decodeTrades(day)!.idScope).toBe('day');
    expect(decodeTrades(legacy)!.idScope).toBe('hour');
    expect(decodeTrades({ ...day, idScope: 'hour' })!.idScope).toBe('hour');
    expect(decodeTrades({ ...day, idScope: 'week' })).toBeNull();
    expect(decodeTrades({ ...day, idScope: 1 })).toBeNull();
    expect([idScopeOf(day), idScopeOf(legacy), idScopeOf(decodeTrades(day)!), idScopeOf(decodeTrades(legacy)!)]).toEqual(['day', 'hour', 'day', 'hour']);
  });
});

describe('historyIndex i pruneHistory', () => {
  it('spis godzin i części; dni starsze niż okno usunięte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const put = (rel: string) => {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), 'x');
    };
    for (const kind of ['trades', 'book'] as const) {
      put(historyPath('BTC', T0 - 3 * 86_400_000, kind, false));
      put(historyPath('BTC', T0, kind, false));
      put(historyPath('BTC', T0 + 60 * MIN, kind, true));
    }
    put(historyPath('BTC', T0 + 65 * MIN, 'trades', true)); // bez pliku arkusza — pominięta
    const idx = historyIndex(dir, ['BTC', 'ETH'], 2, T0);
    expect(idx.markets.BTC).toEqual({ hours: [T0 - 3 * 86_400_000, T0], parts: [T0 + 60 * MIN], days: [] });
    expect(idx.markets.ETH).toEqual({ hours: [], parts: [], days: [] });
    expect(pruneHistory(dir, ['BTC'], 2, T0)).toBe(1);
    expect(historyIndex(dir, ['BTC'], 2, T0).markets.BTC.hours).toEqual([T0]);
  });
});

describe('profile dób — kupno, sprzedaż i zmiana OI na cenach z plików godzinowych', () => {
  it('doba zamknięta bez części: profil z OI minut (pierwsza minuta z doby poprzedniej); doba z częściami i bieżąca czekają', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const D = Date.UTC(2026, 9, 24);
    const DAY = 86_400_000;
    const hist = (t: number, tid: number, side: 'B' | 'A', px: number, sz: number) => ({ t, px, sz, side, tid, o: -1, k: -1, m: -1 });
    const ctx = (t: number, oi: number) => ({ t, oi, funding: 0, mark: 80_000 });
    const put = (start: number, trades: ReturnType<typeof hist>[], cs: ReturnType<typeof ctx>[], part = false) => {
      const rel = historyPath('BTC', start, 'trades', part);
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), gzipSync(JSON.stringify(encodeTrades('BTC', start, start + (part ? 5 : 60) * MIN, [[start, start + 60 * MIN]], trades, cs))));
    };
    // Ostatnia minuta doby poprzedniej: OI 1000
    put(D - 60 * MIN, [], [ctx(D - MIN, 1000)]);
    // Minuta 0: kupno 2 na 80 000, sprzedaż 1 na 80 001, OI +6; minuta 1: sprzedaż 1 na 80 000, OI −2; minuta 2 bez OI
    put(
      D,
      [hist(D + 1, 1, 'B', 80_000, 2), hist(D + 2, 2, 'A', 80_001, 1), hist(D + MIN + 1, 3, 'A', 80_000, 1), hist(D + 2 * MIN + 1, 4, 'B', 80_002, 1)],
      [ctx(D, 1006), ctx(D + MIN, 1004)]
    );
    // Doba następna jeszcze z częścią (niepołączona godzina) i doba bieżąca
    put(D + DAY + 60 * MIN, [hist(D + DAY + 60 * MIN + 1, 5, 'B', 80_000, 1)], [], true);
    put(D + 2 * DAY, [hist(D + 2 * DAY + 1, 6, 'B', 80_000, 1)], []);
    const r = new MarketRecorder('BTC', dir);
    const now = D + 2 * DAY + 3 * 60 * MIN;
    expect(r.profiles(now)).toBe(1);
    expect(r.profiles(now)).toBe(0);
    const p = decodeDayProfile(JSON.parse(gunzipSync(readFileSync(join(dir, dayProfilePath('BTC', D)))).toString('utf8')));
    expect(p).not.toBeNull();
    expect([p!.tick, p!.lo]).toEqual([1, 80_000]);
    expect(Array.from(p!.buy)).toEqual([2, 0, 1]);
    expect(Array.from(p!.sell)).toEqual([1, 1, 0]);
    // OI +6 na wolumenie 3 przy przewadze kupna: 4 i 2 w części „OI rośnie przy kupnie”; −2 przy sprzedaży
    expect(Array.from(p!.ob)).toEqual([4, 2, 0]);
    expect([...Array.from(p!.os), ...Array.from(p!.cb)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(p!.cs)).toEqual([2, 0, 0]);
    expect([p!.mv[0], p!.mv[1], p!.mv[2], p!.mv[3]]).toEqual([3, 1, 1, 0]);
    expect(p!.oiVol).toBe(4);
    expect(existsSync(join(dir, dayProfilePath('BTC', D + DAY)))).toBe(false);
    expect(existsSync(join(dir, dayProfilePath('BTC', D + 2 * DAY)))).toBe(false);
    expect(historyIndex(dir, ['BTC'], 7, now).markets.BTC.days).toEqual([D]);
    // Nowe uruchomienie: ważny plik zostaje bez ponownego liczenia
    expect(new MarketRecorder('BTC', dir).profiles(now)).toBe(0);
  });
});

describe('publishHistory — gałąź history repo danych', () => {
  const git = (d: string, ...args: string[]) => execFileSync('git', ['-C', d, ...args], { encoding: 'utf8' }).trim();

  it('commit i push zmian (także usunięć); spłaszczenie zostawia jeden commit z bieżącym drzewem', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'hq-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const repo = { remote, dir: join(mkdtempSync(join(tmpdir(), 'hq-work-')), 'history'), branch: 'history' };
    expect(await prepareHistoryRepo(repo, T0)).toBe(true);
    writeFileSync(join(repo.dir, 'a.json'), '1');
    expect((await publishHistory(repo, 'historia: 1', T0, false)).pushed).toBe(true);
    writeFileSync(join(repo.dir, 'b.json'), '2');
    execFileSync('rm', [join(repo.dir, 'a.json')]);
    expect((await publishHistory(repo, 'historia: 2', T0 + MIN, false)).pushed).toBe(true);
    expect(git(remote, 'rev-list', '--count', 'history')).toBe('2');
    expect(git(remote, 'ls-tree', '--name-only', 'history').split('\n')).toEqual(['b.json']);
    writeFileSync(join(repo.dir, 'c.json'), '3');
    const sq = await publishHistory(repo, 'historia: okno', T0 + 2 * MIN, true);
    expect(sq).toEqual({ ok: true, pushed: true });
    expect(git(remote, 'rev-list', '--count', 'history')).toBe('1');
    expect(git(remote, 'ls-tree', '--name-only', 'history').split('\n')).toEqual(['b.json', 'c.json']);
    expect(git(repo.dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).toBe('history');
    // Po spłaszczeniu zwykły commit dalej trafia na gałąź
    writeFileSync(join(repo.dir, 'd.json'), '4');
    expect((await publishHistory(repo, 'historia: 3', T0 + 3 * MIN, false)).pushed).toBe(true);
    expect(git(remote, 'rev-list', '--count', 'history')).toBe('2');
    // Ponowne przygotowanie istniejącego klonu nie sprawdza zgodności z origin
    expect(await prepareHistoryRepo(repo, T0 + 4 * MIN)).toBe(true);
  });

  it('katalog z plikami rejestratora bez repo (np. nowy serwer): gałąź z origin jako HEAD, jej pliki odtworzone, lokalne zostają', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'hq-remote-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    const first = { remote, dir: join(mkdtempSync(join(tmpdir(), 'hq-work-')), 'history'), branch: 'history' };
    await prepareHistoryRepo(first, T0);
    writeFileSync(join(first.dir, 'old.json'), 'stary dzień');
    await publishHistory(first, 'historia: 1', T0, false);
    const second = { remote, dir: join(mkdtempSync(join(tmpdir(), 'hq-work-')), 'history'), branch: 'history' };
    mkdirSync(second.dir, { recursive: true });
    writeFileSync(join(second.dir, 'new.json'), 'nowa część');
    expect(await prepareHistoryRepo(second, T0 + MIN)).toBe(true);
    expect(readFileSync(join(second.dir, 'old.json'), 'utf8')).toBe('stary dzień');
    expect((await publishHistory(second, 'historia: 2', T0 + MIN, false)).pushed).toBe(true);
    expect(git(remote, 'ls-tree', '--name-only', 'history').split('\n')).toEqual(['new.json', 'old.json']);
    expect(git(remote, 'rev-list', '--count', 'history')).toBe('2');
  });
});
