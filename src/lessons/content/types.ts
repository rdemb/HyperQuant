import type { StationId } from '../../charts/pro/chart/stations';
import type { ChartText } from '../chart/LessonChart';
import type { FigureLayers } from '../chart/model';

/** Treść zakładki Lekcje w jednym języku (struktura ćwiczeń w exercises.ts, wspólna dla języków). */

export interface QuestionText {
  prompt: string;
  /** Wybór: etykieta i omówienie każdej odpowiedzi (kolejność jak w strukturze). */
  options?: readonly { label: string; feedback: string }[];
  /** Wskazanie ceny: podpowiedź i omówienia według trafienia. */
  pick?: { hint: string; good: string; ok: string; tight: string; wide: string };
}

export interface CheckpointText {
  /** Co widać w chwili zatrzymania (znaczniki 1, 2… na rycinie). */
  context: string;
  questions: readonly QuestionText[];
  /** Co stało się dalej (po odsłonięciu do następnego punktu albo do końca). */
  reveal: string;
}

export interface ExerciseText {
  title: string;
  /** Data i rynek w nagłówku, np. „wt 20.10.2026 · BTC 5m”. */
  when: string;
  tagline: string;
  intro: string;
  checkpoints: readonly CheckpointText[];
  debrief: { points: readonly string[]; honest: string };
  /** Podpisy stref po odpowiedzi i po odsłonięciu (kolejność jak w strukturze: najpierw answerZones, potem endZones). */
  zoneLabels?: readonly string[];
}

export type AtlasGroup = 'price' | 'flow' | 'book' | 'context';

export interface AtlasEntry {
  id: string;
  name: string;
  group: AtlasGroup;
  /** Jednym zdaniem: co to jest. */
  what: string;
  /** Jak liczymy u nas (te same zasady co na Wykresach). */
  how: string;
  read: readonly string[];
  traps: readonly string[];
  combine: readonly string[];
  /** Gdzie włączyć na Wykresach. */
  where: string;
  station: StationId;
  /** Rycina z wycinka (gdy wskaźnik da się pokazać z zapisanych danych). */
  figure?: { slice: string; view?: 'candles' | 'footprint'; layers: FigureLayers; at?: string; caption: string };
}

export interface RecipeText {
  name: string;
  context: string;
  flow: string;
  risk: string;
  against: string;
}

export interface LessonsContent {
  tz: string;
  locale: string;
  tzLabel: string;
  ui: {
    eyebrow: string;
    title: string;
    lead: string;
    tabs: { exercises: string; atlas: string; combine: string; myths: string; risk: string };
    progress: (done: number, total: number) => string;
    level: (n: 1 | 2 | 3) => string;
    start: string;
    again: string;
    back: string;
    check: string;
    next: string;
    reveal: string;
    revealEnd: string;
    finish: string;
    score: (s: number, max: number) => string;
    scoreNote: string;
    yourAnswer: string;
    pickPrompt: string;
    pickNone: string;
    verdict: Record<0 | 1 | 2, string>;
    debrief: string;
    honest: string;
    practice: string;
    /** Przycisk stacji Wykresów; `name` to nazwa ze stations.ts (Wykresy mają jeszcze tylko polskie nazwy). */
    openStation: (id: StationId, name: string) => string;
    /** Przycisk powtórki tej samej chwili w Wykresach i zdanie pod nim. */
    openReplay: string;
    replayNote: string;
    atlasLinks: string;
    labTitle: string;
    labLoading: string;
    labUnavailable: string;
    labLine: (rate: string, p0: string, n: number) => string;
    labEffect: (pp: string) => string;
    labVerdict: Record<'support' | 'against' | 'none' | 'few', string>;
    /** Krótki werdykt do tabeli. */
    labShort: Record<'support' | 'against' | 'none' | 'few', string>;
    labOpen: string;
    loading: string;
    loadError: string;
    dataNote: string;
    checkpoint: (i: number, n: number) => string;
    question: (i: number, n: number) => string;
    exercisesIntro: string;
    best: string;
    pickInput: string;
    /** Cytat w cudzysłowie właściwym dla języka. */
    quote: (s: string) => string;
  };
  chart: ChartText & { volume: string; oiChange: string; imbalance: string };
  exercises: Record<string, ExerciseText>;
  atlas: {
    intro: string;
    groups: Record<AtlasGroup, string>;
    labels: { what: string; how: string; read: string; traps: string; combine: string; where: string };
    entries: readonly AtlasEntry[];
  };
  combine: {
    intro: string;
    questions: readonly { q: string; tools: string; answer: string }[];
    rules: readonly string[];
    recipesTitle: string;
    recipesIntro: string;
    recipeLabels: { context: string; flow: string; risk: string; against: string };
    recipes: readonly RecipeText[];
  };
  myths: { intro: string; how: string; columns: { claim: string; result: string; n: string; verdict: string }; footer: string };
  risk: {
    intro: string;
    badge: string;
    labels: { winRate: string; payoff: string; riskPct: string; trades: string; cost: string; reset: string };
    out: {
      expectancy: string;
      median: string;
      band: string;
      dd20: string;
      dd50: string;
      streak: string;
      paths: string;
    };
    lessons: readonly { title: string; text: string }[];
    sizeLink: string;
    planLink: string;
  };
}
