import { ChartLayout, NARROW_PATCH, loadSettings } from './settings';
import { STATIONS, Station, StationId, loadStation, loadStationLayout, stationById, stationKey, stationKeys, stationPanel } from './stations';
import { BUILT_IN_TEMPLATES, MTF_SETS, TEMPLATE_PHONE, TEMPLATE_QUESTIONS } from './templates';
import { INTERVALS } from '../core/time';
import { tr } from '../../../i18n';

/**
 * Karty układów (jak karty przeglądarki albo układy TradingView): każda karta to własny układ wykresów z ustawieniami
 * każdego panelu (interwał, rodzaj wykresu, wskaźniki, warstwy), zapisany pod identyfikatorem karty. Wzorzec karty
 * (stacja robocza albo wbudowany szablon) służy do „Przywróć”. Karty startowe to stacje z ich dotychczasowym zapisem,
 * więc ustawienia sprzed kart zostają.
 */

/** Wzorzec karty: stacja robocza albo wbudowany szablon (`tpl:<id>`, jeden wykres). */
export type TabPreset = StationId | `tpl:${string}`;

export interface ChartTab {
  /** Identyfikator zapisu ustawień: karty ze stacji startowych — id stacji, nowe karty — `k…`. */
  id: string;
  preset: TabPreset;
  /** Własna nazwa; null — nazwa wzorca. */
  name: string | null;
  /** Interwał pierwszego wykresu wzorca zmieniony w tej karcie (zestawy kart MTF). */
  tf?: string;
}

export interface TabsState {
  tabs: ChartTab[];
  active: string;
}

const KEY = 'hq.charts.tabs.v1';
/** Najwięcej kart (każda ma do 4 paneli w pamięci przeglądarki; zestaw MTF dodaje do 6). */
export const MAX_TABS = 20;
const NAME_MAX = 32;
/** Identyfikator karty trafia do kluczy zapisu — tylko małe litery i cyfry. */
const ID_RE = /^[a-z0-9]{1,24}$/;

const templateOf = (p: string) => (p.startsWith('tpl:') ? BUILT_IN_TEMPLATES.find((t) => `tpl:${t.id}` === p) : undefined);

const isPreset = (v: unknown): v is TabPreset => typeof v === 'string' && (STATIONS.some((s) => s.id === v) || templateOf(v) !== undefined);

const isInterval = (v: unknown): v is string => INTERVALS.some((i) => i.id === v);

/**
 * Wzorzec karty jako stacja: szablon to jeden wykres z ustawieniami szablonu (na telefonie jego łatka albo
 * NARROW_PATCH). `tf` zmienia interwał pierwszego wykresu wzorca.
 */
export function presetStation(p: TabPreset, tf?: string): Station {
  const t = templateOf(p);
  const st = t ? { id: 'start' as const, name: presetName(p), question: presetQuestion(p), layout: 1 as const, panels: [t.s], phone: TEMPLATE_PHONE[t.id] ?? NARROW_PATCH } : stationById(p);
  return tf && isInterval(tf) ? { ...st, panels: st.panels.map((x, i) => (i === 0 ? { ...x, interval: tf } : x)) } : st;
}

export const tabStation = (t: ChartTab): Station => presetStation(t.preset, t.tf);

/** Pytanie wzorca: szablon — jego pytanie, stacja — pierwsze zdanie opisu („Gdzie rynek widzi wartość?”). */
export function presetQuestion(p: TabPreset): string {
  const t = templateOf(p);
  if (t) return TEMPLATE_QUESTIONS[t.id] ?? t.name;
  const q = stationById(p).question;
  return q.slice(0, q.indexOf('?') + 1) || q;
}

/** Nazwa wzorca: stacja — jej nazwa, szablon — część przed dwukropkiem („Swing 1h: poziomy i profile” → „Swing 1h”). */
export function presetName(p: TabPreset): string {
  const t = templateOf(p);
  return t ? t.name.split(':')[0] : stationById(p).name;
}

export const tabName = (t: ChartTab): string => t.name ?? presetName(t.preset);

/** Karty startowe: stacje robocze w dotychczasowej kolejności, aktywna — ostatnio wybrana stacja. */
export function defaultTabs(): TabsState {
  return { tabs: STATIONS.map((s) => ({ id: s.id, preset: s.id, name: null })), active: loadStation().id };
}

/** Odczyt z walidacją (powtórzone lub błędne id pomijane, nieznany wzorzec → Start); bez żadnej karty — null. */
export function parseTabs(raw: unknown): TabsState | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { tabs?: unknown; active?: unknown };
  if (!Array.isArray(r.tabs)) return null;
  const tabs: ChartTab[] = [];
  for (const v of r.tabs) {
    const t = (v && typeof v === 'object' ? v : {}) as Partial<ChartTab>;
    const id = t.id;
    if (typeof id !== 'string' || !ID_RE.test(id) || tabs.some((x) => x.id === id)) continue;
    const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, NAME_MAX) : null;
    tabs.push({ id, preset: isPreset(t.preset) ? t.preset : 'start', name, ...(isInterval(t.tf) ? { tf: t.tf } : {}) });
    if (tabs.length === MAX_TABS) break;
  }
  if (tabs.length === 0) return null;
  return { tabs, active: tabs.some((t) => t.id === r.active) ? (r.active as string) : tabs[0].id };
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

export function loadTabs(): TabsState {
  try {
    return parseTabs(JSON.parse(read(KEY) ?? 'null')) ?? defaultTabs();
  } catch {
    return defaultTabs();
  }
}

export const saveTabs = (st: TabsState): void => write(KEY, JSON.stringify(st));

export const activeTab = (st: TabsState): ChartTab => st.tabs.find((t) => t.id === st.active) ?? st.tabs[0];

let seq = 0;
/** Nowy identyfikator karty (nie koliduje z id stacji: zaczyna się od „k” i cyfry czasu). */
export const newTabId = (now = Date.now()): string => `k${now.toString(36)}${(seq++).toString(36)}`;

/** Nowa karta na końcu listy i od razu aktywna; przy limicie kart — bez zmian. */
export function addTab(st: TabsState, tab: ChartTab): TabsState {
  if (st.tabs.length >= MAX_TABS || st.tabs.some((t) => t.id === tab.id)) return st;
  return { tabs: [...st.tabs, tab], active: tab.id };
}

/** Zamknięcie karty; aktywną zostaje sąsiadka z prawej (jak w przeglądarce). Ostatniej karty nie da się zamknąć. */
export function closeTab(st: TabsState, id: string): TabsState {
  const i = st.tabs.findIndex((t) => t.id === id);
  if (i < 0 || st.tabs.length <= 1) return st;
  const tabs = st.tabs.filter((t) => t.id !== id);
  return { tabs, active: st.active === id ? (tabs[i] ?? tabs[i - 1]).id : st.active };
}

/** Karta z powrotem na miejscu `index` (cofnięcie zamknięcia). */
export function insertTab(st: TabsState, tab: ChartTab, index: number, activate: boolean): TabsState {
  if (st.tabs.length >= MAX_TABS || st.tabs.some((t) => t.id === tab.id)) return st;
  const tabs = [...st.tabs];
  tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
  return { tabs, active: activate ? tab.id : st.active };
}

/** Własna nazwa karty; pusta — wraca nazwa wzorca. */
export function renameTab(st: TabsState, id: string, name: string): TabsState {
  const n = name.trim().slice(0, NAME_MAX);
  return { ...st, tabs: st.tabs.map((t) => (t.id === id ? { ...t, name: n || null } : t)) };
}

/** Przeniesienie karty `id` na miejsce `to` (przeciągnięcie na pasku kart). */
export function moveTab(st: TabsState, id: string, to: number): TabsState {
  const i = st.tabs.findIndex((t) => t.id === id);
  if (i < 0) return st;
  const tabs = st.tabs.filter((t) => t.id !== id);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, st.tabs[i]);
  return { ...st, tabs };
}

/** Wzorzec z lekcji albo atlasu: pierwsza karta z tym wzorcem staje się aktywna, a bez niej powstaje nowa. */
export function openPreset(st: TabsState, preset: TabPreset, id: string): TabsState {
  const found = st.tabs.find((t) => t.preset === preset);
  if (found) return { ...st, active: found.id };
  const next = addTab(st, { id, preset, name: null });
  // Przy limicie kart wzorzec zastępuje aktywną kartę
  return next !== st ? next : { tabs: st.tabs.map((t) => (t.id === st.active ? { id, preset, name: null } : t)), active: id };
}

/** Otwiera w Wykresach kartę stacji (przycisk w lekcjach i atlasie, przed przejściem do Wykresów). */
export function openStationTab(preset: StationId): void {
  const st = loadTabs();
  const next = openPreset(st, preset, newTabId());
  // Karta zastąpiona przy limicie traci zapis
  for (const t of st.tabs) if (!next.tabs.some((x) => x.id === t.id)) for (const k of stationKeys(t.id)) write(k, null);
  saveTabs(next);
}

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
 * z niższym albo wyższym interwałem głównego wykresu, więc zestaw ułożony od wyższego interwału idzie krok po kroku.
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

// ───────────────────────── zestawy kart MTF ─────────────────────────

export const setById = (id: string) => MTF_SETS.find((x) => x.id === id);

/** Karta zestawu już otwarta (ten sam wzorzec i interwał) — zestaw jej nie powiela. */
const sameTab = (t: ChartTab, preset: string, tf: string | undefined) => t.preset === preset && t.tf === tf;

/** Ile nowych kart doda zestaw (karty z tym samym wzorcem i interwałem już są). */
export function setNewCount(st: TabsState, id: string): number {
  return (setById(id)?.tabs ?? []).filter((e) => !st.tabs.some((t) => sameTab(t, e.preset, e.tf))).length;
}

/**
 * Zestaw kart MTF: brakujące karty na końcu paska w kolejności zestawu (od wyższego interwału), aktywna — pierwsza
 * karta zestawu. Bez miejsca na wszystkie nowe karty — bez zmian.
 */
export function addSet(st: TabsState, id: string, newId: () => string): TabsState {
  const set = setById(id);
  if (!set || st.tabs.length + setNewCount(st, id) > MAX_TABS) return st;
  const tabs = [...st.tabs];
  let first: string | null = null;
  for (const e of set.tabs) {
    if (!isPreset(e.preset)) continue;
    let t = tabs.find((x) => sameTab(x, e.preset, e.tf));
    if (!t) {
      t = { id: newId(), preset: e.preset, name: null, ...(e.tf ? { tf: e.tf } : {}) };
      tabs.push(t);
    }
    first ??= t.id;
  }
  return first ? { tabs, active: first } : st;
}

/** Nazwa nowej pustej karty: pierwszy wolny numer. */
export function blankName(st: TabsState): string {
  const base = tr('Karta', 'Tab');
  let n = st.tabs.length + 1;
  while (st.tabs.some((t) => t.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}
