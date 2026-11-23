import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { ArrowUpRight } from 'lucide-react';
import { storeFor } from '../charts/pro/store/proStore';
import { useStoreVersion } from '../charts/pro/store/useStoreVersion';
import { ENABLED_MARKETS, deskMarketOf } from '../config/deskMarkets';
import { lang, tr } from '../i18n';
import { useNow } from '../shell/dzien';
import { useTheme } from '../theme';
import { intervalById } from '../charts/pro/core/time';
import type { Panel } from './Panels';
import { WORKSPACE_CHART_INTERVALS, type WorkspaceChartInterval } from '../state/workspaceSnapshot';

/**
 * Panel „Wykres” Stanowiska: świece wybranego rynku i interwału z Hyperliquid (ta sama seria magazynu co wykres W sesji:
 * historia REST, bieżąca świeca z WebSocketu). Lekki podgląd do układania kilku wykresów obok siebie; pełne narzędzia,
 * heatmapa i footprint są w W sesji (link „Otwórz w sesji”). Brak świec to „—” z powodem, nie pusta siatka.
 */

export const CHART_INTERVALS = WORKSPACE_CHART_INTERVALS;
export type ChartInterval = WorkspaceChartInterval;
export const isChartInterval = (v: unknown): v is ChartInterval => typeof v === 'string' && (CHART_INTERVALS as readonly string[]).includes(v);
const LABEL: Record<ChartInterval, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D' };

const LOCALE = lang === 'pl' ? 'pl-PL' : 'en-GB';
const fmtGodz = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDzien = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const fmtPelna = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtOdczyt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** Paleta wykresu „Głębia” (te same wartości co src/charts/pro/chart/theme.ts): obszar wykresu zawsze ciemny. */
/** Paleta panelu: w Zorzy jak wykres W sesji („Głębia”), w Opalu na papierze (tekst i siatka z tokenów jasnego motywu). */
const PALETA = {
  dark: { tlo: '#0f1114', tekst: '#9aa0a8', siatka: 'rgba(237, 238, 240, 0.05)', ramka: 'rgba(237, 238, 240, 0.12)', etykieta: '#2b2640', kupno: '#3280dd', sprzedaz: '#ca3829', cena: '#cfea5b' },
  light: { tlo: '#ffffff', tekst: '#474359', siatka: 'rgba(20, 18, 27, 0.06)', ramka: 'rgba(20, 18, 27, 0.14)', etykieta: '#14121b', kupno: '#1d5fb0', sprzedaz: '#b42318', cena: '#3a4500' },
} as const;

/** Najdłuższa przerwa między zmianami świec, po której odczyt przestaje być „LIVE” (aktywny rynek zmienia świecę co sekundy). */
export const LIVE_MAX_CISZA_MS = 90_000;

export type StanSwiec =
  | { kind: 'live'; px: number; at: number }
  | { kind: 'historia'; px: number; candleAt: number }
  | { kind: 'czekam' }
  | { kind: 'blad' };

/**
 * Znacznik panelu z samych danych, nie z zegara przeglądarki. LIVE tylko gdy: strumień otwarty, ostatnia świeca obejmuje
 * „teraz” (bieżący okres interwału) i świece zmieniły się w ciągu `LIVE_MAX_CISZA_MS`; godzina to chwila tej zmiany
 * (odczytu), nie bieżący zegar. Inaczej jawna HISTORIA z godziną ostatniej świecy.
 */
export function stanSwiec(a: {
  status: string; loadState: string; last: { t: number; c: number } | null; intervalMs: number; now: number; zmianaAt: number | null;
}): StanSwiec {
  if (!a.last) return a.loadState === 'error' ? { kind: 'blad' } : { kind: 'czekam' };
  const biezaca = a.last.t <= a.now && a.now < a.last.t + a.intervalMs;
  const swieza = a.zmianaAt !== null && a.now - a.zmianaAt <= LIVE_MAX_CISZA_MS;
  if (a.status === 'open' && a.loadState === 'ready' && biezaca && swieza) return { kind: 'live', px: a.last.c, at: a.zmianaAt! };
  return { kind: 'historia', px: a.last.c, candleAt: a.last.t };
}

const wysokosc = (weight: number | undefined) => (weight === 4 ? 260 : weight === 8 ? 500 : 360);

export function ChartPanel({ panel, change, onMarket }: { panel: Panel; change: (update: Partial<Panel>) => void; onMarket: (market: string) => void }) {
  const store = storeFor(panel.market);
  useEffect(() => { store.start(); }, [store]);
  useStoreVersion(store, 400);
  const now = useNow(1000);
  const interval: ChartInterval = isChartInterval(panel.settings?.interval) ? panel.settings.interval : '5m';
  const series = store.series(interval);
  useEffect(() => { if (series.loadState === 'idle' || series.loadState === 'error') void series.load(); }, [series]);
  const candles = series.candlesNow();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const swiece = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const wolumen = useRef<ISeriesApi<'Histogram'> | null>(null);
  const stan = useRef({ first: 0, len: 0 });
  // Chwila, w której zobaczyliśmy ostatnią zmianę świec (podpis ostatniej świecy); bez zmiany nie ma nowego odczytu
  const podpis = useRef('');
  const [zmianaAt, setZmianaAt] = useState<number | null>(null);
  const ostatniaSwieca = candles.at(-1) ?? null;
  const nowyPodpis = ostatniaSwieca ? `${ostatniaSwieca.t}|${ostatniaSwieca.o}|${ostatniaSwieca.h}|${ostatniaSwieca.l}|${ostatniaSwieca.c}|${ostatniaSwieca.v}|${candles.length}` : '';
  useEffect(() => {
    if (!nowyPodpis || nowyPodpis === podpis.current) return;
    podpis.current = nowyPodpis;
    setZmianaAt(Date.now());
  }, [nowyPodpis]);
  useEffect(() => {
    podpis.current = '';
    setZmianaAt(null);
  }, [store, interval]);

  const motyw = useTheme() === 'light' ? 'light' : 'dark';
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const KOLOR = PALETA[motyw];
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: KOLOR.tlo }, textColor: KOLOR.tekst, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: KOLOR.siatka }, horzLines: { color: KOLOR.siatka } },
      rightPriceScale: { borderColor: KOLOR.ramka, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: {
        borderColor: KOLOR.ramka,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        tickMarkFormatter: (t: number) => {
          const d = new Date(t * 1000);
          return d.getHours() === 0 && d.getMinutes() === 0 ? fmtDzien.format(d) : fmtGodz.format(d);
        },
      },
      localization: { locale: LOCALE, timeFormatter: (t: number) => fmtPelna.format(t * 1000), priceFormatter: (p: number) => store.fmtPx(p) },
      crosshair: { vertLine: { color: 'rgba(207, 234, 91, 0.5)', labelBackgroundColor: KOLOR.etykieta }, horzLine: { color: 'rgba(207, 234, 91, 0.5)', labelBackgroundColor: KOLOR.etykieta } },
    });
    swiece.current = c.addSeries(CandlestickSeries, {
      upColor: KOLOR.kupno, downColor: KOLOR.sprzedaz, borderUpColor: KOLOR.kupno, borderDownColor: KOLOR.sprzedaz,
      wickUpColor: KOLOR.kupno, wickDownColor: KOLOR.sprzedaz, priceLineColor: KOLOR.cena, priceLineWidth: 1,
    });
    wolumen.current = c.addSeries(HistogramSeries, { priceScaleId: 'wol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('wol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    stan.current = { first: 0, len: 0 };
    return () => {
      c.remove();
      chart.current = null;
      swiece.current = null;
      wolumen.current = null;
    };
  }, [store, interval, motyw]);

  useEffect(() => {
    const s = swiece.current;
    const v = wolumen.current;
    if (!s || !v || candles.length === 0) return;
    const bar = (i: number) => {
      const x = candles[i];
      return { time: Math.floor(x.t / 1000) as UTCTimestamp, open: x.o, high: x.h, low: x.l, close: x.c };
    };
    const vol = (i: number) => {
      const x = candles[i];
      return { time: Math.floor(x.t / 1000) as UTCTimestamp, value: x.v, color: x.c >= x.o ? 'rgba(50, 128, 221, 0.35)' : 'rgba(202, 56, 41, 0.4)' };
    };
    const prev = stan.current;
    const first = candles[0].t;
    if (prev.first === first && (candles.length === prev.len || candles.length === prev.len + 1) && prev.len > 0) {
      // Tylko ostatnie świece się zmieniły (bieżąca rośnie, nowa się otwiera)
      for (let i = Math.max(0, prev.len - 1); i < candles.length; i++) {
        s.update(bar(i));
        v.update(vol(i));
      }
    } else {
      s.setData(candles.map((_, i) => bar(i)));
      v.setData(candles.map((_, i) => vol(i)));
      if (prev.len === 0) chart.current?.timeScale().scrollToRealTime();
    }
    stan.current = { first, len: candles.length };
  });

  const odczyt = stanSwiec({
    status: store.status, loadState: series.loadState, last: ostatniaSwieca, intervalMs: intervalById(interval).ms, now, zmianaAt,
  });
  const rynek = deskMarketOf(panel.market);
  const sesja = `../?lang=${lang}#charts?m=${encodeURIComponent(panel.market)}&i=${interval}`;
  return (
    <div className="wb-chart" data-wb-chart={panel.market}>
      <div className="wb-chart-bar">
        <label className="wb-chart-market">
          <span className="sr-only">{tr('Rynek', 'Market')}</span>
          <select value={panel.market} onChange={(e) => onMarket(e.target.value)}>
            {ENABLED_MARKETS.map((m) => <option key={m.coin} value={m.coin}>{m.label}</option>)}
          </select>
        </label>
        <div role="radiogroup" aria-label={tr('Interwał', 'Timeframe')} className="wb-chart-iv">
          {CHART_INTERVALS.map((iv) => (
            <button key={iv} type="button" role="radio" aria-checked={iv === interval} onClick={() => change({ settings: { ...panel.settings, interval: iv } })}>
              {LABEL[iv]}
            </button>
          ))}
        </div>
        <p className="wb-chart-stan mono" aria-live="off">
          {odczyt.kind === 'live' ? (
            <><span className="wb-chart-live" title={tr('Ostatnia zmiana świec z Hyperliquid', 'Last candle change from Hyperliquid')}>LIVE</span> <span className="wb-chart-px">{store.fmtPx(odczyt.px)}</span> <span className="wb-muted">{fmtOdczyt.format(odczyt.at)}</span></>
          ) : odczyt.kind === 'historia' ? (
            <><span className="wb-chart-hist" title={tr('Brak świeżej świecy: ostatnia znana świeca, nie bieżąca cena', 'No fresh candle: last known candle, not the current price')}>{tr('HISTORIA', 'HISTORY')}</span> <span className="wb-chart-px wb-muted">{store.fmtPx(odczyt.px)}</span> <span className="wb-muted">{tr('świeca', 'candle')} {fmtPelna.format(odczyt.candleAt)}</span></>
          ) : odczyt.kind === 'blad' ? (
            <span className="wb-muted">{tr('— · Hyperliquid nie zwrócił świec', '— · Hyperliquid returned no candles')}</span>
          ) : (
            <span className="wb-muted">{tr('— · Wczytuję świece…', '— · Loading candles…')}</span>
          )}
        </p>
        <a className="wb-chart-open" href={sesja} title={tr('Pełny wykres: heatmapa, footprint, narzędzia', 'Full chart: heatmap, footprint, tools')}>
          {tr('W sesji', 'In session')} <ArrowUpRight aria-hidden size={14} />
        </a>
      </div>
      <div
        ref={box}
        className="wb-chart-plot"
        role="img"
        aria-label={tr(`Wykres świecowy ${rynek?.label ?? panel.market}, interwał ${LABEL[interval]}, Hyperliquid`, `Candlestick chart ${rynek?.label ?? panel.market}, ${LABEL[interval]} timeframe, Hyperliquid`)}
        style={{ height: wysokosc(panel.weight) }}
      />
    </div>
  );
}
