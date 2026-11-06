import type { ChartLayout, ChartSettings } from './settings';
import type { IndicatorId, IndicatorInstance } from '../indicators/registry';
import { tr } from '../../../i18n';

/**
 * Zamrożona kopia wzorców sprzed układów faz (etap 1a): 6 stacji roboczych i 17 wbudowanych szablonów, tylko dane.
 * Używa jej wyłącznie migracja kart (`migrateTabsV2` w tabs.ts): karta oparta na dawnej stacji albo szablonie dostaje
 * pod swoimi kluczami wzorzec, który widział użytkownik. Wartości przepisane z kodu z dnia zmiany (z wynikami
 * `built()` i `inds()`), więc późniejsze zmiany wskaźników, warstw czy telefonu ich nie ruszają. Nie zmieniać.
 */

/** Dawna stacja robocza: kształt `Station` sprzed układów faz (bez fazy i zestawów paneli). */
export interface LegacyStation {
  id: string;
  name: string;
  question: string;
  layout: ChartLayout;
  panels: readonly Partial<ChartSettings>[];
  phone: Partial<ChartSettings>;
}

/** Dawny wbudowany szablon: jeden wykres `{...templateOf(DEFAULT_SETTINGS), ...patch}`. */
export interface LegacyTemplate {
  id: string;
  name: string;
  patch: Partial<ChartSettings>;
}

/** Dawny NARROW_PATCH (telefon). */
const NARROW = { showDelta: false, showProfile: false, showLevels: false, showSessions: false } satisfies Partial<ChartSettings>;

/** Dawny LAYERS_OFF: wszystkie warstwy na wykresie ceny wyłączone. */
const OFF = {
  showVwap: false,
  showVwapBands: false,
  showSessionVwap: false,
  showProfile: false,
  showPeriodProfiles: false,
  showDevPoc: false,
  showTpo: false,
  showTpoOi: false,
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

/** Dawny zestaw „wszystkie warstwy orderflow” (szablony Pełny orderflow i Skalping 1m). */
const FULL = {
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

/** Dawna podstawa szablonów jednego pytania: same świece, bez paneli i warstw. */
const BARE = { ...OFF, view: 'candles', showDelta: false, showCvd: false, showStats: false, showTape: false } satisfies Partial<ChartSettings>;

/** Instancja wskaźnika z dawnego `inds()` (styl jak przy dodaniu z menu). */
const ind = (iid: string, id: IndicatorId, params: Record<string, number>, color: string, width: number, extra: Partial<IndicatorInstance> = {}): IndicatorInstance => ({
  iid,
  id,
  params,
  color,
  alpha: 1,
  width,
  labels: true,
  visible: true,
  ...extra,
});

export const LEGACY_STATIONS: readonly LegacyStation[] = [
  {
    id: 'start',
    name: 'Start',
    question: tr(
      'Co się dzieje? Footprint z VWAP, profilem i poziomami dnia, wolumen, delta i CVD',
      'What is happening? Footprint with VWAP, profile and daily levels, volume, delta and CVD'
    ),
    layout: 1,
    panels: [{}],
    phone: NARROW,
  },
  {
    id: 'scalp',
    name: tr('Skalper', 'Scalper'),
    question: tr(
      'Kto teraz naciska? Footprint 1m z mapą ciepła i DOM, bąble, ściany, duże zlecenia w arkuszu, strefy, taśma zleceń i Kto handluje (duzi gracze i reszta)',
      'Who is pushing now? 1m footprint with heatmap and DOM, bubbles, walls, large orders in the book, zones, order tape and Who is trading (large players and the rest)'
    ),
    layout: 1,
    panels: [
      {
        ...OFF,
        interval: '1m',
        view: 'footprint',
        showVwap: true,
        showHeatmap: true,
        showBubbles: true,
        showClashes: true,
        showLots: true,
        showZones: true,
        showTape: true,
        showStats: true,
        statGroups: ['who'],
      },
    ],
    phone: { ...NARROW, showClashes: false, showLots: false, showZones: false, showStats: false },
  },
  {
    id: 'liquidity',
    name: tr('Płynność', 'Liquidity'),
    question: tr(
      'Gdzie stoją zlecenia i pozycje? Mapa ciepła, bąble, ściany, duże zlecenia w arkuszu, wieloryby i klastry likwidacji',
      'Where do orders and positions sit? Heatmap, bubbles, walls, large orders in the book, whales and liquidation clusters'
    ),
    layout: 1,
    panels: [
      {
        ...OFF,
        interval: '5m',
        view: 'candles',
        showDelta: false,
        showVwap: true,
        showHeatmap: true,
        showBubbles: true,
        showClashes: true,
        showLots: true,
        showWhales: true,
        showLiq: true,
      },
    ],
    phone: { ...NARROW, showClashes: false, showLots: false },
  },
  {
    id: 'auction',
    name: tr('Aukcja', 'Auction'),
    question: tr(
      'Gdzie rynek widzi wartość? 30m z TPO i VWAP ±σ obok 4h z profilami sesji i IB',
      'Where does the market see value? 30m with TPO and VWAP ±σ next to 4h with session profiles and IB'
    ),
    layout: 2,
    panels: [
      { ...OFF, interval: '30m', view: 'candles', showDelta: false, showCvd: false, showTpo: true, showVwap: true, showVwapBands: true, showLevels: true },
      { ...OFF, interval: '4h', view: 'candles', showDelta: false, showCvd: false, showVwap: true, showPeriodProfiles: true, showLevels: true, showIb: true },
    ],
    phone: NARROW,
  },
  {
    id: 'venues',
    name: tr('Giełdy', 'Exchanges'),
    question: tr(
      'Czy reszta rynku się zgadza? CVD Hyperliquid, Binance i Bybit oraz Tablica liczb (dane Binance i Bybit pobiera Twoja przeglądarka)',
      'Does the rest of the market agree? Hyperliquid, Binance and Bybit CVD plus the Numbers table (your browser fetches Binance and Bybit data)'
    ),
    layout: 1,
    panels: [
      {
        ...OFF,
        interval: '1h',
        view: 'candles',
        showDelta: false,
        showCvd: false,
        showVenueCvd: true,
        showVwap: true,
        showLevels: true,
        showStats: true,
        statGroups: ['hl', 'binance', 'bybit'],
      },
    ],
    phone: { ...NARROW, showStats: false },
  },
  {
    id: 'mtf',
    name: tr('Dwa interwały', 'Two timeframes'),
    question: tr(
      'Co mówi wyższy interwał? 5m footprint z mapą ciepła obok 1h ze świecami i profilami sesji',
      'What does the higher timeframe say? 5m footprint with heatmap next to 1h candles with session profiles'
    ),
    layout: 2,
    panels: [
      { ...OFF, interval: '5m', view: 'footprint', showVwap: true, showProfile: true, showHeatmap: true, showBubbles: true },
      { ...OFF, interval: '1h', view: 'candles', showDelta: false, showVwap: true, showPeriodProfiles: true, showLevels: true },
    ],
    phone: NARROW,
  },
];

export const LEGACY_TEMPLATES: readonly LegacyTemplate[] = [
  { id: 'orderflow', name: tr('Pełny orderflow: wszystkie warstwy', 'Full orderflow: all layers'), patch: FULL },
  {
    id: 'scalp',
    name: tr('Skalping 1m: taśma, mapa, strefy', 'Scalping 1m: tape, heatmap, zones'),
    patch: { ...FULL, interval: '1m', showTape: true, showPeriodProfiles: false, showSessions: false, showIb: false },
  },
  {
    id: 'swing',
    name: tr('Swing 1h: poziomy i profile', 'Swing 1h: levels and profiles'),
    patch: {
      ...OFF,
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
    },
  },
  {
    id: 'tpo',
    name: tr('Market Profile 30m: wolumen, agresja, czas, value area, IB', 'Market Profile 30m: volume, aggression, time, value area, IB'),
    patch: { ...BARE, interval: '30m', showTpo: true, showVwap: true, showVwapBands: true, showLevels: true, showIb: true },
  },
  { id: 'clean', name: tr('Czyste świece', 'Clean candles'), patch: { ...OFF, view: 'candles', showDelta: false, showCvd: false, showStats: false } },
  {
    id: 'context-1d',
    name: tr('Kontekst 1D: średnie 20, 50, 200 i VWAP tygodnia', 'Context 1D: 20, 50, 200 averages and weekly VWAP'),
    patch: {
      ...BARE,
      interval: '1d',
      showVwap: true,
      indicators: [
        ind('sma1', 'sma', { length: 20 }, '#3987e5', 2),
        ind('sma2', 'sma', { length: 50 }, '#f2a93b', 2),
        ind('sma3', 'sma', { length: 200 }, '#e66767', 2),
      ],
    },
  },
  {
    id: 'context-4h',
    name: tr('Kontekst 4H: profile sesji, nagie POC, IB', 'Context 4H: session profiles, naked POCs, IB'),
    patch: { ...BARE, interval: '4h', showVwap: true, showPeriodProfiles: true, showLevels: true, showIb: true },
  },
  {
    id: 'open-range',
    name: tr('Otwarcie sesji: zakres otwarcia i IB', 'Session open: opening range and IB'),
    patch: {
      ...BARE,
      interval: '5m',
      showSessions: true,
      showIb: true,
      showSessionVwap: true,
      showVwap: true,
      showLevels: true,
      indicators: [ind('atr1', 'atr', { length: 14 }, '#3987e5', 2, { tf: '1d' })],
    },
  },
  {
    id: 'squeeze',
    name: tr('Ściśnięcie zmienności: BB w KC i reżim', 'Volatility squeeze: BB inside KC and regime'),
    patch: {
      ...BARE,
      interval: '15m',
      showVwap: true,
      showLevels: true,
      indicators: [
        ind('bb1', 'bb', { length: 20, mult: 2 }, '#3987e5', 1),
        ind('keltner1', 'keltner', { length: 20, mult: 1.5, atr: 10 }, '#f2a93b', 1),
        ind('regime1', 'regime', { length: 200, recent: 20 }, '#e66767', 1),
        ind('hv1', 'hv', { length: 10 }, '#2ec4b6', 2, { visible: false }),
      ],
    },
  },
  {
    id: 'effort-result',
    name: tr('Wysiłek a efekt: wolumen, delta, absorpcja', 'Effort vs result: volume, delta, absorption'),
    patch: {
      ...OFF,
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
      indicators: [ind('absorption1', 'absorption', { length: 120 }, '#3987e5', 1), ind('oiflow1', 'oiflow', {}, '#f2a93b', 1)],
    },
  },
  {
    id: 'vwap-mtf',
    name: tr('VWAP i średnie z doby', 'VWAP and daily averages'),
    patch: {
      ...BARE,
      interval: '1h',
      showVwap: true,
      showVwapBands: true,
      showSessionVwap: true,
      showLevels: true,
      indicators: [ind('sma1', 'sma', { length: 20 }, '#3987e5', 2, { tf: '1d' }), ind('sma2', 'sma', { length: 50 }, '#f2a93b', 2, { tf: '1d' })],
    },
  },
  {
    id: 'price-action',
    name: tr('Price action 5m z EMA 20', '5-minute price action with the 20 EMA'),
    patch: { ...BARE, interval: '5m', showLevels: true, showSessions: true, indicators: [ind('ema1', 'ema', { length: 20 }, '#3987e5', 2)] },
  },
  {
    id: 'adx-ema',
    name: tr('Siła ruchu: ADX i EMA 20', 'Move strength: ADX and the 20 EMA'),
    patch: {
      ...BARE,
      interval: '15m',
      showVwap: true,
      indicators: [ind('ema1', 'ema', { length: 20 }, '#3987e5', 2), ind('dmi1', 'dmi', { length: 14, adx: 14 }, '#f2a93b', 1)],
    },
  },
  {
    id: 'who-takers',
    name: tr('Kto naciska: biorcy i TWAP', 'Who is pushing: takers and TWAP'),
    patch: {
      ...OFF,
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
      indicators: [
        ind('breadth1', 'breadth', {}, '#3987e5', 1),
        ind('twap1', 'twap', {}, '#f2a93b', 1),
        ind('ordersize1', 'ordersize', { length: 100 }, '#e66767', 1, { visible: false }),
        ind('repeat1', 'repeat', { window: 15 }, '#2ec4b6', 1, { visible: false }),
      ],
    },
  },
  {
    id: 'positioning',
    name: tr('Pozycjonowanie: OI, finansowanie, likwidacje', 'Positioning: OI, funding, liquidations'),
    patch: {
      ...BARE,
      interval: '15m',
      showVwap: true,
      showLevels: true,
      showLiq: true,
      showWhales: true,
      showCvd: true,
      cvdReset: 'day',
      showVenueOi: true,
      indicators: [ind('oiflow1', 'oiflow', {}, '#3987e5', 1)],
    },
  },
  {
    id: 'regime-cone',
    name: tr('Reżim zmienności i stożek zakresu', 'Volatility regime and range cone'),
    patch: {
      ...BARE,
      interval: '15m',
      showVwap: true,
      showLevels: true,
      indicators: [
        ind('cone1', 'cone', {}, '#3987e5', 2),
        ind('outcomes1', 'outcomes', {}, '#f2a93b', 2),
        ind('regime1', 'regime', { length: 200, recent: 20 }, '#e66767', 1),
        ind('hv1', 'hv', { length: 10 }, '#2ec4b6', 2, { visible: false }),
      ],
    },
  },
  {
    id: 'triple',
    name: tr('Trzy ekrany na jednym wykresie', 'Three screens on one chart'),
    patch: {
      ...BARE,
      interval: '15m',
      showVwap: true,
      showLevels: true,
      indicators: [
        ind('ema1', 'ema', { length: 20 }, '#3987e5', 2, { tf: '1h' }),
        ind('macd1', 'macd', { fast: 12, slow: 26, signal: 9 }, '#f2a93b', 1, { tf: '4h' }),
      ],
    },
  },
];

/** Dawne łatki telefonu szablonów (pozostałe szablony: NARROW_PATCH). */
export const LEGACY_TEMPLATE_PHONE: Readonly<Record<string, Partial<ChartSettings>>> = {
  'open-range': { ...NARROW, showSessions: true },
  'price-action': { ...NARROW, showSessions: true },
  'who-takers': { ...NARROW, showStats: false, showZones: false },
};

/** Dawny NARROW_PATCH dla szablonów spoza mapy łatek. */
export const LEGACY_NARROW: Partial<ChartSettings> = NARROW;

/** Klucze dawnej stacji Start: panele 0–3 i układ (sprzed kart; dziś tylko do odczytu). */
export const LEGACY_START_KEYS: readonly string[] = ['hq.charts.v1', 'hq.charts.v1.p1', 'hq.charts.v1.p2', 'hq.charts.v1.p3', 'hq.charts.layout.v1'];

/** Dawna aktywna stacja sprzed kart (domyślna karta przy migracji użytkownika bez zapisu kart). */
export const LEGACY_ACTIVE_KEY = 'hq.charts.station.v1';
