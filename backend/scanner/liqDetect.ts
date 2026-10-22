import type { ScannedPosition } from '../../src/utils/liqMap.ts';
import type { LiqEvent, LiqTapeChecks } from '../../src/utils/liqTape.ts';

/**
 * Wykrywanie likwidacji śledzonych pozycji (Hyperliquid nie publikuje strumienia likwidacji wszystkich kont).
 *  1. Kandydat: ponowny odczyt pokazuje, że pozycja zmalała lub zniknęła, a cena z taśmy od poprzedniego odczytu
 *     dotknęła jej ceny likwidacji (tolerancja 0.2% — likwidację wyzwala cena mark, nie cena transakcji).
 *  2. Potwierdzenie: fille konta z tego okna (`userFillsByTime`) z polem `liquidation` (dokumentacja API: FillLiquidation).
 *     Bez takiego fillu to zwykłe zamknięcie przez właściciela.
 * Adresy zostają w pamięci procesu; zapisany stan i publikacja zawierają tylko zdarzenia bez adresów.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const PRICE_TOL = 0.002;
const CANDIDATE_TTL = 30 * MIN;
const MAX_ATTEMPTS = 3;
const MAX_QUEUE = 500;
/** Waga `userFillsByTime`: 20 + 1 na 20 zwróconych fillów (szacunek z zapasem) */
export const FILLS_WEIGHT = 25;

/** Minimum i maksimum ceny transakcji w kubełkach 1 min (24 h). */
export class PriceRange {
  private readonly mins = new Map<number, { lo: number; hi: number }>();

  record(px: number, t: number): void {
    if (!(px > 0) || !Number.isFinite(t)) return;
    const k = Math.floor(t / MIN);
    const m = this.mins.get(k);
    if (m) {
      if (px < m.lo) m.lo = px;
      if (px > m.hi) m.hi = px;
    } else {
      this.mins.set(k, { lo: px, hi: px });
      const cutoff = k - DAY / MIN;
      for (const key of this.mins.keys()) if (key < cutoff) this.mins.delete(key);
    }
  }

  range(from: number, to: number): { lo: number; hi: number } | null {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let k = Math.floor(from / MIN); k <= Math.floor(to / MIN); k++) {
      const m = this.mins.get(k);
      if (!m) continue;
      if (m.lo < lo) lo = m.lo;
      if (m.hi > hi) hi = m.hi;
    }
    return Number.isFinite(lo) ? { lo, hi } : null;
  }
}

/** Czy zmiana pozycji między odczytami może być likwidacją (do potwierdzenia fillami). */
export function isLiqCandidate(prev: ScannedPosition | null, next: ScannedPosition | null, range: { lo: number; hi: number } | null): boolean {
  if (!prev || prev.liqPx === null || !(prev.liqPx > 0) || !range) return false;
  const long = prev.szi > 0;
  const nextSzi = next?.szi ?? 0;
  const reduced = long ? nextSzi < prev.szi : nextSzi > prev.szi;
  if (!reduced) return false;
  return long ? range.lo <= prev.liqPx * (1 + PRICE_TOL) : range.hi >= prev.liqPx * (1 - PRICE_TOL);
}

/** Zdarzenie z danymi wewnętrznymi do deduplikacji (identyfikatory transakcji nie są publikowane). */
export type DetectedLiq = LiqEvent & { tids: number[] };

interface RawFill {
  coin?: unknown;
  px?: unknown;
  sz?: unknown;
  time?: unknown;
  tid?: unknown;
  liquidation?: { liquidatedUser?: unknown; markPx?: unknown; method?: unknown } | null;
}

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));

/** Fille likwidacyjne konta w danym rynku → jedno zdarzenie (rozmiar, VWAP, pierwszy czas); brak → null. */
export function parseLiquidationFills(fills: unknown, coin: string, addr: string, prev: ScannedPosition): DetectedLiq | null {
  if (!Array.isArray(fills)) return null;
  const own = (fills as RawFill[]).filter((f) => {
    if (!f || f.coin !== coin || !f.liquidation || typeof f.liquidation !== 'object') return false;
    const victim = f.liquidation.liquidatedUser;
    return victim === undefined || victim === null || String(victim).toLowerCase() === addr.toLowerCase();
  });
  let sz = 0;
  let ntl = 0;
  let t = Number.POSITIVE_INFINITY;
  let markPx = Number.NaN;
  let backstopSz = 0;
  const tids: number[] = [];
  for (const f of own) {
    const s = num(f.sz);
    const p = num(f.px);
    const time = num(f.time);
    if (!(s > 0) || !(p > 0) || !Number.isFinite(time)) continue;
    sz += s;
    ntl += s * p;
    if (time < t) {
      t = time;
      markPx = num(f.liquidation!.markPx);
    }
    if (f.liquidation!.method === 'backstop') backstopSz += s;
    if (typeof f.tid === 'number') tids.push(f.tid);
  }
  if (!(sz > 0)) return null;
  const px = ntl / sz;
  return {
    t,
    side: prev.szi > 0 ? 'long' : 'short',
    sz,
    px,
    usd: ntl,
    method: backstopSz > sz / 2 ? 'backstop' : 'market',
    markPx: markPx > 0 ? markPx : px,
    mapLiqPx: prev.liqPx,
    mapAgeMin: (t - prev.scannedAt) / MIN,
    tids: tids.sort((a, b) => a - b),
  };
}

export interface LiqCandidate {
  addr: string;
  /** Pozycja z poprzedniego odczytu (z ceną likwidacji znaną mapie) */
  prev: ScannedPosition;
  /** Czas odczytu, który wykazał zmniejszenie */
  to: number;
}

interface Queued extends LiqCandidate {
  attempts: number;
}

type Outcome = 'candidates' | 'confirmed' | 'rejected' | 'failed';

export interface InfoClient {
  info(body: unknown, weight: number): Promise<unknown | null>;
}

/** Kolejka potwierdzeń z własnym limitem zapytań na minutę (budżet wag współdzielony ze skanem pozycji). */
export class LiqConfirmer {
  private readonly coin: string;
  private readonly maxPerMin: number;
  private queue: Queued[] = [];
  private evs: DetectedLiq[] = [];
  private readonly seenTids = new Set<number>();
  private log: [Outcome, number][] = [];
  private calls: number[] = [];

  constructor(o: { coin: string; maxPerMin: number }) {
    this.coin = o.coin;
    this.maxPerMin = o.maxPerMin;
  }

  get pending(): number {
    return this.queue.length;
  }

  enqueue(c: LiqCandidate): void {
    this.log.push(['candidates', c.to]);
    this.queue.push({ ...c, attempts: 0 });
    while (this.queue.length > MAX_QUEUE) {
      const dropped = this.queue.shift()!;
      this.log.push(['failed', dropped.to]);
    }
  }

  /** Przetwarza kolejkę w ramach limitu na minutę; zwraca liczbę zapytań. */
  async process(rest: InfoClient, now: number): Promise<number> {
    this.calls = this.calls.filter((t) => t > now - MIN);
    let made = 0;
    const keep: Queued[] = [];
    for (const c of this.queue) {
      if (now - c.to > CANDIDATE_TTL) {
        this.log.push(['failed', now]);
        continue;
      }
      if (this.calls.length >= this.maxPerMin) {
        keep.push(c);
        continue;
      }
      this.calls.push(now);
      made++;
      const fills = await rest.info({ type: 'userFillsByTime', user: c.addr, startTime: c.prev.scannedAt - 1000, endTime: c.to + 1000 }, FILLS_WEIGHT);
      if (fills === null) {
        c.attempts++;
        if (c.attempts >= MAX_ATTEMPTS) this.log.push(['failed', now]);
        else keep.push(c);
        continue;
      }
      const ev = parseLiquidationFills(fills, this.coin, c.addr, c.prev);
      if (!ev) {
        this.log.push(['rejected', now]);
        continue;
      }
      this.log.push(['confirmed', now]);
      if (ev.tids.some((t) => this.seenTids.has(t))) continue;
      for (const t of ev.tids) this.seenTids.add(t);
      this.evs.push(ev);
    }
    this.queue = keep;
    return made;
  }

  events(): DetectedLiq[] {
    return this.evs;
  }

  checks(now: number): LiqTapeChecks {
    const out: LiqTapeChecks = { candidates: 0, confirmed: 0, rejected: 0, failed: 0 };
    for (const [k, t] of this.log) if (t > now - DAY) out[k]++;
    return out;
  }

  /** Usuwa zdarzenia i liczniki starsze niż 24 h. */
  prune(now: number): void {
    this.log = this.log.filter(([, t]) => t > now - DAY);
    const old = this.evs.filter((e) => e.t <= now - DAY);
    this.evs = this.evs.filter((e) => e.t > now - DAY);
    for (const e of old) for (const t of e.tids) this.seenTids.delete(t);
  }

  /** Stan na dysk serwera — bez adresów (kolejka kandydatów nie jest zapisywana). */
  toJSON(): { v: 1; events: DetectedLiq[]; log: [Outcome, number][] } {
    return { v: 1, events: this.evs, log: this.log };
  }

  static fromJSON(j: unknown, o: { coin: string; maxPerMin: number }): LiqConfirmer {
    const c = new LiqConfirmer(o);
    const x = j as { v?: number; events?: DetectedLiq[]; log?: [Outcome, number][] } | null;
    if (x?.v !== 1) return c;
    if (Array.isArray(x.events)) {
      for (const e of x.events) {
        if (!e || typeof e.t !== 'number' || !Array.isArray(e.tids)) continue;
        c.evs.push(e);
        for (const t of e.tids) c.seenTids.add(t);
      }
    }
    if (Array.isArray(x.log)) c.log = x.log.filter((r) => Array.isArray(r) && typeof r[1] === 'number' && ['candidates', 'confirmed', 'rejected', 'failed'].includes(r[0]));
    return c;
  }
}
