/** Kwantyl 0,975 rozkładu t-Studenta z `df` stopniami swobody (rozwinięcie Cornisha–Fishera; przy df ≥ 8 błąd < 0,002). */
export function t975(df: number): number {
  const z = 1.959963985;
  const z3 = z ** 3;
  const z5 = z ** 5;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
}
