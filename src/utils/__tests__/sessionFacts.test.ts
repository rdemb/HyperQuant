import { describe, expect, it } from 'vitest';
import type { VBar } from '../auction';
import { currentTradeSession, previousSameSession } from '../sessionDay';
import { reviewSession, sessionFacts } from '../sessionFacts';

const MIN = 60_000;
const H = 60 * MIN;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** 3.11.2026, NY w toku (14:30–24:00 UTC), IB zamknięty o 15:30 */
const NOW = at(2026, 11, 3, 16, 20);
const NY = currentTradeSession(NOW)!;

const minutes = (from: number, to: number, px: (t: number) => number): VBar[] => {
  const out: VBar[] = [];
  for (let t = from; t < to; t += MIN) out.push({ time: t, open: px(t), high: px(t) + 20, low: px(t) - 20, close: px(t), volume: 1 });
  return out;
};

describe('sessionFacts: jedno źródło faktów sesji (nagłówek Rozliczenia i karty)', () => {
  // Od NY poprzedniego dnia (14:30 2.11) do teraz, cena 100 000; w bieżącej sesji NY po IB wyżej
  const bars = minutes(at(2026, 11, 2, 14, 30), NOW + MIN, (t) => (t >= NY.ibEnd ? 100_600 : 100_000));

  it('sesja w toku ze świec 1m: IB, zakres z minutami ekstremów, pierwsze wybicie, VA tej i poprzedniej sesji NY', () => {
    const f = sessionFacts(bars, NY, NOW);
    if ('why' in f) throw new Error(f.why);
    expect(f).toMatchObject({ s: NY, ibHi: 100_020, ibLo: 99_980, hi: 100_620, lo: 99_980, close: 100_600, ibDone: true, breakAt: NY.ibEnd, hiAt: NY.ibEnd, loAt: NY.start });
    expect(f.prev).toEqual(previousSameSession(NY));
    expect(f.prevVa!.vah).toBeLessThanOrEqual(100_030);
    expect(f.va!.vah).toBeGreaterThan(100_500);
  });

  it('w Azji: ostatnia zamknięta sesja (NY), bez „w toku”', () => {
    const asia = at(2026, 11, 4, 2);
    expect(reviewSession(NOW)).toEqual({ s: NY, inProgress: true });
    expect(reviewSession(asia)).toEqual({ s: NY, inProgress: false });
    const later = [...bars, ...minutes(NOW + MIN, asia, () => 100_600)];
    const f = sessionFacts(later, NY, asia);
    if ('why' in f) throw new Error(f.why);
    expect(f.close).toBe(100_600);
  });

  it('świece bez otwarcia sesji albo z mniej niż 95% minut — powód; bez poprzedniej sesji — prevVa null', () => {
    expect(sessionFacts(bars.filter((b) => b.time > NY.start + H), NY, NOW)).toMatchObject({ why: expect.stringContaining('nie obejmują całej sesji NY') });
    const holes = bars.filter((b, i) => b.time < NY.start || i % 10 !== 0);
    expect(sessionFacts(holes, NY, NOW)).toMatchObject({ why: expect.any(String) });
    const f = sessionFacts(bars.filter((b) => b.time >= NY.start), NY, NOW);
    if ('why' in f) throw new Error(f.why);
    expect(f.prevVa).toBeNull();
  });
});
