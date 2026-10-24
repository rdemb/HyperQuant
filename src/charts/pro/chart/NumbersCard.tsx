import React, { useEffect } from 'react';
import { type StatGroup, STAT_GROUPS, VENUE_GROUPS, barStat } from '../core/stats';
import { fmtHm } from '../core/time';
import type { CandleSeries, ProStore } from '../store/proStore';
import { acquireVenues, venueStoreFor } from '../venues/venueStore';
import { STAT_GROUP_INFO, tableLines } from './statsTable';
import { PRO, rgba } from './theme';

/**
 * Karta „Liczby” na telefonie: Tablica liczb dla ostatnich świec (kolumna na świecę, najnowsza z prawej) w tych samych
 * grupach co tablica pod wykresem. Grupa Binance albo Bybit łączy przeglądarkę z tą giełdą na czas otwarcia karty.
 */

/** Liczba świec w karcie (mieści się na ekranie telefonu). */
const COLS = 4;

const GROUP_TITLES: Record<StatGroup, string> = {
  hl: 'Wolumen, delta, ΔOI i funding na 8 h z Hyperliquid',
  tape: 'Delta %, maksymalna i minimalna delta w świecy, liczba transakcji i tempo taśmy',
  binance: 'Delta perp i spot, ΔOI i funding na 8 h z Binance',
  bybit: 'Delta (z transakcji od otwarcia strony) i ΔOI z Bybit',
};

/** Grupy wierszy Tablicy liczb: przełączniki jednym kliknięciem; ostatniej włączonej grupy nie da się wyłączyć. */
export const StatGroupPicker: React.FC<{ value: readonly StatGroup[]; onChange: (g: StatGroup[]) => void; className?: string }> = ({
  value,
  onChange,
  className = '',
}) => (
  <div role="group" aria-label="Grupy Tablicy liczb" className={`flex flex-wrap gap-1.5 ${className}`}>
    {STAT_GROUPS.map((g) => {
      const on = value.includes(g);
      const info = STAT_GROUP_INFO[g];
      return (
        <button
          key={g}
          type="button"
          aria-pressed={on}
          disabled={on && value.length === 1}
          title={GROUP_TITLES[g]}
          onClick={() => onChange(on ? value.filter((x) => x !== g) : STAT_GROUPS.filter((x) => x === g || value.includes(x)))}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[11px] font-medium transition-colors duration-150 disabled:cursor-not-allowed ${
            on ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-3 border-line hover:text-ink-1'
          }`}
        >
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: on ? info.color : 'transparent', boxShadow: `inset 0 0 0 1px ${info.color}` }} />
          {info.short}
        </button>
      );
    })}
  </div>
);

export const NumbersCard: React.FC<{
  store: ProStore;
  series: CandleSeries;
  groups: readonly StatGroup[];
  onGroups: (g: StatGroup[]) => void;
  className: string;
}> = ({ store, series, groups, onGroups, className }) => {
  const iv = series.interval;
  const venues = VENUE_GROUPS.filter((g) => groups.includes(g));
  const venueOn = venues.length > 0;
  useEffect(() => (venueOn ? acquireVenues(store.coin, iv) : undefined), [venueOn, store.coin, iv]);
  const bars = series.bars().slice(-COLS);
  const venue = venueOn ? venueStoreFor(store.coin) : null;
  const first = bars[0]?.t;
  useEffect(() => {
    if (venue && first !== undefined) venue.ensure(iv, first);
  });
  const now = store.serverNow();
  const reads = venue ? venue.reads(iv, now) : null;
  const predicted = store.ctx ? store.ctx.funding : null;
  const stats = bars.map((b) => barStat(b, iv.ms, now, store.oi, store.funding, predicted, reads));
  const lines = tableLines(groups);

  return (
    <section aria-label="Liczby" className={`flex flex-col min-h-0 bg-surface-1 ${className}`}>
      <div className="px-2 py-2 border-b border-line shrink-0">
        <StatGroupPicker value={groups} onChange={onGroups} />
      </div>
      <div className="flex-1 min-h-0 overflow-auto [scrollbar-width:thin]">
        <table className="w-full border-collapse font-mono text-[11.5px]">
          <thead>
            <tr>
              <th className="sticky top-0 bg-surface-1" />
              {bars.map((b) => (
                <th key={b.t} scope="col" className="sticky top-0 bg-surface-1 px-2 py-1.5 text-right font-medium text-ink-3">
                  {b.t + iv.ms > now ? 'teraz' : fmtHm(b.t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ group, row }) => {
              if (!row) {
                const g = STAT_GROUP_INFO[group];
                return (
                  <tr key={group}>
                    <th colSpan={bars.length + 1} scope="colgroup" className="px-2 pt-2.5 pb-1 text-left text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: g.color }}>
                      {g.label}
                    </th>
                  </tr>
                );
              }
              // Nasycenie tła względem pokazanych świec (wiersze ze stałą skalą — względem niej)
              const vals = stats.map((s) => s[row.key]);
              const norm = row.scale ?? Math.max(0, ...vals.map((v) => (v === null || !Number.isFinite(v) ? 0 : Math.abs(v))));
              return (
                <tr key={row.key} className="border-t border-line/60">
                  <th scope="row" className="px-2 py-1 text-left font-medium text-ink-3 whitespace-nowrap">
                    {row.label}
                  </th>
                  {vals.map((v, i) => {
                    if (v === null || !Number.isFinite(v)) {
                      return (
                        <td key={bars[i].t} className="px-2 py-1 text-right text-ink-3">
                          —
                        </td>
                      );
                    }
                    const k = norm > 0 ? Math.min(1, Math.abs(v) / norm) : 0;
                    const bg = rgba(row.signed ? (v >= 0 ? PRO.buyInk : PRO.sellInk) : PRO.volBar, 0.08 + 0.5 * k);
                    return (
                      <td key={bars[i].t} className="px-2 py-1 text-right text-ink-1" style={{ background: bg }}>
                        {row.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-2 py-1.5 border-t border-line text-[10px] leading-snug text-ink-3 shrink-0">
        Ostatnie świece {iv.label}, najnowsza z prawej; tło — siła wartości względem tych świec. Funding w % na 8 h.
        {venueOn && ` Dane ${venues.map((g) => STAT_GROUP_INFO[g].label).join(' i ')} pobiera Twoja przeglądarka bezpośrednio z publicznego API giełdy.`}
        {groups.includes('bybit') && ' Delta Bybit liczy się od otwarcia strony.'}
      </p>
    </section>
  );
};
