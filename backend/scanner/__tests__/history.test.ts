import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { decodeBook, decodeTrades, historyPath } from '../../../src/utils/tapeHistory.ts';
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

  it('arkusz: agregacja bliska i daleka rozpoznana po siatce cen, inna pominięta; agregacje do subskrypcji z ceny', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-hist-'));
    const r = new MarketRecorder('BTC', dir);
    expect(r.aggs()).toBeNull();
    r.onCtx({ markPx: 80_000, oiBtc: 1, dayNtlVlm: 1, funding: 0 }, T0);
    expect(r.aggs()).toEqual([{ nSigFigs: 4 }, { nSigFigs: 3 }]); // 10 i 100 USD
    r.onState(true, T0);
    r.onTrades([trade(T0, 1, 'B', 1, 2, HASH(3))]);
    r.onBook(T0 + 100, [[lv(80_000, 1, 3), lv(79_990, 2, 4)], [lv(80_010, 1, 1)]]); // bliska
    r.onBook(T0 + 200, [[lv(80_000, 5, 30), lv(79_900, 6, 40)], [lv(80_100, 7, 20)]]); // daleka
    r.onBook(T0 + 300, [[lv(80_000, 1, 1), lv(79_999, 1, 1)], [lv(80_001, 1, 1)]]); // dokładny — pominięty
    r.flush(T0 + 5 * MIN + SETTLE_MS);
    const b = decodeBook(read(dir, 'BTC', T0, 'book', true))!;
    expect(b.frames.map((x) => [x.t, x.step, x.bids.length / 3, x.asks.length / 3])).toEqual([
      [T0 + 100, 10, 2, 1],
      [T0 + 200, 100, 2, 1],
    ]);
    expect(b.frames[0].bids).toEqual([80_000, 1, 3, 79_990, 2, 4]);
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
    expect(idx.markets.BTC).toEqual({ hours: [T0 - 3 * 86_400_000, T0], parts: [T0 + 60 * MIN] });
    expect(idx.markets.ETH).toEqual({ hours: [], parts: [] });
    expect(pruneHistory(dir, ['BTC'], 2, T0)).toBe(1);
    expect(historyIndex(dir, ['BTC'], 2, T0).markets.BTC.hours).toEqual([T0]);
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
