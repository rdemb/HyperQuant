import type { ScannedPosition } from '../../src/utils/liqMap.ts';

/**
 * Adresy widziane na taśmie BTC (pole `users` transakcji Hyperliquid) i harmonogram odpytywania ich pozycji.
 * Stan zostaje wyłącznie na serwerze (nigdy nie jest publikowany).
 *
 * Każde wywołanie `due` dzieli limit między trzy kolejki (niewykorzystany udział przechodzi dalej):
 *  1. pozycje (50%): termin z interwału wg nominału — ≥ 1 mln USD co 2 min, ≥ 100 tys. co 10 min, inne co 30 min,
 *     a przy cenie likwidacji < 1% od ceny mark co 1 min (< 3%: najwyżej co 2 min);
 *     kolejność wg spóźnienia względem interwału, więc przy przeciążeniu najdłużej czekają małe pozycje, nie duże;
 *     pozycja, której właściciel znów handlował, jest od razu do odświeżenia;
 *  2. adresy, które handlowały od ostatniego odczytu, w tym nowe (40%) — większy obrót pierwszy;
 *  3. bezpiecznik (10%): adres bez pozycji, który nie handlował, raz na 24 h.
 * Pozycja w BTC zmienia się tylko przez transakcję BTC (także likwidację), więc adresu bez pozycji nie trzeba
 * odpytywać, dopóki nie pojawi się znów na taśmie.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const TRADED_HALF_LIFE = DAY;
const SAFETY_RESCAN = DAY;
const RETRY_AFTER = MIN;

interface Rec {
  lastTradeAt: number;
  /** Obrót z wygaszaniem (połowa po 24 h), USD */
  tradedUsd: number;
  pos: ScannedPosition | null;
  lastScanAt: number | null;
  /** Handlował od ostatniego odczytu (albo nigdy nie był odczytany) */
  dirty: boolean;
  /** Po nieudanym odczycie: nie wcześniej niż */
  retryAt?: number;
  /** Ostatnio widziany w publicznym rankingu kont (zasiew) */
  seededAt?: number;
  /** Wartość konta z rankingu, USD */
  acct?: number;
}

const posNtl = (r: Rec) => (r.pos ? Math.abs(r.pos.szi) * r.pos.entryPx : 0);

/** Promocja przy cenie likwidacji tylko dla pozycji, które ważą na mapie (pył nie zużywa budżetu). */
const PROXIMITY_MIN_NTL = 25_000;

/**
 * Interwał odczytu pozycji: wg nominału, a blisko ceny likwidacji częściej — tam mapa musi być najświeższa
 * i tam powstają likwidacje do potwierdzenia (< 1% od ceny mark co 1 min, < 3% najwyżej co 2 min; od 25 tys. USD).
 */
function posInterval(r: Rec, markPx?: number): number {
  const ntl = posNtl(r);
  const base = ntl >= 1e6 ? 2 * MIN : ntl >= 1e5 ? 10 * MIN : 30 * MIN;
  const liq = r.pos?.liqPx;
  if (!markPx || !(markPx > 0) || !liq || ntl < PROXIMITY_MIN_NTL) return base;
  const dist = Math.abs(markPx - liq) / markPx;
  if (dist < 0.01) return MIN;
  if (dist < 0.03) return Math.min(base, 2 * MIN);
  return base;
}

export class AddressBook {
  private readonly recs = new Map<string, Rec>();
  readonly capacity: number;

  constructor(cap: number = 50_000) {
    this.capacity = cap;
  }

  get size(): number {
    return this.recs.size;
  }

  /** Liczba adresów obecnych w rankingu kont (diagnostyka; przetrwa restart, bo wynika ze stanu) */
  get seededCount(): number {
    let n = 0;
    for (const r of this.recs.values()) if (r.seededAt !== undefined) n++;
    return n;
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
        if (r.lastScanAt === null || t >= r.lastScanAt) r.dirty = true;
      } else {
        this.recs.set(a, { lastTradeAt: t, tradedUsd: ntlUsd, pos: null, lastScanAt: null, dirty: true });
        if (this.recs.size > this.capacity) this.evictOne(a);
      }
    }
  }

  /**
   * Zasiew z rankingu kont: nowy adres trafia do kolejki „handlowały” z priorytetem wg wartości konta.
   * Adres już znany nie jest ponownie oznaczany (ponowny zasiew co kilka godzin nie zalewa kolejki) — odświeżana jest
   * tylko obecność w rankingu, która chroni go przed czyszczeniem.
   */
  seed(addr: string, accountValueUsd: number, t: number): void {
    const known = this.recs.get(addr);
    if (known) {
      known.seededAt = t;
      known.acct = accountValueUsd;
      return;
    }
    this.recs.set(addr, { lastTradeAt: t, tradedUsd: accountValueUsd, pos: null, lastScanAt: null, dirty: true, seededAt: t, acct: accountValueUsd });
    if (this.recs.size > this.capacity) this.evictOne(addr);
  }

  updatePosition(addr: string, pos: ScannedPosition | null, t: number): void {
    const r = this.recs.get(addr) ?? { lastTradeAt: t, tradedUsd: 0, pos: null, lastScanAt: null, dirty: false };
    r.pos = pos;
    r.lastScanAt = t;
    r.dirty = false;
    delete r.retryAt;
    this.recs.set(addr, r);
  }

  /** Nieudany odczyt (błąd API): adres wraca do kolejki po minucie, żeby nie blokował innych. */
  markFailed(addr: string, now: number): void {
    const r = this.recs.get(addr);
    if (r) r.retryAt = now + RETRY_AFTER;
  }

  /** Wartość konta z publicznego rankingu (null = konto spoza rankingu). */
  accountValue(addr: string): number | null {
    return this.recs.get(addr)?.acct ?? null;
  }

  /** Wieloryb: pozycja w rynku ≥ 1 mln USD albo konto z rankingu ≥ 10 mln USD. */
  isWhale(addr: string): boolean {
    const r = this.recs.get(addr);
    if (!r) return false;
    return posNtl(r) >= 1e6 || (r.acct ?? 0) >= 10e6;
  }

  /**
   * Kandydaci warstwy wielorybów: `k` największych kont z rankingu (wartość konta malejąco), potem adresy z pozycją BTC
   * od 1 mln USD spoza tej listy (nominał malejąco).
   */
  whaleCandidates(k: number): string[] {
    const ranked = [...this.recs].filter(([, r]) => r.acct !== undefined).sort((x, y) => (y[1].acct ?? 0) - (x[1].acct ?? 0)).slice(0, k).map(([a]) => a);
    const top = new Set(ranked);
    const btc = [...this.recs].filter(([a, r]) => !top.has(a) && posNtl(r) >= 1e6).sort((x, y) => posNtl(y[1]) - posNtl(x[1])).map(([a]) => a);
    return [...ranked, ...btc];
  }

  /** Ostatnio odczytana pozycja adresu (null = brak pozycji albo adres nieznany). */
  positionOf(addr: string): ScannedPosition | null {
    return this.recs.get(addr)?.pos ?? null;
  }

  due(now: number, limit: number, markPx?: number): string[] {
    const positions: [string, number, number][] = []; // adres, spóźnienie względem interwału, nominał
    const traded: [string, number][] = [];
    const safety: [string, number][] = [];
    for (const [a, r] of this.recs) {
      if (r.retryAt !== undefined && r.retryAt > now) continue;
      if (r.pos && r.lastScanAt !== null) {
        const iv = posInterval(r, markPx);
        const late = (now - (r.lastScanAt + iv)) / iv;
        if (late >= 0 || r.dirty) positions.push([a, r.dirty ? Math.max(late, 1) : late, posNtl(r)]);
      } else if (r.dirty || r.lastScanAt === null) {
        traded.push([a, r.tradedUsd]);
      } else if (now - r.lastScanAt >= SAFETY_RESCAN) {
        safety.push([a, r.lastScanAt]);
      }
    }
    positions.sort((x, y) => y[1] - x[1] || y[2] - x[2]);
    traded.sort((x, y) => y[1] - x[1]);
    safety.sort((x, y) => x[1] - y[1]);

    const queues = [positions.map((p) => p[0]), traded.map((p) => p[0]), safety.map((p) => p[0])];
    const shares = [Math.ceil(limit * 0.5), Math.ceil(limit * 0.4), limit];
    const out: string[] = [];
    const taken = [0, 0, 0];
    for (let q = 0; q < 3; q++) {
      const n = Math.min(queues[q].length, shares[q], limit - out.length);
      out.push(...queues[q].slice(0, n));
      taken[q] = n;
    }
    // Niewykorzystany udział: dopełnienie z kolejek w kolejności ważności
    for (let q = 0; q < 3 && out.length < limit; q++) {
      const extra = queues[q].slice(taken[q], taken[q] + (limit - out.length));
      out.push(...extra);
    }
    return out;
  }

  positions(): ScannedPosition[] {
    const out: ScannedPosition[] = [];
    for (const r of this.recs.values()) if (r.pos) out.push(r.pos);
    return out;
  }

  /**
   * Usuwa adresy bez pozycji, nieaktywne na taśmie dłużej niż 3 dni — chyba że konto wciąż jest w rankingu
   * (inaczej co 3 dni tysiące kont wypadałyby i wracały z zasiewem, zużywając budżet na ponowne odczyty).
   */
  prune(now: number): void {
    for (const [a, r] of this.recs) {
      if (r.pos || now - r.lastTradeAt <= 3 * DAY) continue;
      if (r.seededAt !== undefined && now - r.seededAt <= 3 * DAY) continue;
      this.recs.delete(a);
    }
  }

  /**
   * Przepełnienie: odpada najdawniej aktywny adres bez pozycji (nie ten właśnie dodany); konta z rankingu dopiero,
   * gdy nie ma innych — inaczej nieaktywne duże konta wypadałyby pierwsze i wracały z zasiewem co 6 h.
   */
  private evictOne(keep: string): void {
    let victim: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    let ranked: string | null = null;
    let oldestRanked = Number.POSITIVE_INFINITY;
    for (const [a, r] of this.recs) {
      if (a === keep || r.pos) continue;
      if (r.seededAt !== undefined) {
        if (r.lastTradeAt < oldestRanked) {
          oldestRanked = r.lastTradeAt;
          ranked = a;
        }
      } else if (r.lastTradeAt < oldest) {
        oldest = r.lastTradeAt;
        victim = a;
      }
    }
    const out = victim ?? ranked;
    if (out !== null) this.recs.delete(out);
  }

  toJSON(): { v: 2; recs: [string, Rec][] } {
    return { v: 2, recs: [...this.recs] };
  }

  /** Odczyt stanu z dysku; limit adresów zawsze z bieżącej konfiguracji. */
  static fromJSON(j: unknown, cap?: number): AddressBook {
    const o = j as { v?: number; recs?: [string, Partial<Rec>][] } | null;
    const b = new AddressBook(cap);
    if ((o?.v === 1 || o?.v === 2) && Array.isArray(o.recs)) {
      for (const [a, r] of o.recs) {
        if (typeof a !== 'string' || !r) continue;
        b.recs.set(a, {
          lastTradeAt: r.lastTradeAt ?? 0,
          tradedUsd: r.tradedUsd ?? 0,
          pos: r.pos ?? null,
          lastScanAt: r.lastScanAt ?? null,
          dirty: r.dirty ?? r.lastScanAt == null,
          ...(typeof r.seededAt === 'number' ? { seededAt: r.seededAt } : {}),
          ...(typeof r.acct === 'number' ? { acct: r.acct } : {}),
        });
      }
    }
    return b;
  }
}
