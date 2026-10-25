import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { DASH, numLang } from '../../../ui';
import { fmtBarTime, fmtSince } from '../core/time';
import type { Hover } from './controller';
import { fmtPx } from './layout';
import { tr } from '../../../i18n';

/** Najnowszy stan krzyża (ustawiany przez sterownik wykresu najwyżej raz na klatkę). */
export class HoverSignal {
  private value: Hover = { bar: null, live: true, open: false, row: null, cvd: null, ind: null };
  private readonly listeners = new Set<() => void>();

  set = (h: Hover): void => {
    this.value = h;
    this.listeners.forEach((fn) => fn());
  };

  get = (): Hover => this.value;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

const fmtSigma = (z: number) => `${z >= 0 ? '+' : '−'}${numLang(Math.abs(z).toFixed(2))}σ`;

const tone = (v: number) => (v > 0 ? 'text-of-buy-ink' : v < 0 ? 'text-of-sell-ink' : 'text-ink-2');

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string; title?: string; secondary?: boolean }> = ({
  label,
  children,
  className = 'text-ink-1',
  title,
  secondary,
}) => (
  // Pola drugorzędne chowamy na wąskim ekranie — legenda nie zasłania wykresu
  <span className={`${secondary ? 'hidden sm:inline-flex' : 'inline-flex'} items-baseline gap-1`} title={title}>
    <span className="text-ink-3">{label}</span>
    <span className={className}>{children}</span>
  </span>
);

/**
 * Legenda wykresu: świeca pod krzyżem (albo bieżąca), OHLC i wolumen z API, a z taśmy: delta, jej
 * maksimum i minimum, liczba transakcji, udział taśmy w wolumenie świecy i wiersz footprintu pod kursorem.
 * `onBottom` dostaje dolną krawędź legendy (px od góry wykresu) — tylko bez krzyża, żeby skala nie skakała przy ruchu kursora.
 * `compact` (telefon): jedna linia — zamknięcie, zmiana, wolumen i VWAP; czas świecy tylko pod palcem, rynek i interwał są w pasku.
 */
export const Legend: React.FC<{
  signal: HoverSignal;
  intervalMs: number;
  intervalLabel: string;
  tapeSince: number;
  coin: string;
  onBottom?: (px: number) => void;
  compact?: boolean;
}> = ({ signal, intervalMs, intervalLabel, tapeSince, coin, onBottom, compact = false }) => {
  const h = useSyncExternalStore(signal.subscribe, signal.get);
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef(h.live);
  live.current = h.live;
  useEffect(() => {
    const el = ref.current;
    if (!el || !onBottom) return;
    const ro = new ResizeObserver(() => {
      if (live.current) onBottom(el.offsetTop + el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onBottom]);
  const bar = h.bar;
  const c = bar?.candle;
  const fp = bar?.fp ?? null;
  const change = c ? ((c.c - c.o) / c.o) * 100 : Number.NaN;
  const fpVol = fp ? fp.buyVol + fp.sellVol : 0;

  if (compact) {
    return (
      <div
        ref={ref}
        className="absolute left-1.5 top-1 z-10 pointer-events-none max-w-[calc(100%-4.5rem)] rounded px-1.5 bg-surface-1/75 font-mono tabular-nums text-[10.5px] leading-[1.6] text-ink-2"
      >
        {c ? (
          <div className="flex items-baseline gap-x-2 whitespace-nowrap overflow-hidden">
            {!h.live && bar && <span className="text-ink-3">{fmtBarTime(bar.t, intervalMs)}</span>}
            <span className={c.c >= c.o ? 'text-of-buy-ink' : 'text-of-sell-ink'}>
              {fmtPx(c.c)} {change >= 0 ? '+' : '−'}
              {numLang(Math.abs(change).toFixed(2))}%
            </span>
            <Field label={tr('Wol.', 'Vol.')}>{fmtVol(c.v)}</Field>
            {h.ind?.vwap && (
              <Field label={h.ind.anchor === 'week' ? tr('VWAP T', 'VWAP W') : 'VWAP'} className="text-of-vwap">
                {fmtPx(h.ind.vwap.vwap)}
              </Field>
            )}
          </div>
        ) : (
          <div className="text-ink-3">{tr('Wczytywanie świec…', 'Loading candles…')}</div>
        )}
        {h.row && (
          <div className="flex items-baseline gap-x-2 whitespace-nowrap overflow-hidden">
            <span className="text-ink-3">{fmtPx(h.row.lo)}</span>
            <Field label={tr('S', 'S')} className="text-of-sell-ink">
              {fmtVol(h.row.sell)}
            </Field>
            <Field label={tr('K', 'B')} className="text-of-buy-ink">
              {fmtVol(h.row.buy)}
            </Field>
            <Field label="Δ" className={tone(h.row.buy - h.row.sell)}>
              {fmtSignedVol(h.row.buy - h.row.sell)}
            </Field>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="absolute left-2 top-2 z-10 pointer-events-none max-w-[calc(100%-5rem)] rounded-md bg-surface-1/95 sm:bg-surface-1/80 px-2 py-1 font-mono tabular-nums text-[11px] leading-[1.55] text-ink-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-ink-1 font-semibold font-sans">{coin}-PERP</span>
        <span className="text-ink-3">
          {intervalLabel} · Hyperliquid
        </span>
        {bar && <span className="text-ink-2">{fmtBarTime(bar.t, intervalMs)}</span>}
        {h.live && h.open && bar && <span className="text-accent">● {tr('bieżąca', 'current')}</span>}
      </div>
      {c ? (
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <Field label="O" secondary>
            {fmtPx(c.o)}
          </Field>
          <Field label="H" secondary>
            {fmtPx(c.h)}
          </Field>
          <Field label="L" secondary>
            {fmtPx(c.l)}
          </Field>
          <Field label="C" className={c.c >= c.o ? 'text-of-buy-ink' : 'text-of-sell-ink'}>
            {fmtPx(c.c)}
          </Field>
          <span className={change >= 0 ? 'text-of-buy-ink' : 'text-of-sell-ink'}>
            {change >= 0 ? '+' : '−'}
            {numLang(Math.abs(change).toFixed(2))}%
          </span>
          <Field label={tr('Wol.', 'Vol.')} title={tr(`Wolumen świecy z API Hyperliquid (${coin})`, `Candle volume from the Hyperliquid API (${coin})`)}>
            {fmtVol(c.v)}
          </Field>
        </div>
      ) : (
        <div className="text-ink-3">{tr('Wczytywanie świec…', 'Loading candles…')}</div>
      )}
      {(h.ind?.vwap || h.ind?.svwap) && c && (
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          {h.ind.vwap && (
            <Field label={h.ind.anchor === 'week' ? tr('VWAP T', 'VWAP W') : 'VWAP'} className="text-of-vwap" title={tr('VWAP od początku okresu (cena typowa ważona wolumenem)', 'VWAP since the start of the period (typical price weighted by volume)')}>
              {fmtPx(h.ind.vwap.vwap)}
            </Field>
          )}
          {h.ind.vwap && h.ind.vwap.sd > 0 && (
            <Field
              label={tr('Odch.', 'Dev.')}
              className={tone(c.c - h.ind.vwap.vwap)}
              title={tr('Odległość zamknięcia od VWAP w odchyleniach standardowych', 'Distance of the close from VWAP in standard deviations')}
              secondary
            >
              {fmtSigma((c.c - h.ind.vwap.vwap) / h.ind.vwap.sd)}
            </Field>
          )}
          {h.ind.svwap && (
            <Field label="VWAP S" className="text-of-svwap" title={tr('VWAP od otwarcia bieżącej sesji', 'VWAP since the current session open')}>
              {fmtPx(h.ind.svwap.vwap)}
            </Field>
          )}
        </div>
      )}
      {/* Szczegóły taśmy tylko na szerszym ekranie — na telefonie deltę i CVD pokazują opisy paneli */}
      {fp && bar ? (
        <div className="hidden sm:flex flex-wrap items-baseline gap-x-2.5">
          <Field label="Δ" className={tone(fp.delta)} title={tr(`Delta: kupno agresywne − sprzedaż agresywna (${coin})`, `Delta: aggressive buying − aggressive selling (${coin})`)}>
            {fmtSignedVol(fp.delta)}
            {fpVol > 0 && <span className="text-ink-3"> ({((fp.delta / fpVol) * 100).toFixed(0)}%)</span>}
          </Field>
          <Field label="max" className={tone(fp.maxDelta)} title={tr('Najwyższa delta w trakcie świecy', 'Highest delta during the candle')} secondary>
            {fmtSignedVol(fp.maxDelta)}
          </Field>
          <Field label="min" className={tone(fp.minDelta)} title={tr('Najniższa delta w trakcie świecy', 'Lowest delta during the candle')} secondary>
            {fmtSignedVol(fp.minDelta)}
          </Field>
          <Field label={tr('Transakcje', 'Trades')} secondary>
            {numLang(fp.trades.toLocaleString('en-US'))}
          </Field>
          <Field
            label={tr('Taśma', 'Tape')}
            className={bar.complete ? 'text-ink-1' : 'text-warn'}
            title={tr(
              'Część wolumenu świecy zarejestrowana na taśmie na żywo. Świeca częściowa — nagrywanie zaczęło się lub przerwało w jej trakcie.',
              'The share of candle volume recorded on the live tape. Partial candle — recording started or broke off during it.'
            )}
          >
            {Number.isFinite(bar.share) ? `${Math.min(100, bar.share * 100).toFixed(0)}%` : DASH}
            {!bar.complete && tr(' · częściowa', ' · partial')}
          </Field>
          {h.cvd && (
            <Field label="CVD" className={tone(h.cvd.close)} secondary>
              {fmtSignedVol(h.cvd.close)}
            </Field>
          )}
        </div>
      ) : (
        bar && (
          <div className="hidden sm:block text-ink-3">
            {tr('Footprint: brak taśmy dla tej świecy', 'Footprint: no tape for this candle')}
            {Number.isFinite(tapeSince)
              ? tr(` — nagrywanie od ${fmtSince(tapeSince, Date.now())}`, ` — recording since ${fmtSince(tapeSince, Date.now())}`)
              : tr(' — czekam na pierwsze transakcje', ' — waiting for the first trades')}
          </div>
        )
      )}
      {h.row && (
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <Field label={tr('Wiersz', 'Row')}>
            {fmtPx(h.row.lo)}
            {h.row.hi > h.row.lo && `–${fmtPx(h.row.hi)}`}
          </Field>
          <Field label={tr('Sprzedaż', 'Sell')} className="text-of-sell-ink">
            {fmtVol(h.row.sell)}
          </Field>
          <Field label={tr('Kupno', 'Buy')} className="text-of-buy-ink">
            {fmtVol(h.row.buy)}
          </Field>
          <Field label="Δ" className={tone(h.row.buy - h.row.sell)}>
            {fmtSignedVol(h.row.buy - h.row.sell)}
          </Field>
        </div>
      )}
    </div>
  );
};
