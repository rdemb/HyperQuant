import { COHORTS, type CohortCell, type CohortFlow, type CohortId, type CohortMarkout, emptyCell } from '../../src/utils/cohorts.ts';

/**
 * Przepływ kohort z publicznej taśmy BTC Hyperliquid (pole `users` + strona agresora) — tylko strumień WebSocket, zero zapytań REST.
 *
 * Kohorty (rozłączne, w tej kolejności):
 *  1. market makerzy — ≥ 80% nominału jako maker i ≥ 1 mln USD nominału maker (z wygaszaniem, połowa po 7 dniach);
 *  2. poinformowani — markout biorcy po 5 min istotnie dodatni: test jednostronny na adresach z n ≥ 30, kontrola FDR
 *     Benjaminiego–Hochberga (q = 0.10) i dodatnia średnia a posteriori w empirycznym Bayesie (normalny–normalny);
 *  3. wieloryby — wg książki adresów (pozycja ≥ 1 mln USD albo konto z rankingu ≥ 10 mln USD);
 *  4. reszta.
 * Klasyfikacja pochodzi wyłącznie z markoutów już rozliczonych, a kohorta transakcji jest ustalana w chwili transakcji —
 * markouty publikowane per kohorta są więc poza próbą.
 *
 * Adresy, statystyki per adres i przynależność zostają na serwerze. Publikacja: agregaty z k-anonimowością
 * (komórka z < 5 uczestnikami albo z uczestnikiem > 50% obrotu jest ukrywana).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BUCKET = 15 * MIN;
const HALF_LIFE = 7 * DAY;
export const HORIZONS_MIN = [1, 5, 60] as const;
const SETTLE_LAG = 2000;
export const K_MIN = 5;
const DOMINANCE = 0.5;
const MM_MAKER_SHARE = 0.8;
const MM_MIN_USD = 1e6;
export const INFORMED_MIN_N = 30;
export const FDR_Q = 0.1;

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
  /** Efektywna liczba rozliczonych markoutów 5 min */
  n: number;
  /** Średni markout, bp */
  mean: number;
  /** Wariancja markoutów, bp² */
  variance: number;
}

/** Wybór „poinformowanych”: BH na p-wartościach testu jednostronnego ∧ dodatnia średnia a posteriori (empiryczny Bayes). */
export function selectInformed(rows: InformedRow[], o: { minN: number; q: number }): { selected: Set<string>; candidates: number; mu0: number | null; tau2: number | null } {
  const cand = rows.filter((r) => r.n >= o.minN && r.variance > 0 && Number.isFinite(r.mean));
  if (cand.length === 0) return { selected: new Set(), candidates: 0, mu0: null, tau2: null };
  const se2 = cand.map((r) => r.variance / r.n);
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
  /** Markouty 5 min: liczba, suma, suma kwadratów (wygaszane) */
  n: number;
  s: number;
  ss: number;
  /** Czas ostatniego wygaszenia */
  at: number;
}

interface Cell extends CohortCell {
  /** Obrót uczestników (otwarty kubełek i stan serwera); po zamknięciu kubełka zastąpiony liczbami k i maxShare */
  parts: Map<string, number> | null;
  k: number;
  maxShare: number;
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
}

export interface CohortTrade {
  users: [string, string];
  side: 'B' | 'A';
  px: number;
  sz: number;
  time: number;
}

const newCell = (): Cell => ({ ...emptyCell(), parts: new Map(), k: 0, maxShare: 0 });
const newCells = (): Record<CohortId, Cell> => ({ mm: newCell(), informed: newCell(), whale: newCell(), rest: newCell() });
const newOos = (): Record<CohortId, OosAcc> => {
  const o = {} as Record<CohortId, OosAcc>;
  for (const c of COHORTS) o[c] = { w: [0, 0, 0], wm: [0, 0, 0], n5: 0, usd5: 0 };
  return o;
};

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

function compress(c: Cell): void {
  if (!c.parts) return;
  let total = 0;
  let max = 0;
  for (const v of c.parts.values()) {
    total += v;
    if (v > max) max = v;
  }
  c.k = c.parts.size;
  c.maxShare = total > 0 ? max / total : 0;
  c.parts = null;
}

function visible(c: Cell): CohortCell | null {
  if (c.buy + c.sell <= 0) return emptyCell();
  if (c.parts) compressCopy(c);
  return c.k >= K_MIN && c.maxShare <= DOMINANCE ? { buy: c.buy, sell: c.sell, takerBuy: c.takerBuy, takerSell: c.takerSell } : null;
}

/** k i udział największego uczestnika dla otwartego kubełka (bez porzucania obrotów uczestników). */
function compressCopy(c: Cell): void {
  let total = 0;
  let max = 0;
  for (const v of c.parts!.values()) {
    total += v;
    if (v > max) max = v;
  }
  c.k = c.parts!.size;
  c.maxShare = total > 0 ? max / total : 0;
}

export class CohortEngine {
  private readonly coin: string;
  private readonly isWhale: (addr: string) => boolean;
  private stats = new Map<string, Stats>();
  private lastActive = new Map<string, number>();
  private mm = new Set<string>();
  private informed = new Set<string>();
  private meta: { candidates: number; selected: number; mu0: number | null; tau2: number | null; at: number | null } = {
    candidates: 0,
    selected: 0,
    mu0: null,
    tau2: null,
    at: null,
  };
  private buckets = new Map<number, Record<CohortId, Cell>>();
  private readonly prices = new SecondPrices();
  private queues: Pending[][] = [[], [], []];
  private oos = new Map<number, Record<CohortId, OosAcc>>();

  constructor(o: { coin: string; isWhale: (addr: string) => boolean }) {
    this.coin = o.coin;
    this.isWhale = o.isWhale;
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
    const bt = Math.floor(tr.time / BUCKET) * BUCKET;
    let cells = this.buckets.get(bt);
    if (!cells) {
      cells = newCells();
      this.buckets.set(bt, cells);
    }
    const add = (c: Cell, addr: string) => {
      if (c.parts) c.parts.set(addr, (c.parts.get(addr) ?? 0) + usd);
    };
    cells[cb].buy += usd;
    add(cells[cb], buyer);
    cells[cs].sell += usd;
    add(cells[cs], seller);
    const takerIsBuyer = tr.side === 'B';
    if (takerIsBuyer) cells[cb].takerBuy += usd;
    else cells[cs].takerSell += usd;

    const taker = takerIsBuyer ? buyer : seller;
    const maker = takerIsBuyer ? seller : buyer;
    this.stat(taker, tr.time).tk += usd;
    this.stat(maker, tr.time).mk += usd;
    this.lastActive.set(buyer, tr.time);
    this.lastActive.set(seller, tr.time);

    const p: Pending = { t: tr.time, px: tr.px, dir: takerIsBuyer ? 1 : -1, usd, addr: taker, cohort: takerIsBuyer ? cb : cs };
    for (const q of this.queues) q.push(p);
  }

  /** Rozlicza markouty, których horyzont minął (cena z sekundy t + h). */
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
        a.w[i] += p.usd;
        a.wm[i] += p.usd * m;
        if (h === 5) {
          a.n5++;
          a.usd5 += p.usd;
          const st = this.stat(p.addr, now);
          st.n += 1;
          st.s += m;
          st.ss += m * m;
        }
      }
    });
  }

  /** Klasyfikacja kohort z danych dotychczasowych (wywoływana co kilka minut) + czyszczenie nieaktywnych adresów. */
  classify(now: number): void {
    const mm = new Set<string>();
    const rows: InformedRow[] = [];
    for (const [a, st] of this.stats) {
      decay(st, now);
      if (st.mk + st.tk < 1 && st.n < 0.5 && now - (this.lastActive.get(a) ?? 0) > 30 * DAY) {
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
    const inf = selectInformed(rows, { minN: INFORMED_MIN_N, q: FDR_Q });
    this.mm = mm;
    this.informed = inf.selected;
    this.meta = { candidates: inf.candidates, selected: inf.selected.size, mu0: inf.mu0, tau2: inf.tau2, at: now };
    for (const [a, t] of this.lastActive) if (now - t > 30 * DAY) this.lastActive.delete(a);
  }

  build(now: number, since: number): CohortFlow {
    const sinceB = Math.floor(since / BUCKET) * BUCKET;
    for (const [t, cells] of this.buckets) {
      if (t + BUCKET <= now - DAY) this.buckets.delete(t);
      else if (t + BUCKET <= now) for (const c of COHORTS) compress(cells[c]);
    }
    for (const k of this.oos.keys()) if ((k + 1) * HOUR <= now - DAY) this.oos.delete(k);

    const h1From = Math.floor((now - HOUR) / BUCKET) * BUCKET;
    const total = () => ({ ...emptyCell(), hidden: 0 });
    const h1 = { mm: total(), informed: total(), whale: total(), rest: total() };
    const h24 = { mm: total(), informed: total(), whale: total(), rest: total() };
    const buckets = [...this.buckets.entries()]
      .filter(([t]) => t >= sinceB && t > now - DAY && t <= now)
      .sort((a, b) => a[0] - b[0])
      .map(([t, cells]) => {
        const out = {} as Record<CohortId, CohortCell | null>;
        for (const c of COHORTS) {
          const v = visible(cells[c]);
          out[c] = v;
          for (const [tot, inWin] of [
            [h24, true],
            [h1, t >= h1From],
          ] as const) {
            if (!inWin) continue;
            if (v) {
              tot[c].buy += v.buy;
              tot[c].sell += v.sell;
              tot[c].takerBuy += v.takerBuy;
              tot[c].takerSell += v.takerSell;
            } else tot[c].hidden++;
          }
        }
        return { t, cells: out };
      });

    const members = { mm: 0, informed: 0, whale: 0, rest: 0 };
    for (const [a, t] of this.lastActive) if (t > now - DAY) members[this.cohortOf(a)]++;

    const oosSum = newOos();
    for (const [k, acc] of this.oos) {
      if ((k + 1) * HOUR <= now - DAY) continue;
      for (const c of COHORTS) {
        for (let i = 0; i < 3; i++) {
          oosSum[c].w[i] += acc[c].w[i];
          oosSum[c].wm[i] += acc[c].wm[i];
        }
        oosSum[c].n5 += acc[c].n5;
        oosSum[c].usd5 += acc[c].usd5;
      }
    }
    const oos = {} as Record<CohortId, CohortMarkout>;
    for (const c of COHORTS) {
      const a = oosSum[c];
      const m = (i: number) => (a.w[i] > 0 ? a.wm[i] / a.w[i] : null);
      oos[c] = { n: a.n5, usd: a.usd5, m1: m(0), m5: m(1), m60: m(2) };
    }

    return {
      v: 1,
      coin: this.coin,
      asOf: now,
      since,
      bucketMin: BUCKET / MIN,
      buckets,
      totals: { h1, h24 },
      members,
      informed: {
        candidates: this.meta.candidates,
        selected: this.meta.selected,
        fdrQ: FDR_Q,
        minN: INFORMED_MIN_N,
        mu0Bp: this.meta.mu0,
        tauBp: this.meta.tau2 === null ? null : Math.sqrt(this.meta.tau2),
        classifiedAt: this.meta.at,
      },
      oos,
      kMin: K_MIN,
      method: 'hl-cohorts-v1',
    };
  }

  /** Stan serwera (zawiera adresy — tylko na dysku serwera, nigdy w publikacji). Markouty w toku nie są zapisywane. */
  toJSON(): unknown {
    const cellJson = (c: Cell) => ({ buy: c.buy, sell: c.sell, takerBuy: c.takerBuy, takerSell: c.takerSell, k: c.k, maxShare: c.maxShare, parts: c.parts ? [...c.parts] : null });
    return {
      v: 1,
      stats: [...this.stats],
      lastActive: [...this.lastActive],
      mm: [...this.mm],
      informed: [...this.informed],
      meta: this.meta,
      buckets: [...this.buckets].map(([t, cells]) => [t, Object.fromEntries(COHORTS.map((c) => [c, cellJson(cells[c])]))]),
      oos: [...this.oos],
    };
  }

  static fromJSON(j: unknown, o: { coin: string; isWhale: (addr: string) => boolean }): CohortEngine {
    const e = new CohortEngine(o);
    const x = j as Record<string, unknown> | null;
    if (!x || x.v !== 1) return e;
    const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (Array.isArray(x.stats)) {
      for (const row of x.stats) {
        const [a, st] = (row ?? []) as [unknown, Partial<Stats>];
        if (typeof a === 'string' && st && fin(st.mk) && fin(st.tk) && fin(st.n) && fin(st.s) && fin(st.ss) && fin(st.at)) e.stats.set(a, st as Stats);
      }
    }
    if (Array.isArray(x.lastActive)) for (const row of x.lastActive) if (Array.isArray(row) && typeof row[0] === 'string' && fin(row[1])) e.lastActive.set(row[0], row[1]);
    if (Array.isArray(x.mm)) e.mm = new Set(x.mm.filter((a): a is string => typeof a === 'string'));
    if (Array.isArray(x.informed)) e.informed = new Set(x.informed.filter((a): a is string => typeof a === 'string'));
    const meta = x.meta as CohortEngine['meta'] | undefined;
    if (meta && fin(meta.candidates) && fin(meta.selected)) e.meta = meta;
    if (Array.isArray(x.buckets)) {
      for (const row of x.buckets) {
        if (!Array.isArray(row) || !fin(row[0]) || !row[1] || typeof row[1] !== 'object') continue;
        const cells = newCells();
        let ok = true;
        for (const c of COHORTS) {
          const v = (row[1] as Record<string, Record<string, unknown>>)[c];
          if (!v || !fin(v.buy) || !fin(v.sell) || !fin(v.takerBuy) || !fin(v.takerSell) || !fin(v.k) || !fin(v.maxShare)) {
            ok = false;
            break;
          }
          const parts = Array.isArray(v.parts) ? new Map((v.parts as [string, number][]).filter((p) => typeof p[0] === 'string' && fin(p[1]))) : null;
          cells[c] = { buy: v.buy, sell: v.sell, takerBuy: v.takerBuy, takerSell: v.takerSell, k: v.k, maxShare: v.maxShare, parts };
        }
        if (ok) e.buckets.set(row[0], cells);
      }
    }
    if (Array.isArray(x.oos)) {
      for (const row of x.oos) {
        if (!Array.isArray(row) || !fin(row[0]) || !row[1]) continue;
        const acc = newOos();
        let ok = true;
        for (const c of COHORTS) {
          const v = (row[1] as Record<string, OosAcc>)[c];
          if (!v || !Array.isArray(v.w) || !Array.isArray(v.wm) || v.w.length !== 3 || v.wm.length !== 3 || !fin(v.n5) || !fin(v.usd5)) {
            ok = false;
            break;
          }
          acc[c] = { w: v.w.map(Number), wm: v.wm.map(Number), n5: v.n5, usd5: v.usd5 };
        }
        if (ok) e.oos.set(row[0], acc);
      }
    }
    return e;
  }
}
