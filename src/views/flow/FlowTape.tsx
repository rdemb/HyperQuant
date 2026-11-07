import React, { useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { fmtVol } from '../../charts/orderflow/footprint';
import { TAPE_MIN_OPTIONS, beep, compact } from '../../charts/pro/chart/FlowPanels';
import { fmtPx } from '../../charts/pro/chart/layout';
import { takerAlias } from '../../charts/pro/core/clashes';
import type { AggressorOrder } from '../../charts/pro/core/orders';
import { type TapePace, type TapeRow, tapeGap, tapeRows } from '../../charts/pro/core/tapeMemory';
import { fmtHms } from '../../charts/pro/core/time';
import type { ProStore } from '../../charts/pro/store/proStore';
import { numLang } from '../../ui/format';
import { tr } from '../../i18n';
import { fmtSize } from './Ladder';

/**
 * Taśma z pamięcią: zlecenia agresora, TWAP-y sklejone w jeden rosnący wiersz, bitwy z jednym makerem, licznik
 * zleceń tego samego konta (pseudonim na sesję strony) i tempo taśmy wobec zwykłej minuty z ostatniej godziny.
 */

const SCAN = 3000;
const ROWS = 160;
/** Pasek wartości: pełny od tylu progów dużego zlecenia (pierwiastek, żeby drobne zlecenia nie znikały). */
const BAR_FULL = 10;
/** Konto z tyloma zleceniami w 15 min dostaje podpis „Konto N ×k”. */
const REPEAT_MIN = 3;
/** Przerwa w nagraniu taśmy od tylu ms między sąsiednimi wierszami dostaje wiersz „brak zapisu”. */
const GAP_MIN_MS = 10_000;

/**
 * Podpis „Konto N ×k”: konto z zapisu serwera ma numer ważny dobę UTC (`~ddoba:…`, pliki z numeracją dobową) albo
 * godzinę (`~godzina:…`, starsze pliki); konto na żywo — pseudonim na sesję strony.
 */
function repeatTitle(taker: string, n: number): string {
  if (taker.startsWith('~d')) return tr(`Zlecenia tego konta w ostatnich 15 min: ${n} (pseudonim z zapisu serwera, nowy co dobę UTC)`, `This account placed ${n} orders in the last 15 min (pseudonym from the server recording, new every UTC day)`);
  if (taker.startsWith('~')) return tr(`Zlecenia tego konta w ostatnich 15 min: ${n} (pseudonim z zapisu serwera, nowy co godzinę)`, `This account placed ${n} orders in the last 15 min (pseudonym from the server recording, new every hour)`);
  return tr(`Zlecenia tego konta w ostatnich 15 min: ${n} (pseudonim tylko na tę sesję strony)`, `This account placed ${n} orders in the last 15 min (pseudonym for this page session only)`);
}

const Tag: React.FC<{ tone: 'twap' | 'clash' | 'acct'; title: string; children: React.ReactNode }> = ({ tone, title, children }) => (
  <span
    title={title}
    className={`px-1 rounded-sm text-[10px] font-semibold whitespace-nowrap ${tone === 'twap' ? 'bg-accent/20 text-accent' : tone === 'clash' ? 'bg-warn/20 text-warn' : 'bg-surface-3 text-ink-2'}`}
  >
    {children}
  </span>
);

/** Najwcześniejsza i najpóźniejsza chwila wiersza (TWAP obejmuje swoje plasterki). */
const rowStart = (r: TapeRow) => (r.kind === 'twap' ? r.first : r.order.time);
const rowEnd = (r: TapeRow) => (r.kind === 'twap' ? r.last : r.order.time);

export const FlowTape: React.FC<{
  store: ProStore;
  minUsd: number;
  sound: boolean;
  bigUsd: number;
  pace: TapePace;
  selected: AggressorOrder | null;
  highlight: string;
  narrow: boolean;
  className: string;
  onPick: (o: AggressorOrder) => void;
  onMinUsd: (v: number) => void;
  onSound: (v: boolean) => void;
  /** Przyciski po prawej w nagłówku (powiększenie). */
  tools?: React.ReactNode;
  /** Nagłówek zamiast tytułu (przełącznik kart w kolumnie obok wykresu). */
  head?: React.ReactNode;
}> = ({ store, minUsd, sound, bigUsd, pace, selected, highlight, narrow, className, onPick, onMinUsd, onSound, tools, head }) => {
  const recent = store.orders.latest(SCAN);
  const rows = tapeRows(recent, minUsd, bigUsd, ROWS, store.serverNow());

  // Dźwięk: tylko nowe zlecenia od progu dużego (pierwsze renderowanie oznacza zastane jako widziane)
  const seen = useRef<WeakSet<AggressorOrder> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    const first = seen.current === null;
    const set = (seen.current ??= new WeakSet());
    let fresh: AggressorOrder | null = null;
    for (const o of recent.slice(0, 50)) {
      if (set.has(o)) continue;
      set.add(o);
      if (!first && !o.zero && o.notional >= bigUsd && (!fresh || o.notional > fresh.notional)) fresh = o;
    }
    if (fresh && sound) {
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === 'running') beep(audio.current, fresh.side === 1);
      } catch {
        // Przeglądarka bez Web Audio — taśma działa bez dźwięku
      }
    }
  });
  const toggleSound = () => {
    if (!sound) {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        // jak wyżej
      }
    }
    onSound(!sound);
  };

  const ratio = pace.median > 0 ? pace.usd1m / pace.median : Number.NaN;
  const spans = store.coverage.list();
  const grid = narrow ? 'grid-cols-[4.1rem_1fr_3.4rem_4.4rem]' : 'grid-cols-[4.2rem_5.2rem_3.6rem_3.8rem_1fr]';
  const row = (r: TapeRow, i: number) => {
    const o = r.kind === 'twap' ? r.latest : r.order;
    const buy = o.side === 1;
    const px = r.kind === 'twap' ? r.vwap : o.vwap;
    const sz = r.kind === 'twap' ? r.sz : o.sz;
    const usd = r.kind === 'twap' ? r.usd : o.notional;
    const cls = r.kind === 'order' ? r.cls : null;
    const active = selected === o || (highlight !== '' && o.taker === highlight);
    const tags: React.ReactNode[] = [];
    if (r.kind === 'twap')
      tags.push(
        <Tag
          key="t"
          tone="twap"
          title={tr(
            `TWAP: ${r.slices} plasterków ${buy ? 'kupna' : 'sprzedaży'} jednego konta od ${fmtHms(r.first)} (hash zerowy, takt 30 s), razem ${fmtVol(r.sz)} ${store.coin}`,
            `TWAP: ${r.slices} ${buy ? 'buy' : 'sell'} slices of one account since ${fmtHms(r.first)} (zero hash, 30 s cadence), total ${fmtVol(r.sz)} ${store.coin}`
          )}
        >
          TWAP ×{r.slices}
        </Tag>
      );
    if (cls === 'clash')
      tags.push(
        <Tag key="c" tone="clash" title={tr('Bitwa: co najmniej połowę progu dużego zlecenia dostarczył jeden maker', 'Battle: one maker supplied at least half of the large order threshold')}>
          {tr('bitwa', 'battle')}
        </Tag>
      );
    if (r.kind === 'order' && r.repeat >= REPEAT_MIN && !narrow)
      tags.push(
        <Tag
          key="a"
          tone="acct"
          title={repeatTitle(o.taker, r.repeat)}
        >
          {takerAlias(o.taker)} ×{r.repeat}
        </Tag>
      );
    return (
      <button
        key={`${r.kind}|${o.time}|${o.taker}|${o.vwap}|${i}`}
        type="button"
        onClick={() => onPick(o)}
        className={`relative grid w-full ${grid} gap-x-1.5 px-2 h-6 items-center font-mono text-[11px] text-left hover:bg-surface-2 ${active ? 'outline outline-1 -outline-offset-1 outline-warn/70' : ''}`}
      >
        <span aria-hidden="true" className={`absolute inset-y-0 right-0 ${buy ? 'bg-of-buy/15' : 'bg-of-sell/25'}`} style={{ width: `${Math.min(1, Math.sqrt(usd / (BAR_FULL * bigUsd))) * 100}%` }} />
        <span className="relative text-ink-3">{fmtHms(r.kind === 'twap' ? r.last : o.time)}</span>
        <span className={`relative text-right ${buy ? 'text-of-buy-ink' : 'text-of-sell-ink'} ${cls ? 'font-semibold' : ''}`}>{fmtPx(px)}</span>
        {!narrow && <span className={`relative text-right ${cls ? 'text-ink-1 font-semibold' : 'text-ink-2'}`}>{fmtSize(sz)}</span>}
        <span className={`relative text-right ${cls === 'clash' ? 'text-warn font-semibold' : cls ? 'text-ink-1 font-semibold' : 'text-ink-2'}`}>{compact(usd)}</span>
        <span className="relative flex items-center justify-end gap-1 min-w-0 overflow-hidden">{tags}</span>
      </button>
    );
  };

  return (
    <section aria-label={tr('Taśma z pamięcią', 'Tape with memory')} className={`flex flex-col min-h-0 bg-surface-1 ${className}`}>
      <div className="flex items-center gap-1 px-2 h-10 border-b border-line shrink-0">
        {head !== undefined ? (
          <span className="mr-auto min-w-0">{head}</span>
        ) : (
          <span className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium mr-auto">{tr('Taśma z pamięcią', 'Tape with memory')}</span>
        )}
        <select
          aria-label={tr('Najmniejsza wartość zlecenia na taśmie', 'Smallest order value on the tape')}
          value={minUsd}
          onChange={(e) => onMinUsd(Number(e.target.value))}
          className="h-8 bg-page border border-line rounded-md px-1.5 font-mono text-[11px] text-ink-1"
        >
          {TAPE_MIN_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? tr('Wszystkie', 'All') : tr(`od ${compact(v)}`, `${compact(v)}+`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={sound ? tr('Wyłącz dźwięk dużych zleceń', 'Turn large order sound off') : tr('Dźwięk dużych zleceń', 'Large order sound')}
          title={sound ? tr('Wyłącz dźwięk dużych zleceń', 'Turn large order sound off') : tr(`Dźwięk zleceń od ${compact(bigUsd)} USD`, `Sound for orders from ${compact(bigUsd)} USD`)}
          aria-pressed={sound}
          onClick={toggleSound}
          className={`inline-flex items-center justify-center w-8 h-8 rounded-md ${sound ? 'text-ink-1 bg-surface-3' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-2'}`}
        >
          {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        {tools}
      </div>
      {/* Tempo: ostatnia minuta wobec mediany minut z godziny i udział kupujących */}
      <div
        className="flex items-center gap-3 px-2 h-8 border-b border-line font-mono text-[11px] shrink-0"
        title={tr(
          `Wartość transakcji z ostatniej minuty wobec mediany pełnych minut z ostatniej godziny (${pace.minutes} min z nagraniem)`,
          `Trade value in the last minute against the median full minute of the last hour (${pace.minutes} recorded min)`
        )}
      >
        <span className="text-ink-3">{tr('tempo', 'pace')}</span>
        <span className="text-ink-1">{compact(pace.usd1m)} USD/min</span>
        <span className={ratio >= 2 ? 'text-warn font-semibold' : 'text-ink-2'}>{Number.isFinite(ratio) ? `${numLang(ratio.toFixed(1))}×` : '—'}</span>
        <span className="ml-auto flex items-center gap-1">
          {/* Bez transakcji albo bez nagrania ostatniej minuty: udział kupujących to „—”, bez paska */}
          {Number.isFinite(pace.buyShare) && (
            <span className="relative inline-block w-16 h-1.5 rounded-full bg-of-sell/50 overflow-hidden">
              <span className="absolute inset-y-0 left-0 bg-of-buy" style={{ width: `${pace.buyShare * 100}%` }} />
            </span>
          )}
          <span className={Number.isFinite(pace.buyShare) ? 'text-of-buy-ink' : 'text-ink-3'}>{Number.isFinite(pace.buyShare) ? `${Math.round(pace.buyShare * 100)}%` : '—'}</span>
        </span>
      </div>
      <div className={`grid ${grid} gap-x-1.5 px-2 py-1 border-b border-line font-mono text-[10px] text-ink-3 shrink-0`}>
        <span>{tr('Czas', 'Time')}</span>
        <span className="text-right">{tr('Cena', 'Price')}</span>
        {!narrow && <span className="text-right">{store.coin}</span>}
        <span className="text-right">USD</span>
        <span className="text-right">{tr('co to', 'what')}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
        {rows.length === 0 && <p className="px-3 py-4 text-[11px] text-ink-3">{tr('Brak zleceń od tej wartości w nagraniu taśmy.', 'No orders from this value in the tape recording.')}</p>}
        {rows.map((r, i) => {
          // Luka w nagraniu między tym wierszem a nowszym albo, nad najnowszym, do teraz (np. historia serwera kończy się
          // kilka minut przed otwarciem strony, a od otwarcia nie było jeszcze zlecenia od progu)
          const gap = tapeGap(spans, rowEnd(r), i > 0 ? rowStart(rows[i - 1]) : store.serverNow(), GAP_MIN_MS);
          return (
            <React.Fragment key={`${r.kind}|${(r.kind === 'twap' ? r.latest : r.order).time}|${i}`}>
              {gap && (
                <div className="px-2 h-5 flex items-center border-y border-dashed border-line font-mono text-[10px] text-ink-3" title={tr('W tym czasie taśma nie była nagrywana — zlecenia z tej przerwy nie są pokazane.', 'The tape was not recorded during this time — orders from the gap are not shown.')}>
                  {tr('brak zapisu', 'no recording')} {fmtHms(gap[0])}–{fmtHms(gap[1])}
                </div>
              )}
              {row(r, i)}
            </React.Fragment>
          );
        })}
      </div>
      <p className="px-2 py-1.5 border-t border-line text-[10px] leading-snug text-ink-3 shrink-0">
        {tr('Zlecenia agresora złożone z wypełnień · pogrubione od', 'Aggressor orders assembled from fills · bold from')} {compact(bigUsd)} USD ·{' '}
        {tr('TWAP: plasterki jednego konta sklejone, filtr liczy ich sumę', 'TWAP: one account’s slices glued, the filter counts their total')}
      </p>
    </section>
  );
};
