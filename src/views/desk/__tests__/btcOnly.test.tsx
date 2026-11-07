import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CohortFlowPanel } from '../CohortFlowPanel';
import { LiquidationTape } from '../LiquidationTape';

// Build z adresem danych skanera (status „ładuję”), więc panele nie znikają jak w buildzie bez niego
vi.mock('../../../state/useCohortFlow', () => ({ useCohortFlow: () => ({ status: 'loading', flow: null }) }));
vi.mock('../../../state/useLiqTape', () => ({ useLiqTape: () => ({ status: 'loading', tape: null }) }));

describe('W sesji: kohorty i likwidacje tylko dla BTC', () => {
  it('przepływ kohort: podpis z BTC; na innym rynku wykresu ramka z „—, tylko BTC” zamiast danych BTC', () => {
    const btc = renderToStaticMarkup(<CohortFlowPanel coin="BTC" />);
    expect(btc).toContain('Kto kupuje, kto sprzedaje · BTC · Hyperliquid');
    expect(btc).toContain('Pobieram przepływ kohort');
    const eth = renderToStaticMarkup(<CohortFlowPanel coin="ETH" />);
    expect(eth).toContain('Kto kupuje, kto sprzedaje · BTC · Hyperliquid');
    expect(eth).toContain('—, tylko BTC');
    expect(eth).not.toContain('Pobieram przepływ kohort');
  });

  it('taśma likwidacji: na innym rynku wykresu „—, tylko BTC”', () => {
    const btc = renderToStaticMarkup(<LiquidationTape coin="BTC" coverage={null} />);
    expect(btc).toContain('Pobieram taśmę likwidacji');
    const eth = renderToStaticMarkup(<LiquidationTape coin="SOL" coverage={null} />);
    expect(eth).toContain('—, tylko BTC');
    expect(eth).not.toContain('Pobieram taśmę likwidacji');
    // Bez rynku (mapa likwidacji BTC przed sesją): jak dotąd
    expect(renderToStaticMarkup(<LiquidationTape coverage={null} />)).toContain('Pobieram taśmę likwidacji');
  });
});
