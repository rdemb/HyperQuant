import { tr } from '../i18n';
import { SESSION_LABEL, sessionAt } from '../charts/pro/core/sessions';
import type { TradeSessionId } from './sessionDay';

/** Nazwa sesji w podpisach („sesja Londyn”, „sesja NY”) — osobno od `sessionDay`, żeby logika sesji nie ciągnęła i18n. */
export const TRADE_SESSION_NAME: Record<TradeSessionId, string> = { london: tr('Londyn', 'London'), ny: 'NY' };

/**
 * Nazwa sesji trwającej w chwili `now`: Azja, Londyn albo Nowy Jork, z tymi samymi granicami co sesje dnia tradera
 * (§7.11, `core/sessions`: Londyn od 08:00 czasu londyńskiego, NY od 09:30 czasu nowojorskiego do 00:00 UTC). Okna
 * Pine Script ze Shaakuni (Londyn 02:00–05:00 NY) to okna wskaźnika (kill zones), nie sesje — nie nazywamy nimi sesji.
 */
export function sessionNameAt(now: number): string {
  return SESSION_LABEL[sessionAt(now).id];
}
