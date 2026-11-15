import { tr } from '../i18n';
import { fmtFixed } from '../ui';
import { HURST_NOISE, hurstSide, ouReversionShown } from '../utils/noiseBands';

/** t½ powrotu OU albo uczciwy brak: krótkie okno daje θ > 0 w 2/3 przypadków czystego błądzenia. */
export function ouHalfLifeText(theta: number, halfLifeBars: number): string {
  return ouReversionShown(theta) && Number.isFinite(halfLifeBars)
    ? `t½ ${fmtFixed(halfLifeBars, 1)} ${tr('świec', 'candles')}`
    : tr('bez dowodu powrotu (jak błądzenie losowe)', 'no evidence of reversion (like a random walk)');
}

/** Odczyt Hursta względem pasma 90% czystego szumu przy tej samej liczbie zwrotów. */
export function hurstReadText(h: number): string {
  const side = hurstSide(h);
  return side === 'anti'
    ? tr('poniżej pasma szumu: antypersystencja (powroty)', 'below the noise band: anti-persistence (reversals)')
    : side === 'persist'
      ? tr('powyżej pasma szumu: persystencja (trend)', 'above the noise band: persistence (trend)')
      : tr(
          `w zakresie szumu (90% wartości czystego szumu: ${fmtFixed(HURST_NOISE.p5, 2)}–${fmtFixed(HURST_NOISE.p95, 2)})`,
          `within the noise range (90% of pure-noise values: ${fmtFixed(HURST_NOISE.p5, 2)}–${fmtFixed(HURST_NOISE.p95, 2)})`
        );
}
