import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { locale, tr } from '../../../i18n';
import { DASH, fmtFixed } from '../../../ui/format';
import { type PriceBucket } from '../core/smcRangeProfileFlow';
import type { TapeCell, TapeWindow } from '../core/smcRangeProfileTape';
import { fmtHms } from '../core/time';
import { rangeProfileLabel, type ProfileDisplayRow, type RangeProfileInfo } from './smcRangeProfileLayer';

const grid = 'grid grid-cols-[1.35fr_1fr_1fr] items-baseline gap-x-2';

function formatBand({ low, high }: PriceBucket): string {
  return `[${fmtFixed(low, 0)}–${fmtFixed(high, 0)})`;
}

export function SmcTapeLegend({ windows, compact, id }: { windows: readonly TapeWindow[]; compact: boolean; id?: string }) {
  return <div id={id} data-smc-tape-trace className={compact ? 'text-xs leading-4 text-ink-2' : 'flex flex-wrap items-center gap-x-2 text-xs text-ink-2'}>
    <div className="flex flex-wrap items-center gap-x-2">
      <span>{tr('Taśma 30 s · 3 × 10 s →', 'Tape 30 s · 3 × 10 s →')}</span>
      <span className="text-sell-ink">{tr('← sprzedaż', '← sell')}</span>
      <span className="text-buy-ink">{tr('kupno →', 'buy →')}</span>
    </div>
    {windows.some(window => window.coverage !== 'full') && <div className="text-warn">
      {windows.flatMap(({ coverage }, index) => coverage === 'full' ? [] :
        [`${index + 1} ${coverage === 'gap' ? tr('brak', 'missing') : tr('fragment', 'partial')}`]).join(' · ')}
    </div>}
  </div>;
}

function RowNumbers({ row, maxTurnover, maxDelta, compact }: {
  row: ProfileDisplayRow; maxTurnover: number; maxDelta: number; compact: boolean;
}) {
  const positive = row.deltaUsd > 0;
  const deltaWidth = row.deltaUsd === 0 ? 0 : 50 * Math.abs(row.deltaUsd) / maxDelta;
  return <div className={`${grid} font-mono text-xs tabular-nums`}>
    <span className="whitespace-nowrap text-ink-2">{formatBand(row)}</span>
    <span className="text-right text-ink-1">
      <strong className="block whitespace-nowrap">{rangeProfileLabel(row.turnoverUsd, false)}</strong>
      <span aria-hidden="true" className="mt-1 flex h-0.5 justify-end rounded-full bg-line">
        <span className="h-full rounded-full bg-ink-2/80" style={{ width: `${100 * row.turnoverUsd / maxTurnover}%` }} />
      </span>
    </span>
    <span className={`text-right ${row.deltaUsd === 0 ? 'text-ink-2' : positive ? 'text-buy-ink' : 'text-sell-ink'}`}>
      <strong className="block whitespace-nowrap">{rangeProfileLabel(row.deltaUsd, true)}</strong>
      {!compact && <span aria-hidden="true" className="relative mt-1 block h-0.5 rounded-full bg-line">
        {deltaWidth > 0 && <span className={`absolute h-full rounded-full ${positive ? 'left-1/2 bg-buy' : 'right-1/2 bg-sell'}`} style={{ width: `${deltaWidth}%` }} />}
      </span>}
    </span>
  </div>;
}

function Cells({ values, max }: { values: readonly (TapeCell | undefined)[] | undefined; max: bigint }) {
  return <div aria-hidden="true" className="mt-1.5 grid grid-cols-3 gap-1">
    {[0, 1, 2].map(index => {
      const cell = values?.[index];
      return <span key={index} className="relative h-1.5 rounded-sm bg-surface-2">
        <span className="absolute inset-y-0 left-1/2 w-px bg-ink-3/50" />
        {cell && cell.sell > 0n && <span className="absolute inset-y-px right-1/2 rounded-l-sm bg-sell" style={{ width: `${50 * Number(cell.sell) / Number(max)}%` }} />}
        {cell && cell.buy > 0n && <span className="absolute inset-y-px left-1/2 rounded-r-sm bg-buy" style={{ width: `${50 * Number(cell.buy) / Number(max)}%` }} />}
      </span>;
    })}
  </div>;
}

export function MobileSmcRangeProfile({ id, info, expanded, onToggle, replayAt, details }: {
  id: string; info: RangeProfileInfo | null; expanded: boolean; onToggle: () => void; replayAt: number | null; details: ReactNode;
}) {
  const { panel, active } = info ?? {};
  const rows = panel?.rows ?? [];
  const current = active && rows.find(row => row.low === active.low && row.high === active.high);
  const maxTurnover = Math.max(0, ...rows.map(row => row.turnoverUsd));
  const maxDelta = Math.max(0, ...rows.map(row => Math.abs(row.deltaUsd)));
  const columns = <div className={`${grid} text-[11px] font-medium leading-4 text-ink-3`}>
    <span>{tr('Przedział ceny', 'Price band')}</span>
    <span className="text-right">{tr('Obrót USD', 'Volume USD')}</span>
    <span className="text-right">Δ USD</span>
  </div>;

  return <section data-smc-mobile-profile data-theme="dark" aria-label={tr('Profil zakresu SMC', 'SMC range profile')}
    className="mt-2 min-w-0 rounded-xl border border-line bg-surface-1 px-3 text-ink-1">
    <button type="button" aria-expanded={expanded} aria-controls={expanded ? id : undefined} onClick={onToggle}
      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg text-left text-xs font-semibold focus-visible:outline-2 focus-visible:outline-accent">
      <span className="pointer-events-none">{tr('Profil zakresu SMC', 'SMC range profile')}</span>
      <span className="pointer-events-none flex items-center gap-1 font-medium text-ink-2">
        {expanded ? tr('Zwiń profil', 'Collapse profile') : tr('Rozwiń profil', 'Expand profile')}
        <ChevronDown aria-hidden="true" className={`h-4 w-4 ${expanded ? 'rotate-180' : ''}`} />
      </span>
    </button>
    {!expanded && <div className="border-t border-line pb-2 pt-1.5">
      {current ? <div data-smc-mobile-current className="space-y-0.5">{columns}
        <RowNumbers row={current} maxTurnover={maxTurnover} maxDelta={maxDelta} compact />
      </div> : <div className="text-xs text-ink-2">{active
        ? <>{tr('Aktywny przedział poza wykresem', 'Active band outside the chart')} · {formatBand(active)}</>
        : tr('Brak wykonań w zakresie', 'No trades in range')}</div>}
    </div>}
    {expanded && <div id={id} className="space-y-2 border-t border-line pb-3 pt-2">
      <div data-smc-range-profile={info?.levels ?? 0} className="text-xs leading-snug text-ink-2">
        {info?.levels ? <>{tr('Krok', 'Step')} {info.step} USD</> : tr('Brak wykonań w zakresie', 'No trades in range')}
        {' · '}{tr('taśma', 'tape')} {info ? `${info.coverage.toLocaleString(locale)}%` : DASH}
        {info && info.coverage < 100 && <span className="text-warn"> · {tr('luki', 'gaps')}</span>}
        {replayAt !== null && <> · {tr('powtórka do', 'replay through')} {fmtHms(replayAt)}</>}
      </div>
      <SmcTapeLegend windows={info?.tapeWindows ?? []} compact />
      {rows.length > 0 && <div>
        {columns}
        {rows.map(row => <div key={row.low} data-smc-mobile-row data-smc-active={row === current || undefined} className="border-t border-line py-2">
          <RowNumbers row={row} maxTurnover={maxTurnover} maxDelta={maxDelta} compact={false} />
          <Cells values={panel?.trace?.byPrice.get(row.low)} max={panel?.trace?.maxSide ?? 0n} />
        </div>)}
      </div>}
      <div className="border-t border-line pt-2">{details}</div>
    </div>}
  </section>;
}
