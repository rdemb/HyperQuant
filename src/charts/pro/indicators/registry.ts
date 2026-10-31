import type { Candle, Side } from '../hl/parse';
import type { BookFrame } from '../core/book';
import type { MakerSplit } from '../core/makers';
import { type Branching, MIN_EVENTS, fitBranching } from '../core/hawkes';
import { fitBranchingLater, inBackground } from '../core/hawkesWorker';
import { ofiEvent } from '../../../utils/microMechanics';
import { Extreme, OlsWindow, RegimeDetector, RobustLine, Window, Wma, ema, rma } from './primitives';
import { INTERVALS, intervalById } from '../core/time';
import { numLang } from '../../../ui/format';
import { tr } from '../../../i18n';

/**
 * Rejestr klasycznych wskaźników: jeden opis na wskaźnik (nazwa, parametry, ploty, panel), z którego korzystają
 * ustawienia, menu, legenda i wykres. Wzory i wartości domyślne jak we wbudowanych wskaźnikach TradingView; poziomy
 * to same liczby — wskaźnik opisuje ostatnie świece, nie podpowiada wejść.
 */

export type IndicatorId =
  | 'sma'
  | 'ema'
  | 'hma'
  | 'vwma'
  | 'supertrend'
  | 'dmi'
  | 'rsi'
  | 'stoch'
  | 'stochrsi'
  | 'macd'
  | 'cci'
  | 'wpr'
  | 'bb'
  | 'keltner'
  | 'donchian'
  | 'atr'
  | 'chop'
  | 'obv'
  | 'cmf'
  | 'mfi'
  | 'pivots'
  | 'psar'
  | 'ichimoku'
  | 'linreg'
  | 'hv'
  | 'netvol'
  | 'oiflow'
  | 'absorption'
  | 'ofi'
  | 'regime'
  | 'ordersize'
  | 'cone'
  | 'slippage'
  | 'breadth'
  | 'repeat'
  | 'makers'
  | 'hawkes';

/**
 * Grupy na liście okna wskaźników (jak kategorie TradingView); `hyperquant` — wskaźniki, których nie ma w TradingView
 * (z danych Hyperliquid spoza świec albo z modeli na świecach), we własnej sekcji okna.
 */
export type IndicatorGroup = 'trend' | 'momentum' | 'volatility' | 'volume' | 'levels' | 'hyperquant';
export const GROUPS: readonly { id: IndicatorGroup; name: string }[] = [
  { id: 'trend', name: 'Trend' },
  { id: 'momentum', name: 'Momentum' },
  { id: 'volatility', name: tr('Zmienność', 'Volatility') },
  { id: 'volume', name: tr('Wolumen', 'Volume') },
  { id: 'levels', name: tr('Poziomy', 'Levels') },
];

/** Parametr liczbowy: zakres, krok pola i wartość domyślna (krok 1 = liczba całkowita). */
export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

export type Params = Readonly<Record<string, number>>;

/** Linia wskaźnika: przerywana (np. środek Bollingera) albo ciągła, w kolorze instancji albo stałym (druga linia, np. sygnał MACD). */
export interface PlotDef {
  dashed?: boolean;
  color?: string;
  /** Słupki od zera w kolorze znaku zamiast linii (histogram MACD). */
  hist?: boolean;
  /** Podpis przy wartości na osi ceny (poziomy pivot: P, R1, S1…). */
  title?: string;
  /** Poziom okresu: bez odcinka łączącego go z innym poziomem następnego okresu. */
  breaks?: boolean;
  /** Kropki zamiast linii (Parabolic SAR). */
  dots?: boolean;
  /** Przesunięcie o tyle świec (jak `offset` w Pine): dodatnie w przód, poza ostatnią świecę (chmura Ichimoku), ujemne wstecz. */
  shift?(p: Params): number;
  /** Słupki w kolorze znaku innego plotu (zmiana OI w kolorze delty). */
  signOf?: number;
  /** Bez rysowania, tylko wartość w legendzie (delta przy zmianie OI). */
  hidden?: boolean;
  /** Liczby tej wartości, gdy inne niż wskaźnika (OFI: β i R² obok wolumenu). */
  format?: IndicatorDef['format'];
}

/** Kolory stałych linii: drugiej i trzeciej linii wskaźnika oraz słupków dodatnich i ujemnych. */
const ORANGE = '#f2a93b';
const TEAL = '#2ec4b6';
const RED = '#e66767';
/** Jaśniejsze odcienie dla granic chmury Ichimoku. */
const LIGHT_TEAL = '#8ee0d8';
const LIGHT_RED = '#f2a7a7';
export const HIST_UP = TEAL;
export const HIST_DOWN = RED;

/** Krok wskaźnika: wartości plotów świecy do `out` (NaN = brak); `keep` zatwierdza zamkniętą świecę. */
export type Step = (c: Candle, keep: boolean, out: Float64Array) => void;

/** Świeca wykresu z taśmą (ProBar): footprint z deltą agresorów, `complete` — świeca w całości objęta nagraniem. */
export interface FlowBar {
  candle: Candle;
  fp?: { delta: number } | null;
  complete?: boolean;
}

/**
 * Dane Hyperliquid spoza świec: otwarte pozycje w chwili (null — brak odczytu), migawki arkusza najbliższej agregacji
 * (rosnąco po czasie), zlecenia agresora z taśmy (wypełnienia złożone w zlecenia) z [from, to) i ich liczba oraz bieżący
 * czas serwera.
 */
export interface FlowContext {
  oiAt(t: number): number | null;
  book(): readonly BookFrame[];
  /** Migawki arkusza bez agregacji ceny (rosnąco po czasie): tylko od otwarcia strony. */
  exactBook(): readonly BookFrame[];
  orders(from: number, to: number): readonly { time: number; side: Side; notional: number; taker: string }[];
  /** Czy taśma ma konta biorców przez cały [from, to) (strumień na żywo i historia serwera, bez zapisu przeglądarki). */
  identified(from: number, to: number): boolean;
  /** Delta agresorów w [from, to) przyjęta przez animatorów rynku i resztę makerów; null bez wypełnień z kontem makera. */
  makers(from: number, to: number): MakerSplit | null;
  orderCount(from: number, to: number): number;
  now: number;
  /** Ponowne przeliczenie, gdy dojdą wyniki liczone w tle (Web Worker). */
  later?(): void;
}

/** Wskaźnik liczony na wszystkich świecach naraz: wartości plotu k świecy i do `out[k][i]`. */
export type SeriesFn = (bars: readonly FlowBar[], ms: number, ctx: FlowContext, out: Float64Array[]) => void;

export interface IndicatorDef {
  id: IndicatorId;
  /** Skrót w legendzie i na liście (nazwy międzynarodowe bez tłumaczenia). */
  short: string;
  name: string;
  hint: string;
  group: IndicatorGroup;
  /** Dodatkowe słowa wyszukiwania (PL i EN). */
  aliases: string;
  /** Liczba świec bez wartości na początku historii (rozbieg, jak `na` w Pine). */
  warmup(p: Params): number;
  /**
   * α kolejnych średnich rekurencyjnych (EMA, RMA), np. MACD: wolna EMA i EMA sygnału — wartość zależy od całej historii.
   * Bez nich — tylko od ostatnich `warmup + 1` świec.
   */
  decay?(p: Params): number[];
  /** Okna stałe po średnich rekurencyjnych (Stoch RSI: okno min i max RSI i średnie proste): o tyle świec dalej sięga pamięć. */
  lag?(p: Params): number;
  /** Opis zależności od historii zamiast wyliczonego (np. suma od początku historii albo pasma trzymające poziom). */
  memoryNote?: string;
  /** Zgodność z TradingView, gdy wzór świadomie się różni (np. skala roczna HV). */
  convention?: string;
  /**
   * Stały okres (interwał świec, np. doba pivotów): liczone na jego świecach, a świeca wykresu bierze wartość okresu,
   * w którym leży — wzór sięga tylko po okresy zamknięte. Bez niego wskaźnik ma parametr „Interwał”.
   */
  period?: string;
  /** Na wykresie ceny albo we własnym panelu pod nim. */
  pane: 'price' | 'own';
  params: readonly ParamDef[];
  plots: readonly PlotDef[];
  /** Wypełnienie między dwoma plotami o tym samym przesunięciu (chmura Ichimoku): turkus, gdy pierwszy jest wyżej, czerwień w przeciwnym razie. */
  cloud?: readonly [number, number];
  /** Przedział wokół pierwszego plotu (dolna i górna granica): pasmo w kolorze wskaźnika, w legendzie w nawiasie. */
  band?: readonly [number, number];
  /** Linie poziomów w panelu (liczby bez podpisów) i stały zakres jego skali. */
  levels?: readonly number[];
  range?: readonly [number, number];
  /** Skala od zera (wartości nieujemne, np. koszt w pb): drobne wahania nie wyglądają jak skoki. */
  fromZero?: true;
  /** Liczby: cena z dokładnością ticku rynku, odległość ceny (o miejsce dokładniej niż tick), dwa albo trzy miejsca, wolumen, kwota USD. */
  format: 'price' | 'range' | 'fixed1' | 'fixed2' | 'fixed3' | 'count' | 'volume' | 'usd';
  /** Skala logarytmiczna panelu (wartości od ułamków po wielokrotności, np. kwoty zleceń). */
  log?: boolean;
  /** Krok świeca po świecy; bez niego wskaźnik to rysunek na ostatnich świecach (`fit`) albo z danych spoza świec (`flow`, `sample`). */
  create?(p: Params): Step;
  /**
   * Rysunek na ostatnich świecach (kanał regresji, jak w TradingView): liczony od nowa z ostatnich `span` świec przy
   * każdej zmianie; `at(0)` to najnowsza świeca, wartości plotu k świecy `end − j` trafiają do `out[k][end − j]`.
   */
  fit?: { span(p: Params): number; run(at: (j: number) => Candle, p: Params, out: Float64Array[], end: number): void };
  /**
   * Wskaźnik z danych Hyperliquid spoza świec (taśma, otwarte pozycje): wartości plotów świecy `b` o interwale `ms`
   * do `out`; liczony od nowa przy każdym przeliczeniu, bo dane dochodzą też do starszych świec.
   */
  flow?(b: FlowBar, ms: number, ctx: FlowContext, out: Float64Array): void;
  /**
   * Jak `flow`, ale na wszystkich świecach naraz (świeca zależy od poprzednich, a dane spoza świec przychodzą osobno, np.
   * migawki arkusza); funkcja na instancję, więc może pamiętać wyniki świec między przeliczeniami.
   */
  series?(p: Params): SeriesFn;
  /**
   * Rysunek z publicznych prognoz Desku (stożek zakresu): bez wartości świec i bez plotów — warstwa na wykresie ceny
   * i opis w legendzie z dziennika prognoz.
   */
  forecast?: true;
  /** Tyle świec przed lewą krawędzią widoku potrzeba danych z serwera (okno poprzednich świec: absorpcja, OFI). */
  lookback?(p: Params): number;
  /**
   * Wskaźnik z taśmy porównujący świecę z poprzednimi świecami (absorpcja): `point` zapisuje parę (x, y) świecy do `xy`
   * (false — świeca bez wartości), a krok z `create` liczy wartości plotów świecy z jej pary i par `span` poprzednich
   * świec z wartością (najnowsza pierwsza).
   */
  sample?: {
    span(p: Params): number;
    point(b: FlowBar, xy: Float64Array): boolean;
    create(p: Params): (x: number, y: number, xs: Float64Array, ys: Float64Array, out: Float64Array) => void;
  };
}

const length = (def: number): ParamDef => ({ key: 'length', label: tr('Długość', 'Length'), min: 1, max: 1000, step: 1, def });

/** True range świecy; pierwsza świeca (bez poprzedniego zamknięcia) to H − L, jak `ta.tr(true)`, albo NaN, jak `ta.tr` (DMI). */
const trueRange = (c: Candle, prevClose: number, first = c.h - c.l) =>
  Number.isNaN(prevClose) ? first : Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));

const int = (key: string, label: string, def: number): ParamDef => ({ key, label, min: 1, max: 1000, step: 1, def });
const mult = (def: number): ParamDef => ({ key: 'mult', label: tr('Mnożnik', 'Multiplier'), min: 0.1, max: 10, step: 0.1, def });

/** SMA z wartości, które mogą być NaN: `ta.sma` pomija `na` i liczy z n ostatnich liczb. */
const smaOf = (n: number) => {
  const w = new Window(n);
  return (x: number, keep: boolean) => {
    w.next(x, keep);
    return w.mean;
  };
};

/** EMA albo RMA serii z rozbiegiem `na`: wartości przed pierwszą liczbą pomijane, jak `ta.ema` na serii z `na` na początku. */
const smoothOf = (s: ReturnType<typeof ema>) => (x: number, keep: boolean) => (Number.isNaN(x) ? Number.NaN : s.next(x, keep));

/** RSI serii (`ta.rsi`): średnie Wildera wzrostów i spadków; pierwsza wartość nie ma zmiany (`na`), więc średnie zaczynają się od drugiej. */
const rsiOf = (n: number) => {
  const up = rma(n);
  const down = rma(n);
  let prev = Number.NaN;
  return (x: number, keep: boolean) => {
    const d = x - prev;
    if (keep) prev = x;
    if (Number.isNaN(d)) return Number.NaN;
    const u = up.next(Math.max(d, 0), keep);
    const w = down.next(Math.max(-d, 0), keep);
    return Number.isNaN(u) ? Number.NaN : w === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / w);
  };
};

/** Typowa cena świecy (`hlc3`). */
const hlc3 = (c: Candle) => (c.h + c.l + c.c) / 3;

/** Zwroty, z których liczony jest prior wariancji reżimu (jak w prognozie zakresu: co najmniej 100). */
export const REGIME_PRIOR = 100;
/** Najdłuższy śledzony reżim (świece); dłuższe w ostatniej komórce rozkładu. */
const REGIME_RUNS = 600;

/** Średnia a priori wariancji zwrotów: odporna (mediana kwadratów / 0,4549), nie mniej niż ¼ średniej kwadratów. */
export function regimePrior(xs: readonly number[]): number {
  const sq = xs.map((x) => x * x).sort((a, b) => a - b);
  const mean = sq.reduce((s, x) => s + x, 0) / sq.length;
  return Math.max(1e-12, sq[sq.length >> 1] / 0.4549, 0.25 * mean);
}

/** Przedziały kwot zleceń: 20 na dekadę (krok ok. 12%) od 1 do 100 mln USD; skrajne zbierają resztę. */
export const SIZE_BINS_PER_DECADE = 20;
const SIZE_BINS = 8 * SIZE_BINS_PER_DECADE;
const sizeBin = (usd: number) => Math.min(SIZE_BINS - 1, Math.max(0, Math.floor(SIZE_BINS_PER_DECADE * Math.log10(usd))));

/** Kwantyl próby posortowanej rosnąco z interpolacją liniową (jak domyślny w R i numpy). */
export function quantileSorted(xs: ArrayLike<number>, q: number): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  return lo + 1 < n ? xs[lo] + (h - lo) * (xs[lo + 1] - xs[lo]) : xs[lo];
}

/** Kwantyl z przedziałów: przedział z kwantylem, w nim interpolacja na skali logarytmicznej. */
function quantileBins(h: ArrayLike<number>, total: number, q: number): number {
  const target = q * total;
  let acc = 0;
  for (let k = 0; k < h.length; k++) {
    if (h[k] > 0 && acc + h[k] >= target) return 10 ** ((k + (target - acc) / h[k]) / SIZE_BINS_PER_DECADE);
    acc += h[k];
  }
  return Number.NaN;
}

/**
 * Statystyka Kołmogorowa–Smirnowa na przedziałach ze znakiem przesunięcia: dodatnia, gdy zlecenia świecy są większe niż
 * w bazie (jej dystrybuanta leży niżej), ujemna, gdy mniejsze.
 */
function signedKs(a: ArrayLike<number>, na: number, b: ArrayLike<number>, nb: number): number {
  let fa = 0;
  let fb = 0;
  let up = 0;
  let down = 0;
  for (let k = 0; k < a.length; k++) {
    fa += a[k] / na;
    fb += b[k] / nb;
    up = Math.max(up, fb - fa);
    down = Math.max(down, fa - fb);
  }
  return up >= down ? up : -down;
}

/** Zlecenia agresora jednej świecy: kwantyle kwot i ich przedziały. */
interface SizeStats {
  n: number;
  q: [number, number, number];
  bins: Uint32Array;
}

function sizeStats(orders: readonly { notional: number }[]): SizeStats {
  const xs = Float64Array.from(orders, (o) => o.notional).sort();
  const bins = new Uint32Array(SIZE_BINS);
  for (const x of xs) bins[sizeBin(x)]++;
  return { n: xs.length, q: [quantileSorted(xs, 0.5), quantileSorted(xs, 0.9), quantileSorted(xs, 0.99)], bins };
}

/** Najdłuższa przerwa między porównywanymi migawkami arkusza (kanał co ~5 s; dłuższa to przerwa w danych). */
export const OFI_MAX_GAP = 12_000;
/** Od tego R² podawana jest oczekiwana zmiana ceny; niżej OFI w oknie prawie nie tłumaczy ruchu ceny. */
export const OFI_MIN_R2 = 0.1;

/** Najlepsze kwotowania migawki (kubełki najbliższej agregacji); null bez obu stron. */
const quoteOf = (f: BookFrame) =>
  f.nBids > 0 && f.nBids < f.px.length ? { bid: f.px[0], bidSz: f.sz[0], ask: f.px[f.nBids], askSz: f.sz[f.nBids] } : null;

/**
 * OFI i zmiana środka arkusza w świecach: sumy po parach kolejnych migawek, para należy do świecy, w której leży jej
 * późniejsza migawka. NaN, gdy świeca nie ma pary, gdy para jest dłuższa niż `OFI_MAX_GAP` albo gdy ostatnia migawka
 * jest dalej od końca świecy (bieżącej: od teraz) niż `OFI_MAX_GAP`.
 */
export function bookFlow(frames: readonly BookFrame[], bars: readonly FlowBar[], ms: number, now: number, ofi: Float64Array, dp: Float64Array): void {
  let j = 0;
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i].candle.t;
    const end = t + ms;
    while (j < frames.length && frames[j].t < t) j++;
    let x = 0;
    let y = 0;
    let ok = j < frames.length && frames[j].t < end;
    for (; j < frames.length && frames[j].t < end; j++) {
      const a = j > 0 ? quoteOf(frames[j - 1]) : null;
      const b = quoteOf(frames[j]);
      if (!a || !b || frames[j].t - frames[j - 1].t > OFI_MAX_GAP) ok = false;
      else {
        x += ofiEvent(a, b);
        y += (b.bid + b.ask - a.bid - a.ask) / 2;
      }
    }
    if (ok && frames[j - 1].t < Math.min(end, now) - OFI_MAX_GAP) ok = false;
    ofi[i] = ok ? x : Number.NaN;
    dp[i] = ok ? y : Number.NaN;
  }
}

/**
 * Koszt zlecenia rynkowego `usd` po arkuszu migawki, w pb od środka najlepszych cen: średnia cena wykonania po kolejnych
 * poziomach strony (kupno — aski, sprzedaż — bidy). NaN bez obu stron albo gdy poziomy migawki nie mieszczą kwoty.
 */
export function marketCostBp(f: BookFrame, usd: number, buy: boolean): number {
  if (!(f.nBids > 0 && f.nBids < f.px.length)) return Number.NaN;
  const mid = (f.px[0] + f.px[f.nBids]) / 2;
  const end = buy ? f.px.length : f.nBids;
  let rest = usd;
  let qty = 0;
  for (let k = buy ? f.nBids : 0; k < end && rest > 0; k++) {
    const take = Math.min(rest, f.px[k] * f.sz[k]);
    qty += take / f.px[k];
    rest -= take;
  }
  if (rest > usd * 1e-9) return Number.NaN;
  const avg = usd / qty;
  return ((buy ? avg - mid : mid - avg) / mid) * 1e4;
}

/** Konto ma w historii serwera numer ważny w godzinie UTC: świeca dłuższa nie łączy kont z różnych godzin. */
export const ACCOUNT_HOUR_MS = 3_600_000;

/**
 * Szerokość agresji w zleceniach świecy: N_eff = (Σ w)² / Σ w² z wartości wejść kont biorców po stronie kupna i sprzedaży
 * (odwrotność indeksu Herfindahla; NaN bez zleceń po stronie) i największa liczba różnych biorców po jednej stronie
 * w jednym bloku (ta sama milisekunda). Zlecenia bez konta pominięte.
 */
export function takerBreadth(orders: readonly { time: number; side: Side; notional: number; taker: string }[]): { buy: number; sell: number; race: number } {
  const bySide = [new Map<string, number>(), new Map<string, number>()];
  const blocks = new Map<string, Set<string>>();
  let race = 0;
  for (const o of orders) {
    if (o.taker === '') continue;
    const m = bySide[o.side > 0 ? 0 : 1];
    m.set(o.taker, (m.get(o.taker) ?? 0) + o.notional);
    const key = `${o.side}:${o.time}`;
    let b = blocks.get(key);
    if (!b) blocks.set(key, (b = new Set()));
    b.add(o.taker);
    race = Math.max(race, b.size);
  }
  const neff = (m: Map<string, number>) => {
    let s = 0;
    let s2 = 0;
    for (const w of m.values()) {
      s += w;
      s2 += w * w;
    }
    return s2 > 0 ? (s * s) / s2 : Number.NaN;
  };
  return { buy: neff(bySide[0]), sell: neff(bySide[1]), race: race > 0 ? race : Number.NaN };
}

/**
 * Trwałość przepływu w zleceniach świecy: udział wartości wejść kont, które w oknie przed świecą wchodziły po tej samej
 * stronie (powracający), tylko po przeciwnej (odwracający) i wcale (nowi); NaN bez zleceń z kontem w świecy.
 */
export function takerPersistence(
  before: readonly { side: Side; taker: string }[],
  during: readonly { side: Side; notional: number; taker: string }[]
): { back: number; flip: number; fresh: number } {
  const seen = [new Set<string>(), new Set<string>()];
  for (const o of before) if (o.taker !== '') seen[o.side > 0 ? 0 : 1].add(o.taker);
  let back = 0;
  let flip = 0;
  let fresh = 0;
  for (const o of during) {
    if (o.taker === '') continue;
    const k = o.side > 0 ? 0 : 1;
    if (seen[k].has(o.taker)) back += o.notional;
    else if (seen[1 - k].has(o.taker)) flip += o.notional;
    else fresh += o.notional;
  }
  const sum = back + flip + fresh;
  return sum > 0 ? { back: back / sum, flip: flip / sum, fresh: fresh / sum } : { back: Number.NaN, flip: Number.NaN, fresh: Number.NaN };
}

export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: 'sma',
    short: 'MA',
    name: tr('Średnia prosta (MA)', 'Moving Average (MA)'),
    hint: tr('Średnia arytmetyczna n ostatnich zamknięć', 'Arithmetic mean of the last n closes'),
    group: 'trend',
    aliases: 'sma średnia prosta simple moving average ma',
    warmup: (p) => p.length - 1,
    pane: 'price',
    params: [length(9)],
    plots: [{}],
    format: 'price',
    create: (p) => {
      const m = smaOf(p.length);
      return (c, keep, out) => {
        out[0] = m(c.c, keep);
      };
    },
  },
  {
    id: 'ema',
    short: 'EMA',
    name: tr('Średnia wykładnicza (EMA)', 'Exponential Moving Average (EMA)'),
    hint: tr(
      'Średnia zamknięć z wagami malejącymi wykładniczo, α = 2/(n+1); pierwsza wartość to średnia prosta z n świec',
      'Average of closes with exponentially decreasing weights, α = 2/(n+1); the first value is the simple average of n candles'
    ),
    group: 'trend',
    aliases: 'średnia wykładnicza exponential moving average ma',
    warmup: (p) => p.length - 1,
    decay: (p) => [2 / (p.length + 1)],
    pane: 'price',
    params: [length(9)],
    plots: [{}],
    format: 'price',
    create: (p) => {
      const e = ema(p.length);
      return (c, keep, out) => {
        out[0] = e.next(c.c, keep);
      };
    },
  },
  {
    id: 'hma',
    short: 'HMA',
    name: tr('Średnia Hulla (HMA)', 'Hull Moving Average (HMA)'),
    hint: tr(
      'Średnia ważona liniowo (WMA) z 2 × WMA(n/2) − WMA(n) na √n świecach: wygładza zamknięcia i mniej się spóźnia niż średnia prosta',
      'A linearly weighted average (WMA) of 2 × WMA(n/2) − WMA(n) over √n candles: smooths closes and lags less than a simple average'
    ),
    group: 'trend',
    aliases: 'hull średnia ważona weighted moving average wma ma',
    warmup: (p) => p.length + Math.floor(Math.sqrt(p.length)) - 2,
    pane: 'price',
    params: [{ ...length(9), min: 2 }],
    plots: [{}],
    format: 'price',
    create: (p) => {
      const half = new Wma(Math.floor(p.length / 2));
      const full = new Wma(p.length);
      const outer = new Wma(Math.floor(Math.sqrt(p.length)));
      return (c, keep, out) => {
        out[0] = outer.next(2 * half.next(c.c, keep) - full.next(c.c, keep), keep);
      };
    },
  },
  {
    id: 'vwma',
    short: 'VWMA',
    name: tr('Średnia ważona wolumenem (VWMA)', 'Volume Weighted Moving Average (VWMA)'),
    hint: tr('Średnia zamknięć n świec z wagami równymi ich wolumenowi, Σ(C × V) / ΣV', 'The average close of n candles weighted by their volume, Σ(C × V) / ΣV'),
    group: 'trend',
    aliases: 'vwma średnia ważona wolumenem volume weighted moving average ma',
    warmup: (p) => p.length - 1,
    pane: 'price',
    params: [length(20)],
    plots: [{}],
    format: 'price',
    create: (p) => {
      const pv = new Window(p.length);
      const v = new Window(p.length);
      return (c, keep, out) => {
        pv.next(c.c * c.v, keep);
        v.next(c.v, keep);
        out[0] = v.mean > 0 ? pv.mean / v.mean : Number.NaN;
      };
    },
  },
  {
    id: 'supertrend',
    short: 'Supertrend',
    name: 'Supertrend',
    hint: tr(
      'Pasma (H+L)/2 ± mnożnik × ATR, które trzymają poziom, dopóki zamknięcie ich nie przetnie; linia ciągła pod ceną po przecięciu górnego pasma, przerywana nad ceną po przecięciu dolnego',
      'Bands (H+L)/2 ± multiplier × ATR that hold their level until a close crosses them; a solid line below price after the upper band is crossed, a dashed one above price after the lower band is crossed'
    ),
    group: 'trend',
    aliases: 'supertrend super trend atr pasma bands',
    warmup: (p) => p.atr - 1,
    memoryNote: tr(
      'Pasma trzymają poziom, dopóki zamknięcie ich nie przetnie, więc linia zależy od drogi ceny od początku wczytanej historii.',
      'The bands hold their level until a close crosses them, so the line depends on the price path since the start of the loaded history.'
    ),
    pane: 'price',
    params: [int('atr', tr('Okres ATR', 'ATR period'), 10), { ...mult(3), label: tr('Mnożnik ATR', 'ATR multiplier') }],
    plots: [{}, { dashed: true, color: RED }],
    format: 'price',
    create: (p) => {
      const atr = rma(p.atr);
      // Stan zamknięty po poprzedniej świecy (jak `[1]` w Pine)
      let prevClose = Number.NaN;
      let lower = Number.NaN;
      let upper = Number.NaN;
      let line = Number.NaN;
      let atrBefore = false;
      return (c, keep, out) => {
        const a = atr.next(trueRange(c, prevClose), keep);
        if (Number.isNaN(a)) {
          out[0] = out[1] = Number.NaN;
          if (keep) prevClose = c.c;
          return;
        }
        const mid = (c.h + c.l) / 2;
        const pl = Number.isNaN(lower) ? 0 : lower;
        const pu = Number.isNaN(upper) ? 0 : upper;
        let lb = mid - p.mult * a;
        let ub = mid + p.mult * a;
        lb = lb > pl || prevClose < pl ? lb : pl;
        ub = ub < pu || prevClose > pu ? ub : pu;
        // −1: linia pod ceną (dolne pasmo), 1: nad ceną (górne pasmo) — jak `direction` w `ta.supertrend`
        const dir = !atrBefore ? 1 : line === pu ? (c.c > ub ? -1 : 1) : c.c < lb ? 1 : -1;
        const st = dir === -1 ? lb : ub;
        out[0] = dir === -1 ? st : Number.NaN;
        out[1] = dir === 1 ? st : Number.NaN;
        if (keep) {
          prevClose = c.c;
          lower = lb;
          upper = ub;
          line = st;
          atrBefore = true;
        }
      };
    },
  },
  {
    id: 'dmi',
    short: 'DMI',
    name: tr('Kierunkowy ruch (DMI, ADX)', 'Directional Movement Index (DMI, ADX)'),
    hint: tr(
      'ADX (kolor wskaźnika): siła ruchu bez kierunku, RMA z |+DI − −DI| / (+DI + −DI); +DI (turkus) i −DI (pomarańcz): średnie Wildera ruchów szczytów w górę i dołków w dół wobec ATR',
      'ADX (indicator colour): strength of movement without direction, RMA of |+DI − −DI| / (+DI + −DI); +DI (teal) and −DI (orange): Wilder averages of highs moving up and lows moving down relative to ATR'
    ),
    group: 'trend',
    aliases: 'dmi adx di directional movement kierunkowy ruch siła trendu',
    warmup: (p) => p.length + p.adx - 1,
    decay: (p) => [1 / p.length, 1 / p.adx],
    pane: 'own',
    params: [int('length', tr('Długość DI', 'DI length'), 14), int('adx', tr('Wygładzenie ADX', 'ADX smoothing'), 14)],
    plots: [{}, { color: TEAL }, { color: ORANGE }],
    format: 'fixed2',
    create: (p) => {
      const trr = rma(p.length);
      const plusR = rma(p.length);
      const minusR = rma(p.length);
      const adx = rma(p.adx);
      let prev: { h: number; l: number; c: number } | null = null;
      // `fixnan`: ostatnia liczba, gdy dzielenie przez zerowy ATR daje `na`
      let lastPlus = Number.NaN;
      let lastMinus = Number.NaN;
      return (c, keep, out) => {
        out[0] = out[1] = out[2] = Number.NaN;
        if (!prev) {
          if (keep) prev = { h: c.h, l: c.l, c: c.c };
          return;
        }
        const up = c.h - prev.h;
        const down = prev.l - c.l;
        const t = trr.next(trueRange(c, prev.c), keep);
        const pdm = plusR.next(up > down && up > 0 ? up : 0, keep);
        const mdm = minusR.next(down > up && down > 0 ? down : 0, keep);
        if (keep) prev = { h: c.h, l: c.l, c: c.c };
        if (Number.isNaN(t)) return;
        const plus = t > 0 ? (100 * pdm) / t : lastPlus;
        const minus = t > 0 ? (100 * mdm) / t : lastMinus;
        if (keep) {
          lastPlus = plus;
          lastMinus = minus;
        }
        if (Number.isNaN(plus)) return;
        const sum = plus + minus;
        out[0] = 100 * adx.next(Math.abs(plus - minus) / (sum === 0 ? 1 : sum), keep);
        out[1] = plus;
        out[2] = minus;
      };
    },
  },
  {
    id: 'rsi',
    short: 'RSI',
    name: tr('Siła względna (RSI)', 'Relative Strength Index (RSI)'),
    hint: tr(
      'Średnie Wildera (RMA) wzrostów i spadków zamknięcia w skali 0–100; linie 70, 50 i 30 to tylko liczby odniesienia',
      "Wilder's averages (RMA) of close-to-close gains and losses on a 0–100 scale; the 70, 50 and 30 lines are reference numbers only"
    ),
    group: 'momentum',
    aliases: 'siła względna relative strength wilder oscylator oscillator',
    warmup: (p) => p.length,
    decay: (p) => [1 / p.length],
    pane: 'own',
    params: [length(14)],
    plots: [{}],
    levels: [70, 50, 30],
    range: [0, 100],
    format: 'fixed2',
    create: (p) => {
      const r = rsiOf(p.length);
      return (c, keep, out) => {
        out[0] = r(c.c, keep);
      };
    },
  },
  {
    id: 'stoch',
    short: 'Stoch',
    name: tr('Oscylator stochastyczny (Stoch)', 'Stochastic (Stoch)'),
    hint: tr(
      '%K: położenie zamknięcia w zakresie n świec, 100 × (C − min L) / (max H − min L), wygładzone średnią prostą; %D (pomarańcz): średnia prosta %K; linie 80, 50 i 20 to tylko liczby odniesienia',
      '%K: position of the close within the n-candle range, 100 × (C − min L) / (max H − min L), smoothed with a simple average; %D (orange): simple average of %K; the 80, 50 and 20 lines are reference numbers only'
    ),
    group: 'momentum',
    aliases: 'stochastic stochastyczny oscylator oscillator %k %d',
    warmup: (p) => p.length + p.smooth + p.d - 3,
    pane: 'own',
    params: [int('length', tr('Długość %K', '%K length'), 14), int('smooth', tr('Wygładzenie %K', '%K smoothing'), 1), int('d', tr('Wygładzenie %D', '%D smoothing'), 3)],
    plots: [{}, { color: ORANGE }],
    levels: [80, 50, 20],
    range: [0, 100],
    format: 'fixed2',
    create: (p) => {
      const hi = new Extreme(p.length, 1);
      const lo = new Extreme(p.length, -1);
      const k = smaOf(p.smooth);
      const d = smaOf(p.d);
      return (c, keep, out) => {
        const h = hi.next(c.h, keep);
        const l = lo.next(c.l, keep);
        // Zakres zerowy: dzielenie przez zero daje `na`, jak w Pine
        const raw = h > l ? (100 * (c.c - l)) / (h - l) : Number.NaN;
        out[0] = k(raw, keep);
        out[1] = d(out[0], keep);
      };
    },
  },
  {
    id: 'stochrsi',
    short: 'Stoch RSI',
    name: tr('Stochastyczny RSI (Stoch RSI)', 'Stochastic RSI (Stoch RSI)'),
    hint: tr(
      'Oscylator stochastyczny liczony na RSI zamiast na cenie: położenie RSI w jego zakresie z n świec, %K wygładzone średnią prostą, %D (pomarańcz) to średnia %K; linie 80, 50 i 20 to tylko liczby odniesienia',
      'The stochastic oscillator computed on RSI instead of price: where RSI sits in its n-candle range, %K smoothed with a simple average, %D (orange) is the average of %K; the 80, 50 and 20 lines are reference numbers only'
    ),
    group: 'momentum',
    aliases: 'stochastic rsi stochrsi stochastyczny oscylator oscillator %k %d',
    warmup: (p) => p.rsi + p.stoch + p.k + p.d - 3,
    decay: (p) => [1 / p.rsi],
    lag: (p) => p.stoch + p.k + p.d - 3,
    pane: 'own',
    params: [
      int('k', tr('Wygładzenie %K', '%K smoothing'), 3),
      int('d', tr('Wygładzenie %D', '%D smoothing'), 3),
      int('rsi', tr('Długość RSI', 'RSI length'), 14),
      int('stoch', tr('Długość stochastyka', 'Stochastic length'), 14),
    ],
    plots: [{}, { color: ORANGE }],
    levels: [80, 50, 20],
    range: [0, 100],
    format: 'fixed2',
    create: (p) => {
      const r = rsiOf(p.rsi);
      const hi = new Extreme(p.stoch, 1);
      const lo = new Extreme(p.stoch, -1);
      const k = smaOf(p.k);
      const d = smaOf(p.d);
      return (c, keep, out) => {
        const x = r(c.c, keep);
        let raw = Number.NaN;
        // Rozbieg RSI (`na`) nie wchodzi do okna najwyższej i najniższej wartości
        if (!Number.isNaN(x)) {
          const h = hi.next(x, keep);
          const l = lo.next(x, keep);
          if (h > l) raw = (100 * (x - l)) / (h - l);
        }
        out[0] = k(raw, keep);
        out[1] = d(out[0], keep);
      };
    },
  },
  {
    id: 'macd',
    short: 'MACD',
    name: 'MACD',
    hint: tr(
      'Różnica EMA szybkiej i wolnej z zamknięć, linia sygnału (pomarańcz) to EMA tej różnicy, słupki to MACD − sygnał',
      'The difference between the fast and slow EMA of closes, the signal line (orange) is an EMA of that difference, the bars are MACD − signal'
    ),
    group: 'momentum',
    aliases: 'macd moving average convergence divergence zbieżność rozbieżność histogram',
    warmup: (p) => Math.max(p.fast, p.slow) + p.signal - 2,
    decay: (p) => [2 / (Math.max(p.fast, p.slow) + 1), 2 / (p.signal + 1)],
    pane: 'own',
    params: [int('fast', tr('Szybka EMA', 'Fast EMA'), 12), int('slow', tr('Wolna EMA', 'Slow EMA'), 26), int('signal', tr('Sygnał EMA', 'Signal EMA'), 9)],
    plots: [{}, { color: ORANGE }, { hist: true }],
    levels: [0],
    format: 'range',
    create: (p) => {
      const fast = ema(p.fast);
      const slow = ema(p.slow);
      const signal = smoothOf(ema(p.signal));
      return (c, keep, out) => {
        const m = fast.next(c.c, keep) - slow.next(c.c, keep);
        const s = signal(m, keep);
        out[0] = m;
        out[1] = s;
        out[2] = m - s;
      };
    },
  },
  {
    id: 'cci',
    short: 'CCI',
    name: tr('Indeks kanału towarowego (CCI)', 'Commodity Channel Index (CCI)'),
    hint: tr(
      'Odległość typowej ceny (H+L+C)/3 od jej średniej prostej z n świec w jednostkach 0,015 × średniego odchylenia bezwzględnego; linie 100, 0 i −100 to tylko liczby odniesienia',
      'The distance of the typical price (H+L+C)/3 from its n-candle simple average in units of 0.015 × the mean absolute deviation; the 100, 0 and −100 lines are reference numbers only'
    ),
    group: 'momentum',
    aliases: 'cci commodity channel index kanał towarowy oscylator oscillator',
    warmup: (p) => p.length - 1,
    pane: 'own',
    params: [length(20)],
    plots: [{}],
    levels: [100, 0, -100],
    format: 'fixed2',
    create: (p) => {
      const n = p.length;
      const w = new Window(n);
      // n − 1 ostatnich zatwierdzonych typowych cen (bieżąca dochodzi przy liczeniu): `ta.dev` to O(n) na świecę
      const buf = new Float64Array(Math.max(n - 1, 1));
      let head = 0;
      return (c, keep, out) => {
        const x = hlc3(c);
        w.next(x, keep);
        const m = w.mean;
        out[0] = Number.NaN;
        if (!Number.isNaN(m)) {
          let dev = Math.abs(x - m);
          for (let k = 0; k < n - 1; k++) dev += Math.abs(buf[k] - m);
          // Odchylenie zero (stała cena) daje `na`, jak dzielenie przez zero w Pine
          if (dev > 0) out[0] = (x - m) / ((0.015 * dev) / n);
        }
        if (keep && n > 1) {
          buf[head] = x;
          head = (head + 1) % (n - 1);
        }
      };
    },
  },
  {
    id: 'wpr',
    short: '%R',
    name: 'Williams %R',
    hint: tr(
      'Położenie zamknięcia pod najwyższym szczytem n świec w skali od −100 do 0, 100 × (C − max H) / (max H − min L); linie −20, −50 i −80 to tylko liczby odniesienia',
      'Where the close sits below the highest high of n candles on a −100 to 0 scale, 100 × (C − max H) / (max H − min L); the −20, −50 and −80 lines are reference numbers only'
    ),
    group: 'momentum',
    aliases: 'williams %r wpr percent range oscylator oscillator',
    warmup: (p) => p.length - 1,
    pane: 'own',
    params: [length(14)],
    plots: [{}],
    levels: [-20, -50, -80],
    range: [-100, 0],
    format: 'fixed2',
    create: (p) => {
      const hi = new Extreme(p.length, 1);
      const lo = new Extreme(p.length, -1);
      return (c, keep, out) => {
        const h = hi.next(c.h, keep);
        const l = lo.next(c.l, keep);
        out[0] = h > l ? (100 * (c.c - h)) / (h - l) : Number.NaN;
      };
    },
  },
  {
    id: 'bb',
    short: 'BB',
    name: tr('Wstęgi Bollingera (BB)', 'Bollinger Bands (BB)'),
    hint: tr(
      'Średnia prosta z n zamknięć (przerywana) i wstęgi ± k odchyleń standardowych populacyjnych, jak w TradingView',
      'Simple average of n closes (dashed) and bands ± k population standard deviations, as in TradingView'
    ),
    group: 'volatility',
    aliases: 'bollinger wstęgi pasma bands odchylenie standard deviation',
    warmup: (p) => p.length - 1,
    pane: 'price',
    params: [length(20), { key: 'mult', label: tr('Mnożnik σ', 'StdDev multiplier'), min: 0.1, max: 10, step: 0.1, def: 2 }],
    plots: [{ dashed: true }, {}, {}],
    format: 'price',
    create: (p) => {
      const w = new Window(p.length);
      return (c, keep, out) => {
        w.next(c.c, keep);
        out[0] = w.mean;
        out[1] = w.mean + p.mult * w.sd;
        out[2] = w.mean - p.mult * w.sd;
      };
    },
  },
  {
    id: 'keltner',
    short: 'KC',
    name: tr('Kanał Keltnera (KC)', 'Keltner Channels (KC)'),
    hint: tr(
      'EMA zamknięć (przerywana) i pasma ± mnożnik × ATR, jak w TradingView (styl pasm: ATR)',
      'EMA of closes (dashed) and bands ± multiplier × ATR, as in TradingView (band style: ATR)'
    ),
    group: 'volatility',
    aliases: 'keltner kanał channels pasma bands atr ema',
    warmup: (p) => Math.max(p.length, p.atr) - 1,
    decay: (p) => [2 / (p.length + 1), 1 / p.atr],
    pane: 'price',
    params: [length(20), mult(2), int('atr', tr('Okres ATR', 'ATR length'), 10)],
    plots: [{ dashed: true }, {}, {}],
    format: 'price',
    create: (p) => {
      const basis = ema(p.length);
      const atr = rma(p.atr);
      let prevClose = Number.NaN;
      return (c, keep, out) => {
        const m = basis.next(c.c, keep);
        const a = atr.next(trueRange(c, prevClose), keep);
        if (keep) prevClose = c.c;
        out[0] = m;
        out[1] = m + p.mult * a;
        out[2] = m - p.mult * a;
      };
    },
  },
  {
    id: 'donchian',
    short: 'DC',
    name: tr('Kanał Donchiana (DC)', 'Donchian Channels (DC)'),
    hint: tr('Najwyższy szczyt i najniższy dołek n świec oraz ich środek (przerywany)', 'The highest high and lowest low of n candles and their midpoint (dashed)'),
    group: 'volatility',
    aliases: 'donchian kanał channels szczyt dołek high low',
    warmup: (p) => p.length - 1,
    pane: 'price',
    params: [length(20)],
    plots: [{ dashed: true }, {}, {}],
    format: 'price',
    create: (p) => {
      const hi = new Extreme(p.length, 1);
      const lo = new Extreme(p.length, -1);
      return (c, keep, out) => {
        const h = hi.next(c.h, keep);
        const l = lo.next(c.l, keep);
        out[0] = (h + l) / 2;
        out[1] = h;
        out[2] = l;
      };
    },
  },
  {
    id: 'atr',
    short: 'ATR',
    name: tr('Średni prawdziwy zakres (ATR)', 'Average True Range (ATR)'),
    hint: tr(
      'Średnia Wildera (RMA) z true range: największej z H − L i odległości H oraz L od poprzedniego zamknięcia, w USD',
      "Wilder's average (RMA) of the true range: the largest of H − L and the distance of H and L from the previous close, in USD"
    ),
    group: 'volatility',
    aliases: 'średni prawdziwy zakres average true range wilder zmienność volatility',
    warmup: (p) => p.length - 1,
    decay: (p) => [1 / p.length],
    pane: 'own',
    params: [length(14)],
    plots: [{}],
    format: 'range',
    create: (p) => {
      const r = rma(p.length);
      let prev = Number.NaN;
      return (c, keep, out) => {
        const x = trueRange(c, prev);
        if (keep) prev = c.c;
        out[0] = r.next(x, keep);
      };
    },
  },
  {
    id: 'chop',
    short: 'CHOP',
    name: 'Choppiness Index (CHOP)',
    hint: tr(
      '100 × log10(Σ TR / (max H − min L)) / log10(n) z n świec: wyżej, gdy suma ruchów świec jest duża wobec zakresu (cena chodzi w miejscu), niżej, gdy cena idzie w jedną stronę; linie 61,8 i 38,2 to tylko liczby odniesienia',
      '100 × log10(Σ TR / (max H − min L)) / log10(n) over n candles: higher when the candles’ moves are large relative to the range (price going nowhere), lower when price goes one way; the 61.8 and 38.2 lines are reference numbers only'
    ),
    group: 'volatility',
    aliases: 'choppiness chop konsolidacja szarpanie range trend',
    warmup: (p) => p.length - 1,
    pane: 'own',
    params: [{ ...length(14), min: 2 }],
    plots: [{}],
    levels: [61.8, 38.2],
    format: 'fixed2',
    create: (p) => {
      const n = p.length;
      const tr1 = new Window(n);
      const hi = new Extreme(n, 1);
      const lo = new Extreme(n, -1);
      let prevClose = Number.NaN;
      return (c, keep, out) => {
        // `ta.atr(1)` to true range świecy, na pierwszej H − L
        tr1.next(trueRange(c, prevClose), keep);
        if (keep) prevClose = c.c;
        const h = hi.next(c.h, keep);
        const l = lo.next(c.l, keep);
        out[0] = h > l ? (100 * Math.log10((tr1.mean * n) / (h - l))) / Math.log10(n) : Number.NaN;
      };
    },
  },
  {
    id: 'obv',
    short: 'OBV',
    name: tr('Wolumen narastający (OBV)', 'On Balance Volume (OBV)'),
    hint: tr(
      'Suma wolumenu świec ze znakiem zmiany zamknięcia (wzrost +, spadek −), w jednostkach rynku (np. BTC)',
      'A running sum of candle volume signed by the change of the close (up +, down −), in market units (e.g. BTC)'
    ),
    group: 'volume',
    aliases: 'obv on balance volume wolumen narastający skumulowany cumulative',
    warmup: () => 1,
    memoryNote: tr(
      'Suma od początku wczytanej historii: poziom zależy od tego, gdzie historia się zaczyna, znaczenie mają zmiany linii.',
      'A sum from the start of the loaded history: the level depends on where history begins; the changes of the line are what matter.'
    ),
    pane: 'own',
    params: [],
    plots: [{}],
    format: 'volume',
    create: () => {
      let prevClose = Number.NaN;
      let sum = 0;
      return (c, keep, out) => {
        const d = c.c - prevClose;
        if (keep) prevClose = c.c;
        if (Number.isNaN(d)) {
          out[0] = Number.NaN;
          return;
        }
        const v = sum + Math.sign(d) * c.v;
        if (keep) sum = v;
        out[0] = v;
      };
    },
  },
  {
    id: 'cmf',
    short: 'CMF',
    name: tr('Przepływ pieniądza Chaikina (CMF)', 'Chaikin Money Flow (CMF)'),
    hint: tr(
      'Suma wolumenu ważonego położeniem zamknięcia w świecy, ((C − L) − (H − C)) / (H − L), przez sumę wolumenu n świec; od −1 do 1',
      'The sum of volume weighted by where the close sits in the candle, ((C − L) − (H − C)) / (H − L), divided by the volume of n candles; from −1 to 1'
    ),
    group: 'volume',
    aliases: 'chaikin money flow cmf przepływ pieniądza wolumen',
    warmup: (p) => p.length - 1,
    pane: 'own',
    params: [length(20)],
    plots: [{}],
    levels: [0],
    format: 'fixed3',
    create: (p) => {
      const ad = new Window(p.length);
      const v = new Window(p.length);
      return (c, keep, out) => {
        // Świeca bez zakresu (H = L) waży zero
        ad.next(c.h > c.l ? ((2 * c.c - c.l - c.h) / (c.h - c.l)) * c.v : 0, keep);
        v.next(c.v, keep);
        out[0] = v.mean > 0 ? ad.mean / v.mean : Number.NaN;
      };
    },
  },
  {
    id: 'mfi',
    short: 'MFI',
    name: tr('Indeks przepływu pieniądza (MFI)', 'Money Flow Index (MFI)'),
    hint: tr(
      'Jak RSI, ale z wolumenem: sumy typowej ceny × wolumen ze świec n, w których typowa cena wzrosła i spadła, w skali 0–100; linie 80 i 20 to tylko liczby odniesienia',
      'Like RSI but with volume: the sums of typical price × volume over n candles in which the typical price rose and fell, on a 0–100 scale; the 80 and 20 lines are reference numbers only'
    ),
    group: 'volume',
    aliases: 'money flow index mfi przepływ pieniądza wolumen oscylator oscillator',
    warmup: (p) => p.length - 1,
    pane: 'own',
    params: [length(14)],
    plots: [{}],
    levels: [80, 20],
    range: [0, 100],
    format: 'fixed2',
    create: (p) => {
      const up = new Window(p.length);
      const down = new Window(p.length);
      let prev = Number.NaN;
      return (c, keep, out) => {
        const x = hlc3(c);
        const ch = x - prev;
        if (keep) prev = x;
        // Pierwsza świeca nie ma zmiany (`na`): w Pine oba porównania są fałszywe, więc trafia do obu sum
        up.next(ch <= 0 ? 0 : c.v * x, keep);
        down.next(ch >= 0 ? 0 : c.v * x, keep);
        const u = up.mean;
        const d = down.mean;
        out[0] = Number.isNaN(u) ? Number.NaN : d === 0 ? (u === 0 ? Number.NaN : 100) : 100 - 100 / (1 + u / d);
      };
    },
  },
  {
    id: 'pivots',
    short: 'Pivots',
    name: tr('Punkty pivot (Traditional)', 'Pivot Points Standard (Traditional)'),
    hint: tr(
      'Poziomy doby z maksimum, minimum i zamknięcia poprzedniej doby UTC: P = (H + L + C) / 3, R1 = 2P − L, S1 = 2P − H, R2 = P + (H − L), S2 = P − (H − L), R3 = H + 2(P − L), S3 = L − 2(H − P)',
      "The day's levels from the previous UTC day's high, low and close: P = (H + L + C) / 3, R1 = 2P − L, S1 = 2P − H, R2 = P + (H − L), S2 = P − (H − L), R3 = H + 2(P − L), S3 = L − 2(H − P)"
    ),
    group: 'levels',
    aliases: 'pivot points standard traditional punkty piwot poziomy opór wsparcie resistance support r1 s1 doba dzień daily',
    warmup: () => 1,
    memoryNote: tr(
      'Liczone ze świec 1D Hyperliquid (doba UTC, rynek bez przerw): poziomy stoją od północy UTC do końca doby. TradingView w trybie Auto na wyższych interwałach bierze dłuższy okres; tu zawsze doba.',
      'Computed from Hyperliquid 1D candles (the UTC day, a market without breaks): the levels hold from UTC midnight to the end of the day. TradingView in Auto mode takes a longer period on higher timeframes; here it is always the day.'
    ),
    period: '1d',
    pane: 'price',
    params: [],
    plots: [
      { title: 'P', breaks: true },
      { title: 'R1', breaks: true },
      { title: 'S1', breaks: true },
      { title: 'R2', breaks: true },
      { title: 'S2', breaks: true },
      { title: 'R3', breaks: true },
      { title: 'S3', breaks: true },
    ],
    format: 'price',
    create: () => {
      // Świeca poprzedniej doby (zatwierdzona); bieżąca doba dostaje jej poziomy
      let prev: Candle | null = null;
      return (c, keep, out) => {
        const d = prev;
        if (keep) prev = c;
        if (!d) {
          out.fill(Number.NaN);
          return;
        }
        const p = (d.h + d.l + d.c) / 3;
        out[0] = p;
        out[1] = 2 * p - d.l;
        out[2] = 2 * p - d.h;
        out[3] = p + (d.h - d.l);
        out[4] = p - (d.h - d.l);
        out[5] = d.h + 2 * (p - d.l);
        out[6] = d.l - 2 * (d.h - p);
      };
    },
  },
  {
    id: 'psar',
    short: 'SAR',
    name: 'Parabolic SAR',
    hint: tr(
      'Punkt zatrzymania Wildera: zbliża się do skrajnej ceny trendu z przyspieszeniem rosnącym o przyrost przy każdym nowym szczycie (dołku) aż do maksimum, a po przebiciu przechodzi na drugą stronę ceny',
      "Wilder's stop and reverse point: it approaches the trend's extreme price with an acceleration that grows by the increment at each new high (low) up to the maximum, and moves to the other side of price once crossed"
    ),
    group: 'trend',
    aliases: 'parabolic sar psar stop and reverse wilder kropki punkty dots',
    warmup: () => 1,
    memoryNote: tr(
      'Kierunek i skrajna cena trendu niosą się od początku wczytanej historii, więc pierwsze świece mogą różnić się od TradingView; po kilku zmianach kierunku wartości są zwykle już te same.',
      "The trend's direction and extreme price carry over from the start of the loaded history, so the first candles may differ from TradingView; after a few reversals the values are usually the same."
    ),
    pane: 'price',
    params: [
      { key: 'start', label: 'Start', min: 0.001, max: 1, step: 0.001, def: 0.02 },
      { key: 'inc', label: tr('Przyrost', 'Increment'), min: 0.001, max: 1, step: 0.001, def: 0.02 },
      { key: 'max', label: tr('Maksimum', 'Maximum'), min: 0.01, max: 1, step: 0.01, def: 0.2 },
    ],
    plots: [{ dots: true }],
    format: 'price',
    create: (p) => {
      // Stan zatwierdzony po zamkniętej świecy; kolejność kroków jak w przykładzie `ta.sar` z dokumentacji Pine
      let bar = 0;
      let result = Number.NaN;
      let maxMin = Number.NaN;
      let acc = Number.NaN;
      let below = false;
      let prevClose = Number.NaN;
      let h1 = Number.NaN;
      let l1 = Number.NaN;
      let h2 = Number.NaN;
      let l2 = Number.NaN;
      return (c, keep, out) => {
        let r = result;
        let m = maxMin;
        let a = acc;
        let b = below;
        let first = false;
        if (bar === 1) {
          b = c.c > prevClose;
          m = b ? c.h : c.l;
          r = b ? l1 : h1;
          first = true;
          a = p.start;
        }
        r += a * (m - r);
        if (b && r > c.l) {
          first = true;
          b = false;
          r = Math.max(c.h, m);
          m = c.l;
          a = p.start;
        } else if (!b && r < c.h) {
          first = true;
          b = true;
          r = Math.min(c.l, m);
          m = c.h;
          a = p.start;
        }
        if (!first) {
          if (b && c.h > m) {
            m = c.h;
            a = Math.min(a + p.inc, p.max);
          } else if (!b && c.l < m) {
            m = c.l;
            a = Math.min(a + p.inc, p.max);
          }
        }
        // SAR nie wchodzi w zakres dwóch poprzednich świec
        if (b) r = bar > 1 ? Math.min(r, l1, l2) : Math.min(r, l1);
        else r = bar > 1 ? Math.max(r, h1, h2) : Math.max(r, h1);
        out[0] = r;
        if (!keep) return;
        result = r;
        maxMin = m;
        acc = a;
        below = b;
        prevClose = c.c;
        h2 = h1;
        l2 = l1;
        h1 = c.h;
        l1 = c.l;
        bar++;
      };
    },
  },
  {
    id: 'ichimoku',
    short: 'Ichimoku',
    name: tr('Chmura Ichimoku', 'Ichimoku Cloud'),
    hint: tr(
      'Tenkan (kolor wskaźnika) i Kijun (czerwień): środki zakresu, czyli (najwyższy szczyt + najniższy dołek) / 2, z 9 i 26 świec; chmura między Senkou A (średnia Tenkan i Kijun, turkus) i Senkou B (środek zakresu 52 świec, jasna czerwień), przesunięta w przód, turkusowa, gdy A jest nad B, czerwona, gdy pod; Chikou (pomarańcz): zamknięcie przesunięte wstecz',
      'Tenkan (indicator colour) and Kijun (red): midpoints of the range, (highest high + lowest low) / 2, over 9 and 26 candles; the cloud between Senkou A (average of Tenkan and Kijun, teal) and Senkou B (range midpoint over 52 candles, light red), shifted forward, teal when A is above B, red when below; Chikou (orange): the close shifted back'
    ),
    group: 'trend',
    aliases: 'ichimoku kinko hyo chmura cloud kumo tenkan kijun senkou chikou',
    warmup: (p) => Math.max(p.conv, p.base, p.span2) - 1,
    convention: tr(
      'Wzór i wartości domyślne jak we wbudowanym wskaźniku TradingView, liczone ze świec Hyperliquid tego wykresu; przesunięcie też jak w TradingView: przy 26 chmura i Chikou przesuwają się o 25 świec, bo bieżąca świeca liczy się jako pierwsza.',
      "Formula and defaults as in TradingView's built-in indicator, computed from this chart's Hyperliquid candles; the displacement too, as in TradingView: at 26 the cloud and Chikou move by 25 candles, because the current candle counts as the first."
    ),
    memoryNote: tr(
      'Każda linia zależy tylko od ostatnich świec swojej długości, a na początku historii ma tyle świec bez wartości (chmura dodatkowo o przesunięcie dalej). Chmura przed ostatnią świecą to wartości z już znanych świec przesunięte w przód, nie prognoza; Chikou kończy się tyle świec przed ostatnią, o ile jest przesunięta.',
      'Each line depends only on the last candles of its length and has as many candles without a value at the start of history (the cloud a displacement further). The cloud ahead of the last candle is values from candles already known, shifted forward, not a forecast; Chikou ends as many candles before the last one as it is shifted.'
    ),
    pane: 'price',
    params: [
      int('conv', tr('Długość Tenkan', 'Conversion line length'), 9),
      int('base', tr('Długość Kijun', 'Base line length'), 26),
      int('span2', tr('Długość Senkou B', 'Leading span B length'), 52),
      int('disp', tr('Przesunięcie', 'Displacement'), 26),
    ],
    plots: [
      {},
      { color: RED },
      { color: ORANGE, shift: (p) => 1 - p.disp },
      { color: LIGHT_TEAL, shift: (p) => p.disp - 1 },
      { color: LIGHT_RED, shift: (p) => p.disp - 1 },
    ],
    cloud: [3, 4],
    format: 'price',
    create: (p) => {
      const mid = (n: number) => {
        const hi = new Extreme(n, 1);
        const lo = new Extreme(n, -1);
        return (c: Candle, keep: boolean) => (hi.next(c.h, keep) + lo.next(c.l, keep)) / 2;
      };
      const conv = mid(p.conv);
      const base = mid(p.base);
      const span2 = mid(p.span2);
      return (c, keep, out) => {
        out[0] = conv(c, keep);
        out[1] = base(c, keep);
        out[2] = c.c;
        out[3] = (out[0] + out[1]) / 2;
        out[4] = span2(c, keep);
      };
    },
  },
  {
    id: 'linreg',
    short: 'LinReg',
    name: tr('Kanał regresji liniowej', 'Linear Regression Channel'),
    hint: tr(
      'Prosta najmniejszych kwadratów przez zamknięcia ostatnich n świec (przerywana) i linie odchylenia w górę i w dół: wielokrotność odchylenia standardowego zamknięć od prostej (dzielnik n − 1)',
      'The least squares line through the closes of the last n candles (dashed) and upper and lower deviation lines: a multiple of the standard deviation of closes from the line (divisor n − 1)'
    ),
    group: 'trend',
    aliases: 'linear regression channel linreg regresja liniowa kanał trend najmniejszych kwadratów least squares',
    warmup: (p) => p.length - 1,
    memoryNote: tr(
      'Kanał liczony od nowa z ostatnich n świec przy każdej zmianie, jak w TradingView: to rysunek na ostatnich świecach, nie historia, więc wcześniejsze świece nie mają wartości, a kanał przesuwa się z każdą nową świecą.',
      'The channel is recomputed from the last n candles at every change, as in TradingView: it is a drawing on the latest candles, not a history, so earlier candles have no value and the channel moves with every new candle.'
    ),
    pane: 'price',
    params: [
      { key: 'length', label: tr('Długość', 'Length'), min: 2, max: 1000, step: 1, def: 100 },
      { key: 'up', label: tr('Odchylenie w górę', 'Upper deviation'), min: 0, max: 10, step: 0.1, def: 2 },
      { key: 'down', label: tr('Odchylenie w dół', 'Lower deviation'), min: 0, max: 10, step: 0.1, def: 2 },
    ],
    plots: [{ dashed: true }, {}, {}],
    format: 'price',
    fit: {
      span: (p) => p.length,
      run: (at, p, out, end) => {
        // Wzory kanału z TradingView: x = 1 dla najnowszej świecy, rosnące wstecz
        const n = p.length;
        let sx = 0;
        let sy = 0;
        let sxx = 0;
        let sxy = 0;
        for (let j = 0; j < n; j++) {
          const y = at(j).c;
          const x = j + 1;
          sx += x;
          sy += y;
          sxx += x * x;
          sxy += y * x;
        }
        const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        const intercept = sy / n - (slope * sx) / n + slope;
        let acc = 0;
        for (let j = 0; j < n; j++) {
          const d = at(j).c - (intercept + slope * j);
          acc += d * d;
        }
        const sd = Math.sqrt(acc / (n - 1));
        for (let j = 0; j < n; j++) {
          const mid = intercept + slope * j;
          out[0][end - j] = mid;
          out[1][end - j] = mid + p.up * sd;
          out[2][end - j] = mid - p.down * sd;
        }
      },
    },
  },
  {
    id: 'hv',
    short: 'HV',
    name: tr('Zmienność historyczna (HV)', 'Historical Volatility (HV)'),
    hint: tr(
      'Odchylenie standardowe logarytmicznych zmian zamknięcia z n świec razy √365, w %',
      'The standard deviation of log changes of the close over n candles times √365, in %'
    ),
    group: 'volatility',
    aliases: 'historical volatility hv zmienność historyczna roczna annualized logarytmiczne stopy log returns',
    warmup: (p) => p.length,
    convention: tr(
      'Wzór, skala i wartości domyślne jak we wbudowanym wskaźniku TradingView, liczone ze świec Hyperliquid tego wykresu. Mnożnik √365 traktuje każdą świecę jak dobę, więc tylko na 1D liczba to zmienność roczna; na krótszych interwałach jest niższa od rocznej (na 5m ok. 17 razy, na 1h ok. 5 razy), a kształt linii jest ten sam.',
      "Formula, scale and defaults as in TradingView's built-in indicator, computed from this chart's Hyperliquid candles. The √365 factor treats every candle as a day, so only on 1D is the number the annual volatility; on shorter timeframes it is lower than the annual one (about 17 times on 5m, about 5 times on 1h), while the shape of the line is the same."
    ),
    pane: 'own',
    params: [length(10)],
    plots: [{}],
    format: 'fixed2',
    create: (p) => {
      const w = new Window(p.length);
      let prev = Number.NaN;
      return (c, keep, out) => {
        w.next(Math.log(c.c / prev), keep);
        if (keep) prev = c.c;
        // Jak TradingView na interwałach do 1D: √365 niezależnie od długości świecy
        out[0] = 100 * w.sd * Math.sqrt(365);
      };
    },
  },
  {
    id: 'netvol',
    short: 'Net Vol',
    name: tr('Wolumen netto (Net Volume)', 'Net Volume'),
    hint: tr(
      'Wolumen świecy ze znakiem zmiany zamknięcia (wzrost +, spadek −, bez zmiany 0), w jednostkach rynku; panel Delta liczy to samo dokładniej, z kupna i sprzedaży agresorów',
      'Candle volume signed by the change of the close (up +, down −, unchanged 0), in market units; the Delta pane computes the same more precisely, from aggressor buys and sells'
    ),
    group: 'volume',
    aliases: 'net volume wolumen netto nv kierunek świecy',
    warmup: () => 0,
    memoryNote: tr(
      'Wartość zależy od bieżącej i poprzedniej świecy (zmiana zamknięcia); pierwsza świeca historii ma 0.',
      'The value depends on the current and the previous candle (the change of the close); the first candle of history has 0.'
    ),
    pane: 'own',
    params: [],
    plots: [{}],
    levels: [0],
    format: 'volume',
    create: () => {
      let prev = Number.NaN;
      return (c, keep, out) => {
        const d = c.c - prev;
        if (keep) prev = c.c;
        // Pierwsza świeca bez zmiany (`na`): oba porównania fałszywe, więc 0, jak w TradingView
        out[0] = d > 0 ? c.v : d < 0 ? -c.v : 0;
      };
    },
  },
  {
    id: 'oiflow',
    short: 'OI × Delta',
    name: tr('Zmiana OI i delta', 'OI change and delta'),
    hint: tr(
      'Słupek to zmiana otwartych pozycji Hyperliquid w świecy, w jednostkach rynku; kolor to znak delty z taśmy (przewaga kupna albo sprzedaży agresorów): turkus dodatnia, czerwień ujemna',
      'The bar is the change of Hyperliquid open interest within the candle, in market units; the colour is the sign of the tape delta (aggressor buying or selling ahead): teal positive, red negative'
    ),
    group: 'hyperquant',
    aliases: 'oi open interest otwarte pozycje delta agresja aggressor otwarcia zamkniecia opens closes',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z danych Hyperliquid. Zmiana OI od początku świecy do jej zamknięcia (bieżąca: do teraz), delta z nagranej taśmy, jak w panelu Delta.',
      'TradingView has no such indicator: it is computed from Hyperliquid data. The OI change runs from the start of the candle to its close (the current one: to now), the delta comes from the recorded tape, as in the Delta pane.'
    ),
    memoryNote: tr(
      'Wartość ma tylko świeca w całości objęta nagraniem taśmy i z odczytami OI na początku i na końcu. To współruch, nie rozbicie: w każdej transakcji jedna strona kupuje, a druga sprzedaje, a dane giełdy nie mówią, która otwiera, a która zamyka pozycję, więc wzrost OI przy dodatniej delcie nie dowodzi, że przybyło długich pozycji.',
      'Only a candle fully covered by the tape recording, with OI readings at its start and end, has a value. It is co-movement, not a split: in every trade one side buys and the other sells, and exchange data does not say which side opens and which closes a position, so rising OI with positive delta does not prove that longs were added.'
    ),
    pane: 'own',
    params: [],
    plots: [
      { hist: true, signOf: 1, title: 'ΔOI' },
      { hist: true, hidden: true, title: 'Delta' },
    ],
    levels: [0],
    format: 'volume',
    flow: (b, ms, ctx, out) => {
      // Delta tylko ze świecy w całości objętej nagraniem — część taśmy dałaby część delty
      const fp = b.complete ? b.fp : null;
      const t = b.candle.t;
      const a = ctx.oiAt(t);
      const z = ctx.oiAt(Math.min(t + ms, ctx.now));
      const ok = fp && a !== null && z !== null;
      out[0] = ok ? z - a : Number.NaN;
      out[1] = ok ? fp.delta : Number.NaN;
    },
  },
  {
    id: 'absorption',
    short: tr('Absorpcja', 'Absorption'),
    name: tr('Absorpcja: wysiłek a efekt', 'Absorption: effort vs result'),
    hint: tr(
      'O ile ruch ceny w świecy odbiegł od zwykłego przy takiej delcie, w jednostkach rozrzutu ostatnich świec: ujemny słupek — cena przesunęła się w stronę agresji mniej niż zwykle, dodatni — bardziej; kolor to strona agresji (turkus kupno, czerwień sprzedaż)',
      'How far the price move within the candle departed from the usual move for such a delta, in units of recent candles’ spread: a negative bar means price moved in the direction of aggression less than usual, a positive one more; the colour is the aggressor side (teal buying, red selling)'
    ),
    group: 'hyperquant',
    aliases: 'absorption absorpcja wysilek efekt effort result theil sen delta odporna robust',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z nagranej taśmy Hyperliquid. Zwykły ruch to prosta Theila–Sena (mediana nachyleń par) ruchu ceny w świecy (zamknięcie − otwarcie) względem delty w poprzednich świecach z taśmą; rozrzut to mediana odchyleń bezwzględnych (MAD) razy 1,4826. Pojedyncza skrajna świeca w oknie nie przestawia prostej, w przeciwieństwie do zwykłej regresji. Słupek to reszta świecy podzielona przez rozrzut, ze znakiem strony agresji.',
      'TradingView has no such indicator: it is computed from the recorded Hyperliquid tape. The usual move is the Theil–Sen line (median of pairwise slopes) of the in-candle price move (close − open) against delta over the previous candles with tape; the spread is the median absolute deviation (MAD) times 1.4826. A single extreme candle in the window does not shift the line, unlike ordinary regression. The bar is the candle’s residual divided by the spread, signed by the aggressor side.'
    ),
    memoryNote: tr(
      'Wartość zależy od bieżącej świecy i od ostatnich świec w liczbie „Długość”, w całości objętych nagraniem taśmy (świece z luką się pomija). Bieżąca świeca jest porównywana z tymi samymi świecami co po zamknięciu, więc wartość na żywo liczy się tak samo jak końcowa. Brak wartości, dopóki nie ma tylu świec z taśmą, i gdy w oknie delta nie przesuwa ceny w swoją stronę (nachylenie ≤ 0).',
      'The value depends on the current candle and on the last “Length” candles fully covered by the tape recording (candles with a gap are skipped). The current candle is compared with the same candles as after its close, so the live value is computed the same way as the final one. No value until there are that many candles with tape, or when delta does not move price its own way in the window (slope ≤ 0).'
    ),
    pane: 'own',
    params: [{ key: 'length', label: tr('Długość', 'Length'), min: 20, max: 200, step: 1, def: 120 }],
    lookback: (p) => p.length,
    plots: [
      { hist: true, signOf: 1, title: 'z' },
      { hist: true, hidden: true, title: 'Delta' },
    ],
    levels: [-2, 0, 2],
    // Liczby ze znakiem jak delta (z i delta w legendzie)
    format: 'volume',
    sample: {
      span: (p) => p.length,
      point: (b, xy) => {
        // Tylko świeca w całości objęta nagraniem — część taśmy dałaby część delty
        const fp = b.complete ? b.fp : null;
        if (!fp) return false;
        xy[0] = fp.delta;
        xy[1] = b.candle.c - b.candle.o;
        return true;
      },
      create: (p) => {
        const line = new RobustLine(p.length);
        return (x, y, xs, ys, out) => {
          const f = line.fit(xs, ys, p.length);
          const ok = f !== null && f.beta > 0 && f.scale > 0;
          // Reszta w stronę agresji: ujemna — cena przesunęła się w stronę delty mniej, niż wynika z prostej
          out[0] = ok ? (Math.sign(x) * (y - f.alpha - f.beta * x)) / f.scale : Number.NaN;
          out[1] = ok ? x : Number.NaN;
        };
      },
    },
  },
  {
    id: 'ofi',
    short: 'OFI',
    name: tr('OFI: nierównowaga arkusza i jej wpływ na cenę', 'OFI: order book imbalance and its price impact'),
    hint: tr(
      'Słupek to nierównowaga przepływu zleceń na najlepszych poziomach arkusza w świecy (OFI, w jednostkach rynku): dodatnia — przybyło popytu albo ubyło podaży; w legendzie zmiana środka arkusza w świecy, R² z ostatnich świec i zmiana ceny oczekiwana przy takim OFI',
      'The bar is the order flow imbalance at the best book levels within the candle (OFI, in market units): positive means demand was added or supply removed; the legend shows the book mid change in the candle, R² from recent candles and the price change expected for such OFI'
    ),
    group: 'hyperquant',
    aliases: 'ofi order flow imbalance nierownowaga przeplyw zlecen arkusz book cont kukanov stoikov impact wplyw r2 beta',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z migawek arkusza Hyperliquid. OFI jak u Conta, Kukanova i Stoikova (2014): w każdej parze kolejnych migawek wyższy najlepszy bid albo więcej na nim dodaje, niższy albo mniej odejmuje, a po stronie asku odwrotnie; świeca to suma par. Migawki przychodzą co około 5 s, w kubełkach ceny najbliższej agregacji wykresu (dla BTC 10 USD), więc to przybliżenie OFI liczonego z każdej zmiany najlepszych cen: zmiany między migawkami się sumują, a w kubełku są zlecenia kilku cen. Δp to zmiana środka arkusza w tych samych parach. R² pochodzi z regresji Δp na OFI (z wyrazem wolnym) w poprzednich zamkniętych świecach z wartością, a oczekiwana zmiana to nachylenie tej regresji razy OFI świecy, podawana od R² 0,1.',
      'TradingView has no such indicator: it is computed from Hyperliquid book snapshots. OFI follows Cont, Kukanov and Stoikov (2014): in every pair of consecutive snapshots a higher best bid or more size on it adds, a lower one or less size subtracts, and the ask side works the other way; the candle is the sum over pairs. Snapshots arrive about every 5 s, in price buckets of the chart’s nearest aggregation (10 USD for BTC), so this approximates OFI computed from every change of the best prices: changes between snapshots are summed, and a bucket holds orders at several prices. Δp is the book mid change over the same pairs. R² comes from regressing Δp on OFI (with an intercept) over the previous closed candles with a value, and the expected change is that regression’s slope times the candle’s OFI, shown from R² 0.1.'
    ),
    memoryNote: tr(
      'OFI świecy zależy tylko od migawek arkusza w niej; świeca nie ma wartości, gdy w danych arkusza jest przerwa dłuższa niż 12 s. R² i oczekiwana zmiana zależą od ostatnich zamkniętych świec z wartością w liczbie „Długość”, bez bieżącej świecy. Arkusz z serwera sięga 12 godzin wstecz, starsze świece nie mają wartości. Brak R², dopóki nie ma tylu świec, i gdy w oknie OFI albo Δp się nie zmienia.',
      'A candle’s OFI depends only on the book snapshots within it; a candle has no value when the book data has a gap longer than 12 s. R² and the expected change depend on the last “Length” closed candles with a value, excluding the current one. Server book history reaches 12 hours back; older candles have no value. No R² until there are that many candles, or when OFI or Δp does not change in the window.'
    ),
    pane: 'own',
    params: [{ key: 'length', label: tr('Długość', 'Length'), min: 10, max: 200, step: 1, def: 30 }],
    lookback: (p) => p.length,
    plots: [
      { hist: true },
      { hist: true, hidden: true, title: 'Δp' },
      { hidden: true, title: 'R²', format: 'fixed2' },
      { hist: true, hidden: true, title: tr('oczek.', 'exp.') },
    ],
    levels: [0],
    format: 'volume',
    series: (p) => (bars, ms, ctx, out) => {
      const [ofi, dp, r2, expected] = out;
      bookFlow(ctx.book(), bars, ms, ctx.now, ofi, dp);
      // Regresja z ostatnich zamkniętych świec z wartością przed świecą: bieżąca nie wchodzi do swojego okna
      const w = new OlsWindow(p.length);
      for (let i = 0; i < bars.length; i++) {
        const f = w.count === p.length && !Number.isNaN(ofi[i]) ? w.fit() : null;
        r2[i] = f ? f.r2 : Number.NaN;
        expected[i] = f && f.r2 >= OFI_MIN_R2 ? f.beta * ofi[i] : Number.NaN;
        if (!Number.isNaN(ofi[i]) && bars[i].candle.t + ms <= ctx.now) w.push(ofi[i], dp[i]);
      }
    },
  },
  {
    id: 'regime',
    short: tr('Reżim', 'Regime'),
    name: tr('Reżim zmienności (BOCPD)', 'Volatility regime (BOCPD)'),
    hint: tr(
      'Linia to prawdopodobieństwo, że bieżący reżim zmienności zaczął się w ostatnich świecach („Okno zmiany”, od 0 do 1), z bayesowskiego wykrywania punktów zmiany na zwrotach świec; w legendzie σ bieżącego reżimu na świecę, w %',
      'The line is the probability that the current volatility regime began within the last candles (“Change window”, 0 to 1), from Bayesian change-point detection on candle returns; the legend shows the current regime’s σ per candle, in %'
    ),
    group: 'hyperquant',
    aliases: 'bocpd regime rezim zmiennosc volatility change point punkt zmiany adams mackay bayes sigma',
    warmup: () => REGIME_PRIOR,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView. BOCPD (Adams i MacKay 2007) na logarytmicznych zmianach zamknięcia: zwroty o średniej 0 i wariancji, która zmienia się skokowo; po każdej świecy rozkład długości bieżącego reżimu (do 600 świec), a linia to jego część krótsza niż „Okno zmiany”. Ryzyko zmiany w każdej świecy to 1 / „Długość reżimu”, a prior wariancji pochodzi z pierwszych 100 zwrotów (mediana kwadratów / 0,4549, nie mniej niż ¼ średniej). σ reżimu to pierwiastek wariancji przewidywanej, uśrednionej po długości reżimu. Zwykły rytm doby (np. otwarcie sesji w USA) też podnosi zmienność, więc i on może wyglądać jak zmiana reżimu.',
      'TradingView has no such indicator. BOCPD (Adams and MacKay 2007) on log changes of the close: returns with zero mean and a variance that changes in jumps; after every candle, a distribution of the current regime’s length (up to 600 candles), and the line is its share shorter than the “Change window”. The change risk in each candle is 1 / “Regime length”, and the variance prior comes from the first 100 returns (median of squares / 0.4549, at least ¼ of the mean). Regime σ is the square root of the predictive variance averaged over the regime length. The ordinary daily rhythm (e.g. the US session open) also lifts volatility, so it can look like a regime change too.'
    ),
    memoryNote: tr(
      'Wartość zależy od całej wczytanej historii: prior z pierwszych 100 zwrotów, a rozkład długości reżimu sięga 600 świec (starsze w ostatniej komórce), więc doczytana historia z lewej przelicza wszystko. Zmianę widać dopiero po kilku świecach nowego reżimu (tym później, im mniejsza), a linia spada, gdy reżim jest starszy niż okno. Przy stałym reżimie to zwykle kilka procent (samo ryzyko zmiany daje około „Okno zmiany” / „Długość reżimu”).',
      'The value depends on the whole loaded history: the prior comes from the first 100 returns and the regime length distribution reaches 600 candles (older ones in the last cell), so older history loaded on the left recomputes everything. A change shows only after a few candles of the new regime (later for a smaller one), and the line falls once the regime is older than the window. In a steady regime it is usually a few percent (the change risk alone gives about “Change window” / “Regime length”).'
    ),
    pane: 'own',
    params: [
      { key: 'length', label: tr('Długość reżimu', 'Regime length'), min: 20, max: 2000, step: 1, def: 200 },
      { key: 'recent', label: tr('Okno zmiany', 'Change window'), min: 1, max: 100, step: 1, def: 20 },
    ],
    plots: [{}, { hidden: true, title: 'σ%', format: 'fixed3' }],
    levels: [0.5],
    range: [0, 1],
    format: 'fixed2',
    create: (p) => {
      const first: number[] = [];
      let det: RegimeDetector | null = null;
      let prev = Number.NaN;
      return (c, keep, out) => {
        const x = Math.log(c.c / prev);
        if (keep) prev = c.c;
        // Rozbieg: prior z pierwszych zwrotów, potem te same zwroty jako pierwsze obserwacje
        if (!det && keep && Number.isFinite(x) && first.push(x) === REGIME_PRIOR) {
          det = new RegimeDetector(1 / p.length, 2, regimePrior(first), REGIME_RUNS, p.recent);
          for (const y of first) det.update(y);
        } else if (det && keep) det.update(x);
        const s = !det ? null : keep ? det.state() : det.peek(x);
        out[0] = s ? s.pRecent : Number.NaN;
        out[1] = s ? 100 * s.sigma : Number.NaN;
      };
    },
  },
  {
    id: 'ordersize',
    short: tr('Zlecenia', 'Orders'),
    name: tr('Wielkość zleceń agresora', 'Aggressor order size'),
    hint: tr(
      'Mediana, 90. i 99. percentyl kwoty zleceń rynkowych (wypełnienia złożone w zlecenia) w świecy, na skali logarytmicznej, i 90. percentyl z poprzednich świec jako baza; w legendzie przesunięcie rozkładu względem bazy (KS: dodatnie — zlecenia większe niż zwykle)',
      'Median, 90th and 99th percentile of market order size (fills combined into orders) within the candle, on a log scale, with the 90th percentile of previous candles as the baseline; the legend shows the distribution shift against the baseline (KS: positive means larger orders than usual)'
    ),
    group: 'hyperquant',
    aliases: 'order size wielkosc zlecen agresor aggressor big trades duze zlecenia kwantyl percentyl ks kolmogorov smirnov',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z nagranej taśmy Hyperliquid. Wypełnienia jednego zlecenia rynkowego łączą się po adresie biorcy i hashu transakcji (bez hasha, np. TWAP — po biorcy i tej samej milisekundzie), więc kwota to całe zlecenie, a nie pojedyncza transakcja. Percentyle świecy z interpolacją liniową. Baza to zlecenia z poprzednich świec w liczbie „Baza” razem, w przedziałach co 1/20 dekady (ok. 12%), z interpolacją w przedziale; KS to największa różnica dystrybuant świecy i bazy na tych przedziałach, ze znakiem kierunku. Przy małej liczbie zleceń w świecy KS jest głośny: na poziomie 1% znaczący dopiero powyżej około 1,63 / √n.',
      'TradingView has no such indicator: it is computed from the recorded Hyperliquid tape. Fills of one market order are joined by taker address and transaction hash (without a hash, e.g. TWAP, by taker and the same millisecond), so the size is the whole order, not a single trade. Candle percentiles use linear interpolation. The baseline is all orders from the previous “Baseline” candles, in bins of 1/20 of a decade (about 12%), interpolated within a bin; KS is the largest gap between the candle’s and the baseline’s distribution functions on those bins, signed by direction. With few orders in a candle KS is noisy: at the 1% level it is significant only above about 1.63 / √n.'
    ),
    memoryNote: tr(
      'Percentyle świecy zależą tylko od jej zleceń; baza i KS od poprzednich świec w liczbie „Baza”, w całości objętych nagraniem taśmy. Świece bez pełnego nagrania nie mają wartości. Brak bazy i KS, dopóki nie ma tylu świec z taśmą.',
      'Candle percentiles depend only on its orders; the baseline and KS on the previous “Baseline” candles fully covered by the tape recording. Candles without full recording have no value. No baseline or KS until there are that many candles with tape.'
    ),
    pane: 'own',
    params: [{ key: 'length', label: tr('Baza', 'Baseline'), min: 10, max: 500, step: 1, def: 100 }],
    lookback: (p) => p.length,
    plots: [
      { title: 'p50' },
      { color: ORANGE, title: 'p90' },
      { color: TEAL, title: 'p99' },
      { color: ORANGE, dashed: true, title: tr('baza p90', 'base p90') },
      { hist: true, hidden: true, title: 'KS', format: 'fixed2' },
    ],
    format: 'usd',
    log: true,
    series: (p) => {
      // Wyniki świec między przeliczeniami: ta sama świeca i ta sama liczba zleceń — bez ponownego liczenia
      const memo = new WeakMap<FlowBar, { count: number; stats: SizeStats }>();
      const base = new Float64Array(SIZE_BINS);
      return (bars, ms, ctx, out) => {
        const window: SizeStats[] = [];
        let total = 0;
        base.fill(0);
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i];
          const t = b.candle.t;
          let stats: SizeStats | null = null;
          if (b.complete) {
            const count = ctx.orderCount(t, t + ms);
            let m = memo.get(b);
            if (!m || m.count !== count) memo.set(b, (m = { count, stats: sizeStats(ctx.orders(t, t + ms)) }));
            stats = m.stats;
          }
          const full = window.length === p.length && total > 0;
          for (let k = 0; k < 3; k++) out[k][i] = stats && stats.n > 0 ? stats.q[k] : Number.NaN;
          out[3][i] = stats && full ? quantileBins(base, total, 0.9) : Number.NaN;
          out[4][i] = stats && stats.n > 0 && full ? signedKs(stats.bins, stats.n, base, total) : Number.NaN;
          // Baza z zamkniętych świec przed świecą
          if (!stats || t + ms > ctx.now) continue;
          window.push(stats);
          for (let k = 0; k < SIZE_BINS; k++) base[k] += stats.bins[k];
          total += stats.n;
          if (window.length > p.length) {
            const old = window.shift()!;
            for (let k = 0; k < SIZE_BINS; k++) base[k] -= old.bins[k];
            total -= old.n;
          }
        }
      };
    },
  },
  {
    id: 'cone',
    short: tr('Stożek', 'Cone'),
    name: tr('Stożek prognozy zakresu', 'Range forecast cone'),
    hint: tr(
      'Przedziały 90% i 60% oraz mediana ceny BTC na 1 h i 4 h od ostatniej prognozy z dziennika Desku i szanse dotknięcia PDH, PDL i środka dnia w 2 h; w legendzie pokrycie przedziałów z 30 dni',
      'The 90% and 60% intervals and the median of the BTC price over 1 h and 4 h from the latest Desk ledger forecast, and the chances of touching PDH, PDL and the day midpoint within 2 h; the legend shows the interval coverage over 30 days'
    ),
    group: 'hyperquant',
    aliases: 'cone stozek prognoza forecast zakres range przedzial interval kwantyl quantile pokrycie coverage kalibracja calibration kupiec har fhs dziennik ledger dotkniecie touch',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView. Rysuje prognozy, które Desk co 15 minut zapisuje w publicznym dzienniku, zanim rynek je rozstrzygnie (model zmienności HAR z porą dnia i symulacja z historycznych reszt, ten sam co w Planie). Liczby są dokładne na horyzontach 1 h i 4 h od wydania (kreski); między nimi stożek jest rysowany w przybliżeniu, liniowo w pierwiastku czasu. Model nie prognozuje kierunku: mediana stoi przy cenie z chwili wydania. Pokrycie to odsetek prognoz 1 h z 30 dni, po których cena skończyła w przedziale (nominał 90% i 60%); prognozy co 15 min nakładają się, więc test Kupca liczony jest na prognozach rozłącznych. Tylko BTC; bez prognozy z ostatnich 3 h stożka nie ma.',
      'TradingView has no such indicator. It draws the forecasts the Desk records every 15 minutes in a public ledger before the market settles them (a HAR volatility model with time of day and a simulation from historical residuals, the same as in the Plan). The numbers are exact at the 1 h and 4 h horizons from issue (tick marks); between them the cone is an approximation, linear in the square root of time. The model does not forecast direction: the median stays at the price at issue. Coverage is the share of 1 h forecasts over 30 days after which the price ended inside the interval (nominal 90% and 60%); forecasts every 15 min overlap, so the Kupiec test runs on disjoint forecasts. BTC only; without a forecast from the last 3 h there is no cone.'
    ),
    memoryNote: tr(
      'Nie zależy od świec wykresu: najnowsza prognoza i wyniki z 30 dni z dziennika, sprawdzane co minutę.',
      'It does not depend on the chart candles: the latest forecast and 30-day results from the ledger, checked every minute.'
    ),
    pane: 'price',
    params: [],
    plots: [],
    format: 'price',
    forecast: true,
  },
  {
    id: 'slippage',
    short: tr('Koszt', 'Cost'),
    name: tr('Koszt zlecenia rynkowego (poślizg)', 'Market order cost (slippage)'),
    hint: tr(
      'Ile punktów bazowych od środka arkusza kosztuje zlecenie rynkowe o zadanej kwocie: ask — kupno zbierające aski, bid — sprzedaż zbierająca bidy; średnia z migawek dokładnego arkusza Hyperliquid w świecy, od otwarcia strony',
      'How many basis points from the book mid a market order of the given amount costs: ask is a buy taking the asks, bid a sell taking the bids; the average over exact Hyperliquid book snapshots within the candle, since the page was opened'
    ),
    group: 'hyperquant',
    aliases: 'slippage poslizg koszt cost market rynkowe wykonanie execution vwap arkusz book depth glebokosc plynnosc liquidity spread bp',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z arkusza Hyperliquid bez agregacji ceny (20 poziomów na stronę, migawka co około 5 s). W każdej migawce kwota przechodzi po kolejnych poziomach strony; koszt to różnica średniej ceny wykonania i środka najlepszych cen, w pb (0,01%), razem z połową spreadu, bez opłaty takera. Świeca to średnia z jej migawek. Widoczne zlecenia, bez ukrytych; samo zlecenie zmienia arkusz, więc to koszt w chwili migawki, a nie gwarancja. Serwer nagrywa arkusz tylko w kubełkach ceny (dla BTC 10 USD), z których koszt małych kwot wychodzi zawyżony o pół kubełka, więc historia zaczyna się od otwarcia strony.',
      'TradingView has no such indicator: it is computed from the Hyperliquid book without price aggregation (20 levels per side, a snapshot about every 5 s). In each snapshot the amount walks the side’s successive levels; the cost is the gap between the average fill price and the mid of the best prices, in bp (0.01%), including half the spread, without the taker fee. A candle is the average of its snapshots. Visible orders only, no hidden ones; the order itself changes the book, so this is the cost at the snapshot, not a guarantee. The server records the book only in price buckets (10 USD for BTC), which overstate the cost of small amounts by half a bucket, so the history starts when the page is opened.'
    ),
    memoryNote: tr(
      'Świeca zależy tylko od migawek arkusza w niej. Wartości są od otwarcia strony (najdłużej z ostatniej doby) i nie ma ich w powtórce. Świeca nie ma wartości bez migawki albo gdy w którejś 20 poziomów strony nie mieści kwoty.',
      'A candle depends only on the book snapshots within it. Values start when the page is opened (at most the last day) and are not available in replay. A candle has no value without a snapshot or when in any of them 20 levels of the side cannot hold the amount.'
    ),
    pane: 'own',
    params: [{ key: 'usd', label: tr('Kwota (USD)', 'Amount (USD)'), min: 1000, max: 10_000_000, step: 1000, def: 50_000 }],
    // Strony arkusza zamiast „kupno/sprzedaż” i neutralne kolory: koszt, nie kierunek
    plots: [{ title: 'ask' }, { color: ORANGE, title: 'bid' }],
    format: 'fixed2',
    fromZero: true,
    series: (p) => {
      // Koszt migawki liczony raz (migawki się nie zmieniają, kwota stała w instancji)
      const memo = new WeakMap<BookFrame, [number, number]>();
      return (bars, ms, ctx, out) => {
        const [buy, sell] = out;
        const frames = ctx.exactBook();
        let j = 0;
        for (let i = 0; i < bars.length; i++) {
          const t = bars[i].candle.t;
          while (j < frames.length && frames[j].t < t) j++;
          let n = 0;
          let b = 0;
          let s = 0;
          for (; j < frames.length && frames[j].t < t + ms; j++) {
            const f = frames[j];
            let c = memo.get(f);
            if (!c) memo.set(f, (c = [marketCostBp(f, p.usd, true), marketCostBp(f, p.usd, false)]));
            b += c[0];
            s += c[1];
            n++;
          }
          // NaN w którejś migawce (za płytki arkusz) daje NaN świecy
          buy[i] = n > 0 ? b / n : Number.NaN;
          sell[i] = n > 0 ? s / n : Number.NaN;
        }
      };
    },
  },
  {
    id: 'breadth',
    short: tr('Szerokość', 'Breadth'),
    name: tr('Szerokość agresji (efektywna liczba biorców)', 'Aggression breadth (effective number of takers)'),
    hint: tr(
      'Efektywna liczba kont, które w świecy wchodziły zleceniami rynkowymi po stronie kupna i sprzedaży (1 — wszystko z jednego konta, więcej — szerzej rozłożone), na skali logarytmicznej; w legendzie największa liczba różnych biorców po jednej stronie w jednym bloku',
      'The effective number of accounts that entered with market orders on the buy and sell side within the candle (1 means everything came from one account, more means more widely spread), on a log scale; the legend shows the largest number of different takers on one side within one block'
    ),
    group: 'hyperquant',
    aliases: 'breadth szerokosc n_eff neff herfindahl hhi konta accounts biorcy takers agresor aggressor koncentracja concentration tlum crowd wyscig race blok block',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z nagranej taśmy Hyperliquid, która przy każdej transakcji podaje konto biorcy. Wypełnienia łączą się w zlecenia jak we wskaźniku wielkości zleceń. Udział konta to jego wartość wejść po danej stronie w świecy, a liczba efektywna to (Σ w)² / Σ w², czyli odwrotność indeksu Herfindahla: 1, gdy całość weszła z jednego konta, n przy n kontach po równo, mniej niż liczba kont, gdy kilka z nich przeważa. Wyścig to największa liczba różnych biorców, których zlecenia po tej samej stronie weszły w tym samym bloku. Pokazujemy tylko liczby, nigdy kont.',
      'TradingView has no such indicator: it is computed from the recorded Hyperliquid tape, which gives the taker account with every trade. Fills are joined into orders as in the order size indicator. An account’s share is its entry value on a side within the candle, and the effective number is (Σ w)² / Σ w², the inverse of the Herfindahl index: 1 when everything came from one account, n with n equal accounts, fewer than the account count when a few of them dominate. The race is the largest number of different takers whose orders on the same side entered within the same block. Only numbers are shown, never accounts.'
    ),
    memoryNote: tr(
      'Świeca zależy tylko od swoich zleceń. Historia serwera numeruje konta w obrębie godziny UTC, więc wskaźnik działa na interwałach do 1 h. W godzinie otwarcia strony to samo konto przed otwarciem i po nim liczy się jako dwa. Świece bez taśmy z kontami w całości (zapis z przeglądarki ich nie ma) nie mają wartości.',
      'A candle depends only on its own orders. Server history numbers accounts within a UTC hour, so the indicator works on intervals up to 1 h. In the hour the page was opened, the same account before and after opening counts as two. Candles without the tape with accounts throughout (the browser recording has none) have no value.'
    ),
    pane: 'own',
    params: [],
    plots: [
      { title: tr('kupujący', 'buyers') },
      { color: ORANGE, title: tr('sprzedający', 'sellers') },
      { hidden: true, title: tr('wyścig', 'race'), format: 'count' },
    ],
    format: 'fixed1',
    log: true,
    series: () => {
      // Wynik świecy między przeliczeniami: ta sama świeca i ta sama liczba zleceń — bez ponownego liczenia
      const memo = new WeakMap<FlowBar, { count: number; r: ReturnType<typeof takerBreadth> }>();
      return (bars, ms, ctx, out) => {
        const [buy, sell, race] = out;
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i];
          const t = b.candle.t;
          let r: ReturnType<typeof takerBreadth> | null = null;
          if (ms <= ACCOUNT_HOUR_MS && ctx.identified(t, Math.min(t + ms, ctx.now))) {
            const count = ctx.orderCount(t, t + ms);
            let m = memo.get(b);
            if (!m || m.count !== count) memo.set(b, (m = { count, r: takerBreadth(ctx.orders(t, t + ms)) }));
            r = m.r;
          }
          buy[i] = r ? r.buy : Number.NaN;
          sell[i] = r ? r.sell : Number.NaN;
          race[i] = r ? r.race : Number.NaN;
        }
      };
    },
  },
  {
    id: 'repeat',
    short: tr('Powroty', 'Returning'),
    name: tr('Powracający i nowi biorcy', 'Returning and new takers'),
    hint: tr(
      'Jaka część wartości wejść zleceniami rynkowymi w świecy pochodzi od kont, które w oknie przed świecą wchodziły już po tej samej stronie (powracający), tylko po przeciwnej (odwracający), a jaka od nowych; od 0 do 1',
      'What share of the value entered with market orders within the candle comes from accounts that in the window before the candle had already entered on the same side (returning), only on the opposite side (switching), and what share from new ones; 0 to 1'
    ),
    group: 'hyperquant',
    aliases: 'returning repeat powracajacy nowi new odwracajacy flip trwalosc persistence konta accounts biorcy takers agresor aggressor tozsamosc identity',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z nagranej taśmy Hyperliquid, która przy każdej transakcji podaje konto biorcy. Wypełnienia łączą się w zlecenia jak we wskaźniku wielkości zleceń. Okno to „Okno (min)” minut przed początkiem świecy; konto, które w nim wchodziło po tej samej stronie, jest powracające, a które tylko po przeciwnej — odwracające. Udziały liczone są z wartości wejść w świecy i sumują się do 1 razem z nowymi (w legendzie). Pokazujemy tylko udziały, nigdy kont.',
      'TradingView has no such indicator: it is computed from the recorded Hyperliquid tape, which gives the taker account with every trade. Fills are joined into orders as in the order size indicator. The window is “Window (min)” minutes before the candle starts; an account that entered on the same side within it is returning, one that entered only on the opposite side is switching. Shares come from the value entered within the candle and add up to 1 together with the new ones (in the legend). Only shares are shown, never accounts.'
    ),
    memoryNote: tr(
      'Świeca zależy od swoich zleceń i od zleceń z okna przed nią; obie części muszą mieć taśmę z kontami w całości (zapis z przeglądarki ich nie ma). Historia serwera numeruje konta w obrębie godziny UTC, więc w niej świeca ma wartość tylko wtedy, gdy okno i świeca leżą w jednej godzinie; na żywo okno może przekraczać pełną godzinę. W godzinie otwarcia strony konto sprzed otwarcia liczy się po nim jako nowe.',
      'A candle depends on its own orders and on the orders in the window before it; both need the tape with accounts throughout (the browser recording has none). Server history numbers accounts within a UTC hour, so there a candle has a value only when the window and the candle lie in one hour; live, the window can cross the full hour. In the hour the page was opened, an account from before opening counts as new after it.'
    ),
    pane: 'own',
    params: [{ key: 'window', label: tr('Okno (min)', 'Window (min)'), min: 5, max: 60, step: 1, def: 15 }],
    plots: [
      { title: tr('powracający', 'returning') },
      { color: ORANGE, title: tr('odwracający', 'switching') },
      { hidden: true, title: tr('nowi', 'new') },
    ],
    range: [0, 1],
    format: 'fixed2',
    series: (p) => {
      const W = p.window * 60_000;
      // Wynik świecy między przeliczeniami: te same liczby zleceń w oknie i w świecy — bez ponownego liczenia
      const memo = new WeakMap<FlowBar, { n0: number; n1: number; r: ReturnType<typeof takerPersistence> | null }>();
      return (bars, ms, ctx, out) => {
        const [back, flip, fresh] = out;
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i];
          const t = b.candle.t;
          let r: ReturnType<typeof takerPersistence> | null = null;
          if (ms <= ACCOUNT_HOUR_MS && ctx.identified(t - W, Math.min(t + ms, ctx.now))) {
            const n0 = ctx.orderCount(t - W, t);
            const n1 = ctx.orderCount(t, t + ms);
            let m = memo.get(b);
            if (!m || m.n0 !== n0 || m.n1 !== n1) {
              const before = ctx.orders(t - W, t);
              const during = ctx.orders(t, t + ms);
              // Numer konta z historii serwera (`~godzina:numer`) nie łączy się z numerem z innej godziny
              const split = Math.floor((t - W) / ACCOUNT_HOUR_MS) !== Math.floor((t + ms - 1) / ACCOUNT_HOUR_MS);
              const keyed = split && [...before, ...during].some((o) => o.taker.startsWith('~'));
              memo.set(b, (m = { n0, n1, r: keyed ? null : takerPersistence(before, during) }));
            }
            r = m.r;
          }
          back[i] = r ? r.back : Number.NaN;
          flip[i] = r ? r.flip : Number.NaN;
          fresh[i] = r ? r.fresh : Number.NaN;
        }
      };
    },
  },
  {
    id: 'makers',
    short: tr('Makerzy', 'Makers'),
    name: tr('Delta według klasy makera (animatorzy i reszta)', 'Delta by maker class (market makers and the rest)'),
    hint: tr(
      'Delta agresorów w świecy podzielona według tego, kto ją przyjął po stronie makera: animatorzy rynku (płynność przez większość godziny, po obu stronach) albo reszta (zlecenia limit pozostałych kont); w legendzie udział animatorów w wartości po stronie makera',
      'The aggressor delta within the candle split by who took it on the maker side: market makers (liquidity through most of the hour, on both sides) or the rest (limit orders of other accounts); the legend shows the market makers’ share of the maker-side value'
    ),
    group: 'hyperquant',
    aliases: 'maker makers animator market maker mm delta absorpcja absorption limit plynnosc liquidity konta accounts klasa class',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z nagranej taśmy Hyperliquid, która przy każdej transakcji podaje konto makera. Konto jest w godzinie UTC animatorem, gdy dawało płynność w co najmniej połowie jej minut z taśmą i po obu stronach (słabsza strona co najmniej 20% jego wartości); w bieżącej godzinie liczą się minuty, które już minęły, więc jej świece mogą się zmieniać do końca godziny. Delta to suma wielkości ze znakiem strony agresora; obie części razem dają deltę świecy. Progi 50% i 20% są umowne. Pokazujemy tylko sumy, nigdy kont.',
      'TradingView has no such indicator: it is computed from the recorded Hyperliquid tape, which gives the maker account with every trade. An account is a market maker in a UTC hour when it provided liquidity in at least half of the hour’s minutes with tape and on both sides (the weaker side at least 20% of its value); in the current hour the minutes that have passed count, so its candles may change until the hour ends. Delta is the sum of sizes signed by the aggressor side; the two parts add up to the candle delta. The 50% and 20% thresholds are a convention. Only totals are shown, never accounts.'
    ),
    memoryNote: tr(
      'Świeca zależy od swoich wypełnień i od klas kont z jej godziny UTC (historia serwera numeruje konta w obrębie godziny), więc wskaźnik działa na interwałach do 1 h. W godzinie otwarcia strony konto sprzed otwarcia i po nim liczy się jako dwa, więc animatorów może wyjść mniej. Świece bez taśmy z kontami w całości (zapis z przeglądarki ich nie ma) nie mają wartości.',
      'A candle depends on its fills and on the account classes of its UTC hour (server history numbers accounts within an hour), so the indicator works on intervals up to 1 h. In the hour the page was opened, an account before and after opening counts as two, so fewer market makers may come out. Candles without the tape with accounts throughout (the browser recording has none) have no value.'
    ),
    pane: 'own',
    params: [],
    plots: [
      { title: tr('animatorzy', 'market makers') },
      { color: ORANGE, title: tr('reszta', 'rest') },
      { hidden: true, title: tr('udział animatorów', 'market maker share'), format: 'fixed2' },
    ],
    levels: [0],
    format: 'volume',
    series: () => (bars, ms, ctx, out) => {
      const [mm, rest, share] = out;
      for (let i = 0; i < bars.length; i++) {
        const t = bars[i].candle.t;
        const r = ms <= ACCOUNT_HOUR_MS && ctx.identified(t, Math.min(t + ms, ctx.now)) ? ctx.makers(t, t + ms) : null;
        mm[i] = r ? r.mm : Number.NaN;
        rest[i] = r ? r.rest : Number.NaN;
        share[i] = r ? r.mmShare : Number.NaN;
      }
    },
  },
  {
    id: 'hawkes',
    short: 'Hawkes',
    name: tr('Endogeniczność taśmy (współczynnik rozgałęzienia Hawkesa)', 'Tape endogeneity (Hawkes branching ratio)'),
    hint: tr(
      'Jaka część transakcji w oknie wynika z wcześniejszych transakcji, a jaka przychodzi z zewnątrz: n procesu Hawkesa, czyli oczekiwana liczba transakcji wywołanych przez jedną, z 95% przedziałem; okno „Okno (min)” minut co minutę; przy 1 taśma podtrzymywałaby się sama',
      'What share of the trades within the window follows from earlier trades and what share comes from outside: the Hawkes process n, the expected number of trades triggered by one, with a 95% interval; a “Window (min)” minute window every minute; at 1 the tape would sustain itself'
    ),
    group: 'hyperquant',
    aliases: 'hawkes endogenicznosc endogeneity rozgalezienie branching ratio samowzbudzenie self-exciting refleksyjnosc reflexivity kaskada cascade krytycznosc criticality klastry clustering intensywnosc intensity',
    warmup: () => 0,
    convention: tr(
      'Tego wskaźnika nie ma w TradingView: liczony z nagranej taśmy Hyperliquid. Zdarzenie to blok z transakcjami (wypełnienia z tej samej chwili liczą się raz). Model: proces Hawkesa z jądrem wykładniczym dopasowany metodą największej wiarygodności w oknie „Okno (min)” minut, które kończy się z końcem świecy (w bieżącej świecy z ostatnią pełną minutą); pasmo to 95% przedział z profilu wiarygodności. Półokres wygasania pobudzenia jest szukany od kilku milisekund do 1/10 okna, a n jest ograniczone do 0,99 (proces stacjonarny). n mierzy skupianie się transakcji w tym modelu: zmiana napływu z zewnątrz w trakcie okna (np. publikacja danych) i pobudzenie o innym kształcie też podnoszą n, więc wysokie n nie dowodzi, że rynek napędza sam siebie.',
      'TradingView has no such indicator: it is computed from the recorded Hyperliquid tape. An event is a block with trades (fills at the same moment count once). Model: a Hawkes process with an exponential kernel fitted by maximum likelihood within a “Window (min)” minute window ending at the candle close (in the current candle at the last full minute); the band is the 95% profile likelihood interval. The half-life of the excitation is searched from a few milliseconds to 1/10 of the window, and n is capped at 0.99 (stationary process). n measures how trades cluster under this model: a change in the outside inflow during the window (e.g. a data release) and an excitation of another shape raise n too, so a high n does not prove that the market is feeding on itself.'
    ),
    memoryNote: tr(
      'Świeca zależy tylko od zleceń w swoim oknie. Okno musi mieć w całości taśmę z kontami (historia serwera i strumień na żywo; zapis z przeglądarki nie składa zleceń) i co najmniej 100 zdarzeń. Liczone w tle, od najnowszych świec, więc starsze wartości dochodzą po chwili.',
      'A candle depends only on the orders within its window. The window needs the tape with accounts throughout (server history and the live stream; the browser recording does not join orders) and at least 100 events. Computed in the background from the newest candles, so older values arrive after a moment.'
    ),
    pane: 'own',
    params: [{ key: 'window', label: tr('Okno (min)', 'Window (min)'), min: 5, max: 60, step: 1, def: 15 }],
    plots: [{ title: 'n' }, { hidden: true }, { hidden: true }],
    band: [1, 2],
    range: [0, 1],
    levels: [1],
    format: 'fixed2',
    series: (p) => {
      const W = p.window * 60_000;
      /** Wynik świecy (po początku): okno, liczba zleceń w nim przy liczeniu i wynik; stary pokazywany do nowego. */
      const done = new Map<number, { ms: number; end: number; count: number; r: Branching | null }>();
      const busy = new Set<number>();
      let woke = 0;
      const events = (ctx: FlowContext, end: number) => {
        const ts: number[] = [];
        for (const o of ctx.orders(end - W, end)) {
          const x = (o.time - end + W) / 1000;
          if (ts.length === 0 || x > ts[ts.length - 1]) ts.push(x);
        }
        return Float64Array.from(ts);
      };
      return (bars, ms, ctx, out) => {
        const [n, lo, hi] = out;
        const minute = Math.floor(ctx.now / 60_000) * 60_000;
        const bg = inBackground();
        // Od najnowszej świecy: do workera najwyżej 8 okien naraz, kolejne przy następnym przeliczeniu; przeliczenie po
        // wynikach najwyżej co 200 ms albo po ostatnim z wysłanych
        for (let i = bars.length - 1; i >= 0; i--) {
          const t = bars[i].candle.t;
          // Bieżąca świeca: okno do ostatniej pełnej minuty (na 1 m — to samo co poprzedniej świecy)
          const end = Math.min(t + ms, minute);
          let r: Branching | null = null;
          if (ctx.identified(end - W, end)) {
            const count = ctx.orderCount(end - W, end);
            const hit = done.get(t);
            const fresh = hit !== undefined && hit.ms === ms && hit.end === end && hit.count === count;
            if (fresh) r = hit.r;
            else if (count < MIN_EVENTS || !bg) {
              r = count < MIN_EVENTS ? null : fitBranching(events(ctx, end), W / 1000);
              done.set(t, { ms, end, count, r });
            } else {
              if (hit?.ms === ms) r = hit.r;
              if (!busy.has(t) && busy.size < 8) {
                busy.add(t);
                void fitBranchingLater(events(ctx, end), W / 1000).then((x) => {
                  busy.delete(t);
                  done.set(t, { ms, end, count, r: x });
                  if (busy.size > 0 && Date.now() - woke < 200) return;
                  woke = Date.now();
                  ctx.later?.();
                });
              }
            }
          }
          n[i] = r ? r.n : Number.NaN;
          lo[i] = r ? r.lo : Number.NaN;
          hi[i] = r ? r.hi : Number.NaN;
        }
        const first = bars[0]?.candle.t ?? Number.POSITIVE_INFINITY;
        for (const t of done.keys()) if (t < first) done.delete(t);
      };
    },
  },
];

export const indicatorDef = (id: IndicatorId): IndicatorDef => INDICATORS.find((d) => d.id === id)!;

/**
 * Świece, poza którymi starsza historia waży łącznie mniej niż 0,1% (średnie rekurencyjne); null — okno stałe.
 * Kilka średnich po sobie (np. MACD: wolna EMA, potem EMA sygnału): suma ogonów, każdy poniżej 0,1% / liczba średnich —
 * ogon splotu nie przekracza sumy ogonów, więc granica jest ostrożna. Okna stałe za średnimi (`lag`) przesuwają granicę.
 */
export function memoryCandles(def: IndicatorDef, p: Params): number | null {
  const alphas = (def.decay?.(p) ?? []).filter((a) => a < 1);
  if (alphas.length === 0) return null;
  const eps = 0.001 / alphas.length;
  return alphas.reduce((sum, a) => sum + Math.ceil(Math.log(eps) / Math.log(1 - a)), def.lag?.(p) ?? 0);
}

/** Wskaźnik na wykresie: instancja z parametrami i stylem (kilka instancji jednego wskaźnika, np. EMA 21 i 55). */
export interface IndicatorInstance {
  iid: string;
  id: IndicatorId;
  params: Params;
  color: string;
  /** Krycie linii 0–1. */
  alpha: number;
  /** Grubość linii w px (1–4). */
  width: number;
  /** Ostatnia wartość na osi ceny. */
  labels: boolean;
  visible: boolean;
  /** Interwał świec, z których liczony jest wskaźnik (np. 1h na wykresie 5m); brak — interwał wykresu. */
  tf?: string;
}

/** Przesunięcie plotu instancji w świecach (0: bez przesunięcia). */
export const plotShift = (x: IndicatorInstance, p: PlotDef): number => p.shift?.(x.params) ?? 0;

/** Grubości linii w oknie stylu. */
export const INDICATOR_WIDTHS = [1, 2, 3, 4] as const;

/** Grubość domyślna: wskaźnik z kilkoma liniami (wstęgi) cieńszy, żeby nie zasłaniał świec. */
export const defaultWidth = (def: IndicatorDef) => (def.plots.length > 1 ? 1 : 2);

/** Najwięcej wskaźników na jednym wykresie. */
export const MAX_INDICATORS = 12;

/** Kolory kolejnych instancji: odróżnialne od świec, VWAP i POC w obu paletach wykresu. */
export const INDICATOR_COLORS = ['#3987e5', '#f2a93b', '#e66767', '#2ec4b6', '#d55181', '#b388ff'] as const;

/** Podpis w legendzie i na liście: skrót, parametry i interwał spoza wykresu („EMA 21”, „BB 20 2,5”, „RSI 14 1h”). */
export function indicatorLabel(x: IndicatorInstance): string {
  const def = indicatorDef(x.id);
  return [def.short, ...def.params.map((p) => numLang(String(x.params[p.key]))), ...(x.tf ? [intervalById(x.tf).label] : [])].join(' ');
}

/**
 * Parametr „Interwał”: bez niego wskaźnik ze stałym okresem (pivoty), rysunek na ostatnich świecach (kanał regresji),
 * wskaźnik przesunięty o świece wykresu (Ichimoku) i wskaźnik z danych spoza świec (taśma, otwarte pozycje).
 */
export const tfAllowed = (def: IndicatorDef): boolean =>
  !def.period && !def.fit && !def.flow && !def.series && !def.sample && !def.forecast && !def.plots.some((p) => p.shift);

/** Interwał wskaźnika: znany identyfikator interwału, a wskaźnik bez parametru „Interwał” go nie ma. */
const tfOk = (def: IndicatorDef, tf: unknown): tf is string => tfAllowed(def) && INTERVALS.some((iv) => iv.id === tf);

/** Wartość parametru w zakresie (przy kroku 1 liczba całkowita). */
export const paramOk = (v: unknown, p: ParamDef): v is number =>
  typeof v === 'number' && v >= p.min && v <= p.max && (p.step < 1 || Number.isInteger(v));

/** Parametry z walidacją: brakujący albo spoza zakresu → domyślny. */
export function parseParams(def: IndicatorDef, raw: unknown): Params {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(def.params.map((p) => [p.key, paramOk(r[p.key], p) ? (r[p.key] as number) : p.def]));
}

const freeIid = (taken: ReadonlySet<string>, id: IndicatorId) => {
  let k = 1;
  while (taken.has(`${id}${k}`)) k++;
  return `${id}${k}`;
};

const freeColor = (list: readonly IndicatorInstance[]) =>
  INDICATOR_COLORS.find((c) => !list.some((x) => x.color === c)) ?? INDICATOR_COLORS[list.length % INDICATOR_COLORS.length];

/** Lista po dodaniu wskaźnika z parametrami i stylem domyślnym oraz wolnym kolorem (bez zmian przy komplecie). */
export function addIndicator(list: readonly IndicatorInstance[], id: IndicatorId): IndicatorInstance[] {
  if (list.length >= MAX_INDICATORS) return [...list];
  const def = indicatorDef(id);
  const iid = freeIid(new Set(list.map((x) => x.iid)), id);
  return [...list, { iid, id, params: parseParams(def, null), color: freeColor(list), alpha: 1, width: defaultWidth(def), labels: true, visible: true }];
}

/** Lista z kopią wskaźnika (te same parametry i styl, wolny kolor) — np. EMA 21, 55 i 200 w trzy kliknięcia. */
export function copyIndicator(list: readonly IndicatorInstance[], iid: string): IndicatorInstance[] {
  const x = list.find((y) => y.iid === iid);
  if (!x || list.length >= MAX_INDICATORS) return [...list];
  return [...list, { ...x, iid: freeIid(new Set(list.map((y) => y.iid)), x.id), color: freeColor(list), visible: true }];
}

/** Zapisana lista z walidacją: nieznany wskaźnik pominięty, błędny parametr domyślny, powtórzony identyfikator nowy. */
export function parseIndicators(raw: unknown): IndicatorInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: IndicatorInstance[] = [];
  const taken = new Set<string>();
  for (const v of raw) {
    const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const def = INDICATORS.find((d) => d.id === r.id);
    if (!def || out.length >= MAX_INDICATORS) continue;
    const iid = typeof r.iid === 'string' && /^[a-z0-9]{1,16}$/.test(r.iid) && !taken.has(r.iid) ? r.iid : freeIid(taken, def.id);
    taken.add(iid);
    const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : freeColor(out);
    const alpha = typeof r.alpha === 'number' && r.alpha >= 0 && r.alpha <= 1 ? r.alpha : 1;
    const width = (INDICATOR_WIDTHS as readonly unknown[]).includes(r.width) ? (r.width as number) : defaultWidth(def);
    const flag = (v: unknown) => (typeof v === 'boolean' ? v : true);
    const x: IndicatorInstance = { iid, id: def.id, params: parseParams(def, r.params), color, alpha, width, labels: flag(r.labels), visible: flag(r.visible) };
    if (tfOk(def, r.tf)) x.tf = r.tf;
    out.push(x);
  }
  return out;
}

/** Widoczne wskaźniki w linku do widoku: `ema(21);rsi(14)@1h;bb(20,2.5)` (parametry w kolejności z rejestru i interwał, bez stylu). */
export const indicatorsLink = (list: readonly IndicatorInstance[]): string =>
  list
    .filter((x) => x.visible)
    .map((x) => `${x.id}(${indicatorDef(x.id).params.map((p) => x.params[p.key]).join(',')})${x.tf ? `@${x.tf}` : ''}`)
    .join(';');

/** Wskaźniki z linku z walidacją jak zapis: nieznany pominięty, błędny parametr domyślny, kolory kolejne. */
export function indicatorsFromLink(link: string): IndicatorInstance[] {
  const raw = link.split(';').map((part) => {
    const m = /^([a-z]+)\(([^()]*)\)(?:@(\w+))?$/.exec(part.trim());
    const def = m ? INDICATORS.find((d) => d.id === m[1]) : undefined;
    if (!m || !def) return null;
    const vals = m[2].split(',');
    return { id: def.id, params: Object.fromEntries(def.params.map((p, i) => [p.key, vals[i] ? Number(vals[i]) : undefined])), tf: m[3] };
  });
  return parseIndicators(raw.filter((r) => r !== null));
}
