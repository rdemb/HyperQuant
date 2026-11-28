import React from 'react';
import { tr } from '../../i18n';
import type { CrossVenueModel } from '../../state/useMarketsTable';
import type { VenueSort } from '../../utils/crossVenue';
import { Segmented } from '../../ui';

/**
 * Zakładka „Ten sam instrument u kilku wystawców” strony Rynki: instrument notowany przez kilka giełd HIP-3 (albo HIP-3
 * i giełdę główną) z ceną mark, premią wobec średniej, finansowaniem rocznym i otwartymi pozycjami u każdego wystawcy oraz
 * rozjazdem ceny mark, oracle i finansowania. Sama prezentacja: dane, sortowanie i filtr z `useMarketsPage` (`venues`).
 */
const Stack: React.FC<{ items: string[]; className?: string }> = ({ items, className = '' }) => (
  <div className={`flex flex-col gap-0.5 ${className}`}>
    {items.map((x, i) => (
      <span key={i}>{x}</span>
    ))}
  </div>
);

export const CrossVenue: React.FC<{ venues: CrossVenueModel }> = ({ venues }) => (
  <div className="flex flex-col gap-3" data-cross-venue={venues.status}>
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={venues.query}
        onChange={(e) => venues.setQuery(e.target.value)}
        aria-label={tr('Szukaj instrumentu', 'Search instruments')}
        placeholder={tr('Szukaj: NVDA, io, para…', 'Search: NVDA, io, para…')}
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-56 px-2.5 rounded-lg border border-line bg-surface-1 text-xs text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <Segmented<VenueSort>
        ariaLabel={tr('Sortowanie', 'Sort')}
        size="xs"
        value={venues.sort}
        onChange={venues.setSort}
        options={[
          { value: 'oi', label: tr('Otwarte pozycje', 'Open interest') },
          { value: 'spread', label: tr('Rozjazd ceny', 'Price gap') },
          { value: 'funding', label: tr('Różnica fundingu', 'Funding gap') },
        ]}
      />
      <span className="text-[11px] text-ink-3 tabular-nums">
        {venues.status === 'loading' && venues.total === 0
          ? tr('Wczytuję rynki wszystkich giełd Hyperliquid…', 'Loading the markets of every Hyperliquid exchange…')
          : venues.status === 'error' && venues.total === 0
            ? tr('Hyperliquid nie odpowiada — spróbuj za minutę', 'Hyperliquid is not answering — try again in a minute')
            : tr(`${venues.rows.length} instrumentów u kilku wystawców · odczyt ${venues.readAt}`, `${venues.rows.length} instruments on several venues · read ${venues.readAt}`)}
      </span>
    </div>
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[760px] text-xs tabular-nums">
        <thead className="bg-surface-1 text-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{tr('Instrument', 'Instrument')}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{tr('Wystawca', 'Venue')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Cena mark', 'Mark price')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title={tr('Cena mark wystawcy wobec średniej wszystkich wystawców, w punktach bazowych', "The venue's mark price against the average of all venues, in basis points")}>
              {tr('Wobec średniej', 'Vs average')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title={tr('Stawka godzinowa × 24 × 365; plus: długie pozycje płacą krótkim', 'Hourly rate × 24 × 365; plus: longs pay shorts')}>
              {tr('Funding rocznie', 'Funding (annual)')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Otwarte pozycje', 'Open interest')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title={tr('(najwyższa − najniższa cena mark) / średnia, w punktach bazowych', '(highest − lowest mark price) / average, in basis points')}>
              {tr('Rozjazd ceny', 'Price gap')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title={tr('Ten sam rozjazd dla cen oracle, czyli źródeł ceny wystawców; „—”, gdy oracle podał mniej niż dwóch', "The same gap for the oracle prices, i.e. the venues' price sources; “—” when fewer than two report one")}>
              {tr('Rozjazd oracle', 'Oracle gap')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title={tr('Najwyższy minus najniższy funding roczny, w punktach procentowych', 'Highest minus lowest annual funding, in percentage points')}>
              {tr('Różnica fundingu', 'Funding gap')}
            </th>
          </tr>
        </thead>
        <tbody>
          {venues.rows.map((r) => (
            <tr key={r.name} className="border-t border-line align-top hover:bg-surface-1">
              <td className="px-3 py-1.5 font-medium text-ink-1">
                {r.name}
                <div className="text-[11px] font-normal text-ink-3">{tr(`razem ${r.oi}`, `total ${r.oi}`)}</div>
              </td>
              <td className="px-3 py-1.5">
                <div className="flex flex-col gap-0.5">
                  {r.venues.map((v) => (
                    <a key={v.coin} href={`#charts?m=${v.coin}`} className="text-ink-2 hover:underline focus-visible:underline" title={tr(`Wykres ${v.coin}`, `${v.coin} chart`)}>
                      {v.venue}
                    </a>
                  ))}
                </div>
              </td>
              <td className="px-3 py-1.5 text-right text-ink-1">
                <Stack items={r.venues.map((v) => v.price)} />
              </td>
              <td className="px-3 py-1.5 text-right text-ink-2">
                <Stack items={r.venues.map((v) => v.premium)} />
              </td>
              <td className="px-3 py-1.5 text-right text-ink-2">
                <Stack items={r.venues.map((v) => v.funding)} />
              </td>
              <td className="px-3 py-1.5 text-right text-ink-2">
                <Stack items={r.venues.map((v) => v.oi)} />
              </td>
              <td className="px-3 py-1.5 text-right font-medium text-ink-1">{r.spread}</td>
              <td className="px-3 py-1.5 text-right text-ink-2">{r.oracleSpread}</td>
              <td className="px-3 py-1.5 text-right font-medium text-ink-1">{r.fundingGap}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-[11px] leading-relaxed text-ink-3">
      {tr(
        'Na Hyperliquid ten sam instrument (akcje, indeksy, surowce) może notować kilku wystawców giełd HIP-3, każdy z własnym źródłem ceny, finansowaniem i płynnością. Tabela zestawia ich liczby obok siebie. Do instrumentu wchodzą rynki o tej samej nazwie z ceną mark najwyżej 5% od ceny rynku z największymi otwartymi pozycjami: inna cena przy tej samej nazwie oznacza inny instrument. Źródło: Hyperliquid (perpDexs i metaAndAssetCtxs każdej giełdy), zapytania z Twojej przeglądarki co 60 s, gdy karta jest widoczna. Opis rynku, nie rekomendacja: różnica ceny i finansowania nie uwzględnia opłat, poślizgu ani ryzyka wystawcy.',
        'On Hyperliquid the same instrument (stocks, indices, commodities) can be listed by several HIP-3 deployers, each with its own price source, funding and liquidity. The table puts their numbers side by side. A market joins an instrument when it has the same name and a mark price within 5% of the market with the largest open interest: a different price under the same name means a different instrument. Source: Hyperliquid (perpDexs and metaAndAssetCtxs of every exchange), requested by your browser every 60 s while the tab is visible. A description of the market, not a recommendation: the price and funding gaps leave out fees, slippage and deployer risk.'
      )}
    </p>
  </div>
);
