import type { UniverseMarket } from './hlUniverse';
import { bareName, fmtMarketPrice, fundingYearPct } from './marketsTable';
import { DASH, fmtCompact } from '../ui/format';
import { doSzukania } from './searchText';
import { tr } from '../i18n';

/**
 * Ten sam instrument u kilku wystawców (strona Rynki, zakładka „Ten sam instrument”): rynki giełd HIP-3 (i giełdy głównej)
 * o tej samej nazwie i zgodnej cenie, z rozjazdem ceny mark i oracle oraz różnicą finansowania między nimi. Opis rynku,
 * bez oceny: liczby pokazują, gdzie ten sam instrument jest wyceniany i finansowany inaczej. Czysta logika: bez sieci i zegara.
 */

/**
 * Ta sama nazwa nie znaczy ten sam instrument (STX na giełdzie głównej to Stacks, na giełdzie HIP-3 akcje Seagate; ANTH
 * u dwóch wystawców różni się ceną 17 razy): do grupy wchodzi rynek z ceną mark najwyżej 5% od ceny rynku z największymi
 * otwartymi pozycjami.
 */
export const SAME_PRICE_TOL = 0.05;

export type VenueSort = 'oi' | 'spread' | 'funding';

export interface VenueCell {
  coin: string;
  /** Wystawca: `Hyperliquid` (giełda główna) albo nazwa giełdy HIP-3 */
  venue: string;
  price: string;
  /** Odchylenie ceny mark od średniej grupy, pb, ze znakiem */
  premium: string;
  /** Finansowanie roczne z kierunkiem (plus: długie pozycje płacą krótkim) */
  funding: string;
  oi: string;
}

export interface CrossVenueRow {
  /** Nazwa instrumentu (bez prefiksu giełdy) */
  name: string;
  venues: VenueCell[];
  /** Rozjazd ceny mark: (najwyższa − najniższa) / średnia, pb */
  spread: string;
  /** Rozjazd ceny oracle wystawców (to samo pytanie o źródło ceny), pb; „—”, gdy oracle podał mniej niż dwóch */
  oracleSpread: string;
  /** Różnica finansowania rocznego między wystawcami, punkty procentowe; „—”, gdy finansowanie podał mniej niż dwóch */
  fundingGap: string;
  /** Otwarte pozycje wszystkich wystawców razem */
  oi: string;
}

interface Group {
  name: string;
  members: UniverseMarket[];
  oiUsd: number;
  spreadBp: number;
  fundingGapPp: number | null;
}

const bpOf = (xs: readonly number[]): number | null => {
  if (xs.length < 2) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return ((Math.max(...xs) - Math.min(...xs)) / mean) * 1e4;
};
const fmtBp = (bp: number | null): string => (bp === null ? DASH : `${bp.toFixed(1)} ${tr('pb', 'bp')}`);
const signed = (x: number, digits: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(digits)}`;

/** Grupy instrumentów u co najmniej dwóch wystawców (w tym co najmniej jeden HIP-3), ze zgodną ceną. */
function groupsOf(list: readonly UniverseMarket[]): Group[] {
  const byName = new Map<string, UniverseMarket[]>();
  for (const m of list) {
    if (!(m.markPx > 0)) continue;
    const n = bareName(m);
    (byName.get(n) ?? byName.set(n, []).get(n)!).push(m);
  }
  const out: Group[] = [];
  for (const [name, all] of byName) {
    if (all.length < 2) continue;
    const anchor = all.reduce((a, b) => (b.oiUsd > a.oiUsd ? b : a));
    const members = all.filter((m) => Math.abs(m.markPx / anchor.markPx - 1) <= SAME_PRICE_TOL);
    if (members.length < 2 || members.every((m) => m.dex === '')) continue;
    const aprs = members.map((m) => fundingYearPct(m.funding)).filter((x): x is number => x !== null);
    out.push({
      name,
      members: [...members].sort((a, b) => b.oiUsd - a.oiUsd || a.coin.localeCompare(b.coin)),
      oiUsd: members.reduce((s, m) => s + m.oiUsd, 0),
      spreadBp: bpOf(members.map((m) => m.markPx))!,
      fundingGapPp: aprs.length >= 2 ? Math.max(...aprs) - Math.min(...aprs) : null,
    });
  }
  return out;
}

const sortValue = (g: Group, sort: VenueSort): number => (sort === 'oi' ? g.oiUsd : sort === 'spread' ? g.spreadBp : (g.fundingGapPp ?? -1));

/**
 * Wiersze: instrumenty pasujące do `query` (każde słowo w nazwie instrumentu albo wystawcy), malejąco według otwartych
 * pozycji razem, rozjazdu ceny albo różnicy finansowania.
 */
export function crossVenueRows(list: readonly UniverseMarket[], sort: VenueSort, query: string): CrossVenueRow[] {
  const words = doSzukania(query).split(/\s+/).filter(Boolean);
  return groupsOf(list)
    .filter((g) => {
      const text = doSzukania(`${g.name} ${g.members.map((m) => m.dex || 'hyperliquid').join(' ')}`);
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || a.name.localeCompare(b.name))
    .map((g) => {
      const mean = g.members.reduce((s, m) => s + m.markPx, 0) / g.members.length;
      const oracles = g.members.map((m) => m.oraclePx).filter((x): x is number => x !== null);
      return {
        name: g.name,
        venues: g.members.map((m) => {
          const apr = fundingYearPct(m.funding);
          return {
            coin: m.coin,
            venue: m.dex === '' ? 'Hyperliquid' : m.dex,
            price: fmtMarketPrice(m.markPx, m.szDecimals),
            premium: `${signed((m.markPx / mean - 1) * 1e4, 1)} ${tr('pb', 'bp')}`,
            funding: apr === null ? DASH : `${signed(apr, 1)}%`,
            oi: fmtCompact(m.oiUsd, '$'),
          };
        }),
        spread: fmtBp(g.spreadBp),
        oracleSpread: fmtBp(bpOf(oracles)),
        fundingGap: g.fundingGapPp === null ? DASH : `${g.fundingGapPp.toFixed(1)} pp`,
        oi: fmtCompact(g.oiUsd, '$'),
      };
    });
}
