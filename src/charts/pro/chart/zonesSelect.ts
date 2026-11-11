import type { ImbalanceZone, UnfinishedAuction } from '../core/zones';

/**
 * Co rysuje warstwa stref nierównowagi i niedokończonych aukcji w chwili `asOf` (ostatnia zamknięta świeca, w powtórce
 * świeca powtórki) — czysta funkcja, wspólna dla warstwy i pomiaru układu (`ui:check`):
 * - strefy otwarte w chwili `asOf`, które przeżyły co najmniej jedną zamkniętą świecę po swojej (`from <= asOf − ms`;
 *   mediana życia strefy to 1 świeca, więc bez tego ekran zajmowały głównie strefy znikające po jednej), najwyżej 2 na
 *   stronę (kupno, sprzedaż) najbliższe ostatniemu zamknięciu; zamknięta znika,
 * - niedokończone aukcje otwarte, najwyżej 1 na stronę (szczyt, dołek) najbliższa cenie,
 * - tryb „Historia”: wszystkie strefy i aukcje znane w chwili `asOf`, samymi obrysami.
 * Równa odległość — młodsza; cena w strefie — odległość 0.
 */

export const ZONES_PER_SIDE = 2;
export const AUCTIONS_PER_SIDE = 1;

/** Wynik sprawdzianu do opisu warstwy (PL i EN). */
export const ZONES_EVIDENCE = {
  pl: 'Po pierwszym wejściu ceny strefa dała reakcję w 14% przypadków, tak samo jak losowe miejsce (n 1 495, listopad 2026).',
  en: 'After the price first entered it, a zone gave a reaction in 14% of cases, the same as a random place (n 1,495, November 2026).',
};

export interface ZonesSelection {
  zones: ImbalanceZone[];
  auctions: UnfinishedAuction[];
  history: boolean;
}

const known = (from: number, asOf: number) => from <= asOf;
const openAt = (from: number, to: number | null, asOf: number) => from <= asOf && (to === null || to > asOf);
const distZone = (z: ImbalanceZone, close: number) => (close >= z.lo && close <= z.hi ? 0 : Math.min(Math.abs(close - z.lo), Math.abs(close - z.hi)));

/** Najwyżej `k` najbliższych z każdej grupy (klucz `side`), w kolejności grup 1, −1. */
function nearest<T extends { from: number }>(list: readonly T[], group: (x: T) => 1 | -1, dist: (x: T) => number, k: number): T[] {
  const out: T[] = [];
  for (const g of [1, -1] as const) {
    out.push(
      ...list
        .filter((x) => group(x) === g)
        .sort((a, b) => dist(a) - dist(b) || b.from - a.from)
        .slice(0, k)
    );
  }
  return out;
}

/** `o.ms` — długość świecy interwału (warunek wieku strefy). */
export function selectZones(
  zones: readonly ImbalanceZone[],
  auctions: readonly UnfinishedAuction[],
  close: number,
  asOf: number,
  o: { history: boolean; ms: number }
): ZonesSelection {
  if (o.history) return { zones: zones.filter((z) => known(z.from, asOf)), auctions: auctions.filter((u) => known(u.from, asOf)), history: true };
  return {
    zones: nearest(
      zones.filter((z) => openAt(z.from, z.to, asOf) && z.from <= asOf - o.ms),
      (z) => z.side,
      (z) => distZone(z, close),
      ZONES_PER_SIDE
    ),
    auctions: nearest(
      auctions.filter((u) => openAt(u.from, u.to, asOf)),
      (u) => u.end,
      (u) => Math.abs(u.px - close),
      AUCTIONS_PER_SIDE
    ),
    history: false,
  };
}
