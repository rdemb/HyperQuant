import React, { useSyncExternalStore } from 'react';
import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { DASH, fmtPrice } from '../../../ui';
import { fmtBarTime, fmtSince } from '../core/time';
import type { Hover } from './controller';

/** Najnowszy stan krzyża (ustawiany przez sterownik wykresu najwyżej raz na klatkę). */
export class HoverSignal {
  private value: Hover = { bar: null, live: true, row: null, cvd: null };
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

const tone = (v: number) => (v > 0 ? 'text-buy-ink' : v < 0 ? 'text-sell-ink' : 'text-ink-2');

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
 */
export const Legend: React.FC<{ signal: HoverSignal; intervalMs: number; intervalLabel: string; tapeSince: number }> = ({
  signal,
  intervalMs,
  intervalLabel,
  tapeSince,
}) => {
  const h = useSyncExternalStore(signal.subscribe, signal.get);
  const bar = h.bar;
  const c = bar?.candle;
  const fp = bar?.fp ?? null;
  const change = c ? ((c.c - c.o) / c.o) * 100 : Number.NaN;
  const fpVol = fp ? fp.buyVol + fp.sellVol : 0;

  return (
    <div className="absolute left-2 top-2 z-10 pointer-events-none max-w-[calc(100%-5rem)] rounded-md bg-surface-1/95 sm:bg-surface-1/80 px-2 py-1 font-mono tabular-nums text-[11px] leading-[1.55] text-ink-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-ink-1 font-semibold font-sans">BTC-PERP</span>
        <span className="text-ink-3">
          {intervalLabel} · Hyperliquid
        </span>
        {bar && <span className="text-ink-2">{fmtBarTime(bar.t, intervalMs)}</span>}
        {h.live && bar && <span className="text-accent">● bieżąca</span>}
      </div>
      {c ? (
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <Field label="O" secondary>
            {fmtPrice(c.o, 0)}
          </Field>
          <Field label="H" secondary>
            {fmtPrice(c.h, 0)}
          </Field>
          <Field label="L" secondary>
            {fmtPrice(c.l, 0)}
          </Field>
          <Field label="C" className={c.c >= c.o ? 'text-buy-ink' : 'text-sell-ink'}>
            {fmtPrice(c.c, 0)}
          </Field>
          <span className={change >= 0 ? 'text-buy-ink' : 'text-sell-ink'}>
            {change >= 0 ? '+' : '−'}
            {Math.abs(change).toFixed(2)}%
          </span>
          <Field label="Wol." title="Wolumen świecy z API Hyperliquid (BTC)">
            {fmtVol(c.v)}
          </Field>
        </div>
      ) : (
        <div className="text-ink-3">Wczytywanie świec…</div>
      )}
      {fp && bar ? (
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <Field label="Δ" className={tone(fp.delta)} title="Delta: kupno agresywne − sprzedaż agresywna (BTC)">
            {fmtSignedVol(fp.delta)}
            {fpVol > 0 && <span className="text-ink-3"> ({((fp.delta / fpVol) * 100).toFixed(0)}%)</span>}
          </Field>
          <Field label="max" className={tone(fp.maxDelta)} title="Najwyższa delta w trakcie świecy" secondary>
            {fmtSignedVol(fp.maxDelta)}
          </Field>
          <Field label="min" className={tone(fp.minDelta)} title="Najniższa delta w trakcie świecy" secondary>
            {fmtSignedVol(fp.minDelta)}
          </Field>
          <Field label="Transakcje" secondary>
            {fp.trades.toLocaleString('pl-PL')}
          </Field>
          <Field
            label="Taśma"
            className={bar.complete ? 'text-ink-1' : 'text-warn'}
            title="Część wolumenu świecy zarejestrowana na taśmie na żywo. Świeca częściowa — nagrywanie zaczęło się lub przerwało w jej trakcie."
          >
            {Number.isFinite(bar.share) ? `${Math.min(100, bar.share * 100).toFixed(0)}%` : DASH}
            {!bar.complete && ' · częściowa'}
          </Field>
          {h.cvd && (
            <Field label="CVD" className={tone(h.cvd.close)} secondary>
              {fmtSignedVol(h.cvd.close)}
            </Field>
          )}
        </div>
      ) : (
        bar && (
          <div className="text-ink-3">
            Footprint: brak taśmy dla tej świecy
            {Number.isFinite(tapeSince) ? ` — nagrywanie od ${fmtSince(tapeSince, Date.now())}` : ' — czekam na pierwsze transakcje'}
          </div>
        )
      )}
      {h.row && (
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <Field label="Wiersz">
            {fmtPrice(h.row.lo, 0)}
            {h.row.hi > h.row.lo && `–${fmtPrice(h.row.hi, 0)}`}
          </Field>
          <Field label="Sprzedaż" className="text-sell-ink">
            {fmtVol(h.row.sell)}
          </Field>
          <Field label="Kupno" className="text-buy-ink">
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
