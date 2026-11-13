import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Widok „Rynki” opisuje rynki, nie ocenia ruchu ceny: bez kolumny zmiany ceny (`prevDayPx`), bez kolorów kupna i sprzedaży
 * ani strzałek kierunku, bez słowa „sygnał”/„signal”; każdy tekst przez `tr` (PL i EN).
 */
describe('widok „Rynki”: bez kierunku ceny i ocen', () => {
  const files = ['../MarketsView.tsx', '../../utils/marketsTable.ts', '../../state/useMarketsTable.ts'].map((f) => [f, readFileSync(new URL(f, import.meta.url), 'utf8')] as const);

  it('bez zmiany ceny, kolorów strony rynku, strzałek i słowa „sygnał”', () => {
    for (const [f, src] of files) {
      expect(src, f).not.toMatch(/prevDayPx|changePct/);
      expect(src, f).not.toMatch(/text-(buy|sell)|bg-(buy|sell)|text-warn|text-red|text-green/);
      expect(src, f).not.toMatch(/[▲▼↑↓]/);
      expect(src, f).not.toMatch(/sygna|signal/i);
      expect(src, f).not.toMatch(/bullish|bearish|wzrost|spadek|rośnie|spada/i);
    }
  });

  it('teksty widoku przez tr (nagłówki kolumn po polsku i angielsku)', () => {
    const view = files[0][1];
    for (const pair of ["tr('Rynek', 'Market')", "tr('Cena', 'Price')", "tr('Obrót 24 h', '24h volume')", "tr('Otwarte pozycje', 'Open interest')", "tr('Funding 1 h', 'Funding 1h')", "tr('Wykres', 'Chart')", "tr('Skaner', 'Scanner')"])
      expect(view).toContain(pair);
  });
});
