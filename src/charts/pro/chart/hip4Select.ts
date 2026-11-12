/**
 * Które progi rynków wynikowych HIP-4 trafiają na wykres — czysta funkcja, wspólna dla warstwy, legendy i pomiaru układu
 * (`ui:check`): na komputerze najwyżej 3 progi najbliższe ceny nad nią i 3 pod nią, na telefonie tylko najbliższy; resztę
 * podaje legenda jako liczbę (dotąd linia z długim podpisem dla każdego płynnego rynku w widoku, do 24).
 */

export const HIP4_PER_SIDE = 3;

/** Indeksy progów do rysowania (rosnąco po cenie) i liczba pozostałych; `price` ≤ 0 — nic. */
export function selectOutcomes(levels: readonly { px: number }[], price: number, phone: boolean): { shown: number[]; rest: number } {
  if (!(price > 0) || levels.length === 0) return { shown: [], rest: levels.length };
  const byDist = levels.map((l, i) => ({ i, d: l.px - price })).sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.i - b.i);
  const pick = phone
    ? byDist.slice(0, 1)
    : [...byDist.filter((x) => x.d >= 0).slice(0, HIP4_PER_SIDE), ...byDist.filter((x) => x.d < 0).slice(0, HIP4_PER_SIDE)];
  const shown = pick.map((x) => x.i).sort((a, b) => levels[a].px - levels[b].px || a - b);
  return { shown, rest: levels.length - shown.length };
}
