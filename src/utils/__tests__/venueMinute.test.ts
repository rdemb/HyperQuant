import { expect, it } from 'vitest';
import { reconcileVenueBasket, reconcileVenueMinute } from '../venueMinute';

it('recognizes zero as a separate outcome and rejects invalid volume without mixing sources', () => {
  const shared = { from: 60_000, to: 120_000, market: 'BTC-perpetual', unit: 'BTC', scale: 5, final: true, complete: true };
  const input = { ...shared, venues: ['hyperliquid', 'binance'], samples: [
    { ...shared, venue: 'hyperliquid', volume: 10n, buy: 8n },
    { ...shared, venue: 'binance', volume: 10n, buy: 5n },
  ] };
  expect(reconcileVenueMinute(input)).toMatchObject({ comparable: true,
    byVenue: [{ kind: 'observed', sign: 'buy', delta: 6n }, { kind: 'observed', sign: 'zero', delta: 0n }] });
  input.samples[1].buy = 11n;
  expect(reconcileVenueMinute(input)).toMatchObject({ comparable: false,
    byVenue: [{ kind: 'observed' }, { kind: 'unavailable', reason: 'invalid-volume' }] });
  input.samples[1].unit = 'USD';
  expect(reconcileVenueMinute(input).byVenue[1]).toMatchObject({ reason: 'wrong-scope' });
  expect(reconcileVenueMinute({ ...input, samples: [input.samples[0]] }).byVenue[1]).toMatchObject({ reason: 'missing' });
});

it('does not substitute a partial basket for a versioned total, and compares each omitted constituent', () => {
  const shared = { from: 60_000, to: 120_000, market: 'BTC-perpetual', unit: 'BTC', scale: 5, final: true, complete: true };
  const samples = [{ ...shared, venue: 'hyperliquid', volume: 10n, buy: 8n }, { ...shared, venue: 'binance', volume: 10n, buy: 2n }];
  const input = { ...shared, revision: 'public-pair-v1', venues: ['hyperliquid', 'binance'], samples };
  expect(reconcileVenueBasket(input)).toMatchObject({ kind: 'complete', total: 0n,
    composition: ['hyperliquid', 'binance'], without: [{ venue: 'hyperliquid', total: -6n }, { venue: 'binance', total: 6n }] });
  expect(reconcileVenueBasket({ ...input, samples: samples.slice(0, 1) })).toMatchObject({ kind: 'incomplete', total: null,
    byVenue: [{ kind: 'observed', delta: 6n }, { kind: 'unavailable', reason: 'missing' }] });
});

it('agrees with separate buy and sell ledgers across input orders, cancellation and one-quantum changes', () => {
  const scope = { from: 0, to: 60_000, market: 'BTC-perp', unit: 'BTC', scale: 5, final: true, complete: true };
  const large = BigInt(Number.MAX_SAFE_INTEGER) + 50n;
  const venues = ['hyperliquid', 'binance'];
  for (const offset of [-1n, 0n, 1n]) {
    const ledger = [{ buy: large + 100n, sell: large }, { buy: large, sell: large + 100n + offset }];
    const rows = ledger.map(({ buy, sell }, i) => ({ ...scope, venue: venues[i], buy, volume: buy + sell }));
    for (const order of [venues, [...venues].reverse()]) {
      for (const samples of [rows, [...rows].reverse()]) {
        const result = reconcileVenueBasket({ ...scope, revision: 'test-v1', venues: order, samples });
        const reference = ledger.map(({ buy, sell }) => buy - sell);
        expect(result.total).toBe(reference[0] + reference[1]);
        expect(Object.fromEntries(result.without.map(row => [row.venue, row.total])))
          .toEqual({ [venues[0]]: reference[1], [venues[1]]: reference[0] });
      }
    }
  }
});

it('refuses missing, conflicting and duplicate source rows without hiding a healthy constituent', () => {
  const scope = { from: 0, to: 60_000, market: 'BTC-perp', unit: 'BTC', scale: 5, final: true, complete: true, revision: 'scope-v1' };
  const a = { ...scope, venue: 'hyperliquid', volume: 4n, buy: 3n };
  const b = { ...scope, venue: 'binance', volume: 4n, buy: 1n };
  const venues = [a.venue, b.venue];
  for (const [samples, reason] of [[[a], 'missing'], [[a, b, b], 'duplicate'],
    [[a, b, { ...b, buy: 2n }], 'duplicate'], [[a, { ...b, complete: false }], 'gap']] as const) {
    for (const ordered of [samples, [...samples].reverse()]) {
      expect(reconcileVenueBasket({ ...scope, venues, samples: ordered })).toMatchObject({
        kind: 'incomplete', total: null, without: [],
        byVenue: [{ kind: 'observed', delta: 2n }, { kind: 'unavailable', reason }],
      });
    }
  }
  expect(reconcileVenueBasket({ ...scope, venues: [...venues, a.venue], samples: [a, b] }).total).toBeNull();
});

it('refuses malformed time and unit metadata even if both venues repeat the same values', () => {
  const scope = { from: 0, to: 60_000, market: 'BTC-perp', unit: 'BTC', scale: 5, final: true, complete: true, revision: 'scope-v1' };
  const venues = ['hyperliquid', 'binance'];
  const nearOverflow = Number.MAX_SAFE_INTEGER - (Number.MAX_SAFE_INTEGER % 60_000);
  for (const fields of [{ from: -60_000, to: 0 }, { from: nearOverflow, to: nearOverflow + 60_000 },
    { scale: -5 }, { scale: 1.5 }, { market: '' }, { unit: '' }]) {
    const metadata = { ...scope, ...fields };
    const samples = venues.map(venue => ({ ...metadata, venue, volume: 4n, buy: 3n }));
    expect(reconcileVenueBasket({ ...metadata, venues, samples })).toMatchObject({
      kind: 'incomplete', total: null,
      byVenue: [{ kind: 'unavailable', reason: 'wrong-scope' }, { kind: 'unavailable', reason: 'wrong-scope' }],
    });
  }
});
