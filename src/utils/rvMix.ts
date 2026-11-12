import { normInv, normalSf } from './forecastScore.ts';

/**
 * Wariant C prognozy zwrotu 1 h: deterministyczne przekształcenie kwantyli wersji A, odtwarzalne z rekordu bez świec
 * i bez symulacji. Krok 1 (poziom): świeża zmienność zrealizowana z 12 zamkniętych świec 5m przed slotem przesuwa skalę
 * A, `q1 = qA · exp(c + κ·x)`, `x = clip(½·ln(rv60 / σA²), −1,5, 1,5)`. Krok 2 (kształt): mieszanina skali (niepewność
 * wariancji) `FC(v) = Σⱼ wⱼ·F1(v / exp(ηⱼ/2))`, `ηⱼ = τ·nⱼ − τ²/2`, z dziewięciowęzłową kwadraturą Gaussa–Hermite'a dla
 * N(0, 1); `F1` = Φ(z(v)), z(v) liniowo przez punkty (q1[k], Φ⁻¹(τ[k])), poza skrajnymi kwantylami z nachyleniem
 * skrajnego odcinka. Kwantyle C — bisekcja FC(v) = τ[k] (40 kroków, start ±6·max|q1|); rekord zaokrągla je do 6 miejsc.
 * Czyste funkcje, bez sieci i stanu.
 */

/** Stałe wariantu C zapisane w planie `ab-v2` przed startem */
export const RVMIX = { kappa: 0.5, c: -0.05, tau: 0.5 } as const;
export const MODEL_C = 'ledger-har-fhs-rvmix-v1';
/** Liczba zamkniętych świec 5m w zmienności zrealizowanej (60 min) */
export const RV_BARS = 12;
const X_CLIP = 1.5;

/** Węzły i wagi kwadratury Gaussa–Hermite'a (9 punktów) dla rozkładu N(0, 1): E f(n) ≈ Σ wⱼ f(nⱼ) */
export const GH9_NODES = [-4.512745863399783, -3.20542900285647, -2.07684797867783, -1.0232556637891326, 0, 1.0232556637891326, 2.07684797867783, 3.20542900285647, 4.512745863399783] as const;
export const GH9_WEIGHTS = [
  2.2345844007746607e-5, 0.0027891413212317692, 0.04991640676521782, 0.24409750289493953, 0.40634920634920635, 0.24409750289493953, 0.04991640676521782, 0.0027891413212317692,
  2.2345844007746607e-5,
] as const;

/** σ wersji A z rozpiętości skrajnych kwantyli: (q[ostatni] − q[0]) / (z(τ ostatni) − z(τ0)) */
export function sigmaFromQuantiles(qA: readonly number[], taus: readonly number[]): number {
  return (qA[qA.length - 1] - qA[0]) / (normInv(taus[taus.length - 1]) - normInv(taus[0]));
}

const increasing = (q: readonly number[]) => q.every((v, i) => Number.isFinite(v) && (i === 0 || v > q[i - 1]));

/** Poziom świeżej zmienności wobec A: x = clip(½·ln(rv60 / σA²), −1,5, 1,5); rv60 = 0 → −1,5 */
export function rvX(rv60: number, sigmaA: number): number {
  const raw = rv60 > 0 ? 0.5 * Math.log(rv60 / (sigmaA * sigmaA)) : -Infinity;
  return Math.min(X_CLIP, Math.max(-X_CLIP, raw));
}

/**
 * Krok 1 (poziom): σA, x i przesunięte kwantyle `q1` (bez zaokrągleń). Kwantyle A nierosnące, σA ≤ 0 albo rv60 spoza
 * [0, ∞) → null (brak wariantu C w slocie). rv60 = 0 daje x = −1,5 po przycięciu.
 */
export function rvLevel(qA: readonly number[], taus: readonly number[], rv60: number, kappa: number, c: number): { sigmaA: number; x: number; q1: number[] } | null {
  if (qA.length !== taus.length || qA.length < 2 || !increasing(qA) || !(rv60 >= 0) || !Number.isFinite(rv60)) return null;
  const sigmaA = sigmaFromQuantiles(qA, taus);
  if (!(sigmaA > 0)) return null;
  const x = rvX(rv60, sigmaA);
  const k = Math.exp(c + kappa * x);
  return { sigmaA, x, q1: qA.map((v) => v * k) };
}

/** Φ(z) z erfc skanera */
const Phi = (z: number) => 1 - normalSf(z);

/**
 * Krok 2 (kształt): kwantyle mieszaniny skali dla kwantyli `q1` (rosnących) i poziomów `taus`; τ = 0 zwraca `q1` bez
 * zmian. Bez zaokrągleń (rekord zaokrągla do 6 miejsc).
 */
export function scaleMixQuantiles(q1: readonly number[], taus: readonly number[], tau: number): number[] {
  if (tau === 0) return [...q1];
  const z = taus.map((t) => normInv(t));
  const n = q1.length;
  const zOf = (v: number): number => {
    if (v <= q1[0]) return z[0] + ((v - q1[0]) * (z[1] - z[0])) / (q1[1] - q1[0]);
    if (v >= q1[n - 1]) return z[n - 1] + ((v - q1[n - 1]) * (z[n - 1] - z[n - 2])) / (q1[n - 1] - q1[n - 2]);
    let i = 1;
    while (q1[i] < v) i++;
    return z[i - 1] + ((v - q1[i - 1]) * (z[i] - z[i - 1])) / (q1[i] - q1[i - 1]);
  };
  const scales = GH9_NODES.map((nj) => Math.exp((tau * nj - (tau * tau) / 2) / 2));
  const F = (v: number) => {
    let s = 0;
    for (let j = 0; j < scales.length; j++) s += GH9_WEIGHTS[j] * Phi(zOf(v / scales[j]));
    return s;
  };
  const m = 6 * Math.max(...q1.map(Math.abs));
  return taus.map((t) => {
    let lo = -m;
    let hi = m;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (F(mid) < t) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  });
}

/**
 * Zmienność zrealizowana 60 min przed początkiem slotu `S`: suma kwadratów log-zwrotów zamknięcie do zamknięcia 12 świec
 * 5m o początkach S − 60 min … S − 5 min (każdy zwrot względem zamknięcia świecy poprzedniej, więc potrzebne 13 świec od
 * S − 65 min). Tylko świece zamknięte przed `S` (świeca w toku od S pomijana); brak którejkolwiek albo cena ≤ 0 → null.
 */
export function rv60From5m(bars: readonly { time: number; close: number }[], S: number): number | null {
  const step = 5 * 60_000;
  const byTime = new Map(bars.filter((b) => b.time + step <= S).map((b) => [b.time, b.close]));
  let sum = 0;
  let prev = byTime.get(S - (RV_BARS + 1) * step);
  if (!(prev !== undefined && prev > 0)) return null;
  for (let k = RV_BARS; k >= 1; k--) {
    const c = byTime.get(S - k * step);
    if (!(c !== undefined && c > 0)) return null;
    sum += Math.log(c / prev) ** 2;
    prev = c;
  }
  return sum;
}
