import { describe, expect, it } from 'vitest';
import { MicroEngine } from '../microEngine';

const S = 1000;
const lv = (px: number, sz: number) => ({ px: String(px), sz: String(sz), n: 1 });

/** Najlepsze kwotowania z kanału `bbo` (co ~150 ms). */
function bbo(t: number, bid: number, bidSz: number, ask: number, askSz: number) {
  return { time: t, bbo: [lv(bid, bidSz), lv(ask, askSz)] as [ReturnType<typeof lv>, ReturnType<typeof lv>] };
}

/** Migawka arkusza: najlepszy bid/ask i ilości (plus głębsze poziomy). */
function book(t: number, bid: number, bidSz: number, ask: number, askSz: number) {
  return { time: t, levels: [[lv(bid, bidSz), lv(bid - 1, 5)], [lv(ask, askSz), lv(ask + 1, 5)]] as [ReturnType<typeof lv>[], ReturnType<typeof lv>[]] };
}

describe('MicroEngine — z migawek arkusza i taśmy', () => {
  it('interwały 10 s: OFI CKS z kanału bbo i Δmid; regresja wpływu odzyskuje zależność', () => {
    const e = new MicroEngine();
    let t = 0;
    let mid = 100_000;
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 120; k++) {
      // w każdym interwale: przyrost ilości na bid = presja kupna → mid rośnie proporcjonalnie
      const push = (rnd() - 0.5) * 10;
      e.onBbo(bbo(t, mid - 0.5, 5, mid + 0.5, 5));
      t += 2 * S;
      e.onBbo(bbo(t, mid - 0.5, 5 + push, mid + 0.5, 5));
      mid += push * 2;
      t += 8 * S;
    }
    e.onBbo(bbo(t, mid - 0.5, 5, mid + 0.5, 5));
    const m = e.metrics(t);
    expect(m.ofi.fit).not.toBeNull();
    expect(m.ofi.fit!.beta).toBeGreaterThan(0);
    expect(m.ofi.fit!.r2).toBeGreaterThan(0.3);
    expect(m.ofi.intervals).toBeGreaterThanOrEqual(100);
  });

  it('Hawkes z unikalnych czasów bloków z transakcjami; pula pusta → null', () => {
    const e = new MicroEngine();
    expect(e.metrics(0).hawkes).toBeNull();
    let t = 0;
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
      t += Math.max(1, Math.round(-Math.log(rnd()) * 900));
      e.onTrades([{ px: '100000', sz: '0.1', side: 'B', time: t }, { px: '100000', sz: '0.2', side: 'B', time: t }]); // dwa fille w jednym bloku
    }
    e.refit(t);
    const h = e.metrics(t).hawkes!;
    expect(h.n).toBe(400); // zdarzenie = blok, nie fill
    expect(h.branching).toBeGreaterThanOrEqual(0);
    expect(h.branching).toBeLessThan(0.5); // proces Poissona → niski współczynnik rozgałęzienia
  });

  it('dodane/anulowane/wykonane w paśmie ±10 bp z ostatnich 5 min', () => {
    const e = new MicroEngine();
    e.onBook(book(0, 99_999.5, 10, 100_000.5, 4));
    e.onTrades([{ px: '99999.5', sz: '2', side: 'A', time: 500 }]);
    e.onBook(book(1000, 99_999.5, 3, 100_000.5, 9));
    const f = e.metrics(1000).flow5m;
    expect(f.bid).toEqual({ added: 0, cancelled: 5, executed: 2 });
    expect(f.ask).toEqual({ added: 5, cancelled: 0, executed: 0 });
  });

  it('mikrocena z bbo: średnia ważona i korekta z historii nierównowagi; dane starsze niż 30 min wypadają', () => {
    const e = new MicroEngine();
    e.onBbo(bbo(0, 99_999.5, 9, 100_000.5, 1));
    const m = e.metrics(0);
    expect(m.micro!.weighted).toBeCloseTo(100_000.4, 6);
    expect(m.micro!.mid).toBeCloseTo(100_000, 6);
    e.onBbo(bbo(40 * 60 * S, 99_999.5, 5, 100_000.5, 5));
    expect(e.metrics(40 * 60 * S).ofi.intervals).toBe(0);
  });

  it('transakcje powtórzone po ponownym połączeniu (ten sam tid) liczone raz', () => {
    const e = new MicroEngine();
    e.onBook(book(0, 99_999.5, 10, 100_000.5, 4));
    const tr = { px: '100000.5', sz: '2', side: 'B', time: 500, tid: 7 };
    e.onTrades([tr]);
    e.onTrades([tr]);
    e.onBook(book(1000, 99_999.5, 10, 100_000.5, 2));
    expect(e.metrics(1000).flow5m.ask).toEqual({ added: 0, cancelled: 0, executed: 2 });
  });

  it('transakcje przypisane do przedziału między migawkami wg znacznika czasu, nie kolejności przyjścia', () => {
    const e = new MicroEngine();
    e.onBook(book(0, 99_999.5, 10, 100_000.5, 4));
    // przychodzi przed migawką 1000, ale wykonana po niej → należy do następnego przedziału
    e.onTrades([{ px: '100000.5', sz: '2', side: 'B', time: 1500, tid: 1 }]);
    e.onBook(book(1000, 99_999.5, 10, 100_000.5, 4));
    expect(e.metrics(1000).flow5m.ask.executed).toBe(0);
    e.onBook(book(2000, 99_999.5, 10, 100_000.5, 2));
    expect(e.metrics(2000).flow5m.ask).toEqual({ added: 0, cancelled: 0, executed: 2 });
  });

  it('luka między migawkami (> 12 s, np. ponowne połączenie) — bez różnicowania przestarzałego arkusza', () => {
    const e = new MicroEngine();
    e.onBook(book(0, 99_999.5, 10, 100_000.5, 4));
    e.onBook(book(60 * S, 99_999.5, 1, 100_000.5, 4));
    expect(e.metrics(60 * S).flow5m.bid).toEqual({ added: 0, cancelled: 0, executed: 0 });
  });

  it('po zatrzymaniu kanału dane się przedawniają: metrics() przycina historię i oznacza nieświeże kwotowania', () => {
    const e = new MicroEngine();
    for (let t = 0; t < 400 * S; t += 2 * S) e.onBbo(bbo(t, 99_999.5, 5, 100_000.5, 5));
    expect(e.metrics(400 * S).stale).toBe(false);
    expect(e.metrics(420 * S).stale).toBe(true);
    const late = e.metrics(2 * 3600 * S);
    expect(late.ofi.intervals).toBe(0);
    expect(late.since).toBeNull();
  });

  it('korekta mikroceny dopiero po 10 min danych; R² liczone poza próbą', () => {
    const e = new MicroEngine();
    for (let t = 0; t <= 5 * 60 * S; t += 150) e.onBbo(bbo(t, 99_999.5, 5, 100_000.5, 5));
    expect(e.metrics(5 * 60 * S).micro!.adj).toBeNull();
    for (let t = 5 * 60 * S; t <= 11 * 60 * S; t += 150) e.onBbo(bbo(t, 99_999.5, 5, 100_000.5, 5));
    const mc = e.metrics(11 * 60 * S).micro!;
    expect(mc.adj).not.toBeNull();
    expect(mc.r2Oos).toBeDefined();
  });

  it('Hawkes dopiero od 300 bloków z transakcjami', () => {
    const e = new MicroEngine();
    for (let i = 1; i <= 200; i++) e.onTrades([{ px: '100000', sz: '0.1', side: 'B', time: i * 700, tid: i }]);
    e.refit(200 * 700);
    expect(e.metrics(200 * 700).hawkes).toBeNull();
  });

  it('arkusz l2Book nie wpływa na OFI (liczone z bbo), tylko na bilans dodań/anulowań', () => {
    const e = new MicroEngine();
    e.onBook(book(0, 99_999.5, 10, 100_000.5, 4));
    e.onBook(book(1000, 99_999.5, 30, 100_000.5, 4));
    expect(e.metrics(1000).micro).toBeNull();
    expect(e.metrics(1000).flow5m.bid.added).toBe(20);
  });
});
