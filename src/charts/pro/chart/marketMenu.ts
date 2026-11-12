import { tr } from '../../../i18n';
import { HOME_MARKET } from '../../../utils/marketCaps';
import type { ChartMarket } from '../../../utils/marketRegistry';

/**
 * Wybór rynku wykresu: rynki rejestru w dwóch grupach — krypto (giełda główna Hyperliquid) oraz akcje, indeksy i surowce
 * (giełdy HIP-3, nazwa `dex:COIN`) — w kolejności rejestru, czyli według średnich otwartych pozycji z 7 dni.
 */

export type MarketGroupId = 'crypto' | 'hip3';

export interface MarketGroup {
  id: MarketGroupId;
  title: string;
  markets: ChartMarket[];
}

const GROUP_TITLE: Record<MarketGroupId, string> = {
  crypto: tr('Krypto', 'Crypto'),
  // Giełdy HIP-3: akcje, indeksy, surowce i waluty (xyz:JPY, xyz:EUR)
  hip3: tr('Rynki tradycyjne (HIP-3)', 'Traditional markets (HIP-3)'),
};

/** Grupy z rynkami pasującymi do `query` (fragment nazwy albo giełdy, bez wielkości liter); puste grupy pominięte. */
export function marketGroups(markets: readonly ChartMarket[], query: string): MarketGroup[] {
  const q = query.trim().toLowerCase();
  const out: MarketGroup[] = [];
  for (const id of ['crypto', 'hip3'] as const) {
    const list = markets.filter((m) => (m.dex === '') === (id === 'crypto') && (q === '' || m.coin.toLowerCase().includes(q)));
    if (list.length > 0) out.push({ id, title: GROUP_TITLE[id], markets: list });
  }
  return out;
}

/** Klawisz M: następny rynek listy (po ostatnim pierwszy); rynek spoza listy — pierwszy. */
export function nextMarket(markets: readonly ChartMarket[], coin: string): string {
  if (markets.length === 0) return HOME_MARKET;
  const i = markets.findIndex((m) => m.coin === coin);
  return markets[(i + 1) % markets.length].coin;
}

/** Podpowiedź pozycji listy. */
export function marketTitle(m: ChartMarket): string {
  if (m.dex === '') return `${m.coin}-PERP · Hyperliquid`;
  const name = m.coin.slice(m.dex.length + 1);
  return tr(`${name}-PERP · Hyperliquid HIP-3, giełda ${m.dex}`, `${name}-PERP · Hyperliquid HIP-3, exchange ${m.dex}`);
}

export const isListed = (coin: string, markets: readonly ChartMarket[]): boolean => markets.some((m) => m.coin === coin);

/** Rynek z linku albo zapisu, którego nie ma już w rejestrze: wykres otwiera BTC z tym zdaniem. */
export function expiredNotice(coin: string): string {
  return tr(
    `Rynku ${coin} nie ma już na liście rynków HyperQuant (rejestr według otwartych pozycji), więc wykres pokazuje ${HOME_MARKET}.`,
    `${coin} is no longer on the HyperQuant market list (a registry by open interest), so the chart shows ${HOME_MARKET}.`
  );
}
