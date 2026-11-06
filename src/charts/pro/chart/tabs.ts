import { ChartLayout, ChartSettings, DEFAULT_SETTINGS, NARROW_PATCH, isNarrow, loadSettings, migrateSaved, panelKey, parseSettings, settingsJson } from './settings';
import { PHASE_LAYOUTS, PhaseId, STATIONS, Station, StationId, loadStationLayout, stationById, stationKey, stationKeys, stationPanel } from './stations';
import { LEGACY_ACTIVE_KEY, LEGACY_NARROW, LEGACY_START_KEYS, LEGACY_STATIONS, LEGACY_TEMPLATES, LEGACY_TEMPLATE_PHONE, LegacyStation } from './legacyPresets';
import { INTERVALS } from '../core/time';
import { tr } from '../../../i18n';

/**
 * Karty Wykresów: sześć kart układów faz dnia (id karty = id układu, zawsze na początku paska) i karty własne
 * użytkownika („Moje karty”, do MAX_TABS). Każda karta to własny układ wykresów z ustawieniami każdego panelu,
 * zapisany pod identyfikatorem karty. Wzorzec karty (układ) służy do „Przywróć”; karta własna (`own`) nie ma wzorca.
 * Karty sprzed układów faz (stacje robocze, wbudowane szablony, zestawy MTF) przechodzą raz przez `migrateTabsV2`.
 */

/** Wzorzec karty: układ faz albo `own` (karta własna bez wzorca, np. dawna stacja lub szablon). */
export type TabPreset = StationId | 'own';

export interface ChartTab {
  /** Identyfikator zapisu ustawień: karta układu — id układu, nowe karty — `k…`. */
  id: string;
  preset: TabPreset;
  /** Własna nazwa; null — nazwa wzorca. */
  name: string | null;
}

export interface TabsState {
  tabs: ChartTab[];
  active: string;
}

const KEY = 'hq.charts.tabs.v1';
/** Najwięcej kart własnych (karty układów są zawsze i nie liczą się do limitu; każda karta ma do 4 paneli w pamięci). */
export const MAX_TABS = 20;
const NAME_MAX = 32;
/** Identyfikator karty trafia do kluczy zapisu — małe litery, cyfry i łącznik (id układów: `day-map`). */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
/** Karta aktywna na start: Kokpit (domyślny układ w sesji). */
const DEFAULT_ACTIVE: StationId = 'cockpit';

const LAYOUT_IDS: ReadonlySet<string> = new Set(STATIONS.map((s) => s.id));

const isPreset = (v: unknown): v is TabPreset => v === 'own' || (typeof v === 'string' && LAYOUT_IDS.has(v));

const isInterval = (v: unknown): v is string => INTERVALS.some((i) => i.id === v);

const cleanName = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, NAME_MAX) : null);

/** Karta układu faz (stała, zawsze na pasku): id równe id układu. */
export const isLayoutTab = (t: ChartTab): boolean => LAYOUT_IDS.has(t.id);

const ownCount = (st: TabsState) => st.tabs.filter((t) => !isLayoutTab(t)).length;

/** Limit kart własnych osiągnięty. */
export const tabsFull = (st: TabsState): boolean => ownCount(st) >= MAX_TABS;

/** Kartę można zamknąć: nie jest kartą układu i nie jest ostatnia. */
export const canClose = (st: TabsState, t: ChartTab): boolean => !isLayoutTab(t) && st.tabs.length > 1;

/** Karta ma wzorzec do „Przywróć” (karta własna — nie). */
export const canRestore = (t: ChartTab): boolean => t.preset !== 'own';

/**
 * Wzorzec karty własnej: jeden wykres z ustawieniami startowymi (jak pusta karta). Karta zapisuje się pod swoim id,
 * więc `id` wzorca nie ma znaczenia; bez „Przywróć”.
 */
const OWN: Station = {
  id: DEFAULT_ACTIVE,
  name: tr('Moja karta', 'My tab'),
  question: tr('Karta własna: Twoje wykresy, bez wzorca do przywrócenia.', 'Your own tab: your charts, with no preset to restore.'),
  phase: 'session',
  layout: 1,
  panels: [{}],
  phone: NARROW_PATCH,
};

/** Wzorzec karty jako układ (karta własna: ustawienia startowe na jednym wykresie). */
export const presetStation = (p: TabPreset): Station => (p === 'own' ? OWN : stationById(p));

export const tabStation = (t: ChartTab): Station => presetStation(t.preset);

/** Pytanie wzorca karty. */
export const presetQuestion = (p: TabPreset): string => presetStation(p).question;

/** Nazwa wzorca karty (karta własna bez nazwy: „Moja karta”). */
export const presetName = (p: TabPreset): string => presetStation(p).name;

export const tabName = (t: ChartTab): string => t.name ?? presetName(t.preset);

/** Karty startowe: sześć układów w kolejności faz, aktywny Kokpit. */
export function defaultTabs(): TabsState {
  return { tabs: STATIONS.map((s) => ({ id: s.id, preset: s.id, name: null })), active: DEFAULT_ACTIVE };
}

/**
 * Odczyt z walidacją: karty układów zawsze na początku w kolejności faz (brakujące dołożone, własna nazwa zostaje),
 * po nich karty własne w zapisanej kolejności (powtórzone lub błędne id pomijane, nieznany wzorzec → `own`, do MAX_TABS).
 */
export function parseTabs(raw: unknown): TabsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { tabs?: unknown; active?: unknown };
  const names = new Map<string, string | null>();
  const own: ChartTab[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(r.tabs) ? r.tabs : []) {
    const t = (v && typeof v === 'object' ? v : {}) as Partial<ChartTab>;
    const id = t.id;
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    if (LAYOUT_IDS.has(id)) names.set(id, cleanName(t.name));
    else if (own.length < MAX_TABS) own.push({ id, preset: isPreset(t.preset) ? t.preset : 'own', name: cleanName(t.name) });
  }
  const tabs: ChartTab[] = [...STATIONS.map((s) => ({ id: s.id, preset: s.id, name: names.get(s.id) ?? null })), ...own];
  return { tabs, active: tabs.some((t) => t.id === r.active) ? (r.active as string) : DEFAULT_ACTIVE };
}

// Pamięć przeglądarki bywa niedostępna (prywatne okno, zablokowane dane strony) — karty działają wtedy do końca sesji
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

/** Karty z zapisu; pierwsze otwarcie po aktualizacji (także z lekcji albo powtórki) najpierw migruje dawne karty. */
export function loadTabs(): TabsState {
  try {
    migrateTabsV2(localStorage);
  } catch {
    // Pamięć niedostępna — karty startowe
  }
  try {
    return parseTabs(JSON.parse(read(KEY) ?? 'null'));
  } catch {
    return defaultTabs();
  }
}

export const saveTabs = (st: TabsState): void => write(KEY, JSON.stringify(st));

export const activeTab = (st: TabsState): ChartTab => st.tabs.find((t) => t.id === st.active) ?? st.tabs[0];

let seq = 0;
/** Nowy identyfikator karty (nie koliduje z id układów: zaczyna się od „k” i cyfry czasu). */
export const newTabId = (now = Date.now()): string => `k${now.toString(36)}${(seq++).toString(36)}`;

/** Nowa karta na końcu listy i od razu aktywna; przy limicie kart własnych albo powtórzonym id — bez zmian. */
export function addTab(st: TabsState, tab: ChartTab): TabsState {
  if (tabsFull(st) || st.tabs.some((t) => t.id === tab.id)) return st;
  return { tabs: [...st.tabs, tab], active: tab.id };
}

/** Zamknięcie karty; aktywną zostaje sąsiadka z prawej (jak w przeglądarce). Ostatniej karty i kart układów nie da się zamknąć. */
export function closeTab(st: TabsState, id: string): TabsState {
  const i = st.tabs.findIndex((t) => t.id === id);
  if (i < 0 || !canClose(st, st.tabs[i])) return st;
  const tabs = st.tabs.filter((t) => t.id !== id);
  return { tabs, active: st.active === id ? (tabs[i] ?? tabs[i - 1]).id : st.active };
}

/** Karta z powrotem na miejscu `index` (cofnięcie zamknięcia). */
export function insertTab(st: TabsState, tab: ChartTab, index: number, activate: boolean): TabsState {
  if (tabsFull(st) || st.tabs.some((t) => t.id === tab.id)) return st;
  const tabs = [...st.tabs];
  tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
  return { tabs, active: activate ? tab.id : st.active };
}

/** Własna nazwa karty; pusta — wraca nazwa wzorca. */
export function renameTab(st: TabsState, id: string, name: string): TabsState {
  const n = name.trim().slice(0, NAME_MAX);
  return { ...st, tabs: st.tabs.map((t) => (t.id === id ? { ...t, name: n || null } : t)) };
}

/** Przeniesienie karty własnej `id` na miejsce `to` (przeciągnięcie na pasku); karty układów zostają na początku. */
export function moveTab(st: TabsState, id: string, to: number): TabsState {
  const i = st.tabs.findIndex((t) => t.id === id);
  if (i < 0 || isLayoutTab(st.tabs[i])) return st;
  const tabs = st.tabs.filter((t) => t.id !== id);
  const first = tabs.filter(isLayoutTab).length;
  tabs.splice(Math.max(first, Math.min(to, tabs.length)), 0, st.tabs[i]);
  return { ...st, tabs };
}

/** Układ z lekcji albo atlasu: jego karta staje się aktywna. */
export function openPreset(st: TabsState, preset: StationId): TabsState {
  const found = st.tabs.find((t) => t.id === preset) ?? st.tabs.find((t) => t.preset === preset);
  return found ? { ...st, active: found.id } : st;
}

/** Otwiera w Wykresach kartę układu (przycisk w lekcjach i atlasie, przed przejściem do Wykresów). */
export function openStationTab(preset: StationId): void {
  saveTabs(openPreset(loadTabs(), preset));
}

/** Karty fazy dnia: układy fazy, a w sesji także karty własne użytkownika (po układach). */
export function phaseTabs(st: TabsState, phase: PhaseId): ChartTab[] {
  const ids: readonly string[] = PHASE_LAYOUTS[phase];
  const layouts = st.tabs.filter((t) => isLayoutTab(t) && ids.includes(t.id));
  return phase === 'session' ? [...layouts, ...st.tabs.filter((t) => !isLayoutTab(t))] : layouts;
}

// ───────────────────────── aktywna karta faz ─────────────────────────

const PHASE_KEY = 'hq.charts.phaseActive.v1';
const PHASE_DEFAULT: Record<PhaseId, string> = { before: PHASE_LAYOUTS.before[0], session: DEFAULT_ACTIVE, after: PHASE_LAYOUTS.after[0] };

/**
 * Ostatnio wybrana karta każdej fazy. Przed i po sesji — tylko układy tej fazy, w sesji także karta własna (czy
 * jeszcze istnieje, sprawdza wywołujący); błędna wartość → pierwszy układ fazy (w sesji Kokpit).
 */
export function loadPhaseActive(): Record<PhaseId, string> {
  let r: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(read(PHASE_KEY) ?? 'null');
    if (v && typeof v === 'object') r = v as Record<string, unknown>;
  } catch {
    // Zepsuty zapis — wartości domyślne
  }
  const pick = (p: PhaseId): string => {
    const v = r[p];
    const ok = typeof v === 'string' && ID_RE.test(v) && ((PHASE_LAYOUTS[p] as readonly string[]).includes(v) || (p === 'session' && !LAYOUT_IDS.has(v)));
    return ok ? (v as string) : PHASE_DEFAULT[p];
  };
  return { before: pick('before'), session: pick('session'), after: pick('after') };
}

export const savePhaseActive = (p: Record<PhaseId, string>): void => write(PHASE_KEY, JSON.stringify(p));

// ───────────────────────── zapis paneli karty ─────────────────────────

/** Zapis karty (ustawienia paneli i układ) — do cofnięcia zamknięcia i kopii karty. */
export type TabSnapshot = (string | null)[];

export const snapshotTab = (id: string): TabSnapshot => stationKeys(id).map(read);

export function restoreTab(id: string, snap: TabSnapshot): void {
  stationKeys(id).forEach((k, i) => write(k, snap[i] ?? null));
}

export const tabLayout = (t: ChartTab): ChartLayout => loadStationLayout(tabStation(t), t.id);

/** Interwały pierwszych `n` paneli karty (z zapisu albo wzorca) — podpis karty na pasku. */
export function tabIntervals(t: ChartTab, n: number, narrow: boolean): string[] {
  const st = tabStation(t);
  return Array.from({ length: n }, (_, p) => loadSettings(stationKey(t.id, p), stationPanel(st, p, narrow)).interval);
}

// ───────────────────────── drabina interwałów ─────────────────────────

const rank = (interval: string) => INTERVALS.findIndex((i) => i.id === interval);

/**
 * Przejście po drabinie interwałów (`dir` −1: Alt+↓ niżej, 1: Alt+↑ wyżej): najbliższa karta w tę stronę paska (↓ w prawo, ↑ w lewo)
 * z niższym albo wyższym interwałem głównego wykresu, więc karty ułożone od wyższego interwału idą krok po kroku.
 * Bez takiej karty w tę stronę — karta o najbliższym interwale na całym pasku (równe: pierwsza). Brak — null.
 */
export function ladderTab(st: TabsState, mainTf: (t: ChartTab) => string, dir: 1 | -1): string | null {
  const at = Math.max(0, st.tabs.findIndex((t) => t.id === st.active));
  const cur = rank(mainTf(st.tabs[at]));
  const ok = (t: ChartTab) => (rank(mainTf(t)) - cur) * dir > 0;
  for (let i = at - dir; i >= 0 && i < st.tabs.length; i -= dir) if (ok(st.tabs[i])) return st.tabs[i].id;
  let best: { id: string; r: number } | null = null;
  for (const t of st.tabs) {
    const r = rank(mainTf(t));
    if (ok(t) && (!best || (r - best.r) * dir < 0)) best = { id: t.id, r };
  }
  return best?.id ?? null;
}

/** Nazwa nowej pustej karty: pierwszy wolny numer. */
export function blankName(st: TabsState): string {
  const base = tr('Karta', 'Tab');
  let n = st.tabs.length + 1;
  while (st.tabs.some((t) => t.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// ───────────────────────── migracja kart (układy faz) ─────────────────────────

const MIGRATED_KEY = 'hq.charts.tabs.migrated.v2';
const RESTORE_OFFER_KEY = 'hq.charts.restoreOffer.v1';
const LEGACY_IDS: ReadonlySet<string> = new Set(LEGACY_STATIONS.map((s) => s.id));
const LEGACY_START = LEGACY_STATIONS[0];

function get(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function set(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Pełna albo zablokowana pamięć — bez znacznika migracja spróbuje przy następnym otwarciu
  }
}

/** Dawny wzorzec karty: stacja albo szablon `tpl:<id>` (jeden wykres); nieznany — dawny Start (jak w dawnym odczycie). */
function legacyPattern(preset: string): LegacyStation {
  const station = LEGACY_STATIONS.find((s) => s.id === preset);
  if (station) return station;
  const t = preset.startsWith('tpl:') ? LEGACY_TEMPLATES.find((x) => `tpl:${x.id}` === preset) : undefined;
  if (!t) return LEGACY_START;
  // Nazwa szablonu: część przed dwukropkiem („Swing 1h: poziomy i profile” → „Swing 1h”), jak na dawnym pasku kart
  return { id: preset, name: t.name.split(':')[0], question: t.name, layout: 1, panels: [t.patch], phone: LEGACY_TEMPLATE_PHONE[t.id] ?? LEGACY_NARROW };
}

/** Karty sprzed migracji: zapis kart albo (bez niego) dawne karty startowe — stacje z aktywną stacją sprzed kart. */
function legacyTabs(storage: Storage): { tabs: { id: string; preset: string; name: string | null; tf?: string }[]; active: unknown } {
  let raw: unknown = null;
  try {
    raw = JSON.parse(get(storage, KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as { tabs?: unknown; active?: unknown };
  const tabs: { id: string; preset: string; name: string | null; tf?: string }[] = [];
  for (const v of Array.isArray(r.tabs) ? r.tabs : []) {
    const t = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const id = t.id;
    if (typeof id !== 'string' || !ID_RE.test(id) || tabs.some((x) => x.id === id)) continue;
    tabs.push({ id, preset: typeof t.preset === 'string' ? t.preset : 'start', name: cleanName(t.name), ...(isInterval(t.tf) ? { tf: t.tf } : {}) });
    if (tabs.length === MAX_TABS) break;
  }
  if (tabs.length > 0) return { tabs, active: r.active };
  return { tabs: LEGACY_STATIONS.map((s) => ({ id: s.id, preset: s.id, name: null })), active: get(storage, LEGACY_ACTIVE_KEY) };
}

/** Panel dawnego wzorca jak w dawnym `stationPanel` (`tf` — interwał pierwszego wykresu zmieniony w karcie zestawu MTF). */
function legacyPanel(legacy: LegacyStation, panel: number, narrow: boolean, tf: string | undefined): ChartSettings {
  const s = stationPanel(legacy, panel, narrow);
  return parseSettings(panel === 0 && tf ? { ...s, interval: tf } : s);
}

/**
 * Jednorazowa migracja kart do układów faz (znacznik `hq.charts.tabs.migrated.v2`):
 * 1. karta dawnej stacji (id = id stacji) bez zapisu ustawień to nietknięta karta startowa — znika;
 * 2. każda inna karta z dawnym wzorcem (stacja albo `tpl:…`) staje się kartą własną z nazwą dawnego wzorca; brakujące
 *    panele wzorca i układ zapisuje się pod jej kluczami z kopii `legacyPresets.ts` (zapis użytkownika zostaje);
 * 3. dawny Start (`hq.charts.v1`) przekazuje Kokpitowi rynek, interwał i wskaźniki (warstwy z wzorca Kokpitu), o ile
 *    Kokpit nie ma jeszcze zapisu;
 * 4. dawne klucze zostają nietknięte.
 * `restoreStart` — jest dawny Start, a pasek „Przywróć moje poprzednie ustawienia” nie został jeszcze zamknięty.
 */
export function migrateTabsV2(storage: Storage): { restoreStart: boolean } {
  const startRaw = get(storage, panelKey(0));
  const restoreStart = startRaw !== null && get(storage, RESTORE_OFFER_KEY) !== 'done';
  if (get(storage, MIGRATED_KEY) !== null) return { restoreStart };
  const narrow = isNarrow();
  const old = legacyTabs(storage);
  const kept: ChartTab[] = [];
  for (const t of old.tabs) {
    if (isPreset(t.preset)) {
      kept.push({ id: t.id, preset: t.preset, name: t.name });
      continue;
    }
    const keys = stationKeys(t.id);
    if (LEGACY_IDS.has(t.id) && keys.every((k) => get(storage, k) === null)) continue;
    const legacy = legacyPattern(t.preset);
    legacy.panels.forEach((_, p) => {
      if (get(storage, keys[p]) === null) set(storage, keys[p], settingsJson(legacyPanel(legacy, p, narrow, t.tf)));
    });
    const layoutKey = keys[keys.length - 1];
    if (get(storage, layoutKey) === null) set(storage, layoutKey, String(legacy.layout));
    kept.push({ id: t.id, preset: 'own', name: t.name ?? legacy.name.slice(0, NAME_MAX) });
  }
  const cockpitKey = stationKey(DEFAULT_ACTIVE, 0);
  if (startRaw !== null && get(storage, cockpitKey) === null) {
    let prev: ChartSettings | null = null;
    try {
      prev = parseSettings(migrateSaved(JSON.parse(startRaw)), DEFAULT_SETTINGS);
    } catch {
      prev = null;
    }
    if (prev) set(storage, cockpitKey, settingsJson({ ...stationPanel(stationById(DEFAULT_ACTIVE), 0, narrow), coin: prev.coin, interval: prev.interval, indicators: prev.indicators }));
  }
  const ids = new Set(kept.map((t) => t.id));
  set(storage, KEY, JSON.stringify(parseTabs({ tabs: kept, active: typeof old.active === 'string' && ids.has(old.active) ? old.active : DEFAULT_ACTIVE })));
  set(storage, MIGRATED_KEY, '1');
  return { restoreStart };
}

/**
 * Karta własna „Moje dawne ustawienia” z pełną zawartością dawnego Startu (panele `hq.charts.v1`, `.p1…p3` i układ)
 * skopiowaną pod jej klucze; dawne klucze zostają. Kartę dodaje wywołujący (`addTab`).
 */
export function restoreLegacyStart(storage: Storage): ChartTab {
  const id = newTabId();
  const keys = stationKeys(id);
  LEGACY_START_KEYS.forEach((k, i) => {
    const v = get(storage, k);
    if (v !== null) set(storage, keys[i], v);
  });
  return { id, preset: 'own', name: tr('Moje dawne ustawienia', 'My previous settings') };
}

/** Pasek „Przywróć moje poprzednie ustawienia” zamknięty (albo użyty) — nie wraca. */
export const dismissRestoreOffer = (storage: Storage): void => set(storage, RESTORE_OFFER_KEY, 'done');
