import { bookQuote, parseBtcOutcomes, type Quote } from '../../src/utils/hip4.ts';
import type { InfoClient } from './liqDetect.ts';

/** Migawka rynku wynikowego HIP-4 do dziennika: pytanie (próg, termin, źródło) i notowanie strony „Tak”. */
export interface MarketSnap {
  outcome: number;
  K: number;
  expiry: number;
  src: 'mark' | 'trade' | 'pyth';
  quote: Quote | null;
}

/** Wagi zapytań info (szacunek z zapasem): outcomeMeta ~20, l2Book 2 */
const META_WEIGHT = 20;
const BOOK_WEIGHT = 2;

/**
 * Aktywny 15-minutowy rynek binarny BTC z terminem `expiry` (mark perpa, próg = cena przy utworzeniu) i jego arkusz.
 * Brak takiego rynku albo błąd API → null.
 */
export async function marketSnapshot(rest: InfoClient, expiry: number, now: number): Promise<MarketSnap | null> {
  const meta = await rest.info({ type: 'outcomeMeta' }, META_WEIGHT);
  const q = parseBtcOutcomes(meta, now).find((o) => o.kind === 'above' && !o.recurring && o.source === 'mark' && o.expiry === expiry);
  if (!q) return null;
  const book = await rest.info({ type: 'l2Book', coin: q.coin }, BOOK_WEIGHT);
  return { outcome: q.id, K: q.K, expiry: q.expiry, src: q.source, quote: book === null ? null : bookQuote(book) };
}
