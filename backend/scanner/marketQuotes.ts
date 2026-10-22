import { bookQuote, parseBtcOutcomes, type Quote } from '../../src/utils/hip4.ts';
import type { InfoClient } from './liqDetect.ts';

/** Migawka rynku wynikowego HIP-4 do dziennika: pytanie (próg, termin, źródło), notowanie strony „Tak” i cena BTC. */
export interface MarketSnap {
  outcome: number;
  K: number;
  expiry: number;
  src: 'mark' | 'trade' | 'pyth' | 'other';
  /** Środek ceny BTC (allMids) z chwili migawki — świeży, w przeciwieństwie do kontekstu rynku sprzed minut */
  px: number;
  /** Czas arkusza z API (ms) — do kontroli wieku notowania */
  bookTime: number | null;
  quote: Quote | null;
}

/** Wagi zapytań info (szacunek z zapasem): outcomeMeta ~20, l2Book 2, allMids 2 */
const META_WEIGHT = 20;
const BOOK_WEIGHT = 2;
const MIDS_WEIGHT = 2;

/**
 * Aktywny 15-minutowy rynek binarny BTC z terminem `expiry`: dokładnie jeden rynek „BTC-USDC perp mark” (próg = cena przy
 * utworzeniu) — inaczej null. Błąd arkusza albo ceny → null (slot dostaje ponowną próbę), nie „niepłynne notowanie”.
 */
export async function marketSnapshot(rest: InfoClient, expiry: number, now: number): Promise<MarketSnap | null> {
  const meta = await rest.info({ type: 'outcomeMeta' }, META_WEIGHT);
  const qs = parseBtcOutcomes(meta, now).filter(
    (o) => o.kind === 'above' && !o.recurring && o.expiry === expiry && o.source === 'mark' && /perp mark/i.test(o.description)
  );
  if (qs.length !== 1) return null;
  const q = qs[0];
  const book = (await rest.info({ type: 'l2Book', coin: q.coin }, BOOK_WEIGHT)) as { time?: unknown } | null;
  if (book === null) return null;
  const mids = (await rest.info({ type: 'allMids' }, MIDS_WEIGHT)) as Record<string, string> | null;
  const px = Number(mids?.BTC);
  if (!(px > 0)) return null;
  return {
    outcome: q.id,
    K: q.K,
    expiry: q.expiry,
    src: q.source,
    px,
    bookTime: typeof book.time === 'number' && Number.isFinite(book.time) ? book.time : null,
    quote: bookQuote(book),
  };
}
