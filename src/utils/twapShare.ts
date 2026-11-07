/**
 * Udział wypełnień z hashem zerowym (m.in. podzlecenia TWAP) w wartości taśmy — liczba nagłówka układu „Duże ręce” i serwera
 * MCP (wypełnienia z plików historii). Bez modułów wykresu (stare miejsce eksportu: `charts/pro/chart/layoutNumbers`).
 */
import { tr } from '../i18n';
import type { Side } from '../charts/pro/hl/parse';
import type { Got } from './sessionText';

/**
 * Udział wypełnień z hashem zerowym w wartości zleceń agresora (albo pojedynczych wypełnień — sumy są te same), łącznie
 * i po stronach agresora (kupno, sprzedaż); ułamki 0–1. Bez wartości w oknie — powód.
 */
export function twapShareOf(orders: readonly { notional: number; side: Side; zero?: true }[]): Got<{ share: number; buy: number; sell: number }> {
  let all = 0;
  let up = 0;
  let down = 0;
  for (const o of orders) {
    all += o.notional;
    if (!o.zero) continue;
    if (o.side === 1) up += o.notional;
    else down += o.notional;
  }
  if (!(all > 0)) return { why: tr('Brak zleceń agresora w oknie', 'No aggressor orders in the window') };
  return { share: (up + down) / all, buy: up / all, sell: down / all };
}
