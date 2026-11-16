import type { IndicatorBar } from './indicators';
import { type LvnLevel, areaBins, blockFor, lvnLevels, minUnits, profileOf, unitCount, unitsBuilder, valueArea } from './lvn';

/**
 * LVN po testach profilu sesji albo doby (warstwa „Profile okresów”, projekt Pioniera F-B1, runda 2). Siatka stała,
 * niezależna od powiększenia wykresu: koszyki 5 bp w log-cenie od najniższej ceny okresu. Świeca w całości nagrana
 * wnosi wiersze taśmy (footprint), inna — wolumen rozłożony równo na swój zakres. Tylko świece zamknięte; okres
 * w toku to „profil w budowie”.
 */

/** Koszyk profilu okresu w punktach bazowych (jak profil doby P/b). */
export const PERIOD_LVN_BP = 5;
const VA_SHARE = 0.7;

export interface PeriodLvn {
  /** LVN i LVA po testach, malejąco po trwałości; null — za mało świec do testu (`have` z `need`). */
  lvn: LvnLevel[] | null;
  have: number;
  need: number;
  /** Okres w toku: profil w budowie, pokazujemy tylko LVN od progu. */
  building: boolean;
}

/**
 * LVN okresu ze świec `bars[from..to]` (zamkniętych, interwał `ms`): profil na koszykach 5 bp, obszar wartości 70%,
 * LVN regułą `lvnNodes` (dolina szersza niż max(5 koszyków, 0,25 średniego zakresu świecy) to LVA), filtr położenia
 * z kołowego bootstrapu blokami ok. 15 min i p wobec szumu pomiaru. null — okres bez wolumenu.
 */
export function periodLvn(bars: readonly IndicatorBar[], from: number, to: number, ms: number, building: boolean): PeriodLvn | null {
  if (to < from) return null;
  let min = Infinity;
  let max = -Infinity;
  let range = 0;
  for (let i = from; i <= to; i++) {
    const c = bars[i].candle;
    min = Math.min(min, c.l);
    max = Math.max(max, c.h);
    range += c.h - c.l;
  }
  if (!(min > 0) || !(max >= min)) return null;
  const base = Math.log(min);
  const step = PERIOD_LVN_BP / 1e4;
  const bin = (p: number) => Math.max(0, Math.floor((Math.log(p) - base) / step));
  const nb = bin(max) + 2;
  const ub = unitsBuilder(nb);
  for (let i = from; i <= to; i++) {
    const { candle: c, fp, complete } = bars[i];
    if (fp && complete) {
      for (let r = 0; r < fp.buy.length; r++) {
        const v = fp.buy[r] + fp.sell[r];
        if (v > 0) ub.add(Math.min(nb - 1, bin((fp.lo + r) * fp.tick)), v);
      }
    } else if (c.v > 0) {
      const k0 = bin(c.l);
      const k1 = Math.min(nb - 1, bin(c.h));
      for (let k = k0; k <= k1; k++) ub.add(k, c.v / (k1 - k0 + 1));
    }
    ub.next();
  }
  const units = ub.done();
  const prof = profileOf(units);
  const va = valueArea(prof, VA_SHARE);
  if (!(va.total > 0)) return null;
  const edge = (k: number) => Math.exp(base + step * k);
  const mid = (k: number) => Math.sqrt(edge(k) * edge(k + 1));
  const n = unitCount(units);
  const minArea = areaBins(range / n, mid(va.poc) * (Math.exp(step) - 1));
  const lvn = lvnLevels(units, prof, va, VA_SHARE, { mid, edge }, minArea, ms);
  return { lvn, have: n, need: minUnits(blockFor(ms)), building };
}
