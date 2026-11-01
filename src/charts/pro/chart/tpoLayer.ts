import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  MouseEventParams,
  Point,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { fmtVol } from '../../orderflow/footprint';
import { fmtSignedVol } from '../../orderflow/renderer';
import { profileTick, type DayProfile } from '../../../utils/dayProfile';
import { baseTick } from '../core/footprintBar';
import { nakedPocs } from '../core/indicators';
import { DAY } from '../core/time';
import { TpoProfile, tapeDayProfile, tpoDay, tpoDays, tpoInterval, tpoPocPx, tpoSingles } from '../core/tpo';
import { dayProfileOf } from '../store/dayProfiles';
import type { ProBar, ProStore } from '../store/proStore';
import { autoRowStep, fmtPx } from './layout';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';

/**
 * Profil aukcji każdej doby na wykresie ceny (szablon Market Profile): od początku doby w prawo słupek wolumenu w każdym
 * wierszu ceny. Kolor słupka mówi, która strona była agresywna na tej cenie (delta z taśmy: zieleń kupno, fiolet
 * sprzedaż, im mocniejszy, tym większa przewaga; szary = bez przewagi albo bez taśmy). Cienki obrys to czas (TPO: ile
 * 30-minutowych okresów doby dotknęło wiersza), przeskalowany do tego samego pola co wolumen doby: słupek dłuższy niż obrys
 * znaczy, że na tej cenie obrót był szybszy niż średnio w dobie, obrys dłuższy niż słupek — cena tam stała przy małym
 * obrocie. POC wolumenu linią przez dobę, nagi POC do prawej krawędzi, z lewej pasek value area i zakresu pierwszej
 * godziny doby, przy wierszu znacznik pojedynczych wydruków i ogonów, pod profilem delta doby, pod krzyżem liczby wiersza.
 *
 * Tryb pozycji: kolor wiersza z zmiany OI przypisanej cenie (src/utils/dayProfile.ts) — pełny słupek, gdy OI netto rosło
 * (zieleń przy przewadze kupna: nowe longi, fiolet przy sprzedaży: nowe shorty), obrys, gdy spadało (zieleń: zamykanie
 * shortów, fiolet: zamykanie longów); odcień z udziału zmiany OI netto w wolumenie wiersza. Doby zamknięte z profilem
 * serwera mają kolor z jego pliku (7 dób), bieżąca — z taśmy i OI w pamięci (przeliczana najwyżej co FLOW_EVERY_MS).
 */

/** Docelowa wysokość wiersza profilu (px). */
const ROW_PX = 5;
/** Najdłuższy słupek widocznych dób zajmuje taki ułamek szerokości doby. */
const DAY_FILL = 0.75;
const NAKED_MAX = 6;
/**
 * Progi |kupno − sprzedaż| / (kupno + sprzedaż) wiersza dla kolejnych odcieni rampy strony (strona ma 55, 60, 67,5 i 77,5%
 * wolumenu); poniżej pierwszego równowaga. Na taśmie BTC z 7 dób (25.10–1.11.2026, wiersz 25 USD) najsilniejszy odcień
 * ma ok. 10% wolumenu, a równowagę ok. 30%.
 */
export const DELTA_STEPS = [0.1, 0.2, 0.35, 0.55] as const;
/** Wiersz, w którym taśma ma mniejszy udział w wolumenie, rysujemy jako „bez taśmy”. */
export const TAPE_MIN = 0.5;
/**
 * Progi |zmiana OI netto| / wolumen taśmy wiersza dla odcieni trybu pozycji: kwartyle i 90. centyl ważone wolumenem
 * na taśmie BTC z 7 dób (25.10–31.10.2026, wiersz 25 USD) — najsilniejszy odcień ma ok. 10% wolumenu, szary ok. 25%.
 */
export const OI_STEPS = [0.07, 0.14, 0.25, 0.4] as const;
/** Profil bieżącej doby z taśmy przeliczamy najwyżej tak często (ms). */
const FLOW_EVERY_MS = 5_000;
/** Delta doby pod profilem tylko na dobie szerszej niż tyle px. */
const LABEL_MIN_W = 56;
const FONT = `500 10px ${MONO}`;

/** Krycie odcieni 1–4 strony agresywnej (0 = szary jak bez taśmy); poza value area słabiej. */
const SIDE_ALPHA = [0.2, 0.34, 0.52, 0.74];
const OUT_FACTOR = 0.6;
const ramp = (c: string, f: number) => ['', ...SIDE_ALPHA.map((a) => rgba(c, Math.min(1, a * f)))];
/** Zamykanie pozycji: obrys w kolorze strony i słabe wypełnienie. */
const CLOSE_FILL = 0.3;
const CLOSE_STROKE = 1.3;
const T = {
  poc: PRO.profilePoc,
  nakedPoc: PRO.nakedPoc,
  va: rgba(PRO.ink2, 0.7),
  ib: PRO.svwap,
  single: PRO.warn,
  tail: rgba(PRO.ink2, 0.55),
  time: rgba(PRO.ink1, 0.7),
  buyVa: ramp(PRO.buyInk, 1),
  buyOut: ramp(PRO.buyInk, OUT_FACTOR),
  sellVa: ramp(PRO.sellInk, 1),
  sellOut: ramp(PRO.sellInk, OUT_FACTOR),
  buyVaFaint: ramp(PRO.buyInk, CLOSE_FILL),
  buyOutFaint: ramp(PRO.buyInk, OUT_FACTOR * CLOSE_FILL),
  sellVaFaint: ramp(PRO.sellInk, CLOSE_FILL),
  sellOutFaint: ramp(PRO.sellInk, OUT_FACTOR * CLOSE_FILL),
  buyVaLine: ramp(PRO.buyInk, CLOSE_STROKE),
  buyOutLine: ramp(PRO.buyInk, OUT_FACTOR * CLOSE_STROKE),
  sellVaLine: ramp(PRO.sellInk, CLOSE_STROKE),
  sellOutLine: ramp(PRO.sellInk, OUT_FACTOR * CLOSE_STROKE),
  grayVa: rgba(PRO.profileVa, 0.6),
  grayOut: rgba(PRO.profileOut, 0.4),
  labelBg: rgba(PRO.bg, 0.8),
  tipBg: rgba(PRO.bg, 0.94),
  tipLine: rgba(PRO.ink3, 0.6),
};

/** Odcień rampy strony (0 = równowaga, 4 = najsilniejsza przewaga) z agresywnego kupna i sprzedaży wiersza. */
export function deltaLevel(buy: number, sell: number): number {
  const v = buy + sell;
  if (!(v > 0)) return 0;
  const d = Math.abs(buy - sell) / v;
  let k = 0;
  while (k < DELTA_STEPS.length && d >= DELTA_STEPS[k]) k++;
  return k;
}

/** Wiersz z taśmą w co najmniej połowie wolumenu. */
const taped = (p: TpoProfile, r: number) => p.vol[r] > 0 && (p.buy[r] + p.sell[r]) / p.vol[r] >= TAPE_MIN;

/** Kolor wiersza: strona agresywna z taśmy; szary bez przewagi strony albo bez taśmy (liczby pod krzyżem mówią które). */
function rowColor(p: TpoProfile, r: number): string {
  const va = r >= p.vaLo && r <= p.vaHi;
  const b = p.buy[r];
  const s = p.sell[r];
  const k = taped(p, r) ? deltaLevel(b, s) : 0;
  if (k === 0) return va ? T.grayVa : T.grayOut;
  return (b >= s ? (va ? T.buyVa : T.buyOut) : va ? T.sellVa : T.sellOut)[k];
}

/** Rodzaj zmiany pozycji wiersza: 0 bez przewagi albo bez danych, 1 nowe longi, 2 nowe shorty, 3 zamykanie shortów, 4 zamykanie longów. */
export type PosKind = 0 | 1 | 2 | 3 | 4;

/**
 * Pozycje wiersza: zmiana OI netto (rosnące minus malejące), rodzaj i odcień 0–4 z |netto| / wolumen taśmy wiersza;
 * bez danych OI (mniej niż połowa taśmy doby w minutach z odczytem OI) albo bez taśmy — rodzaj 0 i odcień 0.
 */
export function posOf(p: TpoProfile, r: number): { kind: PosKind; level: number; net: number; known: boolean } {
  const net = p.ob[r] + p.os[r] - (p.cb[r] + p.cs[r]);
  const tape = p.buy[r] + p.sell[r];
  const known = p.oiShare >= TAPE_MIN && taped(p, r) && tape > 0;
  if (!known) return { kind: 0, level: 0, net, known };
  const x = Math.abs(net) / tape;
  let level = 0;
  while (level < OI_STEPS.length && x >= OI_STEPS[level]) level++;
  const kind: PosKind = level === 0 ? 0 : net > 0 ? (p.ob[r] >= p.os[r] ? 1 : 2) : p.cb[r] >= p.cs[r] ? 3 : 4;
  return { kind, level, net, known };
}

/** Kolory wiersza w trybie pozycji: wypełnienie i obrys (zamykanie). */
function posColor(p: TpoProfile, r: number): { fill: string; stroke?: string } {
  const va = r >= p.vaLo && r <= p.vaHi;
  const { kind, level } = posOf(p, r);
  if (kind === 0) return { fill: va ? T.grayVa : T.grayOut };
  const buy = kind === 1 || kind === 3;
  if (kind <= 2) return { fill: (buy ? (va ? T.buyVa : T.buyOut) : va ? T.sellVa : T.sellOut)[level] };
  return {
    fill: (buy ? (va ? T.buyVaFaint : T.buyOutFaint) : va ? T.sellVaFaint : T.sellOutFaint)[level],
    stroke: (buy ? (va ? T.buyVaLine : T.buyOutLine) : va ? T.sellVaLine : T.sellOutLine)[level],
  };
}

const POS_LABEL: readonly [string, string][] = [
  ['bez wyraźnej przewagi', 'no clear lead'],
  ['nowe longi', 'new longs'],
  ['nowe shorty', 'new shorts'],
  ['zamykanie shortów', 'shorts closing'],
  ['zamykanie longów', 'longs closing'],
];

/** Liczby pozycji wiersza pod krzyżem: zmiana OI netto i rodzaj, części rosnące i malejące przy kupnie i sprzedaży. */
export function posTip(p: TpoProfile, r: number): string[] {
  const { kind, net, known } = posOf(p, r);
  if (!known) return [tr('Pozycje: bez danych OI', 'Positions: no OI data')];
  const [pl, en] = POS_LABEL[kind];
  return [
    tr(`OI ${fmtSignedVol(net)} · ${pl}`, `OI ${fmtSignedVol(net)} · ${en}`),
    tr(`OI rośnie: przy kupnie ${fmtVol(p.ob[r])} · przy sprzedaży ${fmtVol(p.os[r])}`, `OI rising: on buying ${fmtVol(p.ob[r])} · on selling ${fmtVol(p.os[r])}`),
    tr(`OI spada: przy kupnie ${fmtVol(p.cb[r])} · przy sprzedaży ${fmtVol(p.cs[r])}`, `OI falling: on buying ${fmtVol(p.cb[r])} · on selling ${fmtVol(p.cs[r])}`),
  ];
}

const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${numLang((x * 100).toFixed(1))}%`;

/** Liczby wiersza pod krzyżem: zakres ceny, wolumen, strony agresji (albo brak taśmy) i czas. */
export function rowTip(p: TpoProfile, r: number): string[] {
  const lo = (p.lo + r) * p.step;
  const v = p.vol[r];
  const b = p.buy[r];
  const s = p.sell[r];
  const tape = v > 0 ? (b + s) / v : 0;
  const side =
    tape >= TAPE_MIN
      ? tr(`Kupno ${pct0(b / (b + s))} · sprzedaż ${pct0(s / (b + s))}`, `Buy ${pct0(b / (b + s))} · sell ${pct0(s / (b + s))}`) +
        (tape < 0.995 ? tr(` (taśma ${pct0(tape)})`, ` (tape ${pct0(tape)})`) : '')
      : tr('Bez taśmy: wolumen ze świec', 'No tape: volume from candles');
  const n = p.rows[r].length;
  return [
    `${fmtPx(lo)}–${fmtPx(lo + p.step)}`,
    tr(`Wolumen ${fmtVol(v)} · ${pct1(p.total > 0 ? v / p.total : 0)} doby`, `Volume ${fmtVol(v)} · ${pct1(p.total > 0 ? v / p.total : 0)} of the day`),
    side,
    tr(`Czas: ${n} × 30 min`, `Time: ${n} × 30 min`),
  ];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  stroke?: string;
}

interface Mark {
  x: number;
  y0: number;
  y1: number;
  color: string;
  w: number;
}

interface Line {
  x0: number;
  x1: number;
  y: number;
  color: string;
  dash: boolean;
}

interface Label {
  x: number;
  y: number;
  text: string;
  color: string;
}

interface Tip {
  x: number;
  y: number;
  right: number;
  lines: string[];
}

interface DayCache {
  step: number;
  refs: readonly ProBar[];
  file: DayProfile | null;
  flow: DayProfile | null;
  p: TpoProfile | null;
}

/** Profil doby z taśmy w pamięci (tylko OI w trybie pozycji): podpis taśmy i odczytów OI oraz chwila przeliczenia. */
interface FlowCache {
  sig: string;
  at: number;
  p: DayProfile | null;
}

const sameRefs = (refs: readonly ProBar[], bars: readonly ProBar[], from: number, to: number) => {
  if (refs.length !== to - from + 1) return false;
  for (let i = 0; i < refs.length; i++) if (refs[i] !== bars[from + i]) return false;
  return true;
};

export class TpoLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  private on: boolean;
  private positions: boolean;
  private store: ProStore | null = null;
  private flows = new Map<number, FlowCache>();
  private bars: readonly ProBar[] = [];
  private ms = 60_000;
  private rightInset = 0;
  private hover: Point | null = null;
  private cache = new Map<number, DayCache>();

  private rects: Rect[] = [];
  private outlines: number[][] = [];
  private marks: Mark[] = [];
  private lines: Line[] = [];
  private labels: Label[] = [];
  private tip: Tip | null = null;
  private readonly views: readonly IPrimitivePaneView[];

  private readonly onMove = (p: MouseEventParams<Time>) => {
    const next = p.point && p.paneIndex === 0 ? p.point : null;
    if (next === null && this.hover === null) return;
    this.hover = next;
    if (this.on) this.requestUpdate?.();
  };

  constructor(on: boolean, positions: boolean) {
    this.on = on;
    this.positions = positions;
    // Słupki pod świecami (świece zostają czytelne), obrys czasu, linie i znaczniki nad nimi, liczby wiersza na wierzchu
    const bars: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.lineWidth = 1;
          for (const r of this.rects) {
            ctx.fillStyle = r.color;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            if (r.stroke && r.w >= 3 && r.h >= 3) {
              ctx.strokeStyle = r.stroke;
              ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.max(1, Math.round(r.w) - 1), Math.max(1, Math.round(r.h) - 1));
            }
          }
        }),
    };
    const over: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.lineWidth = 1;
          ctx.strokeStyle = T.time;
          for (const pts of this.outlines) {
            ctx.beginPath();
            for (let i = 0; i < pts.length; i += 2) {
              const px = Math.round(pts[i]) + 0.5;
              const py = Math.round(pts[i + 1]) + 0.5;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          for (const l of this.lines) {
            ctx.strokeStyle = l.color;
            ctx.setLineDash(l.dash ? [4, 3] : []);
            ctx.beginPath();
            const y = Math.round(l.y) + 0.5;
            ctx.moveTo(l.x0, y);
            ctx.lineTo(l.x1, y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          for (const m of this.marks) {
            ctx.fillStyle = m.color;
            ctx.fillRect(m.x, Math.min(m.y0, m.y1), m.w, Math.max(1, Math.abs(m.y1 - m.y0)));
          }
          ctx.font = FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          for (const l of this.labels) {
            const w = ctx.measureText(l.text).width;
            ctx.fillStyle = T.labelBg;
            ctx.fillRect(l.x - 2, l.y - 7, w + 4, 14);
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, l.x, l.y);
          }
        }),
    };
    const tipR: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const tip = this.tip;
          if (!tip) return;
          ctx.font = FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const lh = 14;
          const w = Math.max(...tip.lines.map((s) => ctx.measureText(s).width)) + 12;
          const h = tip.lines.length * lh + 8;
          const x = Math.max(4, Math.min(tip.x, tip.right - w - 4));
          const y = Math.max(4, Math.min(tip.y - h / 2, mediaSize.height - h - 4));
          ctx.fillStyle = T.tipBg;
          ctx.fillRect(x, y, w, h);
          ctx.lineWidth = 1;
          ctx.strokeStyle = T.tipLine;
          ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
          tip.lines.forEach((s, i) => {
            ctx.fillStyle = i === 0 ? PRO.ink1 : PRO.ink2;
            ctx.fillText(s, x + 6, y + 4 + lh / 2 + i * lh);
          });
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => bars },
      { zOrder: () => 'normal', renderer: () => over },
      { zOrder: () => 'top', renderer: () => tipR },
    ];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
    p.chart.subscribeCrosshairMove(this.onMove);
  }

  detached(): void {
    this.chart?.unsubscribeCrosshairMove(this.onMove);
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setOn(on: boolean, positions: boolean): void {
    this.on = on;
    this.positions = positions;
    this.requestUpdate?.();
  }

  setRightInset(px: number): void {
    this.rightInset = px;
    this.requestUpdate?.();
  }

  setData(bars: readonly ProBar[], ms: number, store: ProStore): void {
    this.bars = bars;
    this.ms = ms;
    this.store = store;
    this.requestUpdate?.();
  }

  /**
   * Profil doby z taśmy w pamięci dla trybu pozycji (doby bez pliku serwera); doba w toku przeliczana najwyżej co
   * FLOW_EVERY_MS, zamknięta — tylko po zmianie taśmy albo odczytów OI.
   */
  private flowFor(store: ProStore, day: number, now: number, px: number): DayProfile | null {
    const times = store.oi.times();
    const sig = `${store.tape.signature(day, day + DAY)}|${times.length}:${times[times.length - 1] ?? 0}`;
    const hit = this.flows.get(day);
    if (hit && (hit.sig === sig || (day + DAY > now && now - hit.at < FLOW_EVERY_MS))) return hit.p;
    const p = tapeDayProfile(store.tape, store.oi, store.coin, day, profileTick(px));
    this.flows.set(day, { sig, at: now, p });
    return p;
  }

  /**
   * Profile dób na siatce `step`; doba liczona od nowa tylko wtedy, gdy zmieniła się któraś jej świeca, krok albo źródło
   * (plik serwera, profil z taśmy).
   */
  private profiles(bars: readonly ProBar[], step: number): TpoProfile[] {
    const next = new Map<number, DayCache>();
    const out: TpoProfile[] = [];
    const store = this.store;
    const now = store?.serverNow() ?? 0;
    const flows = new Map<number, FlowCache>();
    for (const d of tpoDays(bars)) {
      const key = bars[d.from].t;
      const day = Math.floor(key / DAY) * DAY;
      const file = store ? dayProfileOf(store, day) : null;
      const flow = store && !file && this.positions ? this.flowFor(store, day, now, bars[d.from].candle.o) : null;
      const f = this.flows.get(day);
      if (f) flows.set(day, f);
      const hit = this.cache.get(key);
      const entry =
        hit && hit.step === step && hit.file === file && hit.flow === flow && sameRefs(hit.refs, bars, d.from, d.to) && hit.p?.complete === d.complete
          ? hit
          : { step, refs: bars.slice(d.from, d.to + 1), file, flow, p: tpoDay(bars, d.from, d.to, step, d.complete, { file, flow, ms: this.ms }) };
      next.set(key, entry);
      if (entry.p) out.push(entry.p);
    }
    this.cache = next;
    this.flows = flows;
    return out;
  }

  updateAllViews(): void {
    this.rects = [];
    this.outlines = [];
    this.marks = [];
    this.lines = [];
    this.labels = [];
    this.tip = null;
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    if (!this.on || !chart || !series || bars.length === 0 || !tpoInterval(this.ms)) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (!range || xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    const ref = bars[bars.length - 1].candle.c;
    const y = (p: number) => series.priceToCoordinate(p);
    const ya = y(ref);
    const yb = y(ref + 100);
    if (ya === null || yb === null) return;
    const pxPerUsd = Math.abs(ya - yb) / 100;
    const step = pxPerUsd > 0 ? autoRowStep(pxPerUsd, baseTick(ref), ROW_PX) : 0;
    if (!(step > 0)) return;
    const list = this.profiles(bars, step);
    const gap = step * pxPerUsd >= 3 ? 1 : 0;
    // Lewa krawędź świecy o początku t (także poza danymi)
    const x = (t: number) => xa + (logicalOfTime(bars, t, this.ms) - 0.5) * sp;
    const vf = bars[Math.max(0, Math.floor(range.from))]?.t ?? bars[0].t;
    const vt = bars[Math.min(bars.length - 1, Math.ceil(range.to))]?.t ?? bars[bars.length - 1].t;
    const visible = (p: TpoProfile) => p.day + DAY > vf && p.day <= vt;

    // Wspólna skala wolumenu widocznych dób, żeby profile dało się porównać
    let maxVol = 0;
    for (const p of list) if (visible(p)) maxVol = Math.max(maxVol, p.max);
    const kVol = maxVol > 0 ? ((DAY / this.ms) * sp * DAY_FILL) / maxVol : 0;
    const hv = this.hover;

    const naked = nakedPocs(bars, list.map((p) => ({ to: p.to, complete: p.complete, pocPx: tpoPocPx(p) })));
    let shownNaked = 0;
    for (let k = list.length - 1; k >= 0; k--) {
      const p = list[k];
      const x0 = x(p.day);
      const x1 = Math.min(right, x(p.day + DAY));
      const yPoc = y(tpoPocPx(p));
      if (naked[k] && shownNaked < NAKED_MAX && yPoc !== null && x1 < right) {
        shownNaked++;
        this.lines.push({ x0: Math.max(0, x1), x1: right, y: yPoc, color: T.nakedPoc, dash: true });
      }
      if (!visible(p) || x0 > right) continue;
      const w = Math.max(0, x1 - x0);
      // Czas w tym samym polu co wolumen doby: px na jeden okres 30 min
      let periods = 0;
      for (const r of p.rows) periods += r.length;
      const kTime = periods > 0 ? (p.total * kVol) / periods : 0;
      const { singles, tails } = tpoSingles(p);
      const pts: number[] = [];
      for (let r = 0; r < p.rows.length; r++) {
        const yTop = y((p.lo + r + 1) * p.step);
        const yBot = y((p.lo + r) * p.step);
        if (yTop === null || yBot === null) continue;
        const wv = Math.min(w, p.vol[r] * kVol);
        const wt = Math.min(w, p.rows[r].length * kTime);
        if (wv > 0) {
          const c = this.positions ? posColor(p, r) : { fill: rowColor(p, r) };
          this.rects.push({ x: x0, y: yTop, w: Math.max(1, wv), h: Math.max(1, yBot - yTop - gap), color: c.fill, stroke: c.stroke });
        }
        if (pts.length === 0) pts.push(x0, yBot);
        pts.push(x0 + wt, yBot, x0 + wt, yTop);
        const end = x0 + Math.max(wv, wt);
        if (singles[r] || tails[r]) this.marks.push({ x: Math.min(x1, end + 2), y0: yTop, y1: yBot, color: singles[r] ? T.single : T.tail, w: 2 });
        if (hv && hv.y >= yTop && hv.y < yBot && hv.x >= x0 && hv.x <= Math.min(x1, end + 4)) {
          this.tip = { x: Math.min(x1, end) + 10, y: (yTop + yBot) / 2, right, lines: this.positions ? [...rowTip(p, r), ...posTip(p, r)] : rowTip(p, r) };
        }
      }
      if (pts.length > 0) {
        pts.push(x0, pts[pts.length - 1]);
        this.outlines.push(pts);
      }
      if (yPoc !== null) this.lines.push({ x0, x1, y: yPoc, color: T.poc, dash: false });
      // Pasek value area i pierwszej godziny doby z lewej strony profilu
      const yVah = y((p.lo + p.vaHi + 1) * p.step);
      const yVal = y((p.lo + p.vaLo) * p.step);
      if (yVah !== null && yVal !== null) this.marks.push({ x: x0 - 3, y0: yVah, y1: yVal, color: T.va, w: 2 });
      if (p.ib) {
        const yh = y(p.ib.hi);
        const yl = y(p.ib.lo);
        if (yh !== null && yl !== null) this.marks.push({ x: x0 - 7, y0: yh, y1: yl, color: T.ib, w: 2 });
      }
      // Delta doby z taśmy pod profilem (z udziałem taśmy w wolumenie, gdy nie objęła całej doby); w trybie pozycji zmiana OI
      let buy = 0;
      let sell = 0;
      let oi = 0;
      for (let r = 0; r < p.rows.length; r++) {
        buy += p.buy[r];
        sell += p.sell[r];
        oi += p.ob[r] + p.os[r] - p.cb[r] - p.cs[r];
      }
      const share = p.total > 0 ? (buy + sell) / p.total : 0;
      const yLow = y(p.lo * p.step);
      if (share >= 0.05 && w >= LABEL_MIN_W && yLow !== null) {
        const tape = share < 0.995 ? tr(` · taśma ${pct0(share)}`, ` · tape ${pct0(share)}`) : '';
        if (!this.positions) this.labels.push({ x: x0 + 2, y: yLow + 10, text: `Δ ${fmtSignedVol(buy - sell)}${tape}`, color: buy >= sell ? PRO.buyInk : PRO.sellInk });
        else if (p.oiShare >= TAPE_MIN) this.labels.push({ x: x0 + 2, y: yLow + 10, text: `OI ${fmtSignedVol(oi)}${tape}`, color: PRO.ink1 });
      }
    }
  }
}
