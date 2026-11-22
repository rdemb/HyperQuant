type MinuteSample = {
  venue: string;
  market: string;
  unit: string;
  scale: number;
  from: number;
  to: number;
  final: boolean;
  complete: boolean;
  volume: bigint;
  buy: bigint;
};
type Reason = 'missing' | 'duplicate' | 'wrong-scope' | 'provisional' | 'gap' | 'invalid-volume';

export function reconcileVenueMinute(input: {
  venues: readonly string[];
  market: string;
  unit: string;
  scale: number;
  from: number;
  samples: readonly MinuteSample[];
}) {
  const end = input.from + 60_000;
  const validScope = Number.isSafeInteger(input.from) && input.from >= 0 && input.from % 60_000 === 0
    && Number.isSafeInteger(end) && Number.isSafeInteger(input.scale) && input.scale >= 0
    && input.market.trim() !== '' && input.unit.trim() !== '';
  const byVenue = [...new Set(input.venues)].map(venue => {
    const rows = input.samples.filter(row => row.venue === venue);
    const unavailable = (reason: Reason) => ({ venue, kind: 'unavailable', reason } as const);
    if (rows.length === 0) return unavailable('missing');
    if (rows.length !== 1) return unavailable('duplicate');
    const [row] = rows;
    if (!validScope || venue.trim() === '' || row.from !== input.from || row.to !== end
      || row.market !== input.market || row.unit !== input.unit || row.scale !== input.scale) {
      return unavailable('wrong-scope');
    }
    if (!row.final) return unavailable('provisional');
    if (!row.complete) return unavailable('gap');
    if (row.volume < 0n || row.buy < 0n || row.buy > row.volume) return unavailable('invalid-volume');
    const delta = 2n * row.buy - row.volume;
    const sign = delta > 0n ? 'buy' : delta < 0n ? 'sell' : 'zero';
    return { venue, kind: 'observed', delta, sign } as const;
  });
  return { byVenue, comparable: byVenue.length >= 2 && byVenue.every(row => row.kind === 'observed') };
}

/** A total is defined only for the whole declared basket. Healthy constituents stay readable on their own. */
export function reconcileVenueBasket(input: Parameters<typeof reconcileVenueMinute>[0] & { revision: string }) {
  const { byVenue, comparable } = reconcileVenueMinute(input);
  const composition = [...new Set(input.venues)];
  const base = { revision: input.revision, composition, byVenue };
  if (input.revision.trim() === '' || !comparable || composition.length !== input.venues.length) {
    return { ...base, kind: 'incomplete', total: null, without: [] } as const;
  }
  const observed = byVenue.filter(row => row.kind === 'observed');
  const total = observed.reduce((sum, row) => sum + row.delta, 0n);
  return { ...base, kind: 'complete', total, without: observed.map(row => ({ venue: row.venue, total: total - row.delta })) } as const;
}
