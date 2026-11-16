/**
 * Próg wartości zlecenia na taśmie w skali rynku. Ustawienie (`tapeMinUsd`) jest w skali BTC i mnożone przez skalę USD
 * rynku (`usdScaleOf`: udział jego open interest wobec BTC), tak jak progi ścian i dużych graczy. Bez tego na złocie
 * „od 10 tys.” ukrywało prawie całą taśmę (typowe zlecenie złota to kilka tysięcy USD).
 */
export const TAPE_MIN_OPTIONS = [0, 10_000, 50_000, 100_000, 250_000, 1_000_000];

export function tapeMinUsdOf(setting: number, scale: number): number {
  const k = Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 1;
  return setting * k;
}
