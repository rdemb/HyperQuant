import { ChartLayout, ChartSettings, DEFAULT_SETTINGS, NARROW_PATCH, parseLayout } from './settings';
import { LAYERS_OFF, inds } from './templates';
import { type IndicatorInstance, indicatorDef } from '../indicators/registry';
import { tr } from '../../../i18n';

/**
 * Układy wykresu w fazach dnia tradera (przed sesją, w sesji, po sesji): każdy to gotowy układ wykresów pod jedno
 * pytanie. Każdy układ ma własny zapis ustawień paneli i układu (pod swoim id), więc zmiany zostają jako wersja
 * użytkownika, a „Przywróć” wraca do wzorca. Dawne stacje robocze prowadzą do nowych układów przez LEGACY_STATION.
 */

export type StationId = 'day-map' | 'fuel' | 'cockpit' | 'auction-open' | 'big-hands' | 'review';
export type PhaseId = 'before' | 'session' | 'after';

/**
 * Zestaw paneli wskaźników przełączany jednym kliknięciem (np. Aukcja i Absorpcja w układzie Aukcja i otwarcie).
 * `patch` — zmiany ustawień nakładane na wzorzec układu, gdy zestaw jest włączony (np. Absorpcja chowa CVD).
 */
export interface PanelSet {
  id: string;
  name: string;
  indicators: IndicatorInstance[];
  patch?: Partial<ChartSettings>;
}

export interface Station {
  id: StationId;
  name: string;
  /** Pytanie układu (nagłówek i podpowiedź przycisku). */
  question: string;
  /** Faza dnia, w której układ jest na ekranie. */
  phase: PhaseId;
  /** Układ na szerokim ekranie. */
  layout: ChartLayout;
  /** Wzorzec kolejnych paneli układu na komputerze: zmiany względem ustawień startowych. */
  panels: readonly Partial<ChartSettings>[];
  /** Zmiany pierwszego panelu na telefonie (tam zawsze jeden wykres). */
  phone: Partial<ChartSettings>;
  /** Zestawy paneli wskaźników; pierwszy jest we wzorcu panelu. */
  panelSets?: readonly PanelSet[];
}

/** Układy każdej fazy w kolejności na ekranie. */
export const PHASE_LAYOUTS: Record<PhaseId, readonly StationId[]> = {
  before: ['day-map', 'fuel'],
  session: ['cockpit', 'auction-open', 'big-hands'],
  after: ['review'],
};

/** Dawne stacje robocze (karty, linki powtórki z bloga i lekcji) → układ, który przejął ich pytanie. */
export const LEGACY_STATION: Readonly<Record<string, StationId>> = {
  start: 'cockpit',
  scalp: 'cockpit',
  liquidity: 'fuel',
  auction: 'day-map',
  venues: 'big-hands',
  mtf: 'cockpit',
};

// Mapa dnia: 30m z TPO z OI i VA (na telefonie ten sam wykres)
const DAY_MAP_30M: Partial<ChartSettings> = {
  ...LAYERS_OFF,
  interval: '30m',
  view: 'candles',
  showTpo: true,
  showTpoOi: true,
  showVwap: true,
  showVwapBands: true,
  showLevels: true,
  showDelta: false,
  showCvd: false,
  indicators: inds(['cone']),
};

// Pod wykresem najwyżej 3 panele: Aukcja — CVD, Zmiana OI i delta, Szerokość agresji; Absorpcja — Absorpcja, Delta
// według klasy makera i OFI (bez CVD)
const AUCTION_SETS: readonly PanelSet[] = [
  { id: 'auction', name: tr('Aukcja', 'Auction'), indicators: inds(['oiflow'], ['breadth']) },
  { id: 'absorption', name: tr('Absorpcja', 'Absorption'), indicators: inds(['absorption'], ['makers'], ['ofi']), patch: { showCvd: false } },
];

const BIG_HANDS_INDS = inds(['twap'], ['ordersize'], ['hawkes']);

export const STATIONS: readonly Station[] = [
  {
    id: 'day-map',
    name: tr('Mapa dnia', 'Day map'),
    question: tr('Gdzie dziś leży wartość i gdzie paliwo?', 'Where does value sit today, and where is the fuel?'),
    phase: 'before',
    layout: 2,
    panels: [
      { ...LAYERS_OFF, interval: '4h', view: 'candles', showPeriodProfiles: true, showLevels: true, showVwap: true, showDelta: false, showCvd: false },
      DAY_MAP_30M,
    ],
    phone: { ...DAY_MAP_30M, ...NARROW_PATCH },
  },
  {
    id: 'fuel',
    name: tr('Paliwo i godziny', 'Fuel and hours'),
    question: tr('Kiedy dziś będzie ruch, gdzie leży paliwo i ile kosztuje wejście?', 'When will the market move today, where is the fuel, and what does entry cost?'),
    phase: 'before',
    layout: 1,
    panels: [
      {
        ...LAYERS_OFF,
        interval: '15m',
        view: 'candles',
        showLiq: true,
        showWhales: true,
        showVwap: true,
        showSessions: true,
        showDelta: false,
        showCvd: false,
        indicators: inds(['slippage'], ['regime']),
      },
    ],
    phone: { ...NARROW_PATCH, showWhales: false },
  },
  {
    id: 'cockpit',
    name: tr('Kokpit', 'Cockpit'),
    question: tr('Kto teraz naciska, kto przyjmuje uderzenia i co stoi w kolejce?', 'Who is pushing now, who is absorbing the hits, and what is waiting in the queue?'),
    phase: 'session',
    layout: 1,
    panels: [
      {
        ...LAYERS_OFF,
        interval: '1m',
        view: 'footprint',
        showHeatmap: true,
        showBubbles: true,
        showClashes: true,
        showLots: true,
        showVwap: true,
        showCvd: true,
        showDelta: false,
      },
    ],
    // Na telefonie bez ścian i dużych zleceń w arkuszu — ich podpisy zasłaniają wąski wykres
    phone: { ...NARROW_PATCH, showClashes: false, showLots: false },
  },
  {
    id: 'auction-open',
    name: tr('Aukcja i otwarcie', 'Auction and open'),
    question: tr('Czy aukcja jest w równowadze, czy ją opuszcza, i czy wybicie buduje wartość?', 'Is the auction in balance or leaving it, and is the breakout building value?'),
    phase: 'session',
    layout: 1,
    panels: [
      {
        ...LAYERS_OFF,
        interval: '5m',
        view: 'footprint',
        fpStyle: 'delta',
        showDevPoc: true,
        showIb: true,
        showSessionVwap: true,
        showLevels: true,
        showZones: true,
        showVolume: false,
        showDelta: false,
        showCvd: true,
        cvdReset: 'session',
        indicators: AUCTION_SETS[0].indicators,
      },
    ],
    phone: { ...NARROW_PATCH, showZones: false },
    panelSets: AUCTION_SETS,
  },
  {
    id: 'big-hands',
    name: tr('Wielkie ręce i reszta rynku', 'Big hands and the rest of the market'),
    question: tr('Czy ruch napędza TWAP, samowzbudna kaskada, czy cały rynek?', 'Is the move driven by a TWAP, a self-exciting cascade, or the whole market?'),
    phase: 'session',
    layout: 1,
    // Pod wykresem tylko trzy wskaźniki: Udział TWAP, Wielkość zleceń agresora, Endogeniczność (Hawkes)
    panels: [
      {
        ...LAYERS_OFF,
        interval: '5m',
        view: 'candles',
        showWhales: true,
        showBubbles: true,
        showVwap: true,
        showVolume: false,
        showDelta: false,
        showCvd: false,
        indicators: BIG_HANDS_INDS,
      },
    ],
    // Na telefonie jeden panel wskaźnika: udział TWAP
    phone: { ...NARROW_PATCH, indicators: BIG_HANDS_INDS.filter((x) => x.id === 'twap') },
  },
  {
    id: 'review',
    name: tr('Rozliczenie doby', 'Day review'),
    question: tr('Jaki to był dzień i czy mapa się sprawdziła?', 'What kind of day was it, and did the map hold up?'),
    phase: 'after',
    layout: 1,
    panels: [
      { ...LAYERS_OFF, interval: '30m', view: 'candles', showTpo: true, showIb: true, showLevels: true, showSessions: true, showVwap: true, showDelta: false, showCvd: false },
    ],
    phone: NARROW_PATCH,
  },
];

/** Warstwy na wykresie ceny (układ ma ich najwyżej 5). */
const PRICE_LAYERS = [
  ...new Set<keyof ChartSettings>([
    ...(Object.keys(LAYERS_OFF) as (keyof typeof LAYERS_OFF)[]),
    'showHeatmap',
    'showBubbles',
    'showClashes',
    'showLots',
    'showLiq',
    'showWhales',
    'showZones',
    'showAuctions',
    'showLevels',
    'showSessions',
    'showIb',
    'showTpo',
    'showDevPoc',
  ]),
];

/** Liczba warstw włączonych na wykresie ceny. */
export const priceLayerCount = (s: ChartSettings): number => PRICE_LAYERS.filter((k) => s[k] === true).length;

/** Panele pod wykresem ceny z ustawień (jak PANE_KEYS w controller.ts): wolumen, delta, CVD, panele giełd, Tablica liczb. */
const UNDER_PANES = ['showVolume', 'showDelta', 'showCvd', 'showVenueCvd', 'showVenueOi', 'showStats'] as const;

/** Liczba paneli pod wykresem ceny: panele z ustawień i widoczne wskaźniki we własnym panelu (układ ma ich najwyżej 3). */
export const underPaneCount = (s: ChartSettings): number =>
  UNDER_PANES.filter((k) => s[k]).length + s.indicators.filter((x) => x.visible && indicatorDef(x.id).pane === 'own').length;

/** Interwał panelu spoza wzorca układu (układ większy niż we wzorcu): kolejne panele pokazują wyższe interwały. */
export const PANEL_INTERVALS = ['5m', '15m', '1h', '4h'];
/** Najwięcej paneli układu (2 × 2). */
const MAX_PANELS = 4;

const COCKPIT = STATIONS.find((s) => s.id === 'cockpit')!;

/** Identyfikator układu z nowego albo dawnego id stacji; nieznany — null. */
export function stationIdOf(id: unknown): StationId | null {
  if (typeof id !== 'string') return null;
  if (STATIONS.some((s) => s.id === id)) return id as StationId;
  return Object.hasOwn(LEGACY_STATION, id) ? LEGACY_STATION[id] : null;
}

/** Układ z id (także dawnej stacji); nieznany — Kokpit. */
export const stationById = (id: unknown): Station => STATIONS.find((s) => s.id === stationIdOf(id)) ?? COCKPIT;

/** Klucz zapisu ustawień panelu układu albo karty (`id` — układ lub karta). */
export const stationKey = (id: string, panel: number): string => `hq.charts.v1.${id}${panel > 0 ? `.p${panel}` : ''}`;

const layoutKey = (id: string) => `hq.charts.layout.v1.${id}`;

/** Wszystkie klucze zapisu układu albo karty: ustawienia paneli 0–3 i układ (ostatni). */
export const stationKeys = (id: string): string[] => [...Array.from({ length: MAX_PANELS }, (_, p) => stationKey(id, p)), layoutKey(id)];

/**
 * Wzorzec panelu układu (bez rynku z wykresu). Telefon: pierwszy panel ze zmianami telefonu. Panel spoza wzorca
 * (np. układ 4 w układzie jednego wykresu): wzorzec pierwszego z wyższym interwałem, bez tablicy i taśmy (mniej miejsca).
 */
export function stationPanel(st: Pick<Station, 'panels' | 'phone'>, panel: number, narrow: boolean): ChartSettings {
  const p = st.panels[panel];
  if (!p) return { ...DEFAULT_SETTINGS, ...st.panels[0], interval: PANEL_INTERVALS[panel] ?? '1h', showStats: false, showTape: false };
  return { ...DEFAULT_SETTINGS, ...p, ...(narrow && panel === 0 ? st.phone : {}) };
}

/**
 * Wzorzec panelu układu z włączonym zestawem paneli `setId`: wskaźniki zestawu i jego zmiany na wzorcu pierwszego
 * panelu. Nieznany zestaw albo inny panel — sam wzorzec.
 */
export function panelSetPanel(st: Station, setId: string, panel: number, narrow: boolean): ChartSettings {
  const base = stationPanel(st, panel, narrow);
  const set = st.panelSets?.find((x) => x.id === setId);
  return set && panel === 0 ? { ...base, ...set.patch, indicators: set.indicators } : base;
}

// Pamięć przeglądarki bywa niedostępna (prywatne okno, zablokowane dane strony) — układy działają wtedy do końca sesji
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // jak wyżej
  }
}

/** Układ wykresów karty `id` (z wzorcem `st`): zapisany przez użytkownika albo z wzorca. */
export function loadStationLayout(st: Pick<Station, 'id' | 'layout'>, id: string = st.id): ChartLayout {
  const v = read(layoutKey(id));
  return v === null ? st.layout : parseLayout(Number(v));
}

export const saveStationLayout = (id: string, l: ChartLayout): void => write(layoutKey(id), String(l));

/** Usuwa wersję użytkownika układu albo karty (ustawienia paneli i układ) — wraca wzorzec. */
export function clearStation(id: string): void {
  for (const k of stationKeys(id)) write(k, null);
}
