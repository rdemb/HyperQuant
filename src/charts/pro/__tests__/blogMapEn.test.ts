import { describe, expect, it, vi } from 'vitest';
import type { BlogMap } from '../../../state/useBlogMaps';

// Strona po angielsku: język ustalany raz przy starcie modułu i18n
vi.mock('../../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../../i18n')>();
  return { ...m, lang: 'en', tr: <T,>(_pl: T, en: T): T => en };
});

const { blogMapModel } = await import('../chart/blogMapLayer');
const { fmtPx } = await import('../chart/layout');
const { fmtHm } = await import('../core/time');

const PUB = Date.UTC(2026, 10, 7, 7, 12);
const MAP: BlogMap = {
  id: '2026-11-07-mapa-dnia',
  title: 'BTC 75 696 przed Londynem',
  kind: 'dzien',
  publishedAt: PUB,
  price: 75_696,
  levels: [
    { label: 'Szczyt Azji', price: 76_400 },
    { label: 'Likwidacje shortów', price: 76_650 },
  ],
  url: 'blog/2026-11-07-mapa-dnia/',
};

describe('mapa z bloga w wersji angielskiej', () => {
  it('podpisy poziomów w brzmieniu autora, „(PL blog)” raz w etykiecie mapy', () => {
    const m = blogMapModel(MAP, { now: PUB + 3_600_000, marks: { settled: null, note: null } });
    expect(m.tag).toBe(`Day map ${fmtHm(PUB)} (PL blog)`);
    expect(m.levels.map((l) => l.text)).toEqual([`Likwidacje shortów ${fmtPx(76_650)}`, `Szczyt Azji ${fmtPx(76_400)}`]);
    expect(m.levels.some((l) => l.text.includes('PL blog'))).toBe(false);
    expect(blogMapModel(MAP, { now: PUB, marks: { settled: null, note: 'not settled' } }).tag).toBe(`Day map ${fmtHm(PUB)} (PL blog) · not settled`);
  });
});
