import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CohortFlowPanel } from '../CohortFlowPanel';
import { LiquidationTape } from '../LiquidationTape';

// Build z adresem danych skanera (status „ładuję”), więc panele nie znikają jak w buildzie bez niego
vi.mock('../../../state/useCohortFlow', () => ({ useCohortFlow: () => ({ status: 'loading', flow: null }) }));
vi.mock('../../../state/useLiqTape', () => ({ useLiqTape: () => ({ status: 'loading', tape: null }) }));

describe('W sesji: kohorty i likwidacje tylko na rynku ze skanerem (dziś BTC)', () => {
  it('przepływ kohort: podpis z BTC; na rynku bez skanera ramka z „—, bez skanera” zamiast danych BTC', () => {
    const btc = renderToStaticMarkup(<CohortFlowPanel coin="BTC" />);
    expect(btc).toContain('Kto kupuje, kto sprzedaje · BTC · Hyperliquid');
    expect(btc).toContain('Pobieram przepływ kohort');
    const eth = renderToStaticMarkup(<CohortFlowPanel coin="ETH" />);
    expect(eth).toContain('Kto kupuje, kto sprzedaje · BTC · Hyperliquid');
    expect(eth).toContain('—, bez skanera');
    expect(eth).not.toContain('Pobieram przepływ kohort');
    expect(renderToStaticMarkup(<CohortFlowPanel coin="xyz:NVDA" />)).toContain('—, bez skanera');
  });

  it('taśma likwidacji: na rynku bez skanera „—, bez skanera”', () => {
    const btc = renderToStaticMarkup(<LiquidationTape coin="BTC" coverage={null} />);
    expect(btc).toContain('Pobieram taśmę likwidacji');
    const eth = renderToStaticMarkup(<LiquidationTape coin="SOL" coverage={null} />);
    expect(eth).toContain('—, bez skanera');
    expect(eth).not.toContain('Pobieram taśmę likwidacji');
    // Bez rynku (mapa likwidacji BTC przed sesją): jak dotąd
    expect(renderToStaticMarkup(<LiquidationTape coverage={null} />)).toContain('Pobieram taśmę likwidacji');
  });
});
