/**
 * Rozliczenie poziomów z map bloga: który poziom cena dotknęła w oknie ważności mapy i o której minucie.
 * Czysta logika bez DOM i Node (wspólna dla aplikacji i skryptów bloga). Dotknięcie = low ≤ cena poziomu ≤ high świecy 1m.
 */
import type { VBar } from './auction';
import { currentTradeSession, nextTradeSession, tradeSessionOn } from './sessionDay';
import { utcDayStart } from '../charts/pro/core/sessions';

export type MapKind = 'dzien' | 'ny' | 'otwarcie' | 'aktualizacja' | 'inne';

export type SettledLevel = { label: string; price: number; touchedAt: number | null };

/**
 * Okno ważności mapy [from, to): od publikacji do końca sesji handlowej, w której mapę opublikowano (Londyn albo NY wg
 * `sessionDay`). „Mapa dnia” zawsze trwa do końca sesji NY doby UTC publikacji (obejmuje Londyn i NY). Mapa opublikowana
 * w Azji (przed Londynem) obejmuje najbliższą sesję Londynu (`aktualizacja`, `ny`, `otwarcie`, `inne`).
 */
export function mapWindow(kind: MapKind, publishedAt: number): { from: number; to: number } {
  if (kind === 'dzien') return { from: publishedAt, to: tradeSessionOn(utcDayStart(publishedAt), 'ny').end };
  const session = currentTradeSession(publishedAt) ?? nextTradeSession(publishedAt);
  return { from: publishedAt, to: session.end };
}

/**
 * Dla każdego poziomu minuta (początek świecy 1m) pierwszego dotknięcia w oknie [from, to) albo null. Świece
 * nieprawidłowe (NaN) są pomijane, kolejność świec nie ma znaczenia.
 */
export function settleLevels(levels: { label: string; price: number }[], bars1m: VBar[], from: number, to: number): SettledLevel[] {
  const inWindow = bars1m
    .filter((b) => b.time >= from && b.time < to && Number.isFinite(b.low) && Number.isFinite(b.high))
    .sort((a, b) => a.time - b.time);
  return levels.map((l) => {
    const hit = inWindow.find((b) => b.low <= l.price && l.price <= b.high);
    return { label: l.label, price: l.price, touchedAt: hit ? hit.time : null };
  });
}
