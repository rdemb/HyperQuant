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

/** Najwyższy panel listy i najniższy, gdy pod przyciskiem mało miejsca (px). */
const PANEL_MAX_H = 560;
const PANEL_MIN_H = 120;
const EDGE = 8;

/**
 * Położenie panelu listy w oknie: `dx` — przesunięcie w poziomie, gdy panel (od lewej albo prawej krawędzi przycisku)
 * wyszedłby za krawędź okna (margines 8 px); `maxH` — wysokość z miejsca od przycisku (+4 px odstępu) do dolnej granicy
 * (dół okna albo górna krawędź dolnego menu), najwyżej 560 px, najmniej 120 px.
 */
export function fitPanel(
  btn: { left: number; right: number; bottom: number },
  panel: { w: number },
  align: 'left' | 'right',
  view: { w: number; bottom: number }
): { dx: number; maxH: number } {
  const left = align === 'left' ? btn.left : btn.right - panel.w;
  const right = left + panel.w;
  const dx = right > view.w - EDGE ? Math.max(EDGE - left, view.w - EDGE - right) : left < EDGE ? EDGE - left : 0;
  const maxH = Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, view.bottom - btn.bottom - 4 - EDGE));
  return { dx, maxH };
}
