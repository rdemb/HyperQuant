import type { Candle } from '../hl/parse';
import { Extreme, Window, ema, rma } from './primitives';
import { numLang } from '../../../ui/format';
import { tr } from '../../../i18n';

/**
 * Rejestr klasycznych wskaźników: jeden opis na wskaźnik (nazwa, parametry, ploty, panel), z którego korzystają
 * ustawienia, menu, legenda i wykres. Wzory i wartości domyślne jak we wbudowanych wskaźnikach TradingView; poziomy
 * to same liczby — wskaźnik opisuje ostatnie świece, nie podpowiada wejść.
 */

export type IndicatorId = 'sma' | 'ema' | 'supertrend' | 'dmi' | 'rsi' | 'stoch' | 'macd' | 'bb' | 'keltner' | 'donchian' | 'atr' | 'obv';

/** Grupy na liście okna wskaźników (jak kategorie TradingView). */
export type IndicatorGroup = 'trend' | 'momentum' | 'volatility' | 'volume';
export const GROUPS: readonly { id: IndicatorGroup; name: string }[] = [
  { id: 'trend', name: 'Trend' },
  { id: 'momentum', name: 'Momentum' },
  { id: 'volatility', name: tr('Zmienność', 'Volatility') },
  { id: 'volume', name: tr('Wolumen', 'Volume') },
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
  /** Opis zależności od historii zamiast wyliczonego (np. suma od początku historii albo pasma trzymające poziom). */
  memoryNote?: string;
  /** Na wykresie ceny albo we własnym panelu pod nim. */
  pane: 'price' | 'own';
  params: readonly ParamDef[];
  plots: readonly PlotDef[];
  /** Linie poziomów w panelu (liczby bez podpisów) i stały zakres jego skali. */
  levels?: readonly number[];
  range?: readonly [number, number];
  /** Liczby: cena z dokładnością ticku rynku, odległość ceny (o miejsce dokładniej niż tick), dwa miejsca albo wolumen. */
  format: 'price' | 'range' | 'fixed2' | 'volume';
  create(p: Params): Step;
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
      const up = rma(p.length);
      const down = rma(p.length);
      let prev = Number.NaN;
      return (c, keep, out) => {
        const d = c.c - prev;
        if (keep) prev = c.c;
        // Pierwsza świeca nie ma zmiany (`na` w Pine) — średnie zaczynają się od drugiej
        if (Number.isNaN(d)) {
          out[0] = Number.NaN;
          return;
        }
        const u = up.next(Math.max(d, 0), keep);
        const w = down.next(Math.max(-d, 0), keep);
        out[0] = Number.isNaN(u) ? Number.NaN : w === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / w);
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
];

export const indicatorDef = (id: IndicatorId): IndicatorDef => INDICATORS.find((d) => d.id === id)!;

/**
 * Świece, poza którymi starsza historia waży łącznie mniej niż 0,1% (średnie rekurencyjne); null — okno stałe.
 * Kilka średnich po sobie (np. MACD: wolna EMA, potem EMA sygnału): suma ogonów, każdy poniżej 0,1% / liczba średnich —
 * ogon splotu nie przekracza sumy ogonów, więc granica jest ostrożna.
 */
export function memoryCandles(def: IndicatorDef, p: Params): number | null {
  const alphas = (def.decay?.(p) ?? []).filter((a) => a < 1);
  if (alphas.length === 0) return null;
  const eps = 0.001 / alphas.length;
  return alphas.reduce((sum, a) => sum + Math.ceil(Math.log(eps) / Math.log(1 - a)), 0);
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
}

/** Grubości linii w oknie stylu. */
export const INDICATOR_WIDTHS = [1, 2, 3, 4] as const;

/** Grubość domyślna: wskaźnik z kilkoma liniami (wstęgi) cieńszy, żeby nie zasłaniał świec. */
export const defaultWidth = (def: IndicatorDef) => (def.plots.length > 1 ? 1 : 2);

/** Najwięcej wskaźników na jednym wykresie. */
export const MAX_INDICATORS = 12;

/** Kolory kolejnych instancji: odróżnialne od świec, VWAP i POC w obu paletach wykresu. */
export const INDICATOR_COLORS = ['#3987e5', '#f2a93b', '#e66767', '#2ec4b6', '#d55181', '#b388ff'] as const;

/** Podpis w legendzie i na liście: skrót i parametry („EMA 21”, „BB 20 2,5”). */
export function indicatorLabel(x: IndicatorInstance): string {
  const def = indicatorDef(x.id);
  return [def.short, ...def.params.map((p) => numLang(String(x.params[p.key])))].join(' ');
}

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
    out.push({ iid, id: def.id, params: parseParams(def, r.params), color, alpha, width, labels: flag(r.labels), visible: flag(r.visible) });
  }
  return out;
}

/** Widoczne wskaźniki w linku do widoku: `ema(21);rsi(14);bb(20,2.5)` (parametry w kolejności z rejestru, bez stylu). */
export const indicatorsLink = (list: readonly IndicatorInstance[]): string =>
  list
    .filter((x) => x.visible)
    .map((x) => `${x.id}(${indicatorDef(x.id).params.map((p) => x.params[p.key]).join(',')})`)
    .join(';');

/** Wskaźniki z linku z walidacją jak zapis: nieznany pominięty, błędny parametr domyślny, kolory kolejne. */
export function indicatorsFromLink(link: string): IndicatorInstance[] {
  const raw = link.split(';').map((part) => {
    const m = /^([a-z]+)\(([^()]*)\)$/.exec(part.trim());
    const def = m ? INDICATORS.find((d) => d.id === m[1]) : undefined;
    if (!m || !def) return null;
    const vals = m[2].split(',');
    return { id: def.id, params: Object.fromEntries(def.params.map((p, i) => [p.key, vals[i] ? Number(vals[i]) : undefined])) };
  });
  return parseIndicators(raw.filter((r) => r !== null));
}
