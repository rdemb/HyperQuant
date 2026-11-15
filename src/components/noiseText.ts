import { tr } from '../i18n';
import { fmtFixed } from '../ui';
import type { KyleEstimate, RegimeEstimate, VpinEstimate } from '../types/trading';
import { HURST_NOISE, hurstSide, ouReversionShown } from '../utils/noiseBands';

const pct1 = (x: number) => `${fmtFixed(x * 100, 1)}%`;
const pct0 = (x: number) => fmtFixed(x * 100, 0);

/** VPIN z przedziałem 95% („23,4%”, „95%: 19–27%”) albo „—” z powodem. */
export function vpinParts(v: VpinEstimate | null): { value: string | null; detail: string } {
  if (!v) return { value: null, detail: tr('brak wolumenu w świecach (żaden pełny kubełek)', 'no candle volume (no full bucket)') };
  const ci = Number.isFinite(v.lo) ? `95%: ${pct0(v.lo)}–${pct0(v.hi)}%` : tr(`za mało kubełków na przedział (${v.full})`, `too few buckets for an interval (${v.full})`);
  return { value: pct1(v.value), detail: ci };
}

/** λ Kyle'a z przedziałem albo „nieodróżnialne od zera”, jak pasmo szumu Hursta; „—” z powodem bez przepływu WS. */
export function kyleParts(k: KyleEstimate | null): { value: string | null; detail: string } {
  if (!k) return { value: null, detail: tr('za mało świec z realnym przepływem WS (min. 10)', 'too few candles with real WS flow (min. 10)') };
  if (k.zeroInside)
    return {
      value: tr('≈ 0', '≈ 0'),
      detail: tr(`λ nieodróżnialne od zera (${k.n} świec, przedział 95% obejmuje 0)`, `λ indistinguishable from zero (${k.n} candles, the 95% interval includes 0)`),
    };
  return {
    value: `$${fmtFixed(k.value, 2)}`,
    detail: tr(`na $1M netto przepływu · 95%: $${fmtFixed(k.lo, 2)}–${fmtFixed(k.hi, 2)} (${k.n} świec)`, `per $1M of net flow · 95%: $${fmtFixed(k.lo, 2)}–${fmtFixed(k.hi, 2)} (${k.n} candles)`),
  };
}

/** Reżim BOCPD: P(zmiana w ostatnich 5 świecach) i σ reżimu na świecę albo „—” z powodem. */
export function regimeParts(r: RegimeEstimate | null): { value: string | null; detail: string } {
  if (!r) return { value: null, detail: tr('za mało zamkniętych świec (min. 101 zwrotów)', 'too few closed candles (min. 101 returns)') };
  return {
    value: `${pct0(r.pRecent5)}%`,
    detail: tr(`P(zmiana zmienności w ostatnich 5 świecach) · σ reżimu ${fmtFixed(r.sigma * 100, 3)}% na świecę`, `P(volatility change within the last 5 candles) · regime σ ${fmtFixed(r.sigma * 100, 3)}% per candle`),
  };
}

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
