import type { ScannedPosition } from '../../src/utils/liqMap.ts';

/**
 * Adresy widziane na taśmie BTC (pole `users` transakcji Hyperliquid) i harmonogram odpytywania ich pozycji.
 * Nowy adres — od razu (większy obrót pierwszy). Potem interwał zależy od nominału pozycji: duże pozycje zmieniają
 * mapę najbardziej, więc są odświeżane najczęściej. Stan zostaje wyłącznie na serwerze (nigdy nie jest publikowany).
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const TRADED_HALF_LIFE = DAY;

interface Rec {
  lastTradeAt: number;
  /** Obrót z wygaszaniem (połowa po 24 h), USD */
  tradedUsd: number;
  pos: ScannedPosition | null;
  lastScanAt: number | null;
}

function intervalMs(r: Rec): number {
  if (!r.pos) return 120 * MIN;
  const ntl = Math.abs(r.pos.szi) * r.pos.entryPx;
  if (ntl >= 1e6) return 2 * MIN;
  if (ntl >= 1e5) return 10 * MIN;
  return 30 * MIN;
}

const dueAt = (r: Rec) => (r.lastScanAt === null ? 0 : r.lastScanAt + intervalMs(r));
const posNtl = (r: Rec) => (r.pos ? Math.abs(r.pos.szi) * r.pos.entryPx : 0);

export class AddressBook {
  private readonly recs = new Map<string, Rec>();
  private readonly cap: number;

  constructor(cap: number = 50_000) {
    this.cap = cap;
  }

  get size(): number {
    return this.recs.size;
  }

  has(addr: string): boolean {
    return this.recs.has(addr);
  }

  recordTrade(users: [string, string], ntlUsd: number, t: number): void {
    for (const a of users) {
      const r = this.recs.get(a);
      if (r) {
        r.tradedUsd = r.tradedUsd * Math.pow(0.5, Math.max(0, t - r.lastTradeAt) / TRADED_HALF_LIFE) + ntlUsd;
        r.lastTradeAt = Math.max(r.lastTradeAt, t);
      } else {
        this.recs.set(a, { lastTradeAt: t, tradedUsd: ntlUsd, pos: null, lastScanAt: null });
        if (this.recs.size > this.cap) this.evictOne(a);
      }
    }
  }

  updatePosition(addr: string, pos: ScannedPosition | null, t: number): void {
    const r = this.recs.get(addr) ?? { lastTradeAt: t, tradedUsd: 0, pos: null, lastScanAt: null };
    r.pos = pos;
    r.lastScanAt = t;
    this.recs.set(addr, r);
  }

  /** Adresy do odpytania teraz: najpierw najdłużej czekające, przy remisie większa pozycja / obrót. */
  due(now: number, limit: number): string[] {
    const out: [string, Rec][] = [];
    for (const e of this.recs) if (dueAt(e[1]) <= now) out.push(e);
    out.sort((x, y) => dueAt(x[1]) - dueAt(y[1]) || posNtl(y[1]) - posNtl(x[1]) || y[1].tradedUsd - x[1].tradedUsd);
    return out.slice(0, limit).map(([a]) => a);
  }

  positions(): ScannedPosition[] {
    const out: ScannedPosition[] = [];
    for (const r of this.recs.values()) if (r.pos) out.push(r.pos);
    return out;
  }

  /** Usuwa adresy bez pozycji, nieaktywne na taśmie dłużej niż 3 dni. */
  prune(now: number): void {
    for (const [a, r] of this.recs) if (!r.pos && now - r.lastTradeAt > 3 * DAY) this.recs.delete(a);
  }

  /** Przepełnienie: odpada najdawniej aktywny adres bez pozycji (nie ten właśnie dodany). */
  private evictOne(keep: string): void {
    let victim: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [a, r] of this.recs) {
      if (a === keep || r.pos) continue;
      if (r.lastTradeAt < oldest) {
        oldest = r.lastTradeAt;
        victim = a;
      }
    }
    if (victim !== null) this.recs.delete(victim);
  }

  toJSON(): { v: 1; cap: number; recs: [string, Rec][] } {
    return { v: 1, cap: this.cap, recs: [...this.recs] };
  }

  static fromJSON(j: unknown): AddressBook {
    const o = j as { v?: number; cap?: number; recs?: [string, Rec][] } | null;
    const b = new AddressBook(typeof o?.cap === 'number' ? o.cap : undefined);
    if (o?.v === 1 && Array.isArray(o.recs)) for (const [a, r] of o.recs) if (typeof a === 'string' && r) b.recs.set(a, r);
    return b;
  }
}
