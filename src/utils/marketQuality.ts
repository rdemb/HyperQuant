import type { DeskMarket } from '../config/deskMarkets.ts';
import type { MarketCtx } from './marketsTable.ts';
import { type Underlying, platformPriced } from './underlying.ts';

/**
 * Jakość danych rynku na żywo (projekt 60, Q3), z tego samego odczytu `metaAndAssetCtxs` co strona Rynki:
 * - rozjazd ceny mark od wyroczni w punktach bazowych (tylko gdy rynek bazowy notuje; poza sesją wyrocznia stoi);
 * - spread impact: różnica cen impact (kupno − sprzedaż) wobec mid, w pb — koszt wejścia większym zleceniem.
 * Progi wstępne z konfiguracji rynku (kalibracja po 7 dniach nagrań, Q9). Poza sesją rynku bazowego ocena „cena
 * platformy” zamiast oceny rozjazdu. Bez odczytu albo bez cen impact: „—” z powodem, nie zero.
 */
export type QualityLevel = 'good' | 'limited' | 'bad' | 'platform' | 'na';

export interface Quality {
  level: QualityLevel;
  /** Rozjazd mark − wyrocznia (pb, wartość bezwzględna) */
  markOracleBp: number | null;
  /** Spread impact wobec mid (pb) */
  spreadBp: number | null;
  reasons: QualityReason[];
}

export type QualityReason = 'no-ctx' | 'no-impact' | 'mark-oracle' | 'spread' | 'platform';

const bp = (a: number, b: number) => (Math.abs(a - b) / b) * 1e4;

export function marketQuality(m: Pick<DeskMarket, 'quality'>, ctx: MarketCtx | null, u: Underlying): Quality {
  if (!ctx || ctx.markPx === null) return { level: 'na', markOracleBp: null, spreadBp: null, reasons: ['no-ctx'] };
  const mid = ctx.midPx ?? ctx.markPx;
  const spreadBp = ctx.impactPxs ? (Math.abs(ctx.impactPxs[1] - ctx.impactPxs[0]) / mid) * 1e4 : null;
  const markOracleBp = ctx.oraclePx ? bp(ctx.markPx, ctx.oraclePx) : null;
  if (platformPriced(u)) return { level: 'platform', markOracleBp, spreadBp, reasons: ['platform'] };
  const q = m.quality;
  const reasons: QualityReason[] = [];
  let level: QualityLevel = 'good';
  const worse = (l: QualityLevel) => {
    if (l === 'bad' || (l === 'limited' && level === 'good')) level = l;
  };
  if (spreadBp === null) {
    reasons.push('no-impact');
    worse('limited');
  } else if (spreadBp > q.spreadBadBp) {
    reasons.push('spread');
    worse('bad');
  } else if (spreadBp > q.spreadOkBp) {
    reasons.push('spread');
    worse('limited');
  }
  if (markOracleBp !== null && markOracleBp > q.markOracleBadBp) {
    reasons.push('mark-oracle');
    worse('bad');
  } else if (markOracleBp !== null && markOracleBp > q.markOracleOkBp) {
    reasons.push('mark-oracle');
    worse('limited');
  }
  return { level, markOracleBp, spreadBp, reasons };
}
