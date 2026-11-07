import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { L2OrderbookLevel } from '../../../types/trading';
import { bookDepth } from '../../../utils/bookDepth';
import { DepthStat } from '../DepthStat';

const lvl = (sizeUsd: number): L2OrderbookLevel => ({ price: 75_000, sizeBtc: sizeUsd / 75_000, sizeUsd, cumulativeUsd: sizeUsd, exchangeCount: 1 });

describe('głębokość arkusza L2', () => {
  it('bez migawki arkusza (żadnego poziomu) — brak liczby, nie $0', () => {
    expect(bookDepth([], [])).toBeNull();
  });

  it('z migawką: suma 12 najbliższych poziomów strony; strona bez poziomów to prawdziwe 0', () => {
    const bids = Array.from({ length: 15 }, () => lvl(100_000));
    expect(bookDepth(bids, [lvl(250_000)])).toEqual({ bid: 1_200_000, ask: 250_000, bidShare: 1_200_000 / 1_450_000 });
    expect(bookDepth(bids, [])).toEqual({ bid: 1_200_000, ask: 0, bidShare: 1 });
    // Liczba spoza zakresu w poziomie nie psuje sumy
    expect(bookDepth([lvl(Number.NaN), lvl(50_000)], [lvl(50_000)])).toEqual({ bid: 50_000, ask: 50_000, bidShare: 0.5 });
  });

  it('kafel bez arkusza: „—” z powodem i stanem BRAK, bez LIVE i bez $0', () => {
    const html = renderToStaticMarkup(<DepthStat depth={null} />);
    expect(html).toContain('>—<');
    expect(html).toContain('Czekam na arkusz');
    expect(html).toMatch(/>BRAK</);
    expect(html).not.toMatch(/>LIVE<|\$0/);
  });

  it('kafel z arkuszem: LIVE, obie strony; pusta strona to prawdziwe $0', () => {
    const html = renderToStaticMarkup(<DepthStat depth={{ bid: 1_200_000, ask: 0, bidShare: 1 }} />);
    expect(html).toMatch(/>LIVE</);
    expect(html).toContain('$1,2M');
    expect(html).toContain('$0');
    expect(html).toContain('BID 100%');
  });

  it('pas kontekstu Przed sesją i Badania liczą głębokość z arkusza (bookDepth), nie z zera metryk', () => {
    expect(readFileSync('src/views/desk/DeskRail.tsx', 'utf8')).toMatch(/<DepthStat depth=\{bookDepth\(feed\.bids, feed\.asks\)\}/);
    expect(readFileSync('src/components/LiquidityMicrostructureLab.tsx', 'utf8')).toMatch(/bookDepth\(/);
  });
});
