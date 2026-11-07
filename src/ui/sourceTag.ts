import type { BadgeTone } from './Badge';
import { DASH } from './format';

/** Liczba ze źródłem: wartość („—” przy braku), LIVE albo MODEL i opcjonalna uwaga zamiast plakietki. */
export interface Sourced {
  value: string;
  badge: 'LIVE' | 'MODEL';
  /** Wiek migawki skanera, „opóźnione” albo „tylko BTC”. */
  note?: string;
}

/**
 * Plakietka obok liczby (nagłówek układu, Czwórka). Brak liczby („—”) nie ma plakietki źródła: LIVE albo MODEL obok „—”
 * udawałoby dane; zostaje najwyżej uwaga z powodem („tylko BTC”) w tonie neutralnym, a powód braku — w podpowiedzi.
 * Uwaga przy liczbie (wiek migawki) zastępuje plakietkę w tonie nieaktualnym.
 */
export function sourceTag(n: Sourced): { text: string; tone: BadgeTone } | null {
  if (n.value === DASH) return n.note ? { text: n.note, tone: 'neutral' } : null;
  if (n.note) return { text: n.note, tone: 'stale' };
  return n.badge === 'LIVE' ? { text: 'LIVE', tone: 'live' } : { text: 'MODEL', tone: 'model' };
}
