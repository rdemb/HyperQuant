import type { ScannedPosition } from '../../src/utils/liqMap.ts';

const num = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v)));

/**
 * Pozycja w danym rynku z odpowiedzi `clearinghouseState` (Hyperliquid info API):
 * `assetPositions[].position { coin, szi, entryPx, liquidationPx }`. Brak pozycji, zerowy rozmiar lub zły kształt → null.
 */
export function parseCoinPosition(state: unknown, coin: string, t: number): ScannedPosition | null {
  const list = (state as { assetPositions?: unknown } | null)?.assetPositions;
  if (!Array.isArray(list)) return null;
  for (const ap of list) {
    const p = (ap as { position?: Record<string, unknown> } | null)?.position;
    if (!p || p.coin !== coin) continue;
    const szi = num(p.szi);
    const entryPx = num(p.entryPx);
    if (!Number.isFinite(szi) || szi === 0 || !(entryPx > 0)) return null;
    const liq = p.liquidationPx === null || p.liquidationPx === undefined ? Number.NaN : num(p.liquidationPx);
    return { szi, entryPx, liqPx: liq > 0 ? liq : null, scannedAt: t };
  }
  return null;
}
