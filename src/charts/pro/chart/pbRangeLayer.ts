import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { type Bar5, HORIZON_MS, LIFE, type Levels, type Outcome, type Range, type Rule, type Spot, TF_MS, atr, dayLevels, inDtWindow, ranges, resolve, score, typicalHourBp, weekLevels } from '../core/pbRanges';
import { utcDayStart, utcWeekStart } from '../core/sessions';
import type { ProBar, ProStore } from '../store/proStore';
import { fmtPx } from './layout';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';

/**
 * Warstwa wskaźnika „Zakresy P/b (Nill)” na wykresie ceny (interwały do 1 h, na żywo): zakresy P/b ze świec 5m z
 * dotknięciami i impulsem, poziomy profilu poprzedniego tygodnia i doby, miejsca 👀 (A, B, C) bez celów, przy
 * rozstrzygniętych wynik wyścigu do bariery (✓ ✗) oraz opis w legendzie: stan strefy, typowa godzina i wynik 👀 na
 * wczytanej historii świec. Strefa aktywna daje alarmy z menu wykresu.
 */

export interface PbStyle {
  color: string;
  alpha: number;
  width: number;
}

/** Ważna strefa przed wybiciem (do alarmów): krawędzie, kształt i koniec życia. */
export interface PbZone {
  s: 1 | -1;
  lo: number;
  hi: number;
  touches: number;
  until: number;
}

const MAX_TF = 3_600_000;
const DAY = 86_400_000;
/** Świece 5m: od tygodnia przed początkiem bieżącego tygodnia (profil poprzedniego tygodnia z rozbiegiem ATR). */
const FROM_BEFORE_WEEK = 8 * DAY;
const MIN_BARS = 200;
const HORIZON_BARS = HORIZON_MS / TF_MS;

const WEEK = PRO.level;
const DAY_INK = rgba(PRO.ink2, 0.85);
const BACK = rgba(PRO.bg, 0.86);
/** Przybliżona szerokość znaku podpisu (px, czcionka 10 px) do rozsuwania podpisów 👀. */
const LABEL_W = 6.5;

interface Mark {
  spot: Spot;
  t: number;
  dim: boolean;
  flow: boolean;
  res: Outcome | null;
}

interface View {
  ranges: Range[];
  /** Poziom poprzedniego tygodnia w zasięgu zakresu ± 0,5 ATR; po indeksie zakresu. */
  level: boolean[];
  marks: Mark[][];
  week: Levels | null;
  day: Levels | null;
  hourBp: number | null;
  /** Wyniki rozstrzygniętych 👀 z wczytanej historii po regule i liczba dni tej historii. */
  results: Record<Rule, (Outcome | null)[]>;
  days: number;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  label: string;
  touches: { x: number; y: number; n: number }[];
  imp: [number, number, number, number];
}

interface DrawnMark {
  x: number;
  y: number;
  /** Środek podpisu: pod ceną dla kupna, nad nią dla sprzedaży, odsunięty od wcześniejszych podpisów obok. */
  ty: number;
  side: 1 | -1;
  text: string;
  dim: boolean;
}

interface HLine {
  x0: number;
  x1: number;
  y: number;
  color: string;
  text: string;
}

type State = 'off' | 'replay' | 'interval' | 'loading' | 'ready';

const pct = (x: number) => `${numLang(String(Math.round(x * 100)))}%`;

export class PbRangeLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private style: PbStyle | null = null;
  private state: State = 'off';
  private phone = false;
  private bars: readonly ProBar[] = [];
  private ms = 60_000;
  private now = 0;
  private rightInset = 0;
  private right = 0;
  private b5: Bar5[] = [];
  private key = '';
  private view: View | null = null;
  private boxes: Box[] = [];
  private marks: DrawnMark[] = [];
  private lines: HLine[] = [];
  private readonly views: readonly IPrimitivePaneView[];

  /** `styleOf` — styl widocznego wskaźnika (null — ukryty: bez rysowania i bez pobierania świec 5m). */
  constructor(private readonly styleOf: () => PbStyle | null) {
    const back: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          for (const r of this.boxes) {
            const band = (r.y1 - r.y0) * 0.2;
            ctx.fillStyle = rgba(st.color, 0.06 * st.alpha);
            ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
            ctx.fillStyle = rgba(st.color, 0.1 * st.alpha);
            ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, band);
            ctx.fillRect(r.x0, r.y1 - band, r.x1 - r.x0, band);
          }
        }),
    };
    const front: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          ctx.font = `600 10px ${MONO}`;
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 1;
          for (const l of this.lines) {
            ctx.strokeStyle = l.color;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(l.x0, Math.round(l.y) + 0.5);
            ctx.lineTo(l.x1, Math.round(l.y) + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
            const w = ctx.measureText(l.text).width;
            ctx.fillStyle = BACK;
            ctx.fillRect(l.x1 - w - 8, l.y - 7, w + 6, 14);
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, l.x1 - w - 5, l.y);
          }
          const edge = rgba(st.color, Math.max(0.35, 0.85 * st.alpha));
          for (const r of this.boxes) {
            ctx.strokeStyle = edge;
            ctx.lineWidth = st.width;
            // Linia nieparzystej grubości na środku piksela (ostra krawędź)
            const o = st.width % 2 ? 0.5 : 0;
            ctx.strokeRect(Math.round(r.x0) + o, Math.round(r.y0) + o, Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0));
            ctx.lineWidth = 1;
            const [ix0, iy0, ix1, iy1] = r.imp;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(ix0, iy0);
            ctx.lineTo(ix1, iy1);
            ctx.stroke();
            ctx.setLineDash([]);
            const lw = ctx.measureText(r.label).width;
            const lx = Math.max(2, Math.min(r.x0 + 3, this.right - lw - 4));
            ctx.fillStyle = BACK;
            ctx.fillRect(lx - 3, r.y0 - 15, lw + 6, 14);
            ctx.fillStyle = edge;
            ctx.fillText(r.label, lx, r.y0 - 8);
            ctx.textAlign = 'center';
            for (const t of r.touches) {
              ctx.beginPath();
              ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
              ctx.fillStyle = BACK;
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = PRO.ink1;
              ctx.fillText(String(t.n), t.x, t.y + 0.5);
            }
            ctx.textAlign = 'left';
          }
          ctx.textAlign = 'center';
          for (const m of this.marks) {
            ctx.globalAlpha = m.dim ? 0.45 : 1;
            const dy = m.side > 0 ? 14 : -14;
            ctx.fillStyle = PRO.ink1;
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(m.x - 4, m.y + dy * 0.5);
            ctx.lineTo(m.x + 4, m.y + dy * 0.5);
            ctx.closePath();
            ctx.fill();
            const w = ctx.measureText(m.text).width;
            ctx.fillStyle = BACK;
            ctx.fillRect(m.x - w / 2 - 3, m.ty - 7, w + 6, 14);
            ctx.fillStyle = PRO.ink1;
            ctx.fillText(m.text, m.x, m.ty);
          }
          ctx.textAlign = 'left';
          ctx.globalAlpha = 1;
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => back },
      // Krawędzie, podpisy i 👀 nad świecami (świeca nie zasłania tekstu)
      { zOrder: () => 'top', renderer: () => front },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  /** Świece wykresu; przeliczenie zakresów tylko po nowej zamkniętej świecy 5m albo doczytanej historii. */
  setData(bars: readonly ProBar[], ms: number, now: number, store: ProStore, phone: boolean): void {
    this.bars = bars;
    this.ms = ms;
    this.now = now;
    this.phone = phone;
    this.state = !this.styleOf() ? 'off' : store.replay ? 'replay' : ms > MAX_TF ? 'interval' : this.state === 'ready' ? 'ready' : 'loading';
    if (this.state !== 'loading' && this.state !== 'ready') {
      this.view = null;
      this.key = '';
      this.requestUpdate?.();
      return;
    }
    const c5 = store.indicatorCandles('5m', utcWeekStart(now) - FROM_BEFORE_WEEK);
    let n = c5.length;
    while (n > 0 && c5[n - 1].t + TF_MS > now) n--;
    const key = `${store.coin}|${n}|${n > 0 ? c5[n - 1].t : 0}|${c5[0]?.t ?? 0}`;
    if (key !== this.key) {
      this.key = key;
      this.b5 = c5.slice(0, n).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v * c.c }));
      this.recalc(store);
    }
    this.requestUpdate?.();
  }

  private recalc(store: ProStore): void {
    const b = this.b5;
    if (b.length < MIN_BARS) {
      this.view = null;
      this.state = 'loading';
      return;
    }
    this.state = 'ready';
    const rs = ranges(b);
    const A = atr(b);
    const weeks = new Map<number, Levels | null>();
    const weekOf = (t: number) => {
      const w = utcWeekStart(t);
      if (!weeks.has(w)) weeks.set(w, weekLevels(b, t));
      return weeks.get(w)!;
    };
    const level = rs.map((r) => {
      const k = r.kv ?? b.length - 1;
      const lv = weekOf(b[k].t);
      return lv !== null && [lv.vah, lv.val, ...lv.lvn].some((x) => x >= r.lo - 0.5 * A[k] && x <= r.hi + 0.5 * A[k]);
    });
    const results: View['results'] = { A: [], B: [], C: [] };
    const marks = rs.map((r) =>
      r.spots.map((s): Mark => {
        const t = b[s.k].t + TF_MS;
        const h = typicalHourBp(b, t);
        const res = h === null ? null : resolve({ t, side: s.side, px: s.px, h }, b.slice(s.k + 1, s.k + 2 + HORIZON_BARS), this.now);
        if (h !== null) results[s.rule].push(res);
        return {
          spot: s,
          t,
          dim: !inDtWindow(t),
          flow: s.rule !== 'A' && r.x !== null && this.flow(store, b, r, s),
          res,
        };
      }),
    );
    this.view = {
      ranges: rs,
      level,
      marks,
      week: weekOf(this.now),
      day: dayLevels(b, this.now),
      hourBp: typicalHourBp(b, this.now),
      results,
      days: (b[b.length - 1].t + TF_MS - b[0].t) / DAY,
    };
  }

  /** Wybicie z agresją taśmy w jego stronę i rosnącym OI (od świecy wybicia do świecy miejsca); bez taśmy albo OI — nie. */
  private flow(store: ProStore, b: readonly Bar5[], r: Range, s: Spot): boolean {
    const from = b[r.x!].t;
    const to = b[s.k].t + TF_MS;
    if (!store.coverage.covers(from, to)) return false;
    const oi0 = store.oi.atWithin(from, 180_000);
    const oi1 = store.oi.atWithin(to, 180_000);
    if (oi0 === null || oi1 === null) return false;
    let d = 0;
    store.tape.forEach(from, to, (_t, _px, sz, side) => (d += side * sz));
    const dirx = s.rule === 'B' ? s.side : -s.side;
    return Math.sign(d) === dirx && oi1 > oi0;
  }

  updateAllViews(): void {
    this.boxes = [];
    this.marks = [];
    this.lines = [];
    this.style = this.styleOf();
    const v = this.view;
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    if (!this.style || !v || !chart || !series || bars.length === 0) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    this.right = right;
    const x = (t: number) => Math.min(right, xa + (logicalOfTime(bars, t, this.ms) - 0.5) * sp);
    const y = (p: number) => series.priceToCoordinate(p);
    const b = this.b5;
    const last = b.length - 1;
    for (const [lv, from, color, tag] of [
      [v.week, utcWeekStart(this.now), WEEK, tr('tydz.', 'wk')],
      [v.day, utcDayStart(this.now), DAY_INK, tr('doba', 'day')],
    ] as const) {
      if (!lv) continue;
      const items: [number, string][] = [[lv.vah, 'VAH'], [lv.poc, 'POC'], [lv.val, 'VAL'], ...lv.lvn.map((p): [number, string] => [p, 'LVN'])];
      for (const [p, name] of items) {
        const yy = y(p);
        if (yy === null) continue;
        this.lines.push({
          x0: Math.max(0, x(from)),
          x1: right,
          y: yy,
          color,
          text: this.phone ? `${tag} ${name}` : `${tag} ${name} ${fmtPx(p)}`,
        });
      }
    }
    v.ranges.forEach((r, i) => {
      const x0 = x(b[r.e + 1].t);
      const live = r.kv === null || (r.x === null && r.end === last && r.kv + LIFE > last);
      const x1 = live ? right : x(b[r.end].t + TF_MS);
      const ya = y(r.hi);
      const yb = y(r.lo);
      const yo = y(r.origin);
      const ye = y(r.ext);
      if (ya === null || yb === null || yo === null || ye === null || x1 < 0 || x0 > right) return;
      const y0 = Math.min(ya, yb);
      const y1 = Math.max(ya, yb);
      const wBp = numLang(String(Math.round(((r.hi - r.lo) / r.lo) * 1e4)));
      const name = r.s > 0 ? 'P' : 'b';
      const state = r.kv === null ? tr(' · w budowie', ' · forming') : '';
      const lvTag = v.level[i] && !this.phone ? tr(' · poziom tyg.', ' · weekly level') : '';
      const label = this.phone
        ? `${name} · ${r.touches.length} · ${wBp} bp${state}`
        : `${name} 5m · ${r.touches.length} ${tr('dotkn.', 'touches')} · ${wBp} bp${lvTag}${state}`;
      this.boxes.push({
        x0,
        x1,
        y0,
        y1,
        label,
        touches: r.touches.map((t, n) => ({
          x: x(b[t.k].t) + sp / 2,
          y: t.side > 0 ? y0 : y1,
          n: n + 1,
        })),
        imp: [x(b[r.e - 15].t), yo, x(b[r.e].t + TF_MS), ye],
      });
      for (const m of v.marks[i]) {
        const yy = y(m.spot.px);
        if (yy === null) continue;
        const res = m.res === 'hit' ? ' ✓' : m.res === 'miss' ? ' ✗' : '';
        const text = `👀 ${m.spot.rule}${m.flow ? ' ⚡' : ''}${res}`;
        const xx = x(m.t);
        const dy = m.spot.side > 0 ? 14 : -14;
        // Podpisy blisko siebie (wejście tuż przed wybiciem i powrót tuż po nim) jeden pod drugim, nie na sobie
        let ty = yy + dy;
        for (let k = 0; k < 3 && this.marks.some((o) => Math.abs(o.x - xx) < LABEL_W * (text.length + o.text.length) * 0.5 && Math.abs(o.ty - ty) < 14); k++) ty += dy;
        this.marks.push({ x: xx, y: yy, ty, side: m.spot.side, text, dim: m.dim });
      }
    });
  }

  /** Najnowszy ważny zakres przed wybiciem i końcem życia. */
  private active(): Range | null {
    const v = this.view;
    if (!v) return null;
    const last = this.b5.length - 1;
    for (let i = v.ranges.length - 1; i >= 0; i--) {
      const r = v.ranges[i];
      if (r.kv !== null && r.x === null && r.kv + LIFE > last) return r;
    }
    return null;
  }

  /** Strefa do alarmów: ważna, przed wybiciem i z życiem po bieżącej chwili. */
  zone(): PbZone | null {
    const r = this.active();
    if (!r || this.state !== 'ready') return null;
    const until = this.b5[r.kv!].t + (LIFE + 1) * TF_MS;
    return until > this.now ? { s: r.s, lo: r.lo, hi: r.hi, touches: r.touches.length, until } : null;
  }

  /** Opis w legendzie: stan strefy, typowa godzina i wynik 👀 z wczytanej historii świec 5m. */
  legend(color: string): { text: string; color: string }[] {
    if (this.state === 'replay')
      return [
        {
          text: tr('w powtórce niedostępne', 'not available in replay'),
          color: PRO.ink3,
        },
      ];
    if (this.state === 'interval')
      return [
        {
          text: tr('na interwałach do 1 h', 'on intervals up to 1 h'),
          color: PRO.ink3,
        },
      ];
    const v = this.view;
    if (!v)
      return [
        {
          text: tr('czekam na świece 5m…', 'waiting for 5m candles…'),
          color: PRO.ink3,
        },
      ];
    const a = this.active();
    const forming = v.ranges.find((r) => r.kv === null);
    let zone = tr('brak ważnej strefy', 'no valid zone');
    if (a) zone = `${a.s > 0 ? 'P' : 'b'} ${fmtPx(a.lo)}–${fmtPx(a.hi)} · ${a.touches.length} ${tr('dotkn.', 'touches')}`;
    else if (forming) {
      const min = (this.b5.length - 1 - forming.e) * 5;
      const hm = `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
      zone = `${forming.s > 0 ? 'P' : 'b'} ${tr('w budowie', 'forming')} · ${forming.touches.length} ${tr('dotkn.', 'touches')} · ${hm} ${tr('z', 'of')} 4:00`;
    }
    const parts = [{ text: zone, color: a ? color : PRO.ink2 }];
    if (v.hourBp !== null)
      parts.push({
        text: `${tr('typowa godzina', 'typical hour')} ${numLang(String(Math.round(v.hourBp)))} bp`,
        color: PRO.ink2,
      });
    const all = score([...v.results.A, ...v.results.B, ...v.results.C]);
    const days = numLang(String(Math.round(v.days)));
    if (all.n === 0 || !all.ci)
      parts.push({
        text: tr(`👀 z ${days} dni: brak rozstrzygnięć`, `👀 over ${days} days: none settled`),
        color: PRO.ink3,
      });
    else if (this.phone)
      parts.push({
        text: `👀 ${all.hits}/${all.n} = ${pct(all.ci.p)}`,
        color: PRO.ink2,
      });
    else {
      const rules = (['A', 'B', 'C'] as const).map((r) => {
        const s = score(v.results[r]);
        return `${r} ${s.hits}/${s.n}`;
      });
      parts.push({
        text: tr(
          `👀 z ${days} dni: ${rules.join(' · ')} · razem ${pct(all.ci.p)} (95% ${pct(all.ci.lo)}–${pct(all.ci.hi)}), bez przewagi ≈ 50%`,
          `👀 over ${days} days: ${rules.join(' · ')} · all ${pct(all.ci.p)} (95% ${pct(all.ci.lo)}–${pct(all.ci.hi)}), no edge ≈ 50%`,
        ),
        color: PRO.ink2,
      });
    }
    return parts;
  }
}
