import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AggrTradeTick } from '../../types/trading';

/**
 * Taśma w Badaniach: wiersz likwidacji opisuje wymuszoną stronę transakcji, bez etykiet LONG/SHORT
 * (ani wielkimi literami z CSS). Widok taśmy włączony przez początkowy stan zakładki.
 */

const S = vi.hoisted(() => ({ lang: 'pl' as 'pl' | 'en' }));
vi.mock('../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../i18n')>();
  return { ...m, tr: <T,>(pl: T, en: T): T => (S.lang === 'en' ? en : pl) };
});
vi.mock('../../state/DeskContext', () => ({ useDesk: () => ({ cexEnabled: true, setView: () => {} }) }));
// Zakładka startuje na arkuszu; w teście od razu taśma
vi.mock('react', async (importOriginal) => {
  const R = await importOriginal<typeof import('react')>();
  const useState = ((init: unknown) => R.useState(init === 'dom_ofi' ? 'tape' : init)) as typeof R.useState;
  const mod = { ...R, useState };
  return { ...mod, default: mod };
});

const NOW = Date.UTC(2026, 10, 11, 12, 0);
const liq = (side: 'buy' | 'sell', i: number): AggrTradeTick => ({
  id: `liq-${side}-${i}`,
  timestamp: NOW - 2_000,
  exchange: 'BINANCE_FUTURES',
  market: 'BTCUSDT',
  isPerp: true,
  side,
  price: 100_000,
  sizeUsd: 250_000,
  sizeBtc: 2.5,
  isLiquidation: true,
  tier: 'huge',
});

describe.each(['pl', 'en'] as const)('Taśma: wiersz likwidacji (%s)', (lang) => {
  it('bez LONG/SHORT, z wymuszoną stroną transakcji', async () => {
    S.lang = lang;
    vi.resetModules();
    const { AggrOrderFlowTape } = await import('../AggrOrderFlowTape');
    const { buildHyperliquidBar } = await import('../../utils/marketDataFeed');
    const ofi = { ticks: [], overallBuySellRatio: 1, overallOfiPct: 0, exhaustionIndex: 0, exhaustionBias: 'BALANCED_EQUILIBRIUM', dominantExhaustionTick: null, exhaustionNote: '' } as const;
    const html = renderToStaticMarkup(
      <AggrOrderFlowTape trades={[liq('buy', 1), liq('sell', 2)]} latestBar={buildHyperliquidBar(100_000, 100_050, 99_950, 100_010, 30, 300, NOW - 60_000, 50)} ofiSummary={{ ...ofi, ticks: [] }} currentPrice={100_000} />
    );
    // Oba wiersze taśmy są wyrenderowane
    expect(html.match(/BIN-FUT/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/\b(LONG|SHORT)\b/);
    expect(html).not.toMatch(/LIQ /);
    expect(html).toContain(lang === 'en' ? 'forced buy' : 'wymusz. kupno');
    expect(html).toContain(lang === 'en' ? 'forced sell' : 'wymusz. sprzedaż');
    // Etykieta nie jest zamieniana na wielkie litery przez CSS
    const label = html.match(/<span class="([^"]*)"[^>]*>(?:wymusz\.|forced) /);
    expect(label?.[1]).not.toMatch(/\buppercase\b/);
  });
});
