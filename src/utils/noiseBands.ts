// Pasma szumu krótkich estymatorów: jak wyglądają liczby z czystego szumu przy tej samej długości okna.
// Symulacja N = 20 000 (ziarno 20261115), te same metody co quantMathEngine.

/** Hurst (R/S z korektą Anis-Lloyd) na 45 zwrotach iid: 5. i 95. percentyl. */
export const HURST_NOISE = { n: 45, p5: 0.396, p95: 0.594 } as const;

/** OU na 40 świecach czystego błądzenia losowego: 95. percentyl θ (fałszywy alarm 5%). */
export const OU_THETA_NOISE_P95 = 0.133;
/** Półokres odpowiadający progowi θ: krótszy t½ odróżnia się od błądzenia losowego. */
export const OU_HALF_LIFE_MAX_BARS = Math.LN2 / OU_THETA_NOISE_P95;

export type HurstSide = 'anti' | 'noise' | 'persist';

/** Strona pasma szumu; wartości w paśmie 90% czystego szumu nie mówią nic o rynku. */
export function hurstSide(h: number): HurstSide {
  if (h < HURST_NOISE.p5) return 'anti';
  if (h > HURST_NOISE.p95) return 'persist';
  return 'noise';
}

/** Czy szybkość powrotu OU odróżnia się od błądzenia losowego (θ powyżej 95. percentyla pod szumem). */
export function ouReversionShown(theta: number): boolean {
  return Number.isFinite(theta) && theta > OU_THETA_NOISE_P95;
}
