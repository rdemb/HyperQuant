import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { tr } from '../../../i18n';
import { numLang } from '../../../ui/format';
import { DEFAULT_EFFORT_PARAMS, type EffortResult, type Side, type SwingLvnTest, type SwingProfile, type VBar, effortZones, swingLvnTest } from '../core/effortZones';
import { shownLvn } from '../core/lvn';
import { PATHS_PENDING, lvnLabel } from './lvnText';
import type { FootprintBar } from '../core/footprintBar';
import { fmtDayTime } from '../core/time';
import { fmtDuration } from '../draw/model';
import type { Candle } from '../hl/parse';
import { type EffortBand, type EffortSelection, TAPE_SPAN, type ZoneKnown, effortRects, selectEffort } from './effortSelect';
import { logicalOfTime } from './overlay';
import { MONO, PRO, rgba } from './theme';

/**
 * Warstwa wskaźnika „Strefy absorpcji i pudełka Effort” na wykresie ceny (interwały do 1 h, na żywo i w powtórce). Model
 * (`effortZones`) liczy wszystkie strefy i pudełka na zamkniętych świecach; rysowany jest wybór `selectEffort` na
 * ostatniej zamkniętej świecy: pasma stref aktywnych i uzbrojonych najbliższe cenie (od świecy powstania, ze
 * znacznikiem A, D, F w rogu i kreską na krańcu swingu), obrys przebitej przez 6 świec i ostatnia seria pudełek każdej
 * strony (wypełnienie na świecach serii, w prawo dwie linie krawędzi). Tryb „Historia” — wszystko obrysami. Strefy w
 * kolorach poziomów (pod ceną ciemniejszy bursztyn, nad ceną jaśniejszy), pudełka w kolorach strony agresora.
 */

/** Styl widocznego wskaźnika: krycie wypełnień, grubość obrysów (kolory stron są stałe) i tryb „Historia”. */
export interface EffortStyle {
  alpha: number;
  width: number;
  history?: boolean;
}

/** Świeca wykresu z taśmą (ProBar): delta agresorów i wiersze cen z footprintu oraz czy świeca jest w całości nagrana. */
export interface EffortSourceBar {
  t: number;
  candle: Candle;
  fp: Pick<FootprintBar, 'delta' | 'tick' | 'lo' | 'buy' | 'sell'> | null;
  complete: boolean;
}

const MAX_TF = 3_600_000;
/** Wypełnienie pasma i świec serii pudełek (mnożone przez krycie stylu). */
const ZONE_FILL = 0.13;
const BOX_FILL = 0.3;

/**
 * Kolory stref z rodziny poziomów (plan 59, C2): strefa pod ceną bursztyn poziomów, nad ceną jego jaśniejszy odcień.
 * Strefa to miejsce, gdzie rynek przyjął agresję, a nie strona transakcji, więc bez kolorów kupna i sprzedaży.
 */
export const ZONE_BELOW = PRO.level;
export const ZONE_ABOVE = PRO.levelSoft;
export function zoneInk(a: number): (s: Side) => string {
  const below = rgba(ZONE_BELOW, a);
  const above = rgba(ZONE_ABOVE, a);
  return (s) => (s === 1 ? below : above);
}

/** Kolory pudełek Effort z kryciem `a`: strona agresora świecy (kupno albo sprzedaż transakcji, nie zalecenie). */
function sideInk(a: number): (s: Side) => string {
  const buy = rgba(PRO.buy, a);
  const sell = rgba(PRO.sell, a);
  return (s) => (s === 1 ? buy : sell);
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface BandRect extends Rect {
  side: Side;
  mark: string;
  /** Wypełnione (pasmo aktywne); obrys sam — przebita albo tryb „Historia”. */
  fill: boolean;
  dim: boolean;
  /** Kreski krańców swingu: x od–do i y. */
  ticks: { x0: number; x1: number; y: number }[];
}

interface BoxRect extends Rect {
  side: Side;
  /** Świece serii (wypełnienie) i krawędzie w prawo (x końca), w trybie „Historia” bez nich. */
  cells: { x0: number; x1: number }[];
  edgeTo: number;
}

/** Liczba zamkniętych świec (koniec ≤ `now`) na początku listy rosnącej po czasie. */
function closedCount(bars: readonly EffortSourceBar[], ms: number, now: number): number {
  let n = bars.length;
  while (n > 0 && bars[n - 1].t + ms > now) n--;
  return n;
}

/**
 * Świeca modelu: delta i wiersze cen (profil swingu) z footprintu tylko przy świecy w całości nagranej, inaczej null —
 * brak taśmy, bez przybliżenia delty ze świecy. Wiersze to te same tablice footprintu (bez kopii).
 */
const toVBar = (b: EffortSourceBar): VBar => {
  const fp = b.complete ? b.fp : null;
  return {
    t: b.t,
    o: b.candle.o,
    h: b.candle.h,
    l: b.candle.l,
    c: b.candle.c,
    v: b.candle.v,
    delta: fp ? fp.delta : null,
    tape: fp ? { tick: fp.tick, lo: fp.lo, buy: fp.buy, sell: fp.sell } : null,
  };
};

/** Zamknięte świece wykresu (koniec ≤ `now`) jako świece modelu; świeca w trakcie nie wchodzi. */
export function closedBars(bars: readonly EffortSourceBar[], ms: number, now: number): VBar[] {
  return bars.slice(0, closedCount(bars, ms, now)).map(toVBar);
}

/** Odmiana polska liczebnika: 1 strefa, 2–4 strefy, 5 stref (12–14 — jak 5). */
function pl(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

type LegendPart = { text: string; color: string };

/** „ostatnia świeca” albo „3 świece temu” od świecy `t` do chwili `asOf`. */
function candlesAgo(t: number, asOf: number, ms: number): string {
  const ago = Math.max(0, Math.round((asOf - t) / ms));
  return ago === 0 ? tr('ostatnia świeca', 'the last candle') : tr(`${ago} ${pl(ago, 'świeca', 'świece', 'świec')} temu`, `${ago} ${ago === 1 ? 'candle' : 'candles'} ago`);
}

/** Testy LVN profilu swingu (w kolejności `p.lvn`) albo za mało świec; null — nieznane. */
export type LvnTestOf = (p: SwingProfile) => SwingLvnTest | null;

/**
 * LVN profilu swingu po testach: tylko z filtrem położenia i p ≤ 0,05 wobec szumu pomiaru (najtrwalsze pierwsze),
 * węzeł jako „LVN (węzeł) cena”, szeroka dolina jako „LVA (obszar) od–do”, z głębokością względną i p; pozostałe tylko
 * liczbą („w granicach szumu”); test wobec losowych ścieżek w przygotowaniu; bez testu „—” z powodem.
 */
export function lvnText(p: SwingProfile, t: SwingLvnTest | null, fmt: (p: number) => string): string {
  if (p.lvn.length === 0) return '';
  if (!t) return tr(', LVN: —, test nieznany', ', LVN: —, test unknown');
  if ('short' in t) {
    const { have, need } = t.short;
    return tr(`, LVN: —, za mało świec do testu (${have} z ${need})`, `, LVN: —, too few candles for a test (${have} of ${need})`);
  }
  const all = p.lvn.map((l, i) => ({ ...l, ...t.tests[i] }));
  const kept = shownLvn(all);
  const cut = all.length - kept.length;
  if (kept.length === 0) return tr(`, LVN: —, w granicach szumu pomiaru (${cut})`, `, LVN: —, within measurement noise (${cut})`);
  const rest = cut > 0 ? tr(`; ${cut} w granicach szumu`, `; ${cut} within noise`) : '';
  return `, ${kept.map((l) => lvnLabel(l, false, false, fmt)).join('; ')}${rest} · ${PATHS_PENDING}`;
}

/** Profil swingu strefy D: POC, VA, LVN po testach i plakietka źródła (z taśmy albo przybliżenie ze świec). */
function profileText(p: SwingProfile, fmt: (p: number) => string, conf: SwingLvnTest | null): string {
  const lvn = lvnText(p, conf, fmt);
  const src =
    p.tapeShare >= 1
      ? tr('z taśmy', 'from the tape')
      : p.tapeShare > 0
        ? tr(`przybliżenie: taśma ${numLang(String(Math.round(p.tapeShare * 100)))}%`, `approximation: tape ${Math.round(p.tapeShare * 100)}%`)
        : tr('przybliżenie: ze świec', 'approximation: from candles');
  return tr(`· profil swingu: POC ${fmt(p.poc)}, VA ${fmt(p.val)}–${fmt(p.vah)}${lvn} · ${src}`, `· swing profile: POC ${fmt(p.poc)}, VA ${fmt(p.val)}–${fmt(p.vah)}${lvn} · ${src}`);
}

/**
 * Czas dostępności strefy: od kiedy była znana (zamknięcie świecy powstania) i ile po zamknięciu świecy krańca, żeby
 * pasma rysowanego od krańca nie brać za wiedzę z chwili krańca; F powstaje na zamknięciu przebicia.
 */
function knownText(k: ZoneKnown, mark: string, asOf: number, fmt: (p: number) => string, conf: LvnTestOf): LegendPart[] {
  const at = fmtDayTime(k.at, asOf);
  const text =
    k.kind === 'flip'
      ? tr(`· strefa ${mark} znana od ${at}, na zamknięciu przebicia`, `· zone ${mark} known from ${at}, at the close of the break`)
      : tr(`· strefa ${mark} znana od ${at}, ${fmtDuration(k.lag)} po krańcu`, `· zone ${mark} known from ${at}, ${fmtDuration(k.lag)} after the extreme`);
  const out: LegendPart[] = [{ text, color: PRO.ink2 }];
  if (k.profile) out.push({ text: profileText(k.profile, fmt, conf(k.profile)), color: PRO.ink2 });
  return out;
}

const KIND_MARK = { absorption: 'A', discount: 'D', flip: 'F' } as const;

/** Pasmo pod krzyżem: cena w paśmie, czas od świecy powstania do końca (aktywne — bez końca). */
function bandAt(sel: EffortSelection, hover: { t: number; p: number }, ms: number): EffortBand | null {
  for (const b of [...sel.bands, ...(sel.broken ? [sel.broken] : [])]) {
    if (hover.p >= b.lo && hover.p <= b.hi && hover.t >= b.start && (b.end === null || hover.t < b.end + ms)) return b;
  }
  return null;
}

/**
 * Opis w legendzie z wyboru: pasma po stronach z liczbą dalszych, krańce bez oceny strefy A, ostatnia seria pudełek
 * (albo nowsza świeca bez taśmy) i świece z taśmą wśród 32 ostatnich; w trybie „Historia” liczby obrysów. Krzyż nad
 * pasmem dopisuje czas dostępności jego stref (i profil swingu D z LVN po testach z `lvnConf`). Powyżej 1 h powód braku,
 * bez zamkniętych świec — czekanie.
 */
export function effortLegend(
  sel: EffortSelection | null,
  ms: number,
  asOf: number,
  hover: { t: number; p: number } | null = null,
  fmt: (p: number) => string = (p) => numLang(String(p)),
  lvnConf: LvnTestOf = () => null
): LegendPart[] {
  if (ms > MAX_TF) return [{ text: tr('—, interwał do 1 h', '—, intervals up to 1 h'), color: PRO.ink3 }];
  if (!sel) return [{ text: tr('czekam na świece…', 'waiting for candles…'), color: PRO.ink3 }];
  const hovered = hover ? bandAt(sel, hover, ms) : null;
  const known = hovered ? hovered.known.flatMap((k) => knownText(k, KIND_MARK[k.kind], asOf, fmt, lvnConf)) : [];
  // Taśma na ostatnich 32 świecach: pudełko wymaga taśmy na swojej świecy i 19 przed nią
  const tape = { text: tr(`· taśma ${numLang(String(sel.tapeRecent))} z ${TAPE_SPAN}`, `· tape ${sel.tapeRecent} of ${TAPE_SPAN}`), color: PRO.ink2 };
  if (sel.history) {
    const z = sel.bands.length;
    const b = sel.boxes.length;
    return [
      { text: tr(`historia: ${z} ${pl(z, 'strefa', 'strefy', 'stref')}`, `history: ${z} ${z === 1 ? 'zone' : 'zones'}`), color: z > 0 ? PRO.ink1 : PRO.ink2 },
      { text: tr(`· ${b} ${pl(b, 'seria', 'serie', 'serii')} pudełek`, `· ${b} box ${b === 1 ? 'series' : 'series'}`), color: PRO.ink2 },
      tape,
      ...known,
    ];
  }
  const demand = sel.bands.filter((x) => x.side === 1).length;
  const supply = sel.bands.length - demand;
  const far = sel.far.demand + sel.far.supply;
  const zones = {
    text: tr(`strefy: ${demand} pod ceną · ${supply} nad ceną${far > 0 ? ` (dalej ${far})` : ''}`, `zones: ${demand} below price · ${supply} above price${far > 0 ? ` (${far} farther)` : ''}`),
    color: demand + supply > 0 ? PRO.ink1 : PRO.ink2,
  };
  // Krańce z ostatnich 12 h, przy których strefy A nie dało się ocenić bez taśmy
  const n = sel.untaped.zones;
  const gapA: LegendPart[] =
    n > 0 ? [{ text: tr(`· A: —, brak taśmy przy ${n} ${n === 1 ? 'krańcu' : 'krańcach'}`, `· A: —, no tape at ${n} swing ${n === 1 ? 'extreme' : 'extremes'}`), color: PRO.ink3 }] : [];
  if (sel.tapeRecent === 0) return [zones, ...gapA, { text: tr('· pudełka: —, brak taśmy', '· boxes: —, no tape'), color: PRO.ink3 }, ...known];
  const last = sel.boxes.reduce<EffortSelection['boxes'][number] | null>((a, b) => (!a || b.last > a.last ? b : a), null);
  const gapBox = sel.untaped.box;
  let box: LegendPart = { text: tr('· pudełko: —', '· box: —'), color: PRO.ink2 };
  if (gapBox !== null && (!last || gapBox > last.last)) {
    // Nowsza świeca, na której pudełko zależało od agresji bez taśmy: „—” z powodem, nie przybliżenie
    box = { text: tr(`· pudełko: —, brak taśmy, ${candlesAgo(gapBox, asOf, ms)}`, `· box: —, no tape, ${candlesAgo(gapBox, asOf, ms)}`), color: PRO.ink3 };
  } else if (last) {
    const side = last.side === 1 ? tr('kupno', 'buying') : tr('sprzedaż', 'selling');
    box = { text: tr(`· pudełko: ${side}, ${candlesAgo(last.last, asOf, ms)}`, `· box: ${side}, ${candlesAgo(last.last, asOf, ms)}`), color: PRO.ink2 };
  }
  return [zones, ...gapA, box, tape, ...known];
}

export class EffortLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private style: EffortStyle | null = null;
  private bars: readonly EffortSourceBar[] = [];
  private ms = 60_000;
  private now = 0;
  private rightInset = 0;
  private phone = false;
  /** Zamknięte świece ostatniego przeliczenia (te same obiekty — bez zmian), świece modelu i wynik. */
  private src: readonly EffortSourceBar[] = [];
  private srcMs = 0;
  private vbars: VBar[] = [];
  private result: EffortResult | null = null;
  /** Testy LVN profili swingu liczone leniwie pod kursorem, raz na profil (nowy wynik — nowe profile). */
  private lvnConf = new WeakMap<SwingProfile, SwingLvnTest>();
  private readonly lvnConfOf: LvnTestOf = (p) => {
    let c = this.lvnConf.get(p);
    if (!c) {
      c = swingLvnTest(this.vbars, p, this.srcMs);
      this.lvnConf.set(p, c);
    }
    return c;
  };
  /** Wybór do rysowania na ostatniej zamkniętej świecy i jego klucz (wynik, telefon, tryb). */
  private sel: EffortSelection | null = null;
  private selKey: readonly unknown[] = [];
  private bands: BandRect[] = [];
  private boxes: BoxRect[] = [];
  private readonly views: readonly IPrimitivePaneView[];
  /** Po każdym nowym wyborze: liczba prostokątów (pomiar układu czyta ją z wykresu). */
  onSelect: ((rects: number) => void) | null = null;

  /** `styleOf` — styl widocznego wskaźnika (null — ukryty: bez liczenia i rysowania). */
  constructor(private readonly styleOf: () => EffortStyle | null) {
    const back: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          const zone = zoneInk(ZONE_FILL * st.alpha);
          const box = sideInk(BOX_FILL * st.alpha);
          for (const z of this.bands) {
            if (!z.fill) continue;
            ctx.fillStyle = zone(z.side);
            ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
          }
          for (const b of this.boxes) {
            ctx.fillStyle = box(b.side);
            for (const c of b.cells) ctx.fillRect(c.x0, b.y0, c.x1 - c.x0, b.y1 - b.y0);
          }
        }),
    };
    const front: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          const st = this.style;
          if (!st) return;
          const a = Math.max(0.35, 0.85 * st.alpha);
          const live = zoneInk(a);
          const dim = zoneInk(0.4 * a);
          const boxInk = sideInk(a);
          // Linia nieparzystej grubości na środku piksela (ostra krawędź)
          const crisp = (v: number, w: number) => Math.round(v) + (w % 2 ? 0.5 : 0);
          const rect = (r: Rect, w: number) => {
            ctx.lineWidth = w;
            ctx.strokeRect(crisp(r.x0, w), crisp(r.y0, w), Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0));
          };
          const hline = (x0: number, x1: number, y: number, w: number) => {
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(Math.round(x0), crisp(y, w));
            ctx.lineTo(Math.round(x1), crisp(y, w));
            ctx.stroke();
          };
          ctx.font = `600 9px ${MONO}`;
          ctx.textBaseline = 'top';
          for (const z of this.bands) {
            const c = (z.dim ? dim : live)(z.side);
            ctx.strokeStyle = c;
            rect(z, st.width);
            // Kraniec swingu: krótka kreska na jego cenie i świecy, bez wypełnienia
            for (const t of z.ticks) hline(t.x0, t.x1, t.y, Math.max(1, st.width));
            // Znacznik rodzaju w lewym górnym rogu (przy paśmie zaczętym poza widokiem — przy lewej krawędzi)
            const lx = Math.max(z.x0, 0) + 3;
            if (z.x1 - lx < 8) continue;
            ctx.fillStyle = c;
            ctx.fillText(z.mark, lx, z.y0 + 2);
          }
          for (const b of this.boxes) {
            ctx.strokeStyle = boxInk(b.side);
            rect(b, Math.max(1, st.width - 1));
            // W prawo od serii dwie cienkie linie krawędzi zamiast wypełnionego prostokąta
            if (b.edgeTo > b.x1) {
              hline(b.x1, b.edgeTo, b.y0, 1);
              hline(b.x1, b.edgeTo, b.y1, 1);
            }
          }
        }),
    };
    this.views = [
      { zOrder: () => 'bottom', renderer: () => back },
      // Obrysy i znaczniki nad świecami
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

  /** Telefon: 1 pasmo na stronę, bez obrysu przebitej, 1 seria pudełek. */
  setPhone(on: boolean): void {
    if (on === this.phone) return;
    this.phone = on;
    this.reselect();
    this.requestUpdate?.();
  }

  /** Świece wykresu; przeliczenie tylko po zmianie zamkniętych świec (nowa, doczytana historia, taśma starszej świecy). */
  setData(bars: readonly EffortSourceBar[], ms: number, now: number): void {
    this.bars = bars;
    this.ms = ms;
    this.now = now;
    if (!this.styleOf() || ms > MAX_TF) {
      this.src = [];
      this.srcMs = 0;
      this.vbars = [];
      this.result = null;
      this.reselect();
      this.requestUpdate?.();
      return;
    }
    const n = closedCount(bars, ms, now);
    const same = ms === this.srcMs && this.src.length === n && this.src.every((b, i) => b === bars[i]);
    if (!same) {
      this.src = bars.slice(0, n);
      this.srcMs = ms;
      this.vbars = this.src.map(toVBar);
      this.result = n > 0 ? effortZones(this.vbars, ms) : null;
    }
    this.reselect();
    this.requestUpdate?.();
  }

  /** Wybór na ostatniej zamkniętej świecy — tylko po zmianie wyniku, telefonu albo trybu „Historia”. */
  private reselect(): void {
    const history = this.styleOf()?.history === true;
    const key = [this.result, this.phone, history];
    if (key.every((v, i) => Object.is(v, this.selKey[i]))) return;
    this.selKey = key;
    const r = this.result;
    const last = this.vbars[this.vbars.length - 1];
    this.sel = r && last ? selectEffort(r, this.vbars, this.srcMs, last.t, { phone: this.phone, history }) : null;
    this.onSelect?.(this.sel ? effortRects(this.sel) : 0);
  }

  updateAllViews(): void {
    this.bands = [];
    this.boxes = [];
    this.style = this.styleOf();
    this.reselect();
    const sel = this.sel;
    const chart = this.chart;
    const series = this.series;
    const bars = this.bars;
    const ms = this.ms;
    if (!this.style || !sel || !chart || !series || bars.length === 0 || ms > MAX_TF) return;
    const ts = chart.timeScale();
    const xa = ts.logicalToCoordinate(0 as Logical);
    const xb = ts.logicalToCoordinate(1 as Logical);
    if (xa === null || xb === null || !(xb > xa)) return;
    const sp = xb - xa;
    const right = chart.paneSize(0).width - this.rightInset;
    const x = (t: number) => Math.min(right, xa + (logicalOfTime(bars, t, ms) - 0.5) * sp);
    const y = (p: number) => series.priceToCoordinate(p);
    const span = (x0: number, x1: number, hi: number, lo: number): Rect | null => {
      if (x1 < 0 || x0 >= right) return null;
      const ya = y(hi);
      const yb = y(lo);
      return ya === null || yb === null ? null : { x0, x1, y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
    };
    const band = (z: EffortSelection['bands'][number], broken: boolean) => {
      const s = span(x(z.start), z.end === null ? right : x(z.end + ms), z.hi, z.lo);
      if (!s) return;
      const ticks = z.extremes.flatMap((e) => {
        const ty = y(e.p);
        return ty === null ? [] : [{ x0: x(e.t), x1: x(e.t + ms), y: ty }];
      });
      this.bands.push({ ...s, side: z.side, mark: z.mark, fill: !sel.history && !broken, dim: broken || (sel.history && z.end !== null), ticks });
    };
    for (const z of sel.bands) band(z, false);
    if (sel.broken) band(sel.broken, true);
    const ext = DEFAULT_EFFORT_PARAMS.boxExtend * ms;
    for (const b of sel.boxes) {
      const s = span(x(b.from), x(b.last + ms), b.hi, b.lo);
      if (!s) continue;
      this.boxes.push({ ...s, side: b.side, cells: sel.history ? [] : b.cells.map((t) => ({ x0: x(t), x1: x(t + ms) })), edgeTo: sel.history ? s.x1 : x(b.last + ext) });
    }
  }

  /** Opis w legendzie (z ostatniego wyboru); krzyż nad pasmem (`hover`) dopisuje czas dostępności jego stref. */
  legend(hover: { t: number; p: number } | null, fmt: (p: number) => string): { text: string; color: string }[] {
    const last = this.vbars[this.vbars.length - 1];
    return effortLegend(this.sel, this.ms, last ? last.t : this.now, hover, fmt, this.lvnConfOf);
  }

  /** Wybór na ostatniej zamkniętej świecy (legenda, testy). */
  selection(): EffortSelection | null {
    return this.sel;
  }
}
