import { type Burst, type Wall, WALL_GAP_MS, autoThreshold } from '../core/clashes';
import type { AggressorOrder } from '../core/orders';

/**
 * Co rysuje warstwa „Serie i ściany” — czysta funkcja, wspólna dla warstwy i pomiaru układu (`ui:check`):
 * - próg z chwili zdarzenia: ściana, seria i zlecenie są oceniane progiem godziny, w której powstały, liczonym z taśmy
 *   poprzedniej, zamkniętej godziny (próg bieżący skakał co godzinę, a obiekty z przeszłości znikały i wracały),
 * - ściana na wykresie, gdy trwała co najmniej 10 s albo wchłonęła co najmniej 3 × próg (krótsze zostają w panelu Ściany),
 * - reguła przyczynowa zamiast „największe w oknie”: ściana jest rysowana, gdy w chwili zakończenia była wśród 2
 *   największych ścian zakończonych w poprzednich 60 min (seria — największą serią), więc wybór nie zależy od
 *   przewinięcia, a raz narysowany obiekt zostaje; rysowane tylko, gdy taśma zleceń obejmuje całe 60 min przed końcem,
 * - bezpiecznik ponad zmierzone maksima (11 ścian i 9 serii na 140 świecach): najwyżej 12 największych ścian
 *   zakończonych, 3 trwające i 10 największych serii.
 */

const HOUR = 3_600_000;
/** Ściana krótsza niż tyle ms i mniejsza niż `WALL_BIG` × próg nie jest rysowana. */
export const WALL_MIN_MS = 10_000;
const WALL_BIG = 3;
export const WALLS_DONE_MAX = 12;
export const WALLS_LIVE_MAX = 3;
export const BURSTS_MAX = 10;
/** Okno porównania reguły przyczynowej i liczba miejsc: ściany 2, serie 1 (K z taśmy 4–10.11, opis w CHANGELOG). */
export const RANK_WINDOW_MS = HOUR;
export const WALLS_K = 2;
export const BURSTS_K = 1;

/** Wynik sprawdzianu do opisu warstwy (PL i EN). */
export const CLASHES_EVIDENCE = {
  pl: 'Po ścianie cena nie rusza się w stronę obrony: +0,02 pb po 5 min (n 9 834).',
  en: 'After a wall the price does not move towards its defence: +0.02 bp after 5 min (n 9,834).',
};

/**
 * Próg (USD) obowiązujący w chwili `t`: ręczny z ustawień albo automatyczny z zleceń agresora poprzedniej, zamkniętej
 * godziny (`autoThreshold`), pamiętany na godzinę. Zależy tylko od taśmy tej godziny, więc nie zmienia się wstecz.
 * `memo` — progi godzin (początek godziny → próg) wspólne dla kolejnych scen; właściciel czyści je po doczytaniu historii.
 */
export function thresholdAt(
  orders: (from: number, to: number) => readonly AggressorOrder[],
  manual: number,
  memo: Map<number, number> = new Map(),
  scale = 1
): (t: number) => number {
  if (manual > 0) return () => manual;
  return (t) => {
    const h = Math.floor(t / HOUR) * HOUR;
    let v = memo.get(h);
    if (v === undefined) {
      v = autoThreshold(orders(h - HOUR, h), scale);
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

interface Ranked {
  from: number;
  to: number;
  usd: number;
}

/** `a` wyżej niż `b`: większa wartość, przy równej wcześniejszy koniec, potem wcześniejszy początek. */
const above = (a: Ranked, b: Ranked) => a.usd > b.usd || (a.usd === b.usd && (a.to < b.to || (a.to === b.to && a.from < b.from)));

/**
 * Reguła przyczynowa: obiekty, które w chwili zakończenia (`to`; trwająca ściana — ostatnie wypełnienie) były wśród `k`
 * najwyższych zakończonych w poprzednich `RANK_WINDOW_MS`. Wynik obiektu zależy tylko od obiektów zakończonych przed
 * nim, więc nie zmienia się z przewinięciem ani upływem czasu.
 */
export function causalTop<T extends Ranked>(list: readonly T[], k: number): Set<T> {
  const byEnd = [...list].sort((a, b) => a.to - b.to);
  const out = new Set<T>();
  let lo = 0;
  for (let i = 0; i < byEnd.length; i++) {
    const x = byEnd[i];
    while (byEnd[lo].to <= x.to - RANK_WINDOW_MS) lo++;
    let higher = 0;
    for (let j = lo; j < byEnd.length && byEnd[j].to <= x.to && higher < k; j++) if (byEnd[j] !== x && above(byEnd[j], x)) higher++;
    if (higher < k) out.add(x);
  }
  return out;
}

/**
 * Wybór na ekran; `now` — chwila danych (ściana bez wypełnień od 30 s jest zakończona), `from` — początek widoku.
 * Ściany i serie podaje się od `from − RANK_WINDOW_MS` (do porównania reguły przyczynowej), na ekran trafiają
 * zakończone od `from`. `covers` — czy taśma zleceń pokrywa w całości [od, do): ściana i seria są rysowane tylko przy
 * taśmie z całego okna porównania przed ich końcem (na początku taśmy i po luce porównanie byłoby niepełne); do
 * porównania liczą się wszystkie. Domyślnie pokrycie pełne.
 */
export function selectClashes(
  walls: readonly Wall[],
  list: readonly Burst[],
  now: number,
  thrAt: (t: number) => number,
  from = Number.NEGATIVE_INFINITY,
  covers: (from: number, to: number) => boolean = () => true
): ClashSelection {
  const full = (x: Ranked) => x.to >= from && covers(x.to - RANK_WINDOW_MS, x.to);
  const eligible = walls.filter((w) => wallShown(w, thrAt(w.from)));
  const ranked = causalTop(eligible, WALLS_K);
  const shown = eligible.filter((w) => ranked.has(w) && full(w));
  const byUsd = <T extends { usd: number; from: number }>(a: T, b: T) => b.usd - a.usd || b.from - a.from;
  const live = shown.filter((w) => now - w.to < WALL_GAP_MS).sort(byUsd).slice(0, WALLS_LIVE_MAX);
  const done = shown.filter((w) => now - w.to >= WALL_GAP_MS).sort(byUsd).slice(0, WALLS_DONE_MAX);
  const strong = list.filter((b) => b.usd >= thrAt(b.from));
  const top = causalTop(strong, BURSTS_K);
  const series = strong.filter((b) => top.has(b) && full(b)).sort(byUsd).slice(0, BURSTS_MAX);
  return { walls: [...done, ...live], bursts: series };
}
