import type { PhaseId } from '../charts/pro/chart/stations';
import type { ViewId } from './types';

/**
 * Klucz stanu kolumny DOM i taśmy (`DOCK_KEY` z views/flow/flowColumnModel, zgodność pilnuje test). Bez importu, żeby
 * router w pierwszym pakiecie nie ciągnął modułów wykresu.
 */
const DOCK_KEY = 'hq.charts.dock.v1';

/** Widoki aplikacji w kolejności paska: trzy fazy dnia, potem menu „Więcej”. */
export const VIEWS: readonly ViewId[] = ['before', 'charts', 'after', 'research', 'lessons', 'sources'];

/** Widok pustego i nieznanego adresu: W sesji. */
export const DEFAULT_VIEW: ViewId = 'charts';

/** Stare zakładki (sprzed faz dnia) → nowe miejsca ich zawartości. */
export const LEGACY_VIEW: Record<string, ViewId> = { desk: 'before', market: 'before', plan: 'after', lab: 'charts', micro: 'research', flow: 'charts' };

/** Faza dnia (układy wykresu) → widok aplikacji z jej ekranem. */
export const PHASE_VIEW: Record<PhaseId, ViewId> = { before: 'before', session: 'charts', after: 'after' };

/** Nazwa widoku z adresu (przed „?”) i reszta od „?” włącznie. */
function splitHash(hash: string): { id: string; rest: string } {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = body.indexOf('?');
  return q < 0 ? { id: body, rest: '' } : { id: body.slice(0, q), rest: body.slice(q) };
}

/**
 * Widok z adresu strony. Stary adres (#desk, #plan…) daje nowy widok i `rewrite` — nowy adres z zachowaną częścią po
 * „?” (parametry wykresu i powtórki); nowy, pusty albo nieznany adres — `rewrite: null` (nic do zmiany).
 */
export function resolveHash(hash: string): { view: ViewId; rewrite: string | null } {
  const { id, rest } = splitHash(hash);
  if ((VIEWS as readonly string[]).includes(id)) return { view: id as ViewId, rewrite: null };
  // Tylko własne pola (nie „constructor” ani „__proto__” z prototypu)
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_VIEW, id) ? LEGACY_VIEW[id] : null;
  return legacy ? { view: legacy, rewrite: `#${legacy}${rest}` } : { view: DEFAULT_VIEW, rewrite: null };
}

type RouteWin = {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'state' | 'replaceState'>;
  localStorage: Pick<Storage, 'setItem'>;
};

/** Subskrypcja zmiany adresu (hashchange) dla `useSyncExternalStore` (pasek ceny, ekran W sesji). */
export function subscribeHash(fn: () => void): () => void {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

/** Adres #flow od ostatniego odczytu: Wykresy otwierają wtedy szufladę DOM i taśmy (ekran 640–1279 px). */
let flowAsked = false;

/** Jednorazowa prośba o kolumnę DOM i taśmy z adresu #flow (odczyt ją kasuje). */
export function takeFlowAsk(): boolean {
  const asked = flowAsked;
  flowAsked = false;
  return asked;
}

/**
 * Przekierowanie bieżącego adresu (przy starcie i przy hashchange): stary adres zastąpiony nowym w historii
 * (`replaceState`, bez nowego wpisu dla Wstecz), a dawne „DOM i taśma” (#flow) otwiera też kolumnę DOM i taśmy
 * (obok wykresu zapisem, na średnim ekranie szufladę przez `takeFlowAsk`). Zwraca widok do pokazania.
 */
export function followHash(win: RouteWin): ViewId {
  const { hash, pathname, search } = win.location;
  const { view, rewrite } = resolveHash(hash);
  if (rewrite === null) return view;
  if (splitHash(hash).id === 'flow') {
    flowAsked = true;
    try {
      win.localStorage.setItem(DOCK_KEY, '1');
    } catch {
      // Pamięć niedostępna (tryb prywatny): kolumna w stanie domyślnym
    }
  }
  win.history.replaceState(win.history.state, '', `${pathname}${search}${rewrite}`);
  return view;
}
