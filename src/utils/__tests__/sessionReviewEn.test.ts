import { describe, expect, it, vi } from 'vitest';
import type { BlogMap } from '../../state/useBlogMaps';
import type { VBar } from '../auction';

// Strona po angielsku: język ustalany raz przy starcie modułu i18n
vi.mock('../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../i18n')>();
  return { ...m, lang: 'en', tr: <T,>(_pl: T, en: T): T => en };
});

const { reviewRows } = await import('../sessionReview');
const { tradeSessionOn } = await import('../sessionDay');

const MIN = 60_000;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const NY = tradeSessionOn(at(2026, 11, 3, 0), 'ny');
const NOW = NY.end + 60 * MIN;
const map = (id: string, kind: BlogMap['kind'], publishedAt: number): BlogMap => ({
  id,
  title: id,
  kind,
  publishedAt,
  price: 100_000,
  levels: [{ label: 'Szczyt Azji', price: 100_050 }],
  url: `blog/${id}/`,
});
const bars: VBar[] = [];
for (let t = at(2026, 11, 2, 14, 30); t < NOW; t += MIN) bars.push({ time: t, open: 100_000, high: 100_010, low: 99_990, close: 100_000, volume: 1 });

describe('Rozliczenie po angielsku: mapy z polskiego bloga oznaczone na karcie', () => {
  it('„(PL blog)” raz na karcie, przy pierwszej mapie; podpisy poziomów w brzmieniu autora', () => {
    const rows = reviewRows({
      s: NY,
      inProgress: false,
      now: NOW,
      bars1m: bars,
      maps: { status: 'ready', maps: [map('2026-11-03-mapa-dnia', 'dzien', at(2026, 11, 3, 7, 5)), map('2026-11-03-przed-ny', 'ny', at(2026, 11, 3, 13))] },
      expected: undefined,
      liq: { status: 'loading', tape: null },
      cohorts: { status: 'loading', flow: null },
      ledger: { status: 'loading', summary: null },
    });
    const maps = rows.filter((r) => r.id === 'map');
    expect(maps).toHaveLength(2);
    expect(maps[0].label).toMatch(/^Day map .* \(PL blog\)$/);
    expect(maps[1].label).toMatch(/^Pre-NY map /);
    expect(maps[1].label).not.toContain('PL blog');
    expect(rows.filter((r) => r.label.includes('(PL blog)'))).toHaveLength(1);
    expect(maps[0].detail).toContain('Szczyt Azji');
  });
});
