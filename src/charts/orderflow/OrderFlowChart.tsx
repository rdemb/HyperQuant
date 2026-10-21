import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ChevronsRight, Layers as LayersIcon } from 'lucide-react';
import { useDesk } from '../../state/DeskContext';
import type { LevelStatus, OHLCVBar, ShaakuniState } from '../../types/trading';
import { Badge, BadgeTone, EmptyState } from '../../ui';
import { fmtVol } from './footprint';
import { HEAT_RAMP, sizeAtT } from './heatColor';
import { BookStatus, BubbleMode, FP_TICK, orderFlowStore } from './orderFlowStore';
import {
  C,
  ChartData,
  COMPACT_BELOW,
  Layers,
  Layout,
  LevelLine,
  OrderFlowRenderer,
  computeLayout,
  fmtAxisPrice,
  fmtSignedVol,
  lowerBoundBars,
  rgba,
} from './renderer';
import { Frame, bucketFor, xToTime, yToPrice } from './scales';

/**
 * Bohater Desku: wykres order flow BTC-PERP z realnych danych Hyperliquid —
 * heatmapa płynności arkusza L2, bąble transakcji agresorów, footprint, profil wolumenu,
 * CVD i Δ świecy. Wszystko od momentu otwarcia strony (historia arkusza nie jest publiczna).
 */

const STORE_KEY = 'hq.orderflow.v1';
/** Pełny pasek narzędzi potrzebuje ~860 px; węższy wykres → menu „Warstwy”. */
const TOOLBAR_MENU_BELOW = 900;
const MIN = 60_000;
/** Bieżący czas na 88% szerokości panelu (miejsce na bąble i etykiety). */
const RIGHT_PAD = 0.12;
const LIVE_ANIM_MS = 400;
const TF_LABEL: Record<number, string> = { 60: '1m', 300: '5m', 900: '15m', 3600: '1h', 14400: '4h' };
const STATUS_PL: Record<LevelStatus, string> = { Active: '', 'Sweep !': ' · sweep', Break: ' · przebity' };

const DEFAULT_LAYERS: Layers = { heat: true, bubbles: true, footprint: true, profile: true, levels: true, ob: true };
const LAYER_DEFS: { key: keyof Layers; label: string; title: string; swatch: React.ReactNode }[] = [
  {
    key: 'heat',
    label: 'Heatmapa',
    title: 'Heatmapa płynności: rozmiar zleceń w arkuszu L2 Hyperliquid (czas × cena)',
    swatch: <span className="w-3 h-2 rounded-sm" style={{ background: 'linear-gradient(90deg,#1e4a7a,#3fc6dd,#e0a045,#fff4dc)' }} />,
  },
  {
    key: 'bubbles',
    label: 'Bąble',
    title: 'Bąble transakcji agresorów (pole ∝ wolumen USD)',
    swatch: (
      <span className="flex -space-x-0.5">
        <span className="w-2 h-2 rounded-full bg-buy" />
        <span className="w-2 h-2 rounded-full bg-sell" />
      </span>
    ),
  },
  {
    key: 'footprint',
    label: 'Footprint',
    title: 'Footprint: sprzedaż | kupno agresora w kubełkach ceny (BTC), nierównowaga ≥ 3:1 podświetlona',
    swatch: <span className="font-mono text-[9px] leading-none text-ink-2">1|2</span>,
  },
  { key: 'profile', label: 'Profil', title: 'Profil wolumenu widocznego okna, POC i value area 70%', swatch: <span className="w-2.5 h-2 border-l-2 border-ink-2" /> },
  { key: 'levels', label: 'Poziomy', title: 'Poziomy HTF: PDH/PDL/D-EQ i PWH/PWL/W-EQ', swatch: <span className="w-3 h-0.5 bg-level" /> },
  { key: 'ob', label: 'OB', title: 'Świeże strefy Order Block (Shaakuni)', swatch: <span className="w-2.5 h-2 rounded-sm border border-zone bg-zone/20" /> },
];

const BUBBLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'auto' },
  { value: 'top2', label: 'top 2%' },
  { value: '25000', label: '≥ $25K' },
  { value: '50000', label: '≥ $50K' },
  { value: '100000', label: '≥ $100K' },
  { value: '250000', label: '≥ $250K' },
  { value: '1000000', label: '≥ $1M' },
];

interface Prefs {
  layers: Layers;
  contrast: number;
  bubbles: BubbleMode;
}

function loadPrefs(): Prefs {
  const def: Prefs = { layers: DEFAULT_LAYERS, contrast: 1, bubbles: 'auto' };
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      layers: { ...DEFAULT_LAYERS, ...(p.layers ?? {}) },
      contrast: typeof p.contrast === 'number' && p.contrast >= 0.5 && p.contrast <= 3 ? p.contrast : 1,
      bubbles: p.bubbles === 'auto' || p.bubbles === 'top2' || (typeof p.bubbles === 'number' && p.bubbles > 0) ? p.bubbles : 'auto',
    };
  } catch {
    return def;
  }
}

function savePrefs(p: Prefs): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    // Brak dostępu do storage — ustawienia tylko na tę sesję
  }
}

function hhmm(t: number, sec = false): string {
  const d = new Date(t);
  const s = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sec ? `${s}:${String(d.getSeconds()).padStart(2, '0')}` : s;
}

const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Okno czasu „auto”: zapis zajmuje ~60% widoku (2–90 min); reszta to kontekst świec sprzed zapisu. */
function defaultSpan(recordedMs: number): number {
  return clamp(recordedMs / 0.6, 2 * MIN, 90 * MIN);
}

function buildLevels(s: ShaakuniState): LevelLine[] {
  const out: LevelLine[] = [];
  const add = (price: number | null, label: string, color: string) => {
    if (price && Number.isFinite(price)) out.push({ price, label, color });
  };
  add(s.pdh, `PDH${STATUS_PL[s.pdhStatus]}`, C.level);
  add(s.pdl, `PDL${STATUS_PL[s.pdlStatus]}`, C.level);
  add(s.deq, 'D-EQ', rgba(C.level, 0.6));
  add(s.pwh, 'PWH', C.zone);
  add(s.pwl, 'PWL', C.zone);
  add(s.weq, 'W-EQ', rgba(C.zone, 0.6));
  return out;
}

interface ViewState {
  follow: boolean;
  autoSpan: boolean;
  autoPrice: boolean;
  spanMs: number;
  rightMs: number;
  pMid: number;
  pSpan: number;
  anim: null | { start: number; span: number; right: number; pMid: number; pSpan: number };
}

type DragMode = 'none' | 'pan' | 'priceScale' | 'timeScale' | 'pinch';

const BOOK_TONE: Record<BookStatus, BadgeTone> = { live: 'live', connecting: 'stale', reconnecting: 'stale', off: 'neutral' };
const BOOK_LABEL: Record<BookStatus, string> = { live: 'LIVE', connecting: 'ŁĄCZĘ', reconnecting: 'ŁĄCZĘ', off: 'PAUZA' };

export const OrderFlowChart: React.FC = () => {
  const { feed, shaakuni } = useDesk();
  const reduceMotion = useReducedMotion() ?? false;

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [live, setLive] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBar, setMenuBar] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [bookStatus, setBookStatus] = useState<BookStatus>(orderFlowStore.bookStatus);
  const [startedAt, setStartedAt] = useState<number | null>(orderFlowStore.startedAt);
  const [legend, setLegend] = useState<{ norm: number; contrast: number; thr: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<OrderFlowRenderer | null>(null);
  const sizeRef = useRef({ W: 0, H: 0, dpr: 1 });
  const layoutRef = useRef<Layout>(computeLayout(800, 500, true));
  const frameRef = useRef<Frame | null>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const viewRef = useRef<ViewState>({ follow: true, autoSpan: true, autoPrice: true, spanMs: 6 * MIN, rightMs: 0, pMid: 0, pSpan: 0, anim: null });
  const prefsRef = useRef(prefs);
  const reduceRef = useRef(reduceMotion);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDrawRef = useRef(0);
  const metaRef = useRef({ at: 0, sum: 0, max: 0, n: 0 });
  const legendRef = useRef<{ norm: number; contrast: number; thr: number } | null>(null);

  const tfMs = feed.timeframeSec * 1000;
  // Świece zastępcze (przed pierwszą synchronizacją REST) nie trafiają na wykres — tylko realne dane
  const realBars = feed.lastSyncOkAt !== null;
  const data = useMemo<ChartData>(
    () => ({
      bars: realBars ? feed.bars : [],
      tfMs,
      lastPrice: realBars ? feed.currentPrice : orderFlowStore.lastTradePx,
      levels: realBars ? buildLevels(shaakuni) : [],
      zones: realBars
        ? shaakuni.orderBlocks
            .filter((ob) => ob.state === 'fresh')
            .map((ob) => ({ t0: ob.createdTime, top: ob.top, bottom: ob.bottom, bull: ob.type === 'bull' }))
        : [],
    }),
    [feed.bars, realBars, tfMs, feed.currentPrice, shaakuni]
  );
  const dataRef = useRef(data);
  const tfLabelRef = useRef(TF_LABEL[feed.timeframeSec] ?? `${feed.timeframeSec}s`);
  tfLabelRef.current = TF_LABEL[feed.timeframeSec] ?? `${feed.timeframeSec}s`;

  // ───────── Rysowanie: rAF tylko gdy „brudno”, dane ≤ 10 klatek/s ─────────

  const computeFrame = useCallback((now: number): Frame => {
    const v = viewRef.current;
    const L = layoutRef.current;
    const d = dataRef.current;
    const st = orderFlowStore.startedAt;
    if (v.autoSpan) v.spanMs = defaultSpan(st !== null ? now - st : 0);
    const liveRight = now + v.spanMs * RIGHT_PAD;
    let span = v.spanMs;
    let right = v.follow ? liveRight : v.rightMs;
    // Automatyczny zakres ceny: świece w oknie + bieżąca cena, minimalny zakres ~0.28%
    let pMid = v.pMid;
    let pSpan = v.pSpan;
    if (v.autoPrice || !(pSpan > 0)) {
      let lo = Infinity;
      let hi = -Infinity;
      const bars = d.bars;
      for (let i = lowerBoundBars(bars, right - span - d.tfMs); i < bars.length && bars[i].time <= right; i++) {
        if (bars[i].low < lo) lo = bars[i].low;
        if (bars[i].high > hi) hi = bars[i].high;
      }
      // Bez świec i transakcji: środek arkusza; bez żadnych danych zakres pozostaje NaN (stan „czekam”)
      let last = d.lastPrice;
      if (!Number.isFinite(last) && orderFlowStore.lastBookSec >= 0) last = orderFlowStore.colMid[orderFlowStore.slotOf(orderFlowStore.lastBookSec)];
      if (Number.isFinite(last)) {
        lo = Math.min(lo, last);
        hi = Math.max(hi, last);
      }
      // Minimum ~0.4% ceny: pas arkusza (±20 poziomów po 10 USD) wypełnia widok
      const minSpan = Math.max(120, (Number.isFinite(last) ? last : (lo + hi) / 2) * 0.004);
      pMid = (lo + hi) / 2;
      pSpan = Math.max(minSpan, (hi - lo) * 1.16);
      if (v.autoPrice) {
        v.pMid = pMid;
        v.pSpan = pSpan;
      }
    }
    if (v.anim) {
      const k = easeOutQuint(Math.min(1, (performance.now() - v.anim.start) / LIVE_ANIM_MS));
      span = lerp(v.anim.span, span, k);
      right = lerp(v.anim.right, right, k);
      pMid = lerp(v.anim.pMid, pMid, k);
      pSpan = lerp(v.anim.pSpan, pSpan, k);
      if (k >= 1) v.anim = null;
    }
    return { t0: right - span, t1: right, x0: L.plotX0, x1: L.plotX1, pMin: pMid - pSpan / 2, pMax: pMid + pSpan / 2, y0: L.plotY0, y1: L.plotY1 };
  }, []);

  const updateTooltip = useCallback(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const h = hoverRef.current;
    const f = frameRef.current;
    const L = layoutRef.current;
    if (!h || !f || h.x < L.plotX0 || h.x > L.plotX1 || h.y < L.plotY0 || h.y > L.plotY1) {
      tip.style.visibility = 'hidden';
      return;
    }
    const d = dataRef.current;
    const t = xToTime(f, h.x);
    const p = yToPrice(f, h.y);
    const ct = Math.floor(t / d.tfMs) * d.tfMs;
    const bi = lowerBoundBars(d.bars, ct);
    const bar: OHLCVBar | undefined = d.bars[bi] && d.bars[bi].time === ct ? d.bars[bi] : undefined;
    const bucket = bucketFor(f.pMax - f.pMin, L.plotY1 - L.plotY0, 13, FP_TICK);
    const lo = Math.floor(p / bucket) * bucket;
    const c = orderFlowStore.candleAt(ct);
    let buy = 0;
    let sell = 0;
    if (c) {
      const k = bucket / FP_TICK;
      const r = Math.floor(lo / FP_TICK);
      for (let i = r; i < r + k; i++) {
        const cell = c.cells.get(i);
        if (cell) {
          buy += cell.buy;
          sell += cell.sell;
        }
      }
    }
    const book = orderFlowStore.bookAt(Math.floor(t / 1000), p);
    const n = (v: number) => fmtAxisPrice(v, 1);
    const rows: string[] = [];
    rows.push(`<div class="text-ink-3">${hhmm(t, true)} · świeca ${hhmm(ct)} (${tfLabelRef.current})</div>`);
    rows.push(
      bar
        ? `<div>O <b>${n(bar.open)}</b> H <b>${n(bar.high)}</b> L <b>${n(bar.low)}</b> C <b>${n(bar.close)}</b></div>`
        : '<div class="text-ink-3">Świeca: —</div>'
    );
    rows.push(
      c
        ? `<div><span class="text-ink-3">${fmtAxisPrice(lo, 1)}–${fmtAxisPrice(lo + bucket, 1)}</span> kupno <b class="text-buy-ink">${fmtVol(buy)}</b> · sprzedaż <b class="text-sell-ink">${fmtVol(sell)}</b> · Δ <b>${fmtSignedVol(buy - sell)}</b> BTC</div>`
        : '<div class="text-ink-3">Footprint: — (przed startem zapisu)</div>'
    );
    rows.push(
      book
        ? `<div><span class="text-ink-3">Arkusz ${n(book.px)}</span> <b>${fmtVol(book.sz)} BTC</b> ${book.side === 'bid' ? 'bid ▼' : 'ask ▲'}</div>`
        : '<div class="text-ink-3">Arkusz: — (brak zapisu w tej sekundzie)</div>'
    );
    tip.innerHTML = rows.join('');
    tip.style.maxWidth = `${Math.max(160, L.plotX1 - 8)}px`;
    tip.style.whiteSpace = L.compact ? 'normal' : 'nowrap';
    tip.style.visibility = 'visible';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = h.x + 14;
    if (x + tw > L.plotX1 - 4) x = h.x - tw - 14;
    x = Math.min(Math.max(4, x), Math.max(4, L.plotX1 - tw - 4));
    let y = h.y + 14;
    if (y + th > L.plotY1 - 4) y = h.y - th - 14;
    tip.style.transform = `translate(${x}px, ${Math.max(4, y)}px)`;
  }, []);

  const scheduleLaterRef = useRef<(ms: number) => void>(() => {});

  const drawNow = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const r = rendererRef.current;
    const { W, H, dpr } = sizeRef.current;
    if (!canvas || !r || W === 0 || H === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const now = orderFlowStore.nowMs();
    const f = computeFrame(now);
    if (!Number.isFinite(f.pMin) || !Number.isFinite(f.pMax)) {
      // Brak jakichkolwiek realnych danych — pusty panel zamiast wymyślonej skali
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      setWaiting(true);
      lastDrawRef.current = performance.now();
      return;
    }
    setWaiting(false);
    frameRef.current = f;
    const p = prefsRef.current;
    r.heat.setContrast(p.contrast);
    const thr = orderFlowStore.bubbleThreshold(p.bubbles, now);
    const animating = r.draw(ctx, dpr, layoutRef.current, f, dataRef.current, orderFlowStore, {
      layers: p.layers,
      bubbleThr: thr,
      nowWall: Date.now(),
      reduceMotion: reduceRef.current,
      hover: hoverRef.current,
      startedAt: orderFlowStore.startedAt,
    });
    lastDrawRef.current = performance.now();
    updateTooltip();

    // Rzadkie synchronizacje ze stanem Reacta (status, start zapisu, legenda) + opis dostępności
    const m = metaRef.current;
    m.sum += r.lastDrawMs;
    m.n++;
    if (r.lastDrawMs > m.max) m.max = r.lastDrawMs;
    if (lastDrawRef.current - m.at > 1000) {
      m.at = lastDrawRef.current;
      setBookStatus(orderFlowStore.bookStatus);
      setStartedAt(orderFlowStore.startedAt);
      const lg = { norm: r.heat.normLog, contrast: p.contrast, thr };
      const prev = legendRef.current;
      if (!prev || Math.abs(prev.norm - lg.norm) > 1e-6 || prev.contrast !== lg.contrast || Math.abs(prev.thr - lg.thr) / lg.thr > 0.05) {
        legendRef.current = lg;
        setLegend(lg);
      }
      const d = dataRef.current;
      const on = LAYER_DEFS.filter((l) => p.layers[l.key]).map((l) => l.label.toLowerCase());
      const st = orderFlowStore.startedAt;
      canvas.setAttribute(
        'aria-label',
        `Order flow BTC-PERP ${tfLabelRef.current}: cena ${Number.isFinite(d.lastPrice) ? fmtAxisPrice(d.lastPrice, 1) : 'brak'}, zakres ${fmtAxisPrice(
          f.pMin,
          1
        )}–${fmtAxisPrice(f.pMax, 1)}, okno ${Math.round((f.t1 - f.t0) / MIN)} min, warstwy: ${on.join(', ') || 'brak'}. ${
          st !== null ? `Zapis od ${hhmm(st)}.` : 'Zapis jeszcze nie ruszył.'
        }`
      );
      canvas.dataset.drawMs = (m.sum / Math.max(1, m.n)).toFixed(2);
      canvas.dataset.drawMax = m.max.toFixed(2);
      m.sum = 0;
      m.n = 0;
      m.max = 0;
    }

    const v = viewRef.current;
    if (animating || v.anim) {
      rafRef.current = requestAnimationFrame(drawNow);
    } else if (v.follow) {
      // Upływ czasu przesuwa widok — kolejna klatka, gdy minie ~1 px (100 ms … 1 s)
      scheduleLaterRef.current(clamp((f.t1 - f.t0) / Math.max(1, f.x1 - f.x0), 100, 1000));
    }
  }, [computeFrame, updateTooltip]);

  /** Prośba o klatkę: interakcja natychmiast, dane dławione do 10/s. */
  const requestDraw = useCallback(
    (immediate: boolean) => {
      if (rafRef.current) return;
      const since = performance.now() - lastDrawRef.current;
      if (immediate || since >= 100) {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        rafRef.current = requestAnimationFrame(drawNow);
      } else if (timerRef.current === null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          requestDraw(true);
        }, 100 - since);
      }
    },
    [drawNow]
  );

  useEffect(() => {
    scheduleLaterRef.current = (ms: number) => {
      if (timerRef.current !== null) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        requestDraw(true);
      }, ms);
    };
  }, [requestDraw]);

  // ───────── Montaż: renderer, rozmiar, magazyn, WS arkusza, widoczność karty ─────────

  useLayoutEffect(() => {
    if (!rendererRef.current) rendererRef.current = new OrderFlowRenderer(orderFlowStore);
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const measure = (w: number, h: number) => {
      const W = Math.round(w);
      const H = Math.round(h);
      const dpr = Math.min(window.devicePixelRatio || 1, coarse || W < COMPACT_BELOW ? 1.5 : 2);
      const s = sizeRef.current;
      if (s.W === W && s.H === H && s.dpr === dpr) return;
      sizeRef.current = { W, H, dpr };
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      layoutRef.current = computeLayout(W, H, prefsRef.current.layers.profile);
      setMenuBar(W > 0 && W < TOOLBAR_MENU_BELOW);
      requestDraw(true);
    };
    const r = el.getBoundingClientRect();
    measure(r.width, r.height);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [requestDraw]);

  useEffect(() => {
    dataRef.current = data;
    requestDraw(false);
  }, [data, requestDraw]);

  useEffect(() => {
    orderFlowStore.setTimeframe(feed.timeframeSec);
  }, [feed.timeframeSec]);

  useEffect(() => orderFlowStore.subscribe(() => requestDraw(false)), [requestDraw]);

  // WS arkusza i rysowanie tylko przy widocznej karcie i aktywnym strumieniu
  useEffect(() => {
    let stop: (() => void) | null = null;
    const update = () => {
      const visible = document.visibilityState !== 'hidden';
      if (visible && feed.isStreaming && !stop) stop = orderFlowStore.startBook();
      else if ((!visible || !feed.isStreaming) && stop) {
        stop();
        stop = null;
      }
      if (visible) requestDraw(true);
      else {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setBookStatus(orderFlowStore.bookStatus);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      if (stop) stop();
    };
  }, [feed.isStreaming, requestDraw]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    []
  );

  useEffect(() => {
    reduceRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => {
    prefsRef.current = prefs;
    savePrefs(prefs);
    const { W, H } = sizeRef.current;
    if (W > 0) layoutRef.current = computeLayout(W, H, prefs.layers.profile);
    requestDraw(true);
  }, [prefs, requestDraw]);

  // ───────── Widok: przesuwanie, zoom, powrót „Na żywo” ─────────

  const setFollow = useCallback((v: boolean) => {
    viewRef.current.follow = v;
    setLive(v);
  }, []);

  /** Odczepia widok od prawej krawędzi (zachowuje bieżące okno). */
  const detach = useCallback(() => {
    const v = viewRef.current;
    const f = frameRef.current;
    if (!f) return;
    v.anim = null;
    if (v.follow) {
      v.rightMs = f.t1;
      setFollow(false);
    }
    v.spanMs = f.t1 - f.t0;
  }, [setFollow]);

  const detachPrice = useCallback(() => {
    const v = viewRef.current;
    const f = frameRef.current;
    if (!f || !v.autoPrice) return;
    v.autoPrice = false;
    v.pMid = (f.pMin + f.pMax) / 2;
    v.pSpan = f.pMax - f.pMin;
    setLive(false);
  }, []);

  const clampView = useCallback(() => {
    const v = viewRef.current;
    const now = orderFlowStore.nowMs();
    v.spanMs = clamp(v.spanMs, 30_000, 3 * 24 * 3600_000);
    if (!v.follow) {
      const bars = dataRef.current.bars;
      const first = bars.length ? bars[0].time : now - v.spanMs;
      v.rightMs = clamp(v.rightMs, first + v.spanMs * 0.3, now + v.spanMs * 0.5);
      // Powrót do krawędzi = ponowne przyklejenie do „na żywo”
      if (v.autoPrice && v.rightMs >= now + v.spanMs * RIGHT_PAD - 1000) setFollow(true);
    }
    const ref = Number.isFinite(dataRef.current.lastPrice) ? dataRef.current.lastPrice : v.pMid;
    if (!v.autoPrice) v.pSpan = clamp(v.pSpan, 20, Math.max(100, ref * 0.5));
  }, [setFollow]);

  /** „Na żywo” (animowane 400 ms ease-out-quint) lub pełny reset (z oknem auto). */
  const goLive = useCallback(
    (full: boolean) => {
      const v = viewRef.current;
      const f = frameRef.current;
      if (f && !reduceRef.current) {
        v.anim = { start: performance.now(), span: f.t1 - f.t0, right: f.t1, pMid: (f.pMin + f.pMax) / 2, pSpan: f.pMax - f.pMin };
      }
      v.follow = true;
      v.autoPrice = true;
      if (full) v.autoSpan = true;
      setLive(true);
      requestDraw(true);
    },
    [requestDraw]
  );

  const zoomTime = useCallback(
    (factor: number, anchorX: number | null) => {
      const v = viewRef.current;
      const f = frameRef.current;
      if (!f) return;
      v.autoSpan = false;
      v.anim = null;
      const span = f.t1 - f.t0;
      const next = clamp(span * factor, 30_000, 3 * 24 * 3600_000);
      if (!v.follow && anchorX !== null) {
        const t = xToTime(f, anchorX);
        v.rightMs = t + (f.t1 - t) * (next / span);
      }
      v.spanMs = next;
      clampView();
      requestDraw(true);
    },
    [clampView, requestDraw]
  );

  const zoomPrice = useCallback(
    (factor: number, anchorY: number) => {
      const v = viewRef.current;
      const f = frameRef.current;
      if (!f) return;
      detachPrice();
      const p = yToPrice(f, anchorY);
      const next = v.pSpan * factor;
      v.pMid = p + (v.pMid - p) * (next / v.pSpan);
      v.pSpan = next;
      clampView();
      requestDraw(true);
    },
    [clampView, detachPrice, requestDraw]
  );

  const panBy = useCallback(
    (dxPx: number) => {
      const f = frameRef.current;
      if (!f) return;
      detach();
      const v = viewRef.current;
      v.rightMs -= dxPx * ((f.t1 - f.t0) / (f.x1 - f.x0));
      clampView();
      requestDraw(true);
    },
    [clampView, detach, requestDraw]
  );

  // Kółko: natywny listener { passive: false } (React rejestruje wheel pasywnie)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const raw = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 16 : 1);
      const factor = Math.exp(clamp(raw, -300, 300) * 0.0015);
      const L = layoutRef.current;
      if (e.shiftKey || e.ctrlKey || (x >= L.plotX1 && y < L.plotY1)) zoomPrice(factor, clamp(y, L.plotY0, L.plotY1));
      else zoomTime(factor, x <= L.plotX1 ? x : null);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomPrice, zoomTime]);

  // ───────── Wskaźnik: mysz, dotyk (pan, szczypanie), rysik ─────────

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef({ mode: 'none' as DragMode, x: 0, y: 0, right: 0, span: 0, pMid: 0, pSpan: 0, moved: false, vertical: false, dist: 1, lastTap: 0 });

  const localXY = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pinchDist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const f = frameRef.current;
    if (!f) return;
    const v = viewRef.current;
    const d = drag.current;
    if (pointers.current.size === 2) {
      detach();
      d.mode = 'pinch';
      d.dist = Math.max(1, pinchDist());
      d.span = v.spanMs;
      hoverRef.current = null;
      requestDraw(true);
      return;
    }
    const { x, y } = localXY(e);
    const L = layoutRef.current;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved = false;
    d.vertical = false;
    d.right = v.follow ? f.t1 : v.rightMs;
    d.span = f.t1 - f.t0;
    d.pMid = (f.pMin + f.pMax) / 2;
    d.pSpan = f.pMax - f.pMin;
    if (x >= L.plotX1 && y < L.plotY1) d.mode = 'priceScale';
    else if (y >= L.timeY0) d.mode = 'timeScale';
    else d.mode = 'pan';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    const v = viewRef.current;
    const f = frameRef.current;
    const L = layoutRef.current;
    if (!f) return;
    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) return;
      v.spanMs = d.span / Math.max(0.1, pinchDist() / d.dist);
      v.autoSpan = false;
      clampView();
      requestDraw(true);
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode !== 'none' && Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.mode === 'pan' && d.moved) {
      const msPerPx = d.span / (f.x1 - f.x0);
      if (v.follow) {
        v.rightMs = d.right;
        setFollow(false);
      }
      v.anim = null;
      v.autoSpan = false;
      v.spanMs = d.span;
      v.rightMs = d.right - dx * msPerPx;
      // Pion: dopiero po wyraźnym ruchu (> 6 px) — mniej przypadkowego odczepiania ceny
      if (!d.vertical && Math.abs(dy) > 6) {
        d.vertical = true;
        detachPrice();
        d.pMid = v.pMid;
        d.y = e.clientY;
      }
      if (d.vertical) v.pMid = d.pMid + (e.clientY - d.y) * (v.pSpan / (L.plotY1 - L.plotY0));
      clampView();
      hoverRef.current = null;
      requestDraw(true);
      return;
    }
    if (d.mode === 'priceScale') {
      detachPrice();
      v.pSpan = d.pSpan * Math.exp(dy * 0.006);
      v.pMid = d.pMid;
      clampView();
      requestDraw(true);
      return;
    }
    if (d.mode === 'timeScale') {
      v.autoSpan = false;
      v.anim = null;
      v.spanMs = d.span * Math.exp(-dx * 0.006);
      clampView();
      requestDraw(true);
      return;
    }
    // Bez wciśnięcia: crosshair (mysz/rysik) i kursor zależny od strefy
    if (e.pointerType !== 'touch') {
      const { x, y } = localXY(e);
      canvas.style.cursor = x >= L.plotX1 && y < L.plotY1 ? 'ns-resize' : y >= L.timeY0 ? 'ew-resize' : 'crosshair';
      hoverRef.current = { x, y };
      requestDraw(true);
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // wskaźnik nie był przechwycony
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    endPointer(e);
    const d = drag.current;
    if (d.mode === 'pinch') {
      if (pointers.current.size === 0) d.mode = 'none';
      return;
    }
    const mode = d.mode;
    d.mode = 'none';
    // Dotyk: stuknięcie = crosshair z tooltipem; dwa stuknięcia = reset
    if (e.pointerType !== 'mouse' && mode === 'pan' && !d.moved) {
      const now = performance.now();
      if (now - d.lastTap < 320) {
        d.lastTap = 0;
        hoverRef.current = null;
        goLive(true);
      } else {
        d.lastTap = now;
        hoverRef.current = localXY(e);
        requestDraw(true);
      }
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    endPointer(e);
    if (pointers.current.size === 0) drag.current.mode = 'none';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const L = layoutRef.current;
    const w = L.plotX1 - L.plotX0;
    if (e.key === 'ArrowLeft') panBy(w * 0.15);
    else if (e.key === 'ArrowRight') panBy(-w * 0.15);
    else if (e.key === '+' || e.key === '=') zoomTime(0.8, null);
    else if (e.key === '-' || e.key === '_') zoomTime(1.25, null);
    else if (e.key === '0') goLive(true);
    else return;
    e.preventDefault();
  };

  // ───────── UI ─────────

  const setLayer = (key: keyof Layers) => setPrefs((p) => ({ ...p, layers: { ...p.layers, [key]: !p.layers[key] } }));
  const setContrast = (v: number) => setPrefs((p) => ({ ...p, contrast: v }));
  const setBubbles = (v: string) => setPrefs((p) => ({ ...p, bubbles: v === 'auto' || v === 'top2' ? v : Number(v) }));

  // Menu „Warstwy” (< 640 px): Escape i klik poza zamykają
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest('[data-of-menu],[data-of-menu-toggle]')) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

  const streaming = feed.isStreaming;
  const status: BookStatus = streaming ? bookStatus : 'off';
  const since = startedAt !== null ? hhmm(startedAt) : null;
  const L = layoutRef.current;

  const contrastInput = (
    <label className="flex items-center gap-2 text-[11px] text-ink-3">
      <span className={menuBar ? 'w-14' : 'hidden xl:inline'}>Kontrast</span>
      <input
        type="range"
        min={0.5}
        max={3}
        step={0.1}
        value={prefs.contrast}
        onChange={(e) => setContrast(Number(e.target.value))}
        aria-label="Kontrast heatmapy"
        title={`Kontrast heatmapy: ${prefs.contrast.toFixed(1)}× (1 = auto, percentyl 99 w widocznym oknie)`}
        className={`accent-accent ${menuBar ? 'flex-1 h-11' : 'w-20 h-8'}`}
      />
    </label>
  );

  const bubbleSelect = (
    <label className="flex items-center gap-2 text-[11px] text-ink-3">
      <span className={menuBar ? 'w-14' : 'hidden xl:inline'}>Bąble</span>
      <select
        value={String(prefs.bubbles)}
        onChange={(e) => setBubbles(e.target.value)}
        aria-label="Próg bąbli transakcji"
        title="Minimalny wolumen bąbla (transakcje agresorów zsumowane na sekundę, kubełek 10 USD i stronę). Auto = top 2% lub ≥ $50K"
        className={`bg-page border border-line rounded-md px-1.5 text-[11px] text-ink-1 font-mono ${menuBar ? 'h-11 flex-1' : 'h-7'}`}
      >
        {BUBBLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const legendTicks = legend && legend.norm > 0 ? [0.5, 1].map((t) => sizeAtT(t, legend.norm, legend.contrast)) : null;

  return (
    <div className="relative w-full h-full min-h-[320px] flex flex-col bg-surface-1 border border-line-strong rounded-xl overflow-hidden select-none">
      {/* Pasek narzędzi: jedna linia; < 640 px zwija się do menu „Warstwy” */}
      <div className="flex items-center gap-2 px-2 sm:px-3 py-1 border-b border-line min-h-11">
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            tone={BOOK_TONE[status]}
            testId="orderflow-status"
            title={
              status === 'live'
                ? 'Arkusz L2 i transakcje Hyperliquid na żywo (WebSocket)'
                : status === 'off'
                ? 'Strumień wstrzymany lub karta ukryta'
                : 'Łączenie ze strumieniem arkusza Hyperliquid…'
            }
          >
            {BOOK_LABEL[status]}
          </Badge>
          <Badge tone="model" title="Profil i Δ dla świec sprzed startu zapisu: estymata BVC ze świecy (MODEL), nie pomiar">
            MODEL
          </Badge>
        </div>
        <span
          className="text-[11px] text-ink-3 font-mono tabular-nums whitespace-nowrap truncate"
          title="Heatmapa, bąble i footprint istnieją od otwarcia strony — historia arkusza nie jest dostępna w publicznym API"
        >
          {since ? `zapis od ${since}` : 'czekam na dane'}
        </span>

        {menuBar ? (
          <button
            type="button"
            data-of-menu-toggle
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((o) => !o)}
            className={`ml-auto shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-medium border transition-colors duration-150 ${
              menuOpen ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-2 border-line hover:text-ink-1'
            }`}
          >
            <LayersIcon className="w-4 h-4" aria-hidden="true" />
            Warstwy
          </button>
        ) : (
          <div className="ml-auto flex items-center gap-1 min-w-0">
            <div role="group" aria-label="Warstwy wykresu" className="flex items-center gap-0.5">
              {LAYER_DEFS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  aria-pressed={prefs.layers[l.key]}
                  onClick={() => setLayer(l.key)}
                  title={l.title}
                  className={`inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-[11px] font-medium whitespace-nowrap border transition-colors duration-150 ${
                    prefs.layers[l.key] ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-3 border-transparent hover:text-ink-1 hover:bg-surface-2'
                  }`}
                >
                  <span className={`inline-flex items-center ${prefs.layers[l.key] ? '' : 'opacity-40'}`} aria-hidden="true">
                    {l.swatch}
                  </span>
                  {l.label}
                </button>
              ))}
            </div>
            <span className="w-px h-5 bg-line mx-1" aria-hidden="true" />
            {contrastInput}
            {bubbleSelect}
          </div>
        )}
      </div>

      <div ref={wrapRef} className="relative flex-1 min-h-0">
        <canvas
          ref={canvasRef}
          role="img"
          tabIndex={0}
          aria-label="Order flow BTC-PERP: heatmapa arkusza, bąble transakcji, footprint i profil wolumenu"
          data-testid="orderflow-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={(e) => {
            if (e.pointerType !== 'touch') {
              hoverRef.current = null;
              requestDraw(true);
            }
          }}
          onDoubleClick={() => goLive(true)}
          onKeyDown={onKeyDown}
          title="Przeciągnij: przesuwanie · kółko: zoom czasu · Shift/Ctrl+kółko lub oś cen: zoom ceny · dwuklik lub 0: reset · ←/→ i +/−: klawiatura"
          className="absolute inset-0 block w-full h-full cursor-crosshair touch-none focus-visible:outline-2 focus-visible:outline-accent"
        />

        {waiting && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <EmptyState
              title="Czekam na dane Hyperliquid…"
              detail="Heatmapa, bąble i footprint pojawią się po pierwszych realnych snapshotach arkusza i transakcjach."
            />
          </div>
        )}

        {/* Tooltip crosshaira (aktualizowany imperatywnie w pętli rysowania) */}
        <div
          ref={tipRef}
          className="absolute left-0 top-0 z-20 pointer-events-none rounded-md bg-surface-3/95 border border-line-strong px-2 py-1.5 font-mono tabular-nums text-[11px] leading-snug text-ink-1 shadow-xl whitespace-nowrap [&_b]:font-semibold"
          style={{ visibility: 'hidden' }}
          role="status"
          aria-live="off"
        />

        {/* Powrót do bieżącej ceny */}
        {!live && (
          <button
            type="button"
            onClick={() => goLive(false)}
            aria-label="Wróć do bieżącej ceny (na żywo)"
            className="absolute z-20 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-medium bg-surface-3 text-ink-1 border border-line-strong hover:bg-surface-2 shadow-lg min-h-8"
            style={{ right: L.W - L.plotX1 + 8, top: Math.max(8, L.plotY1 - 40) }}
          >
            Na żywo
            <ChevronsRight className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
          </button>
        )}

        {/* Menu „Warstwy” (telefon) */}
        {menuOpen && menuBar && (
          <div
            data-of-menu
            role="menu"
            aria-label="Warstwy i ustawienia wykresu order flow"
            className="absolute top-2 right-2 z-30 w-[min(300px,calc(100%-16px))] max-h-[calc(100%-16px)] overflow-y-auto bg-surface-2 border border-line-strong rounded-xl p-1.5 shadow-2xl"
          >
            {LAYER_DEFS.map((l) => (
              <button
                key={l.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={prefs.layers[l.key]}
                onClick={() => setLayer(l.key)}
                className="w-full min-h-11 flex items-center gap-2.5 px-3 rounded-lg text-sm text-ink-1 hover:bg-surface-3"
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center ${prefs.layers[l.key] ? 'bg-accent border-accent' : 'border-line-strong'}`}
                  aria-hidden="true"
                >
                  {prefs.layers[l.key] && <span className="w-2 h-1 border-l-2 border-b-2 border-page -rotate-45 -mt-0.5" />}
                </span>
                <span className="inline-flex items-center w-5 justify-center" aria-hidden="true">
                  {l.swatch}
                </span>
                {l.label}
              </button>
            ))}
            <div className="mt-1.5 pt-1.5 border-t border-line px-3 flex flex-col gap-1">
              {contrastInput}
              {bubbleSelect}
            </div>
            <p className="px-3 py-2 text-[11px] leading-snug text-ink-3">
              Heatmapa, bąble i footprint {since ? `od ${since}` : 'od otwarcia strony'} — historia arkusza nie jest dostępna w publicznym API. Profil i Δ
              starszych świec: MODEL (BVC).
            </p>
          </div>
        )}
      </div>

      {/* Legenda (stopka karty, nie zasłania danych): skala arkusza, bąble, footprint, profil, zakres danych */}
      <div
        className="flex items-center gap-x-3.5 px-2 sm:px-3 h-7 shrink-0 border-t border-line font-mono text-[10px] text-ink-2 whitespace-nowrap overflow-x-auto [scrollbar-width:none]"
        aria-label="Legenda wykresu order flow"
      >
        {prefs.layers.heat && (
          <span
            className="flex items-center gap-1.5"
            title={legendTicks ? `Skala log1p, nasycenie przy p99 widocznego okna; środek skali ≈ ${fmtVol(legendTicks[0])} BTC` : undefined}
          >
            <span className="text-ink-3">L2</span>
            <span className="tabular-nums text-ink-3">0</span>
            <span
              className="w-20 h-1.5 rounded-sm"
              style={{ background: `linear-gradient(90deg, ${HEAT_RAMP.map((st) => `${st.color} ${Math.round(st.t * 100)}%`).join(', ')})` }}
              aria-hidden="true"
            />
            <span className="tabular-nums">{legendTicks ? `≥${fmtVol(legendTicks[1])} BTC` : 'czekam…'}</span>
          </span>
        )}
        {prefs.layers.bubbles && legend && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-buy" aria-hidden="true" />
            <span className="w-2 h-2 rounded-full bg-sell" aria-hidden="true" />
            <span>
              ≥${fmtUsdShort(legend.thr)}
              <span className="text-ink-3">{prefs.bubbles === 'top2' ? ' top 2%' : prefs.bubbles === 'auto' ? ' auto' : ''} · pole ∝ USD</span>
            </span>
          </span>
        )}
        {prefs.layers.footprint && (
          <span className="flex items-center gap-1" title="Footprint: lewa kolumna = sprzedaż agresora (bid), prawa = kupno agresora (ask), BTC">
            <span className="w-2.5 h-2.5 rounded-sm bg-sell/25 border border-sell/50" aria-hidden="true" />
            <span className="w-2.5 h-2.5 rounded-sm bg-buy/25 border border-buy/50" aria-hidden="true" />
            <span>
              sprz.|kup. BTC <span className="text-ink-3">· ≥3:1 · ▢ POC</span>
            </span>
          </span>
        )}
        {prefs.layers.profile && (
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2 rounded-sm bg-buy" aria-hidden="true" />
            <span>LIVE</span>
            <span className="w-2.5 h-2 rounded-sm bg-buy/40" aria-hidden="true" />
            <span>MODEL</span>
          </span>
        )}
        <span className="text-ink-3" title="Heatmapa, bąble i footprint istnieją od otwarcia strony; profil i Δ starszych świec to estymata BVC (MODEL)">
          {since ? `od ${since}` : 'od otwarcia strony'} · brak historii arkusza w publicznym API
        </span>
      </div>
    </div>
  );
};

function fmtUsdShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return `${Math.round(v)}`;
}

export default OrderFlowChart;
