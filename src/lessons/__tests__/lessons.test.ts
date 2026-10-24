import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagonalImbalances } from '../chart/FootprintFigure';
import { MIN, dayProfile, figureModel, visibleCount } from '../chart/model';
import { pl } from '../content/pl';
import { isLessonSlice, mergeCandles, type LessonSlice, type SliceCandle } from '../data';
import { EXERCISES, maxScore, pickSide, scoreAnswer, type QuestionSpec } from '../exercises';
import { loadProgress, saveResult } from '../progress';
import { RISK_DEFAULTS, expectancyR, mulberry32, simulateRisk } from '../risk';

const slice = (id: string): LessonSlice => JSON.parse(readFileSync(new URL(`../../../public/lessons/${id}.json`, import.meta.url), 'utf8'));
const SLICES = [...new Set([...EXERCISES.map((e) => e.slice), ...pl.atlas.entries.flatMap((e) => (e.figure ? [e.figure.slice] : []))])];

describe('wycinki rynku', () => {
  it.each(SLICES)('%s ma poprawny format i świece w oknie', (id) => {
    const s = slice(id);
    expect(isLessonSlice(s)).toBe(true);
    expect(s.id).toBe(id);
    const tf = s.tf * MIN;
    expect(s.candles[0][0]).toBe(s.dayStart);
    for (let i = 1; i < s.candles.length; i++) expect(s.candles[i][0] - s.candles[i - 1][0]).toBe(tf);
    expect(s.candles[s.candles.length - 1][0] + tf).toBe(s.to);
    for (const c of s.candles) expect(c[2] >= Math.max(c[1], c[4]) && c[3] <= Math.min(c[1], c[4])).toBe(true);
  });

  it('isLessonSlice odrzuca złą wersję i puste świece', () => {
    const s = slice('2026-10-20-ny');
    expect(isLessonSlice({ ...s, v: 99 })).toBe(false);
    expect(isLessonSlice({ ...s, candles: [] })).toBe(false);
    expect(isLessonSlice(null)).toBe(false);
  });
});

describe('ćwiczenia: struktura zgodna z treścią i danymi', () => {
  it.each(EXERCISES.map((e) => [e.id, e] as const))('%s', (_, e) => {
    const t = pl.exercises[e.id];
    const s = slice(e.slice);
    expect(t).toBeDefined();
    expect(t.checkpoints).toHaveLength(e.checkpoints.length);
    let last = s.from;
    for (const [ci, ck] of e.checkpoints.entries()) {
      const at = Date.parse(ck.at);
      expect(at).toBeGreaterThan(last);
      expect(at).toBeLessThan(s.to);
      last = at;
      expect(t.checkpoints[ci].questions).toHaveLength(ck.questions.length);
      for (const [qi, q] of ck.questions.entries()) {
        const qt = t.checkpoints[ci].questions[qi];
        if (q.kind === 'choice') {
          expect(qt.options).toHaveLength(q.options);
          expect(q.correct).toBeLessThan(q.options);
          for (const p of q.partial ?? []) expect(p).not.toBe(q.correct);
        } else {
          expect(qt.pick).toBeDefined();
          expect(q.good[0]).toBeLessThan(q.good[1]);
        }
      }
    }
    const zones = e.checkpoints.reduce((n, ck) => n + (ck.answerZones?.length ?? 0), 0) + (e.endZones?.length ?? 0);
    expect(t.zoneLabels?.length ?? 0).toBe(zones);
    // Znaczniki leżą na świecach, do których odsyła tekst (cena w zakresie świecy)
    const tf = s.tf * MIN;
    for (const m of [...e.checkpoints.flatMap((ck) => ck.marks ?? []), ...(e.endMarks ?? [])]) {
      const c = s.candles.find((x) => x[0] === Math.floor(m.t / tf) * tf);
      expect(c, `znacznik ${m.n}`).toBeDefined();
      expect(m.px).toBeGreaterThanOrEqual(c![3] - 1);
      expect(m.px).toBeLessThanOrEqual(c![2] + 1);
    }
    const ids = new Set(pl.atlas.entries.map((a) => a.id));
    for (const a of e.atlas) expect(ids.has(a)).toBe(true);
    if (e.view === 'footprint') expect(s.fp?.bars.length).toBeGreaterThan(0);
  });

  it('hasła atlasu mają unikalne identyfikatory, a ryciny poprawne chwile', () => {
    const ids = pl.atlas.entries.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of pl.atlas.entries)
      if (a.figure?.at) {
        const s = slice(a.figure.slice);
        const at = Date.parse(a.figure.at);
        expect(at > s.from && at <= s.to).toBe(true);
      }
  });
});

describe('ocena odpowiedzi', () => {
  const choice: QuestionSpec = { kind: 'choice', options: 4, correct: 1, partial: [3] };
  const pick: Extract<QuestionSpec, { kind: 'pick' }> = { kind: 'pick', good: [100, 200], ok: [[50, 100]], step: 10 };

  it('wybór: 2 za najlepszą, 1 za do obrony, 0 za resztę', () => {
    expect([0, 1, 2, 3].map((a) => scoreAnswer(choice, a))).toEqual([0, 2, 0, 1]);
  });

  it('wskazanie ceny: przedziały i strona błędu', () => {
    expect(scoreAnswer(pick, 150)).toBe(2);
    expect(scoreAnswer(pick, 60)).toBe(1);
    expect(scoreAnswer(pick, 20)).toBe(0);
    // Cena 300: odpowiedź 250 jest bliżej ceny niż dobry przedział (za ciasno), 20 dalej (za szeroko)
    expect(pickSide(pick, 250, 300)).toBe('tight');
    expect(pickSide(pick, 20, 300)).toBe('wide');
    expect(pickSide(pick, 150, 300)).toBe('good');
    expect(pickSide(pick, 60, 300)).toBe('ok');
  });

  it('maksymalna ocena to 2 punkty za pytanie', () => {
    expect(maxScore(EXERCISES.find((e) => e.id === 'trend-down')!)).toBe(4);
  });
});

describe('rycina nie zdradza dalszego ciągu', () => {
  const s = slice('2026-10-20-ny');
  const m = figureModel(s, { vwap: true, profile: true }, 1);
  const cursor = Date.parse('2026-10-20T13:30Z');

  it('widać tylko świece zamknięte przed zatrzymaniem', () => {
    const n = visibleCount(m, cursor);
    expect(m.candles[n - 1][0] + m.tfMs).toBeLessThanOrEqual(cursor);
    expect(m.candles[n][0] + m.tfMs).toBeGreaterThan(cursor);
  });

  it('profil dnia przy zatrzymaniu jest taki sam jak z obciętych danych', () => {
    const cut = { ...s, candles: s.candles.filter((c) => c[0] + s.tf * MIN <= cursor), to: cursor };
    const a = dayProfile(m, cursor);
    const b = dayProfile(figureModel(cut, { profile: true }, 1), cursor);
    expect(a).toEqual(b);
  });

  it('VWAP przy zatrzymaniu nie zależy od późniejszych świec', () => {
    const cut = { ...s, candles: s.candles.filter((c) => c[0] + s.tf * MIN <= cursor), to: cursor };
    const n = visibleCount(m, cursor);
    const b = figureModel(cut, { vwap: true }, 1);
    expect(b.vwap[n - 1]).toEqual(m.vwap[n - 1]);
  });
});

describe('sklejanie świec (wąski ekran) i nierównowagi footprintu', () => {
  it('mergeCandles: OHLC, wolumen i delta tylko przy pełnej taśmie', () => {
    const cs: SliceCandle[] = [
      [0, 10, 12, 9, 11, 1, 0.6, 0.4],
      [60_000, 11, 13, 10, 12, 2, null, null],
      [120_000, 12, 14, 11, 13, 3, 2, 1],
      [180_000, 13, 13, 8, 9, 4, 1, 3],
    ];
    expect(mergeCandles(cs, 2, 60_000)).toEqual([
      [0, 10, 13, 9, 12, 3, null, null],
      [120_000, 12, 14, 8, 9, 7, 3, 4],
    ]);
  });

  it('diagonalImbalances: kupno wobec sprzedaży poziom niżej, co najmniej 3:1', () => {
    const cells: [number, number, number][] = [
      [102, 1, 9],
      [101, 2, 1],
      [100, 12, 1],
    ];
    const { buy, sell } = diagonalImbalances(cells, 1);
    expect([...buy]).toEqual([102]);
    expect([...sell]).toEqual([100]);
  });
});

describe('laboratorium ryzyka', () => {
  it('generator jest powtarzalny', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('oczekiwany wynik w R po kosztach', () => {
    expect(expectancyR(RISK_DEFAULTS)).toBeCloseTo(0.5 * 1.5 - 0.5 - 0.1, 10);
  });

  it('te same parametry dają ten sam wynik', () => {
    expect(simulateRisk(RISK_DEFAULTS)).toEqual(simulateRisk(RISK_DEFAULTS));
  });

  it('pewna wygrana rośnie geometrycznie, zerowe ryzyko nic nie zmienia', () => {
    const w = simulateRisk({ ...RISK_DEFAULTS, winRate: 1, cost: 0, trades: 10 }, 20);
    expect(w.median).toBeCloseTo(100 * (1 + 0.02 * 1.5) ** 10, 6);
    expect(w.dd20).toBe(0);
    const z = simulateRisk({ ...RISK_DEFAULTS, riskPct: 0 }, 50);
    expect(z.p5).toBe(100);
    expect(z.p95).toBe(100);
  });

  it('większe ryzyko na transakcję to głębsze obsunięcia przy tej samej przewadze', () => {
    const small = simulateRisk({ ...RISK_DEFAULTS, riskPct: 0.01 });
    const big = simulateRisk({ ...RISK_DEFAULTS, riskPct: 0.05 });
    expect(big.dd20).toBeGreaterThan(small.dd20);
    expect(big.dd50).toBeGreaterThanOrEqual(small.dd50);
    expect(big.p95 - big.p5).toBeGreaterThan(small.p95 - small.p5);
  });

  it('bez przewagi przed kosztami mediana kapitału spada', () => {
    const r = simulateRisk({ ...RISK_DEFAULTS, payoff: 1, winRate: 0.5, cost: 0.1 });
    expect(r.expectancy).toBeLessThan(0);
    expect(r.median).toBeLessThan(100);
  });

  it('wachlarz zaczyna się od 100 i kończy na liczbie transakcji', () => {
    const r = simulateRisk(RISK_DEFAULTS);
    expect(r.fan[0]).toEqual([0, 100, 100, 100]);
    expect(r.fan[r.fan.length - 1][0]).toBe(RISK_DEFAULTS.trades);
    expect(r.paths[0]).toHaveLength(r.fan.length);
  });
});

describe('postęp w przeglądarce', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('zapisuje najlepszą ocenę i odczytuje tylko poprawne wpisy', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    let p = saveResult({}, 'a', 3, 4, 1);
    p = saveResult(p, 'a', 1, 4, 2);
    expect(p.a).toEqual({ score: 3, max: 4, at: 2 });
    store.set('hq.lessons.v1', JSON.stringify({ ...p, b: { score: 'x' } }));
    expect(loadProgress()).toEqual({ a: { score: 3, max: 4, at: 2 } });
  });

  it('bez dostępu do zapisu nie rzuca błędem', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadProgress()).toEqual({});
    expect(saveResult({}, 'a', 2, 2, 1).a.score).toBe(2);
  });
});
