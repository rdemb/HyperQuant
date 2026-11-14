import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { LiqMap } from '../../utils/liqMap';
import { tr } from '../../i18n';
import { fmtCompact, fmtPrice } from '../../ui';
import { useTheme } from '../../theme';

/**
 * Krajobraz płynności: prawdziwa mapa likwidacji skanera (kubełki co stepUsd) narysowana jako teren w perspektywie.
 * Pierwszy rząd = mapa wygładzona jądrem 80 USD, kolejne rzędy coraz szerzej (do 1400 USD): ta sama mapa w wielu skalach.
 * Wysokość = gęstość^0,55 (pierwiastek wyrównuje skrajne klastry). Canvas 2D zamiast three.js: ~4 KB zamiast ~600 KB.
 * Dane przychodzą z sensem: rzędy dorysowują się od przodu do tyłu (400 ms), bez ruchu przy prefers-reduced-motion.
 */
const ROWS = 26;
const BW_FRONT = 80;
const BW_BACK = 1400;
const VIEW_H = 480;
const HOR = 56;
const FRONT = 452;

interface Geo {
  x: (px: number, t: number) => number;
  base: (t: number) => number;
  amp: (t: number) => number;
}

function hex(c: string): [number, number, number] {
  const m = c.trim().replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

const LiquidityTerrain: React.FC<{ map: LiqMap; price: number }> = ({ map, price }) => {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(1200);

  // Siatka i gęstości liczone raz na mapę
  const field = useMemo(() => {
    const buckets = [...map.longs, ...map.shorts].sort((a, b) => a.px - b.px);
    const lo = Math.max(buckets[0].px, price * 0.88);
    const hi = Math.min(buckets[buckets.length - 1].px, price * 1.14);
    const step = map.stepUsd;
    const n = Math.round((hi - lo) / step) + 1;
    const mass = new Float64Array(n);
    for (const b of buckets) {
      const i = Math.round((b.px - lo) / step);
      if (i >= 0 && i < n) mass[i] += b.ntlUsd;
    }
    const rows: Float64Array[] = [];
    let gmax = 0;
    for (let r = 0; r < ROWS; r++) {
      const bw = BW_BACK * Math.pow(BW_FRONT / BW_BACK, r / (ROWS - 1)) / step;
      const half = Math.ceil(bw * 3.5);
      const k = Array.from({ length: half * 2 + 1 }, (_, j) => Math.exp(-0.5 * ((j - half) / bw) ** 2));
      const ks = k.reduce((a, b) => a + b, 0);
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = -half; j <= half; j++) {
          const q = i + j;
          if (q >= 0 && q < n) s += mass[q] * k[j + half];
        }
        out[i] = s / ks;
        if (r === ROWS - 1 && out[i] > gmax) gmax = out[i];
      }
      rows.push(out);
    }
    // Klastry do podpisu: największy pod ceną, największy nad ceną, najbliższy pod i nad
    const pick = (side: 'below' | 'above', mode: 'max' | 'near') => {
      const list = (side === 'below' ? map.longs : map.shorts).filter((b) => (side === 'below' ? b.px < price : b.px > price) && b.px >= lo && b.px <= hi && b.ntlUsd > 0);
      if (!list.length) return null;
      if (mode === 'max') return list.reduce((a, b) => (b.ntlUsd > a.ntlUsd ? b : a));
      const big = list.filter((b) => b.ntlUsd > gmax * step * 0.25);
      return (big.length ? big : list).reduce((a, b) => (Math.abs(b.px - price) < Math.abs(a.px - price) ? b : a));
    };
    const labels = [pick('below', 'max'), pick('above', 'max'), pick('below', 'near'), pick('above', 'near')].filter((b, i, arr): b is NonNullable<typeof b> => !!b && arr.findIndex((x) => x?.px === b.px) === i);
    return { lo, hi, step, rows, gmax, labels };
  }, [map, price]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo: Geo = useMemo(() => {
    const W = w * 1.08;
    const cx = w / 2;
    return {
      x: (px, tt) => cx + ((px - field.lo) / (field.hi - field.lo) - 0.5) * W * (0.42 + 0.58 * tt),
      base: (tt) => HOR + (FRONT - HOR) * tt ** 1.55,
      amp: (tt) => 230 * (0.42 + 0.58 * tt) ** 1.5,
    };
  }, [w, field]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = VIEW_H * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--color-page').trim();
    const c0 = hex(css.getPropertyValue('--color-line-strong'));
    const c1 = hex(theme === 'dark' ? '#c6d7ea' : css.getPropertyValue('--color-ink-1'));
    const accent = css.getPropertyValue('--color-lume').trim();
    const { rows, gmax, lo, hi, step } = field;
    const n = rows[0].length;
    const stride = Math.max(1, Math.floor(n / Math.max(120, w / 4)));

    const drawRow = (r: number) => {
      const tt = r / (ROWS - 1);
      const yb = geo.base(tt);
      const A = geo.amp(tt);
      ctx.beginPath();
      for (let i = 0; i < n; i += stride) {
        const x = geo.x(lo + i * step, tt);
        const y = yb - A * Math.pow(rows[r][i] / gmax, 0.55);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const xEnd = geo.x(hi, tt);
      const xStart = geo.x(lo, tt);
      ctx.save();
      ctx.lineTo(xEnd, yb + 1);
      ctx.lineTo(xStart, yb + 1);
      ctx.closePath();
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.restore();
      const k = Math.pow(tt, 1.4);
      ctx.strokeStyle = `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
      ctx.globalAlpha = 0.35 + 0.65 * tt;
      ctx.lineWidth = 0.7 + 0.9 * tt;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const drawBeam = () => {
      const xf = geo.x(price, 1);
      const xb = geo.x(price, 0);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xf, FRONT + 12);
      ctx.lineTo(xb, HOR - 40);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(xf, FRONT + 12, 4, 0, Math.PI * 2);
      ctx.fill();
    };
    // Rzędy od tyłu do przodu (zasłanianie); przy animacji pojawiają się kolejno
    if (reduce) {
      ctx.clearRect(0, 0, w, VIEW_H);
      for (let r = 0; r < ROWS; r++) drawRow(r);
      drawBeam();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const shown = Math.min(ROWS, Math.ceil(((now - t0) / 400) * ROWS));
      ctx.clearRect(0, 0, w, VIEW_H);
      for (let r = ROWS - shown; r < ROWS; r++) drawRow(r);
      drawBeam();
      if (shown < ROWS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [field, geo, w, price, theme, reduce]);

  const frontPos = (px: number) => {
    const i = Math.round((px - field.lo) / field.step);
    const d = field.rows[ROWS - 1][i] ?? 0;
    return { x: geo.x(px, 1), y: geo.base(1) - geo.amp(1) * Math.pow(d / field.gmax, 0.55) };
  };
  // Podziałka ceny: najmniejszy krok, przy którym etykiety (ok. 6 znaków) mają między sobą co najmniej 72 px
  const ticks: number[] = [];
  const usdPx = Math.abs(geo.x(field.lo + 1000, 1) - geo.x(field.lo, 1)) / 1000;
  const tickStep = [500, 1000, 2000, 5000, 10000, 20000].find((st) => st * usdPx >= 72) ?? 50000;
  for (let p = Math.ceil(field.lo / tickStep) * tickStep; p <= field.hi; p += tickStep) ticks.push(p);

  return (
    <figure className="m-0">
      <div ref={wrap} className="relative w-full overflow-hidden" style={{ height: VIEW_H }}>
        <canvas ref={canvas} role="img" aria-label={tr(`Krajobraz płynności BTC: mapa likwidacji skanera wokół ceny ${fmtPrice(price, 0)}`, `BTC liquidity landscape: the scanner liquidation map around ${fmtPrice(price, 0)}`)} style={{ width: w, height: VIEW_H }} />
        <span className="font-mono tabular-nums absolute top-1 rounded-sm bg-page/85 px-2 py-1 text-[15px]" style={{ left: geo.x(price, 0) + 10 }}>
          {fmtPrice(price, 0)} <span className="font-sans text-[11px] text-ink-3">{tr('cena', 'price')}</span>
        </span>
        {field.labels.map((b, i) => {
          const p = frontPos(b.px);
          const below = b.px < price;
          if (p.x < 40 || p.x > w - 40) return null;
          // Etykieta skupiska ma ok. 96 px: na wąskim ekranie bliższa wcześniejsza wygrywa, nachodząca znika
          if (field.labels.slice(0, i).some((o) => Math.abs(frontPos(o.px).x - p.x) < 100 && Math.abs(frontPos(o.px).y - p.y) < 44)) return null;
          return (
            <span key={b.px} className="absolute flex -translate-x-1/2 flex-col items-center rounded-sm bg-page/85 px-2 py-1 text-center" style={{ left: p.x, top: p.y - 48 }}>
              <span className="font-mono tabular-nums text-[13px]">{fmtPrice(b.px, 0)}</span>
              <span className="text-[11px] text-ink-2">
                {fmtCompact(b.ntlUsd)} · {below ? tr('longi', 'longs') : tr('shorty', 'shorts')}
              </span>
            </span>
          );
        })}
      </div>
      <div aria-hidden="true" className="font-mono tabular-nums relative h-6 text-[11px] text-ink-3">
        {ticks.map((p) => {
          const x = geo.x(p, 1);
          return x > 20 && x < w - 20 ? (
            <span key={p} className="absolute -translate-x-1/2" style={{ left: x }}>
              {fmtPrice(p, 0)}
            </span>
          ) : null;
        })}
      </div>
    </figure>
  );
};

export default LiquidityTerrain;
