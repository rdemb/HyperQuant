import { COHORTS, type CohortCell, type CohortFlow, type CohortId, type CohortMarkout, type CohortTotal, ROUND_USD } from '../../src/utils/cohorts.ts';

/**
 * Przepływ kohort z publicznej taśmy BTC Hyperliquid (pole `users` + strona agresora) — tylko strumień WebSocket, zero zapytań REST.
 *
 * Kohorty (rozłączne, w tej kolejności):
 *  1. market makerzy — ≥ 80% nominału jako maker i ≥ 1 mln USD nominału maker (z wygaszaniem, połowa po 7 dniach);
 *  2. poinformowani — markout biorcy po 5 min istotnie dodatni. Obserwacja testu = blok 5 min adresu (średnia ważona
 *     nominałem jego transakcji biorcy w bloku), więc jedno zlecenie zamiatające wielu makerów to jedna obserwacja, nie
 *     dziesiątki prawie identycznych. Test jednostronny na adresach z ≥ 30 blokami, kontrola FDR Benjaminiego–Hochberga
 *     (q = 0.10) i dodatnia średnia a posteriori w empirycznym Bayesie (normalny–normalny);
 *  3. wieloryby — wg książki adresów (pozycja ≥ 1 mln USD albo konto z rankingu ≥ 10 mln USD);
 *  4. reszta.
 * Klasyfikacja pochodzi wyłącznie z markoutów już rozliczonych, a kohorta transakcji jest ustalana w chwili transakcji —
 * markouty publikowane per kohorta są więc poza próbą.
 *
 * Prywatność (suma kohort w kubełku to publiczny wolumen z taśmy, więc ukrycie jednej komórki nie wystarcza):
 *  - publikowane są tylko kubełki zamknięte; widoczność ustalana raz, przy zamknięciu (bez różnicowania kolejnych publikacji);
 *  - k-anonimowość z regułą dominacji + ukrywanie wtórne (`suppress`) osobno dla wszystkich fillów i dla warstwy biorcy;
 *  - kwoty zaokrąglone do 10 tys. USD; liczności do dziesiątek; markouty tylko z w pełni rozliczonych godzin,
 *    każda godzina z bramką k-anonimowości biorców.
 * Adresy, statystyki per adres i przynależność zostają na serwerze.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BUCKET = 15 * MIN;
/** Kubełek finalizowany 30 s po zamknięciu (transakcje z WebSocket mogą przyjść z opóźnieniem) */
const CLOSE_LAG = 30_000;
const BLOCK = 5 * MIN;
const HALF_LIFE = 7 * DAY;
export const HORIZONS_MIN = [1, 5, 60] as const;
const SETTLE_LAG = 2000;
export const K_MIN = 5;
const DOMINANCE = 0.5;
const MM_MAKER_SHARE = 0.8;
const MM_MIN_USD = 1e6;
export const INFORMED_MIN_N = 30;
export const FDR_Q = 0.1;
const MAX_STATS = 100_000;

// ——— statystyka ———

/** erfc z błędem względnym < 1.2e-7 (Numerical Recipes, przybliżenie Czebyszewa). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

/** P(Z > z) dla Z ~ N(0, 1). */
export function normalSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

/** Procedura Benjaminiego–Hochberga: wybrane hipotezy przy kontroli FDR na poziomie q. */
export function benjaminiHochberg(p: number[], q: number): boolean[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  let k = 0;
  order.forEach(([v], r) => {
    if (v <= ((r + 1) / m) * q) k = r + 1;
  });
  const out = Array<boolean>(m).fill(false);
  for (let r = 0; r < k; r++) out[order[r][1]] = true;
  return out;
}

/** Rozkład a priori średnich N(μ₀, τ²) metodą momentów: τ² = średni kwadrat odchylenia − średni kwadrat błędu standardowego. */
export function ebPrior(means: number[], se2: number[]): { mu0: number; tau2: number } {
  const n = means.length;
  if (n === 0) return { mu0: 0, tau2: 0 };
  const mu0 = means.reduce((a, b) => a + b, 0) / n;
  const msd = means.reduce((a, b) => a + (b - mu0) ** 2, 0) / n;
  const mse = se2.reduce((a, b) => a + b, 0) / n;
  return { mu0, tau2: Math.max(0, msd - mse) };
}

export interface InformedRow {
  addr: string;
  /** Efektywna liczba obserwacji (bloków 5 min, z wygaszaniem) */
  n: number;
  /** Średni markout, bp */
  mean: number;
  /** Wariancja markoutów, bp² */
  variance: number;
}

/** Wybór „poinformowanych”: BH na p-wartościach testu jednostronnego ∧ dodatnia średnia a posteriori (empiryczny Bayes). */
export function selectInformed(
  rows: InformedRow[],
  o: { minN: number; q: number; vif?: number }
): { selected: Set<string>; candidates: number; mu0: number | null; tau2: number | null } {
  const cand = rows.filter((r) => r.n >= o.minN && r.variance > 0 && Number.isFinite(r.mean));
  if (cand.length === 0) return { selected: new Set(), candidates: 0, mu0: null, tau2: null };
  // Korekta wariancji: horyzonty 5 min sąsiednich bloków częściowo się nakładają (np. TWAP w trendzie) — konserwatywnie ×2
  const vif = o.vif ?? 2;
  const se2 = cand.map((r) => (vif * r.variance) / r.n);
  const p = cand.map((r, i) => normalSf(r.mean / Math.sqrt(se2[i])));
  const bh = benjaminiHochberg(p, o.q);
  const { mu0, tau2 } = ebPrior(
    cand.map((r) => r.mean),
    se2
  );
  const selected = new Set<string>();
  cand.forEach((r, i) => {
    const post = tau2 + se2[i] > 0 ? (tau2 * r.mean + se2[i] * mu0) / (tau2 + se2[i]) : mu0;
    if (bh[i] && post > 0) selected.add(r.addr);
  });
  return { selected, candidates: cand.length, mu0, tau2 };
}

// ——— prywatność ———

function layerStats(maps: Map<string, number>[]): { k: number; maxShare: number; gross: number } {
  const merged = new Map<string, number>();
  for (const m of maps) for (const [a, v] of m) merged.set(a, (merged.get(a) ?? 0) + v);
  let gross = 0;
  let max = 0;
  for (const v of merged.values()) {
    gross += v;
    if (v > max) max = v;
  }
  return { k: merged.size, maxShare: gross > 0 ? max / gross : 0, gross };
}

const unsafe = (s: { k: number; maxShare: number }) => s.k < K_MIN || s.maxShare > DOMINANCE;

/**
 * Widoczność komórek jednej warstwy (true = widoczna). Ukrywanie pierwotne: k < 5 albo uczestnik > 50% obrotu.
 * Ukrywanie wtórne: suma komórek w kubełku jest publiczna, więc przy jednej ukrytej (albo gdy suma ukrytych wciąż łamie
 * warunki) ukrywana jest kolejna aktywna komórka — dla „poinformowanych” najpierw „reszta”, poza tym najmniejszy obrót —
 * aż suma ukrytych spełnia k i dominację albo ukryte jest wszystko. Komórki bez aktywności (zera) niczego nie ujawniają.
 */
export function suppress(parts: Record<CohortId, Map<string, number>>): Record<CohortId, boolean> {
  const st = Object.fromEntries(COHORTS.map((c) => [c, layerStats([parts[c]])])) as Record<CohortId, ReturnType<typeof layerStats>>;
  const active = COHORTS.filter((c) => st[c].gross > 0);
  const hidden = active.filter((c) => unsafe(st[c]));
  if (hidden.length > 0) {
    while (hidden.length < active.length && (hidden.length === 1 || unsafe(layerStats(hidden.map((c) => parts[c]))))) {
      // „Poinformowanych” parujemy najpierw z „resztą”: MM i wieloryby da się odtworzyć z danych publicznych i odjąć od sumy
      const left = active.filter((c) => !hidden.includes(c));
      const next = hidden.includes('informed') && left.includes('rest') ? 'rest' : left.sort((a, b) => st[a].gross - st[b].gross)[0];
      hidden.push(next);
    }
  }
  return Object.fromEntries(COHORTS.map((c) => [c, !hidden.includes(c)])) as Record<CohortId, boolean>;
}

const roundUsd = (v: number) => Math.round(v / ROUND_USD) * ROUND_USD;
const floorTens = (n: number) => Math.floor(n / 10) * 10;

// ——— ceny ———

/** Ostatnia cena transakcji w każdej sekundzie (2 h) — do markoutów. */
export class SecondPrices {
  private readonly px = new Map<number, number>();
  private newest = Number.NEGATIVE_INFINITY;

  record(px: number, t: number): void {
    if (!(px > 0) || !Number.isFinite(t)) return;
    const s = Math.floor(t / 1000);
    this.px.set(s, px);
    if (s > this.newest) this.newest = s;
    if (this.px.size > 9000) for (const k of this.px.keys()) if (k < this.newest - 7200) this.px.delete(k);
  }

  /** Ostatnia cena nie później niż t (szukanie do 60 s wstecz); null = brak. */
  priceAt(t: number): number | null {
    const s = Math.floor(t / 1000);
    for (let k = s; k >= s - 60; k--) {
      const v = this.px.get(k);
      if (v !== undefined) return v;
    }
    return null;
  }
}

// ——— silnik ———

interface Stats {
  /** Nominał jako maker / biorca, USD (wygaszany) */
  mk: number;
  tk: number;
  /** Bloki 5 min z markoutem biorcy: liczba, suma, suma kwadratów (wygaszane) */
  n: number;
  s: number;
  ss: number;
  /** Czas ostatniego wygaszenia */
  at: number;
}

interface OpenCell {
  buy: number;
  sell: number;
  takerBuy: number;
  takerSell: number;
  /** Obrót uczestników: wszystkie fille / tylko jako biorca */
  all: Map<string, number>;
  taker: Map<string, number>;
}

interface Bucket {
  /** Kubełek otwarty (z obrotami uczestników) — null po finalizacji */
  open: Record<CohortId, OpenCell> | null;
  /** Wartości dokładne komórek widocznych po finalizacji (null = ukryta) */
  pub: Record<CohortId, CohortCell | null> | null;
}

interface Pending {
  t: number;
  px: number;
  dir: 1 | -1;
  usd: number;
  addr: string;
  cohort: CohortId;
}

interface OosAcc {
  w: number[];
  wm: number[];
  n5: number;
  usd5: number;
  /** Biorcy w tej godzinie (do bramki k-anonimowości) — null po finalizacji */
  takers: Map<string, number> | null;
  /** Wynik bramki po finalizacji godziny */
  ok: boolean | null;
}

export interface CohortTrade {
  users: [string, string];
  side: 'B' | 'A';
  px: number;
  sz: number;
  time: number;
}

type Meta = { candidates: number; selected: number; mu0: number | null; tau2: number | null; at: number | null };
const EMPTY_META: Meta = { candidates: 0, selected: 0, mu0: null, tau2: null, at: null };

const newOpenCell = (): OpenCell => ({ buy: 0, sell: 0, takerBuy: 0, takerSell: 0, all: new Map(), taker: new Map() });
const newOpen = (): Record<CohortId, OpenCell> => ({ mm: newOpenCell(), informed: newOpenCell(), whale: newOpenCell(), rest: newOpenCell() });
const newOos = (): Record<CohortId, OosAcc> => {
  const o = {} as Record<CohortId, OosAcc>;
  for (const c of COHORTS) o[c] = { w: [0, 0, 0], wm: [0, 0, 0], n5: 0, usd5: 0, takers: new Map(), ok: null };
  return o;
};
const zeroCounts = (): Record<CohortId, number> => ({ mm: 0, informed: 0, whale: 0, rest: 0 });

function decay(st: Stats, now: number): void {
  if (now <= st.at) return;
  const f = Math.pow(0.5, (now - st.at) / HALF_LIFE);
  st.mk *= f;
  st.tk *= f;
  st.n *= f;
  st.s *= f;
  st.ss *= f;
  st.at = now;
}

export class CohortEngine {
  private readonly coin: string;
  private readonly isWhale: (addr: string) => boolean;
  private readonly maxStats: number;
  private stats = new Map<string, Stats>();
  private lastActive = new Map<string, number>();
  private mm = new Set<string>();
  private informed = new Set<string>();
  private meta: Meta = { ...EMPTY_META };
  private members: Record<CohortId, number> = zeroCounts();
  private buckets = new Map<number, Bucket>();
  private readonly prices = new SecondPrices();
  private queues: Pending[][] = [[], [], []];
  private oos = new Map<number, Record<CohortId, OosAcc>>();
  private blocks = new Map<string, { blk: number; w: number; wm: number }>();

  constructor(o: { coin: string; isWhale: (addr: string) => boolean; maxStats?: number }) {
    this.coin = o.coin;
    this.isWhale = o.isWhale;
    this.maxStats = o.maxStats ?? MAX_STATS;
  }

  get statsSize(): number {
    return this.stats.size;
  }

  /** Efektywna liczba obserwacji testu „poinformowanych” (bloki 5 min) dla adresu — diagnostyka/testy. */
  informedObservations(addr: string): number {
    return this.stats.get(addr)?.n ?? 0;
  }

  cohortOf(addr: string): CohortId {
    if (this.mm.has(addr)) return 'mm';
    if (this.informed.has(addr)) return 'informed';
    if (this.isWhale(addr)) return 'whale';
    return 'rest';
  }

  recordPrice(px: number, t: number): void {
    this.prices.record(px, t);
  }

  private stat(addr: string, t: number): Stats {
    let st = this.stats.get(addr);
    if (!st) {
      st = { mk: 0, tk: 0, n: 0, s: 0, ss: 0, at: t };
      this.stats.set(addr, st);
    } else decay(st, t);
    return st;
  }

  onTrade(tr: CohortTrade): void {
    const [buyer, seller] = tr.users ?? [];
    if (typeof buyer !== 'string' || typeof seller !== 'string' || buyer === seller) return;
    if (!(tr.px > 0) || !(tr.sz > 0) || !Number.isFinite(tr.time) || (tr.side !== 'B' && tr.side !== 'A')) return;
    const usd = tr.px * tr.sz;
    this.prices.record(tr.px, tr.time);
    const cb = this.cohortOf(buyer);
    const cs = this.cohortOf(seller);
    const takerIsBuyer = tr.side === 'B';
    const taker = takerIsBuyer ? buyer : seller;
    const maker = takerIsBuyer ? seller : buyer;

    const bt = Math.floor(tr.time / BUCKET) * BUCKET;
    let b = this.buckets.get(bt);
    if (!b) {
      b = { open: newOpen(), pub: null };
      this.buckets.set(bt, b);
    }
    // Transakcja spóźniona do kubełka już sfinalizowanego nie zmienia opublikowanych wartości
    if (b.open) {
      const add = (m: Map<string, number>, a: string) => m.set(a, (m.get(a) ?? 0) + usd);
      b.open[cb].buy += usd;
      add(b.open[cb].all, buyer);
      b.open[cs].sell += usd;
      add(b.open[cs].all, seller);
      const ct = takerIsBuyer ? cb : cs;
      if (takerIsBuyer) b.open[ct].takerBuy += usd;
      else b.open[ct].takerSell += usd;
      add(b.open[ct].taker, taker);
    }

    this.stat(taker, tr.time).tk += usd;
    this.stat(maker, tr.time).mk += usd;
    this.lastActive.set(buyer, tr.time);
    this.lastActive.set(seller, tr.time);

    const p: Pending = { t: tr.time, px: tr.px, dir: takerIsBuyer ? 1 : -1, usd, addr: taker, cohort: takerIsBuyer ? cb : cs };
    for (const q of this.queues) q.push(p);
  }

  /** Rozlicza markouty, których horyzont minął (cena z sekundy t + h); bloki 5 min adresów → obserwacje testu. */
  settle(now: number): void {
    HORIZONS_MIN.forEach((h, i) => {
      const q = this.queues[i];
      let n = 0;
      while (n < q.length && q[n].t + h * MIN + SETTLE_LAG <= now) n++;
      for (const p of q.splice(0, n)) {
        const later = this.prices.priceAt(p.t + h * MIN);
        if (later === null) continue;
        const m = ((p.dir * (later - p.px)) / p.px) * 1e4;
        const hourKey = Math.floor(p.t / HOUR);
        let acc = this.oos.get(hourKey);
        if (!acc) {
          acc = newOos();
          this.oos.set(hourKey, acc);
        }
        const a = acc[p.cohort];
        if (a.ok !== null) continue; // godzina już sfinalizowana
        a.w[i] += p.usd;
        a.wm[i] += p.usd * m;
        if (h === 5) {
          a.n5++;
          a.usd5 += p.usd;
          a.takers?.set(p.addr, (a.takers.get(p.addr) ?? 0) + p.usd);
          this.addToBlock(p, m, now);
        }
      }
    });
    for (const [addr, blk] of this.blocks) {
      if ((blk.blk + 1) * BLOCK + 5 * MIN + SETTLE_LAG + 1000 <= now) {
        this.addObservation(addr, blk, now);
        this.blocks.delete(addr);
      }
    }
  }

  private addToBlock(p: Pending, m: number, now: number): void {
    const blk = Math.floor(p.t / BLOCK);
    let cur = this.blocks.get(p.addr);
    if (cur && cur.blk !== blk) {
      this.addObservation(p.addr, cur, now);
      cur = undefined;
    }
    if (!cur) {
      cur = { blk, w: 0, wm: 0 };
      this.blocks.set(p.addr, cur);
    }
    cur.w += p.usd;
    cur.wm += p.usd * m;
  }

  private addObservation(addr: string, blk: { w: number; wm: number }, now: number): void {
    if (!(blk.w > 0)) return;
    const m = blk.wm / blk.w;
    const st = this.stat(addr, now);
    st.n += 1;
    st.s += m;
    st.ss += m * m;
  }

  /** Finalizacja zamkniętych kubełków i rozliczonych godzin, usuwanie danych starszych niż 24 h. */
  housekeep(now: number): void {
    for (const [t, b] of this.buckets) {
      if (t + BUCKET <= now - DAY) {
        this.buckets.delete(t);
        continue;
      }
      if (b.open && t + BUCKET + CLOSE_LAG <= now) {
        const o = b.open;
        const visAll = suppress(Object.fromEntries(COHORTS.map((c) => [c, o[c].all])) as Record<CohortId, Map<string, number>>);
        const visTaker = suppress(Object.fromEntries(COHORTS.map((c) => [c, o[c].taker])) as Record<CohortId, Map<string, number>>);
        b.pub = Object.fromEntries(
          COHORTS.map((c) => [
            c,
            visAll[c]
              ? { buy: o[c].buy, sell: o[c].sell, takerBuy: visTaker[c] ? o[c].takerBuy : null, takerSell: visTaker[c] ? o[c].takerSell : null }
              : null,
          ])
        ) as Record<CohortId, CohortCell | null>;
        b.open = null;
      }
    }
    for (const [h, acc] of this.oos) {
      // 27 h zapasu: okno publikacji to 24 ostatnie sfinalizowane godziny
      if (h * HOUR < now - 27 * HOUR) {
        this.oos.delete(h);
        continue;
      }
      if ((h + 1) * HOUR + 60 * MIN + 10_000 > now || acc.rest.ok !== null) continue;
      // Ta sama reguła co w kubełkach (k, dominacja, ukrywanie wtórne między kohortami) na biorcach godziny
      const vis = suppress(Object.fromEntries(COHORTS.map((c) => [c, acc[c].takers ?? new Map()])) as Record<CohortId, Map<string, number>>);
      for (const c of COHORTS) {
        acc[c].ok = acc[c].n5 > 0 && vis[c];
        acc[c].takers = null;
      }
    }
  }

  /** Klasyfikacja kohort z danych dotychczasowych (co kilka minut), liczności kohort, czyszczenie i limit statystyk. */
  classify(now: number): void {
    const mm = new Set<string>();
    const rows: InformedRow[] = [];
    for (const [a, st] of this.stats) {
      decay(st, now);
      const idle = now - (this.lastActive.get(a) ?? st.at);
      if ((idle > 7 * DAY && st.n < 1 && st.mk + st.tk < 1e4) || idle > 30 * DAY) {
        this.stats.delete(a);
        continue;
      }
      if (st.mk >= MM_MIN_USD && st.mk / (st.mk + st.tk) >= MM_MAKER_SHARE) {
        mm.add(a);
        continue;
      }
      if (st.n > 0) {
        const mean = st.s / st.n;
        rows.push({ addr: a, n: st.n, mean, variance: Math.max(0, st.ss / st.n - mean * mean) });
      }
    }
    if (this.stats.size > this.maxStats) {
      const byAge = [...this.stats.keys()].sort((x, y) => (this.lastActive.get(x) ?? 0) - (this.lastActive.get(y) ?? 0));
      for (const a of byAge.slice(0, this.stats.size - this.maxStats)) this.stats.delete(a);
    }
    for (const [a, t] of this.lastActive) if (now - t > 30 * DAY) this.lastActive.delete(a);
    if (this.lastActive.size > 2 * this.maxStats) {
      const byAge = [...this.lastActive].sort((x, y) => x[1] - y[1]);
      for (const [a] of byAge.slice(0, this.lastActive.size - 2 * this.maxStats)) this.lastActive.delete(a);
    }

    const inf = selectInformed(
      rows.filter((r) => this.stats.has(r.addr)),
      { minN: INFORMED_MIN_N, q: FDR_Q }
    );
    this.mm = mm;
    this.informed = inf.selected;
    this.meta = { candidates: inf.candidates, selected: inf.selected.size, mu0: inf.mu0, tau2: inf.tau2, at: now };
    const members = zeroCounts();
    for (const [a, t] of this.lastActive) if (t > now - DAY) members[this.cohortOf(a)]++;
    this.members = members;
  }

  build(now: number, since: number): CohortFlow {
    const sinceB = Math.floor(since / BUCKET) * BUCKET;
    const h1From = Math.floor(now / BUCKET) * BUCKET - HOUR;
    const total = (): CohortTotal => ({ buy: 0, sell: 0, takerBuy: 0, takerSell: 0, hidden: 0, takerHidden: 0 });
    const h1 = { mm: total(), informed: total(), whale: total(), rest: total() };
    const h24 = { mm: total(), informed: total(), whale: total(), rest: total() };
    const rounded = (c: CohortCell | null): CohortCell | null =>
      c && {
        buy: roundUsd(c.buy),
        sell: roundUsd(c.sell),
        takerBuy: c.takerBuy === null ? null : roundUsd(c.takerBuy),
        takerSell: c.takerSell === null ? null : roundUsd(c.takerSell),
      };
    const buckets = [...this.buckets.entries()]
      .filter(([t, b]) => b.pub !== null && t >= sinceB && t > now - DAY)
      .sort((a, b) => a[0] - b[0])
      .map(([t, b]) => {
        for (const c of COHORTS) {
          const v = b.pub![c];
          for (const tot of t >= h1From ? [h24, h1] : [h24]) {
            if (!v) {
              tot[c].hidden++;
              continue;
            }
            tot[c].buy += v.buy;
            tot[c].sell += v.sell;
            if (v.takerBuy === null || v.takerSell === null) tot[c].takerHidden++;
            else {
              tot[c].takerBuy += v.takerBuy;
              tot[c].takerSell += v.takerSell;
            }
          }
        }
        return { t, cells: Object.fromEntries(COHORTS.map((c) => [c, rounded(b.pub![c])])) as Record<CohortId, CohortCell | null> };
      });
    const roundTotals = (r: Record<CohortId, CohortTotal>) => {
      for (const c of COHORTS) {
        r[c].buy = roundUsd(r[c].buy);
        r[c].sell = roundUsd(r[c].sell);
        r[c].takerBuy = roundUsd(r[c].takerBuy);
        r[c].takerSell = roundUsd(r[c].takerSell);
      }
      return r;
    };

    // Okno: 24 ostatnie sfinalizowane godziny — nowa wchodzi w tym samym kroku, w którym najstarsza wypada
    const finalized = [...this.oos.keys()]
      .filter((h) => this.oos.get(h)!.rest.ok !== null)
      .sort((a, b) => b - a)
      .slice(0, 24);
    const oos = {} as Record<CohortId, CohortMarkout>;
    for (const c of COHORTS) {
      const sum = { w: [0, 0, 0], wm: [0, 0, 0], hours: 0, hidden: 0 };
      for (const h of finalized) {
        const a = this.oos.get(h)![c];
        if (a.n5 === 0) continue;
        if (!a.ok) {
          sum.hidden++;
          continue;
        }
        sum.hours++;
        for (let i = 0; i < 3; i++) {
          sum.w[i] += a.w[i];
          sum.wm[i] += a.wm[i];
        }
      }
      // Tylko średnie (bez liczności i nominału — wagi pozwalałyby odtwarzać ukryte godziny z publicznych sum taśmy)
      const m = (i: number) => (sum.w[i] > 0 ? Math.round((sum.wm[i] / sum.w[i]) * 10) / 10 : null);
      oos[c] = {
        hours: sum.hours,
        hiddenHours: sum.hidden,
        m1: m(0),
        m5: m(1),
        m60: m(2),
      };
    }

    const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    return {
      v: 1,
      coin: this.coin,
      asOf: now,
      since,
      bucketMin: BUCKET / MIN,
      buckets,
      totals: { h1: roundTotals(h1), h24: roundTotals(h24) },
      members: Object.fromEntries(COHORTS.map((c) => [c, floorTens(this.members[c])])) as Record<CohortId, number>,
      informed: {
        candidates: floorTens(this.meta.candidates),
        selected: floorTens(this.meta.selected),
        fdrQ: FDR_Q,
        minN: INFORMED_MIN_N,
        mu0Bp: r1(this.meta.mu0),
        tauBp: this.meta.tau2 === null ? null : r1(Math.sqrt(this.meta.tau2)),
        classifiedAt: this.meta.at,
      },
      oos,
      kMin: K_MIN,
      method: 'hl-cohorts-v1',
    };
  }

  /** Stan serwera (zawiera adresy — tylko na dysku serwera, nigdy w publikacji). Markouty w toku nie są zapisywane. */
  toJSON(): unknown {
    const cellJson = (c: OpenCell) => ({ buy: c.buy, sell: c.sell, takerBuy: c.takerBuy, takerSell: c.takerSell, all: [...c.all], taker: [...c.taker] });
    return {
      v: 2,
      stats: [...this.stats],
      lastActive: [...this.lastActive],
      mm: [...this.mm],
      informed: [...this.informed],
      meta: this.meta,
      members: this.members,
      buckets: [...this.buckets].map(([t, b]) => [t, { open: b.open ? Object.fromEntries(COHORTS.map((c) => [c, cellJson(b.open![c])])) : null, pub: b.pub }]),
      oos: [...this.oos].map(([h, acc]) => [h, Object.fromEntries(COHORTS.map((c) => [c, { ...acc[c], takers: acc[c].takers ? [...acc[c].takers!] : null }]))]),
    };
  }

  static fromJSON(j: unknown, o: { coin: string; isWhale: (addr: string) => boolean; maxStats?: number }): CohortEngine {
    const e = new CohortEngine(o);
    const x = j as Record<string, unknown> | null;
    if (!x || x.v !== 2) return e;
    const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const finOrNull = (v: unknown) => v === null || fin(v);
    const pairs = (v: unknown): [string, number][] | null =>
      Array.isArray(v) && v.every((p) => Array.isArray(p) && typeof p[0] === 'string' && fin(p[1])) ? (v as [string, number][]) : null;

    if (Array.isArray(x.stats)) {
      for (const row of x.stats) {
        const [a, st] = (Array.isArray(row) ? row : []) as [unknown, Partial<Stats>];
        if (typeof a === 'string' && st && fin(st.mk) && fin(st.tk) && fin(st.n) && fin(st.s) && fin(st.ss) && fin(st.at)) e.stats.set(a, st as Stats);
      }
    }
    for (const [a, t] of pairs(x.lastActive) ?? []) e.lastActive.set(a, t);
    if (Array.isArray(x.mm)) e.mm = new Set(x.mm.filter((a): a is string => typeof a === 'string'));
    if (Array.isArray(x.informed)) e.informed = new Set(x.informed.filter((a): a is string => typeof a === 'string'));
    const meta = x.meta as Partial<Meta> | undefined;
    if (meta && fin(meta.candidates) && fin(meta.selected) && finOrNull(meta.mu0) && finOrNull(meta.tau2) && finOrNull(meta.at)) e.meta = meta as Meta;
    const members = x.members as Record<string, unknown> | undefined;
    if (members && COHORTS.every((c) => fin(members[c]))) e.members = members as Record<CohortId, number>;

    const isPubCell = (c: unknown) =>
      c === null || (!!c && fin((c as CohortCell).buy) && fin((c as CohortCell).sell) && finOrNull((c as CohortCell).takerBuy) && finOrNull((c as CohortCell).takerSell));
    if (Array.isArray(x.buckets)) {
      for (const row of x.buckets) {
        if (!Array.isArray(row) || !fin(row[0]) || !row[1] || typeof row[1] !== 'object') continue;
        const raw = row[1] as { open?: Record<string, Record<string, unknown>> | null; pub?: Record<string, unknown> | null };
        if (raw.pub && COHORTS.every((c) => isPubCell(raw.pub![c]))) {
          e.buckets.set(row[0], { open: null, pub: raw.pub as Record<CohortId, CohortCell | null> });
          continue;
        }
        if (!raw.open) continue;
        const open = newOpen();
        let ok = true;
        for (const c of COHORTS) {
          const v = raw.open[c];
          const all = v ? pairs(v.all) : null;
          const taker = v ? pairs(v.taker) : null;
          if (!v || !fin(v.buy) || !fin(v.sell) || !fin(v.takerBuy) || !fin(v.takerSell) || !all || !taker) {
            ok = false;
            break;
          }
          open[c] = { buy: v.buy, sell: v.sell, takerBuy: v.takerBuy, takerSell: v.takerSell, all: new Map(all), taker: new Map(taker) };
        }
        if (ok) e.buckets.set(row[0], { open, pub: null });
      }
    }
    if (Array.isArray(x.oos)) {
      for (const row of x.oos) {
        if (!Array.isArray(row) || !fin(row[0]) || !row[1] || typeof row[1] !== 'object') continue;
        const acc = newOos();
        let ok = true;
        for (const c of COHORTS) {
          const v = (row[1] as Record<string, Record<string, unknown>>)[c];
          const w = v?.w;
          const wm = v?.wm;
          const takers = v?.takers === null ? null : pairs(v?.takers);
          if (
            !v ||
            !Array.isArray(w) ||
            !Array.isArray(wm) ||
            w.length !== 3 ||
            wm.length !== 3 ||
            !w.every(fin) ||
            !wm.every(fin) ||
            !fin(v.n5) ||
            !fin(v.usd5) ||
            (v.takers !== null && !takers) ||
            !(v.ok === null || typeof v.ok === 'boolean')
          ) {
            ok = false;
            break;
          }
          acc[c] = { w: w as number[], wm: wm as number[], n5: v.n5, usd5: v.usd5, takers: takers ? new Map(takers) : null, ok: v.ok as boolean | null };
        }
        if (ok) e.oos.set(row[0], acc);
      }
    }
    return e;
  }
}
