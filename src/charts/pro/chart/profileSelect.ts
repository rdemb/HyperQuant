/**
 * Profile dób na polu świec (TPO i profile okresów) — czyste funkcje wyboru i geometrii, wspólne dla warstw i pomiaru
 * układu (`ui:check`):
 * - najdłuższy słupek najwyżej 35% szerokości doby i nigdy ponad 30% szerokości pola wykresu (dotąd 75% doby w TPO,
 *   więc na telefonie, gdzie doba jest szersza niż ekran, profil zajmował ok. 41% pola),
 * - pełny profil (słupki, znaczniki wydruków i ogonów) dla bieżącej i poprzedniej doby; starsze — linia POC i pasek
 *   obszaru wartości; bieżąca i poprzednia z danych (ostatnia świeca), nie z przewinięcia; bieżąca doba zaczęta przed
 *   lewą krawędzią pola rysuje słupki od krawędzi (przy limicie 30% pola słupki spoza ekranu by nie sięgały),
 * - nietknięte POC: najwyżej 3 najbliższe cenie (dotąd 6 w TPO i 8 w profilach okresów, najnowsze).
 */

export const PROFILE_DAY_FILL = 0.35;
export const PROFILE_FIELD_MAX = 0.3;
/** Okresy z pełnym profilem: bieżący i poprzedni. */
export const FULL_PERIODS = 2;
export const NAKED_POC_SHOWN = 3;

/** Wynik sprawdzianu do opisu warstw (PL i EN). */
export const PROFILE_EVIDENCE = {
  pl: 'POC poprzedniej doby nie przyciąga ceny: dotykany w 71% dób, losowy poziom w tej samej odległości w 73%.',
  en: "The previous day's POC does not attract price: touched on 71% of days, a random level at the same distance on 73%.",
};

/** Długość najdłuższego słupka (px) dla doby szerokiej na `dayPx` w polu wykresu szerokim na `fieldPx`. */
export const barSpan = (dayPx: number, fieldPx: number): number => Math.max(0, Math.min(dayPx * PROFILE_DAY_FILL, fieldPx * PROFILE_FIELD_MAX));

/** Odstęp od lewej krawędzi pola (px) dla słupków doby zaczętej przed nią: miejsce na paski value area i pierwszej godziny. */
const EDGE_PX = 8;

/** Początek słupków doby: jej początek albo — gdy zaczęła się przed lewą krawędzią pola — tuż przy krawędzi. */
export const profileAnchor = (x0: number): number => Math.max(x0, EDGE_PX);

/** Indeks pierwszego okresu z pełnym profilem w liście `n` okresów rosnąco po czasie. */
export const fullFrom = (n: number): number => Math.max(0, n - FULL_PERIODS);

/**
 * Wspólna skala słupków: największy wiersz z dób z pełnym profilem (bieżącej i poprzedniej), niezależnie od widoku —
 * przewinięcie nie zmienia długości słupków bieżącej doby.
 */
export function fullScaleMax(list: readonly { max: number }[]): number {
  let m = 0;
  for (let k = fullFrom(list.length); k < list.length; k++) m = Math.max(m, list[k].max);
  return m;
}

/** Indeksy nietkniętych POC do rysowania: najwyżej `NAKED_POC_SHOWN` najbliższych cenie `price`. */
export function nearestNaked(pocs: readonly { px: number; naked: boolean }[], price: number): Set<number> {
  const idx: number[] = [];
  pocs.forEach((p, i) => {
    if (p.naked) idx.push(i);
  });
  idx.sort((a, b) => Math.abs(pocs[a].px - price) - Math.abs(pocs[b].px - price) || b - a);
  return new Set(idx.slice(0, NAKED_POC_SHOWN));
}

/** Liczba odcinków (sąsiednich wierszy z flagą): znacznik wydruków albo ogona to jeden obiekt. */
export function runs(flags: readonly boolean[]): number {
  let n = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i] && !flags[i - 1]) n++;
  return n;
}

/** Udział pola panelu `W` × `H` pod prostokątami (przyciętymi do panelu). */
export function rectShare(rects: readonly { x: number; y: number; w: number; h: number }[], W: number, H: number): number {
  if (!(W > 0) || !(H > 0)) return 0;
  let a = 0;
  for (const r of rects) {
    const w = Math.min(W, r.x + r.w) - Math.max(0, r.x);
    const h = Math.min(H, r.y + r.h) - Math.max(0, r.y);
    if (w > 0 && h > 0) a += w * h;
  }
  return a / (W * H);
}
