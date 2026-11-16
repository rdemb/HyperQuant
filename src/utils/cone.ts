/**
 * Stożek prognozy z dziennika Desku bez modułów wykresu: wybór prognozy do rysowania i kwantyl log-zwrotu po `s` minutach.
 * Wspólne dla warstwy stożka na wykresie (`charts/pro/chart/coneLayer`, sterownik wykresu) i panelu „Najbliższe poziomy”,
 * więc granice w panelu są tymi samymi liczbami co krzywe stożka.
 */
import type { DeskLedgerSummary } from './deskLedger';

/** Prognoza rozkładu log-zwrotu z dziennika Desku: chwila wydania, cena wtedy i kwantyle na horyzontach (minuty, rosnąco). */
export interface ConeForecast {
  t: number;
  px0: number;
  horizons: readonly { h: number; taus: readonly number[]; q: readonly number[] }[];
}

/** Prognoza z dziennika starsza niż to nie jest rysowana (jak przeterminowany dziennik prognoz Po sesji). */
export const CONE_MAX_AGE_MS = 3 * 3_600_000;

/**
 * Najnowsza prognoza dziennika dla stożka: rynek `coin`, horyzonty z tej samej chwili, nie starsza niż 3 h i nie
 * z przyszłości względem `now` (powtórka). Brak — null.
 */
export function coneForecastOf(ledger: DeskLedgerSummary | null, coin: string, now: number): ConeForecast | null {
  if (!ledger || ledger.coin !== coin || ledger.latest.ret.length === 0) return null;
  const t = Math.max(...ledger.latest.ret.map((r) => r.t));
  if (t > now || now - t > CONE_MAX_AGE_MS) return null;
  const rets = ledger.latest.ret.filter((r) => r.t === t).sort((a, b) => a.h - b.h);
  return { t, px0: rets[0].px0, horizons: rets.map((r) => ({ h: r.h, taus: r.taus, q: r.q })) };
}

/**
 * Kwantyl log-zwrotu po `s` minutach od wydania: dokładny na horyzontach dziennika, między nimi (i od zera do pierwszego)
 * liniowo w pierwiastku czasu, jak rozrzut błądzenia losowego. Poza ostatnim horyzontem i bez tego kwantyla — null.
 */
export function coneQuantile(f: ConeForecast, tau: number, s: number): number | null {
  let s0 = 0;
  let q0 = 0;
  for (const hz of f.horizons) {
    const k = hz.taus.indexOf(tau);
    if (k < 0) return null;
    const q1 = hz.q[k];
    if (s <= hz.h) {
      const span = Math.sqrt(hz.h) - Math.sqrt(s0);
      return span > 0 ? q0 + ((q1 - q0) * (Math.sqrt(Math.max(s, s0)) - Math.sqrt(s0))) / span : q1;
    }
    s0 = hz.h;
    q0 = q1;
  }
  return null;
}
