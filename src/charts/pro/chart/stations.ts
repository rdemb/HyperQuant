import { ChartLayout, ChartSettings, DEFAULT_SETTINGS, NARROW_PATCH, panelKey, parseLayout } from './settings';
import { LAYERS_OFF } from './templates';

/**
 * Stacje robocze: gotowy układ wykresów pod jedno pytanie tradera (co się dzieje, kto naciska, gdzie stoi płynność,
 * gdzie rynek widzi wartość, czy zgadzają się inne giełdy, co mówi wyższy interwał). Każda stacja ma własny zapis
 * ustawień paneli i układu, więc zmiany w stacji zostają jako wersja użytkownika, a „Przywróć” wraca do wzorca.
 * Start używa kluczy zapisu sprzed stacji — wcześniejsze ustawienia zostają jego wersją.
 */

export type StationId = 'start' | 'scalp' | 'liquidity' | 'auction' | 'venues' | 'mtf';

export interface Station {
  id: StationId;
  name: string;
  /** Pytanie stacji i jej zawartość (podpowiedź przycisku). */
  question: string;
  /** Układ na szerokim ekranie. */
  layout: ChartLayout;
  /** Wzorzec kolejnych paneli układu na komputerze: zmiany względem ustawień startowych. */
  panels: readonly Partial<ChartSettings>[];
  /** Zmiany pierwszego panelu na telefonie (tam zawsze jeden wykres). */
  phone: Partial<ChartSettings>;
}

export const STATIONS: readonly Station[] = [
  {
    id: 'start',
    name: 'Start',
    question: 'Co się dzieje? Footprint z VWAP, profilem i poziomami dnia, wolumen, delta i CVD',
    layout: 1,
    panels: [{}],
    phone: NARROW_PATCH,
  },
  {
    id: 'scalp',
    name: 'Skalper',
    question: 'Kto teraz naciska? Footprint 1m z mapą ciepła i DOM, bąble, ściany, duże zlecenia w arkuszu, strefy i taśma zleceń',
    layout: 1,
    panels: [
      { ...LAYERS_OFF, interval: '1m', view: 'footprint', showVwap: true, showHeatmap: true, showBubbles: true, showClashes: true, showLots: true, showZones: true, showTape: true },
    ],
    phone: { ...NARROW_PATCH, showClashes: false, showLots: false, showZones: false },
  },
  {
    id: 'liquidity',
    name: 'Płynność',
    question: 'Gdzie stoją zlecenia i pozycje? Mapa ciepła, bąble, ściany, duże zlecenia w arkuszu, wieloryby i klastry likwidacji',
    layout: 1,
    panels: [
      {
        ...LAYERS_OFF,
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
    // Na telefonie bez ścian i dużych zleceń w arkuszu — ich podpisy zasłaniają wąski wykres
    phone: { ...NARROW_PATCH, showClashes: false, showLots: false },
  },
  {
    id: 'auction',
    name: 'Aukcja',
    question: 'Gdzie rynek widzi wartość? 30m z TPO i VWAP ±σ obok 4h z profilami sesji i IB',
    layout: 2,
    panels: [
      { ...LAYERS_OFF, interval: '30m', view: 'candles', showDelta: false, showCvd: false, showTpo: true, showVwap: true, showVwapBands: true, showLevels: true },
      { ...LAYERS_OFF, interval: '4h', view: 'candles', showDelta: false, showCvd: false, showVwap: true, showPeriodProfiles: true, showLevels: true, showIb: true },
    ],
    phone: NARROW_PATCH,
  },
  {
    id: 'venues',
    name: 'Giełdy',
    question: 'Czy reszta rynku się zgadza? CVD Hyperliquid, Binance i Bybit oraz Tablica liczb (dane Binance i Bybit pobiera Twoja przeglądarka)',
    layout: 1,
    panels: [
      {
        ...LAYERS_OFF,
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
    // Na telefonie liczby są w karcie „Liczby”
    phone: { ...NARROW_PATCH, showStats: false },
  },
  {
    id: 'mtf',
    name: 'Dwa interwały',
    question: 'Co mówi wyższy interwał? 5m footprint z mapą ciepła obok 1h ze świecami i profilami sesji',
    layout: 2,
    panels: [
      { ...LAYERS_OFF, interval: '5m', view: 'footprint', showVwap: true, showProfile: true, showHeatmap: true, showBubbles: true },
      { ...LAYERS_OFF, interval: '1h', view: 'candles', showDelta: false, showVwap: true, showPeriodProfiles: true, showLevels: true },
    ],
    phone: NARROW_PATCH,
  },
];

/** Interwał panelu spoza wzorca stacji (układ większy niż we wzorcu): kolejne panele pokazują wyższe interwały. */
export const PANEL_INTERVALS = ['5m', '15m', '1h', '4h'];
/** Najwięcej paneli układu (2 × 2). */
const MAX_PANELS = 4;

export const stationById = (id: unknown): Station => STATIONS.find((s) => s.id === id) ?? STATIONS[0];

/** Klucz zapisu ustawień panelu stacji (Start — klucze sprzed stacji). */
export const stationKey = (id: StationId, panel: number): string => (id === 'start' ? panelKey(panel) : `hq.charts.v1.${id}${panel > 0 ? `.p${panel}` : ''}`);

const layoutKey = (id: StationId) => (id === 'start' ? 'hq.charts.layout.v1' : `hq.charts.layout.v1.${id}`);
const ACTIVE_KEY = 'hq.charts.station.v1';

/**
 * Wzorzec panelu stacji (bez rynku z wykresu). Telefon: pierwszy panel ze zmianami telefonu. Panel spoza wzorca
 * (np. układ 4 w stacji jednego wykresu): wzorzec pierwszego z wyższym interwałem, bez tablicy i taśmy (mniej miejsca).
 */
export function stationPanel(st: Station, panel: number, narrow: boolean): ChartSettings {
  const p = st.panels[panel];
  if (!p) return { ...DEFAULT_SETTINGS, ...st.panels[0], interval: PANEL_INTERVALS[panel] ?? '1h', showStats: false, showTape: false };
  return { ...DEFAULT_SETTINGS, ...p, ...(narrow && panel === 0 ? st.phone : {}) };
}

// Pamięć przeglądarki bywa niedostępna (prywatne okno, zablokowane dane strony) — stacje działają wtedy do końca sesji
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

export const loadStation = (): Station => stationById(read(ACTIVE_KEY));
export const saveStation = (id: StationId): void => write(ACTIVE_KEY, id);

/** Układ stacji: zapisany przez użytkownika albo z wzorca. */
export function loadStationLayout(st: Station): ChartLayout {
  const v = read(layoutKey(st.id));
  return v === null ? st.layout : parseLayout(Number(v));
}

export const saveStationLayout = (id: StationId, l: ChartLayout): void => write(layoutKey(id), String(l));

/** Usuwa wersję użytkownika stacji (ustawienia paneli i układ) — stacja wraca do wzorca. */
export function clearStation(id: StationId): void {
  for (let p = 0; p < MAX_PANELS; p++) write(stationKey(id, p), null);
  write(layoutKey(id), null);
}
