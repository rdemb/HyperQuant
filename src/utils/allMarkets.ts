import type { UniverseMarket } from './hlUniverse';
import { bareName, fmtMarketPrice, fundingYearPct } from './marketsTable';
import { DASH, fmtCompact } from '../ui/format';
import { doSzukania } from './searchText';

/**
 * Przegląd wszystkich rynków Hyperliquid (strona Rynki, zakładka „Wszystkie rynki”): wiersze z uniwersum (`hlUniverse`)
 * z gotowymi tekstami, filtr po nazwie i giełdzie, sortowanie. Opis rynku bez oceny ruchu — bez zmiany ceny (jak karty
 * pulpitu). Czysta logika: bez sieci i zegara.
 */

export type AllSort = 'oi' | 'volume' | 'funding';

export interface AllMarketRow {
  coin: string;
  name: string;
  /** Giełda: `Hyperliquid` (główna) albo nazwa giełdy HIP-3 */
  venue: string;
  price: string;
  oi: string;
  volume: string;
  /** Finansowanie roczne (stawka godzinowa × 24 × 365), z kierunkiem: kto płaci */
  funding: string;
  fundingSign: -1 | 0 | 1;
  leverage: string;
}

const sortValue = (m: UniverseMarket, sort: AllSort): number =>
  sort === 'oi' ? m.oiUsd : sort === 'volume' ? m.volume24hUsd : Math.abs(m.funding ?? 0);

/**
 * Wiersze: rynki pasujące do `query` (każde słowo w nazwie rynku albo giełdy, bez wielkości liter i znaków diakrytycznych),
 * malejąco według otwartych pozycji, wolumenu 24 h albo wartości bezwzględnej finansowania (najbardziej skrajne na górze).
 */
export function allMarketRows(list: readonly UniverseMarket[], sort: AllSort, query: string): AllMarketRow[] {
  const words = doSzukania(query).split(/\s+/).filter(Boolean);
  return list
    .filter((m) => {
      const text = doSzukania(`${m.coin} ${m.dex || 'hyperliquid'}`);
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || a.coin.localeCompare(b.coin))
    .map((m) => {
      const apr = fundingYearPct(m.funding);
      return {
        coin: m.coin,
        name: bareName(m),
        venue: m.dex === '' ? 'Hyperliquid' : m.dex,
        price: fmtMarketPrice(m.markPx, m.szDecimals),
        oi: fmtCompact(m.oiUsd, '$'),
        volume: fmtCompact(m.volume24hUsd, '$'),
        funding: apr === null ? DASH : `${apr > 0 ? '+' : apr < 0 ? '−' : ''}${Math.abs(apr).toFixed(1)}%`,
        fundingSign: apr === null || apr === 0 ? 0 : apr > 0 ? 1 : -1,
        leverage: `${m.maxLeverage}×`,
      };
    });
}
