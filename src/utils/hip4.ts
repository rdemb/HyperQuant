/**
 * HIP-4 (rynki wynikowe Hyperliquid) dla BTC: te same pytania, które liczy model desku — „BTC powyżej K w chwili T”
 * i „dotknięcie K do T”. Parsowanie `outcomeMeta`, notowania z arkusza strony „Yes” i prawdopodobieństwa modelu
 * (Monte Carlo na σ z sezonowego log-HAR i innowacjach FHS — ten sam silnik co dziennik desku).
 *
 * Fakty (publiczne API, sprawdzone 2026-10-22): arkusz strony = `#<10·outcome + strona>` (strona 0 = Yes), cena 0–1 USDC
 * za udział; dzienny rynek `Recurring` rozlicza się o 06:00 UTC po cenie mark BTC z HyperCore (dokumentacja HIP-4);
 * `binaryPrice` — cena Pyth BTC/USD, mark albo cena transakcji perpa HL (okno `seconds`), `priceTouch` — mark perpa.
 */
import { makeInnovation, mulberry32 } from './pathEngine';

export type OutcomeKind = 'above' | 'touch';

export interface BtcOutcome {
  id: number;
  kind: OutcomeKind;
  K: number;
  /** Termin (ms UTC) */
  expiry: number;
  /** Źródło ceny rozliczenia: mark perpa HL, cena transakcji perpa HL albo Pyth BTC/USD */
  source: 'mark' | 'trade' | 'pyth';
  /** Okno z opisu rynku (s): uśrednianie (Pyth) albo utrzymanie (dotknięcie); null = brak */
  seconds: number | null;
  /** Rynek cykliczny (dzienny) */
  recurring: boolean;
  /** Arkusz strony „Yes” */
  coin: string;
  description: string;
}

/** Czas Hyperliquid „RRRRMMDD-GGMM” (UTC) → ms; inny format → null. */
export function parseHlTime(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

const fields = (d: string): Record<string, string> =>
  Object.fromEntries(
    d.split('|').map((x) => {
      const i = x.indexOf(':');
      return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i + 1)];
    })
  );

/** Rynki BTC (cena powyżej progu w terminie, dotknięcie do terminu) z `outcomeMeta`, niewygasłe, posortowane po terminie. */
export function parseBtcOutcomes(meta: unknown, now: number): BtcOutcome[] {
  const outs = (meta as { outcomes?: unknown } | null)?.outcomes;
  if (!Array.isArray(outs)) return [];
  const res: BtcOutcome[] = [];
  for (const o of outs as { outcome?: unknown; name?: unknown; description?: unknown }[]) {
    if (typeof o?.outcome !== 'number' || typeof o.name !== 'string' || typeof o.description !== 'string') continue;
    const d = fields(o.description);
    const src = (): BtcOutcome['source'] => {
      const pd = d.priceDescription ?? '';
      return /pyth/i.test(pd) ? 'pyth' : /trade/i.test(pd) ? 'trade' : 'mark';
    };
    const secs = Number(d.seconds) > 0 ? Number(d.seconds) : null;
    let q: Omit<BtcOutcome, 'id' | 'coin' | 'description'> | null = null;
    if (o.name === 'Recurring' && d.class === 'priceBinary' && d.underlying === 'BTC') {
      const expiry = parseHlTime(d.expiry ?? '');
      const K = Number(d.targetPrice);
      if (expiry !== null && K > 0) q = { kind: 'above', K, expiry, source: 'mark', seconds: null, recurring: true };
    } else if (o.name === 'template:binaryPrice' && d.perp === 'BTC') {
      const expiry = parseHlTime(d.time ?? '');
      const K = Number(d.threshold);
      if (expiry !== null && K > 0) q = { kind: 'above', K, expiry, source: src(), seconds: secs, recurring: false };
    } else if (o.name === 'template:priceTouch' && d.perp === 'BTC') {
      const expiry = parseHlTime(d.time ?? '');
      const K = Number(d.target);
      if (expiry !== null && K > 0) q = { kind: 'touch', K, expiry, source: src(), seconds: secs, recurring: false };
    }
    if (!q || q.expiry <= now) continue;
    res.push({ id: o.outcome, ...q, coin: `#${o.outcome * 10}`, description: o.description });
  }
  return res.sort((a, b) => a.expiry - b.expiry || a.K - b.K);
}

export interface Quote {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  /** USDC w 3 najlepszych poziomach */
  depthBid: number;
  depthAsk: number;
  /** Arkusz pozwala czytać cenę: spread ≤ 0,05 i ≥ 20 USDC w 3 poziomach po obu stronach */
  liquid: boolean;
}

export const MAX_SPREAD = 0.05;
export const MIN_DEPTH_USD = 20;

/** Notowanie strony „Yes” z `l2Book`; brak którejś strony → null. */
export function bookQuote(book: unknown): Quote | null {
  const lv = (book as { levels?: unknown } | null)?.levels;
  if (!Array.isArray(lv) || lv.length < 2) return null;
  const side = (rows: unknown) =>
    (Array.isArray(rows) ? (rows as { px?: unknown; sz?: unknown }[]) : [])
      .map((r) => ({ px: Number(r?.px), sz: Number(r?.sz) }))
      .filter((r) => Number.isFinite(r.px) && Number.isFinite(r.sz) && r.px > 0 && r.sz > 0);
  const bids = side(lv[0]);
  const asks = side(lv[1]);
  if (!bids.length || !asks.length) return null;
  const depth = (xs: { px: number; sz: number }[]) => xs.slice(0, 3).reduce((a, r) => a + r.px * r.sz, 0);
  const bid = bids[0].px;
  const ask = asks[0].px;
  const depthBid = depth(bids);
  const depthAsk = depth(asks);
  const spread = ask - bid;
  return { bid, ask, mid: (bid + ask) / 2, spread, depthBid, depthAsk, liquid: spread <= MAX_SPREAD && depthBid >= MIN_DEPTH_USD && depthAsk >= MIN_DEPTH_USD };
}

export interface OutcomeQuestion {
  kind: OutcomeKind;
  K: number;
  /** Minuty do terminu */
  horizonMin: number;
}

/**
 * Prawdopodobieństwa modelu dla pytań HIP-4: ścieżki log-ceny z krokami σ (`stepSigmas(horizonMin)`), innowacje FHS
 * (`residuals`; null = normalne), dryf −½σ² (cena jest martyngałem — bez prognozy kierunku). Pytania o tym samym horyzoncie
 * dzielą ścieżki. „Powyżej”: udział ścieżek z ceną końcową > K. „Dotknięcie”: maksimum / minimum ścieżki z dokładnym
 * losowaniem ekstremum mostu Browna w każdym kroku (bez przeoczeń między krokami). Horyzont ≤ 0 → null.
 * `innovSum(h)` = k: innowacja kroku to suma k losowań FHS / √k — dłuższy krok (np. 60 min z reszt 5-minutowych) zachowuje
 * rozkład agregowanych zwrotów zamiast zawyżać ogony jedną grubą innowacją.
 */
export function outcomeProbabilities(
  qs: OutcomeQuestion[],
  S0: number,
  o: { stepSigmas: (horizonMin: number) => number[]; residuals: ArrayLike<number> | null; seed: number; paths?: number; innovSum?: (horizonMin: number) => number }
): (number | null)[] {
  const out: (number | null)[] = qs.map(() => null);
  if (!(S0 > 0)) return out;
  const paths = o.paths ?? 2000;
  const byH = new Map<number, number[]>();
  qs.forEach((q, i) => {
    if (!(q.horizonMin > 0) || !(q.K > 0)) return;
    if (q.kind === 'touch' && q.K === S0) {
      out[i] = 1;
      return;
    }
    const arr = byH.get(q.horizonMin);
    if (arr) arr.push(i);
    else byH.set(q.horizonMin, [i]);
  });
  let g = 0;
  for (const [h, idx] of byH) {
    const sig = o.stepSigmas(h);
    if (!sig.length) continue;
    const k = Math.max(1, Math.round(o.innovSum?.(h) ?? 1));
    const norm = 1 / Math.sqrt(k);
    const u = mulberry32((o.seed + 0x9e3779b9 * ++g) >>> 0);
    const innov = makeInnovation(u, o.residuals);
    const ub = mulberry32((o.seed ^ (0x51ed27 * g)) >>> 0);
    const logK = idx.map((i) => Math.log(qs[i].K / S0));
    const hits = idx.map(() => 0);
    for (let p = 0; p < paths; p++) {
      let w = 0;
      let hi = 0;
      let lo = 0;
      for (const s of sig) {
        let z = 0;
        for (let m = 0; m < k; m++) z += innov();
        const next = w - 0.5 * s * s + s * z * norm;
        const d2 = (next - w) * (next - w);
        const s2 = s * s;
        // Ekstrema mostu Browna między w a next (dokładny rozkład): (w + next ± √(Δ² − 2σ²·ln U)) / 2
        const mx = (w + next + Math.sqrt(d2 - 2 * s2 * Math.log(1 - ub()))) / 2;
        const mn = (w + next - Math.sqrt(d2 - 2 * s2 * Math.log(1 - ub()))) / 2;
        if (mx > hi) hi = mx;
        if (mn < lo) lo = mn;
        w = next;
      }
      for (let j = 0; j < idx.length; j++) {
        const q = qs[idx[j]];
        const b = logK[j];
        if (q.kind === 'above' ? w > b : b > 0 ? hi >= b : lo <= b) hits[j]++;
      }
    }
    idx.forEach((i, j) => (out[i] = hits[j] / paths));
  }
  return out;
}
