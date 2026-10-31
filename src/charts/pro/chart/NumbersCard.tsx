import React, { useEffect } from 'react';
import { BIG_PLAYER_USD } from '../core/players';
import { type StatGroup, STAT_GROUPS, VENUE_GROUPS, barStat } from '../core/stats';
import { barEnd, fmtHm } from '../core/time';
import type { CandleSeries, ProStore } from '../store/proStore';
import { acquireVenues, venueStoreFor } from '../venues/venueStore';
import { compact } from './FlowPanels';
import { STAT_GROUP_INFO, tableLines } from './statsTable';
import { PRO, rgba } from './theme';
import { tr } from '../../../i18n';

/**
 * Karta „Liczby” na telefonie: Tablica liczb dla ostatnich świec (kolumna na świecę, najnowsza z prawej) w tych samych
 * grupach co tablica pod wykresem. Grupa Binance albo Bybit łączy przeglądarkę z tą giełdą na czas otwarcia karty.
 */

/** Liczba świec w karcie (mieści się na ekranie telefonu). */
const COLS = 4;

const GROUP_TITLES: Record<StatGroup, string> = {
  hl: tr('Wolumen, delta, ΔOI i funding na 8 h z Hyperliquid', 'Volume, delta, ΔOI and 8 h funding from Hyperliquid'),
  tape: tr('Delta %, maksymalna i minimalna delta w świecy, liczba transakcji i tempo taśmy', 'Delta %, maximum and minimum delta in the candle, trade count and tape speed'),
  who: tr(
    `Delta dużych graczy (kont, które w godzinie UTC weszły na rynek za co najmniej ${Object.entries(BIG_PLAYER_USD)
      .map(([c, v]) => `${compact(v)} USD na ${c}`)
      .join(', ')}) i reszty rynku oraz udział dużych w wartości wejść`,
    `Delta of large players (accounts that entered the market for at least ${Object.entries(BIG_PLAYER_USD)
      .map(([c, v]) => `${compact(v)} USD on ${c}`)
      .join(', ')} in a UTC hour) and the rest of the market, plus the large players' share of entry value`
  ),
  binance: tr('Delta perp i spot, ΔOI i funding na 8 h z Binance', 'Perp and spot delta, ΔOI and 8 h funding from Binance'),
  bybit: tr('Delta (z transakcji od otwarcia strony) i ΔOI z Bybit', 'Delta (from trades since the page opened) and ΔOI from Bybit'),
};

/**
 * Grupy wierszy Tablicy liczb: przełączniki jednym kliknięciem; ostatniej włączonej grupy nie da się wyłączyć.
 * `row` — jeden przewijany wiersz (karta na telefonie zostawia wysokość tabeli).
 */
export const StatGroupPicker: React.FC<{ value: readonly StatGroup[]; onChange: (g: StatGroup[]) => void; className?: string; row?: boolean }> = ({
  value,
  onChange,
  className = '',
  row = false,
}) => (
  <div role="group" aria-label={tr('Grupy Tablicy liczb', 'Numbers table groups')} className={`flex gap-1.5 ${row ? 'overflow-x-auto [scrollbar-width:none]' : 'flex-wrap'} ${className}`}>
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
          className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[11px] font-medium transition-colors duration-150 disabled:cursor-not-allowed ${
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
  const players = groups.includes('who') ? (t: number) => store.players.split(t, iv.ms, now) : null;
  const stats = bars.map((b) => barStat(b, iv.ms, now, store.oi, store.funding, predicted, reads, players));
  const lines = tableLines(groups);
  const partial = stats.some((s) => s.partial);

  return (
    <section aria-label={tr('Liczby', 'Numbers')} className={`flex flex-col min-h-0 bg-surface-1 ${className}`}>
      <div className="px-2 py-2 border-b border-line shrink-0">
        <StatGroupPicker value={groups} onChange={onGroups} row />
      </div>
      <div className="flex-1 min-h-0 overflow-auto [scrollbar-width:thin]">
        <table className="w-full border-collapse font-mono text-[11.5px]">
          <thead>
            <tr>
              <th className="sticky top-0 bg-surface-1" />
              {bars.map((b, i) => (
                <th
                  key={b.t}
                  scope="col"
                  title={stats[i].partial ? tr('Świeca częściowa: liczby z taśmy tylko z jej części', 'Partial candle: tape numbers cover only part of it') : undefined}
                  className="sticky top-0 bg-surface-1 px-2 py-1.5 text-right font-medium text-ink-3"
                  style={stats[i].partial ? { color: PRO.partial } : undefined}
                >
                  {barEnd(b.t, iv.ms) > now ? tr('teraz', 'now') : fmtHm(b.t)}
                  {stats[i].partial && '*'}
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
        {/* Objaśnienia pod tabelą, w tym samym przewijaniu: tabela dostaje całą wysokość karty */}
        <p className="px-2 pt-2 pb-2.5 mt-1 border-t border-line text-[10px] leading-snug text-ink-3">
          {tr(
            `Ostatnie świece ${iv.label}, najnowsza z prawej; tło — siła wartości względem tych świec. Funding w % na 8 h.`,
            `Latest ${iv.label} candles, newest on the right; background — value strength relative to these candles. Funding in % per 8 h.`
          )}
          {partial &&
            tr(
              ' Godzina z gwiazdką — świeca częściowa: nagrywanie taśmy zaczęło się albo przerwało w jej trakcie, więc liczby z taśmy są tylko z jej części.',
              ' A time with an asterisk — partial candle: tape recording started or broke off during it, so tape numbers cover only part of it.'
            )}
          {venueOn &&
            tr(
              ` Dane ${venues.map((g) => STAT_GROUP_INFO[g].label).join(' i ')} pobiera Twoja przeglądarka bezpośrednio z publicznego API giełdy.`,
              ` Your browser fetches ${venues.map((g) => STAT_GROUP_INFO[g].label).join(' and ')} data directly from the exchange's public API.`
            )}
          {groups.includes('who') &&
            tr(
              ` Duży gracz: konto, które w godzinie UTC weszło na rynek za co najmniej ${compact(store.players.thresholdUsd)} USD.`,
              ` Large player: an account that entered the market for at least ${compact(store.players.thresholdUsd)} USD in a UTC hour.`
            )}
          {groups.includes('bybit') && tr(' Delta Bybit liczy się od otwarcia strony.', ' Bybit delta counts from the page opening.')}
        </p>
      </div>
    </section>
  );
};
