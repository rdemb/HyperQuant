import type { PhaseId } from '../../charts/pro/chart/stations';
import { tr } from '../../i18n';
import { takeFlowAsk } from '../../state/route';
import { capsOf, chartMarkets } from '../../state/markets';
import { NO_SCANNER_BADGE } from '../../utils/marketCaps';

/**
 * Pomocniki prawej kolumny DOM i taśmy (W sesji): zakres paneli skanera, szerokość, od której kolumna jest przypięta obok
 * wykresu, jej zapis (`hq.charts.dock.v1`) i odpowiedź na dawny adres #flow, preferencje taśmy i drabiny (`hq.flow.v1`).
 * Zapis i adres czytają `loadDock` i `columnAfterHash`; reszta to czyste funkcje.
 */

/**
 * Panele ze skanera kont (Kto przyjmuje uderzenia, TWAP-y w drodze, kohorty, taśma likwidacji) są dla rynków z pełnym
 * skanerem w rejestrze (`marketCaps`); drabina i taśma działają na rynku wykresu.
 */
export function scannerScope(coin: string): 'full' | 'none' {
  return capsOf(coin).scanner ? 'full' : 'none';
}

/** Komunikat paneli skanera na rynku bez skanera i jego wyjaśnienie (podpowiedź). */
export const NO_SCANNER = NO_SCANNER_BADGE;
export function noScannerTitle(): string {
  const list = chartMarkets()
    .filter((m) => m.scanner === 'full')
    .map((m) => m.coin)
    .join(', ');
  return tr(
    `Konta makerów, plany TWAP, kohorty i likwidacje z publicznego dziennika Hyperliquid liczymy dla rynków z pełnym skanerem (dziś ${list || '—'}). Drabina i taśma pokazują rynek wykresu.`,
    `Maker accounts, TWAP plans, cohorts and liquidations from the public Hyperliquid log are computed for markets with the full scanner (today ${list || '—'}). The ladder and the tape show the chart’s market.`
  );
}

/** Szerokość kolumny obok wykresu (px). */
export const DOCK_W = 400;
/** Od tej szerokości okna (px) kolumna mieści się obok wykresu. */
export const DOCK_MIN_W = 1280;
/** Od tej szerokości okna (px) do `DOCK_MIN_W` kolumna jest szufladą nad wykresem; węższy ekran to telefon (pasek Pulse). */
export const DRAWER_MIN_W = 640;

/** Kolumna DOM i taśmy przy szerokości okna: przypięta obok wykresu, szuflada nad wykresem albo brak (telefon). */
export function dockMode(widthPx: number): 'docked' | 'drawer' | 'none' {
  return widthPx >= DOCK_MIN_W ? 'docked' : widthPx >= DRAWER_MIN_W ? 'drawer' : 'none';
}

/** Zapis: kolumna przypięta widoczna („1”) albo schowana klawiszem D („0”). Szuflada nie ma zapisu (zawsze zamknięta na start). */
export const DOCK_KEY = 'hq.charts.dock.v1';

/** Kolumna widoczna, chyba że użytkownik ją schował. */
export const parseDock = (raw: string | null): boolean => raw !== '0';

export function loadDock(): boolean {
  try {
    return parseDock(localStorage.getItem(DOCK_KEY));
  } catch {
    return true;
  }
}

export function saveDock(on: boolean): void {
  try {
    localStorage.setItem(DOCK_KEY, on ? '1' : '0');
  } catch {
    // Zapis niedostępny (tryb prywatny) — stan kolumny zostaje do zamknięcia strony
  }
}

/**
 * Kolumna po zmianie adresu w otwartym już widoku: tylko gdy adres był dawnym #flow (jednorazowa prośba z `followHash`,
 * odbierana wyłącznie przez Wykresy W sesji) — zapis kolumny czytany ponownie (#flow zapisuje „1”, także gdy kolumnę
 * schowano klawiszem D) i szuflada (640–1279 px) otwarta. Inna zmiana adresu albo inna faza — null (bez zmian).
 */
export function columnAfterHash(phase: PhaseId): { dock: boolean; drawer: true } | null {
  if (phase !== 'session' || !takeFlowAsk()) return null;
  return { dock: loadDock(), drawer: true };
}

// ───────────────────────── preferencje taśmy i drabiny ─────────────────────────

export type StepId = 'exact' | 'near' | 'far';

export interface FlowPrefs {
  /** Najmniejsza wartość zlecenia na taśmie (USD). */
  minUsd: number;
  /** Dźwięk dużych zleceń. */
  sound: boolean;
  /** Agregacja drabiny. */
  step: StepId;
}

export const FLOW_PREFS_KEY = 'hq.flow.v1';
export const DEFAULT_FLOW_PREFS: FlowPrefs = { minUsd: 10_000, sound: false, step: 'near' };

/** Odczyt z walidacją każdego pola (błędne → wartość domyślna). */
export function parseFlowPrefs(raw: unknown): FlowPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof FlowPrefs, unknown>>;
  return {
    minUsd: typeof r.minUsd === 'number' && r.minUsd >= 0 ? r.minUsd : DEFAULT_FLOW_PREFS.minUsd,
    sound: typeof r.sound === 'boolean' ? r.sound : DEFAULT_FLOW_PREFS.sound,
    step: r.step === 'exact' || r.step === 'near' || r.step === 'far' ? r.step : DEFAULT_FLOW_PREFS.step,
  };
}
