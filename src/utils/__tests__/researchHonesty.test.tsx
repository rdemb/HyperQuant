import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QuantMathMetrics } from '../../types/trading';

/**
 * Badania bez zmyślonych liczb: „paliwo likwidacyjne” nie powstaje ze stałych w USD, reżimy opisują przeszłość
 * (bez „bullish/bearish”), a brak danych to „—” z powodem zamiast zera albo 0,5.
 */

const S = vi.hoisted(() => ({ lang: 'pl' as 'pl' | 'en' }));
vi.mock('../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../i18n')>();
  return { ...m, tr: <T,>(pl: T, en: T): T => (S.lang === 'en' ? en : pl) };
});

/** Pliki źródłowe w src poza testami */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

// Wzorzec złożony z części, żeby sam test nie zawierał szukanych liczb (rg po src ma być pusty)
const CONSTS = new RegExp(['42' + '0000', '42' + '0_000', '38' + '00000', '3_8' + '00_000'].join('|'));

describe('Badania: paliwo likwidacyjne bez stałych w USD', () => {
  it('w kodzie src nie ma stałych paliwa (420 tys. i 3,8 mln USD)', () => {
    const hits = sources('src').filter((p) => CONSTS.test(readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('silnik nie zwraca pól paliwa; panel pokazuje „—” z powodem', async () => {
    const { computeQuantMathAndNeuralForecast } = await import('../quantMathEngine');
    const { buildHyperliquidBar, recalculateIndicatorSeries } = await import('../marketDataFeed');
    const bars = recalculateIndicatorSeries(
      Array.from({ length: 60 }, (_, i) => buildHyperliquidBar(100_000 + i, 100_050 + i, 99_950 + i, 100_010 + i, 30, 300, i * 300_000, 50))
    );
    const sh = { pwh: 101_000, pwl: 99_000, weq: 100_000, pwh2: null, pwl2: null, pdh: 100_500, pdl: 99_500, deq: 100_000, pdhStatus: 'Active', pdlStatus: 'Active', nySession: 'No Active Session', nyTimeFormatted: '', atr14: 100, orderBlocks: [] } as const;
    const q = computeQuantMathAndNeuralForecast(bars, { ...sh, orderBlocks: [] }, [], [], [], []);
    expect(q).not.toHaveProperty('shortSqueezeFuelUsd');
    expect(q).not.toHaveProperty('longCascadeFuelUsd');
    expect(q.liquidityProfile.length).toBeGreaterThan(0);
    for (const b of q.liquidityProfile) expect(b).not.toHaveProperty('liquidationPoolUsd');

    S.lang = 'pl';
    const { LiquidityMicrostructureLab } = await import('../../components/LiquidityMicrostructureLab');
    const html = renderToStaticMarkup(<LiquidityMicrostructureLab quant={q} shaakuni={{ ...sh, orderBlocks: [] }} currentPrice={100_070} book={{ bids: [], asks: [] }} />);
    const fuel = html.slice(html.indexOf('Paliwo'), html.indexOf('Arkusz L2'));
    expect(fuel).toContain('—');
    expect(fuel).toContain('brak pozycji kont w tym widoku');
    expect(fuel).not.toMatch(/\d+%/);
  });
});

describe.each(['pl', 'en'] as const)('Badania: nazwy reżimów opisowe (%s)', (lang) => {
  it('żaden reżim nie nazywa się „bullish/bearish” ani „wzrostowa/spadkowa”', async () => {
    S.lang = lang;
    vi.resetModules();
    const { QuantRegimePanel, REGIME_TEXT } = await import('../../components/QuantSignalDesk');
    const { emptyQuantMetrics } = await import('../quantMathEngine');
    const keys = Object.keys(REGIME_TEXT) as QuantMathMetrics['regimeClassification'][];
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const k of keys) {
      expect(k).not.toMatch(/bullish|bearish/i);
      const html = renderToStaticMarkup(<QuantRegimePanel quant={{ ...emptyQuantMetrics(), regimeClassification: k }} currentPrice={100_000} timeframeSec={300} />);
      expect(html, k).not.toMatch(/bullish|bearish|wzrostow|spadkow|popytow|podażow/i);
    }
  });
});

describe('Badania: brak danych to „—”, nie wartość zastępcza', () => {
  it('VPIN bez wolumenu i Hurst z za krótkiej albo płaskiej serii → null', async () => {
    const { computeVpinBvc, emptyQuantMetrics, hurstAnisLloyd } = await import('../quantMathEngine');
    const { buildHyperliquidBar, recalculateIndicatorSeries } = await import('../marketDataFeed');
    const flat = recalculateIndicatorSeries(Array.from({ length: 30 }, (_, i) => buildHyperliquidBar(100_000, 100_000, 100_000, 100_000, 0, 300, i * 300_000, 50)));
    expect(computeVpinBvc(flat.map((b) => ({ ...b, vbuy: 0, vsell: 0 })))).toBeNull();
    expect(hurstAnisLloyd([0.001, -0.002, 0.001])).toBeNull();
    expect(hurstAnisLloyd(Array.from({ length: 45 }, () => 0))).toBeNull();
    expect(emptyQuantMetrics().vpinToxicity).toBeNull();
    expect(emptyQuantMetrics().hurstExponent).toBeNull();
  });

  it('kafle VPIN i Hurst pokazują „—” z powodem', async () => {
    S.lang = 'pl';
    vi.resetModules();
    const { QuantMetricTiles } = await import('../../components/QuantSignalDesk');
    const { emptyQuantMetrics } = await import('../quantMathEngine');
    const html = renderToStaticMarkup(<QuantMetricTiles quant={emptyQuantMetrics()} />);
    expect(html).not.toMatch(/H 0,500/);
    expect(html).not.toMatch(/>0,0%</);
    expect(html).toContain('za mało zwrotów');
    expect(html).toContain('brak wolumenu');
  });

  it('ATR przy braku świec to brak liczby, nie 0', async () => {
    const { computeShaakuniIndicator } = await import('../shaakuniEngine');
    const s = computeShaakuniIndicator([], { tzChoice: 'Auto (DST)' } as Parameters<typeof computeShaakuniIndicator>[1]);
    expect(Number.isNaN(s.atr14)).toBe(true);
  });
});
