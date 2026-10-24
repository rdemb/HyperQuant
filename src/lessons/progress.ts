/** Postęp w ćwiczeniach: najlepsza ocena rozumowania każdego ćwiczenia, tylko w tej przeglądarce. */

const KEY = 'hq.lessons.v1';

export interface ExerciseProgress {
  score: number;
  max: number;
  /** Czas ostatniego ukończenia (ms). */
  at: number;
}

export type Progress = Record<string, ExerciseProgress>;

const isEntry = (x: unknown): x is ExerciseProgress => {
  const e = x as ExerciseProgress;
  return !!e && Number.isFinite(e.score) && Number.isFinite(e.max) && Number.isFinite(e.at);
};

export function loadProgress(): Progress {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => isEntry(v))) as Progress;
  } catch {
    return {};
  }
}

/** Zapisuje wynik (zostaje lepszy z dotychczasowym) i zwraca nowy stan. */
export function saveResult(prev: Progress, id: string, score: number, max: number, at = Date.now()): Progress {
  const best = prev[id] && prev[id].score > score ? prev[id].score : score;
  const next = { ...prev, [id]: { score: best, max, at } };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Prywatny tryb albo zablokowany zapis: postęp zostaje tylko w tej sesji
  }
  return next;
}
