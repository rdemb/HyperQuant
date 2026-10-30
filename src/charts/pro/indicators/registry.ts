import type { Candle } from '../hl/parse';
import { Window, ema, rma } from './primitives';
import { numLang } from '../../../ui/format';
import { tr } from '../../../i18n';

/**
 * Rejestr klasycznych wskaźników: jeden opis na wskaźnik (nazwa, parametry, ploty, panel), z którego korzystają
 * ustawienia, menu, legenda i wykres. Wzory i wartości domyślne jak we wbudowanych wskaźnikach TradingView; poziomy
 * to same liczby — wskaźnik opisuje ostatnie świece, nie podpowiada wejść.
 */

export type IndicatorId = 'ema' | 'rsi' | 'atr' | 'bb';

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

/** Linia wskaźnika: przerywana (np. środek Bollingera) albo ciągła. */
export interface PlotDef {
  dashed?: boolean;
}

/** Krok wskaźnika: wartości plotów świecy do `out` (NaN = brak); `keep` zatwierdza zamkniętą świecę. */
export type Step = (c: Candle, keep: boolean, out: Float64Array) => void;

export interface IndicatorDef {
  id: IndicatorId;
  /** Skrót w legendzie i na liście (nazwy międzynarodowe bez tłumaczenia). */
  short: string;
  name: string;
  hint: string;
  /** Na wykresie ceny albo we własnym panelu pod nim. */
  pane: 'price' | 'own';
  params: readonly ParamDef[];
  plots: readonly PlotDef[];
  /** Linie poziomów w panelu (liczby bez podpisów) i stały zakres jego skali. */
  levels?: readonly number[];
  range?: readonly [number, number];
  /** Liczby: cena z dokładnością ticku rynku, odległość ceny (o miejsce dokładniej niż tick) albo dwa miejsca. */
  format: 'price' | 'range' | 'fixed2';
  create(p: Params): Step;
}

const length = (def: number): ParamDef => ({ key: 'length', label: tr('Długość', 'Length'), min: 1, max: 1000, step: 1, def });

/** True range świecy; pierwsza świeca (bez poprzedniego zamknięcia) to H − L, jak `ta.tr(true)`. */
const trueRange = (c: Candle, prevClose: number) =>
  Number.isNaN(prevClose) ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));

export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: 'ema',
    short: 'EMA',
    name: tr('Średnia wykładnicza (EMA)', 'Exponential Moving Average (EMA)'),
    hint: tr(
      'Średnia zamknięć z wagami malejącymi wykładniczo, α = 2/(n+1); pierwsza wartość to średnia prosta z n świec',
      'Average of closes with exponentially decreasing weights, α = 2/(n+1); the first value is the simple average of n candles'
    ),
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
    id: 'bb',
    short: 'BB',
    name: tr('Wstęgi Bollingera (BB)', 'Bollinger Bands (BB)'),
    hint: tr(
      'Średnia prosta z n zamknięć (przerywana) i wstęgi ± k odchyleń standardowych populacyjnych, jak w TradingView',
      'Simple average of n closes (dashed) and bands ± k population standard deviations, as in TradingView'
    ),
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
    id: 'rsi',
    short: 'RSI',
    name: tr('Siła względna (RSI)', 'Relative Strength Index (RSI)'),
    hint: tr(
      'Średnie Wildera (RMA) wzrostów i spadków zamknięcia w skali 0–100; linie 70, 50 i 30 to tylko liczby odniesienia',
      "Wilder's averages (RMA) of close-to-close gains and losses on a 0–100 scale; the 70, 50 and 30 lines are reference numbers only"
    ),
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
    id: 'atr',
    short: 'ATR',
    name: tr('Średni prawdziwy zakres (ATR)', 'Average True Range (ATR)'),
    hint: tr(
      'Średnia Wildera (RMA) z true range: największej z H − L i odległości H oraz L od poprzedniego zamknięcia, w USD',
      "Wilder's average (RMA) of the true range: the largest of H − L and the distance of H and L from the previous close, in USD"
    ),
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
];

export const indicatorDef = (id: IndicatorId): IndicatorDef => INDICATORS.find((d) => d.id === id)!;

/** Wskaźnik na wykresie: instancja z parametrami i kolorem (kilka instancji jednego wskaźnika, np. EMA 21 i 55). */
export interface IndicatorInstance {
  iid: string;
  id: IndicatorId;
  params: Params;
  color: string;
  visible: boolean;
}

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

/** Lista po dodaniu wskaźnika z parametrami domyślnymi i wolnym kolorem (bez zmian przy komplecie). */
export function addIndicator(list: readonly IndicatorInstance[], id: IndicatorId): IndicatorInstance[] {
  if (list.length >= MAX_INDICATORS) return [...list];
  const def = indicatorDef(id);
  const iid = freeIid(new Set(list.map((x) => x.iid)), id);
  return [...list, { iid, id, params: parseParams(def, null), color: freeColor(list), visible: true }];
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
    out.push({ iid, id: def.id, params: parseParams(def, r.params), color, visible: typeof r.visible === 'boolean' ? r.visible : true });
  }
  return out;
}
