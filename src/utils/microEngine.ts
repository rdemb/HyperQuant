import {
  type AbsorptionEvent,
  type BookSide,
  type FlowParts,
  type HawkesFit,
  type OlsFit,
  absorption,
  addCancel,
  fitHawkes,
  imbalanceAdjustment,
  ofiEvent,
  olsFit,
  weightedMid,
} from './microMechanics';

/**
 * Silnik mechaniki mikrostruktury zasilany surowymi migawkami arkusza (WS `l2Book`) i taśmą (WS `trades`) Hyperliquid.
 * Historia tylko od otwarcia strony (publiczne API nie udostępnia historii arkusza), maks. 30 min.
 */

const BUCKET = 10_000;
const KEEP = 30 * 60_000;
const FLOW_WINDOW = 5 * 60_000;
const FLOW_BAND_BPS = 10;
const MICRO_HORIZON = 5_000;
const MAX_EVENTS = 3000;

type RawLevel = { px: string; sz: string; n?: number };

export interface MicroMetrics {
  /** OFI (CKS) w interwałach 10 s i regresja ΔP = α + β·OFI */
  ofi: { fit: OlsFit | null; intervals: number; last: number | null; lastZ: number | null; implied: number | null; points: { x: number; y: number }[] };
  hawkes: (HawkesFit & { at: number }) | null;
  micro: { mid: number; weighted: number; imb: number; adj: number | null; r2: number | null; samples: number } | null;
  /** Dodane / anulowane / wykonane w paśmie ±10 bp, ostatnie 5 min (BTC) */
  flow5m: { bid: FlowParts; ask: FlowParts };
  absorption: { lambda: number | null; r2: number | null; events: AbsorptionEvent[] };
  /** Pierwsza migawka arkusza w historii (od otwarcia strony) */
  since: number | null;
}

interface Bucket {
  ofi: number;
  /** Mid na ostatniej migawce w kubełku */
  mid: number | null;
  /** Podpisany wolumen agresora, BTC */
  vol: number;
}

const zero = (): FlowParts => ({ added: 0, cancelled: 0, executed: 0 });

export class MicroEngine {
  private book: { t: number; bids: BookSide[]; asks: BookSide[] } | null = null;
  private buckets = new Map<number, Bucket>();
  private snaps: { t: number; mid: number; imb: number }[] = [];
  private flows: { t: number; bid: FlowParts; ask: FlowParts }[] = [];
  private tradesSinceBook: { px: number; sz: number; side: 'buy' | 'sell' }[] = [];
  private eventTimes: number[] = [];
  private hawkes: (HawkesFit & { at: number }) | null = null;
  private since: number | null = null;

  private bucket(t: number): Bucket {
    const k = Math.floor(t / BUCKET);
    let b = this.buckets.get(k);
    if (!b) {
      b = { ofi: 0, mid: null, vol: 0 };
      this.buckets.set(k, b);
    }
    return b;
  }

  onBook(msg: { time?: number; levels: [RawLevel[], RawLevel[]] }): void {
    const t = typeof msg.time === 'number' ? msg.time : Date.now();
    const parse = (rows: RawLevel[]) =>
      rows
        .slice(0, 20)
        .map((r) => ({ px: parseFloat(r.px), sz: parseFloat(r.sz) }))
        .filter((l) => Number.isFinite(l.px) && Number.isFinite(l.sz) && l.px > 0);
    const bids = parse(msg.levels[0] ?? []);
    const asks = parse(msg.levels[1] ?? []);
    if (!bids.length || !asks.length || bids[0].px >= asks[0].px) return;
    const cur = { t, bids, asks };
    const mid = (bids[0].px + asks[0].px) / 2;
    const b = this.bucket(t);
    if (this.book) {
      const p = this.book;
      b.ofi += ofiEvent(
        { bid: p.bids[0].px, bidSz: p.bids[0].sz, ask: p.asks[0].px, askSz: p.asks[0].sz },
        { bid: bids[0].px, bidSz: bids[0].sz, ask: asks[0].px, askSz: asks[0].sz }
      );
      const f = addCancel(p, cur, this.tradesSinceBook, mid, FLOW_BAND_BPS);
      this.flows.push({ t, ...f });
    }
    b.mid = mid;
    const tot = bids[0].sz + asks[0].sz;
    this.snaps.push({ t, mid, imb: tot > 0 ? bids[0].sz / tot : 0.5 });
    this.tradesSinceBook = [];
    this.book = cur;
    if (this.since === null) this.since = t;
    this.prune(t);
  }

  onTrades(raw: { px: string; sz: string; side: string; time: number }[]): void {
    for (const r of raw) {
      const px = parseFloat(r.px);
      const sz = parseFloat(r.sz);
      if (!(px > 0) || !(sz > 0) || !Number.isFinite(r.time)) continue;
      const side = r.side === 'B' ? 'buy' : 'sell';
      this.tradesSinceBook.push({ px, sz, side });
      this.bucket(r.time).vol += side === 'buy' ? sz : -sz;
      // Zdarzenie procesu Hawkesa = blok z transakcjami (fille jednego bloku mają ten sam czas)
      if (this.eventTimes[this.eventTimes.length - 1] !== r.time) this.eventTimes.push(r.time);
    }
    if (this.eventTimes.length > MAX_EVENTS) this.eventTimes.splice(0, this.eventTimes.length - MAX_EVENTS);
  }

  private prune(now: number): void {
    const minKey = Math.floor((now - KEEP) / BUCKET);
    for (const k of this.buckets.keys()) if (k < minKey) this.buckets.delete(k);
    const cut = now - KEEP;
    let i = 0;
    while (i < this.snaps.length && this.snaps[i].t < cut) i++;
    if (i) this.snaps.splice(0, i);
    let j = 0;
    while (j < this.flows.length && this.flows[j].t < now - FLOW_WINDOW) j++;
    if (j) this.flows.splice(0, j);
    if (this.since !== null && this.since < cut) this.since = this.snaps[0]?.t ?? null;
  }

  /** Dopasowanie Hawkesa (sekundy) na ostatnich zdarzeniach — kosztowne; najwyżej co 25 s niezależnie od liczby widoków. */
  refit(now: number): void {
    if (this.hawkes && now - this.hawkes.at < 25_000) return;
    const times = this.eventTimes.filter((t) => t >= now - KEEP).map((t) => t / 1000);
    const f = fitHawkes(times);
    this.hawkes = f ? { ...f, at: now } : null;
  }

  /** Interwały zamknięte z Δmid względem poprzedniego (kolejnego) kubełka. */
  private intervals(now: number): { t: number; ofi: number; dmid: number; vol: number }[] {
    const keys = [...this.buckets.keys()].sort((a, b) => a - b);
    const out: { t: number; ofi: number; dmid: number; vol: number }[] = [];
    const nowKey = Math.floor(now / BUCKET);
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      if (k >= nowKey) break; // bieżący kubełek jeszcze otwarty
      const prev = this.buckets.get(keys[i - 1])!;
      const cur = this.buckets.get(k)!;
      if (keys[i - 1] !== k - 1 || prev.mid === null || cur.mid === null) continue;
      out.push({ t: k * BUCKET, ofi: cur.ofi, dmid: cur.mid - prev.mid, vol: cur.vol });
    }
    return out;
  }

  metrics(now: number): MicroMetrics {
    const iv = this.intervals(now);
    const fit = olsFit(
      iv.map((i) => i.ofi),
      iv.map((i) => i.dmid)
    );
    const last = iv.length ? iv[iv.length - 1].ofi : null;
    const mO = iv.length ? iv.reduce((a, i) => a + i.ofi, 0) / iv.length : 0;
    const sO = iv.length > 1 ? Math.sqrt(iv.reduce((a, i) => a + (i.ofi - mO) ** 2, 0) / (iv.length - 1)) : 0;

    let micro: MicroMetrics['micro'] = null;
    if (this.book) {
      const b = this.book;
      const mid = (b.bids[0].px + b.asks[0].px) / 2;
      const tot = b.bids[0].sz + b.asks[0].sz;
      const imb = tot > 0 ? b.bids[0].sz / tot : 0.5;
      // Pary (nierównowaga teraz, zmiana mid po 5 s) z historii migawek
      const samples: { imb: number; dmid: number }[] = [];
      let j = 0;
      for (let i = 0; i < this.snaps.length; i++) {
        const s = this.snaps[i];
        if (j < i) j = i;
        while (j < this.snaps.length && this.snaps[j].t < s.t + MICRO_HORIZON) j++;
        if (j >= this.snaps.length) break;
        samples.push({ imb: s.imb, dmid: this.snaps[j].mid - s.mid });
      }
      const adj = imbalanceAdjustment(samples, 10);
      const g = adj.g[Math.min(9, Math.floor(imb * 10))];
      micro = {
        mid,
        weighted: weightedMid(b.bids[0].px, b.bids[0].sz, b.asks[0].px, b.asks[0].sz),
        imb,
        adj: samples.length >= 200 && g !== null ? g : null,
        r2: samples.length >= 200 ? adj.r2 : null,
        samples: samples.length,
      };
    }

    const flow5m = { bid: zero(), ask: zero() };
    for (const f of this.flows) {
      if (f.t < now - FLOW_WINDOW) continue;
      for (const side of ['bid', 'ask'] as const) {
        flow5m[side].added += f[side].added;
        flow5m[side].cancelled += f[side].cancelled;
        flow5m[side].executed += f[side].executed;
      }
    }
    const r8 = (x: number) => Math.round(x * 1e8) / 1e8;
    for (const side of ['bid', 'ask'] as const) for (const k of ['added', 'cancelled', 'executed'] as const) flow5m[side][k] = r8(flow5m[side][k]);

    const abs = iv.length >= 30 ? absorption(iv.map((i) => ({ t: i.t, signedVol: i.vol, dmid: i.dmid }))) : { lambda: null, r2: null, events: [] };

    return {
      ofi: {
        fit: iv.length >= 30 ? fit : null,
        intervals: iv.length,
        last,
        lastZ: last !== null && sO > 0 ? (last - mO) / sO : null,
        implied: last !== null && fit && iv.length >= 30 ? fit.alpha + fit.beta * last : null,
        points: iv.slice(-180).map((i) => ({ x: i.ofi, y: i.dmid })),
      },
      hawkes: this.hawkes,
      micro,
      flow5m,
      absorption: abs,
      since: this.since,
    };
  }
}

/** Wspólny silnik dla strony (zasilany z jednego połączenia WebSocket desku). */
export const microEngine = new MicroEngine();
