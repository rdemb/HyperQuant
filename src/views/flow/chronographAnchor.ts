import { Coverage } from '../../charts/pro/core/coverage';
import type { TradeRow } from '../../charts/pro/core/tape';
import archive from './chronographArchive.json';
import { openChronographClip, type ChronographDemo } from './chronographHistory';
import { depthDrops, type DepthDrop } from './snapshotOrder';

// The revision binds the local row IDs to the exact checked-in clip bytes.
export const CHRONOGRAPH_CLIP_REVISION = 'sha256:514ca39c70b6f115a5fdc1f1e21102527a8f21b1ff6aec52f0ed3af59b96b13c';
const source = 'hyperliquid/BTC-perp';
export const CHRONOGRAPH_V1_EVIDENCE = {
  coverage: 'declared', continuity: 'unverified', receiptTime: 'unknown',
} as const;

export type ChronographSimulation = { tapeGap: boolean; bookGap: boolean };

export type ChronographAnchor = {
  v: 1;
  source: typeof source;
  clip: ChronographDemo;
  revision: string;
  through: number;
  trade: Omit<TradeRow, 'tid'> & { tid: string };
  book?: { side: DepthDrop['side']; a: number; b: number };
  simulation?: ChronographSimulation;
};

type UnavailableReason = 'invalid-anchor' | 'wrong-source' | 'wrong-revision' | 'trade-missing'
  | 'trade-conflict' | 'trade-after-cursor' | 'tape-gap' | 'book-gap' | 'book-after-cursor' | 'book-missing';

export type ChronographAnchorResult =
  | { kind: 'resolved'; trade: TradeRow; drop: DepthDrop | null }
  | { kind: 'unavailable'; reason: UnavailableReason };

const unavailable = (reason: UnavailableReason): ChronographAnchorResult => ({ kind: 'unavailable', reason });
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function readChronographSimulation(raw: unknown): ChronographSimulation | null {
  const simulation = record(raw) ? raw.simulation : undefined;
  if (simulation === undefined) return { tapeGap: false, bookGap: false };
  if (!record(simulation) || typeof simulation.tapeGap !== 'boolean' || typeof simulation.bookGap !== 'boolean') return null;
  return { tapeGap: simulation.tapeGap, bookGap: simulation.bookGap };
}

export function makeChronographAnchor(
  clip: ChronographDemo, through: number, trade: TradeRow, drop?: DepthDrop, simulation?: ChronographSimulation,
): ChronographAnchor {
  return {
    v: 1, source, clip, revision: CHRONOGRAPH_CLIP_REVISION, through,
    trade: { t: trade.t, tid: String(trade.tid), px: trade.px, sz: trade.sz, side: trade.side },
    ...(drop ? { book: { side: drop.side, a: drop.before.t, b: drop.after.t } } : {}),
    ...(simulation?.tapeGap || simulation?.bookGap ? { simulation: { tapeGap: simulation.tapeGap, bookGap: simulation.bookGap } } : {}),
  };
}

export function resolveChronographAnchor(
  raw: unknown, options: Partial<ChronographSimulation> = {},
): ChronographAnchorResult {
  if (!record(raw) || raw.v !== 1 || typeof raw.source !== 'string' || typeof raw.revision !== 'string'
    || (raw.clip !== 'level' && raw.clip !== 'flip') || !integer(raw.through) || !record(raw.trade)) {
    return unavailable('invalid-anchor');
  }
  if (raw.source !== source) return unavailable('wrong-source');
  if (raw.revision !== CHRONOGRAPH_CLIP_REVISION) return unavailable('wrong-revision');
  const simulation = readChronographSimulation(raw);
  if (!simulation) return unavailable('invalid-anchor');
  const tapeGap = options.tapeGap ?? simulation.tapeGap;
  const bookGap = options.bookGap ?? simulation.bookGap;
  const { clip, through, trade: saved, book } = raw;
  const { fromMs, toMs, trades } = archive[clip];
  if (through < fromMs || through > toMs || !integer(saved.t) || !positive(saved.px) || !positive(saved.sz)
    || (saved.side !== 1 && saved.side !== -1) || typeof saved.tid !== 'string'
    || !/^(0|[1-9][0-9]{0,15})$/.test(saved.tid) || !integer(Number(saved.tid))) {
    return unavailable('invalid-anchor');
  }

  const tid = Number(saved.tid);
  const original = trades[tid];
  if (!original) return unavailable('trade-missing');
  const [t, px, sz, side] = original;
  if (t !== saved.t || px !== saved.px || sz !== saved.sz || side !== (saved.side === 1 ? 'B' : 'A')) {
    return unavailable('trade-conflict');
  }
  if (t >= through) return unavailable('trade-after-cursor');
  const replay = openChronographClip(clip, through, tapeGap);
  if (!replay.coverage.covers(t, t + 1)) return unavailable('tape-gap');
  const trade: TradeRow = { t, tid, px, sz, side: saved.side };
  if (book === undefined) return { kind: 'resolved', trade, drop: null };
  if (!record(book)) return unavailable('invalid-anchor');
  const { a, b, side: bookSide } = book;
  if ((bookSide !== 'bid' && bookSide !== 'ask') || !integer(a) || !integer(b) || a >= b) return unavailable('invalid-anchor');
  if (b >= through) return unavailable('book-after-cursor');
  const coverage = bookGap ? new Coverage() : replay.bookCoverage;
  if (!coverage.covers(a, b + 1)) return unavailable('book-gap');
  const drop = depthDrops(replay.history.list(), coverage, trade.px, through, 5).drops
    .find(value => value.side === bookSide && value.before.t === a && value.after.t === b);
  return drop ? { kind: 'resolved', trade, drop } : unavailable('book-missing');
}
