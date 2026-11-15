import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { tr } from '../../i18n';
import { useMarketsPage } from '../../state/useMarketsTable';
import { Badge } from '../../ui';
import { DESK_MARKETS } from '../../config/deskMarkets';

/**
 * Wybór instrumentu na Starcie (rynki aplikacji z konfiguracji): karta z ceną LIVE i godziną odczytu, fundingiem
 * i otwartymi pozycjami; klik otwiera W sesji z wykresem tego rynku (link `#charts?m=…`, wybór zostaje w ustawieniach
 * wykresu). Te same dane co strona Rynki (`useMarketsPage`). Opis rynku, bez kierunku ceny.
 */
const NAMES: Record<string, { name: string; sub: string }> = Object.fromEntries(
  DESK_MARKETS.map((m) => [m.coin, { name: tr(m.full.pl, m.full.en), sub: m.dex ? tr(`${m.coin} · giełda HIP-3`, `${m.coin} · HIP-3 exchange`) : `${m.coin}-PERP · Hyperliquid` }])
);

export const InstrumentCards: React.FC = () => {
  const { rows } = useMarketsPage();
  return (
    <div role="group" aria-labelledby="start-instrument" className="mt-10 max-w-[760px]">
      <p id="start-instrument" className="mb-3 text-[11px] font-bold tracking-[0.14em] text-ink-3 uppercase">
        {tr('Instrument', 'Instrument')}
      </p>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
        {rows.map((r) => {
          const n = NAMES[r.coin] ?? { name: r.name, sub: r.exchangeTitle };
          return (
            <a
              key={r.coin}
              href={r.chartHref ?? '#charts'}
              data-instrument={r.coin}
              className="group relative flex flex-col gap-2 rounded-2xl border border-line-strong bg-surface-1/85 px-4 py-3.5 backdrop-blur transition-colors duration-150 hover:border-ink-3 hover:bg-surface-2/90"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-display text-xl font-bold leading-tight tracking-tight [font-stretch:90%] text-ink-1">{n.name}</span>
                  <span className="block font-mono text-[10.5px] text-ink-3">{n.sub}</span>
                </span>
                <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-3 transition-colors duration-150 group-hover:text-ink-1" />
              </span>
              <span className={`font-mono text-2xl tabular-nums leading-none ${r.why === null ? 'text-ink-1' : 'text-ink-3'}`}>{r.price}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
                {r.readAt !== null ? (
                  <span className="flex items-center gap-1">
                    <Badge tone="live" size="sm" title={tr('Realne dane Hyperliquid; godzina odczytu w czasie lokalnym', 'Real Hyperliquid data; reading time in local time')}>
                      LIVE
                    </Badge>
                    <span className="font-mono tabular-nums">{r.readAt}</span>
                  </span>
                ) : (
                  <span>{r.why}</span>
                )}
                <span>
                  Funding <span className="font-mono tabular-nums text-ink-2">{r.fundingHour}</span>
                </span>
                <span>
                  OI <span className="font-mono tabular-nums text-ink-2">{r.openInterest}</span>
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
};
