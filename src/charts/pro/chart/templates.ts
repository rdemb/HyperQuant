import { ChartSettings, DEFAULT_SETTINGS, parseSettings } from './settings';

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

const off = {
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

const built = (id: string, name: string, patch: Partial<TemplateSettings>): ChartTemplate => ({
  id,
  name,
  builtIn: true,
  s: { ...templateOf(DEFAULT_SETTINGS), ...patch },
});

export const BUILT_IN_TEMPLATES: readonly ChartTemplate[] = [
  built('orderflow', 'Orderflow (domyślny)', {}),
  built('scalp', 'Skalping 1m: taśma, mapa, strefy', {
    interval: '1m',
    showTape: true,
    showPeriodProfiles: false,
    showSessions: false,
    showIb: false,
  }),
  built('swing', 'Swing 1h: poziomy i profile', {
    ...off,
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
  built('tpo', 'Market Profile 30m: TPO dób', {
    ...off,
    interval: '30m',
    view: 'candles',
    showDelta: false,
    showStats: false,
    showTpo: true,
    showVwap: true,
    showLevels: true,
  }),
  built('clean', 'Czyste świece', { ...off, view: 'candles', showDelta: false, showCvd: false, showStats: false }),
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
