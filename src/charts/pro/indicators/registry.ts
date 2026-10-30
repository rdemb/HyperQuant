import type { Candle } from '../hl/parse';
import { Extreme, Window, Wma, ema, rma } from './primitives';
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
  | 'linreg'
  | 'hv'
  | 'netvol';

/** Grupy na liście okna wskaźników (jak kategorie TradingView). */
export type IndicatorGroup = 'trend' | 'momentum' | 'volatility' | 'volume' | 'levels';
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
}

/** Kolory stałych linii: drugiej i trzeciej linii wskaźnika oraz słupków dodatnich i ujemnych. */
const ORANGE = '#f2a93b';
const TEAL = '#2ec4b6';
const RED = '#e66767';
export const HIST_UP = TEAL;
export const HIST_DOWN = RED;

/** Krok wskaźnika: wartości plotów świecy do `out` (NaN = brak); `keep` zatwierdza zamkniętą świecę. */
export type Step = (c: Candle, keep: boolean, out: Float64Array) => void;

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
  /** Linie poziomów w panelu (liczby bez podpisów) i stały zakres jego skali. */
  levels?: readonly number[];
  range?: readonly [number, number];
  /** Liczby: cena z dokładnością ticku rynku, odległość ceny (o miejsce dokładniej niż tick), dwa albo trzy miejsca, wolumen. */
  format: 'price' | 'range' | 'fixed2' | 'fixed3' | 'volume';
  /** Krok świeca po świecy; bez niego wskaźnik to rysunek na ostatnich świecach (`fit`). */
  create?(p: Params): Step;
  /**
   * Rysunek na ostatnich świecach (kanał regresji, jak w TradingView): liczony od nowa z ostatnich `span` świec przy
   * każdej zmianie; `at(0)` to najnowsza świeca, wartości plotu k świecy `end − j` trafiają do `out[k][end − j]`.
   */
  fit?: { span(p: Params): number; run(at: (j: number) => Candle, p: Params, out: Float64Array[], end: number): void };
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

/** Interwał wskaźnika: znany identyfikator interwału, a wskaźnik ze stałym okresem (pivoty) go nie ma. */
const tfOk = (def: IndicatorDef, tf: unknown): tf is string => !def.period && !def.fit && INTERVALS.some((iv) => iv.id === tf);

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
