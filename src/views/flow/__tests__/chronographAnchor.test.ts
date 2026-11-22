import { expect, it } from 'vitest';
import { CHRONOGRAPH_V1_EVIDENCE, makeChronographAnchor, readChronographSimulation, resolveChronographAnchor } from '../chronographAnchor';
import type { DepthDrop } from '../snapshotOrder';

const trade = { t: 1795159782058, tid: 978, px: 61_611, sz: 0.00681, side: -1 as const };
const through = 1795159812143;
const drop: DepthDrop = { price: trade.px, side: 'bid',
  before: { t: 1795159781528, size: 39.66225 }, after: { t: 1795159794009, size: 7.40276 } };
const anchor = () => makeChronographAnchor('level', through, trade, drop);

it('restores the exact print and exact BID snapshots across JSON serialization', () => {
  expect(resolveChronographAnchor(JSON.parse(JSON.stringify(anchor())))).toEqual({ kind: 'resolved', trade, drop });
});

it('excludes B at the cursor, accepts it exactly one millisecond later', () => {
  expect(resolveChronographAnchor({ ...anchor(), through: drop.after.t })).toEqual({ kind: 'unavailable', reason: 'book-after-cursor' });
  expect(resolveChronographAnchor({ ...anchor(), through: drop.after.t + 1 })).toEqual({ kind: 'resolved', trade, drop });
});

it('retains the selected identity when other executions share a millisecond', () => {
  const changed = { ...anchor(), trade: { ...anchor().trade, tid: '979' } };
  expect(resolveChronographAnchor(changed)).toEqual({ kind: 'unavailable', reason: 'trade-conflict' });
});

it.each([
  [{ revision: 'wrong' }, 'wrong-revision'],
  [{ source: 'hyperliquid/ETH-perp' }, 'wrong-source'],
  [{ through: trade.t }, 'trade-after-cursor'],
  [{ v: 0 }, 'invalid-anchor'],
  [{ book: { side: 'bid', a: drop.before.t - 1, b: drop.after.t } }, 'book-missing'],
])('rejects %j with %s', (patch, reason) => {
  expect(resolveChronographAnchor({ ...anchor(), ...patch })).toEqual({ kind: 'unavailable', reason });
});

it('rejects a different trade id, and reports a book gap independently', () => {
  expect(resolveChronographAnchor({ ...anchor(), trade: { ...anchor().trade, tid: '99999' } }))
    .toMatchObject({ reason: 'trade-missing' });
  expect(resolveChronographAnchor(anchor(), { bookGap: true })).toMatchObject({ reason: 'book-gap' });
  expect(resolveChronographAnchor(makeChronographAnchor('level', through, trade), { bookGap: true }))
    .toEqual({ kind: 'resolved', trade, drop: null });
});

it('reports an explicit tape gap even when the print is in the original bytes', () => {
  const tradeOnly = makeChronographAnchor('level', trade.t + 3_000, trade);
  expect(resolveChronographAnchor(tradeOnly, { tapeGap: true })).toMatchObject({ reason: 'tape-gap' });
});

it('keeps the archive declaration and transport evidence distinct from the serialized simulation', () => {
  expect(CHRONOGRAPH_V1_EVIDENCE).toEqual({ coverage: 'declared', continuity: 'unverified', receiptTime: 'unknown' });
  expect(readChronographSimulation(anchor())).toEqual({ tapeGap: false, bookGap: false });
  const saved = makeChronographAnchor('level', trade.t + 3_000, trade, undefined, { tapeGap: true, bookGap: false });
  const restored: unknown = JSON.parse(JSON.stringify(saved));
  expect(readChronographSimulation(restored)).toEqual({ tapeGap: true, bookGap: false });
  expect(resolveChronographAnchor(restored)).toEqual({ kind: 'unavailable', reason: 'tape-gap' });
  expect(resolveChronographAnchor({ ...saved, simulation: { tapeGap: 'true' } })).toMatchObject({ reason: 'invalid-anchor' });
});

it('restores a simulated book gap without supplying a replacement pair', () => {
  const saved = makeChronographAnchor('level', through, trade, drop, { tapeGap: false, bookGap: true });
  expect(resolveChronographAnchor(JSON.parse(JSON.stringify(saved)))).toEqual({ kind: 'unavailable', reason: 'book-gap' });
  expect(resolveChronographAnchor({ ...saved, book: undefined })).toEqual({ kind: 'resolved', trade, drop: null });
});
