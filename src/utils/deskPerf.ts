// Pomiar kosztu obliczeń desku (projekt 58, F0): ms na przeliczenie, liczba przeliczeń i odświeżeń kontekstu.
// Same liczniki w pamięci (bez wpisów performance.measure, które rosłyby bez końca); odczyt: window.__hqDeskPerf().

export interface PerfStat {
  n: number;
  totalMs: number;
  maxMs: number;
  /** Przeliczenia dłuższe niż 50 ms (długie zadanie na głównym wątku). */
  over50: number;
}

const stats = new Map<string, PerfStat>();
let since = 0;

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Liczy wynik `fn` i dopisuje jego czas do licznika `name`. */
export function timed<T>(name: string, fn: () => T): T {
  const t0 = clock();
  try {
    return fn();
  } finally {
    record(name, clock() - t0);
  }
}

/** Zlicza zdarzenie bez czasu (np. odświeżenie kontekstu). */
export function count(name: string): void {
  record(name, 0);
}

function record(name: string, ms: number): void {
  if (since === 0) since = clock();
  const s = stats.get(name) ?? { n: 0, totalMs: 0, maxMs: 0, over50: 0 };
  s.n += 1;
  s.totalMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
  if (ms > 50) s.over50 += 1;
  stats.set(name, s);
}

export interface PerfReport {
  seconds: number;
  rows: { name: string; n: number; perMin: number; meanMs: number; maxMs: number; over50: number; msPerMin: number }[];
}

/** Zestawienie od pierwszego pomiaru albo od ostatniego `reset`. */
export function report(now = clock()): PerfReport {
  const seconds = since === 0 ? 0 : (now - since) / 1000;
  const min = Math.max(seconds / 60, 1e-9);
  const rows = [...stats.entries()]
    .map(([name, s]) => ({
      name,
      n: s.n,
      perMin: s.n / min,
      meanMs: s.n ? s.totalMs / s.n : 0,
      maxMs: s.maxMs,
      over50: s.over50,
      msPerMin: s.totalMs / min,
    }))
    .sort((a, b) => b.msPerMin - a.msPerMin);
  return { seconds, rows };
}

export function reset(): void {
  stats.clear();
  since = 0;
}

if (typeof window !== 'undefined') {
  const w = window as unknown as { __hqDeskPerf?: () => PerfReport; __hqDeskPerfReset?: () => void };
  w.__hqDeskPerf = () => report();
  w.__hqDeskPerfReset = reset;
}
