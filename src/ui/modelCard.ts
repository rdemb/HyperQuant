/**
 * Karta modelu: plakietka MODEL z identyfikatorem karty jest przyciskiem, który otwiera kartę (metoda, dane, odświeżanie,
 * znane słabości z tabeli pochodzenia w Źródłach i wynik poza próbą z rejestru prognoz, gdy model go ma). Plakietka tylko
 * wysyła zdarzenie; kartę ładuje leniwie powłoka, więc pierwszy pakiet nie rośnie o treść kart.
 */

export const MODEL_CARD_IDS = ['vol', 'mc2h', 'ledger', 'schrodi', 'vpin', 'kyle', 'hurst', 'ou', 'cascade', 'cohort', 'macro', 'modelVsMarket', 'book', 'uwiezieni'] as const;
export type ModelCardId = (typeof MODEL_CARD_IDS)[number];

export const MODEL_CARD_EVENT = 'hq:karta-modelu';

export interface ModelCardRequest {
  id: ModelCardId;
  /** Plakietka, przy której staje karta (i do której wraca fokus po zamknięciu). */
  anchor: HTMLElement;
}

export function openModelCard(id: ModelCardId, anchor: HTMLElement): void {
  window.dispatchEvent(new CustomEvent<ModelCardRequest>(MODEL_CARD_EVENT, { detail: { id, anchor } }));
}
