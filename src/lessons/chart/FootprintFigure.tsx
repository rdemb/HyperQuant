import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LessonSlice } from '../data';
import type { ChartMark, ChartText, ChartZone } from './LessonChart';
import { priceFormat } from './model';
import { FIG, inkOn } from './palette';

/**
 * Footprint ćwiczenia: sprzedaż × kupno agresorów na poziomach ceny w każdej świecy (jak styl Bid × Ask na Wykresach),
 * POC świecy w ramce, nierównowagi po przekątnej, pod spodem delta, wolumen i zmiana open interest. Widać tylko
 * świece zamknięte przed chwilą zatrzymania; zakres cen liczony z nich.
 */

interface Props {
  slice: LessonSlice;
  cursor: number;
  marks?: readonly ChartMark[];
  zones?: readonly ChartZone[];
  /** Wybór ceny; bez `onPick` tylko pokazuje udzieloną odpowiedź. */
  pick?: { value: number | null; step: number; onPick?: (px: number) => void } | null;
  text: ChartText & { volume: string; oiChange: string; imbalance: string };
  /** Opis ryciny dla czytników ekranu. */
  label?: string;
  tz: string;
  locale: string;
}

// Kafle jak w stylu Bid × Ask Wykresów, w palecie wybranej w Wykresach: sprzedaż agresorów po stronie bidu, kupno po stronie asku
const SELL_RAMP = FIG.fpBidRamp;
const BUY_RAMP = FIG.fpAskRamp;
const TONE: Record<ChartZone['tone'], string> = { buy: 'var(--color-of-buy)', sell: 'var(--color-of-sell)', accent: 'var(--color-accent)', neutral: 'var(--color-ink-3)' };

/** Nierównowagi po przekątnej: kupno wobec sprzedaży poziom niżej i sprzedaż wobec kupna poziom wyżej, co najmniej 3:1. */
export function diagonalImbalances(cells: readonly [number, number, number][], step: number, ratio = 3): { buy: Set<number>; sell: Set<number> } {
  const by = new Map(cells.map((c) => [c[0], c]));
  const min = Math.max(1, 0.1 * Math.max(...cells.flatMap((c) => [c[1], c[2]])));
  const buy = new Set<number>();
  const sell = new Set<number>();
  for (const [p, s, k] of cells) {
    if (k >= min && k >= ratio * Math.max(by.get(p - step)?.[1] ?? 0, 0.1)) buy.add(p);
    if (s >= min && s >= ratio * Math.max(by.get(p + step)?.[2] ?? 0, 0.1)) sell.add(p);
  }
  return { buy, sell };
}

/** Wolumen komórki: jedno miejsce po przecinku poniżej 10 BTC, z separatorem dziesiętnym języka. */
const volFormat = (locale: string) => {
  const dec = (1.5).toLocaleString(locale).charAt(1);
  return (v: number) => (v <= 0 ? '' : v < 9.95 ? v.toFixed(1).replace('.', dec) : String(Math.round(v)));
};
// Wąski kafel (telefon): całe BTC, żeby sąsiednie liczby się nie zlewały
const volNarrow = (v: number) => (v < 0.5 ? '' : String(Math.round(v)));
const sig = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

export const FootprintFigure: React.FC<Props> = ({ slice, cursor, marks = [], zones = [], pick = null, text, tz, locale, label }) => {
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTo = useRef<number | null>(null);
  const scrolled = useRef<number | null>(null);
  const [W, setW] = useState(0);
  const [hoverY, setHoverY] = useState<number | null>(null);
  // Wąski ekran: kursor zatrzymania w widoku (tylko gdy zmienił się cel, nie przy każdym ruchu wskaźnika)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || scrollTo.current === scrolled.current) return;
    scrolled.current = scrollTo.current;
    if (scrollTo.current !== null) el.scrollLeft = scrollTo.current;
  });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const fp = slice.fp;
  const narrow = W > 0 && W < 640;
  const tfMs = (fp?.tf ?? slice.tf) * 60_000;
  const bars = fp?.bars ?? [];
  const hm = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }), [locale, tz]);
  const fmtPx = useMemo(() => priceFormat(locale), [locale]);
  const vol = useMemo(() => volFormat(locale), [locale]);
  if (!fp || W === 0) return <div ref={box} className="w-full h-[420px]" />;

  const barMs = tfMs;
  const slots = Math.round((slice.to - slice.from) / barMs);
  const vis = bars.filter((b) => b.t + barMs <= cursor);
  const step = fp.step;
  const AX = narrow ? 50 : 60;
  // Na wąskim ekranie kolumny zostają czytelne (te same świece co w opisie), a rycina przewija się w poziomie
  const viewW = W - AX;
  const colW = Math.max(viewW / slots, narrow ? 54 : 0);
  const plotW = colW * slots;
  const top = 18;
  let loP = Infinity;
  let hiP = -Infinity;
  for (const b of vis)
    for (const c of b.cells) {
      loP = Math.min(loP, c[0]);
      hiP = Math.max(hiP, c[0]);
    }
  for (const z of zones) {
    loP = Math.min(loP, Math.floor(z.lo / step) * step);
    hiP = Math.max(hiP, Math.floor(z.hi / step) * step);
  }
  if (pick?.value != null) {
    loP = Math.min(loP, Math.floor(pick.value / step) * step);
    hiP = Math.max(hiP, Math.floor(pick.value / step) * step);
  }
  if (!Number.isFinite(loP)) {
    loP = Math.floor(bars[0].ohlc[2] / step) * step;
    hiP = loP;
  }
  loP -= step;
  hiP += step;
  const rows = Math.round((hiP - loP) / step) + 1;
  const rowH = Math.max(13, Math.min(19, (narrow ? 330 : 400) / rows));
  const gridH = rows * rowH;
  const yRow = (p: number) => top + ((hiP - p) / step) * rowH;
  const yPx = (p: number) => top + ((hiP + step - p) / step) * rowH;
  const pOf = (yy: number) => hiP + step - ((yy - top) / rowH) * step;
  const statTop = top + gridH + 8;
  const statH = 17;
  const timeY = statTop + 3 * statH + 14;
  const H = timeY + 8;
  const xCur = Math.min(plotW, ((cursor - slice.from) / barMs) * colW);
  scrollTo.current = plotW > viewW ? Math.max(0, Math.round(xCur - viewW * 0.7)) : null;

  let maxCell = 1;
  for (const b of vis) for (const c of b.cells) maxCell = Math.max(maxCell, c[1], c[2]);
  const ramp = (r: readonly string[], v: number) => r[Math.min(r.length - 1, Math.round((v / maxCell) ** 0.6 * (r.length - 1)))];
  const maxDelta = Math.max(1, ...vis.map((b) => Math.abs(b.cells.reduce((s, c) => s + c[2] - c[1], 0))));

  const els: React.ReactNode[] = [];
  for (const z of zones) {
    const y1 = yPx(z.hi);
    const y2 = yPx(z.lo);
    els.push(<rect key={`z${z.lo}`} x={0} y={y1} width={plotW} height={Math.max(1, y2 - y1)} fill={TONE[z.tone]} fillOpacity={0.12} stroke={TONE[z.tone]} strokeOpacity={0.6} />);
    if (z.label)
      els.push(
        <text key={`zl${z.lo}`} x={4} y={y2 - 4} fontSize={10} fill="var(--color-ink-1)">
          {z.label}
        </text>
      );
  }
  vis.forEach((b) => {
    const i = Math.round((b.t - slice.from) / barMs);
    const x0 = i * colW;
    const cw = Math.max(8, (colW - 8) / 2);
    const xs = x0 + 5;
    const imb = diagonalImbalances(b.cells, step);
    const poc = b.cells.reduce((a, c) => (c[1] + c[2] > a[1] + a[2] ? c : a));
    const up = b.ohlc[3] >= b.ohlc[0];
    // Świeca jako cienka kreska przy lewej krawędzi kolumny
    els.push(<line key={`k${b.t}`} x1={x0 + 2} x2={x0 + 2} y1={yPx(b.ohlc[1])} y2={yPx(b.ohlc[2])} stroke={up ? 'var(--color-of-buy)' : 'var(--color-of-sell)'} strokeWidth={2} />);
    for (const [p, s, kb] of b.cells) {
      const yy = yRow(p);
      const sCol = ramp(SELL_RAMP, s);
      const bCol = ramp(BUY_RAMP, kb);
      els.push(<rect key={`s${b.t}${p}`} x={xs} y={yy + 0.5} width={cw - 1} height={rowH - 1} fill={sCol} />);
      els.push(<rect key={`b${b.t}${p}`} x={xs + cw} y={yy + 0.5} width={cw - 1} height={rowH - 1} fill={bCol} />);
      const fs = cw < 22 ? 9 : 10;
      const fmt = cw < 24 ? volNarrow : vol;
      if (cw >= 15) {
        els.push(
          <text key={`st${b.t}${p}`} x={xs + cw / 2 - 0.5} y={yy + rowH / 2 + 3.5} fontSize={fs} textAnchor="middle" fontWeight={imb.sell.has(p) ? 700 : 400} fill={inkOn(sCol)}>
            {fmt(s)}
          </text>
        );
        els.push(
          <text key={`bt${b.t}${p}`} x={xs + cw * 1.5 - 0.5} y={yy + rowH / 2 + 3.5} fontSize={fs} textAnchor="middle" fontWeight={imb.buy.has(p) ? 700 : 400} fill={inkOn(bCol)}>
            {fmt(kb)}
          </text>
        );
      }
      if (imb.sell.has(p)) els.push(<rect key={`is${b.t}${p}`} x={xs - 1} y={yy + 0.5} width={2.5} height={rowH - 1} fill="var(--color-of-imb-sell)" />);
      if (imb.buy.has(p)) els.push(<rect key={`ib${b.t}${p}`} x={xs + 2 * cw - 2.5} y={yy + 0.5} width={2.5} height={rowH - 1} fill="var(--color-of-imb-buy)" />);
    }
    els.push(<rect key={`poc${b.t}`} x={xs - 0.5} y={yRow(poc[0]) + 0.5} width={2 * cw - 0.5} height={rowH - 1} fill="none" stroke="var(--color-of-poc)" strokeWidth={1.4} />);
    // Delta, wolumen, ΔOI pod świecą
    const d = b.cells.reduce((sum, c) => sum + c[2] - c[1], 0);
    const v = b.cells.reduce((sum, c) => sum + c[1] + c[2], 0);
    const dRamp = d >= 0 ? FIG.fpDeltaPosRamp : FIG.fpDeltaNegRamp;
    const dCol = dRamp[Math.min(dRamp.length - 1, Math.round((Math.abs(d) / maxDelta) * (dRamp.length - 1)))];
    els.push(<rect key={`dl${b.t}`} x={xs} y={statTop} width={2 * cw - 1} height={statH - 2} fill={dCol} />);
    const cxm = xs + cw;
    els.push(
      <text key={`dt${b.t}`} x={cxm} y={statTop + 11.5} fontSize={10} textAnchor="middle" fontWeight={600} fill={inkOn(dCol)}>
        {sig(d)}
      </text>
    );
    els.push(
      <text key={`vt${b.t}`} x={cxm} y={statTop + statH + 11.5} fontSize={10} textAnchor="middle" fill="var(--color-ink-2)">
        {Math.round(v)}
      </text>
    );
    els.push(
      <text key={`ot${b.t}`} x={cxm} y={statTop + 2 * statH + 11.5} fontSize={10} textAnchor="middle" fill="var(--color-ink-2)">
        {b.oi === null ? '—' : sig(b.oi)}
      </text>
    );
    if (i % (narrow ? 1 : colW < 44 ? 2 : 1) === 0)
      els.push(
        <text key={`tm${b.t}`} x={cxm} y={timeY} fontSize={10} textAnchor="middle" fill="var(--color-ink-3)">
          {hm.format(b.t)}
        </text>
      );
  });

  if (xCur < plotW - 1) {
    els.push(<rect key="fut" x={xCur} y={top} width={plotW - xCur} height={timeY - 12 - top} fill="var(--color-page)" fillOpacity={0.55} />);
    els.push(<line key="cur" x1={xCur} x2={xCur} y1={top} y2={timeY - 12} stroke="var(--color-accent)" strokeOpacity={0.7} strokeDasharray="4 3" />);
    if (plotW - xCur > 80)
      els.push(
        <text key="futt" x={xCur + (plotW - xCur) / 2} y={top + gridH / 2} fontSize={11} fill="var(--color-ink-3)" textAnchor="middle">
          {text.hidden}
        </text>
      );
    els.push(
      <text key="curt" x={xCur < 110 ? xCur + 4 : xCur - 4} y={top - 6} fontSize={10} fill="var(--color-accent)" textAnchor={xCur < 110 ? 'start' : 'end'}>
        {text.stopped} {hm.format(cursor)}
      </text>
    );
  }
  for (const m of marks) {
    if (m.t >= cursor) continue;
    const i = Math.floor((m.t - slice.from) / barMs);
    const x = i * colW + colW / 2;
    const yy = yPx(m.px);
    els.push(
      <g key={`m${m.n}`}>
        <circle cx={x} cy={yy} r={9} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
        <circle cx={x + 12} cy={yy - 12} r={8} fill="var(--color-accent)" />
        <text x={x + 12} y={yy - 8.5} fontSize={10} fontWeight={700} fill="var(--color-page)" textAnchor="middle">
          {m.n}
        </text>
      </g>
    );
  }
  const live = pick?.onPick ? pick : null;
  const hoverPx = live && hoverY !== null && hoverY >= top && hoverY <= top + gridH ? Math.round(pOf(hoverY) / live.step) * live.step : null;
  if (pick?.value != null) {
    els.push(<line key="pick" x1={0} x2={plotW} y1={yPx(pick.value)} y2={yPx(pick.value)} stroke="var(--color-accent)" strokeWidth={1.6} />);
    els.push(
      <text key="pickt" x={4} y={yPx(pick.value) - 4} fontSize={10} fill="var(--color-accent)">
        {text.yourPick} {fmtPx(pick.value)}
      </text>
    );
  }
  if (hoverPx !== null) els.push(<line key="hp" x1={0} x2={plotW} y1={yPx(hoverPx)} y2={yPx(hoverPx)} stroke="var(--color-accent)" strokeOpacity={0.6} strokeDasharray="3 3" />);

  const priceLabels: number[] = [];
  const every = rowH < 15 ? 2 : 1;
  for (let p = hiP, r = 0; p >= loP; p -= step, r++) if (r % every === 0) priceLabels.push(p);

  return (
    <div ref={box} className="w-full select-none">
      <div className="h-5 mb-1 text-[11px] text-ink-3 truncate">{live ? <span className="text-accent">{text.pickHint}</span> : null}</div>
      <div className="flex">
      <div ref={scroller} className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain">
      <svg
        width={plotW}
        height={H}
        role="img"
        aria-label={label}
        className={`block font-mono ${live ? 'cursor-crosshair touch-pan-x' : ''}`}
        onPointerMove={(e) => {
          if (!live) return;
          setHoverY(e.clientY - e.currentTarget.getBoundingClientRect().top);
        }}
        onPointerLeave={() => setHoverY(null)}
        onPointerUp={(e) => {
          if (!live?.onPick) return;
          const yy = e.clientY - e.currentTarget.getBoundingClientRect().top;
          if (yy >= top && yy <= top + gridH) live.onPick(Math.round(pOf(yy) / live.step) * live.step);
        }}
      >
        <rect x={0} y={0} width={plotW} height={H} fill="var(--color-of-bg)" />
        {els}
      </svg>
      </div>
      {/* Oś ceny i podpisy wierszy stoją w miejscu, gdy rycina przewija się w poziomie */}
      <svg width={AX} height={H} aria-hidden="true" className="block shrink-0 font-mono">
        <rect x={0} y={0} width={AX} height={H} fill="var(--color-of-bg)" />
        {priceLabels.map((p) => (
          <text key={`pl${p}`} x={6} y={yRow(p) + rowH / 2 + 3.5} fontSize={10} fill="var(--color-ink-3)">
            {fmtPx(p)}
          </text>
        ))}
        {[text.delta, text.volume, text.oiChange].map((s, i) => (
          <text key={s} x={6} y={statTop + i * statH + 11.5} fontSize={10} fill="var(--color-ink-3)">
            {s.split(/[ ,]/)[0]}
          </text>
        ))}
        {hoverPx !== null && hoverY !== null && (
          <g>
            <rect x={3} y={hoverY - 8} width={AX - 4} height={16} rx={2} fill="var(--color-surface-3)" stroke="var(--color-accent)" />
            <text x={6} y={hoverY + 4} fontSize={11} fill="var(--color-ink-1)">
              {fmtPx(hoverPx)}
            </text>
          </g>
        )}
      </svg>
      </div>
    </div>
  );
};
