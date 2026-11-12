import { LIFE, type Range } from '../core/pbRanges';

/**
 * Co rysuje warstwa „Zakresy P/b (Nill)” — czyste funkcje, wspólne dla warstwy i pomiaru układu (`ui:check`):
 * - zakres w budowie nie jest rysowany (zmieniał się albo znikał zawsze); legenda mówi „w budowie: 2 dotknięcia z 3”,
 * - rysowany zakres aktywny (wypełnienie od świecy potwierdzenia, wcześniejsza część jako kropkowany obrys, kółka
 *   dotknięć) i ostatni zakończony (sam obrys); dotąd po potwierdzeniu pojawiał się prostokąt sięgający ok. 4 h wstecz,
 * - najwyżej 3 ostatnie miejsca 👀 i najwyżej 2 poziomy tygodnia i doby najbliższe nad ceną oraz 2 pod nią,
 * - stan chwili X tylko z zakresów potwierdzonych do X (przeliczenie ze świec zamkniętych do X).
 */

export const PB_SPOTS_MAX = 3;
export const PB_LEVELS_PER_SIDE = 2;
/** Dotknięcia potrzebne do ważności zakresu (do legendy zakresu w budowie). */
export const PB_TOUCHES = 3;

/** Wynik miejsc 👀 z 2026 r. do opisu wskaźnika (PL i EN). */
export const PB_EVIDENCE = {
  pl: 'W 2026 r. (BTC 5m) ruch o 1 ATR w stronę 👀, zanim cena przeszła 1 ATR przeciw, liczony od zamknięcia świecy: A 52% (n 183), B 48% (n 29), C 53% (n 59), czyli bez przewagi.',
  en: 'In 2026 (BTC 5m), a 1 ATR move toward 👀 before a 1 ATR move against, measured from the candle close: A 52% (n 183), B 48% (n 29), C 53% (n 59), i.e. no edge.',
};

const confirmed = (r: Range, last: number) => r.kv !== null && r.kv <= last;
/** Ważny zakres przed wybiciem i końcem życia w chwili świecy `last`. */
export const isActive = (r: Range, last: number): boolean => confirmed(r, last) && r.x === null && r.kv! + LIFE > last;

/** Indeksy zakresów do rysowania w chwili świecy `last`: aktywny (najnowszy) i ostatni zakończony; zakres w budowie — nigdy. */
export function selectRanges(rs: readonly Range[], last: number): { active: number | null; done: number | null } {
  let active: number | null = null;
  let done: number | null = null;
  for (let i = rs.length - 1; i >= 0 && (active === null || done === null); i--) {
    const r = rs[i];
    if (!confirmed(r, last)) continue;
    if (isActive(r, last)) {
      if (active === null) active = i;
    } else if (done === null) done = i;
  }
  return { active, done };
}

/**
 * Świece pudełka: `from` — pierwsza po impulsie (początek kropkowanego obrysu), `fillFrom` — świeca potwierdzenia (od
 * niej wypełnienie), `to` — ostatnia świeca; `open` — aktywny zakres sięga prawej krawędzi.
 */
export function boxSpan(r: Range, last: number, active: boolean): { from: number; fillFrom: number; to: number; open: boolean } {
  return { from: r.e + 1, fillFrom: r.kv ?? r.e + 1, to: active ? last : r.end, open: active };
}

/** Indeksy najwyżej `PB_SPOTS_MAX` najnowszych miejsc 👀 (po chwili `t`). */
export function selectSpots(list: readonly { t: number }[]): Set<number> {
  const idx = list.map((_, i) => i).sort((a, b) => list[b].t - list[a].t || b - a);
  return new Set(idx.slice(0, PB_SPOTS_MAX));
}

/** Indeksy poziomów do rysowania: najwyżej `PB_LEVELS_PER_SIDE` najbliższe nad ceną `price` i tyle samo pod nią. */
export function nearestLevels(list: readonly { px: number }[], price: number): Set<number> {
  const side = (up: boolean) =>
    list
      .map((l, i) => ({ i, d: l.px - price }))
      .filter((x) => (up ? x.d >= 0 : x.d < 0))
      .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.i - b.i)
      .slice(0, PB_LEVELS_PER_SIDE)
      .map((x) => x.i);
  return new Set([...side(true), ...side(false)]);
}

/** Zakres w budowie do legendy (kształt, liczba dotknięć, koniec impulsu); null — brak. */
export function formingNote(rs: readonly Range[]): { s: 1 | -1; touches: number; e: number } | null {
  const f = rs.find((r) => r.kv === null);
  return f ? { s: f.s, touches: f.touches.length, e: f.e } : null;
}
