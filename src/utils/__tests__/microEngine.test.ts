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

  it('arkusz l2Book nie wpływa na OFI (liczone z bbo), tylko na bilans dodań/anulowań', () => {
    const e = new MicroEngine();
    e.onBook(book(0, 99_999.5, 10, 100_000.5, 4));
    e.onBook(book(1000, 99_999.5, 30, 100_000.5, 4));
    expect(e.metrics(1000).micro).toBeNull();
    expect(e.metrics(1000).flow5m.bid.added).toBe(20);
  });
});
