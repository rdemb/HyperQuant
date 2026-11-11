/**
 * Skróty klawiszowe wykresu i miejsca pracy (lista „?” w menu wykresu) jako czyste funkcje: klawisz → czynność. Wykres
 * (ProChart) i widok wykresów (ChartsView) sprawdzają jeszcze, czy fokus nie jest w polu tekstowym i czy panel jest
 * ostatnio kliknięty; tu tylko mapa, żeby test pilnował, że się nie zmienia.
 */

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

type SimpleKind = 'keys' | 'indicators' | 'now' | 'view' | 'tape' | 'market' | 'reset' | 'autoscale' | 'fullscreen';
export type ChartKeyAction = { kind: 'interval'; index: number } | { kind: SimpleKind };

const LETTERS: Record<string, SimpleKind> = { c: 'view', t: 'tape', m: 'market', r: 'reset', a: 'autoscale', f: 'fullscreen' };

/** Skrót wykresu bez modyfikatorów: cyfry 1…9, 0 — interwał, ? — lista skrótów, / — wskaźniki, End, C, T, M, R, A, F. */
export function chartKeyAction(e: KeyLike): ChartKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === '?') return { kind: 'keys' };
  if (e.key === '/') return { kind: 'indicators' };
  const digit = e.key.length === 1 ? '1234567890'.indexOf(e.key) : -1;
  if (digit >= 0) return { kind: 'interval', index: digit };
  if (e.key === 'End') return { kind: 'now' };
  const kind = LETTERS[e.key.toLowerCase()];
  return kind ? { kind } : null;
}

export type WorkspaceKeyAction = { kind: 'dock' } | { kind: 'tab'; digit: number } | { kind: 'ladder'; dir: 1 | -1 };

/** Skrót miejsca pracy: D — kolumna DOM i taśmy, Alt+1…9 — układ albo karta własna, Alt+↑/↓ — karta z wyższym / niższym interwałem. */
export function workspaceKeyAction(e: KeyLike): WorkspaceKeyAction | null {
  if (e.ctrlKey || e.metaKey) return null;
  if (!e.altKey) return e.key.toLowerCase() === 'd' ? { kind: 'dock' } : null;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) return { kind: 'tab', digit: Number(digit[1]) };
  if (e.key === 'ArrowUp') return { kind: 'ladder', dir: 1 };
  if (e.key === 'ArrowDown') return { kind: 'ladder', dir: -1 };
  return null;
}
