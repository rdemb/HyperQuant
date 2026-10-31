import { ChartSettings, DEFAULT_SETTINGS, NARROW_PATCH, parseSettings } from './settings';
import { INDICATOR_COLORS, IndicatorId, IndicatorInstance, Params, defaultWidth, indicatorDef, parseParams } from '../indicators/registry';
import { tr } from '../../../i18n';

/**
 * Szablony wykresu: zestaw ustawień (interwał, rodzaj wykresu, panele, wskaźniki, warstwy) do nałożenia jednym
 * kliknięciem. Rynek i wysokość wiersza zostają z wykresu — zależą od ceny rynku, nie od szablonu.
 */

export type TemplateSettings = Omit<ChartSettings, 'coin' | 'rowStep'>;

export interface ChartTemplate {
  id: string;
  name: string;
  builtIn: boolean;
  s: TemplateSettings;
}

const KEY = 'hq.charts.templates.v1';
/** Najwięcej własnych szablonów. */
export const MAX_TEMPLATES = 20;
const NAME_MAX = 40;

export function templateOf(s: ChartSettings): TemplateSettings {
  const { coin: _coin, rowStep: _row, ...rest } = s;
  return rest;
}

/** Szablon na ustawieniach wykresu (z walidacją pól, rynek i wysokość wiersza bez zmian). */
export function applyTemplate(s: ChartSettings, t: TemplateSettings): ChartSettings {
  return { ...parseSettings({ ...s, ...t }, s), coin: s.coin, rowStep: s.rowStep };
}

/** Wszystkie warstwy na wykresie ceny wyłączone (podstawa szablonów i stacji, które włączają tylko swoje). */
export const LAYERS_OFF = {
  showVwap: false,
  showVwapBands: false,
  showSessionVwap: false,
  showProfile: false,
  showPeriodProfiles: false,
  showDevPoc: false,
  showTpo: false,
  showLevels: false,
  showSessions: false,
  showIb: false,
  showLiq: false,
  showWhales: false,
  showZones: false,
  showAuctions: false,
  showHeatmap: false,
  showBubbles: false,
  showClashes: false,
  showLots: false,
} satisfies Partial<ChartSettings>;

/** Wszystkie warstwy orderflow naraz (poza TPO i rozwijającym się POC, które zastępują profile sesji). */
const full = {
  showStats: true,
  showVwapBands: true,
  showSessionVwap: true,
  showPeriodProfiles: true,
  showLevels: true,
  showSessions: true,
  showIb: true,
  showLiq: true,
  showWhales: true,
  showZones: true,
  showAuctions: true,
  showHeatmap: true,
  showBubbles: true,
  showClashes: true,
  showLots: true,
} satisfies Partial<ChartSettings>;

const built = (id: string, name: string, patch: Partial<TemplateSettings>): ChartTemplate => ({
  id,
  name,
  builtIn: true,
  s: { ...templateOf(DEFAULT_SETTINGS), ...patch },
});

type IndSpec = [IndicatorId, Partial<Record<string, number>>?, Partial<IndicatorInstance>?];

/** Lista wskaźników szablonu: identyfikatory jak przy dodawaniu z menu (ema1, sma2), kolejne kolory z palety wskaźników. */
const inds = (...specs: IndSpec[]): IndicatorInstance[] => {
  const seen = new Map<IndicatorId, number>();
  return specs.map(([id, params = {}, extra = {}], i) => {
    const def = indicatorDef(id);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return {
      iid: `${id}${n}`,
      id,
      params: { ...parseParams(def, null), ...params } as Params,
      color: INDICATOR_COLORS[i % INDICATOR_COLORS.length],
      alpha: 1,
      width: defaultWidth(def),
      labels: true,
      visible: true,
      ...extra,
    };
  });
};

/** Podstawa szablonów jednego pytania: same świece, bez paneli i warstw (każdy szablon włącza tylko swoje). */
const bare = { ...LAYERS_OFF, view: 'candles', showDelta: false, showCvd: false, showStats: false, showTape: false } satisfies Partial<TemplateSettings>;

export const BUILT_IN_TEMPLATES: readonly ChartTemplate[] = [
  built('orderflow', tr('Pełny orderflow: wszystkie warstwy', 'Full orderflow: all layers'), full),
  built('scalp', tr('Skalping 1m: taśma, mapa, strefy', 'Scalping 1m: tape, heatmap, zones'), {
    ...full,
    interval: '1m',
    showTape: true,
    showPeriodProfiles: false,
    showSessions: false,
    showIb: false,
  }),
  built('swing', tr('Swing 1h: poziomy i profile', 'Swing 1h: levels and profiles'), {
    ...LAYERS_OFF,
    interval: '1h',
    view: 'candles',
    showDelta: false,
    showStats: false,
    showVwap: true,
    showVwapBands: true,
    showProfile: true,
    showPeriodProfiles: true,
    showLevels: true,
    showIb: true,
    showLiq: true,
    showWhales: true,
  }),
  // Teoria aukcji (Steidlmayer, Dalton): TPO dób z value area, pasma VWAP i IB sesji
  built('tpo', tr('Market Profile 30m: TPO, value area, IB', 'Market Profile 30m: TPO, value area, IB'), {
    ...bare,
    interval: '30m',
    showTpo: true,
    showVwap: true,
    showVwapBands: true,
    showLevels: true,
    showIb: true,
  }),
  built('clean', tr('Czyste świece', 'Clean candles'), { ...LAYERS_OFF, view: 'candles', showDelta: false, showCvd: false, showStats: false }),
  // Kontekst wyższych interwałów (początek zestawów kart MTF): klasyczne średnie doby jak w TradingView i VWAP tygodnia
  built('context-1d', tr('Kontekst 1D: średnie 20, 50, 200 i VWAP tygodnia', 'Context 1D: 20, 50, 200 averages and weekly VWAP'), {
    ...bare,
    interval: '1d',
    showVwap: true,
    indicators: inds(['sma', { length: 20 }], ['sma', { length: 50 }], ['sma', { length: 200 }]),
  }),
  // Dalton: wartość ostatnich dni na 4h (jak drugi wykres stacji Aukcja)
  built('context-4h', tr('Kontekst 4H: profile sesji, nagie POC, IB', 'Context 4H: session profiles, naked POCs, IB'), {
    ...bare,
    interval: '4h',
    showVwap: true,
    showPeriodProfiles: true,
    showLevels: true,
    showIb: true,
  }),
  // T2: Crabel, Fisher, Dalton (IB); ATR z doby jako skala zakresu otwarcia
  built('open-range', tr('Otwarcie sesji: zakres otwarcia i IB', 'Session open: opening range and IB'), {
    ...bare,
    interval: '5m',
    showSessions: true,
    showIb: true,
    showSessionVwap: true,
    showVwap: true,
    showLevels: true,
    indicators: inds(['atr', { length: 14 }, { tf: '1d' }]),
  }),
  // T3: Bollinger (squeeze), Carter (BB 20/2 w KC 20/1,5), reżim BOCPD; hv ukryte do czasu panelu BandWidth
  built('squeeze', tr('Ściśnięcie zmienności: BB w KC i reżim', 'Volatility squeeze: BB inside KC and regime'), {
    ...bare,
    interval: '15m',
    showVwap: true,
    showLevels: true,
    indicators: inds(['bb', { length: 20, mult: 2 }], ['keltner', { length: 20, mult: 1.5, atr: 10 }], ['regime', { length: 200, recent: 20 }], ['hv', { length: 10 }, { visible: false }]),
  }),
  // T4: Wyckoff i VSA (wysiłek a efekt) na delcie z taśmy
  built('effort-result', tr('Wysiłek a efekt: wolumen, delta, absorpcja', 'Effort vs result: volume, delta, absorption'), {
    ...LAYERS_OFF,
    interval: '5m',
    view: 'candles',
    showVolume: true,
    showDelta: true,
    showCvd: true,
    cvdReset: 'session',
    showStats: false,
    showVwap: true,
    showLevels: true,
    showZones: true,
    showAuctions: true,
    indicators: inds(['absorption', { length: 120 }], ['oiflow']),
  }),
  // T5: Shannon (VWAP i średnie wyższego interwału)
  built('vwap-mtf', tr('VWAP i średnie z doby', 'VWAP and daily averages'), {
    ...bare,
    interval: '1h',
    showVwap: true,
    showVwapBands: true,
    showSessionVwap: true,
    showLevels: true,
    indicators: inds(['sma', { length: 20 }, { tf: '1d' }], ['sma', { length: 50 }, { tf: '1d' }]),
  }),
  // T6: Brooks (5m i jedna EMA 20)
  built('price-action', tr('Price action 5m z EMA 20', '5-minute price action with the 20 EMA'), {
    ...bare,
    interval: '5m',
    showLevels: true,
    showSessions: true,
    indicators: inds(['ema', { length: 20 }]),
  }),
  // T7: Raschke i Connors (ADX 14 i EMA 20)
  built('adx-ema', tr('Siła ruchu: ADX i EMA 20', 'Move strength: ADX and the 20 EMA'), {
    ...bare,
    interval: '15m',
    showVwap: true,
    indicators: inds(['ema', { length: 20 }], ['dmi', { length: 14, adx: 14 }]),
  }),
  // T8: kto naciska (biorcy, TWAP); wielkość zleceń i powracający biorcy ukryci, żeby zostały 2 panele własne
  built('who-takers', tr('Kto naciska: biorcy i TWAP', 'Who is pushing: takers and TWAP'), {
    ...LAYERS_OFF,
    interval: '1m',
    view: 'footprint',
    fpStyle: 'delta',
    showVwap: true,
    showBubbles: true,
    showZones: true,
    showDelta: true,
    showCvd: false,
    showStats: true,
    statGroups: ['tape', 'who'],
    indicators: inds(['breadth'], ['twap'], ['ordersize', { length: 100 }, { visible: false }], ['repeat', { window: 15 }, { visible: false }]),
  }),
  // T10: pozycjonowanie (OI, finansowanie, likwidacje, wieloryby); OI Binance i Bybit pobiera przeglądarka czytelnika
  built('positioning', tr('Pozycjonowanie: OI, finansowanie, likwidacje', 'Positioning: OI, funding, liquidations'), {
    ...bare,
    interval: '15m',
    showVwap: true,
    showLevels: true,
    showLiq: true,
    showWhales: true,
    showCvd: true,
    cvdReset: 'day',
    showVenueOi: true,
    indicators: inds(['oiflow']),
  }),
  // T11: reżim (BOCPD), stożek HAR z dziennika, rynki HIP-4 (tylko BTC)
  built('regime-cone', tr('Reżim zmienności i stożek zakresu', 'Volatility regime and range cone'), {
    ...bare,
    interval: '15m',
    showVwap: true,
    showLevels: true,
    indicators: inds(['cone'], ['outcomes'], ['regime', { length: 200, recent: 20 }], ['hv', { length: 10 }, { visible: false }]),
  }),
  // T12: Elder (Triple Screen), Shannon: 15m z EMA 20 z 1h i MACD z 4h
  built('triple', tr('Trzy ekrany na jednym wykresie', 'Three screens on one chart'), {
    ...bare,
    interval: '15m',
    showVwap: true,
    showLevels: true,
    indicators: inds(['ema', { length: 20 }, { tf: '1h' }], ['macd', { fast: 12, slow: 26, signal: 9 }, { tf: '4h' }]),
  }),
];

/** Pytanie każdego szablonu (podpowiedź karty i listy szablonów). */
export const TEMPLATE_QUESTIONS: Readonly<Record<string, string>> = {
  'context-1d': tr('Gdzie jest cena w trendzie wielu tygodni: nad czy pod średnimi z doby i VWAP tygodnia?', 'Where is price in the multi-week trend: above or below the daily averages and the weekly VWAP?'),
  'context-4h': tr('Gdzie w ostatnich dniach leżała wartość i które POC zostały nagie?', 'Where did value sit over the last days, and which POCs are still naked?'),
  tpo: tr('Czy doba jest w równowadze z wczorajszą wartością, czy ją opuściła?', 'Is the day in balance with yesterday’s value, or has it left it?'),
  'open-range': tr('Czy po otwarciu sesji cena została w zakresie otwarcia, czy go opuściła?', 'After the session open, did price stay in the opening range or leave it?'),
  squeeze: tr('Czy zmienność jest ściśnięta i czy reżim już się zmienił?', 'Is volatility compressed, and has the regime already changed?'),
  'effort-result': tr('Czy agresja przesuwa cenę jak zwykle, mniej czy bardziej?', 'Does aggression move price as usual, less or more?'),
  'vwap-mtf': tr('Gdzie jest cena wobec VWAP doby i sesji oraz średnich z doby?', 'Where is price relative to the day and session VWAP and the daily averages?'),
  'price-action': tr('Trend czy zakres i jak wygląda bieżąca noga?', 'Trend or range, and what does the current leg look like?'),
  'adx-ema': tr('Czy ruch ma siłę i jak daleko cena odeszła od średniej?', 'Does the move have strength, and how far has price moved from the average?'),
  'who-takers': tr('Czy agresję daje wiele kont czy jedno, ręcznie czy TWAP-em?', 'Is aggression coming from many accounts or one, by hand or by TWAP?'),
  positioning: tr(
    'Czy ruch idzie z przyrostem czy ubytkiem otwartych pozycji? (OI Binance i Bybit pobiera Twoja przeglądarka)',
    'Is the move coming with rising or falling open interest? (your browser fetches Binance and Bybit OI)'
  ),
  'regime-cone': tr('Jaka jest teraz zmienność i jakiego zakresu oczekuje model sprawdzany publicznie?', 'How volatile is it now, and what range does the publicly checked model expect?'),
  triple: tr('Co mówią wyższe interwały, zanim spojrzę na 15m?', 'What do the higher timeframes say before I look at 15m?'),
};

/**
 * Telefon: pełna łatka do nałożenia zamiast samego NARROW_PATCH (szablony, w których NARROW_PATCH zdejmuje sedno
 * pytania, np. otwarcia sesji). Szablony spoza mapy: NARROW_PATCH.
 */
export const TEMPLATE_PHONE: Readonly<Record<string, Partial<ChartSettings>>> = {
  'open-range': { ...NARROW_PATCH, showSessions: true },
  'price-action': { ...NARROW_PATCH, showSessions: true },
  'who-takers': { ...NARROW_PATCH, showStats: false, showZones: false },
};

/**
 * Zestawy kart MTF: od wyższego interwału do niższego (kontekst 1D i 4H, struktura, otwarcie lub setup, wykonanie).
 * Wzorzec karty: stacja albo `tpl:<id szablonu>`; `tf` zmienia interwał wzorca tylko w tej karcie.
 */
export interface MtfSet {
  id: string;
  name: string;
  tabs: readonly { preset: string; tf?: string }[];
}

const CONTEXT = [{ preset: 'tpl:context-1d' }, { preset: 'tpl:context-4h' }] as const;

export const MTF_SETS: readonly MtfSet[] = [
  {
    id: 'auction-day',
    name: tr('Dzień aukcji', 'Auction day'),
    tabs: [...CONTEXT, { preset: 'tpl:vwap-mtf' }, { preset: 'tpl:tpo' }, { preset: 'tpl:open-range' }, { preset: 'tpl:who-takers' }],
  },
  {
    id: 'trend',
    name: tr('Trend', 'Trend'),
    tabs: [...CONTEXT, { preset: 'tpl:triple' }, { preset: 'tpl:adx-ema' }, { preset: 'tpl:price-action' }, { preset: 'scalp' }],
  },
  {
    id: 'volatility',
    name: tr('Zmienność i pozycje', 'Volatility and positioning'),
    tabs: [...CONTEXT, { preset: 'tpl:squeeze', tf: '1h' }, { preset: 'tpl:regime-cone' }, { preset: 'tpl:positioning' }, { preset: 'tpl:effort-result' }],
  },
];

export function parseTemplates(raw: unknown): ChartTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartTemplate[] = [];
  for (const v of raw) {
    const t = v as Partial<ChartTemplate> | null;
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || !t.name.trim()) continue;
    out.push({ id: t.id, name: t.name.trim().slice(0, NAME_MAX), builtIn: false, s: templateOf(parseSettings(t.s)) });
  }
  return out.slice(-MAX_TEMPLATES);
}

let seq = 0;

/** Własny szablon z bieżących ustawień; ta sama nazwa zastępuje poprzedni. */
export function saveAs(list: readonly ChartTemplate[], name: string, s: ChartSettings, now = Date.now()): ChartTemplate[] {
  const n = name.trim().slice(0, NAME_MAX);
  if (!n) return [...list];
  const t: ChartTemplate = { id: `${now.toString(36)}${(seq++).toString(36)}`, name: n, builtIn: false, s: templateOf(s) };
  return [...list.filter((x) => x.name !== n), t].slice(-MAX_TEMPLATES);
}

export function loadTemplates(): ChartTemplate[] {
  try {
    const s = localStorage.getItem(KEY);
    return parseTemplates(s ? JSON.parse(s) : null);
  } catch {
    return [];
  }
}

export function saveTemplates(list: readonly ChartTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Prywatne okno albo zablokowana pamięć — szablony działają do końca sesji
  }
}
