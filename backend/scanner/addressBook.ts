import type { ScannedPosition } from '../../src/utils/liqMap.ts';

/**
 * Adresy widziane na taśmie BTC (pole `users` transakcji Hyperliquid) i harmonogram odpytywania ich pozycji.
 * Stan zostaje wyłącznie na serwerze (nigdy nie jest publikowany).
 *
 * Każde wywołanie `due` wypełnia cały limit (limiter wag i tak ogranicza tempo), bez terminów i bez kolejki, która
 * mogłaby kogoś zagłodzić — priorytet każdej kolejki rośnie z czasem czekania:
 *  0. gwarancja: konta, które razem trzymają górną połowę skanowanego nominału (dziś ok. 50), najpóźniej co 3 min,
 *     przed udziałami (ok. 17 odczytów/min) — mediana wieku ważona nominałem (`ageNtlP50Min`) zostaje kilka minut;
 *  1. konta po transakcji (60% reszty): handlowały od ostatniego odczytu (także nowe i te z pozycją) — priorytet
 *     (czas od ostatniego odczytu) × √wartość (nominał pozycji albo obrót); nowy adres: czas od pierwszej transakcji
 *     + 1 min; konto czekające od pierwszej transakcji 15 min i dłużej idzie na początek tej kolejki (najdłużej
 *     czekające pierwsze). Małe konto czeka dłużej niż duże, ale nie bez końca (ważne dla taśmy likwidacji:
 *     zlikwidowane małe konto to konto po transakcji);
 *  2. pozycje bez transakcji (30%): wiek × √nominał × bliskość ceny likwidacji (8× przy < 1% od ceny mark, 4× przy
 *     < 3%; tylko pozycje od 25 tys. USD);
 *  3. bezpiecznik (10%): adres bez pozycji, który nie handlował, raz na 24 h.
 * Niewykorzystany udział przechodzi do kolejnych kolejek w tej kolejności.
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
  /** Pierwsza transakcja od ostatniego odczytu (brak: nie handlował, np. konto tylko z zasiewu) */
  dirtyAt?: number;
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
/** Konta z górnej połowy nominału: odczyt najpóźniej po tym czasie, przed udziałami kolejek */
const TOP_HALF_MAX_AGE = 3 * MIN;
/** Konto po transakcji czekające dłużej: na początek kolejki „po transakcji”, najdłużej czekające pierwsze */
const TRADED_MAX_WAIT = 15 * MIN;
const SHARE_TRADED = 0.6;
const SHARE_POSITIONS = 0.3;

/**
 * Mnożnik priorytetu blisko ceny likwidacji — tam mapa musi być najświeższa i tam powstają likwidacje do potwierdzenia:
 * 8 przy < 1% od ceny mark, 4 przy < 3%; tylko pozycje od 25 tys. USD i przy znanej cenie mark.
 */
function proximity(r: Rec, markPx?: number): number {
  const liq = r.pos?.liqPx;
  if (!markPx || !(markPx > 0) || !liq || posNtl(r) < PROXIMITY_MIN_NTL) return 1;
  const dist = Math.abs(markPx - liq) / markPx;
  return dist < 0.01 ? 8 : dist < 0.03 ? 4 : 1;
}

/**
 * Adresy `k` najwyższych wyników, malejąco (przy remisie wcześniejszy pierwszy), bez sortowania całej listy —
 * `due` wybiera kilkanaście adresów z kilkudziesięciu tysięcy przy każdej porcji odczytów.
 */
function bestOf(items: readonly [string, number][], k: number): [string, number][] {
  const top: [string, number][] = [];
  if (k <= 0) return top;
  for (const it of items) {
    if (top.length === k && it[1] <= top[k - 1][1]) continue;
    let i = Math.min(top.length, k - 1);
    if (top.length === k) top.pop();
    while (i > 0 && top[i - 1][1] < it[1]) i--;
    top.splice(i, 0, it);
  }
  return top;
}

const best = (items: readonly [string, number][], k: number): string[] => bestOf(items, k).map(([a]) => a);

/** Adresy największych pozycji, które razem trzymają co najmniej połowę nominału `total` (malejąco). */
function topHalf(held: readonly [string, number][], total: number): string[] {
  for (let k = 64; ; k *= 4) {
    const big = bestOf(held, k);
    const out: string[] = [];
    let cum = 0;
    for (const [a, ntl] of big) {
      if (cum >= total / 2) break;
      cum += ntl;
      out.push(a);
    }
    if (cum >= total / 2 || big.length < k) return out;
  }
}

/** Kwantyl z interpolacją (jak `ageMin` mapy). */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
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
        if (r.lastScanAt === null || t >= r.lastScanAt) {
          r.dirty = true;
          r.dirtyAt = Math.min(r.dirtyAt ?? t, t);
        }
      } else {
        this.recs.set(a, { lastTradeAt: t, tradedUsd: ntlUsd, pos: null, lastScanAt: null, dirty: true, dirtyAt: t });
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
    delete r.dirtyAt;
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

  /** Do `limit` adresów do odczytu teraz (kolejność i udziały w opisie klasy). */
  due(now: number, limit: number, markPx?: number): string[] {
    if (limit <= 0) return [];
    const held: [string, number][] = []; // adres, nominał (do gwarancji górnej połowy)
    let total = 0;
    const overdue: [string, number][] = []; // adres, czekanie od pierwszej transakcji (≥ 15 min)
    const traded: [string, number][] = []; // adres, (czas od odczytu) × √wartość
    const positions: [string, number][] = []; // adres, wiek × √nominał × bliskość ceny likwidacji
    const safety: [string, number][] = []; // adres, czas od odczytu
    for (const [a, r] of this.recs) {
      const ntl = posNtl(r);
      if (r.pos && r.lastScanAt !== null) {
        held.push([a, ntl]);
        total += ntl;
      }
      if (r.retryAt !== undefined && r.retryAt > now) continue;
      if (r.dirty || r.lastScanAt === null) {
        const since = now - (r.dirtyAt ?? r.lastTradeAt);
        if (since >= TRADED_MAX_WAIT) {
          overdue.push([a, since]);
          continue;
        }
        const wait = r.lastScanAt === null ? since + MIN : now - r.lastScanAt;
        traded.push([a, Math.max(0, wait) * Math.sqrt(Math.max(ntl, r.tradedUsd, 1))]);
      } else if (r.pos) {
        positions.push([a, (now - r.lastScanAt) * Math.sqrt(ntl) * proximity(r, markPx)]);
      } else if (now - r.lastScanAt >= SAFETY_RESCAN) {
        safety.push([a, now - r.lastScanAt]);
      }
    }
    // 0. Gwarancja: konta z górnej połowy nominału czytane dawniej niż 3 min temu, najdawniej czytane pierwsze
    const late: [string, number][] = []; // adres, wiek
    for (const a of topHalf(held, total)) {
      const r = this.recs.get(a)!;
      const age = now - (r.lastScanAt ?? now);
      if (age >= TOP_HALF_MAX_AGE && !(r.retryAt !== undefined && r.retryAt > now)) late.push([a, age]);
    }
    const top = best(late, limit);
    const rest = limit - top.length;
    if (rest === 0) return top;
    // Kolejki bez kont już wybranych przez gwarancję (wybór z zapasem o ich liczbę)
    const inTop = new Set(top);
    const pick = (items: [string, number][], k: number) => best(items, k + top.length).filter((a) => !inTop.has(a)).slice(0, k);
    const lead = pick(overdue, rest);
    const queues = [[...lead, ...pick(traded, rest - lead.length)], pick(positions, rest), pick(safety, rest)];
    const shares = [Math.ceil(rest * SHARE_TRADED), Math.ceil(rest * SHARE_POSITIONS), rest];
    const out: string[] = [];
    const taken = [0, 0, 0];
    for (let q = 0; q < 3; q++) {
      const n = Math.min(queues[q].length, shares[q], rest - out.length);
      out.push(...queues[q].slice(0, n));
      taken[q] = n;
    }
    // Niewykorzystany udział: dopełnienie z kolejek w kolejności ważności
    for (let q = 0; q < 3 && out.length < rest; q++) out.push(...queues[q].slice(taken[q], taken[q] + (rest - out.length)));
    return [...top, ...out];
  }

  /**
   * Konta po transakcji jeszcze bez odczytu (`dirty` w status.json): liczba i czas od pierwszej transakcji po ostatnim
   * odczycie (p50, p90, min). Konta tylko z zasiewu (bez transakcji) się nie liczą.
   */
  dirtyStats(now: number): { n: number; waitP50Min: number; waitP90Min: number } {
    const waits: number[] = [];
    for (const r of this.recs.values()) if (r.dirty && r.dirtyAt !== undefined) waits.push((now - r.dirtyAt) / MIN);
    waits.sort((a, b) => a - b);
    return { n: waits.length, waitP50Min: quantile(waits, 0.5), waitP90Min: quantile(waits, 0.9) };
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
        const dirty = r.dirty ?? r.lastScanAt == null;
        b.recs.set(a, {
          lastTradeAt: r.lastTradeAt ?? 0,
          tradedUsd: r.tradedUsd ?? 0,
          pos: r.pos ?? null,
          lastScanAt: r.lastScanAt ?? null,
          dirty,
          // Stan sprzed pola `dirtyAt`: czekanie od ostatniej transakcji (przybliżenie do pierwszego odczytu)
          ...(typeof r.dirtyAt === 'number' ? { dirtyAt: r.dirtyAt } : dirty && r.seededAt === undefined ? { dirtyAt: r.lastTradeAt ?? 0 } : {}),
          ...(typeof r.seededAt === 'number' ? { seededAt: r.seededAt } : {}),
          ...(typeof r.acct === 'number' ? { acct: r.acct } : {}),
        });
      }
    }
    return b;
  }
}
