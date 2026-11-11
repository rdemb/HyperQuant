import { describe, expect, it } from 'vitest';
import { compareBaseline, margin, metricsOf } from './baseline.mjs';

const report = {
  desktop: { share: 0.626, objects: { labels: 30, bubbles: 0, rects: 900, axisLabels: 20 } },
  desktopDom: { share: 0.6261 },
  phone: { share: 0.612 },
  phoneFocus: { share: 0.835 },
  phoneLandscape: { share: 0.859 },
  replayDesktop: { objects: { labels: 12, bubbles: 40, rects: 1500, axisLabels: 18 } },
  domColumn: { ladderRows: 20, tapeRowsFit: 12 },
  phoneIndicators: 9,
  effort: { desktop: 5, phone: 2 },
  clashes: { desktop: 9 },
};

describe('punkt odniesienia pomiaru układu', () => {
  it('liczby z raportu: udziały panelu ceny, obiekty na płótnach na widok, kolumna DOM, lista wskaźników', () => {
    const m = metricsOf(report);
    expect(m['share.desktop']).toBe(0.626);
    expect(m['share.desktopDom']).toBe(0.626);
    expect(m['objects.replay1440.bubbles']).toBe(40);
    expect(m['objects.live1440.labels']).toBe(30);
    expect(m['dom.ladderRows']).toBe(20);
    expect(m['phone.indicatorRows']).toBe(9);
    expect([m['effort.rects1440'], m['effort.rects390']]).toEqual([5, 2]);
    expect(m['clashes.objects1440']).toBe(9);
    expect(Object.keys(m).some((k) => k.includes('undefined'))).toBe(false);
  });

  it('zapas nad progiem w punktach procentowych', () => {
    expect(margin(0.626, 0.62)).toBe('+0,6 pp');
    expect(margin(0.598, 0.6)).toBe('−0,2 pp');
  });

  it('udział panelu: spadek ponad 0,5 pp poniżej odniesienia to różnica; wzrost — nie', () => {
    const base = { 'share.desktop': 0.626 };
    expect(compareBaseline({ 'share.desktop': 0.622 }, base)).toEqual([]);
    expect(compareBaseline({ 'share.desktop': 0.62 }, base)).toEqual(['share.desktop: 62,0% (odniesienie 62,6%)']);
    expect(compareBaseline({ 'share.desktop': 0.7 }, base)).toEqual([]);
  });

  it('liczby obiektów: odchylenie ponad 15% (i ponad 2) w którąkolwiek stronę to różnica; brak odniesienia — bez porównania', () => {
    const base = { 'objects.replay1440.bubbles': 40, 'objects.replay1440.labels': 4 };
    expect(compareBaseline({ 'objects.replay1440.bubbles': 45, 'objects.replay1440.labels': 6 }, base)).toEqual([]);
    expect(compareBaseline({ 'objects.replay1440.bubbles': 47, 'objects.replay1440.labels': 7 }, base)).toEqual([
      'objects.replay1440.bubbles: 47 (odniesienie 40)',
      'objects.replay1440.labels: 7 (odniesienie 4)',
    ]);
    expect(compareBaseline({ 'objects.new.x': 3 }, base)).toEqual([]);
  });
});
