import { describe, expect, it } from 'vitest';
import type { Candle } from '../hl/parse';
import type { IndicatorBar } from '../core/indicators';
import { DAY } from '../core/time';
import { tpoDay, tpoDays } from '../core/tpo';
import {
  FULL_PERIODS,
  NAKED_POC_SHOWN,
  PROFILE_DAY_FILL,
  PROFILE_EVIDENCE,
  PROFILE_FIELD_MAX,
  barSpan,
  fullScaleMax,
  fullFrom,
  nearestNaked,
  profileAnchor,
  rectShare,
  runs,
} from '../chart/profileSelect';

describe('profile dób: co i jak szeroko rysujemy (profileSelect)', () => {
  it(`najdłuższy słupek najwyżej ${PROFILE_DAY_FILL * 100}% szerokości doby i nigdy ponad ${PROFILE_FIELD_MAX * 100}% pola wykresu`, () => {
    // Komputer 30m: doba 48 świec po 7 px = 336 px, pole 1300 px → 35% doby
    expect(barSpan(336, 1300)).toBeCloseTo(117.6, 6);
    // Telefon: doba szersza niż ekran (48 × 9 px), pole 330 px → 30% pola zamiast 75% doby
    expect(barSpan(432, 330)).toBeCloseTo(99, 6);
  });

  it('wspólna skala słupków: maksimum z obu pełnych dób, niezależnie od tego, które widać', () => {
    const days = [{ max: 90 }, { max: 40 }, { max: 70 }, { max: 55 }];
    // Pełne: dwie ostatnie (70 i 55); starsza doba 90 nie zmienia skali
    expect(fullScaleMax(days)).toBe(70);
    expect(fullScaleMax(days.slice(-1))).toBe(55);
    expect(fullScaleMax([])).toBe(0);
  });

  it(`pełny profil dla bieżącej i poprzedniej doby (${FULL_PERIODS}), starsze — skrót; od danych, nie od przewinięcia`, () => {
    expect(fullFrom(5)).toBe(3);
    expect(fullFrom(1)).toBe(0);
    expect(fullFrom(0)).toBe(0);
  });

  it('doba zaczęta przed lewą krawędzią: słupki od krawędzi pola (z miejscem na paski z lewej), nie spoza ekranu', () => {
    expect(profileAnchor(120)).toBe(120);
    expect(profileAnchor(-400)).toBe(8);
  });

  it(`nietknięte POC: najwyżej ${NAKED_POC_SHOWN} najbliższe cenie`, () => {
    const pocs = [
      { px: 100, naked: true },
      { px: 130, naked: true },
      { px: 95, naked: false },
      { px: 104, naked: true },
      { px: 90, naked: true },
      { px: 111, naked: true },
    ];
    expect([...nearestNaked(pocs, 102)].sort()).toEqual([0, 3, 5]);
    expect(nearestNaked(pocs.slice(0, 2), 102).size).toBe(2);
  });

  it('znaczniki wydruków i ogonów liczone jako odcinki (sąsiednie wiersze to jeden znacznik)', () => {
    expect(runs([false, true, true, false, true, false, false, true])).toBe(3);
    expect(runs([])).toBe(0);
  });

  it('pole pod słupkami: suma prostokątów przyciętych do panelu, jako udział pola', () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 95, y: 0, w: 10, h: 10 },
      { x: -5, y: 95, w: 10, h: 10 },
    ];
    // 100 + 50 + 25 z 100 × 100
    expect(rectShare(rects, 100, 100)).toBeCloseTo(0.0175, 9);
  });

  it('zamknięta doba daje ten sam profil po dopisaniu kolejnej doby', () => {
    const d0 = Date.UTC(2026, 10, 9);
    const bars: IndicatorBar[] = [];
    for (let i = 0; i < 48 * 2 + 10; i++) {
      const t = d0 + i * 1_800_000;
      const c = 100 + Math.sin(i / 3) * 5;
      bars.push({ t, candle: { t, o: c, h: c + 2, l: c - 2, c, v: 1 + (i % 5), n: 1 } as Candle });
    }
    const first = (b: IndicatorBar[]) => {
      const d = tpoDays(b)[0];
      return tpoDay(b, d.from, d.to, 1, d.complete);
    };
    const twoDays = bars.filter((b) => b.t < d0 + 2 * DAY);
    expect(first(bars)).toEqual(first(twoDays));
  });

  it('opis: wynik sprawdzianu, PL i EN', () => {
    expect(PROFILE_EVIDENCE.pl).toBe('POC poprzedniej doby nie przyciąga ceny: dotykany w 71% dób, losowy poziom w tej samej odległości w 73%.');
    expect(PROFILE_EVIDENCE.en).toContain('71%');
  });
});
