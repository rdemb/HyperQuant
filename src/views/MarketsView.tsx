import React from 'react';
import { tr } from '../i18n';
import { useMarketsPage } from '../state/useMarketsTable';
import { Badge, SectionHeading } from '../ui';
import { MarketList } from './markets/MarketList';
import { deskLabels, deskPhrase } from '../config/deskMarkets';

/**
 * Widok „Rynki” (`#markets`): rynki aplikacji z konfiguracji (`src/config/deskMarkets.ts`). Liczby LIVE z odpowiedzi Hyperliquid pobranej
 * w przeglądarce, z godziną odczytu; odczyt starszy niż 3 min albo rynek bez odpowiedzi giełdy — „—” z powodem. Opis rynku,
 * bez oceny ruchu. Dane i przeliczenia: `useMarketsPage` (czyste funkcje w `utils/marketsTable`); tu i w `views/markets/`
 * sama prezentacja.
 */

const MarketsView: React.FC = () => {
  const page = useMarketsPage();
  return (
    <div className="flex flex-col gap-4" data-markets-view>
      <SectionHeading
        id="rynki-tytul"
        level={1}
        eyebrow={`Hyperliquid · ${deskLabels()}`}
        title={tr('Rynki', 'Markets')}
        note={tr(
          `${deskPhrase('pl')}: BTC z giełdy głównej Hyperliquid, reszta z giełdy HIP-3 (poza sesją rynku bazowego cenę wyznacza sama platforma). Liczby pobiera Twoja przeglądarka prosto z giełdy co ${page.refreshSec} s, gdy karta jest widoczna.`,
          `${deskPhrase('en')}: BTC from the Hyperliquid main exchange, the rest from a HIP-3 exchange (outside the underlying market hours the platform sets the price). Your browser fetches the numbers straight from the exchange every ${page.refreshSec} s while the tab is visible.`
        )}
        aside={
          <Badge tone="live" title={tr('Realne dane Hyperliquid z godziną odczytu w każdym wierszu', 'Real Hyperliquid data with the reading time in every row')}>
            LIVE
          </Badge>
        }
      />

      <section aria-labelledby="rynki-tytul" className="flex flex-col gap-4">
        <MarketList rows={page.rows} />
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
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
      </section>
    </div>
  );
};

export default MarketsView;
