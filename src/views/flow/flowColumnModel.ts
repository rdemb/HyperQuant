import { LAYOUT_ORDER, type PhaseId, type StationId, stationById } from '../../charts/pro/chart/stations';
import { tr } from '../../i18n';

/**
 * Czyste pomocniki prawej kolumny DOM i taśmy (W sesji) i skrótów układów: zakres paneli skanera, szerokość, od
 * której kolumna jest przypięta obok wykresu, jej zapis i preferencje taśmy i drabiny (`hq.flow.v1`).
 */

/**
 * Panele ze skanera kont (Kto przyjmuje uderzenia, TWAP-y w drodze) są tylko dla BTC; drabina i taśma działają na
 * rynku wykresu.
 */
export function scannerScope(coin: string): 'full' | 'btc-only' {
  return coin === 'BTC' ? 'full' : 'btc-only';
}

/** Komunikat paneli skanera na innym rynku niż BTC i jego wyjaśnienie (podpowiedź). */
export const BTC_ONLY = tr('—, tylko BTC', '—, BTC only');
export const BTC_ONLY_TITLE = tr(
  'Konta makerów i plany TWAP z publicznego dziennika Hyperliquid liczymy tylko dla BTC. Drabina i taśma pokazują rynek wykresu.',
  'Maker accounts and TWAP plans from the public Hyperliquid log are computed for BTC only. The ladder and the tape show the chart’s market.'
);

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

/** Alt+1…6: faza i układ w kolejności przed sesją, w sesji, po sesji; inna cyfra — null. */
export function shortcutTarget(digit: number): { phase: PhaseId; layout: StationId } | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > LAYOUT_ORDER.length) return null;
  const layout = LAYOUT_ORDER[digit - 1];
  return { phase: stationById(layout).phase, layout };
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
