import type { ChartMarket } from './marketRegistry';

/**
 * Uniwersum rynków Hyperliquid: wszystkie aktywne kontrakty perp z giełdy głównej i wszystkich giełd HIP-3 (nazwa
 * `dex:COIN`), prosto z publicznego API (`perpDexs` i `metaAndAssetCtxs` na giełdę). Czysta logika: bez sieci i zegara.
 * Rynek spoza rejestru skanera dostaje poziom `none` — wykres, taśma i arkusz na żywo z przeglądarki, warstwy skanera
 * z uczciwym „—” i powodem (`noScannerWhy`).
 */

export interface UniverseMarket {
  coin: string;
  /** `""` = giełda główna, inaczej nazwa giełdy HIP-3 */
  dex: string;
  szDecimals: number;
  maxLeverage: number;
  markPx: number;
  /** Otwarte pozycje w USD (kontrakty × cena mark) */
  oiUsd: number;
  volume24hUsd: number;
  /** Stawka finansowania na godzinę (ułamek); null, gdy giełda jej nie podała */
  funding: number | null;
  /** Cena oracle (źródło ceny wystawcy rynku HIP-3, na giełdzie głównej mediana giełd spot); null, gdy jej nie podano */
  oraclePx: number | null;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const num = (x: unknown): number => (typeof x === 'string' || typeof x === 'number' ? Number(x) : Number.NaN);

/** Odpowiedź `perpDexs`: giełda główna (`""`, w API `null` na pierwszym miejscu) i nazwy giełd HIP-3. */
export function parsePerpDexs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [''];
  const names = raw.filter(isRecord).map((d) => d.name).filter((n): n is string => typeof n === 'string' && /^[A-Za-z0-9]{1,20}$/.test(n));
  return ['', ...new Set(names)];
}

/**
 * Aktywne rynki jednej giełdy z `metaAndAssetCtxs` (universe[i] ↔ ctxs[i]): bez wycofanych (`isDelisted`), bez ceny
 * mark i z nazwą spoza giełdy (HIP-3 zawsze `dex:COIN`). Zła odpowiedź — pusta lista.
 */
export function universeOf(dex: string, metaCtxs: unknown): UniverseMarket[] {
  if (!Array.isArray(metaCtxs) || metaCtxs.length < 2) return [];
  const [meta, ctxs] = metaCtxs;
  if (!isRecord(meta) || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return [];
  const out: UniverseMarket[] = [];
  for (let i = 0; i < Math.min(meta.universe.length, ctxs.length); i++) {
    const u = meta.universe[i];
    const c = ctxs[i];
    if (!isRecord(u) || !isRecord(c) || typeof u.name !== 'string' || u.isDelisted === true) continue;
    if ((dex === '') === u.name.includes(':') || (dex !== '' && !u.name.startsWith(`${dex}:`))) continue;
    const markPx = num(c.markPx);
    const szDecimals = num(u.szDecimals);
    const maxLeverage = num(u.maxLeverage);
    if (!(markPx > 0) || !Number.isInteger(szDecimals) || !(maxLeverage > 0)) continue;
    const oi = num(c.openInterest);
    const vol = num(c.dayNtlVlm);
    const funding = num(c.funding);
    const oraclePx = num(c.oraclePx);
    out.push({
      coin: u.name,
      dex,
      szDecimals,
      maxLeverage,
      markPx,
      oiUsd: oi >= 0 ? oi * markPx : 0,
      volume24hUsd: vol >= 0 ? vol : 0,
      funding: Number.isFinite(funding) ? funding : null,
      oraclePx: oraclePx > 0 ? oraclePx : null,
    });
  }
  return out;
}

/** Rynki uniwersum do listy wykresu: poziom `none`, skala progów z bieżących otwartych pozycji (zamiast średniej z 7 dni). */
export function chartMarketsOf(list: readonly UniverseMarket[]): ChartMarket[] {
  return [...list]
    .sort((a, b) => b.oiUsd - a.oiUsd)
    .map((m) => ({ coin: m.coin, dex: m.dex, szDecimals: m.szDecimals, maxLeverage: m.maxLeverage, scanner: 'none' as const, oiUsd7d: m.oiUsd }));
}

/** Lista strony z uniwersum: najpierw lista rejestru (zna poziom skanera i klasę rynku), potem pozostałe rynki uniwersum. */
export function withUniverse(list: readonly ChartMarket[], universe: readonly ChartMarket[]): readonly ChartMarket[] {
  if (universe.length === 0) return list;
  const known = new Set(list.map((m) => m.coin));
  const extra = universe.filter((m) => !known.has(m.coin));
  return extra.length === 0 ? list : [...list, ...extra];
}
