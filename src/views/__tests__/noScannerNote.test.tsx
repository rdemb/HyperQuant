import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoScannerNote } from '../SessionView';
import { publishedHistoryRange } from '../../state/historyAvailability';
import { HIST_PART_MS, HISTORY_VERSION, type HistoryIndex } from '../../utils/tapeHistory';

const from = Date.UTC(2026, 10, 19, 7);
const indexFor = (coin: string): HistoryIndex => ({
  v: HISTORY_VERSION, asOf: from + HIST_PART_MS, keepDays: 7, partMs: HIST_PART_MS,
  markets: { [coin]: { hours: [], parts: [from] } },
});

describe('W sesji: rynek bez skanera', () => {
  it.each([
    ['xyz:GOLD', 'xyz:SP500', 'złota'],
    ['xyz:SP500', 'xyz:GOLD', 'S&amp;P 500'],
  ])('archiwum %s jest dostępne niezależnie od skanera kont i drugiego rynku', (coin, other, name) => {
    const index = indexFor(coin);
    const render = (market: string) => renderToStaticMarkup(<NoScannerNote coin={market} archive={publishedHistoryRange(index, market)} />);
    const html = render(coin);
    expect(html).toContain('obsługuje tylko BTC');
    expect(html).toContain(`Dla ${name} masz na żywo taśmę`);
    expect(html).toContain('Nagrania taśmy i arkusza są dostępne');
    expect(html).not.toContain('Indeks nie zawiera nagrań');
    expect(render(other)).toContain('Indeks nie zawiera nagrań');
    expect(render(coin)).toBe(html);
  });

  it('brak odczytu indeksu pokazuje stan nieustalony', () => {
    const html = renderToStaticMarkup(<NoScannerNote coin="xyz:GOLD" archive={publishedHistoryRange(null, 'xyz:GOLD')} />);
    expect(html).toContain('Dostępność nagrań jest jeszcze nieustalona');
    expect(html).not.toContain('Indeks nie zawiera nagrań');
  });
});
