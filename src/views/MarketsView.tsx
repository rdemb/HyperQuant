import React from 'react';
import { tr } from '../i18n';
import { useMarketsPage } from '../state/useMarketsTable';
import { Badge, Panel, Segmented } from '../ui';
import type { SortKey } from '../utils/marketsTable';
import { MarketsTable } from './markets/MarketsTable';

/**
 * Widok „Rynki” (`#markets`): tabela rynków z rejestru w grupach jak wybór rynku wykresu (krypto oraz rynki HIP-3),
 * domyślnie według otwartych pozycji. Liczby LIVE z odpowiedzi Hyperliquid pobranej w przeglądarce, z godziną odczytu;
 * odczyt starszy niż 3 min albo rynek bez odpowiedzi giełdy — „—” z powodem. Opis rynku, bez oceny ruchu ceny.
 * Dane i przeliczenia: `useMarketsPage` (czyste funkcje w `utils/marketsTable`); tu i w `views/markets/` sama prezentacja.
 */

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'oi', label: tr('Otwarte pozycje', 'Open interest') },
  { value: 'volume', label: tr('Obrót 24 h', '24h volume') },
];

const MarketsView: React.FC = () => {
  const page = useMarketsPage();
  return (
    <div className="flex flex-col gap-4" data-markets-view>
      <Panel
        hero
        eyebrow={tr('Rejestr rynków HyperQuant', 'HyperQuant market registry')}
        title={tr('Rynki', 'Markets')}
        actions={<Segmented<SortKey> ariaLabel={tr('Sortowanie', 'Sort by')} size="xs" value={page.sort} onChange={page.setSort} options={SORTS} />}
      >
        <p className="px-4 pt-3 text-xs leading-relaxed text-ink-2 max-w-prose">
          {tr(
            `Rynki Hyperliquid z rejestru HyperQuant: do 20 największych według średnich otwartych pozycji z 7 dni, BTC, ETH, SOL i HYPE na stałe (dziś: ${page.marketCount}). Liczby pobiera Twoja przeglądarka prosto z giełdy co minutę, gdy karta jest widoczna.`,
            `Hyperliquid markets from the HyperQuant registry: up to the 20 largest by 7-day average open interest, with BTC, ETH, SOL and HYPE always included (today: ${page.marketCount}). Your browser fetches the numbers straight from the exchange every minute while the tab is visible.`
          )}{' '}
          <Badge tone="live" title={tr('Realne dane Hyperliquid z godziną odczytu w każdym wierszu', 'Real Hyperliquid data with the reading time in every row')}>
            LIVE
          </Badge>
        </p>
        <div className="mt-3">
          <MarketsTable groups={page.groups} sort={page.sort} />
        </div>
        <div className="px-4 py-3 mt-1 border-t border-line text-[11px] leading-relaxed text-ink-3 flex flex-col gap-1">
          <p>
            {tr(
              `Źródło: Hyperliquid (metaAndAssetCtxs), jedno zapytanie na giełdę co ${page.refreshSec} s z Twojej przeglądarki; serwer HyperQuant nic nie pobiera. Otwarte pozycje = liczba kontraktów × cena mark. Funding roczny przeliczony ze stawki godzinowej (× 24 × 365). Odczyt starszy niż 3 min albo rynek bez odpowiedzi giełdy: „—” z powodem.`,
              `Source: Hyperliquid (metaAndAssetCtxs), one request per exchange every ${page.refreshSec} s from your browser; the HyperQuant server fetches nothing. Open interest = contracts × mark price. Annual funding is annualised from the hourly rate (× 24 × 365). A reading older than 3 min or a market missing from the exchange response: “—” with the reason.`
            )}
          </p>
          <p data-markets-weight={page.weight}>
            {tr(
              `Waga zapytań tej strony w ostatniej minucie: ${page.weight} z ${page.weightLimit} (limit Hyperliquid na adres IP).`,
              `Request weight of this page in the last minute: ${page.weight} of ${page.weightLimit} (the Hyperliquid limit per IP address).`
            )}
          </p>
        </div>
      </Panel>
    </div>
  );
};

export default MarketsView;
