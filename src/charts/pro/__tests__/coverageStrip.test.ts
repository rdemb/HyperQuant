import { describe, expect, it } from 'vitest';
import { Coverage } from '../core/coverage';
import { OiLog } from '../core/stats';
import { DEFAULT_SETTINGS, type ChartSettings } from '../chart/settings';
import type { IndicatorInstance } from '../indicators/registry';
import { BOOK_GAP_MS, type CoverageSource, OI_GAP_MS, coverageRows, intersectSpans, mergedRows, needsOf, spansFromSamples } from '../chart/coverageStrip';

const S = 1_000;
const ind = (id: IndicatorInstance['id'], visible = true): IndicatorInstance => ({
  iid: id,
  id,
  params: {},
  color: '#fff',
  alpha: 1,
  width: 1,
  labels: false,
  visible,
});
const settings = (patch: Partial<ChartSettings>): ChartSettings => ({ ...DEFAULT_SETTINGS, ...patch });
const bare = settings({ view: 'candles', showDelta: false, showCvd: false });

const source = (p: Partial<CoverageSource> = {}): CoverageSource => ({
  coverage: new Coverage(),
  addressed: new Coverage(),
  zeroKnown: new Coverage(),
  bookTimes: () => [],
  exactTimes: () => [],
  oiTimes: () => [],
  ...p,
});

describe('spansFromSamples', () => {
  it('przerwa dłuższa niż próg dzieli odcinki, stary koniec nie sięga do teraz', () => {
    const t = [0, 5, 10, 30, 35].map((x) => x * S);
    expect(spansFromSamples(t, BOOK_GAP_MS, 100 * S)).toEqual([
      [0, 10 * S],
      [30 * S, 35 * S],
    ]);
  });

  it('świeża ostatnia próbka: odcinek trwa do teraz', () => {
    const t = [0, 5, 10, 30, 35].map((x) => x * S);
    expect(spansFromSamples(t, BOOK_GAP_MS, 40 * S).at(-1)).toEqual([30 * S, 40 * S]);
  });

  it('pojedyncza stara próbka nie robi odcinka, brak próbek = brak odcinków', () => {
    expect(spansFromSamples([0, 5 * S, 50 * S], BOOK_GAP_MS, 200 * S)).toEqual([[0, 5 * S]]);
    expect(spansFromSamples([50 * S], BOOK_GAP_MS, 55 * S)).toEqual([[50 * S, 55 * S]]);
    expect(spansFromSamples([], BOOK_GAP_MS, 1)).toEqual([]);
  });
});

describe('intersectSpans i mergedRows', () => {
  it('część wspólna list odcinków', () => {
    expect(
      intersectSpans([
        [
          [0, 10],
          [20, 30],
        ],
        [[5, 25]],
      ])
    ).toEqual([
      [5, 10],
      [20, 25],
    ]);
    expect(intersectSpans([[[0, 10]], []])).toEqual([]);
    expect(intersectSpans([])).toEqual([]);
  });

  it('telefon: kilka źródeł w jednym wierszu, jedno zostaje jak jest', () => {
    const tape = { src: 'tape' as const, spans: [[0, 100]] as [number, number][] };
    const book = { src: 'book' as const, spans: [[50, 150]] as [number, number][] };
    expect(mergedRows([tape])).toEqual([tape]);
    expect(mergedRows([tape, book])).toEqual([{ src: 'all', spans: [[50, 100]] }]);
    expect(mergedRows([])).toEqual([]);
  });
});

describe('needsOf', () => {
  it('footprint domyślnie potrzebuje taśmy, same świece niczego', () => {
    expect(needsOf(DEFAULT_SETTINGS)).toEqual(['tape']);
    expect(needsOf(bare)).toEqual([]);
  });

  it('warstwy, Tablica liczb i widoczne wskaźniki w stałej kolejności', () => {
    const s = settings({
      ...bare,
      showHeatmap: true,
      showClashes: true,
      showStats: true,
      statGroups: ['hl'],
      indicators: [ind('slippage'), ind('twap', false)],
    });
    expect(needsOf(s)).toEqual(['tape', 'accounts', 'book', 'exact', 'oi']);
  });

  it('ukryty wskaźnik się nie liczy', () => {
    expect(needsOf(settings({ ...bare, indicators: [ind('ofi', false)] }))).toEqual([]);
    expect(needsOf(settings({ ...bare, indicators: [ind('ofi')] }))).toEqual(['book']);
  });
});

describe('coverageRows', () => {
  it('bez nagrania: wiersze bez odcinków i bez błędu', () => {
    const rows = coverageRows(source(), ['tape', 'accounts', 'twap', 'book', 'exact', 'oi'], 1e12);
    expect(rows.map((r) => r.src)).toEqual(['tape', 'accounts', 'twap', 'book', 'exact', 'oi']);
    expect(rows.every((r) => r.spans.length === 0)).toBe(true);
  });

  it('otwarte nagranie taśmy kończy się teraz, OI z luką powyżej 3 min', () => {
    const now = 10 * 60 * S;
    const coverage = new Coverage();
    coverage.addSpan(0, 60 * S);
    coverage.open(120 * S);
    const oi = new OiLog();
    for (const t of [60, 120, 180, 400, 460, 520, 580]) oi.push(t * S, 1e9);
    const rows = coverageRows(source({ coverage, oiTimes: () => oi.times() }), ['tape', 'oi'], now);
    expect(rows[0].spans).toEqual([
      [0, 60 * S],
      [120 * S, now],
    ]);
    expect(OI_GAP_MS).toBe(3 * 60 * S);
    expect(rows[1].spans).toEqual([
      [60 * S, 180 * S],
      [400 * S, now],
    ]);
  });
});
