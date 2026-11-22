export type ReplayChannel = 'trades' | 'book' | 'context';

export type ReplayTimeQuery =
  | { mode: 'exchange-retrospective'; cursorMs: number }
  | { mode: 'known-at-receipt' | 'known-to-application'; observer: string; cursorMs: number };

type AvailabilityReason = 'invalid-query' | 'no-sample-at-cursor' | 'unknown-exchange-time'
  | 'unknown-receipt-time' | 'unknown-availability-time' | 'wrong-observer' | 'conflict';

export type AvailabilityResult<T> =
  | { kind: 'observed'; sample: T }
  | { kind: 'unavailable'; reason: AvailabilityReason };

export type ReplayObservation<T> = {
  observer: string;
  session: string;
  receiveSeq: number;
  eventAtMs: number | null;
  receivedAtMs: number;
  availableAtMs: number | null;
  revision: string;
  value: T;
};

export const isReplayMs = (time: unknown): time is number =>
  typeof time === 'number' && Number.isSafeInteger(time) && time >= 0;

export function readLegacyReplayAt<T>(
  observations: readonly T[], query: ReplayTimeQuery, timeOf: (sample: T) => number, retrospectiveLagMs = 0,
): AvailabilityResult<T> {
  if (!isReplayMs(query.cursorMs) || !isReplayMs(retrospectiveLagMs)) return { kind: 'unavailable', reason: 'invalid-query' };
  if (query.mode !== 'exchange-retrospective') return { kind: 'unavailable',
    reason: query.mode === 'known-at-receipt' ? 'unknown-receipt-time' : 'unknown-availability-time' };
  let latest: { sample: T; time: number } | undefined;
  for (const sample of observations) {
    const time = timeOf(sample);
    if (isReplayMs(time) && time + retrospectiveLagMs <= query.cursorMs && (!latest || time > latest.time)) {
      latest = { sample, time };
    }
  }
  return latest ? { kind: 'observed', sample: latest.sample } : { kind: 'unavailable', reason: 'no-sample-at-cursor' };
}

/** Reader runs independently per instrument and channel, with inclusive cursor boundaries. */
export function readReplayObservation<T>(
  observations: readonly ReplayObservation<T>[], query: ReplayTimeQuery, sameValue: (a: T, b: T) => boolean = Object.is,
): AvailabilityResult<ReplayObservation<T>> {
  if (!isReplayMs(query.cursorMs)) return { kind: 'unavailable', reason: 'invalid-query' };
  const observedBy = query.mode === 'exchange-retrospective' ? null : query.observer;
  if (observedBy === '') return { kind: 'unavailable', reason: 'invalid-query' };
  let latest = -1;
  let hasEventTime = false;
  const candidates = new Map<string, ReplayObservation<T>>();
  const identified = new Map<string, ReplayObservation<T>>();
  let matched = false;
  let knownClock = false;
  for (const sample of observations) {
    if (observedBy !== null && observedBy !== sample.observer) continue;
    matched = true;
    const cutoff = query.mode === 'exchange-retrospective' ? sample.eventAtMs
      : query.mode === 'known-at-receipt' ? sample.receivedAtMs : sample.availableAtMs;
    if (!isReplayMs(cutoff)) continue;
    knownClock = true;
    if (cutoff > query.cursorMs || (sample.eventAtMs !== null && (!isReplayMs(sample.eventAtMs) || sample.eventAtMs > query.cursorMs))) continue;
    if (query.mode === 'known-to-application' && (!isReplayMs(sample.receivedAtMs) || sample.receivedAtMs > cutoff)) continue;
    const identity = JSON.stringify([sample.observer, sample.session, sample.receiveSeq]);
    const same = identified.get(identity);
    if (same) {
      if (sample.eventAtMs !== same.eventAtMs || sample.revision !== same.revision || sample.receivedAtMs !== same.receivedAtMs
        || sample.availableAtMs !== same.availableAtMs || !sameValue(sample.value, same.value)) {
        return { kind: 'unavailable', reason: 'conflict' };
      }
      continue;
    }
    identified.set(identity, sample);
    const timed = sample.eventAtMs !== null;
    const time = sample.eventAtMs ?? cutoff;
    if ((hasEventTime && !timed) || (timed === hasEventTime && time < latest)) continue;
    if (timed !== hasEventTime || time > latest) {
      hasEventTime = timed;
      latest = time;
      candidates.clear();
    }
    const key = JSON.stringify([sample.observer, sample.session]);
    const previous = candidates.get(key);
    if (!previous || sample.receiveSeq > previous.receiveSeq) candidates.set(key, sample);
  }
  const winner = candidates.values().next().value;
  if (candidates.size > 1) return { kind: 'unavailable', reason: 'conflict' };
  if (winner) return { kind: 'observed', sample: winner };
  if (!matched && observations.length && observedBy !== null) return { kind: 'unavailable', reason: 'wrong-observer' };
  if (matched && !knownClock) return { kind: 'unavailable', reason: query.mode === 'known-to-application' ? 'unknown-availability-time'
    : query.mode === 'exchange-retrospective' ? 'unknown-exchange-time' : 'unknown-receipt-time' };
  return { kind: 'unavailable', reason: 'no-sample-at-cursor' };
}
