import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Widok „Rynki” opisuje rynki, nie ocenia ruchu ceny: bez kolumny zmiany ceny (`prevDayPx`), bez kolorów kupna i sprzedaży
 * ani strzałek kierunku, bez słowa „sygnał”/„signal”; każdy tekst przez `tr` (PL i EN). Dane w czystych modułach i jednym
 * hooku, komponenty w `views/markets/` tylko pokazują gotowe teksty (nowy wygląd da się nałożyć bez ruszania danych).
 */
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const parts = readdirSync(new URL('../markets/', import.meta.url)).filter((f) => f.endsWith('.tsx'));
const views = ['../MarketsView.tsx', ...parts.map((f) => `../markets/${f}`)].map((f) => [f, read(f)] as const);
const logic = ['../../utils/marketsTable.ts', '../../state/useMarketsTable.ts', '../../utils/wallStreet.ts'].map((f) => [f, read(f)] as const);

describe('widok „Rynki”: bez kierunku ceny i ocen', () => {
  it('bez zmiany ceny, kolorów strony rynku, strzałek i słowa „sygnał”', () => {
    for (const [f, src] of [...views, ...logic]) {
      expect(src, f).not.toMatch(/prevDayPx|changePct/);
      expect(src, f).not.toMatch(/text-(buy|sell)|bg-(buy|sell)|text-warn|text-red|text-green/);
      expect(src, f).not.toMatch(/[▲▼↑↓]/);
      expect(src, f).not.toMatch(/sygna|signal/i);
      expect(src, f).not.toMatch(/bullish|bearish|wzrost|spadek|rośnie|spada/i);
    }
  });

  it('nagłówki kolumn przez tr (PL i EN)', () => {
    const table = read('../markets/MarketList.tsx');
    for (const pair of ["tr('Rynek', 'Market')", "tr('Cena', 'Price')", "tr('Obrót 24 h', '24h volume')", "tr('Otwarte poz.', 'Open int.')", "tr('Funding 1 h', 'Funding 1h')", "tr('Wykres', 'Chart')"])
      expect(table).toContain(pair);
  });
});

describe('widok „Rynki”: dane osobno, wygląd osobno', () => {
  it('komponenty widoku: bez hooków danych i bez funkcji z utils (tylko typy), dane z jednego hooka useMarketsPage', () => {
    expect(parts.sort()).toEqual(expect.arrayContaining(['MarketList.tsx', 'WallStreetLabel.tsx']));
    for (const [f, src] of views.filter(([f]) => f.startsWith('../markets/'))) {
      // Hooki interfejsu (okno listy, React) wolno; hooków danych (stan desku, rynki, pliki publiczne) nie
      expect(src, f).not.toMatch(/\buse(Markets|Desk|Published|LiqMap|Ticker)\w*\(/);
      for (const m of src.matchAll(/^import (.+) from '(\.\.\/)+(utils|state|charts)\/[^']+';$/gm)) expect(m[1], `${f}: ${m[0]}`).toMatch(/^type /);
    }
    const view = views[0][1];
    // Jedyny hook danych widoku; useSyncExternalStore to szerokość ekranu (karty albo tabela), nie dane
    expect(view.match(/\buse(?!SyncExternalStore)[A-Z]\w*\(/g)).toEqual(['useMarketsPage(']);
    for (const m of view.matchAll(/^import (.+) from '\.\.\/utils\/[^']+';$/gm)) expect(m[1], m[0]).toMatch(/^type /);
  });

  it('kolumna Wall Street (przed Wykresem) i zdanie pod tabelą: etykieta opisuje giełdę bazową, rynek na Hyperliquid działa całą dobę', () => {
    const table = read('../markets/MarketList.tsx');
    const head = table.slice(table.indexOf('role="columnheader"'));
    expect(head.indexOf('{WALL_STREET}')).toBeGreaterThan(head.indexOf("tr('Funding 1 h', 'Funding 1h')"));
    expect(head.indexOf('{WALL_STREET}')).toBeLessThan(head.lastIndexOf("tr('Wykres', 'Chart')"));
    expect(table).toContain('<WallStreetLabel cell={row.wallStreet} />');
    const view = views[0][1];
    expect(view).toContain('Etykieta Wall Street opisuje giełdę bazową');
    expect(view).toContain('a nie rynek na Hyperliquid, który działa całą dobę');
    expect(view).toContain('not the market on Hyperliquid, which trades around the clock');
  });
});
