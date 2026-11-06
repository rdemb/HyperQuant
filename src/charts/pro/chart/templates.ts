import { ChartSettings, parseSettings } from './settings';
import { INDICATOR_COLORS, IndicatorId, IndicatorInstance, Params, defaultWidth, indicatorDef, parseParams } from '../indicators/registry';

/**
 * Szablony wykresu: własne zestawy ustawień użytkownika (interwał, rodzaj wykresu, panele, wskaźniki, warstwy) do
 * nałożenia jednym kliknięciem. Rynek i wysokość wiersza zostają z wykresu — zależą od ceny rynku, nie od szablonu.
 * Gotowe wzorce to układy faz dnia (stations.ts); wbudowanych szablonów i zestawów kart MTF już nie ma.
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

/** Wszystkie warstwy na wykresie ceny wyłączone (podstawa układów, które włączają tylko swoje). */
export const LAYERS_OFF = {
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

/** Wskaźnik wzorca: id z rejestru, zmienione parametry i pola instancji (np. `{ tf: '1h' }`, `{ visible: false }`). */
export type IndSpec = [IndicatorId, Partial<Record<string, number>>?, Partial<IndicatorInstance>?];

/** Lista wskaźników wzorca: identyfikatory jak przy dodawaniu z menu (ema1, sma2), kolejne kolory z palety wskaźników. */
export const inds = (...specs: IndSpec[]): IndicatorInstance[] => {
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
