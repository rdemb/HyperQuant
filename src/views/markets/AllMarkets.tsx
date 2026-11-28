import React from 'react';
import { tr } from '../../i18n';
import type { AllMarketsModel } from '../../state/useMarketsTable';
import type { AllSort } from '../../utils/allMarkets';
import { Segmented } from '../../ui';

/**
 * Zakładka „Wszystkie rynki Hyperliquid” strony Rynki: każdy aktywny kontrakt perp (giełda główna i giełdy HIP-3) z ceną
 * mark, otwartymi pozycjami, wolumenem 24 h, finansowaniem rocznym i maksymalną dźwignią, z godziną odczytu. Nazwa
 * rynku otwiera jego wykres. Sama prezentacja: dane, sortowanie i filtr z `useMarketsPage` (`all`).
 */
export const AllMarkets: React.FC<{ all: AllMarketsModel }> = ({ all }) => (
  <div className="flex flex-col gap-3" data-all-markets={all.status}>
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={all.query}
        onChange={(e) => all.setQuery(e.target.value)}
        aria-label={tr('Szukaj rynku', 'Search markets')}
        placeholder={tr('Szukaj: NVDA, xyz, PEPE…', 'Search: NVDA, xyz, PEPE…')}
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-56 px-2.5 rounded-lg border border-line bg-surface-1 text-xs text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <Segmented<AllSort>
        ariaLabel={tr('Sortowanie', 'Sort')}
        size="xs"
        value={all.sort}
        onChange={all.setSort}
        options={[
          { value: 'oi', label: tr('Otwarte pozycje', 'Open interest') },
          { value: 'volume', label: tr('Wolumen 24 h', '24 h volume') },
          { value: 'funding', label: 'Funding', title: tr('Najbardziej skrajne finansowanie na górze (wartość bezwzględna)', 'Most extreme funding on top (absolute value)') },
        ]}
      />
      <span className="text-[11px] text-ink-3 tabular-nums">
        {all.status === 'loading' && all.total === 0
          ? tr('Wczytuję wszystkie rynki Hyperliquid…', 'Loading all Hyperliquid markets…')
          : all.status === 'error' && all.total === 0
            ? tr('Hyperliquid nie odpowiada — spróbuj za minutę', 'Hyperliquid is not answering — try again in a minute')
            : tr(`${all.rows.length} z ${all.total} rynków · odczyt ${all.readAt}`, `${all.rows.length} of ${all.total} markets · read ${all.readAt}`)}
      </span>
    </div>
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] text-xs tabular-nums">
        <thead className="bg-surface-1 text-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{tr('Rynek', 'Market')}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{tr('Giełda', 'Exchange')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Cena mark', 'Mark price')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Otwarte pozycje', 'Open interest')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Wolumen 24 h', '24 h volume')}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title={tr('Stawka godzinowa × 24 × 365; plus: długie pozycje płacą krótkim', 'Hourly rate × 24 × 365; plus: longs pay shorts')}>
              {tr('Funding rocznie', 'Funding (annual)')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Dźwignia', 'Leverage')}</th>
          </tr>
        </thead>
        <tbody>
          {all.rows.map((r) => (
            <tr key={r.coin} className="border-t border-line hover:bg-surface-1">
              <td className="px-3 py-1.5">
                <a href={`#charts?m=${r.coin}`} className="font-medium text-ink-1 hover:underline focus-visible:underline" title={tr(`Wykres ${r.coin}`, `${r.coin} chart`)}>
                  {r.name}
                </a>
              </td>
              <td className="px-3 py-1.5 text-ink-3">{r.venue}</td>
              <td className="px-3 py-1.5 text-right text-ink-1">{r.price}</td>
              <td className="px-3 py-1.5 text-right text-ink-2">{r.oi}</td>
              <td className="px-3 py-1.5 text-right text-ink-2">{r.volume}</td>
              <td className="px-3 py-1.5 text-right text-ink-2">{r.funding}</td>
              <td className="px-3 py-1.5 text-right text-ink-3">{r.leverage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-[11px] leading-relaxed text-ink-3">
      {tr(
        'Źródło: Hyperliquid (perpDexs i metaAndAssetCtxs każdej giełdy), zapytania z Twojej przeglądarki co 60 s, gdy karta jest widoczna. Rynki spoza głównych mają na wykresie dane na żywo (świece, taśma, arkusz, footprint od otwarcia strony); warstwy skanera (mapa likwidacji, kohorty, historia 24 h) — „—” z powodem.',
        'Source: Hyperliquid (perpDexs and metaAndAssetCtxs of every exchange), requested by your browser every 60 s while the tab is visible. Markets outside the core ones get live data on the chart (candles, tape, book, footprint from page open); scanner layers (liquidation map, cohorts, 24 h history) show “—” with the reason.'
      )}
    </p>
  </div>
);
