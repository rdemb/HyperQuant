import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { encodeBook, encodeTrades, HIST_PART_MS, type HistFrame } from '../../../utils/tapeHistory';
import { readBookLevel } from '../core/book';
import { describeArchiveBytes, loadVerifiedReplay, type ReplayArchiveManifest } from '../replay/archive';
import { latestExactArchiveBookAt } from '../replay/archiveBookReading';
import { readLegacyReplayAt, readReplayObservation } from '../replay/availability';

const from = Date.UTC(2026, 10, 20, 8);
const to = from + HIST_PART_MS;
const trade = { t: from + 77_000, tid: 10, px: 61_611, sz: 0.1, side: 'A' as const, o: -1, k: -1, m: -1 };
const tape = encodeTrades('BTC', from, to, [[from, to]], [trade], []);
const book = encodeBook('BTC', from, to, [[from, from + 79_000], [from + 95_000, to]], [
  { t: from + 76_000, step: 1, bids: [61_611, 1, 1], asks: [61_612, 1, 1], exact: true },
]);
const zip = (value: unknown) => new Uint8Array(gzipSync(JSON.stringify(value)));
const good = { trades: zip(tape), book: zip(book) };
const fixture = async (files = good): Promise<ReplayArchiveManifest> => ({
  revision: 'synthetic-v1', coin: 'BTC', from, to,
  files: { trades: await describeArchiveBytes(files.trades), book: await describeArchiveBytes(files.book) },
});
const read = async (files: Partial<typeof good>, manifest = fixture()) =>
  loadVerifiedReplay('https://archive.test/pinned', await manifest, async url => {
    const bytes = url.endsWith('.trades.json.gz') ? files.trades : files.book;
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  });

it('keeps disclosed gaps separate from archive bytes and from live continuity', async () => {
  const result = await read(good);
  expect(await read(good)).toEqual(result);
  expect(result).toMatchObject({
    trades: { kind: 'verified', observations: 1, declaredGaps: [], continuity: 'unverified' },
    book: { kind: 'verified', observations: 1, declaredGaps: [[from + 79_000, from + 95_000]], continuity: 'unverified' },
    data: { spans: [], bookSpans: [], fills: [{ time: trade.t, tid: trade.tid }] },
  });
});

it.each(['trades', 'book'] as const)('isolates a changed %s file and accepts the other file', async kind => {
  const bytes = good[kind].slice();
  bytes[bytes.length - 1] ^= 1;
  const other = kind === 'trades' ? 'book' : 'trades';
  const result = await read({ ...good, [kind]: bytes });
  expect(result[kind]).toEqual({ kind: 'integrity-mismatch' });
  expect(result[other]).toMatchObject({ kind: 'verified' });
  expect(result.data[kind === 'trades' ? 'fills' : 'frames']).toEqual([]);
  expect(result.data[kind === 'trades' ? 'frames' : 'fills']).toHaveLength(1);
});

it('distinguishes missing from invalid gzip, scope, version, and rows', async () => {
  expect(await read({ trades: good.trades })).toMatchObject({ book: { kind: 'missing' } });
  const invalid = { trades: new Uint8Array([0x1f, 0x8b, 0]), book: zip({ ...book, coin: 'ETH' }) };
  expect(await read(invalid, fixture(invalid))).toMatchObject({
    trades: { kind: 'invalid-gzip-or-json' }, book: { kind: 'scope-mismatch' },
  });
  const badVersionAndRow = { trades: zip({ ...tape, v: 2 }), book: zip({ ...book, frames: [[from, '1', [], []]] }) };
  expect(await read(badVersionAndRow, fixture(badVersionAndRow))).toMatchObject({
    trades: { kind: 'unsupported-version' }, book: { kind: 'invalid-records' },
  });
});

it('never exposes v1 as known on receipt, even when a trade timestamp is exact', () => {
  expect(readLegacyReplayAt([trade], { mode: 'known-at-receipt', observer: 'a', cursorMs: to }, row => row.t))
    .toEqual({ kind: 'unavailable', reason: 'unknown-receipt-time' });
  expect(readLegacyReplayAt([trade], { mode: 'exchange-retrospective', cursorMs: trade.t }, row => row.t))
    .toEqual({ kind: 'observed', sample: trade });
});

it('makes later data available only to the correct observer and at the chosen clock', () => {
  const sample = { observer: 'a', session: '1', receiveSeq: 2, eventAtMs: 90,
    receivedAtMs: 910, availableAtMs: 920, revision: 'v1', value: 42 };
  expect(readReplayObservation([sample], { mode: 'exchange-retrospective', cursorMs: 90 }))
    .toEqual({ kind: 'observed', sample });
  expect(readReplayObservation([sample], { mode: 'known-at-receipt', observer: 'a', cursorMs: 151 }))
    .toEqual({ kind: 'unavailable', reason: 'no-sample-at-cursor' });
  expect(readReplayObservation([sample], { mode: 'known-at-receipt', observer: 'a', cursorMs: 910 }))
    .toEqual({ kind: 'observed', sample });
  expect(readReplayObservation([sample], { mode: 'known-to-application', observer: 'a', cursorMs: 919 }))
    .toEqual({ kind: 'unavailable', reason: 'no-sample-at-cursor' });
  expect(readReplayObservation([sample], { mode: 'known-at-receipt', observer: 'b', cursorMs: 920 }))
    .toEqual({ kind: 'unavailable', reason: 'wrong-observer' });
});

it('never goes back to an older book when a delayed message arrives, or buys time from inconsistent clocks', () => {
  const first = { observer: 'a', session: '1', receiveSeq: 1, eventAtMs: 100,
    receivedAtMs: 110, availableAtMs: 111, revision: 'v1', value: 100 };
  const late = { ...first, receiveSeq: 2, eventAtMs: 90, receivedAtMs: 140, availableAtMs: 141, value: 90 };
  const futureEvent = { ...first, eventAtMs: 200, receivedAtMs: 100 };
  const impossible = { ...first, receivedAtMs: 201, availableAtMs: 119 };
  const query = { mode: 'known-at-receipt' as const, observer: 'a', cursorMs: 150 };
  expect(readReplayObservation([first, late, futureEvent], query)).toEqual({ kind: 'observed', sample: first });
  expect(readReplayObservation([late, futureEvent, first], query)).toEqual({ kind: 'observed', sample: first });
  expect(readReplayObservation([futureEvent], query)).toMatchObject({ reason: 'no-sample-at-cursor' });
  expect(readReplayObservation([impossible], { ...query, mode: 'known-to-application' }))
    .toMatchObject({ reason: 'no-sample-at-cursor' });
  const receiptOnly = { ...first, eventAtMs: null };
  expect(readReplayObservation([receiptOnly], query)).toEqual({ kind: 'observed', sample: receiptOnly });
});

it('reports contradictory content under the same identity in either insertion order', () => {
  const first = { observer: 'a', session: '1', receiveSeq: 1, eventAtMs: 100,
    receivedAtMs: 110, availableAtMs: 111, revision: 'v1', value: 100 };
  const conflict = { ...first, value: 90 };
  const query = { mode: 'exchange-retrospective' as const, cursorMs: 150 };
  expect(readReplayObservation([first, conflict], query)).toMatchObject({ reason: 'conflict' });
  expect(readReplayObservation([conflict, first], query)).toMatchObject({ reason: 'conflict' });
  expect(readReplayObservation([first, { ...first, eventAtMs: 101 }], query)).toMatchObject({ reason: 'conflict' });
  expect(readReplayObservation([first, { ...first }], query)).toEqual({ kind: 'observed', sample: first });
});

it('rejects both orders of conflicting exact frames and reads a corrected revision with aggregates', async () => {
  const t = from + 76_000;
  const exact: HistFrame = { t, step: 1, bids: [99, 1, 1], asks: [100, 2, 1], exact: true };
  const conflict = { ...exact, step: 0.1, asks: [100, 5, 1] };
  const aggregated = { t, step: 10, bids: [90, 1, 1], asks: [100, 20, 1] };
  const frames = [exact, conflict];
  for (const order of [frames, [...frames].reverse()]) {
    const files = { ...good, book: zip(encodeBook('BTC', from, to, [[from, to]], [...order, aggregated])) };
    const replay = await read(files, fixture(files));
    expect(replay.book).toEqual({ kind: 'invalid-records' });
    expect(replay.data.frames).toEqual([]);
    expect(latestExactArchiveBookAt(replay, t)).toBeNull();
    expect(replay.trades.kind).toBe('verified');
    expect(replay.data.fills).toHaveLength(1);
  }
  const corrected = { ...good, book: zip(encodeBook('BTC', from, to, [[from, to]], [frames[0], aggregated,
    { ...aggregated, step: 100 }])) };
  const nextManifest = { ...await fixture(corrected), revision: 'synthetic-v1-corrected' };
  const recovered = await read(corrected, Promise.resolve(nextManifest));
  expect(recovered.book).toMatchObject({ kind: 'verified', observations: 3 });
  const frame = latestExactArchiveBookAt(recovered, t);
  expect(frame).toMatchObject({ t, exact: true });
  expect(frame && readBookLevel(frame, 'ask', 100)).toMatchObject({ kind: 'observed', size: 2 });
  expect(recovered.data.fills).toHaveLength(1);
});
