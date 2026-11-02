import type { Side } from '../hl/parse';
import type { AggressorOrder } from './orders';

/**
 * TWAP-y w drodze: plany TWAP z publicznego dziennika Hyperliquid (`info twapHistory`) i plasterki widoczne na taśmie.
 *
 * Pomiar 1.11.2026: dziennik to zdarzenia, nie stan — każdy TWAP ma wpis „activated” (wykonanie zawsze 0), a po końcu
 * osobny wpis końcowy (finished, terminated, stopped, error). W toku = „activated” bez wpisu końcowego. Hyperliquid
 * wykonuje TWAP równo w czasie, plasterek co 30 s ok. 1,5 s po fazie startu (0,639 z 1 BTC po 939 z 1470 min), więc
 * postęp liczymy liniowo od startu. Adres konta służy tylko do zapytania i zostaje w pamięci strony.
 */

export interface TwapPlan {
  id: number;
  side: Side;
  /** Wielkość całego TWAP (jednostki rynku). */
  sz: number;
  minutes: number;
  /** Start (ms). */
  start: number;
  /** Tylko zmniejsza pozycję (np. kupno zamykające krótką). */
  reduceOnly: boolean;
}

/** Takt plasterków TWAP i ich opóźnienie względem fazy startu (pomiar 1.11). */
export const SLICE_MS = 30_000;
export const SLICE_LAG_MS = 1_500;
/** Tolerancja dopasowania fazy plasterków (ms, po okręgu 30 s). */
export const PHASE_TOL_MS = 2_500;
/** Plan bez wpisu końcowego po swoim końcu liczy się jeszcze tyle ms (dogrywka zaległych plasterków). */
export const END_GRACE_MS = 5 * 60_000;
const TERMINAL = new Set(['finished', 'terminated', 'stopped', 'error']);

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN);

/** Plany w toku dla rynku `coin` z odpowiedzi `twapHistory` (null przy błędnym kształcie). */
export function runningPlans(raw: unknown, coin: string, now: number): TwapPlan[] | null {
  if (!Array.isArray(raw)) return null;
  const started = new Map<number, TwapPlan>();
  const ended = new Set<number>();
  for (const e of raw as { state?: Record<string, unknown>; status?: { status?: unknown }; twapId?: unknown }[]) {
    const id = e?.twapId;
    const s = e?.state;
    if (typeof id !== 'number' || !s || s.coin !== coin) continue;
    const status = e.status?.status;
    if (typeof status === 'string' && TERMINAL.has(status)) ended.add(id);
    else if (status === 'activated') {
      const sz = num(s.sz);
      const minutes = num(s.minutes);
      const start = num(s.timestamp);
      if (!(sz > 0) || !(minutes > 0) || !Number.isFinite(start) || (s.side !== 'B' && s.side !== 'A')) continue;
      started.set(id, { id, side: s.side === 'B' ? 1 : -1, sz, minutes, start, reduceOnly: s.reduceOnly === true });
    }
  }
  return [...started.values()].filter((p) => !ended.has(p.id) && p.start <= now && now <= planEnd(p) + END_GRACE_MS).sort((a, b) => b.start - a.start);
}

export const planEnd = (p: TwapPlan) => p.start + p.minutes * 60_000;

/** Wykonana część planu według liniowego harmonogramu Hyperliquid (0…1). */
export function planDone(p: TwapPlan, now: number): number {
  return Math.min(1, Math.max(0, (now - p.start) / (p.minutes * 60_000)));
}

/** Faza plasterków planu w takcie 30 s (ms). */
export const planPhase = (p: TwapPlan) => (((p.start + SLICE_LAG_MS) % SLICE_MS) + SLICE_MS) % SLICE_MS;

const phaseDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % SLICE_MS;
  return Math.min(d, SLICE_MS - d);
};

/** Ciąg plasterków jednego konta i strony w jednej fazie, widziany na taśmie. */
export interface TwapStream {
  taker: string;
  side: Side;
  /** Faza plasterków w takcie 30 s (ms). */
  phase: number;
  first: number;
  last: number;
  slices: number;
  sz: number;
  usd: number;
}

/** Ciągi plasterków (zlecenia z hashem zerowym); `orders` rosnąco po czasie, faza ciągu z jego pierwszego plasterka. */
export function twapStreams(orders: readonly AggressorOrder[]): TwapStream[] {
  const out: TwapStream[] = [];
  const byKey = new Map<string, TwapStream[]>();
  for (const o of orders) {
    if (!o.zero || !o.taker) continue;
    const key = `${o.taker}|${o.side}`;
    const phase = o.time % SLICE_MS;
    const list = byKey.get(key) ?? [];
    let s = list.find((x) => phaseDist(x.phase, phase) <= PHASE_TOL_MS);
    if (!s) {
      s = { taker: o.taker, side: o.side, phase, first: o.time, last: o.time, slices: 0, sz: 0, usd: 0 };
      list.push(s);
      byKey.set(key, list);
      out.push(s);
    }
    s.last = o.time;
    s.slices++;
    s.sz += o.sz;
    s.usd += o.notional;
  }
  return out;
}

/** Plan pasujący do ciągu plasterków: ta sama strona i faza (najbliższa w tolerancji), albo null. */
export function matchPlan(stream: TwapStream, plans: readonly TwapPlan[]): TwapPlan | null {
  let best: TwapPlan | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of plans) {
    if (p.side !== stream.side) continue;
    const d = phaseDist(planPhase(p), stream.phase);
    if (d <= PHASE_TOL_MS && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Wartość (USD), którą plan wykona w najbliższych `horizonMs` według harmonogramu, po cenie `px`. */
export function planAhead(p: TwapPlan, now: number, horizonMs: number, px: number): number {
  const left = Math.max(0, planEnd(p) - now);
  return (p.sz * (Math.min(left, horizonMs) / (p.minutes * 60_000))) * px;
}
