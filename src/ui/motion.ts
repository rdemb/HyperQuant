import type { Transition } from 'motion/react';

/** Tokeny ruchu (docs/STYLEGUIDE.md §5). Pozycja/rozmiar mogą sprężynować; krycie i kolor nigdy. */
export const SPRING: Transition = { type: 'spring', stiffness: 260, damping: 26, mass: 1 }; // ζ ≈ 0.8
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.64, 0, 0.78, 0] as const;
export const EASE_IN_OUT = [0.83, 0, 0.17, 1] as const;

export const DUR = {
  feedback: 0.12,
  ui: 0.24,
  uiExit: 0.14,
  hero: 0.68,
} as const;

/** Stagger listy przy pierwszym montażu (40–60 ms). */
export const STAGGER = 0.05;

/** Wejście widoku: krótkie krycie + 6 px przesunięcia; wyjście szybsze. */
export const VIEW_TRANSITION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.ui, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DUR.uiExit, ease: EASE_IN } },
};
