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
  hip4: { desktop: 6, phone: 1 },
  levels: { dayMap: { desktop: { levels: 6, sessions: 0, levels4h: 3 }, phone: null }, review: { desktop: { levels: 0, sessions: 6 }, phone: { levels: 0, sessions: 4 } } },
  bubbles: { desktop: 21, phone: 5 },
  ib: { auction: { desktop: 5, phone: 3 }, review: { desktop: 7, phone: 5 } },
  pb: { desktop: { boxes: 2, lines: 4, marks: 3 }, phone: { boxes: 1, lines: 4, marks: 0 } },
  profiles: {
    dayMap: { desktop: { tpo: { objects: 18, area: 9.5 }, periods: { objects: 12, area: 3.1 } }, phone: { tpo: { objects: 9, area: 17.2 }, periods: null } },
    review: { desktop: { tpo: { objects: 16, area: 8 }, periods: null }, phone: { tpo: { objects: 8, area: 15 }, periods: null } },
  },
  zones: { desktop: { rects: 4, lines: 2 }, phone: { rects: 3, lines: 1 } },
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
    expect([m['hip4.lines1440'], m['hip4.lines390']]).toEqual([6, 1]);
    expect([m['levels.dayMap.lines4h1440'], m['levels.dayMap.lines1440'], m['sessions.review.lines1440'], m['sessions.review.lines390']]).toEqual([3, 6, 6, 4]);
    expect(m['levels.dayMap.lines390']).toBeUndefined();
    expect([m['bubbles.count1440'], m['bubbles.count390']]).toEqual([21, 5]);
    expect([m['ib.auction1440'], m['ib.auction390'], m['ib.review1440'], m['ib.review390']]).toEqual([5, 3, 7, 5]);
    expect([m['pb.boxes1440'], m['pb.lines1440'], m['pb.marks1440'], m['pb.boxes390'], m['pb.marks390']]).toEqual([2, 4, 3, 1, 0]);
    expect([m['tpo.dayMap.objects1440'], m['tpo.dayMap.area1440'], m['periods.dayMap.objects1440'], m['tpo.dayMap.area390'], m['tpo.review.objects390']]).toEqual([18, 9.5, 12, 17.2, 8]);
    expect(m['periods.review.objects1440']).toBeUndefined();
    expect([m['zones.rects1440'], m['zones.lines1440'], m['zones.rects390'], m['zones.lines390']]).toEqual([4, 2, 3, 1]);
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
