import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LessonSlice } from '../data';
import { type FigureLayers, dayProfile, figureModel, ibLines, niceStep, profileLevels, spreadLabels, visibleCount } from './model';

/**
 * Rycina ćwiczenia: prawdziwy wycinek rynku w SVG w kolorach Wykresów (tokeny `of-*`). Pokazuje tylko świece
 * zamknięte przed chwilą zatrzymania; zakres osi ceny też liczony tylko z nich. Tryb wyboru ceny: kliknięcie
 * (dotknięcie) w panelu ceny zwraca cenę zaokrągloną do kroku.
 */

export interface ChartMark {
  /** Numer albo litera znacznika (tekst opisu odwołuje się do niego). */
  n: string;
  t: number;
  px: number;
}

export interface ChartZone {
  lo: number;
  hi: number;
  tone: 'buy' | 'sell' | 'accent' | 'neutral';
  label?: string;
}

export interface ChartText {
  hidden: string;
  stopped: string;
  noTape: string;
  delta: string;
  cvd: string;
  oi: string;
  sessions: Record<'london' | 'ny', string>;
  liqUnit: string;
  pickHint: string;
  yourPick: string;
}

interface Props {
  slice: LessonSlice;
  layers: FigureLayers;
  cursor: number;
  marks?: readonly ChartMark[];
  zones?: readonly ChartZone[];
  /** Wybór ceny; bez `onPick` tylko pokazuje udzieloną odpowiedź. */
  pick?: { value: number | null; step: number; onPick?: (px: number) => void } | null;
  text: ChartText;
  tz: string;
  locale: string;
  /** Opis ryciny dla czytników ekranu. */
  label?: string;
}

const C = {
  bg: 'var(--color-of-bg)',
  grid: '#141c29',
  line: 'var(--color-line)',
  lineStrong: 'var(--color-line-strong)',
  ink1: 'var(--color-ink-1)',
  ink2: 'var(--color-ink-2)',
  ink3: 'var(--color-ink-3)',
  accent: 'var(--color-accent)',
  buy: 'var(--color-of-buy)',
  sell: 'var(--color-of-sell)',
  buyInk: 'var(--color-of-buy-ink)',
  sellInk: 'var(--color-of-sell-ink)',
  vwap: 'var(--color-of-vwap)',
  poc: 'var(--color-of-poc)',
  zone: 'var(--color-zone)',
  oi: 'var(--color-zone)',
  // Profil wolumenu jak na Wykresach (src/charts/pro/chart/theme.ts): obszar wartości grafitowy, reszta przygaszona
  profileVa: '#34425a',
  profileOut: '#1f2b3d',
};

const TONE: Record<ChartZone['tone'], string> = { buy: C.buy, sell: C.sell, accent: C.accent, neutral: C.ink3 };
const HOUR = 3_600_000;
const TICK_STEPS = [0.5, 1, 2, 3, 4, 6].map((h) => h * HOUR);

const fmtPx = (v: number) => Math.round(v).toLocaleString('pl-PL').replace(/ /g, ' ');
const sig = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

export const LessonChart: React.FC<Props> = ({ slice, layers, cursor, marks = [], zones = [], pick: answer = null, text, tz, locale, label }) => {
  const box = useRef<HTMLDivElement>(null);
  // Kilka rycin na stronie (atlas): własne identyfikatory wzoru i przycięcia
  const uid = useId().replace(/:/g, '');
  const pick = answer?.onPick ? answer : null;
  const [W, setW] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [press, setPress] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const narrow = W > 0 && W < 560;
  // Na wąskim ekranie najwyżej ~60 świec (świece sklejone po k)
  const baseSlots = Math.round((slice.to - slice.from) / (slice.tf * 60_000));
  const k = narrow ? Math.max(1, Math.ceil(baseSlots / 60)) : 1;
  const model = useMemo(() => figureModel(slice, layers, k), [slice, layers, k]);
  const hm = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }), [locale, tz]);

  if (W === 0) return <div ref={box} className="w-full h-[320px]" />;

  const nVis = visibleCount(model, cursor);
  const vis = model.candles.slice(0, nVis);
  const AX = narrow ? 50 : 92;
  const PROF = layers.profile ? (narrow ? 30 : 60) : 0;
  const plotW = W - AX - PROF - 6;
  const profX = plotW + 4;
  const priceTop = 16;
  const priceH = narrow ? 230 : W >= 860 ? 340 : 300;
  const paneKeys = (['delta', 'cvd', 'oi'] as const).filter((p) => layers[p]);
  const paneH = narrow ? 40 : 50;
  const paneGap = 20;
  const panes = paneKeys.map((key, i) => ({ key, top: priceTop + priceH + paneGap + i * (paneH + paneGap) }));
  const timeY = (panes.length ? panes[panes.length - 1].top + paneH : priceTop + priceH) + 14;
  const H = timeY + 8;

  const slot = plotW / model.slots;
  const xOf = (t: number) => ((t - model.from) / model.tfMs) * slot;
  const cx = (t: number) => xOf(t) + slot / 2;
  const bodyW = Math.max(1.2, Math.min(9, slot * 0.64));
  const xCur = Math.min(plotW, xOf(cursor));

  // Zakres ceny: widoczne świece, pasmo ±1σ VWAP, znaczniki, strefy i wybrana cena
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of vis) {
    lo = Math.min(lo, c[3]);
    hi = Math.max(hi, c[2]);
  }
  if (layers.bands)
    for (let i = 0; i < nVis; i++) {
      const v = model.vwap[i];
      if (v) {
        lo = Math.min(lo, v.vwap - v.sd);
        hi = Math.max(hi, v.vwap + v.sd);
      }
    }
  // Znaczniki tylko już widoczne: przyszły znacznik w zakresie osi zdradzałby dalszy ciąg
  const shown = marks.filter((m) => m.t < cursor);
  for (const m of shown) {
    lo = Math.min(lo, m.px);
    hi = Math.max(hi, m.px);
  }
  for (const z of zones) {
    lo = Math.min(lo, z.lo);
    hi = Math.max(hi, z.hi);
  }
  if (answer?.value != null) {
    lo = Math.min(lo, answer.value);
    hi = Math.max(hi, answer.value);
  }
  if (!Number.isFinite(lo)) {
    lo = model.candles[0][3];
    hi = model.candles[0][2];
  }
  const pad = Math.max(hi - lo, 50) * 0.07;
  lo -= pad;
  hi += pad;
  // Miejsce nad najwyższym znacznikiem na jego kółko z numerem (~32 px)
  const topMark = Math.max(-Infinity, ...shown.map((m) => m.px));
  if (Number.isFinite(topMark)) hi = Math.max(hi, topMark + ((hi - lo) * 34) / (priceH - 34));
  const y = (p: number) => priceTop + ((hi - p) / (hi - lo)) * priceH;
  const pOf = (yy: number) => hi - ((yy - priceTop) / priceH) * (hi - lo);
  const inRange = (p: number) => p >= lo && p <= hi;

  const out: React.ReactNode[] = [];
  const axisLabels: { y: number; text: string; color: string; strong?: boolean }[] = [];

  // Siatka ceny
  const gStep = niceStep(hi - lo, narrow ? 5 : 7);
  const grid: number[] = [];
  for (let p = Math.ceil(lo / gStep) * gStep; p <= hi; p += gStep) grid.push(p);
  for (const p of grid) out.push(<line key={`g${p}`} x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke={C.grid} />);

  // Otwarcia sesji
  for (const s of model.sessions) {
    const x = xOf(s.t);
    out.push(<line key={`s${s.t}`} x1={x} x2={x} y1={priceTop} y2={priceTop + priceH} stroke={C.lineStrong} strokeDasharray="3 3" />);
    out.push(
      <text key={`st${s.t}`} x={x + 4} y={priceTop + 10} fontSize={10} fill={C.ink3}>
        {text.sessions[s.id as 'london' | 'ny']} {hm.format(s.t)}
      </text>
    );
  }

  // Initial balance: prostokąt pierwszej godziny i poziomy z rozszerzeniami po jej końcu
  const ib = model.ib && model.ib.end <= cursor ? model.ib : null;
  if (ib) {
    out.push(<rect key="ib" x={xOf(ib.session.start)} y={y(ib.hi)} width={xOf(ib.end) - xOf(ib.session.start)} height={y(ib.lo) - y(ib.hi)} fill={C.zone} fillOpacity={0.12} stroke={C.zone} strokeOpacity={0.5} />);
    for (const l of ibLines(ib)) {
      if (!inRange(l.px)) continue;
      const main = l.label === 'IBH' || l.label === 'IBL';
      out.push(<line key={`ib${l.label}`} x1={xOf(ib.end)} x2={plotW} y1={y(l.px)} y2={y(l.px)} stroke={C.zone} strokeOpacity={main ? 0.8 : 0.45} strokeDasharray={main ? undefined : '2 3'} />);
      axisLabels.push({ y: y(l.px), text: `${l.label} ${fmtPx(l.px)}`, color: C.zone });
    }
  }

  // Strefy z opisu ćwiczenia
  for (const [i, z] of zones.entries()) {
    out.push(<rect key={`z${i}`} x={0} y={y(z.hi)} width={plotW} height={Math.max(1, y(z.lo) - y(z.hi))} fill={TONE[z.tone]} fillOpacity={0.14} />);
    out.push(<line key={`zt${i}`} x1={0} x2={plotW} y1={y(z.hi)} y2={y(z.hi)} stroke={TONE[z.tone]} strokeOpacity={0.6} />);
    out.push(<line key={`zb${i}`} x1={0} x2={plotW} y1={y(z.lo)} y2={y(z.lo)} stroke={TONE[z.tone]} strokeOpacity={0.6} />);
    if (z.label)
      out.push(
        <text key={`zl${i}`} x={6} y={y(z.hi) + 12} fontSize={10} fill={C.ink1}>
          {z.label}
        </text>
      );
  }

  // Profil dnia do chwili zatrzymania: wiersze przy osi, VAH i VAL przerywane, POC ciągły
  const prof = layers.profile ? dayProfile(model, cursor) : null;
  if (prof) {
    const lv = profileLevels(prof);
    const rowH = Math.max(1, Math.abs(y(prof.step) - y(0)));
    for (let r = 0; r < prof.vol.length; r++) {
      const v = prof.vol[r];
      const p = (prof.lo + r) * prof.step;
      if (!(v > 0) || p + prof.step < lo || p > hi) continue;
      const w = (v / prof.max) * (PROF - 2);
      const col = r === prof.poc ? C.poc : r >= prof.vaLo && r <= prof.vaHi ? C.profileVa : C.profileOut;
      out.push(<rect key={`p${r}`} x={profX + PROF - w} y={y(p + prof.step)} width={w} height={Math.max(0.6, rowH - 0.4)} fill={col} />);
    }
    for (const [label, px, dash] of [
      ['VAH', lv.vah, '4 3'],
      ['VAL', lv.val, '4 3'],
      ['POC', lv.poc, undefined],
    ] as const) {
      if (!inRange(px)) continue;
      out.push(<line key={label} x1={0} x2={plotW} y1={y(px)} y2={y(px)} stroke={label === 'POC' ? C.poc : C.ink3} strokeOpacity={label === 'POC' ? 0.9 : 0.8} strokeDasharray={dash} />);
      axisLabels.push({ y: y(px), text: `${label} ${fmtPx(px)}`, color: label === 'POC' ? C.poc : C.ink2 });
    }
  }

  // Poziomy dnia poprzedniego
  if (layers.levels)
    for (const lv of slice.levels) {
      const end = lv.t + 86_400_000;
      if (end <= model.from || lv.t >= model.to) continue;
      const x1 = Math.max(0, xOf(lv.t));
      const x2 = Math.min(plotW, xOf(end));
      for (const [label, px] of [
        ['PDH', lv.pdh],
        ['PDL', lv.pdl],
      ] as const) {
        if (inRange(px)) {
          out.push(<line key={`${label}${lv.t}`} x1={x1} x2={x2} y1={y(px)} y2={y(px)} stroke={C.ink2} strokeDasharray="1 3" strokeWidth={1.4} />);
          axisLabels.push({ y: y(px), text: `${label} ${fmtPx(px)}`, color: C.ink2 });
        } else if (lv.t <= cursor && cursor < end) {
          // Poziom poza zakresem: znacznik przy krawędzi ze strzałką
          const top = px > hi;
          out.push(
            <text key={`${label}e${lv.t}`} x={plotW - 4} y={top ? priceTop + 22 : priceTop + priceH - 6} fontSize={10} fill={C.ink2} textAnchor="end">
              {label} {fmtPx(px)} {top ? '↑' : '↓'}
            </text>
          );
        }
      }
    }

  // VWAP dnia z pasmami: ±1σ wypełnione, ±2σ kropkowane; linia od nowa na początku doby
  if (layers.vwap || layers.bands) {
    const segs: { x: number; v: number; sd: number }[][] = [];
    for (let i = 0; i < nVis; i++) {
      const v = model.vwap[i];
      if (!v) continue;
      if (v.start || !segs.length) segs.push([]);
      segs[segs.length - 1].push({ x: cx(model.candles[i][0]), v: v.vwap, sd: v.sd });
    }
    segs.forEach((s, j) => {
      if (s.length < 2) return;
      const path = (f: (p: (typeof s)[number]) => number) => s.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${y(f(p)).toFixed(1)}`).join('');
      if (layers.bands) {
        const up = s.map((p) => `${p.x.toFixed(1)},${y(p.v + p.sd).toFixed(1)}`);
        const dn = [...s].reverse().map((p) => `${p.x.toFixed(1)},${y(p.v - p.sd).toFixed(1)}`);
        out.push(<polygon key={`b1${j}`} points={[...up, ...dn].join(' ')} fill={C.vwap} fillOpacity={0.06} />);
        out.push(<path key={`b2u${j}`} d={path((p) => p.v + 2 * p.sd)} fill="none" stroke={C.vwap} strokeOpacity={0.45} strokeDasharray="2 3" />);
        out.push(<path key={`b2d${j}`} d={path((p) => p.v - 2 * p.sd)} fill="none" stroke={C.vwap} strokeOpacity={0.45} strokeDasharray="2 3" />);
        out.push(<path key={`b1u${j}`} d={path((p) => p.v + p.sd)} fill="none" stroke={C.vwap} strokeOpacity={0.3} />);
        out.push(<path key={`b1d${j}`} d={path((p) => p.v - p.sd)} fill="none" stroke={C.vwap} strokeOpacity={0.3} />);
      }
      if (layers.vwap) out.push(<path key={`vw${j}`} d={path((p) => p.v)} fill="none" stroke={C.vwap} strokeWidth={1.6} />);
    });
    const last = nVis > 0 ? model.vwap[nVis - 1] : null;
    if (last && layers.vwap) axisLabels.push({ y: y(last.vwap), text: `VWAP ${fmtPx(last.vwap)}`, color: C.vwap });
  }

  // Świece
  for (const c of vis) {
    const up = c[4] >= c[1];
    const col = up ? C.buy : C.sell;
    const x = cx(c[0]);
    out.push(<line key={`w${c[0]}`} x1={x} x2={x} y1={y(c[2])} y2={y(c[3])} stroke={col} />);
    const top = y(Math.max(c[1], c[4]));
    out.push(<rect key={`c${c[0]}`} x={x - bodyW / 2} y={top} width={bodyW} height={Math.max(1, y(Math.min(c[1], c[4])) - top)} fill={col} />);
  }

  // Likwidacje: koła pod dołkiem (longi) i nad szczytem (shorty), pole koła według kwoty
  if (layers.liq && slice.liq) {
    const byBar = new Map<number, [number, number]>();
    for (const [t, l, s] of slice.liq) {
      const tb = Math.floor(t / model.tfMs) * model.tfMs;
      const x = byBar.get(tb) ?? [0, 0];
      byBar.set(tb, [x[0] + l, x[1] + s]);
    }
    const maxUsd = Math.max(...[...byBar.values()].flat(), 1);
    for (const c of vis) {
      const v = byBar.get(c[0]);
      if (!v) continue;
      for (const [side, usd] of [
        ['l', v[0]],
        ['s', v[1]],
      ] as const) {
        if (usd < 0.5) continue;
        const r = 3 + 11 * Math.sqrt(usd / maxUsd);
        const yy = side === 'l' ? y(c[3]) + r + 2 : y(c[2]) - r - 2;
        out.push(<circle key={`lq${side}${c[0]}`} cx={cx(c[0])} cy={yy} r={r} fill={side === 'l' ? C.sell : C.buy} fillOpacity={0.35} stroke={side === 'l' ? C.sellInk : C.buyInk} />);
        if (usd >= 5 && !narrow)
          out.push(
            <text key={`lqt${side}${c[0]}`} x={cx(c[0]) - r - 4} y={yy + 3} fontSize={10} fill={C.ink2} textAnchor="end">
              {Math.round(usd)} {text.liqUnit}
            </text>
          );
      }
    }
  }

  // Przyszłość ukryta: przygaszony obszar za chwilą zatrzymania
  if (xCur < plotW - 1) {
    out.push(<rect key="fut" x={xCur} y={priceTop} width={plotW - xCur} height={timeY - 14 - priceTop} fill="var(--color-page)" fillOpacity={0.55} />);
    out.push(<line key="cur" x1={xCur} x2={xCur} y1={priceTop} y2={timeY - 14} stroke={C.accent} strokeOpacity={0.7} strokeDasharray="4 3" />);
    if (plotW - xCur > 70)
      out.push(
        <text key="futt" x={xCur + (plotW - xCur) / 2} y={priceTop + priceH / 2} fontSize={11} fill={C.ink3} textAnchor="middle">
          {text.hidden}
        </text>
      );
    out.push(
      <text key="curt" x={xCur - 4} y={priceTop - 5} fontSize={10} fill={C.accent} textAnchor="end">
        {text.stopped} {hm.format(cursor)}
      </text>
    );
  }

  // Znaczniki z opisu
  for (const m of shown) {
    const x = cx(Math.floor(m.t / model.tfMs) * model.tfMs);
    out.push(
      <g key={`m${m.n}`}>
        <line x1={x} x2={x} y1={y(m.px)} y2={y(m.px) - 14} stroke={C.accent} />
        <circle cx={x} cy={y(m.px) - 22} r={8} fill={C.accent} />
        <text x={x} y={y(m.px) - 18.5} fontSize={10} fontWeight={700} fill="var(--color-page)" textAnchor="middle">
          {m.n}
        </text>
      </g>
    );
  }

  // Wybór ceny: linia pod kursorem i zatwierdzona odpowiedź
  const hoverPx = pick && hover && hover.y >= priceTop && hover.y <= priceTop + priceH ? Math.round(pOf(hover.y) / pick.step) * pick.step : null;
  if (answer?.value != null) {
    out.push(<line key="pick" x1={0} x2={plotW} y1={y(answer.value)} y2={y(answer.value)} stroke={C.accent} strokeWidth={1.6} />);
    out.push(
      <text key="pickt" x={6} y={y(answer.value) - 5} fontSize={10} fill={C.accent}>
        {text.yourPick} {fmtPx(answer.value)}
      </text>
    );
  }
  if (hoverPx !== null) out.push(<line key="hp" x1={0} x2={plotW} y1={y(hoverPx)} y2={y(hoverPx)} stroke={C.accent} strokeOpacity={0.6} strokeDasharray="3 3" />);

  // Oś ceny: siatka, poziomy (bez nakładania), ostatnia cena
  const lastPx = vis.length ? vis[vis.length - 1][4] : null;
  const tags = spreadLabels(axisLabels, 12, priceTop + 4, priceTop + priceH - 4);
  const gridLabels = grid.filter((p) => tags.every((t) => Math.abs(t.ly - y(p)) > 11) && (lastPx === null || Math.abs(y(lastPx) - y(p)) > 12));
  const axisX = plotW + PROF + 8;

  // Panele delty, CVD i open interest (tylko z taśmy)
  const covered = (t: number) => model.tape.some(([a, b]) => a <= t && b >= t + model.tfMs);
  const paneEls: React.ReactNode[] = [];
  for (const p of panes) {
    const series: { t: number; v: number }[] = [];
    if (p.key === 'delta' || p.key === 'cvd') {
      let acc = 0;
      for (const c of vis) {
        if (c[6] === null || c[7] === null || !covered(c[0])) continue;
        const d = c[6] - c[7];
        acc += d;
        series.push({ t: c[0], v: p.key === 'delta' ? d : acc });
      }
    } else if (slice.oi) {
      const byT = new Map(slice.oi.map(([t, v]) => [Math.floor(t / model.tfMs) * model.tfMs, v]));
      for (const c of vis) {
        const v = byT.get(c[0]);
        if (v !== undefined) series.push({ t: c[0], v });
      }
    }
    const title = text[p.key];
    paneEls.push(<line key={`pl${p.key}`} x1={0} x2={plotW} y1={p.top + paneH} y2={p.top + paneH} stroke={C.line} />);
    paneEls.push(
      <text key={`pt${p.key}`} x={0} y={p.top - 6} fontSize={10} fill={C.ink3}>
        {title}
      </text>
    );
    // Bez taśmy: kreskowanie od lewej krawędzi do pierwszej nagranej świecy
    const firstTaped = model.candles.find((c) => covered(c[0]));
    const hatchEnd = Math.min(xCur, firstTaped ? xOf(firstTaped[0]) : plotW);
    if (hatchEnd > 2) {
      paneEls.push(<rect key={`ph${p.key}`} x={0} y={p.top} width={hatchEnd} height={paneH} fill={`url(#${uid}h)`} />);
      if (hatchEnd > 90)
        paneEls.push(
          <text key={`pht${p.key}`} x={hatchEnd / 2} y={p.top + paneH / 2 + 3} fontSize={10} fill={C.ink3} textAnchor="middle">
            {text.noTape}
          </text>
        );
    }
    if (!series.length) continue;
    let mn = Math.min(...series.map((s) => s.v));
    let mx = Math.max(...series.map((s) => s.v));
    if (p.key === 'delta') {
      mx = Math.max(Math.abs(mn), Math.abs(mx), 1);
      mn = -mx;
    } else if (mx - mn < 1) {
      mx += 0.5;
      mn -= 0.5;
    }
    const py = (v: number) => p.top + 3 + ((mx - v) / (mx - mn)) * (paneH - 6);
    if (p.key === 'delta') {
      paneEls.push(<line key="dz" x1={0} x2={plotW} y1={py(0)} y2={py(0)} stroke={C.line} />);
      for (const s of series) {
        const top = Math.min(py(0), py(s.v));
        paneEls.push(<rect key={`d${s.t}`} x={cx(s.t) - bodyW / 2} y={top} width={bodyW} height={Math.max(1, Math.abs(py(s.v) - py(0)))} fill={s.v >= 0 ? C.buy : C.sell} />);
      }
    } else {
      const d = series.map((s, i) => `${i ? 'L' : 'M'}${cx(s.t).toFixed(1)} ${py(s.v).toFixed(1)}`).join('');
      paneEls.push(<path key={`ln${p.key}`} d={d} fill="none" stroke={p.key === 'cvd' ? C.accent : C.oi} strokeWidth={1.6} />);
    }
    const last = series[series.length - 1].v;
    paneEls.push(
      <text key={`pv${p.key}`} x={axisX} y={py(last) + 3} fontSize={10} fill={C.ink2}>
        {p.key === 'oi' ? fmtPx(last) : sig(last)}
      </text>
    );
  }

  // Oś czasu (czas strefy treści)
  const tickStep = TICK_STEPS.find((s) => (s / model.tfMs) * slot >= (narrow ? 64 : 72)) ?? 12 * HOUR;
  const ticks: number[] = [];
  // Bez etykiet uciętych na krawędziach panelu
  for (let t = Math.ceil(model.from / tickStep) * tickStep; t < model.to; t += tickStep) if (xOf(t) >= 16 && xOf(t) <= plotW - 16) ticks.push(t);

  // Odczyt świecy pod kursorem
  const hi_ = hover && !pick ? Math.floor(hover.x / slot) : -1;
  const hc = hi_ >= 0 && hi_ < nVis ? model.candles[hi_] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const yy = e.clientY - r.top;
    if (e.pointerType !== 'mouse' && !press) return;
    setHover(x <= plotW ? { x, y: yy } : null);
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setPress(false);
    if (!pick?.onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const yy = e.clientY - r.top;
    if (yy < priceTop || yy > priceTop + priceH || e.clientX - r.left > plotW) return;
    pick.onPick(Math.round(pOf(yy) / pick.step) * pick.step);
    if (e.pointerType !== 'mouse') setHover(null);
  };

  return (
    <div ref={box} className="w-full select-none">
      <div className="h-5 mb-1 font-mono tabular-nums text-[11px] text-ink-3 truncate" aria-live="off">
        {hc ? (
          <>
            {hm.format(hc[0])} · O {fmtPx(hc[1])} H {fmtPx(hc[2])} L {fmtPx(hc[3])} C {fmtPx(hc[4])} · V {hc[5].toFixed(0)}
            {hc[6] !== null && hc[7] !== null ? ` · Δ ${sig(hc[6] - hc[7])}` : ''}
          </>
        ) : pick ? (
          <span className="text-accent">{text.pickHint}</span>
        ) : null}
      </div>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={label}
        className={`block font-mono ${pick ? 'cursor-crosshair touch-none' : ''}`}
        onPointerMove={onMove}
        onPointerDown={(e) => {
          setPress(true);
          onMove(e);
        }}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setHover(null);
          setPress(false);
        }}
      >
        <defs>
          <pattern id={`${uid}h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#1b2533" strokeWidth="2" />
          </pattern>
          <clipPath id={`${uid}c`}>
            <rect x={0} y={priceTop} width={plotW + PROF + 4} height={priceH} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill={C.bg} />
        <g clipPath={`url(#${uid}c)`}>{out}</g>
        {paneEls}
        {hover && !pick && hover.x < xCur && <line x1={hover.x} x2={hover.x} y1={priceTop} y2={timeY - 14} stroke={C.ink3} strokeOpacity={0.5} />}
        {gridLabels.map((p) => (
          <text key={`gl${p}`} x={axisX} y={y(p) + 3} fontSize={10} fill={C.ink3}>
            {fmtPx(p)}
          </text>
        ))}
        {tags.map((t, i) => (
          <text key={`tag${i}`} x={axisX} y={t.ly + 3} fontSize={10} fill={t.color}>
            {narrow ? t.text.split(' ')[0] : t.text}
          </text>
        ))}
        {lastPx !== null && (
          <g>
            <rect x={axisX - 3} y={y(lastPx) - 8} width={AX - 2} height={16} rx={2} fill={C.accent} />
            <text x={axisX} y={y(lastPx) + 4} fontSize={11} fontWeight={600} fill="var(--color-page)">
              {fmtPx(lastPx)}
            </text>
          </g>
        )}
        {hoverPx !== null && hover && (
          <g>
            <rect x={axisX - 3} y={hover.y - 8} width={AX - 2} height={16} rx={2} fill="var(--color-surface-3)" stroke={C.accent} />
            <text x={axisX} y={hover.y + 4} fontSize={11} fill={C.ink1}>
              {fmtPx(hoverPx)}
            </text>
          </g>
        )}
        {ticks.map((t) => (
          <text key={`tt${t}`} x={xOf(t)} y={timeY} fontSize={10} fill={C.ink3} textAnchor="middle">
            {hm.format(t)}
          </text>
        ))}
      </svg>
    </div>
  );
};
