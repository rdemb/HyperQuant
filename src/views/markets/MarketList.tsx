import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { tr } from '../../i18n';
import { Badge } from '../../ui';
import type { MarketRowModel } from '../../utils/marketsTable';
import type { MarketClass } from '../../utils/marketRegistry';
import { DESK_MARKETS, deskLabels } from '../../config/deskMarkets';

/**
 * Rynki aplikacji (z konfiguracji rynków desku) jako karty instrumentów: nazwa, giełda i klasa, cena z odczytem LIVE (albo „—” z powodem),
 * obrót 24 h, otwarte pozycje, funding godzinowy i roczny, przycisk wykresu. Same teksty z modelu wiersza
 * (`utils/marketsTable.rowModel`); opis rynku, bez kierunku ceny.
 */

export const CLASS_LABEL: Record<MarketClass, string> = {
  crypto: tr('Krypto', 'Crypto'),
  equity: tr('Akcje', 'Stocks'),
  index: tr('Indeksy', 'Indices'),
  commodity: tr('Surowce', 'Commodities'),
  fx: 'FX',
  other: tr('Inne', 'Other'),
};

/** Pełna nazwa instrumentu (karty); inne rynki — nazwa z rejestru. */
const FULL: Record<string, string> = Object.fromEntries(DESK_MARKETS.map((m) => [m.coin, tr(m.full.pl, m.full.en)]));
/** Symbol kontraktu w karcie (BTC jak w nagłówku aplikacji: BTC-PERP); inne rynki — nazwa z giełdy. */
const TICKER: Record<string, string> = { BTC: 'BTC-PERP' };

const Stat: React.FC<{ label: string; value: string; sub?: string | null }> = ({ label, value, sub }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</dt>
    <dd className="mt-1 font-mono text-lg tabular-nums text-ink-1">{value}</dd>
    {sub && <dd className="font-sans text-[11px] text-ink-3">{sub}</dd>}
  </div>
);

const MarketCard: React.FC<{ row: MarketRowModel }> = ({ row }) => (
  <article data-market-row={row.coin} aria-labelledby={`rynek-${row.coin}`} className="flex flex-col gap-5 rounded-2xl border border-line bg-surface-1 p-5 sm:p-6">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id={`rynek-${row.coin}`} className="font-display text-[26px] font-bold leading-none tracking-tight [font-stretch:90%] text-ink-1">
          {FULL[row.coin] ?? row.name}
        </h3>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
          <span className="font-mono">{TICKER[row.coin] ?? row.coin}</span>
          <span className="rounded border border-line px-1 leading-4" title={row.exchangeTitle}>
            {row.exchange}
          </span>
          {row.cls !== null && <span>{CLASS_LABEL[row.cls]}</span>}
        </p>
      </div>
      {/* Stała szerokość w obu stanach (powód braku danych i LIVE z godziną): bez tego linia giełdy po lewej łamie się
          inaczej przed odczytem i po nim, a karta podskakuje (CLS) */}
      <span className="flex w-[132px] shrink-0 items-center justify-end gap-1.5 text-[11px] text-ink-3">
        {row.readAt !== null ? (
          <>
            <Badge tone="live" size="sm" title={tr('Realne dane Hyperliquid; godzina odczytu w czasie lokalnym', 'Real Hyperliquid data; reading time in local time')}>
              LIVE
            </Badge>
            <span className="font-mono tabular-nums">{row.readAt}</span>
          </>
        ) : (
          <span className="line-clamp-3 text-right" title={row.why ?? undefined}>
            {row.why}
          </span>
        )}
      </span>
    </header>
    <p className={`font-mono text-[40px] leading-none tabular-nums tracking-tight ${row.why === null ? 'text-ink-1' : 'text-ink-3'}`} aria-label={tr(`Cena: ${row.price}`, `Price: ${row.price}`)}>
      {row.price}
    </p>
    <dl className="grid grid-cols-3 gap-4 border-t border-line pt-4">
      <Stat label={tr('Obrót 24 h', '24h volume')} value={row.volume} />
      <Stat label={tr('Otwarte poz.', 'Open int.')} value={row.openInterest} />
      <Stat label={tr('Funding 1 h', 'Funding 1h')} value={row.fundingHour} sub={row.fundingYear !== null ? tr(`${row.fundingYear} rocznie`, `${row.fundingYear} per year`) : null} />
    </dl>
    {row.chartHref !== null ? (
      <a href={row.chartHref} className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-2">
        {tr('Wykres', 'Chart')}
        <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
      </a>
    ) : (
      <p className="text-xs text-ink-3">{row.chartWhy}</p>
    )}
  </article>
);

export const MarketList: React.FC<{ rows: MarketRowModel[] }> = ({ rows }) => (
  <div role="list" aria-label={`${tr('Rynki', 'Markets')}: ${deskLabels()}`} className="grid grid-cols-1 gap-4 md:grid-cols-2">
    {rows.map((r) => (
      <div role="listitem" key={r.coin} className="min-w-0">
        <MarketCard row={r} />
      </div>
    ))}
  </div>
);
