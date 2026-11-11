/**
 * Klawiatura w liście rozwijanej (wzorzec WAI-ARIA „menu button”): strzałki w górę i w dół przechodzą po pozycjach z
 * zawinięciem, Home i End na skraj, Escape i Tab zamykają (Escape oddaje fokus przyciskowi). Bez DOM — testy na liczbach.
 */
export type MenuKeyResult = { kind: 'move'; to: number } | { kind: 'close'; refocus: boolean } | null;

/** Skutek klawisza `key` przy fokusie na pozycji `at` (−1 — fokus poza pozycjami) z `count` pozycji. */
export function menuKey(key: string, at: number, count: number): MenuKeyResult {
  if (key === 'Escape') return { kind: 'close', refocus: true };
  if (key === 'Tab') return { kind: 'close', refocus: false };
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', to: at < 0 ? 0 : (at + 1) % count };
    case 'ArrowUp':
      return { kind: 'move', to: at < 0 ? count - 1 : (at - 1 + count) % count };
    case 'Home':
      return { kind: 'move', to: 0 };
    case 'End':
      return { kind: 'move', to: count - 1 };
    default:
      return null;
  }
}

/** Pozycja, na którą trafia fokus po otwarciu listy: zaznaczona (np. bieżący interwał), a bez niej pierwsza. */
export const openFocusIndex = (checked: readonly boolean[]): number => Math.max(0, checked.indexOf(true));
