import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagonalImbalances } from '../chart/FootprintFigure';
import { MIN, dayProfile, figureModel, visibleCount } from '../chart/model';
import { en } from '../content/en';
import { pl } from '../content/pl';
import { isLessonSlice, mergeCandles, minuteCandles, type LessonSlice, type SliceCandle } from '../data';
import { EXERCISES, maxScore, pickSide, scoreAnswer, type QuestionSpec } from '../exercises';
import { loadProgress, saveResult } from '../progress';
import { RISK_DEFAULTS, expectancyR, mulberry32, simulateRisk } from '../risk';
import { REPLAY_SUPPORTED, exerciseReplayHash } from '../replay';
import { vwapSeries } from '../../charts/pro/core/indicators';
import { parseReplayLink } from '../../charts/pro/replay/link';
import { HIST_HOUR_MS, historyPath, isHistoryIndex } from '../../utils/tapeHistory';

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

/** Wszystkie teksty obiektu treści (rekurencyjnie, bez funkcji). */
const strings = (x: unknown): string[] =>
  typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : [];
/** Godziny HH:MM w tekście, w minutach od północy. */
const times = (t: string) => [...t.matchAll(/\b(\d{2}):(\d{2})\b/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));

describe('treść angielska ma tę samą strukturę co polska', () => {
  it('ćwiczenia: punkty, pytania, odpowiedzi, strefy i omówienie', () => {
    expect(Object.keys(en.exercises).sort()).toEqual(Object.keys(pl.exercises).sort());
    for (const [id, p] of Object.entries(pl.exercises)) {
      const e = en.exercises[id];
      expect(e.checkpoints.map((c) => c.questions.map((q) => [q.options?.length ?? 0, !!q.pick]))).toEqual(
        p.checkpoints.map((c) => c.questions.map((q) => [q.options?.length ?? 0, !!q.pick]))
      );
      expect(e.zoneLabels?.length ?? 0).toBe(p.zoneLabels?.length ?? 0);
      expect(e.debrief.points).toHaveLength(p.debrief.points.length);
    }
  });

  it('atlas: te same hasła w tej samej kolejności, z tymi samymi rycinami i stacjami', () => {
    const shape = (c: typeof pl) => c.atlas.entries.map(({ id, group, station, figure }) => ({ id, group, station, figure: figure && { ...figure, caption: '' } }));
    expect(shape(en)).toEqual(shape(pl));
    expect(en.combine.questions).toHaveLength(pl.combine.questions.length);
    expect(en.combine.rules).toHaveLength(pl.combine.rules.length);
    expect(en.combine.recipes).toHaveLength(pl.combine.recipes.length);
    expect(en.risk.lessons).toHaveLength(pl.risk.lessons.length);
  });

  it('bez polskich znaków w treści angielskiej', () => {
    for (const t of strings(en)) expect(t, t).not.toMatch(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/);
  });

  it('godziny w ćwiczeniach: angielskie w UTC to polskie (CEST) minus 2 h', () => {
    const allowed: Record<string, number[]> = { 'trend-up': [22 * 60] }; // „do północy” = 22:00 UTC
    for (const [id, p] of Object.entries(pl.exercises)) {
      const fromPl = strings(p).flatMap(times).map((m) => (m - 120 + 1440) % 1440);
      const inEn = strings(en.exercises[id]).flatMap(times);
      expect(new Set(inEn), id).toEqual(new Set([...fromPl, ...(allowed[id] ?? [])]));
    }
  });
});

describe('powtórka chwili z ćwiczenia w Wykresach', () => {
  const root = new URL('../../../public/lessons/replay/', import.meta.url);
  const withReplay = EXERCISES.filter((e) => e.replay);

  it('lekcje znają bieżący format linku powtórki', () => {
    expect(REPLAY_SUPPORTED).toBe(true);
    expect(withReplay.length).toBeGreaterThan(0);
  });

  it.each(withReplay.map((e) => [e.id, e] as const))('%s: nagranie przy lekcjach obejmuje zakres, link wraca do tych samych ustawień', (_, e) => {
    const r = e.replay!;
    const [from, to, t] = [r.from, r.to, r.t].map(Date.parse);
    expect(from % HIST_HOUR_MS).toBe(0);
    expect(to % HIST_HOUR_MS).toBe(0);
    expect(t > from && t < to).toBe(true);
    expect(to - from).toBeLessThanOrEqual(24 * 60 * MIN);
    expect(e.checkpoints.some((ck) => Date.parse(ck.at) === t)).toBe(true);
    const index: unknown = JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
    expect(isHistoryIndex(index)).toBe(true);
    const hours = (index as { markets: Record<string, { hours: number[] }> }).markets.BTC.hours;
    for (let h = from; h < to; h += HIST_HOUR_MS) {
      expect(hours).toContain(h);
      for (const kind of ['trades', 'book'] as const) expect(existsSync(new URL(historyPath('BTC', h, kind, false), root)), `${kind} ${h}`).toBe(true);
    }
    const link = parseReplayLink(exerciseReplayHash(e)!);
    expect(link).toMatchObject({ source: 'lessons', coin: 'BTC', interval: r.interval, view: r.view, from, to, t, station: e.station, zone: r.zone ?? null });
    expect(new Set(link!.layers)).toEqual(new Set(r.layers));
  });

  it('ćwiczenia bez nagrania nie mają przycisku', () => {
    for (const e of EXERCISES.filter((x) => !x.replay)) expect(exerciseReplayHash(e)).toBeNull();
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

describe('VWAP jak w Wykresach', () => {
  // Liczby VWAP z treści ćwiczeń w chwili zatrzymania (ta sama wartość na rycinie i w legendzie powtórki)
  const QUOTED: [string, string, number][] = [
    ['2026-10-20-ny', '2026-10-20T13:30Z', 81627],
    ['2026-10-20-ny', '2026-10-20T15:30Z', 82143],
    ['2026-10-21-trend', '2026-10-21T14:45Z', 83395],
    ['2026-10-22-trend', '2026-10-22T11:00Z', 82768],
    ['2026-10-24-cascade', '2026-10-24T18:15Z', 80127],
  ];

  it.each(QUOTED)('%s %s: VWAP %d', (id, at, px) => {
    const m = figureModel(slice(id), { vwap: true }, 1);
    expect(Math.round(m.vwap[visibleCount(m, Date.parse(at)) - 1]!.vwap)).toBe(px);
  });

  it('ze świec 1m: ta sama wartość przy sklejonych świecach ryciny', () => {
    const s = slice('2026-10-24-cascade');
    const at = Date.parse('2026-10-24T18:15Z');
    const fine = minuteCandles(s.m1).filter((c) => c.t + MIN <= at);
    const ref = vwapSeries(fine.map((c) => ({ t: c.t, candle: c })), 'day').at(-1)!;
    for (const k of [1, 3]) {
      const m = figureModel(s, { vwap: true }, k);
      const v = m.vwap[visibleCount(m, at) - 1]!;
      expect(v.vwap).toBeCloseTo(ref.vwap, 6);
      expect(v.sd).toBeCloseTo(ref.sd, 6);
    }
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
    const cut = { ...s, candles: s.candles.filter((c) => c[0] + s.tf * MIN <= cursor), m1: s.m1.filter((c) => c[0] + MIN <= cursor), to: cursor };
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
