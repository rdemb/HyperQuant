import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { indicatorScope, vwapFrom } from '../core/indicators';
import { periodStart } from '../core/sessions';
import type { CandleSeries, ProStore } from '../store/proStore';
import { venueStoreFor } from '../venues/venueStore';
import { STATE_BARS, STATE_RUN_MAX, StateFact, StateInput, marketState, stateSentence } from './marketState';
import { PRO } from './theme';
import { tr } from '../../../i18n';

/**
 * Pasek „Stan rynku” nad wykresem: zdanie z faktów (chart/marketState.ts) przeliczane co kilka sekund, żeby nie skakało
 * przy każdej transakcji; „skąd?” (na telefonie „więcej”) rozwija fakty z liczbami. Dane Binance i Bybit tylko wtedy,
 * gdy wykres już je pobiera — pasek nie łączy przeglądarki z giełdami.
 */

const STATE_EVERY_MS = 5_000;
/** Przed pierwszym zdaniem (wykres dopiero dostaje dane) — częściej. */
const STATE_WAIT_MS = 500;
/** Migawka arkusza starsza niż tyle ms jest nieaktualna (zerwane połączenie). */
const BOOK_STALE_MS = 30_000;

function readState(store: ProStore, series: CandleSeries, venueOn: boolean): StateFact[] {
  const all = series.bars();
  const n = all.length;
  if (n === 0) return [];
  const iv = series.interval;
  const now = store.serverNow();
  const bars = all.slice(-STATE_RUN_MAX);
  const win = bars.slice(-STATE_BARS);
  // VWAP okresu ostatniej świecy (doba, na świecach dziennych tydzień) — od pierwszej świecy tego okresu, ze świec 1m (tydzień 5m) jak na wykresie
  const anchor = indicatorScope(iv.ms).vwapAnchor;
  const p0 = periodStart(all[n - 1].t, anchor);
  let k = n - 1;
  while (k > 0 && all[k - 1].t >= p0) k--;
  const vw = vwapFrom(all.slice(k), store.vwapCandles(iv), iv.ms, anchor);
  let venues: StateInput['venues'] = null;
  if (venueOn) {
    const r = venueStoreFor(store.coin).reads(iv, now);
    venues = { binance: (t) => r.delta('binance', t), bybit: (t) => r.delta('bybit', t) };
  }
  const f = store.book('near')?.latest() ?? null;
  let book: { bid: number; ask: number } | null = null;
  if (f && now - f.t <= BOOK_STALE_MS && f.nBids > 0 && f.nBids < f.px.length) {
    let bid = 0;
    let ask = 0;
    for (let i = 0; i < f.sz.length; i++) {
      if (i < f.nBids) bid += f.sz[i];
      else ask += f.sz[i];
    }
    book = { bid, ask };
  }
  const from = win[0].t;
  return marketState({
    unit: store.coin,
    bars,
    ms: iv.ms,
    now,
    vwap: vw[vw.length - 1] ?? null,
    vwapPeriod: anchor === 'week' ? tr('tygodnia', 'weekly') : tr('dnia', 'daily'),
    oiAt: (t) => store.oi.at(t),
    players: store.players.split(from, now - from, now),
    bigPlayerUsd: store.players.thresholdUsd,
    venues,
    book,
  });
}

const toneColor = (t: number) => (t > 0 ? PRO.buyInk : t < 0 ? PRO.sellInk : PRO.ink3);

export const MarketStateBar: React.FC<{ store: ProStore; series: CandleSeries; venueOn: boolean; narrow: boolean; onClose: () => void }> = ({
  store,
  series,
  venueOn,
  narrow,
  onClose,
}) => {
  const [facts, setFacts] = useState<StateFact[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let id = 0;
    // Do pierwszego zdania co 0,5 s (dane wykresu dochodzą po wejściu), potem co 5 s
    const run = () => {
      const f = readState(store, series, venueOn);
      setFacts(f);
      id = window.setTimeout(run, f.length > 0 ? STATE_EVERY_MS : STATE_WAIT_MS);
    };
    run();
    return () => clearTimeout(id);
  }, [store, series, venueOn]);

  // Rozwinięcie zamyka dotknięcie obok i Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sentence = stateSentence(facts);
  return (
    <div ref={ref} className="relative shrink-0 border-b border-line">
      {/* Na telefonie zdanie w dwóch liniach z etykietą w tekście — w jednej linii mieścił się tylko pierwszy fakt */}
      <div className={`flex items-center gap-2 pl-2 sm:pl-3 pr-1 min-w-0 ${narrow ? 'py-1' : 'h-8'}`}>
        {!narrow && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{tr('Stan rynku', 'Market state')}</span>}
        <p className={`flex-1 min-w-0 text-[11.5px] text-ink-2 ${narrow ? 'line-clamp-2 leading-snug' : 'truncate'}`} title={sentence}>
          {narrow && <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{tr('Stan rynku', 'Market state')}</span>}
          {sentence || tr('Czekam na dane wykresu…', 'Waiting for chart data…')}
        </p>
        {facts.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 h-7 px-2 rounded-md text-[11px] font-medium text-accent hover:bg-surface-2 transition-colors duration-150"
          >
            {narrow ? tr('więcej', 'more') : tr('skąd?', 'why?')}
          </button>
        )}
        <button
          type="button"
          aria-label={tr('Ukryj Stan rynku', 'Hide Market state')}
          title={tr('Ukryj Stan rynku — włączysz go w Ustawieniach wykresu → Nad wykresem', 'Hide Market state — turn it back on in Chart settings → Above the chart')}
          onClick={onClose}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors duration-150"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && facts.length > 0 && (
        <div className="absolute left-2 right-2 sm:right-auto sm:w-[36rem] top-full mt-1 z-40 max-h-[calc(100dvh-22rem)] sm:max-h-[60vh] overflow-y-auto rounded-xl border border-line-strong bg-surface-2 p-3 shadow-2xl text-xs">
          <p className="text-ink-1 leading-snug">{sentence}</p>
          <dl className="mt-2.5 flex flex-col gap-2">
            {facts.map((f) => (
              <div key={f.key} className="grid grid-cols-[auto_1fr] gap-x-2">
                <span aria-hidden="true" className="mt-1.5 w-1.5 h-1.5 rounded-full" style={{ background: toneColor(f.tone) }} />
                <div className="min-w-0">
                  <dt className="font-medium text-ink-1">
                    {f.label}: <span className="font-normal text-ink-2">{f.text}</span>
                  </dt>
                  <dd className="mt-0.5 leading-snug text-ink-3">{f.why}</dd>
                </div>
              </div>
            ))}
          </dl>
          <p className="mt-2.5 text-[10.5px] leading-snug text-ink-3">
            {tr(
              `Opis ze stałych reguł na danych tego wykresu: ostatnie ${STATE_BARS} świec ${series.interval.label}, odświeżany co 5 s. To nie sygnał ani rekomendacja.`,
              `A description from fixed rules on this chart's data: the last ${STATE_BARS} ${series.interval.label} candles, refreshed every 5 s. Not a signal or a recommendation.`
            )}
          </p>
        </div>
      )}
    </div>
  );
};
