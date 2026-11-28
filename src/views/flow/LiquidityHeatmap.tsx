import React, { useEffect, useRef, useState } from 'react';
import { buildHeatLut } from '../../charts/orderflow/heatColor';
import { HEAT_CONTRAST, heatNorm, heatT } from '../../charts/pro/chart/liquidity';
import { LIQ_RAMP, MONO, PRO, rgba } from '../../charts/pro/chart/theme';
import { fmtHm } from '../../charts/pro/core/time';
import type { BookFrame } from '../../charts/pro/core/book';
import type { ProStore } from '../../charts/pro/store/proStore';
import { requestHistory } from '../../charts/pro/store/serverHistory';
import { tr } from '../../i18n';
import { Segmented } from '../../ui';
import { FRAME_MAX_MS, bestQuotes, bubbleRadius, frameAt, frameColumns, frameSpan, priceTicks, priceWindow, quantile, timeTicks } from './heatmapModel';

/**
 * Heatmapa płynności w czasie (Order Flow): arkusz zleceń z migawek `l2Book` jako tło (bliska agregacja zastępuje daleką
 * w swoim zakresie cen, jak na wykresie), linie najlepszego bidu i asku, bąble zleceń agresora (pole ∝ wartość, górne
 * 40% okna), linia ceny. Okno 5 min, 15 min albo 1 h kończy się na „teraz”; cena podąża za rynkiem, kółko myszy zmienia
 * skalę ceny. Okno wypełnia historia z serwera (jak wykres W sesji); luka w nagraniu zostaje ciemna.
 */

type Win = 5 | 15 | 60;
type Contrast = keyof typeof HEAT_CONTRAST;

const AXIS_W = 70;
const AXIS_H = 18;
const ROWS = { def: 60, min: 16, max: 400 };
/** Krycie dalekiej agregacji (tło) względem bliskiej — jak na wykresie. */
const FAR_ALPHA = 0.6;
/** Bąble: zlecenia od tego kwantyla wartości w oknie; skala pola od kwantyla REF_Q. */
const BUBBLE_Q = 0.6;
const REF_Q = 0.98;
/** Najczęściej tyle ms między przerysowaniami (magazyn odświeża co 300 ms). */
const DRAW_MS = 250;

let lutCache: { ramp: unknown; near: Uint32Array; far: Uint32Array } | null = null;
function luts(): { near: Uint32Array; far: Uint32Array } {
  if (lutCache?.ramp !== LIQ_RAMP) {
    lutCache = { ramp: LIQ_RAMP, near: buildHeatLut(LIQ_RAMP), far: buildHeatLut(LIQ_RAMP.map((s) => ({ ...s, alpha: s.alpha * FAR_ALPHA }))) };
  }
  return lutCache;
}

export const LiquidityHeatmap: React.FC<{ store: ProStore }> = ({ store }) => {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const lastDraw = useRef(0);
  const [win, setWin] = useState<Win>(15);
  const [rows, setRows] = useState(ROWS.def);
  const [contrast, setContrast] = useState<Contrast>('med');
  const [width, setWidth] = useState(0);
  /** Odroczone przerysowanie (zmiana w odstępie krótszym niż DRAW_MS) */
  const [later, setLater] = useState(0);
  const version = store.version;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // Historia z serwera na całe okno (taśma, zlecenia i arkusz sprzed otwarcia strony; z przekaźnikiem także ostatnie minuty)
  useEffect(() => {
    requestHistory(store, store.serverNow() - win * 60_000);
  }, [store, win]);

  // Kółko myszy nad heatmapą: skala ceny (bez przewijania strony)
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setRows((r) => Math.max(ROWS.min, Math.min(ROWS.max, Math.round(r * (e.deltaY > 0 ? 1.15 : 1 / 1.15)))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const now = Date.now();
    if (now - lastDraw.current < DRAW_MS) {
      const id = window.setTimeout(() => {
        lastDraw.current = 0;
        setLater((n) => n + 1);
      }, DRAW_MS);
      return () => window.clearTimeout(id);
    }
    lastDraw.current = now;
    const c = canvas.current;
    if (!c || width <= AXIS_W + 40) return;
    offscreen.current ??= document.createElement('canvas');
    draw(c, offscreen.current, store, { width, height: width < 640 ? 300 : 440, win, rows, contrast });
  }, [store, version, width, win, rows, contrast, later]);

  return (
    <section className="of-heatmap" aria-label={tr('Heatmapa płynności', 'Liquidity heatmap')}>
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <h3 className="text-sm font-semibold text-ink-1">{tr('Heatmapa płynności', 'Liquidity heatmap')}</h3>
        <Segmented<string>
          ariaLabel={tr('Okno czasu', 'Time window')}
          size="xs"
          value={String(win)}
          onChange={(v) => setWin(Number(v) as Win)}
          options={[
            { value: '5', label: '5 min' },
            { value: '15', label: '15 min' },
            { value: '60', label: '1 h' },
          ]}
        />
        <Segmented<Contrast>
          ariaLabel={tr('Kontrast', 'Contrast')}
          size="xs"
          value={contrast}
          onChange={setContrast}
          options={[
            { value: 'soft', label: tr('Miękki', 'Soft') },
            { value: 'med', label: tr('Średni', 'Medium') },
            { value: 'strong', label: tr('Mocny', 'Strong') },
          ]}
        />
        <span className="text-[11px] text-ink-3">
          {tr('Kółko myszy: skala ceny · bąble: zlecenia agresora (górne 40% wartości) · linie: najlepszy bid i ask', 'Mouse wheel: price scale · bubbles: aggressor orders (top 40% by value) · lines: best bid and ask')}
        </span>
      </div>
      <div ref={wrap} className="w-full">
        <canvas ref={canvas} data-of-heatmap role="img" aria-label={tr('Arkusz zleceń w czasie z transakcjami', 'Order book over time with trades')} />
      </div>
    </section>
  );
};

interface DrawOpts {
  width: number;
  height: number;
  win: Win;
  rows: number;
  contrast: Contrast;
}

function draw(c: HTMLCanvasElement, off: HTMLCanvasElement, store: ProStore, o: DrawOpts): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const { width: W, height: H } = o;
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  c.style.width = `${W}px`;
  c.style.height = `${H}px`;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PRO.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.font = `10px ${MONO}`;
  const PW = W - AXIS_W;
  const PH = H - AXIS_H;
  const now = store.serverNow();
  const t0 = now - o.win * 60_000;
  const near = store.book('near');
  const far = store.book('far');
  const nearFrames = near ? near.range(t0 - FRAME_MAX_MS, now) : [];
  const farFrames = far ? far.range(t0 - FRAME_MAX_MS, now) : [];
  const latest = nearFrames.at(-1) ?? null;
  const last = store.lastPrice();
  const q = latest ? bestQuotes(latest) : null;
  const center = last > 0 ? last : q && q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : Number.NaN;
  const step = latest?.step ?? (center > 0 ? store.tick(center) : Number.NaN);
  const pw = priceWindow(center, step, o.rows);
  if (!(pw.hi > pw.lo)) {
    ctx.fillStyle = PRO.axisText;
    ctx.fillText(tr('Czekam na migawki arkusza…', 'Waiting for order book snapshots…'), 12, 20);
    return;
  }
  const X = (t: number) => ((t - t0) / (now - t0)) * PW;
  const Y = (p: number) => ((pw.hi - p) / (pw.hi - pw.lo)) * PH;

  // Tło: arkusz jako obraz w pikselach CSS (daleka agregacja poza zakresem bliskiej migawki tej chwili — bliska ją zastępuje)
  const img = new ImageData(PW, PH);
  const px32 = new Uint32Array(img.data.buffer);
  const { near: lutNear, far: lutFar } = luts();
  const cfg = HEAT_CONTRAST[o.contrast];
  const paint = (frames: readonly BookFrame[], lut: Uint32Array, skip: ((f: BookFrame) => [number, number] | null) | null) => {
    if (frames.length === 0) return;
    const norm = heatNorm(frames, cfg.loQ);
    for (const { f, x0, x1 } of frameColumns(frames, t0, now, PW, now)) {
      const half = f.step / 2;
      const span = skip?.(f) ?? null;
      for (let i = 0; i < f.px.length; i++) {
        const p = f.px[i];
        if (p + half < pw.lo || p - half > pw.hi || (span && p >= span[0] && p <= span[1])) continue;
        const t = heatT(f.sz[i], norm, cfg.gamma);
        if (t <= 0.02) continue;
        const col = lut[Math.min(255, Math.round(t * 255))];
        const ya = Math.max(0, Math.round(Y(p + half)));
        const yb = Math.min(PH, Math.max(ya + 1, Math.round(Y(p - half))));
        for (let y = ya; y < yb; y++) px32.fill(col, y * PW + x0, y * PW + x1);
      }
    }
  };
  paint(farFrames, lutFar, (f) => {
    const n = frameAt(nearFrames, f.t);
    return n ? frameSpan(n) : null;
  });
  paint(nearFrames, lutNear, null);
  off.width = PW;
  off.height = PH;
  off.getContext('2d')?.putImageData(img, 0, 0);
  ctx.drawImage(off, 0, 0, PW, PH);

  // Czoło arkusza: najlepszy bid i ask w czasie
  ctx.lineWidth = 1;
  for (const { f, x0, x1 } of frameColumns(nearFrames, t0, now, PW, now)) {
    const b = bestQuotes(f);
    for (const [p, color] of [
      [b.bid, PRO.buyInk],
      [b.ask, PRO.sellInk],
    ] as const) {
      if (!(p >= pw.lo && p <= pw.hi)) continue;
      ctx.strokeStyle = rgba(color, 0.85);
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(p)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(p)) + 0.5);
      ctx.stroke();
    }
  }

  // Bąble zleceń agresora: górne 40% wartości okna, pole proporcjonalne do wartości
  const orders = store.orders.range(t0, now);
  const values = orders.map((x) => x.notional);
  const floor = quantile(values, BUBBLE_Q);
  const ref = quantile(values, REF_Q);
  for (const x of orders) {
    if (!(x.notional >= floor) || !(x.vwap >= pw.lo && x.vwap <= pw.hi)) continue;
    const r = bubbleRadius(x.notional, ref);
    const buy = x.side > 0;
    ctx.fillStyle = rgba(buy ? PRO.buy : PRO.sell, 0.45);
    ctx.strokeStyle = buy ? PRO.buyInk : PRO.sellInk;
    ctx.beginPath();
    ctx.arc(X(x.time), Y(x.vwap), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Cena: linia przerywana i etykieta na osi
  if (last >= pw.lo && last <= pw.hi) {
    const y = Math.round(Y(last)) + 0.5;
    ctx.strokeStyle = PRO.priceLine;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(PW, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Osie: cena po prawej, czas na dole
  ctx.fillStyle = PRO.bg;
  ctx.fillRect(PW, 0, AXIS_W, H);
  ctx.fillRect(0, PH, PW, AXIS_H);
  ctx.fillStyle = PRO.axisText;
  ctx.textBaseline = 'middle';
  for (const p of priceTicks(pw, step, PH)) ctx.fillText(store.fmtPx(p), PW + 6, Y(p));
  if (last >= pw.lo && last <= pw.hi) {
    ctx.fillStyle = PRO.priceLine;
    ctx.fillRect(PW, Y(last) - 7, AXIS_W, 14);
    ctx.fillStyle = PRO.bg;
    ctx.fillText(store.fmtPx(last), PW + 6, Y(last));
  }
  ctx.fillStyle = PRO.axisText;
  ctx.textBaseline = 'top';
  for (const t of timeTicks(t0, now)) {
    const x = X(t);
    if (x > 20 && x < PW - 20) ctx.fillText(fmtHm(t), x - 14, PH + 4);
  }
}
