import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { type Bar5, LIFE, type Levels, type Range, TF_MS, atr, ranges, typicalHourBp, weekLevels } from '../core/pbRanges';
import { utcDayStart, utcWeekStart } from '../core/sessions';
import { valueReference } from '../core/valueReference';
import { dayProfileOf } from '../store/dayProfiles';
import type { ProBar, ProStore } from '../store/proStore';
import { valueSourceFrom } from './layoutInputs';
import { fmtPx } from './layout';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';
import { PB_TOUCHES, boxSpan, formingNote, nearestLevels, selectRanges } from './pbSelect';

/**
 * Warstwa wskaźnika „Zakresy P/b (Nill)” na wykresie ceny (interwały do 1 h, na żywo): zakresy P/b ze świec 5m z
 * dotknięciami i impulsem, poziomy profilu poprzedniego tygodnia i doby (doba z jednego źródła wartości `valueReference`,
 * jak pasek Rama dnia) oraz opis w legendzie: stan strefy i typowa godzina. Opis struktury, bez miejsc wejścia. Strefa aktywna daje alarmy z menu wykresu. Co rysujemy (zakres aktywny
 * i ostatni zakończony, 2 + 2 najbliższe poziomy, bez zakresu w budowie) wybiera `pbSelect.ts`.
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

const WEEK = PRO.level;
const DAY_INK = rgba(PRO.ink2, 0.85);
const BACK = rgba(PRO.bg, 0.86);

interface View {
  ranges: Range[];
  /** Poziom poprzedniego tygodnia w zasięgu zakresu ± 0,5 ATR; po indeksie zakresu. */
  level: boolean[];
  week: Levels | null;
  day: Levels | null;
  hourBp: number | null;
}

interface Box {
  x0: number;
  /** Początek wypełnienia i ciągłego obrysu: świeca potwierdzenia (wcześniej obrys kropkowany). */
  xf: number;
  x1: number;
  /** Wypełnienie tylko zakresu aktywnego; ostatni zakończony — sam obrys. */
  fill: boolean;
  y0: number;
  y1: number;
  label: string;
  touches: { x: number; y: number; n: number }[];
  imp: [number, number, number, number];
}

interface HLine {
  x0: number;
  x1: number;
  y: number;
  color: string;
  text: string;
}

type State = 'off' | 'replay' | 'interval' | 'loading' | 'ready';

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
  private lines: HLine[] = [];
  /** Po każdej scenie: pudełka i linie poziomów na ekranie (pomiar układu czyta je z wykresu). */
  onCounts: ((c: { boxes: number; lines: number }) => void) | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  /** `styleOf` — styl widocznego wskaźnika (null — ukryty: bez rysowania i bez pobierania świec 5m). */
  constructor(private readonly styleOf: () => PbStyle | null) {
    const back: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          for (const r of this.boxes) {
            if (!r.fill || r.x1 <= r.xf) continue;
            const band = (r.y1 - r.y0) * 0.2;
            ctx.fillStyle = rgba(st.color, 0.06 * st.alpha);
            ctx.fillRect(r.xf, r.y0, r.x1 - r.xf, r.y1 - r.y0);
            ctx.fillStyle = rgba(st.color, 0.1 * st.alpha);
            ctx.fillRect(r.xf, r.y0, r.x1 - r.xf, band);
            ctx.fillRect(r.xf, r.y1 - band, r.x1 - r.xf, band);
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
            // Linia nieparzystej grubości na środku piksela (ostra krawędź); przed potwierdzeniem cienki obrys kropkowany
            const o = st.width % 2 ? 0.5 : 0;
            if (r.x1 > r.xf) ctx.strokeRect(Math.round(r.xf) + o, Math.round(r.y0) + o, Math.round(r.x1 - r.xf), Math.round(r.y1 - r.y0));
            ctx.lineWidth = 1;
            if (r.xf > r.x0) {
              ctx.setLineDash([1, 3]);
              ctx.strokeRect(Math.round(r.x0) + 0.5, Math.round(r.y0) + 0.5, Math.round(r.xf - r.x0), Math.round(r.y1 - r.y0));
              ctx.setLineDash([]);
            }
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
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => back },
      // Krawędzie i podpisy nad świecami (świeca nie zasłania tekstu)
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
    // Plik taśmy wczorajszej doby dochodzi z serwera później: jego pojawienie się też przelicza poziomy doby
    const file = dayProfileOf(store, utcDayStart(now) - DAY) ? 1 : 0;
    const key = `${store.coin}|${n}|${n > 0 ? c5[n - 1].t : 0}|${c5[0]?.t ?? 0}|${file}`;
    if (key !== this.key) {
      this.key = key;
      this.b5 = c5.slice(0, n).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v * c.c }));
      this.recalc(store, c5);
    }
    this.requestUpdate?.();
  }

  private recalc(store: ProStore, c5: readonly ProBar['candle'][]): void {
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
    this.view = {
      ranges: rs,
      level,
      week: weekOf(this.now),
      day: this.dayOf(store, c5),
      hourBp: typicalHourBp(b, this.now),
    };
  }

  /** Poziomy wczorajszej doby UTC z jednego źródła wartości (te same VAH, VAL i POC co pasek Rama dnia). */
  private dayOf(store: ProStore, c5: readonly ProBar['candle'][]): Levels | null {
    const from = utcDayStart(this.now) - DAY;
    const r = valueReference('day', from, valueSourceFrom(store, c5, from), this.now);
    return r ? { poc: r.poc, vah: r.vah, val: r.val, lvn: [] } : null;
  }

  updateAllViews(): void {
    this.boxes = [];
    this.lines = [];
    this.style = this.styleOf();
    this.scene();
    this.onCounts?.({ boxes: this.boxes.length, lines: this.lines.length });
  }

  private scene(): void {
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
    // Poziomy tygodnia i doby: najwyżej 2 najbliższe nad ceną i 2 pod nią (z obu profili razem)
    const levels: { px: number; name: string; from: number; color: string; tag: string }[] = [];
    for (const [lv, from, color, tag] of [
      [v.week, utcWeekStart(this.now), WEEK, tr('tydz.', 'wk')],
      [v.day, utcDayStart(this.now), DAY_INK, tr('doba', 'day')],
    ] as const) {
      if (!lv) continue;
      const items: [number, string][] = [[lv.vah, 'VAH'], [lv.poc, 'POC'], [lv.val, 'VAL'], ...lv.lvn.map((p): [number, string] => [p, 'LVN'])];
      for (const [px, name] of items) levels.push({ px, name, from, color, tag });
    }
    const near = nearestLevels(levels, b[last].c);
    levels.forEach((l, i) => {
      const yy = y(l.px);
      if (!near.has(i) || yy === null) return;
      this.lines.push({
        x0: Math.max(0, x(l.from)),
        x1: right,
        y: yy,
        color: l.color,
        text: this.phone ? `${l.tag} ${l.name}` : `${l.tag} ${l.name} ${fmtPx(l.px)}`,
      });
    });
    // Zakres aktywny i ostatni zakończony; zakres w budowie tylko w legendzie
    const pick = selectRanges(v.ranges, last);
    const drawn = [pick.done, pick.active].filter((i): i is number => i !== null);
    for (const i of drawn) {
      const r = v.ranges[i];
      const active = i === pick.active;
      const span = boxSpan(r, last, active);
      const x0 = x(b[span.from].t);
      const xf = x(b[span.fillFrom].t);
      const x1 = span.open ? right : x(b[span.to].t + TF_MS);
      const ya = y(r.hi);
      const yb = y(r.lo);
      const yo = y(r.origin);
      const ye = y(r.ext);
      if (ya === null || yb === null || yo === null || ye === null || x1 < 0 || x0 > right) continue;
      const y0 = Math.min(ya, yb);
      const y1 = Math.max(ya, yb);
      const wBp = numLang(String(Math.round(((r.hi - r.lo) / r.lo) * 1e4)));
      const name = r.s > 0 ? 'P' : 'b';
      const state = active ? '' : tr(' · zakończony', ' · ended');
      const lvTag = v.level[i] && !this.phone ? tr(' · poziom tyg.', ' · weekly level') : '';
      const label = this.phone
        ? `${name} · ${r.touches.length} · ${wBp} bp${state}`
        : `${name} 5m · ${r.touches.length} ${tr('dotkn.', 'touches')} · ${wBp} bp${lvTag}${state}`;
      this.boxes.push({
        x0,
        xf,
        x1,
        fill: active,
        y0,
        y1,
        label,
        // Kółka dotknięć tylko przy zakresie aktywnym
        touches: active
          ? r.touches.map((t, n) => ({
              x: x(b[t.k].t) + sp / 2,
              y: t.side > 0 ? y0 : y1,
              n: n + 1,
            }))
          : [],
        imp: [x(b[r.e - 15].t), yo, x(b[r.e].t + TF_MS), ye],
      });
    }
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

  /** Opis w legendzie: stan strefy i typowa godzina. */
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
    const forming = formingNote(v.ranges);
    let zone = tr('brak ważnej strefy', 'no valid zone');
    if (a) zone = `${a.s > 0 ? 'P' : 'b'} ${fmtPx(a.lo)}–${fmtPx(a.hi)} · ${a.touches.length} ${tr('dotkn.', 'touches')}`;
    else if (forming) {
      // Zakres w budowie nie jest rysowany: tylko w legendzie, z liczbą dotknięć z 3 potrzebnych i czasem z 4 h
      const min = (this.b5.length - 1 - forming.e) * 5;
      const hm = `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
      const n = forming.touches;
      const word = n === 1 ? 'dotknięcie' : n >= 2 && n <= 4 ? 'dotknięcia' : 'dotknięć';
      zone = `${forming.s > 0 ? 'P' : 'b'} ${tr(`w budowie: ${n} ${word} z ${PB_TOUCHES}`, `forming: ${n} of ${PB_TOUCHES} touches`)} · ${hm} ${tr('z', 'of')} 4:00`;
    }
    const parts = [{ text: zone, color: a ? color : PRO.ink2 }];
    if (v.hourBp !== null)
      parts.push({
        text: `${tr('typowa godzina', 'typical hour')} ${numLang(String(Math.round(v.hourBp)))} bp`,
        color: PRO.ink2,
      });
    return parts;
  }
}
