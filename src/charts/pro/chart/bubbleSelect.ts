import type { AggressorOrder } from '../core/orders';

/**
 * Co rysuje warstwa bąbli — czysta funkcja, wspólna dla warstwy i pomiaru układu (`ui:check`):
 * - próg zależny od interwału, z chwili zdarzenia: wartość, powyżej której w poprzedniej dobie było średnio 0,15
 *   zlecenia na świecę interwału (bąbel co ~7 świec); liczony raz na godzinę z taśmy przed nią, więc bąble minionych
 *   godzin nie zmieniają się z przewinięciem, zbliżeniem ani upływem czasu; próg ręczny z ustawień bez zmian,
 * - bez wyboru „największych w oknie” (dawny limit 0,6 na świecę był osiągany prawie zawsze, a zbiór zależał od okna),
 * - bezpiecznik: najwyżej 40 bąbli na ekran.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const BUBBLES_PER_BAR = 0.15;
export const BUBBLES_MAX = 40;
/** Mniej zleceń w poprzedniej dobie — próg zastępczy (za mała próbka do kwantyla). */
const MIN_SAMPLES = 200;

/** Wynik sprawdzianu do opisu warstwy (PL i EN). */
export const BUBBLES_EVIDENCE = {
  pl: 'Po dużym zleceniu cena nie idzie w jego stronę: −0,2 pb po 5 min (n 33 831).',
  en: 'After a large order the price does not follow it: −0.2 bp after 5 min (n 33,831).',
};

/**
 * Próg bąbli (USD) w chwili `t` dla świec `intervalMs`: ręczny albo `n`-te największe zlecenie z doby przed początkiem
 * godziny (`n` = 0,15 × liczba świec w dobie; przy krótszej historii — w pokrytym czasie). Za mała próbka — `fallback`.
 * `memo` — progi godzin wspólne dla kolejnych scen tego interwału; właściciel czyści je po doczytaniu historii.
 */
export function bubbleThresholdAt(
  orders: (from: number, to: number) => readonly AggressorOrder[],
  intervalMs: number,
  manual: number,
  fallback: (t: number) => number,
  memo: Map<number, number> = new Map()
): (t: number) => number {
  if (manual > 0) return () => manual;
  return (t) => {
    const h = Math.floor(t / HOUR) * HOUR;
    let v = memo.get(h);
    if (v === undefined) {
      const list = orders(h - DAY, h);
      if (list.length < MIN_SAMPLES) v = fallback(t);
      else {
        let first = h;
        for (const o of list) first = Math.min(first, o.time);
        const n = Math.max(1, Math.round((BUBBLES_PER_BAR * (h - first)) / intervalMs));
        // Tablica liczb sortowana bez porównywarki (doba to do kilkuset tysięcy zleceń)
        const usd = Float64Array.from(list, (o) => o.notional).sort();
        v = usd[usd.length - Math.min(usd.length, n)];
      }
      memo.set(h, v);
    }
    return v;
  };
}

/** Bąble z zleceń widocznego czasu: każde od progu ze swojej chwili; ponad limit — największe względem progu, w kolejności czasu. */
export function selectBubbles(orders: readonly AggressorOrder[], thrAt: (t: number) => number): AggressorOrder[] {
  const list = orders.filter((o) => o.notional >= thrAt(o.time));
  if (list.length <= BUBBLES_MAX) return list;
  const ratio = (o: AggressorOrder) => o.notional / thrAt(o.time);
  const keep = new Set([...list].sort((a, b) => ratio(b) - ratio(a) || a.time - b.time).slice(0, BUBBLES_MAX));
  return list.filter((o) => keep.has(o));
}
