import type { ScannedPosition } from '../../src/utils/liqMap.ts';
import { type LiqEvent, type LiqTapeChecks, inTapeDay, isLiqEvent } from '../../src/utils/liqTape.ts';

/**
 * Wykrywanie likwidacji śledzonych pozycji (Hyperliquid nie publikuje strumienia likwidacji wszystkich kont).
 *  1. Kandydat: ponowny odczyt pokazuje, że pozycja zmalała lub zniknęła, a cena z taśmy od poprzedniego odczytu
 *     dotknęła pasma ceny likwidacji: do 0.5% przed poziomem z mapy (likwidacja wcześniejsza — np. strata konta cross
 *     na innym rynku) i dowolnie za nim. Likwidację wyzwala cena mark, nie cena transakcji.
 *  2. Potwierdzenie: fille konta od pierwszego dotknięcia pasma (`userFillsByTime`) z polem `liquidation`
 *     (dokumentacja API: FillLiquidation). Bez takiego fillu to zwykłe zamknięcie przez właściciela.
 * Adresy zostają na serwerze; publikacja zawiera tylko zdarzenia bez adresów.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Pasmo „wcześniej niż mapa” — szersze pasmo = więcej zapytań o zwykłe zamknięcia blisko ceny likwidacji */
export const EARLY_TOL = 0.005;
/**
 * Kandydat czeka na potwierdzenie do 24 h (całe okno taśmy): przy kolejce albo wycofaniu API nie przepada po kilkunastu
 * minutach jako „nieudany”, tylko trafia na taśmę później, z czasem samej likwidacji.
 */
const CANDIDATE_TTL = DAY;
const MAX_ATTEMPTS = 3;
const MAX_QUEUE = 500;
/** Tempo potwierdzeń rośnie z kolejką tak, by przerobić ją w ~10 min, najwyżej do 12 zapytań na minutę */
const QUEUE_DRAIN_MIN = 10;
const MAX_PER_MIN_CAP = 12;
/** Wartość kandydata: nominał pozycji przy cenie likwidacji (kolejność kolejki i suma czekających), USD */
const candidateUsd = (c: LiqCandidate): number => Math.abs(c.prev.szi) * (c.prev.liqPx ?? c.prev.entryPx);
/** Rezerwacja wag `userFillsByTime` przed zapytaniem; resztę (20 + 1 na 20 fillów) dopłaca się po odpowiedzi */
export const FILLS_WEIGHT = 25;
/** Limit fillów w jednej odpowiedzi API — pełna odpowiedź może być obcięta */
const FILLS_CAP = 2000;

type Side = 'long' | 'short';
const inBand = (lo: number, hi: number, liqPx: number, side: Side) => (side === 'long' ? lo <= liqPx * (1 + EARLY_TOL) : hi >= liqPx * (1 - EARLY_TOL));

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

  /** Początek pierwszej minuty w oknie, w której cena weszła w pasmo ceny likwidacji; null = nie weszła. */
  firstTouch(from: number, to: number, liqPx: number, side: Side): number | null {
    for (let k = Math.floor(from / MIN); k <= Math.floor(to / MIN); k++) {
      const m = this.mins.get(k);
      if (m && inBand(m.lo, m.hi, liqPx, side)) return k * MIN;
    }
    return null;
  }

  toJSON(): { v: 1; mins: [number, number, number][] } {
    return { v: 1, mins: [...this.mins].map(([k, m]) => [k, m.lo, m.hi]) };
  }

  static fromJSON(j: unknown): PriceRange {
    const r = new PriceRange();
    const x = j as { v?: number; mins?: unknown } | null;
    if (x?.v !== 1 || !Array.isArray(x.mins)) return r;
    for (const row of x.mins) {
      if (!Array.isArray(row) || row.length !== 3 || !row.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const [k, lo, hi] = row as [number, number, number];
      if (lo > 0 && hi >= lo) r.mins.set(k, { lo, hi });
    }
    return r;
  }
}

/** Czy zmiana pozycji między odczytami może być likwidacją (do potwierdzenia fillami). */
export function isLiqCandidate(prev: ScannedPosition | null, next: ScannedPosition | null, range: { lo: number; hi: number } | null): boolean {
  if (!prev || prev.liqPx === null || !(prev.liqPx > 0) || !range) return false;
  const long = prev.szi > 0;
  const nextSzi = next?.szi ?? 0;
  const reduced = long ? nextSzi < prev.szi : nextSzi > prev.szi;
  return reduced && inBand(range.lo, range.hi, prev.liqPx, long ? 'long' : 'short');
}

/**
 * Zdarzenie z danymi wewnętrznymi: identyfikatory transakcji (deduplikacja) i chwila potwierdzenia (opóźnienie taśmy);
 * żadne z nich nie jest publikowane.
 */
export type DetectedLiq = LiqEvent & { tids: number[]; foundAt?: number };

interface RawFill {
  coin?: unknown;
  px?: unknown;
  sz?: unknown;
  time?: unknown;
  tid?: unknown;
  liquidation?: { liquidatedUser?: unknown; markPx?: unknown; method?: unknown } | null;
}

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));

/**
 * Fille likwidacyjne konta w danym rynku → jedno zdarzenie (rozmiar, VWAP, pierwszy czas); brak → null.
 * Fille o identyfikatorach z `seen` (już zaliczone do wcześniejszego zdarzenia) są pomijane pojedynczo —
 * likwidacja w kilku krokach w nakładających się oknach daje osobne zdarzenia bez podwójnego liczenia.
 */
export function parseLiquidationFills(fills: unknown, coin: string, addr: string, prev: ScannedPosition, seen?: ReadonlySet<number>): DetectedLiq | null {
  if (!Array.isArray(fills)) return null;
  const own = (fills as RawFill[]).filter((f) => {
    if (!f || f.coin !== coin || !f.liquidation || typeof f.liquidation !== 'object') return false;
    if (seen && typeof f.tid === 'number' && seen.has(f.tid)) return false;
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
  /** Początek okna fillów: pierwsze dotknięcie pasma ceny likwidacji (z zapasem), nie wcześniej niż poprzedni odczyt */
  from: number;
  /** Czas odczytu, który wykazał zmniejszenie */
  to: number;
}

interface Queued extends LiqCandidate {
  attempts: number;
}

/**
 * Wyniki bez zdarzenia, wg czasu sprawdzenia. Potwierdzenia nie mają wpisu: liczone są ze zdarzeń wg czasu likwidacji,
 * bo wykrycie przy starym odczycie pozycji bywa godziny po likwidacji i licznik rozjechałby się z taśmą.
 * Wpisy „confirmed” ze starego stanu są przy odczycie pomijane.
 */
type Outcome = 'rejected' | 'failed';
const OUTCOMES: readonly string[] = ['rejected', 'failed'];
/** Przyczyna nieudanego sprawdzenia; wpisy ze stanu sprzed 13.11.2026 jej nie mają („unknown” w licznikach). */
type FailReason = 'overflow' | 'ttl' | 'api' | 'truncated';
const FAIL_REASONS: readonly string[] = ['overflow', 'ttl', 'api', 'truncated'];
/** Wpis dziennika wyników: rodzaj, czas, przyczyna (tylko failed, inaczej null), wartość pozycji przy cenie likwidacji (USD) */
type LogEntry = [Outcome, number] | [Outcome, number, FailReason | null, number];

export interface InfoClient {
  info(body: unknown, weight: number): Promise<unknown | null>;
  /** Dopłata wag po odpowiedzi */
  charge?(weight: number): void;
  /** false = API w wycofaniu po błędach — potwierdzenia czekają, skan pozycji ma pierwszeństwo */
  healthy?(): boolean;
}

/**
 * Kolejka potwierdzeń: najpierw największe pozycje, tempo bazowe `maxPerMin` rosnące z długością kolejki (do 12/min),
 * kandydat ważny 24 h.
 */
export class LiqConfirmer {
  private readonly coin: string;
  private readonly maxPerMin: number;
  private queue: Queued[] = [];
  private evs: DetectedLiq[] = [];
  private readonly seenTids = new Set<number>();
  private log: LogEntry[] = [];
  private calls: number[] = [];
  /** Początek bieżącego okresu obserwacji (ostatnie dropBefore): taśma ma tylko zdarzenia od tej chwili */
  private floor = Number.NEGATIVE_INFINITY;

  constructor(o: { coin: string; maxPerMin: number }) {
    this.coin = o.coin;
    this.maxPerMin = o.maxPerMin;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Kandydaci czekający na potwierdzenie i ich wartość (do udziału niepotwierdzonych przy sumach taśmy). */
  backlog(): { pending: number; pendingUsd: number } {
    return { pending: this.queue.length, pendingUsd: this.queue.reduce((s, c) => s + candidateUsd(c), 0) };
  }

  enqueue(c: LiqCandidate): void {
    this.queue.push({ ...c, attempts: 0 });
    // Przepełnienie: odpada najmniejsza pozycja (na taśmie waży najmniej), nie najstarszy kandydat
    while (this.queue.length > MAX_QUEUE) {
      let k = 0;
      for (let i = 1; i < this.queue.length; i++) if (candidateUsd(this.queue[i]) < candidateUsd(this.queue[k])) k = i;
      const [gone] = this.queue.splice(k, 1);
      this.log.push(['failed', c.to, 'overflow', candidateUsd(gone)]);
    }
  }

  /** Przetwarza kolejkę w ramach limitu na minutę; zwraca liczbę zapytań. */
  async process(rest: InfoClient, now: number): Promise<number> {
    this.calls = this.calls.filter((t) => t > now - MIN);
    if (rest.healthy && !rest.healthy()) {
      this.expire(now);
      return 0;
    }
    let made = 0;
    const keep: Queued[] = [];
    const perMin = Math.min(MAX_PER_MIN_CAP, Math.max(this.maxPerMin, Math.ceil(this.queue.length / QUEUE_DRAIN_MIN)));
    // Najpierw największe pozycje; przy równej wartości starszy kandydat
    this.queue.sort((a, b) => candidateUsd(b) - candidateUsd(a) || a.to - b.to);
    for (const c of this.queue) {
      if (now - c.to > CANDIDATE_TTL) {
        this.log.push(['failed', now, 'ttl', candidateUsd(c)]);
        continue;
      }
      if (this.calls.length >= perMin) {
        keep.push(c);
        continue;
      }
      this.calls.push(now);
      made++;
      const fills = await rest.info({ type: 'userFillsByTime', user: c.addr, startTime: c.from - 1000, endTime: c.to + 1000 }, FILLS_WEIGHT);
      if (!Array.isArray(fills)) {
        // Błąd sieci/API albo nieoczekiwany kształt — nie wiadomo, czy była likwidacja
        c.attempts++;
        if (c.attempts >= MAX_ATTEMPTS) this.log.push(['failed', now, 'api', candidateUsd(c)]);
        else keep.push(c);
        continue;
      }
      rest.charge?.(20 + Math.ceil(fills.length / 20) - FILLS_WEIGHT);
      if (fills.length >= FILLS_CAP) {
        // Odpowiedź mogła zostać obcięta — brak fillu likwidacyjnego niczego nie dowodzi
        this.log.push(['failed', now, 'truncated', candidateUsd(c)]);
        continue;
      }
      const ev = parseLiquidationFills(fills, this.coin, c.addr, c.prev, this.seenTids);
      if (ev && ev.t < this.floor) {
        // Kandydat z oknem przez granicę okresu, likwidacja sprzed niej: należy do odrzuconego okresu — bez zdarzenia
        // i bez odrzucenia
      } else if (ev) {
        for (const t of ev.tids) this.seenTids.add(t);
        this.evs.push({ ...ev, foundAt: now });
      } else if (!parseLiquidationFills(fills, this.coin, c.addr, c.prev)) {
        this.log.push(['rejected', now, null, candidateUsd(c)]);
      }
      // Same już zaliczone fille: ta sama likwidacja co wcześniej — bez ponownego liczenia
    }
    this.queue = keep;
    return made;
  }

  /** Przeterminowanie kandydatów bez zapytań (gdy API jest przeciążone). */
  private expire(now: number): void {
    const keep: Queued[] = [];
    for (const c of this.queue) {
      if (now - c.to > CANDIDATE_TTL) this.log.push(['failed', now, 'ttl', candidateUsd(c)]);
      else keep.push(c);
    }
    this.queue = keep;
  }

  events(): DetectedLiq[] {
    return this.evs;
  }

  /**
   * Liczniki z 24 h; kandydaci = rozstrzygnięci (potwierdzeni + zamknięcia + nieudani). Potwierdzeni = zdarzenia w oknie
   * taśmy (to samo kryterium co zdarzenia i sumy), więc zdarzenie usunięte z okna, przez `dropBefore` albo przy odczycie
   * stanu znika też z licznika.
   */
  checks(now: number): LiqTapeChecks {
    const out: LiqTapeChecks = { candidates: 0, confirmed: 0, rejected: 0, failed: 0 };
    const by = { overflow: 0, ttl: 0, api: 0, truncated: 0, unknown: 0 };
    let failedUsd = 0;
    let rejectedUsd = 0;
    for (const r of this.log) {
      const [k, t] = r;
      if (!(t > now - DAY)) continue;
      out[k]++;
      const usd = r.length === 4 ? r[3] : 0;
      if (k === 'failed') {
        by[r.length === 4 && r[2] ? r[2] : 'unknown']++;
        failedUsd += usd;
      } else rejectedUsd += usd;
    }
    out.confirmed = this.evs.filter((e) => inTapeDay(e.t, now)).length;
    out.candidates = out.confirmed + out.rejected + out.failed;
    return { ...out, failedBy: by, failedUsd: Math.round(failedUsd), rejectedUsd: Math.round(rejectedUsd) };
  }

  /** Usuwa zdarzenia i liczniki starsze niż 24 h oraz zdarzenia z przyszłości (uszkodzony stan, zły zegar). */
  prune(now: number): void {
    this.log = this.log.filter(([, t]) => t > now - DAY);
    this.keepEvents((e) => e.t > now - DAY && e.t <= now + 5 * MIN);
  }

  /**
   * Nowy okres obserwacji od `t` (start, przerwa w danych): usuwa zdarzenia sprzed `t` i kandydatów z odczytem sprzed `t`
   * (bez zapytań i bez liczników — należą do odrzuconego okresu); później `process` nie dopisuje zdarzeń sprzed `t`.
   * Zwraca liczbę usuniętych kandydatów (do logu).
   */
  dropBefore(t: number): number {
    this.floor = Math.max(this.floor, t);
    this.keepEvents((e) => e.t >= t);
    const n = this.queue.length;
    this.queue = this.queue.filter((c) => c.to >= t);
    return n - this.queue.length;
  }

  private keepEvents(pred: (e: DetectedLiq) => boolean): void {
    const out = this.evs.filter((e) => !pred(e));
    this.evs = this.evs.filter(pred);
    for (const e of out) for (const t of e.tids) this.seenTids.delete(t);
  }

  /**
   * Stan na dysk serwera (nigdy nie jest publikowany): zdarzenia, liczniki i kolejka kandydatów. Kolejka ma adresy kont,
   * jak księga adresów w tym samym katalogu stanu; bez niej restart gubił kandydatów, których ponowny odczyt pozycji już
   * nie wykryje (pozycja jest zapisana po zmniejszeniu), a taśma traciła te likwidacje.
   */
  toJSON(): { v: 1; events: DetectedLiq[]; log: LogEntry[]; queue: Queued[] } {
    return { v: 1, events: this.evs, log: this.log, queue: this.queue };
  }

  /**
   * `since`: początek okresu obserwacji po odczycie (ciągły albo nowy po przerwie) — kandydaci z odczytem sprzed niego znikają
   * bez wpisu (należą do odrzuconego okresu); dopiero pozostałych sprawdza TTL: starsi niż CANDIDATE_TTL w chwili `now`
   * idą do licznika nieudanych.
   */
  static fromJSON(j: unknown, o: { coin: string; maxPerMin: number; now?: number; since?: number }): LiqConfirmer {
    const c = new LiqConfirmer(o);
    const x = j as { v?: number; events?: unknown[]; log?: unknown[]; queue?: unknown[] } | null;
    if (x?.v !== 1) return c;
    if (Array.isArray(x.events)) {
      for (const e of x.events) {
        if (!isLiqEvent(e)) continue;
        const tids = (e as Partial<DetectedLiq>).tids;
        if (!Array.isArray(tids) || !tids.every((t) => typeof t === 'number' && Number.isFinite(t))) continue;
        c.evs.push(e as DetectedLiq);
        for (const t of tids) c.seenTids.add(t);
      }
    }
    if (Array.isArray(x.log)) {
      // Wpis stary [rodzaj, czas] albo nowy [rodzaj, czas, przyczyna|null, wartość USD]
      c.log = x.log.filter(
        (r): r is LogEntry =>
          Array.isArray(r) &&
          OUTCOMES.includes(r[0]) &&
          finite(r[1]) &&
          (r.length === 2 || (r.length === 4 && (r[2] === null || FAIL_REASONS.includes(r[2])) && finite(r[3]) && r[3] >= 0))
      );
    }
    // Kolejka kandydatów (pole opcjonalne; starszy stan bez niej = pusta kolejka): tylko poprawne wpisy, najwyżej
    // MAX_QUEUE; kandydat starszy niż CANDIDATE_TTL w chwili odczytu idzie do licznika nieudanych, nie do kolejki
    if (Array.isArray(x.queue))
      for (const q of x.queue) {
        if (!isQueued(q)) continue;
        if (o.since !== undefined && q.to < o.since) continue;
        if (o.now !== undefined && o.now - q.to > CANDIDATE_TTL) c.log.push(['failed', o.now, 'ttl', candidateUsd(q)]);
        else if (c.queue.length < MAX_QUEUE) c.queue.push(q);
      }
    return c;
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Wpis kolejki ze stanu na dysku: adres konta, poprzednia pozycja z rozmiarem i ceną, okno fillów, liczba prób */
function isQueued(q: unknown): q is Queued {
  const o = q as Partial<Queued> | null;
  if (!o || typeof o !== 'object' || typeof o.addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(o.addr)) return false;
  const p = o.prev as Partial<ScannedPosition> | undefined;
  if (!p || !finite(p.szi) || !finite(p.entryPx) || !finite(p.scannedAt)) return false;
  if (!(p.liqPx === null || p.liqPx === undefined || (finite(p.liqPx) && p.liqPx > 0))) return false;
  return finite(o.from) && finite(o.to) && o.from <= o.to && Number.isInteger(o.attempts) && (o.attempts as number) >= 0;
}
