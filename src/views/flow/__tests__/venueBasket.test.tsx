import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import VenueBasket from '../VenueBasket';

// Próbka Astry: 07:21 UTC pełny koszyk −6,32662 BTC, bez Hyperliquid +5,00800 BTC (znak się zmienia), bez Binance −11,33462 BTC
it('odtwarza sumę i oba pominięcia z publicznej minuty 07:21 UTC', () => {
  const html = renderToStaticMarkup(<VenueBasket />);
  expect(html).toContain('Pełny koszyk: −6,32662 BTC');
  expect(html).toMatch(/Bez Hyperliquid: \+5,00800 BTC · znak się zmienia/);
  expect(html).toMatch(/Bez Binance USD-M: −11,33462 BTC · znak bez zmiany/);
  expect(html).toContain('Znak pełnego koszyka zależy od: Hyperliquid.');
  expect(html).not.toMatch(/sygna/i);
});
