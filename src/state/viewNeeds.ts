import type { ViewId } from './types';

/**
 * Widoki, które do pierwszych świec pokazują stan „łączenie” zamiast treści: Badania (reżim, VPIN, Hurst, OU liczone
 * ze świec — z pustych danych wyszłyby zmyślone odczyty). Wykresy faz mają własne dane, a Przed sesją czeka sam pas
 * kontekstu (w BeforeView).
 */
const NEEDS_BARS: readonly ViewId[] = ['research'];

/**
 * Widoki z modelem zmienności (ok. 1,3 MB świec): pas MC i mapa likwidacji Przed sesją, budżet zakresu sesji
 * w nagłówku W sesji, Model vs rynek (HIP-4) w Badaniach. Pozostałe go nie pobierają.
 */
const VOL_VIEWS: readonly ViewId[] = ['before', 'charts', 'research'];

/** Czy widok czeka na pierwsze świece (`bars` — liczba świec desku). */
export const awaitingBars = (view: ViewId, bars: number): boolean => bars === 0 && NEEDS_BARS.includes(view);

/** Czy widok potrzebuje modelu zmienności. */
export const needsVolModel = (view: ViewId): boolean => VOL_VIEWS.includes(view);
