import { describe, expect, it } from 'vitest';
import { SAME_PRICE_TOL, crossVenueRows } from '../crossVenue';
import type { UniverseMarket } from '../hlUniverse';

/** Rynek uniwersum: `funding` — stawka godzinowa (ułamek). */
const m = (coin: string, markPx: number, oiUsd: number, funding: number | null = null, oraclePx: number | null = null): UniverseMarket => ({
  coin,
  dex: coin.includes(':') ? coin.split(':')[0] : '',
  szDecimals: 2,
  maxLeverage: 10,
  markPx,
  oiUsd,
  volume24hUsd: 0,
  funding,
  oraclePx,
});

// Z prawdziwego odczytu (28.11.2026): NVDA u xyz i io, STX — Stacks na giełdzie głównej i akcje Seagate u para, ANTH z ceną 17×
const LIST = [
  m('xyz:NVDA', 147.0, 3e8, 0.0000125, 146.9),
  m('io:NVDA', 147.3, 6.6e7, 0.0000010, 147.0),
  m('STX', 0.52, 5e7),
  m('para:STX', 506, 1.3e6),
  m('para:ANTH', 91.42, 1e6),
  m('io:ANTH', 1610, 6.7e7),
  m('xyz:TSLA', 398, 2e8),
  m('BTC', 60_000, 2e9),
];

describe('crossVenueRows — ten sam instrument u kilku wystawców', () => {
  it('grupa ze zgodną ceną: rozjazd mark i oracle w pb, premia każdego wystawcy wobec średniej, różnica finansowania w pp', () => {
    const rows = crossVenueRows(LIST, 'oi', '');
    expect(rows.map((r) => r.name)).toEqual(['NVDA']);
    const r = rows[0];
    expect(r.venues.map((v) => v.venue)).toEqual(['xyz', 'io']);
    expect(r.spread).toBe('20.4 pb'); // (147,3 − 147,0) / 147,15
    expect(r.oracleSpread).toBe('6.8 pb'); // (147,0 − 146,9) / 146,95
    expect(r.venues.map((v) => v.premium)).toEqual(['−10.2 pb', '+10.2 pb']);
    // 0,0000125 × 24 × 365 × 100 = 10,95%; 0,000001 → 0,876%
    expect(r.venues.map((v) => v.funding)).toEqual(['+11.0%', '+0.9%']);
    expect(r.fundingGap).toBe('10.1 pp');
    expect(r.venues.map((v) => v.coin)).toEqual(['xyz:NVDA', 'io:NVDA']);
  });

  it(`ta sama nazwa, inna cena (ponad ${SAME_PRICE_TOL * 100}% od rynku z największym OI) to inny instrument: STX i ANTH bez grupy`, () => {
    const names = crossVenueRows(LIST, 'oi', '').map((r) => r.name);
    expect(names).not.toContain('STX');
    expect(names).not.toContain('ANTH');
    // Trzeci wystawca z ceną spoza progu wypada, dwóch zgodnych zostaje
    const three = crossVenueRows([...LIST, m('para:NVDA', 160, 1e6)], 'oi', '');
    expect(three[0].venues.map((v) => v.venue)).toEqual(['xyz', 'io']);
  });

  it('sortowanie: otwarte pozycje razem, rozjazd ceny, różnica finansowania (brak finansowania na końcu); filtr po nazwie i wystawcy', () => {
    const list = [...LIST, m('xyz:AAPL', 358.0, 1e8, 0.00001), m('io:AAPL', 358.1, 3e7, -0.00002), m('xyz:MU', 641.5, 1e8), m('io:MU', 642.5, 5e7)];
    expect(crossVenueRows(list, 'oi', '').map((r) => r.name)).toEqual(['NVDA', 'MU', 'AAPL']); // 366 mln, 150 mln, 130 mln
    expect(crossVenueRows(list, 'spread', '').map((r) => r.name)).toEqual(['NVDA', 'MU', 'AAPL']);
    expect(crossVenueRows(list, 'funding', '').map((r) => r.name)).toEqual(['AAPL', 'NVDA', 'MU']);
    expect(crossVenueRows(list, 'funding', '').find((r) => r.name === 'MU')!.fundingGap).toBe('—');
    expect(crossVenueRows(list, 'oi', 'mu').map((r) => r.name)).toEqual(['MU']);
    expect(crossVenueRows(list, 'oi', 'io aapl').map((r) => r.name)).toEqual(['AAPL']);
  });

  it('bez oracle u co najmniej dwóch wystawców — „—”; pojedynczy rynek albo sama giełda główna — brak grupy', () => {
    const rows = crossVenueRows([m('xyz:MU', 641.5, 1e8), m('io:MU', 642.5, 5e7, null, 642)], 'oi', '');
    expect(rows[0].oracleSpread).toBe('—');
    expect(crossVenueRows([m('xyz:TSLA', 398, 2e8), m('BTC', 60_000, 2e9)], 'oi', '')).toEqual([]);
  });
});
