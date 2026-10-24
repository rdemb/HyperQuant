import type { ResetMode } from '../core/sessions';
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
  /** Tabela statystyk świec pod wykresem. */
  showStats: boolean;
  /** Wskaźniki na wykresie ceny. */
  showVwap: boolean;
  showVwapBands: boolean;
  showSessionVwap: boolean;
  showProfile: boolean;
  /** Profile sesji (na 1–4 h dób) z nagimi POC. */
  showPeriodProfiles: boolean;
  /** Profil czasowy (TPO) każdej doby; zastępuje profile sesji. */
  showTpo: boolean;
  showLevels: boolean;
  showSessions: boolean;
  showIb: boolean;
  showLiq: boolean;
  /** Strefy nierównowagi i niedokończone aukcje z footprintu. */
  showZones: boolean;
  showAuctions: boolean;
  /** Warstwy na żywo: mapa ciepła arkusza i bąble zleceń agresora. */
  showHeatmap: boolean;
  showBubbles: boolean;
  /** Serie małych zleceń i ściany makerów (z adresów w transakcjach). */
  showClashes: boolean;
  /** Próg dużego zlecenia (USD); 0 = automatycznie z rynku. */
  bigTradeUsd: number;
  /** Panel taśmy zleceń (Time & Sales), jego filtr (USD) i dźwięk dużych zleceń. */
  showTape: boolean;
  tapeMinUsd: number;
  tapeSound: boolean;
}

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
  showStats: true,
  showVwap: true,
  showVwapBands: true,
  showSessionVwap: true,
  showProfile: true,
  showPeriodProfiles: true,
  showTpo: false,
  showLevels: true,
  showSessions: true,
  showIb: true,
  showLiq: true,
  showZones: true,
  showAuctions: true,
  showHeatmap: true,
  showBubbles: true,
  showClashes: true,
  bigTradeUsd: 0,
  showTape: false,
  tapeMinUsd: 10_000,
  tapeSound: false,
};

const KEY = 'hq.charts.v1';

const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const numIn = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

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
    showStats: bool(r.showStats, d.showStats),
    showVwap: bool(r.showVwap, d.showVwap),
    showVwapBands: bool(r.showVwapBands, d.showVwapBands),
    showSessionVwap: bool(r.showSessionVwap, d.showSessionVwap),
    showProfile: bool(r.showProfile, d.showProfile),
    showPeriodProfiles: bool(r.showPeriodProfiles, d.showPeriodProfiles),
    showTpo: bool(r.showTpo, d.showTpo),
    showLevels: bool(r.showLevels, d.showLevels),
    showSessions: bool(r.showSessions, d.showSessions),
    showIb: bool(r.showIb, d.showIb),
    showLiq: bool(r.showLiq, d.showLiq),
    showZones: bool(r.showZones, d.showZones),
    showAuctions: bool(r.showAuctions, d.showAuctions),
    showHeatmap: bool(r.showHeatmap, d.showHeatmap),
    showBubbles: bool(r.showBubbles, d.showBubbles),
    showClashes: bool(r.showClashes, d.showClashes),
    bigTradeUsd: numIn(r.bigTradeUsd, 0, 100_000_000, d.bigTradeUsd),
    showTape: bool(r.showTape, d.showTape),
    tapeMinUsd: numIn(r.tapeMinUsd, 0, 100_000_000, d.tapeMinUsd),
    tapeSound: bool(r.tapeSound, d.tapeSound),
  };
}

/** Na wąskim ekranie tabela statystyk domyślnie wyłączona — zabrałaby większość wysokości wykresu. */
function defaults(): ChartSettings {
  const narrow = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches;
  return narrow ? { ...DEFAULT_SETTINGS, showStats: false } : DEFAULT_SETTINGS;
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
export function loadSettings(key = KEY, fallback: ChartSettings = defaults()): ChartSettings {
  try {
    const s = localStorage.getItem(key);
    return parseSettings(s ? JSON.parse(s) : null, fallback);
  } catch {
    return fallback;
  }
}

export function saveSettings(s: ChartSettings, key = KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    // Prywatne okno albo zablokowana pamięć — ustawienia działają do końca sesji
  }
}

// ───────────────────────── układ ─────────────────────────

/** Liczba wykresów obok siebie: 1, 2 (obok siebie) albo 4 (2 × 2). */
export type ChartLayout = 1 | 2 | 4;

const LAYOUT_KEY = 'hq.charts.layout.v1';

export const parseLayout = (v: unknown): ChartLayout => (v === 2 || v === 4 ? v : 1);

export function loadLayout(): ChartLayout {
  try {
    return parseLayout(Number(localStorage.getItem(LAYOUT_KEY)));
  } catch {
    return 1;
  }
}

export function saveLayout(l: ChartLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, String(l));
  } catch {
    // Prywatne okno albo zablokowana pamięć — układ działa do końca sesji
  }
}
