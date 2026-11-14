import type { ComponentType, LazyExoticComponent } from 'react';
import type { ViewId } from '../state/types';

/**
 * Widoki w nowym wyglądzie: każdy etap dopisuje jedną pozycję, np. `charts: lazy(() => import('./widoki/WSesji'))`.
 * Widok spoza listy pokazuje się w nowej powłoce w obecnym wyglądzie (wspólne `ViewOutlet`). Każdy nowy widok: dane
 * tylko z hooków aplikacji, brak danych = „—” z powodem, plakietki LIVE / MODEL (z nazwaną metodą) / SIM.
 */
export const NOWE_WIDOKI: Partial<Record<ViewId, LazyExoticComponent<ComponentType>>> = {};
