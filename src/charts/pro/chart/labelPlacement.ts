/**
 * Etykiety liczbowe na wykresie ceny (wartości bąbli, ścian i dużych zleceń) i na osi ceny — czyste funkcje bez płótna.
 * Na polu świec podpis dostaje najwyżej `limit` największych obiektów w widoku (5 na komputerze, 3 na telefonie albo
 * gęstość z ustawień), etykiety nie nachodzą na siebie, na etykiety poziomów, na 10 ostatnich świec ani na bąble (chyba
 * że wolno), a przy świecach węższych niż 4 px nie ma ich wcale; reszta po najechaniu (`forced`). Na osi ceny etykieta
 * siatki, która koliduje z ceną (i odliczaniem pod nią) albo z etykietą wskaźnika (VWAP, POC), nie jest rysowana.
 */

export interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** Gęstość etykiet z ustawień: 0, 3, 5 albo wszystkie; brak — domyślna dla ekranu. */
export type LabelDensity = 0 | 3 | 5 | 'all';
export const LABEL_DENSITIES: readonly LabelDensity[] = [0, 3, 5, 'all'];

/** Poniżej tej szerokości świecy (px) etykiet nie ma (gęsty widok). */
export const LABEL_MIN_BAR_PX = 4;
/** Świece przy prawej krawędzi, na które etykiety nie wchodzą. */
export const LAST_CANDLES = 10;

export const densityLimit = (d: LabelDensity | undefined, phone: boolean): number => (d === undefined ? (phone ? 3 : 5) : d === 'all' ? Number.POSITIVE_INFINITY : d);

export const parseDensity = (v: unknown): LabelDensity | undefined => (LABEL_DENSITIES.includes(v as LabelDensity) ? (v as LabelDensity) : undefined);

const hits = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

function circleHits(c: { x: number; y: number; r: number }, q: Box): boolean {
  const dx = Math.max(q.l - c.x, 0, c.x - q.r);
  const dy = Math.max(q.t - c.y, 0, c.y - q.b);
  return dx * dx + dy * dy < (c.r + 1) ** 2;
}

export interface LabelCandidate {
  key: string;
  usd: number;
  /** Pierwszeństwo przed wartością (2 — góra lodowa, 1 — duże zlecenie stojące, 0 — reszta). */
  rank: number;
  /** Możliwe miejsca podpisu w kolejności preferencji (px CSS panelu). */
  spots: readonly Box[];
  /** Podpis może leżeć na bąblu (np. duże zlecenie w arkuszu, tekst w samym bąblu). */
  overBubbles?: boolean;
  /** Obiekt pod kursorem albo zaznaczony: podpis poza limitem. */
  forced?: boolean;
}

/**
 * Wybór i miejsca podpisów: klucz → indeks miejsca w `spots`. Kolejność: wymuszone, potem `rank`, potem wartość;
 * limit liczy podpisane obiekty niewymuszone (obiekt bez wolnego miejsca oddaje swoje następnemu).
 */
export function placeLabels(
  cands: readonly LabelCandidate[],
  o: { limit: number; barPx: number; blocked: readonly Box[]; circles: readonly { x: number; y: number; r: number }[] }
): Map<string, number> {
  const out = new Map<string, number>();
  if (!(o.barPx >= LABEL_MIN_BAR_PX)) return out;
  const order = [...cands].sort((p, q) => Number(!!q.forced) - Number(!!p.forced) || q.rank - p.rank || q.usd - p.usd);
  const placed: Box[] = [];
  let free = o.limit;
  for (const c of order) {
    if (!c.forced && free <= 0) continue;
    const at = c.spots.findIndex((s) => !placed.some((p) => hits(p, s)) && !o.blocked.some((p) => hits(p, s)) && (c.overBubbles || !o.circles.some((q) => circleHits(q, s))));
    // Obiekt bez wolnego miejsca nie zabiera limitu: podpis dostaje następny co do wielkości
    if (at < 0) continue;
    if (!c.forced) free--;
    placed.push(c.spots[at]);
    out.set(c.key, at);
  }
  return out;
}

/** Prostokąty `n` ostatnich świec (x lewej krawędzi i szerokość z kolejnej świecy, od szczytu do dołka przez `Y`). */
export function lastCandleBoxes(bars: readonly { x: number; hi: number; lo: number }[], n: number, Y: (p: number) => number): Box[] {
  const from = Math.max(0, bars.length - n);
  const sp = bars.length > 1 ? bars[bars.length - 1].x - bars[bars.length - 2].x : 0;
  return bars.slice(from).map((b) => {
    const ya = Y(b.hi);
    const yb = Y(b.lo);
    return { l: b.x, r: b.x + sp, t: Math.min(ya, yb), b: Math.max(ya, yb) };
  });
}

/**
 * Które etykiety siatki osi ceny zostają: `ys` — ich współrzędne (null — poza skalą), `reserved` — etykiety ważniejsze
 * (y środka i liczba etykiet pod nią, np. odliczanie pod ceną), `h` — wysokość etykiety osi.
 */
export function keepTicks(ys: readonly (number | null)[], reserved: readonly { y: number; below: number }[], h: number): boolean[] {
  const boxes = reserved.map((r) => ({ t: r.y - h / 2, b: r.y + h / 2 + r.below * h }));
  return ys.map((y) => y === null || !boxes.some((q) => y - h / 2 < q.b && y + h / 2 > q.t));
}
