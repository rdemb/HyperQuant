import type { AggressorOrder } from '../core/orders';
import { barStart } from '../core/time';

/**
 * Co rysuje warstwa bąbli — czysta funkcja, wspólna dla warstwy i pomiaru układu (`ui:check`):
 * - reguła przyczynowa zamiast progu z kwantyla: bąbel, gdy w chwili wykonania zlecenie było wśród 2 największych
 *   zleceń agresora z poprzednich 20 świec interwału wykresu (telefon: największe), a taśma zleceń obejmuje całe to
 *   okno (na początku taśmy i po luce „brak większych” nie znaczy „brak taśmy”),
 * - kaskada: najwyżej 2 bąble na świecę (telefon 1) — w trwającej świecy mniejszy może ustąpić większemu; wynik zależy
 *   tylko od taśmy do końca świecy, więc po jej zamknięciu bąble się nie zmieniają, niezależnie od przewinięcia,
 *   zbliżenia i późniejszych zleceń,
 * - próg ręczny z ustawień bez zmian: każde zlecenie od progu,
 * - bezpiecznik: najwyżej 40 bąbli na ekran.
 */

export const BUBBLES_BARS = 20;
export const BUBBLES_K = 2;
export const BUBBLES_K_PHONE = 1;
export const BUBBLES_MAX = 40;

/** Wynik sprawdzianu do opisu warstwy (PL i EN). */
export const BUBBLES_EVIDENCE = {
  pl: 'Po dużym zleceniu cena nie idzie w jego stronę: −0,2 pb po 5 min (n 33 831).',
  en: 'After a large order the price does not follow it: −0.2 bp after 5 min (n 33,831).',
};

export interface BubbleView {
  /** Początek widoku (ms): bąble od tej chwili; zlecenia podaje się od `from − BUBBLES_BARS × intervalMs`. */
  from: number;
  intervalMs: number;
  phone: boolean;
  /** Próg ręczny z ustawień (USD); 0 — reguła przyczynowa. */
  manual: number;
  /** Czy taśma zleceń (z kontami biorców) pokrywa w całości [from, to). */
  covers: (from: number, to: number) => boolean;
}

/** `p` wyżej niż `o`: większa wartość, przy równej wcześniejsze (zlecenia z tej samej chwili i wartości — żadne). */
const above = (p: AggressorOrder, o: AggressorOrder) => p.notional > o.notional || (p.notional === o.notional && p.time < o.time);

/** Kolejność w świecy: większa wartość, wcześniejsze, potem stałe pola (wynik niezależny od kolejności w tablicy). */
const rank = (a: AggressorOrder, b: AggressorOrder) =>
  b.notional - a.notional || a.time - b.time || (a.taker < b.taker ? -1 : a.taker > b.taker ? 1 : 0) || a.vwap - b.vwap || a.sz - b.sz;

/**
 * Bąble z zleceń (rosnąco po czasie). Dla każdego zlecenia przejście wstecz po oknie `(t − 20 świec, t]` z przerwaniem
 * po znalezieniu K wyższych — małe zlecenie kończy po kilku krokach; potem najwyżej K na świecę. Ponad limit —
 * największe, w kolejności czasu.
 */
export function selectBubbles(orders: readonly AggressorOrder[], v: BubbleView): AggressorOrder[] {
  let list: AggressorOrder[];
  if (v.manual > 0) list = orders.filter((o) => o.time >= v.from && o.notional >= v.manual);
  else {
    const k = v.phone ? BUBBLES_K_PHONE : BUBBLES_K;
    const span = BUBBLES_BARS * v.intervalMs;
    const passed: AggressorOrder[] = [];
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (o.time < v.from || !v.covers(o.time - span, o.time)) continue;
      let higher = 0;
      for (let j = i - 1; j >= 0 && orders[j].time > o.time - span && higher < k; j--) if (above(orders[j], o)) higher++;
      // Zlecenia z tej samej chwili dalej w tablicy (kolejność w tablicy bez znaczenia)
      for (let j = i + 1; j < orders.length && orders[j].time === o.time && higher < k; j++) if (above(orders[j], o)) higher++;
      if (higher < k) passed.push(o);
    }
    // Kaskada: najwyżej K największych na świecę (lista rosnąco po czasie, więc świece są kolejnymi odcinkami)
    const keep = new Set<AggressorOrder>();
    for (let a = 0; a < passed.length; ) {
      const bar = barStart(passed[a].time, v.intervalMs);
      let b = a;
      while (b < passed.length && barStart(passed[b].time, v.intervalMs) === bar) b++;
      for (const o of passed.slice(a, b).sort(rank).slice(0, k)) keep.add(o);
      a = b;
    }
    list = passed.filter((o) => keep.has(o));
  }
  if (list.length <= BUBBLES_MAX) return list;
  const top = new Set([...list].sort(rank).slice(0, BUBBLES_MAX));
  return list.filter((o) => top.has(o));
}
