import type { AggressorOrder } from '../core/orders';

/**
 * Co rysuje warstwa bąbli — czysta funkcja, wspólna dla warstwy i pomiaru układu (`ui:check`):
 * - reguła przyczynowa zamiast progu z kwantyla: bąbel, gdy w chwili wykonania zlecenie było wśród 2 największych
 *   zleceń agresora z poprzednich 20 świec interwału wykresu (telefon: największe); wynik zależy tylko od taśmy przed
 *   zleceniem, więc raz narysowany bąbel zostaje — nie zależy od przewinięcia, zbliżenia ani późniejszych zleceń,
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
}

/** `p` wyżej niż `o`: większa wartość, przy równej wcześniejsze (zlecenia z tej samej chwili i wartości — żadne). */
const above = (p: AggressorOrder, o: AggressorOrder) => p.notional > o.notional || (p.notional === o.notional && p.time < o.time);

/**
 * Bąble z zleceń (rosnąco po czasie). Dla każdego zlecenia przejście wstecz po oknie `(t − 20 świec, t]` z przerwaniem
 * po znalezieniu K wyższych — małe zlecenie kończy po kilku krokach. Ponad limit — największe, w kolejności czasu.
 */
export function selectBubbles(orders: readonly AggressorOrder[], v: BubbleView): AggressorOrder[] {
  let list: AggressorOrder[];
  if (v.manual > 0) list = orders.filter((o) => o.time >= v.from && o.notional >= v.manual);
  else {
    const k = v.phone ? BUBBLES_K_PHONE : BUBBLES_K;
    const span = BUBBLES_BARS * v.intervalMs;
    list = [];
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (o.time < v.from) continue;
      let higher = 0;
      for (let j = i - 1; j >= 0 && orders[j].time > o.time - span && higher < k; j--) if (above(orders[j], o)) higher++;
      // Zlecenia z tej samej chwili dalej w tablicy (kolejność w tablicy bez znaczenia)
      for (let j = i + 1; j < orders.length && orders[j].time === o.time && higher < k; j++) if (above(orders[j], o)) higher++;
      if (higher < k) list.push(o);
    }
  }
  if (list.length <= BUBBLES_MAX) return list;
  const keep = new Set([...list].sort((a, b) => b.notional - a.notional || a.time - b.time).slice(0, BUBBLES_MAX));
  return list.filter((o) => keep.has(o));
}
