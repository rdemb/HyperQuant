import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuctionContext } from '../../../state/useAuctionContext';
import { AuctionContextPanel } from '../AuctionContextPanel';

const H = 3_600_000;
const state = vi.hoisted(() => ({ ctx: null as unknown as AuctionContext }));
vi.mock('../../../state/useAuctionContext', () => ({ useAuctionContext: () => state.ctx }));
vi.mock('../../../state/DeskContext', () => ({ useDesk: () => ({ feed: { currentPrice: 100_000 } }) }));

const base = (session: AuctionContext['session'], next: AuctionContext['next'] = null): AuctionContext => ({
  status: 'ready',
  asOf: Date.now(),
  session,
  next,
  vwap: null,
  ib: null,
  prev: null,
  today: null,
  stats: null,
});

describe('Kontekst aukcji: podpis sesji Londynu albo NY', () => {
  it('sesja w toku: „Sesja Londyn” / „Sesja NY” zamiast sesji UTC', () => {
    const l = Date.UTC(2026, 10, 3, 8);
    state.ctx = base({ id: 'london', start: l, end: l + 6.5 * H, ibEnd: l + H, closed: false });
    const html = renderToStaticMarkup(<AuctionContextPanel />);
    expect(html).toContain('Sesja Londyn');
    expect(html).not.toContain('Sesja UTC');
    const n = Date.UTC(2026, 10, 3, 14, 30);
    state.ctx = base({ id: 'ny', start: n, end: Date.UTC(2026, 10, 4), ibEnd: n + H, closed: false });
    expect(renderToStaticMarkup(<AuctionContextPanel />)).toContain('Sesja NY');
  });

  it('w Azji: ostatnia zamknięta sesja NY oznaczona jako zamknięta i godzina otwarcia Londynu', () => {
    const n = Date.UTC(2026, 10, 2, 14, 30);
    const l = Date.UTC(2026, 10, 3, 8);
    state.ctx = base({ id: 'ny', start: n, end: Date.UTC(2026, 10, 3), ibEnd: n + H, closed: true }, { id: 'london', start: l, end: l + 6.5 * H, ibEnd: l + H });
    const html = renderToStaticMarkup(<AuctionContextPanel />);
    expect(html).toContain('Sesja NY (zamknięta)');
    expect(html).toContain('Następna: Londyn o 08:00 UTC');
  });
});
