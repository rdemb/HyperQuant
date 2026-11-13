import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * „Rynki” w nawigacji aplikacji: w górnym pasku zaraz po fazach dnia (przed Blogiem), na telefonie w menu „Więcej”.
 * Miejsce przy 1024 px: Agenci AI w pasku dopiero od 1440 px, węższy ekran — menu „Więcej” na komputerze.
 */
describe('nawigacja aplikacji: widok „Rynki”', () => {
  const src = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
  const start = src.indexOf("<nav aria-label={tr('Główna'");
  const menu = src.indexOf('{topMore && (');
  const bar = src.slice(start, menu);
  const more = src.slice(menu, src.indexOf('</nav>', menu));
  const phone = src.slice(src.indexOf('{phoneMore && ('));

  it('etykieta PL i EN, widok leniwy pod #markets', () => {
    expect(src).toContain("const MARKETS: NavItem = { id: 'markets', label: tr('Rynki', 'Markets')");
    expect(src).toContain("const MarketsView = lazy(() => import('../views/MarketsView'));");
    expect(src).toContain("{view === 'markets' && <MarketsView />}");
  });

  it('pasek: po fazach dnia, przed Blogiem, na każdym komputerze (bez klasy ukrywającej)', () => {
    const phases = bar.indexOf('{PHASES.map(');
    const markets = bar.indexOf('<ViewLink id={MARKETS.id}');
    expect(markets).toBeGreaterThan(phases);
    expect(markets).toBeLessThan(bar.indexOf('href="./blog/"'));
    expect(bar).toContain('<ViewLink id={MARKETS.id} go={go} current={view === MARKETS.id} className={navLink(view === MARKETS.id)}>');
  });

  it('Agenci AI: w pasku od 1440 px, poniżej w menu „Więcej” na komputerze; telefon: Rynki pierwsze w menu „Więcej”', () => {
    expect(bar).toContain('className={`${navLink(view === AGENTS.id)} hidden min-[1440px]:inline`}');
    expect(more).toContain('<ViewLink id={AGENTS.id} go={go} current={view === AGENTS.id} more className={`${MENU_ITEM} min-[1440px]:hidden`}>');
    const first = phone.indexOf('<ViewLink');
    expect(phone.indexOf('<ViewLink id={MARKETS.id}')).toBe(first);
    expect(src).toContain('active={!!moreView || view === AGENTS.id || view === MARKETS.id}');
  });
});
