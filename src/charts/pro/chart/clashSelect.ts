import { type Burst, type Wall, WALL_GAP_MS, autoThreshold } from '../core/clashes';
import type { AggressorOrder } from '../core/orders';

/**
 * Co rysuje warstwa „Serie i ściany” — czysta funkcja, wspólna dla warstwy i pomiaru układu (`ui:check`):
 * - próg z chwili zdarzenia: ściana, seria i zlecenie są oceniane progiem godziny, w której powstały, liczonym z taśmy
 *   poprzedniej, zamkniętej godziny (próg bieżący skakał co godzinę, a obiekty z przeszłości znikały i wracały),
 * - ściana na wykresie, gdy trwała co najmniej 10 s albo wchłonęła co najmniej 3 × próg (krótsze zostają w panelu Ściany),
 * - najwyżej 5 największych ścian zakończonych, 3 trwające i 5 największych serii.
 */

const HOUR = 3_600_000;
/** Ściana krótsza niż tyle ms i mniejsza niż `WALL_BIG` × próg nie jest rysowana. */
export const WALL_MIN_MS = 10_000;
const WALL_BIG = 3;
export const WALLS_DONE_MAX = 5;
export const WALLS_LIVE_MAX = 3;
export const BURSTS_MAX = 5;

/** Wynik sprawdzianu do opisu warstwy (PL i EN). */
export const CLASHES_EVIDENCE = {
  pl: 'Po ścianie cena nie rusza się w stronę obrony: +0,02 pb po 5 min (n 9 834).',
  en: 'After a wall the price does not move towards its defence: +0.02 bp after 5 min (n 9,834).',
};

/**
 * Próg (USD) obowiązujący w chwili `t`: ręczny z ustawień albo automatyczny z zleceń agresora poprzedniej, zamkniętej
 * godziny (`autoThreshold`), pamiętany na godzinę. Zależy tylko od taśmy tej godziny, więc nie zmienia się wstecz.
 */
export function thresholdAt(orders: (from: number, to: number) => readonly AggressorOrder[], manual: number): (t: number) => number {
  if (manual > 0) return () => manual;
  const memo = new Map<number, number>();
  return (t) => {
    const h = Math.floor(t / HOUR) * HOUR;
    let v = memo.get(h);
    if (v === undefined) {
      v = autoThreshold(orders(h - HOUR, h));
      memo.set(h, v);
    }
    return v;
  };
}

/** Ściana rysowana na wykresie: od progu i trwała co najmniej 10 s albo wchłonęła co najmniej 3 × próg. */
export const wallShown = (w: Wall, thr: number): boolean => w.usd >= thr && (w.to - w.from >= WALL_MIN_MS || w.usd >= WALL_BIG * thr);

export interface ClashSelection {
  walls: Wall[];
  bursts: Burst[];
}

/** Wybór na ekran z obiektów w widocznym czasie; `now` — chwila danych (ściana bez wypełnień od 30 s jest zakończona). */
export function selectClashes(walls: readonly Wall[], list: readonly Burst[], now: number, thrAt: (t: number) => number): ClashSelection {
  const shown = walls.filter((w) => wallShown(w, thrAt(w.from)));
  const byUsd = <T extends { usd: number; from: number }>(a: T, b: T) => b.usd - a.usd || b.from - a.from;
  const live = shown.filter((w) => now - w.to < WALL_GAP_MS).sort(byUsd).slice(0, WALLS_LIVE_MAX);
  const done = shown.filter((w) => now - w.to >= WALL_GAP_MS).sort(byUsd).slice(0, WALLS_DONE_MAX);
  const series = list.filter((b) => b.usd >= thrAt(b.from)).sort(byUsd).slice(0, BURSTS_MAX);
  return { walls: [...done, ...live], bursts: series };
}
