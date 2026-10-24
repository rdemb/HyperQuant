import type { ResetMode } from '../core/sessions';
import { STAT_GROUPS, type StatGroup } from '../core/stats';
import { DEFAULT_INTERVAL, INTERVALS } from '../core/time';
import { COIN, MARKETS, Market } from '../store/proStore';
import type { ChartView } from './footprintSeries';
import type { FootprintStyle } from './layout';

/** Ustawienia wykresu Pro zapamiętywane w przeglądarce (tylko wygoda użytkownika — brak danych osobowych). */
export interface ChartSettings {
  /** Rynek perp Hyperliquid. */
  coin: Market;
  interval: string;
  view: ChartView;
  fpStyle: FootprintStyle;
  /** Wysokość wiersza footprintu (USD); 0 = automatycznie. */
  rowStep: number;
  imbalanceRatio: number;
  /** Najmniejsza wartość strony przewagi w wierszu nierównowagi (USD; przeliczana na jednostki rynku po cenie). */
  imbalanceMinUsd: number;
  stackedMin: number;
  showVolume: boolean;
  showDelta: boolean;
  showCvd: boolean;
  cvdReset: ResetMode;
  /**
   * Panele giełd: CVD Hyperliquid, Binance (perp i spot) i Bybit oraz zmiana OI z finansowaniem. Dane CEX pobiera
   * przeglądarka czytelnika, domyślnie wyłączone (regulaminy giełd).
   */
  showVenueCvd: boolean;
  showVenueOi: boolean;
  /** Tablica liczb pod wykresem i jej grupy wierszy (Binance i Bybit — połączenia przeglądarki czytelnika). */
  showStats: boolean;
  statGroups: StatGroup[];
  /** Wskaźniki na wykresie ceny. */
  showVwap: boolean;
  showVwapBands: boolean;
  showSessionVwap: boolean;
  showProfile: boolean;
  /** Profile sesji (na 1–4 h dób) z nagimi POC. */
  showPeriodProfiles: boolean;
  /** Rozwijający się POC i value area sesji (na 1–4 h doby), świeca po świecy. */
  showDevPoc: boolean;
  /** Profil czasowy (TPO) każdej doby; zastępuje profile sesji. */
  showTpo: boolean;
  showLevels: boolean;
  showSessions: boolean;
  showIb: boolean;
  showLiq: boolean;
  /** Pozycje i duże zlecenia oczekujące największych kont (plik skanera, bez adresów). */
  showWhales: boolean;
  /** Strefy nierównowagi i niedokończone aukcje z footprintu. */
  showZones: boolean;
  showAuctions: boolean;
  /** Warstwy na żywo: mapa ciepła arkusza i bąble zleceń agresora. */
  showHeatmap: boolean;
  showBubbles: boolean;
  /** Serie małych zleceń i ściany makerów (z adresów w transakcjach). */
  showClashes: boolean;
  /** Duże zlecenia oczekujące w arkuszu (średnie zlecenie poziomu od progu). */
  showLots: boolean;
  /** Próg dużego zlecenia (USD); 0 = automatycznie z rynku. */
  bigTradeUsd: number;
  /** Panel taśmy zleceń (Time & Sales), jego filtr (USD) i dźwięk dużych zleceń. */
  showTape: boolean;
  tapeMinUsd: number;
  tapeSound: boolean;
}

/**
 * Ustawienia startowe: świece mają być czytelne od pierwszej sekundy, więc na wykresie ceny tylko lekkie warstwy
 * (VWAP dnia, profil widocznego zakresu, poziomy dnia, otwarcia sesji). Mapa ciepła, bąble, wieloryby, ściany, duże
 * zlecenia w arkuszu, strefy, IB i profile sesji włącza się w „Wskaźnikach” albo szablonem „Pełny orderflow”
 * (z historią ostatniej doby bąble i mapa ciepła zakrywają świece całego widoku).
 */
export const DEFAULT_SETTINGS: ChartSettings = {
  coin: COIN,
  interval: DEFAULT_INTERVAL,
  view: 'footprint',
  fpStyle: 'bidask',
  rowStep: 0,
  imbalanceRatio: 3,
  imbalanceMinUsd: 2500,
  stackedMin: 3,
  showVolume: true,
  showDelta: true,
  showCvd: true,
  cvdReset: 'session',
  showVenueCvd: false,
  showVenueOi: false,
  showStats: false,
  statGroups: ['hl', 'tape'],
  showVwap: true,
  showVwapBands: false,
  showSessionVwap: false,
  showProfile: true,
  showPeriodProfiles: false,
  showDevPoc: false,
  showTpo: false,
  showLevels: true,
  showSessions: true,
  showIb: false,
  showLiq: false,
  showWhales: false,
  showZones: false,
  showAuctions: false,
  showHeatmap: false,
  showBubbles: false,
  showClashes: false,
  showLots: false,
  bigTradeUsd: 0,
  showTape: false,
  tapeMinUsd: 10_000,
  tapeSound: false,
};

/**
 * Telefon (do 639 px): kilkadziesiąt świec na wąskim ekranie, więc tylko świece z VWAP, wolumen i CVD — bez panelu
 * delty, profilu, poziomów dnia i otwarć sesji.
 */
export const NARROW_PATCH = {
  showDelta: false,
  showProfile: false,
  showLevels: false,
  showSessions: false,
} satisfies Partial<ChartSettings>;

/** Panele pod wykresem ceny na telefonie w kolejności pierwszeństwa: widać najwyżej jeden, pierwszy włączony. */
export const PHONE_PANES = ['showCvd', 'showDelta', 'showVenueCvd', 'showVenueOi'] as const;
export type PhonePane = (typeof PHONE_PANES)[number];

/**
 * Ustawienia w użyciu na telefonie, niezależnie od zapisu: wykres ceny ma co najmniej 60% wysokości, więc pod nim
 * najwyżej jeden panel (pierwszy włączony z PHONE_PANES), bez Tablicy liczb (jest karta „Liczby”). Wolumen rysuje się
 * na dole wykresu ceny. Zapis zostaje bez zmian — na szerszym ekranie wracają wszystkie panele.
 */
export function phoneSettings(s: ChartSettings): ChartSettings {
  const keep = PHONE_PANES.find((k) => s[k]) ?? null;
  return { ...s, showStats: false, showCvd: keep === 'showCvd', showDelta: keep === 'showDelta', showVenueCvd: keep === 'showVenueCvd', showVenueOi: keep === 'showVenueOi' };
}

const KEY = 'hq.charts.v1';

const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const numIn = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
/** Grupy Tablicy liczb w stałej kolejności, bez powtórzeń; pusta lub błędna lista → `fallback`. */
const groups = (v: unknown, fallback: StatGroup[]): StatGroup[] => {
  const g = Array.isArray(v) ? STAT_GROUPS.filter((x) => v.includes(x)) : [];
  return g.length > 0 ? g : fallback;
};

/** Odczyt z walidacją każdego pola (stary lub uszkodzony zapis → wartości domyślne `d`). */
export function parseSettings(raw: unknown, d: ChartSettings = DEFAULT_SETTINGS): ChartSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    coin: oneOf(r.coin, MARKETS, d.coin),
    interval: oneOf(r.interval, INTERVALS.map((i) => i.id), d.interval),
    view: oneOf(r.view, ['candles', 'footprint'] as const, d.view),
    fpStyle: oneOf(r.fpStyle, ['bidask', 'delta', 'volume'] as const, d.fpStyle),
    rowStep: numIn(r.rowStep, 0, 10_000, d.rowStep),
    imbalanceRatio: numIn(r.imbalanceRatio, 1.1, 10, d.imbalanceRatio),
    imbalanceMinUsd: numIn(r.imbalanceMinUsd, 0, 10_000_000, d.imbalanceMinUsd),
    stackedMin: numIn(r.stackedMin, 0, 10, d.stackedMin),
    showVolume: bool(r.showVolume, d.showVolume),
    showDelta: bool(r.showDelta, d.showDelta),
    showCvd: bool(r.showCvd, d.showCvd),
    cvdReset: oneOf(r.cvdReset, ['none', 'session', 'day', 'week'] as const, d.cvdReset),
    showVenueCvd: bool(r.showVenueCvd, d.showVenueCvd),
    showVenueOi: bool(r.showVenueOi, d.showVenueOi),
    showStats: bool(r.showStats, d.showStats),
    statGroups: groups(r.statGroups, d.statGroups),
    showVwap: bool(r.showVwap, d.showVwap),
    showVwapBands: bool(r.showVwapBands, d.showVwapBands),
    showSessionVwap: bool(r.showSessionVwap, d.showSessionVwap),
    showProfile: bool(r.showProfile, d.showProfile),
    showPeriodProfiles: bool(r.showPeriodProfiles, d.showPeriodProfiles),
    showDevPoc: bool(r.showDevPoc, d.showDevPoc),
    showTpo: bool(r.showTpo, d.showTpo),
    showLevels: bool(r.showLevels, d.showLevels),
    showSessions: bool(r.showSessions, d.showSessions),
    showIb: bool(r.showIb, d.showIb),
    showLiq: bool(r.showLiq, d.showLiq),
    showWhales: bool(r.showWhales, d.showWhales),
    showZones: bool(r.showZones, d.showZones),
    showAuctions: bool(r.showAuctions, d.showAuctions),
    showHeatmap: bool(r.showHeatmap, d.showHeatmap),
    showBubbles: bool(r.showBubbles, d.showBubbles),
    showClashes: bool(r.showClashes, d.showClashes),
    showLots: bool(r.showLots, d.showLots),
    bigTradeUsd: numIn(r.bigTradeUsd, 0, 100_000_000, d.bigTradeUsd),
    showTape: bool(r.showTape, d.showTape),
    tapeMinUsd: numIn(r.tapeMinUsd, 0, 100_000_000, d.tapeMinUsd),
    tapeSound: bool(r.tapeSound, d.tapeSound),
  };
}

/** Telefon: ekran do 639 px. */
export const NARROW_QUERY = '(max-width: 639px)';
export const isNarrow = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;

/** Ustawienia startowe dla tego ekranu (na telefonie z `NARROW_PATCH`). */
export function startSettings(): ChartSettings {
  return isNarrow() ? { ...DEFAULT_SETTINGS, ...NARROW_PATCH } : DEFAULT_SETTINGS;
}

/**
 * Wersja zestawu warstw startowych. W wersji 2 część warstw przestała być włączona na starcie (na telefonie także
 * profil); zapis sprzed tej zmiany ma je zwykle włączone tylko dlatego, że takie były wartości
 * startowe, więc wracają do nowych wartości. Warstwy, których wartość startowa się nie zmieniła, i reszta ustawień
 * zostają z zapisu.
 */
const LAYERS_V = 2;
const RESET_IN_V2 = [
  'showStats',
  'showDelta',
  'showVwapBands',
  'showSessionVwap',
  'showProfile',
  'showPeriodProfiles',
  'showLevels',
  'showSessions',
  'showIb',
  'showLiq',
  'showWhales',
  'showZones',
  'showAuctions',
  'showHeatmap',
  'showBubbles',
  'showClashes',
  'showLots',
] as const;

/** Zapis ustawień sprzed wersji `LAYERS_V` bez pól warstw, których wartość startowa się zmieniła. */
export function migrateSaved(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || (raw as { layersV?: unknown }).layersV === LAYERS_V) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  for (const k of RESET_IN_V2) delete r[k];
  return r;
}

/** Link do widoku: #charts?m=ETH&i=5m&v=footprint (rynek, interwał, rodzaj wykresu). */
export function hashFor(s: ChartSettings): string {
  return `#charts?m=${s.coin}&i=${s.interval}&v=${s.view}`;
}

/** Ustawienia z linku do widoku; pola spoza listy dozwolonych wartości są pomijane. */
export function settingsFromHash(hash: string): Partial<ChartSettings> {
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const out: Partial<ChartSettings> = {};
  const m = q.get('m');
  const i = q.get('i');
  const v = q.get('v');
  if (m && (MARKETS as readonly string[]).includes(m)) out.coin = m as Market;
  if (i && INTERVALS.some((x) => x.id === i)) out.interval = i;
  if (v === 'candles' || v === 'footprint') out.view = v;
  return out;
}

/** Klucz zapisu panelu układu: pierwszy panel ma klucz sprzed układów, więc zapisane ustawienia zostają. */
export const panelKey = (panel: number) => (panel === 0 ? KEY : `${KEY}.p${panel}`);

/** Ustawienia panelu; bez zapisu — `fallback` (domyślnie wartości startowe). */
export function loadSettings(key = KEY, fallback: ChartSettings = startSettings()): ChartSettings {
  try {
    const s = localStorage.getItem(key);
    return parseSettings(s ? migrateSaved(JSON.parse(s)) : null, fallback);
  } catch {
    return fallback;
  }
}

export function saveSettings(s: ChartSettings, key = KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...s, layersV: LAYERS_V }));
  } catch {
    // Prywatne okno albo zablokowana pamięć — ustawienia działają do końca sesji
  }
}

// ───────────────────────── układ ─────────────────────────

/** Liczba wykresów obok siebie: 1, 2 (obok siebie) albo 4 (2 × 2). */
export type ChartLayout = 1 | 2 | 4;

export const parseLayout = (v: unknown): ChartLayout => (v === 2 || v === 4 ? v : 1);
