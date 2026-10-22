/**
 * Koszt wykonania zlecenia rynkowego z profilu głębokości arkusza (rejestrator płynności skanera).
 * Skumulowana głębokość jednej strony jako funkcja odległości od środka: liniowo przez (0, 0), (10 bp, D10),
 * (20 bp, D20); dalej prawo pierwiastka kwadratowego skalibrowane w ostatnim znanym punkcie: x(q) = x₀·√(q/D₀)
 * (Tóth i in. 2011; Bouchaud, Bonart, Donier, Gould 2018). Średni poślizg = (1/Q)∫₀^Q x(q) dq.
 * Widoczne zlecenia bez ukrytych; zlecenie samo zmienia arkusz — to średnia, nie gwarancja.
 */

export interface SideDepth {
  /** USD po jednej stronie w ±10 bp od środka */
  d10: number;
  /** USD po jednej stronie w ±20 bp; null = brak pomiaru */
  d20: number | null;
}

/** Średni poślizg (bp od środka) dla zlecenia `q` USD; null = brak danych. */
export function slippageBp(q: number, d: SideDepth): number | null {
  if (!(q >= 0)) return null;
  if (q === 0) return 0;
  if (!(d.d10 > 0)) return null;
  const s10 = d.d10;
  const s20 = d.d20 !== null && d.d20 > s10 ? d.d20 : null;
  // ∫ x(q) dq po odcinkach
  const q1 = Math.min(q, s10);
  let integral = (5 * q1 * q1) / s10;
  if (q > s10) {
    if (s20 !== null) {
      const q2 = Math.min(q, s20);
      integral += 10 * (q2 - s10) + (5 * (q2 - s10) ** 2) / (s20 - s10);
      if (q > s20) integral += ((40 / 3) * (q ** 1.5 - s20 ** 1.5)) / Math.sqrt(s20);
    } else {
      integral += ((20 / 3) * (q ** 1.5 - s10 ** 1.5)) / Math.sqrt(s10);
    }
  }
  return integral / q;
}

export interface HourDepth {
  h: number;
  /** Mediany stron (opcjonalne — starsze profile mają tylko sumę obu stron) */
  b10?: number | null;
  a10?: number | null;
  b20?: number | null;
  a20?: number | null;
  /** Suma obu stron */
  d10: number | null;
  d20: number | null;
  /** 25. percentyl sumy ±10 bp (warunki cienkie) — opcjonalny */
  thin10?: number | null;
  n: number;
  days: number;
}

export interface HourCost {
  h: number;
  slipBp: number | null;
  /** Poślizg + opłata takera */
  totalBp: number | null;
}

/**
 * Głębokość strony: mediana strony, a bez niej połowa sumy obu stron. `thin` — przeskalowana przez 25. percentyl /
 * medianę sumy ±10 bp (warunki cienkie; ten sam współczynnik dla ±20 bp — przybliżenie).
 */
function side(b: HourDepth, s: 'buy' | 'sell', thin = false): SideDepth | null {
  const f = thin ? (b.thin10 != null && b.d10 ? b.thin10 / b.d10 : null) : 1;
  if (f === null) return null;
  const d10 = (s === 'buy' ? b.a10 : b.b10) ?? (b.d10 !== null ? b.d10 / 2 : null);
  const d20 = (s === 'buy' ? b.a20 : b.b20) ?? (b.d20 !== null ? b.d20 / 2 : null);
  return d10 !== null && d10 > 0 ? { d10: d10 * f, d20: d20 === null ? null : d20 * f } : null;
}

/** Koszt zlecenia rynkowego `q` USD wg godziny UTC; trzy najtańsze i trzy najdroższe godziny z danymi. */
export function costByHour(
  byHour: readonly HourDepth[],
  q: number,
  s: 'buy' | 'sell',
  takerFee: number,
  o: { thin?: boolean } = {}
): { hours: HourCost[]; best: number[]; worst: number[] } {
  const hours = byHour.map((b): HourCost => {
    const d = side(b, s, o.thin);
    const slip = d ? slippageBp(q, d) : null;
    return { h: b.h, slipBp: slip, totalBp: slip === null ? null : slip + takerFee * 1e4 };
  });
  const ranked = hours.filter((x) => x.slipBp !== null).sort((a, b) => a.slipBp! - b.slipBp!);
  return { hours, best: ranked.slice(0, 3).map((x) => x.h), worst: ranked.slice(-3).reverse().map((x) => x.h) };
}

/**
 * Koszt teraz: bieżąca suma głębokości ±10 / ±20 bp (ostatnia minuta rejestratora), podzielona na strony w proporcji
 * median tej godziny (bez median — po połowie). null = brak bieżącej minuty.
 */
export function nowCost(
  now: { t: number; d10: number; d20: number | null } | null,
  hour: HourDepth | undefined,
  q: number,
  s: 'buy' | 'sell',
  takerFee: number
): HourCost | null {
  if (!now) return null;
  const b10 = hour?.b10;
  const a10 = hour?.a10;
  const share10 = b10 != null && a10 != null && b10 + a10 > 0 ? (s === 'buy' ? a10 : b10) / (b10 + a10) : 0.5;
  const b20 = hour?.b20;
  const a20 = hour?.a20;
  const share20 = b20 != null && a20 != null && b20 + a20 > 0 ? (s === 'buy' ? a20 : b20) / (b20 + a20) : 0.5;
  const slip = slippageBp(q, { d10: now.d10 * share10, d20: now.d20 === null ? null : now.d20 * share20 });
  return { h: new Date(now.t).getUTCHours(), slipBp: slip, totalBp: slip === null ? null : slip + takerFee * 1e4 };
}
