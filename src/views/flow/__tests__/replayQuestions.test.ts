import { expect, it } from 'vitest';
import { Coverage } from '../../../charts/pro/core/coverage';
import { boundMissingDelta, findReplayWindows } from '../replayQuestions';

it('separates unread archive from a tape gap and leaves the tape independent of the book', () => {
  const base = { from: 0, to: 30_000, tape: new Coverage([[0, 29_999]]), book: new Coverage(), frames: [] };
  expect(findReplayWindows({ ...base, question: { kind: 'delta' } })).toMatchObject({
    first: null, skipped: [{ from: 0, to: 1_000, reasons: ['tape-gap'] }],
  });
  expect(findReplayWindows({ ...base, question: { kind: 'delta' }, unread: { tape: [[29_999, 30_000]] } }))
    .toMatchObject({ skipped: [{ reasons: ['unread'] }] });
  expect(findReplayWindows({ ...base, tape: new Coverage([[0, 30_000]]), question: { kind: 'delta' }, unread: { book: [[0, 30_000]] } }))
    .toMatchObject({ first: { from: 0, to: 30_000 }, skipped: [] });
});

it('only resolves the sign when all possible deltas agree', () => {
  expect(boundMissingDelta({ buy: 5n, sell: 1n, volume: 9n, certified: true, final: true }))
    .toEqual({ kind: 'bounded', lower: 1n, upper: 7n, missing: 3n, sign: 'positive' });
  expect(boundMissingDelta({ buy: 5n, sell: 1n, volume: 10n, certified: true, final: true }))
    .toMatchObject({ lower: 0n, sign: 'undetermined' });
  expect(boundMissingDelta({ buy: 5n, sell: 5n, volume: 10n, certified: true, final: true }))
    .toMatchObject({ lower: 0n, upper: 0n, sign: 'balanced' });
  expect(boundMissingDelta({ buy: 5n, sell: 5n, volume: 9n, certified: true, final: true }))
    .toEqual({ kind: 'unavailable' });
  expect(boundMissingDelta({ buy: 5n, sell: 5n, volume: 10n, certified: true, final: false }))
    .toEqual({ kind: 'unavailable' });
});

it('matches an independent allocation of missing quanta to buy and sell', () => {
  for (let buy = 0n; buy <= 8n; buy++) {
    for (let sell = 0n; sell <= 8n; sell++) {
      for (let missing = 0n; missing <= 8n; missing++) {
        const possibilities: bigint[] = [];
        for (let absentBuy = 0n; absentBuy <= missing; absentBuy++) {
          possibilities.push((buy + absentBuy) - (sell + (missing - absentBuy)));
        }
        const sign = possibilities.every(delta => delta > 0n) ? 'positive'
          : possibilities.every(delta => delta < 0n) ? 'negative'
          : possibilities.every(delta => delta === 0n) ? 'balanced' : 'undetermined';
        expect(boundMissingDelta({ buy, sell, volume: buy + sell + missing, certified: true, final: true }))
          .toEqual({ kind: 'bounded', lower: possibilities[0], upper: possibilities.at(-1), missing, sign });
      }
    }
  }
  expect(boundMissingDelta({ buy: 3n, sell: 2n, volume: 5n, certified: false, final: true })).toEqual({ kind: 'unavailable' });
});
