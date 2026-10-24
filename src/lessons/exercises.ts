import type { StationId } from '../charts/pro/chart/stations';
import type { ChartMark, ChartZone } from './chart/LessonChart';
import type { FigureLayers } from './chart/model';

/**
 * Ćwiczenia „Co byś zrobił?”: struktura bez tekstów (teksty w content/<język>.ts pod tym samym id). Każde ćwiczenie to
 * wycinek prawdziwego rynku zatrzymany w kolejnych punktach kontrolnych; po odpowiedziach odsłaniamy dalszy ciąg.
 * Oceniamy tok rozumowania (odczyt kontekstu, miejsce unieważnienia), a nie to, czy wyszedłby zysk.
 */

export type QuestionSpec =
  /** Wybór jednej odpowiedzi: `correct` za 2 punkty, `partial` za 1. */
  | { kind: 'choice'; options: number; correct: number; partial?: readonly number[] }
  /** Wskazanie ceny na rycinie: przedział `good` za 2 punkty, `ok` za 1; krok zaokrąglenia ceny. */
  | { kind: 'pick'; good: readonly [number, number]; ok?: readonly (readonly [number, number])[]; step: number };

export interface CheckpointSpec {
  /** Chwila zatrzymania (UTC): widać świece zamknięte przed nią. */
  at: string;
  questions: readonly QuestionSpec[];
  marks?: readonly ChartMark[];
  /** Strefy pokazywane po odpowiedziach na pytania tego punktu. */
  answerZones?: readonly ChartZone[];
}

export interface ExerciseSpec {
  id: string;
  slice: string;
  view: 'candles' | 'footprint';
  layers: FigureLayers;
  checkpoints: readonly CheckpointSpec[];
  /** Znaczniki i strefy po odsłonięciu całości. */
  endMarks?: readonly ChartMark[];
  endZones?: readonly ChartZone[];
  /** Reguła Laboratorium folkloru, która sprawdza na historii tezę z ćwiczenia. */
  lab?: string;
  /** Hasła atlasu wskaźników użyte w ćwiczeniu. */
  atlas: readonly string[];
  /** Stacja robocza Wykresów do ćwiczenia na żywo. */
  station: StationId;
  level: 1 | 2 | 3;
}

const T = (iso: string) => Date.parse(iso);

export const EXERCISES: readonly ExerciseSpec[] = [
  {
    id: 'ny-breakout',
    slice: '2026-10-20-ny',
    view: 'candles',
    layers: { vwap: true, bands: true, profile: true, levels: true, sessions: true },
    checkpoints: [
      { at: '2026-10-20T13:30Z', questions: [{ kind: 'choice', options: 4, correct: 1, partial: [3] }] },
      {
        at: '2026-10-20T15:30Z',
        marks: [
          { n: '1', t: T('2026-10-20T14:55Z'), px: 83425 },
          { n: '2', t: T('2026-10-20T15:10Z'), px: 82200 },
        ],
        questions: [{ kind: 'pick', good: [81900, 82190], ok: [[81600, 81900]], step: 10 }],
        answerZones: [{ lo: 81900, hi: 82190, tone: 'accent' }],
      },
    ],
    lab: 'pdh-sweep',
    atlas: ['vwap', 'profile', 'levels', 'sessions'],
    station: 'auction',
    level: 1,
  },
  {
    id: 'trend-up',
    slice: '2026-10-21-trend',
    view: 'candles',
    layers: { vwap: true, bands: true, levels: true, sessions: true },
    checkpoints: [{ at: '2026-10-21T14:45Z', questions: [{ kind: 'choice', options: 4, correct: 1, partial: [2] }] }],
    lab: 'vwap-revert',
    atlas: ['vwap', 'levels', 'sessions'],
    station: 'start',
    level: 1,
  },
  {
    id: 'trend-down',
    slice: '2026-10-22-trend',
    view: 'candles',
    layers: { vwap: true, bands: true, profile: true, levels: true, sessions: true },
    checkpoints: [
      {
        at: '2026-10-22T11:00Z',
        marks: [{ n: '1', t: T('2026-10-22T10:30Z'), px: 82172 }],
        questions: [
          { kind: 'choice', options: 4, correct: 1 },
          { kind: 'pick', good: [82180, 82800], ok: [[82800, 83300]], step: 10 },
        ],
        answerZones: [{ lo: 82180, hi: 82800, tone: 'accent' }],
      },
    ],
    lab: 'pdl-sweep',
    atlas: ['vwap', 'profile', 'levels'],
    station: 'auction',
    level: 2,
  },
  {
    id: 'balance-day',
    slice: '2026-10-23-balance',
    view: 'candles',
    layers: { vwap: true, bands: true, profile: true, levels: true, sessions: true, ib: 'ny' },
    checkpoints: [
      { at: '2026-10-23T14:10Z', marks: [{ n: '1', t: T('2026-10-23T14:00Z'), px: 82088 }], questions: [{ kind: 'choice', options: 4, correct: 0, partial: [3] }] },
      { at: '2026-10-23T14:30Z', marks: [{ n: '2', t: T('2026-10-23T14:20Z'), px: 81106 }], questions: [{ kind: 'choice', options: 4, correct: 1 }] },
    ],
    lab: 'ib-break',
    atlas: ['vwap', 'profile', 'ib', 'sessions'],
    station: 'auction',
    level: 2,
  },
  {
    id: 'liq-cascade',
    slice: '2026-10-24-cascade',
    view: 'candles',
    layers: { vwap: true, bands: true, levels: true, liq: true, cvd: true, oi: true },
    checkpoints: [
      {
        at: '2026-10-24T15:30Z',
        marks: [
          { n: '1', t: T('2026-10-24T14:15Z'), px: 80000 },
          { n: '2', t: T('2026-10-24T15:10Z'), px: 79542 },
        ],
        questions: [{ kind: 'choice', options: 4, correct: 1 }],
      },
      { at: '2026-10-24T18:15Z', marks: [{ n: '3', t: T('2026-10-24T18:10Z'), px: 80392 }], questions: [{ kind: 'choice', options: 4, correct: 1, partial: [3] }] },
    ],
    endMarks: [{ n: '4', t: T('2026-10-24T21:10Z'), px: 80259 }],
    atlas: ['liq', 'oi', 'cvd', 'vwap', 'levels'],
    station: 'liquidity',
    level: 2,
  },
  {
    id: 'footprint-zone',
    slice: '2026-10-24-footprint',
    view: 'footprint',
    layers: {},
    checkpoints: [
      {
        at: '2026-10-24T19:00Z',
        marks: [{ n: '1', t: T('2026-10-24T18:45Z'), px: 80460 }],
        questions: [
          { kind: 'choice', options: 4, correct: 1 },
          { kind: 'pick', good: [80300, 80470], ok: [[80200, 80300]], step: 10 },
        ],
        answerZones: [{ lo: 80300, hi: 80470, tone: 'accent' }],
      },
    ],
    endZones: [{ lo: 80360, hi: 80500, tone: 'buy' }],
    endMarks: [{ n: '2', t: T('2026-10-24T21:00Z'), px: 80280 }],
    atlas: ['footprint', 'imbalance', 'delta', 'oi'],
    station: 'scalp',
    level: 3,
  },
];

/** Punkty za odpowiedź: 2 = dobry tok rozumowania, 1 = do obrony, 0 = do poprawy. */
export function scoreAnswer(q: QuestionSpec, answer: number): 0 | 1 | 2 {
  if (q.kind === 'choice') return answer === q.correct ? 2 : q.partial?.includes(answer) ? 1 : 0;
  const inside = ([a, b]: readonly [number, number]) => answer >= a && answer <= b;
  if (inside(q.good)) return 2;
  return q.ok?.some(inside) ? 1 : 0;
}

/** Dla wskazania ceny: odpowiedź za ciasna (po stronie ceny) albo za szeroka względem dobrego przedziału. */
export function pickSide(q: Extract<QuestionSpec, { kind: 'pick' }>, answer: number, price: number): 'good' | 'ok' | 'tight' | 'wide' {
  const s = scoreAnswer(q, answer);
  if (s === 2) return 'good';
  if (s === 1) return 'ok';
  // Bliżej ceny niż dobry przedział = za ciasno, dalej = za szeroko
  const near = Math.abs(answer - price) < Math.abs((q.good[0] + q.good[1]) / 2 - price);
  return near ? 'tight' : 'wide';
}

export const maxScore = (e: ExerciseSpec) => e.checkpoints.reduce((s, c) => s + 2 * c.questions.length, 0);
