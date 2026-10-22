/**
 * Wnioskowanie ważne w dowolnej chwili (anytime-valid) dla wyników w [0, 1] o średniej `p0` pod H0
 * oraz kontrola FDR. Używane przez laboratorium folkloru (prerejestrowana ocena do przodu) — wynik można sprawdzać
 * po każdym zdarzeniu bez psucia poziomu błędu (nierówność Ville’a).
 *
 * - Proces zakładów: E_t = Π (1 + λ_i (x_i − p0_i)), λ_i przewidywalne (aGRAPA) — pod H0: E[x_i − p0_i | przeszłość] ≤ 0
 *   jest nieujemnym nadmartyngałem, więc P(sup E ≥ 1/α) ≤ α. Waudby-Smith, Ramdas (2023), JRSS B 86(1).
 * - e-BH: FDR ≤ α przy dowolnej zależności między e-wartościami. Wang, Ramdas (2022), JRSS B 84(3).
 * - Sekwencja ufności efektu E[x − p0] (stały efekt): kapitał zabezpieczony (hedged) z predictable plug-in.
 * - Benjamini–Hochberg (1995) dla testów historycznych (eksploracyjnych).
 */

export interface BernEvent {
  /** Wynik w [0, 1]: 1 = sukces, 0 = porażka, ułamek = wartość zatrzymanego martyngału */
  x: number;
  /** P(x = 1) pod H0 — z twierdzenia o opcjonalnym zatrzymaniu albo z symetrii */
  p0: number;
}

/** Średnia i wariancja z łagodnym priorem (0 i 1/4 — jak w Waudby-Smith & Ramdas) do przewidywalnych stawek */
class RunningMoments {
  private n = 0;
  private sum = 0;
  private ss = 0.25;
  get mean(): number {
    return this.sum / (this.n + 1);
  }
  get variance(): number {
    return this.ss / (this.n + 1);
  }
  get count(): number {
    return this.n;
  }
  push(y: number): void {
    const m = this.mean;
    this.n++;
    this.sum += y;
    this.ss += (y - m) ** 2;
  }
}

/**
 * Trajektoria e-wartości (po każdym zdarzeniu) dla H0: efekt ≤ 0 przeciw efektowi > 0. Stawka aGRAPA
 * λ = μ̂ / (σ̂² + μ̂²) z danych sprzed zdarzenia, obcięta do [0, c/p0] (strata najwyżej ułamka c kapitału).
 */
export function bettingEProcess(events: readonly BernEvent[], c = 0.5): number[] {
  const mom = new RunningMoments();
  const out: number[] = [];
  let e = 1;
  for (const ev of events) {
    const mu = mom.mean;
    const lam = mom.count === 0 ? 0 : Math.min(Math.max(0, mu / (mom.variance + mu * mu)), c / Math.max(ev.p0, 1e-9));
    const y = ev.x - ev.p0;
    e *= 1 + lam * y;
    out.push(e);
    mom.push(y);
  }
  return out;
}

/** e-BH: odrzucone hipotezy (true) — k* największych e-wartości, k* = max{k : e₍ₖ₎ ≥ K/(α·k)}. */
export function eBH(e: readonly number[], alpha: number): boolean[] {
  const K = e.length;
  const order = e.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  let kStar = 0;
  for (let k = 1; k <= K; k++) if (order[k - 1][0] >= K / (alpha * k)) kStar = k;
  const out = Array<boolean>(K).fill(false);
  for (let k = 0; k < kStar; k++) out[order[k][1]] = true;
  return out;
}

/** q-wartości Benjaminiego–Hochberga w kolejności wejścia. */
export function bhQValues(p: readonly number[]): number[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const q = Array<number>(m).fill(1);
  let run = 1;
  for (let j = m - 1; j >= 0; j--) {
    run = Math.min(run, (m * order[j][0]) / (j + 1));
    q[order[j][1]] = Math.min(1, run);
  }
  return q;
}

/**
 * Sekwencja ufności (1 − α) dla stałego efektu m = E[x − p0]: kandydat m odpada na stałe, gdy zabezpieczony kapitał
 * max(½K⁺, ½K⁻) przekroczy 1/α (przecięcie po czasie). Siatka co `step` w [−1, 1]; null = brak zdarzeń albo
 * wszystkie kandydaty odrzucone (model niezgodny z danymi).
 */
export function effectCS(events: readonly BernEvent[], alpha = 0.1, step = 0.005, c = 0.5): { lo: number; hi: number } | null {
  if (events.length === 0) return null;
  const grid: number[] = [];
  for (let m = -1; m <= 1 + 1e-9; m += step) grid.push(Math.round(m / step) * step);
  const kp = new Float64Array(grid.length).fill(1);
  const km = new Float64Array(grid.length).fill(1);
  const out = new Uint8Array(grid.length);
  const mom = new RunningMoments();
  const logTerm = Math.log(2 / alpha);
  let t = 0;
  for (const ev of events) {
    t++;
    // Predictable plug-in (Waudby-Smith & Ramdas, PrPl): λ_t = √(2 log(2/α) / (σ̂²_{t−1} · t · log(t + 1)))
    const lamBase = Math.sqrt((2 * logTerm) / (mom.variance * t * Math.log(t + 1)));
    const y = ev.x - ev.p0;
    for (let g = 0; g < grid.length; g++) {
      if (out[g]) continue;
      const m = grid[g];
      const lo = -ev.p0 - m;
      const hi = 1 - ev.p0 - m;
      const capP = lo < 0 ? c * Math.min(1, -1 / lo) : c;
      const capM = hi > 0 ? c * Math.min(1, 1 / hi) : c;
      kp[g] *= 1 + Math.min(lamBase, capP) * (y - m);
      km[g] *= 1 - Math.min(lamBase, capM) * (y - m);
      if (Math.max(kp[g], km[g]) / 2 >= 1 / alpha) out[g] = 1;
    }
    mom.push(y);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let g = 0; g < grid.length; g++) {
    if (out[g]) continue;
    lo = Math.min(lo, grid[g]);
    hi = Math.max(hi, grid[g]);
  }
  return Number.isFinite(lo) ? { lo, hi } : null;
}
