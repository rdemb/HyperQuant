import { useSyncExternalStore } from 'react';
import type { SessionId } from '../../charts/pro/core/sessions';
import { type GuardEvent, MAX_LOG, MAX_RULES, type Rule, type RuleKind, parseRules } from './straznicy';

/**
 * Pamięć wyspy na tym urządzeniu: reguły strażników, dziennik zdarzeń i wyłącznik wszystkich. Nic nie wychodzi na
 * serwer. Zmiana w innej karcie przychodzi zdarzeniem `storage` (jedna lista dla wszystkich kart).
 */

const RULES_KEY = 'hq.wyspa.straznicy.v1';
const LOG_KEY = 'hq.wyspa.dziennik.v1';
const PAUSE_KEY = 'hq.wyspa.pauza.v1';

function parseLog(raw: string | null): GuardEvent[] {
  try {
    const x: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(x)) return [];
    return x
      .filter((e): e is GuardEvent => !!e && typeof e === 'object' && typeof e.ruleId === 'string' && typeof e.kind === 'string' && typeof e.at === 'number' && typeof e.text === 'string')
      .map((e) => ({ ruleId: e.ruleId, kind: e.kind, at: e.at, text: e.text.slice(0, 200) }))
      .slice(0, MAX_LOG);
  } catch {
    return [];
  }
}

function store<T>(key: string, parse: (raw: string | null) => T) {
  let value: T | null = null;
  let synced = false;
  const listeners = new Set<() => void>();
  const read = (): T => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  };
  const get = (): T => (value ??= read());
  return {
    get,
    set(next: T) {
      value = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Prywatne okno albo pełna pamięć: działa do końca wizyty
      }
      listeners.forEach((l) => l());
    },
    subscribe(fn: () => void) {
      if (!synced && typeof window !== 'undefined') {
        synced = true;
        window.addEventListener('storage', (e) => {
          if (e.key !== key) return;
          value = read();
          listeners.forEach((l) => l());
        });
      }
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export const rulesStore = store<Rule[]>(RULES_KEY, parseRules);
export const logStore = store<GuardEvent[]>(LOG_KEY, parseLog);
export const pauseStore = store<boolean>(PAUSE_KEY, (raw) => raw === 'true');

export const useRules = (): Rule[] => useSyncExternalStore(rulesStore.subscribe, rulesStore.get, rulesStore.get);
export const useLog = (): GuardEvent[] => useSyncExternalStore(logStore.subscribe, logStore.get, logStore.get);
export const usePaused = (): boolean => useSyncExternalStore(pauseStore.subscribe, pauseStore.get, pauseStore.get);

let seq = 0;
const newId = (now: number) => `${now.toString(36)}${(seq++).toString(36)}`;

/** Reguła potrzebuje liczby (poziom, progi) albo sesji; reszta (PDH, PDL) działa bez niczego. */
export const needsValue = (k: RuleKind): boolean => k === 'poziom' || k === 'funding' || k === 'ruch' || k === 'likwidacje';

export function addRule(kind: RuleKind, opts: { value?: number; session?: SessionId }, now = Date.now()): boolean {
  const list = rulesStore.get();
  if (list.length >= MAX_RULES) return false;
  if (needsValue(kind) && !(typeof opts.value === 'number' && Number.isFinite(opts.value) && opts.value > 0)) return false;
  if (kind === 'sesja' && !opts.session) return false;
  const rule: Rule = { id: newId(now), kind, on: true, ...(needsValue(kind) ? { value: opts.value } : {}), ...(kind === 'sesja' ? { session: opts.session } : {}) };
  rulesStore.set([...list, rule]);
  return true;
}

export const toggleRule = (id: string): void => rulesStore.set(rulesStore.get().map((r) => (r.id === id ? { ...r, on: !r.on } : r)));
export const removeRule = (id: string): void => rulesStore.set(rulesStore.get().filter((r) => r.id !== id));

/** Zapis zdarzeń: chwila w regule (przerwa między powiadomieniami) i wpis na początku dziennika. */
export function recordEvents(events: readonly GuardEvent[]): void {
  if (events.length === 0) return;
  const last = new Map(events.map((e) => [e.ruleId, e.at]));
  rulesStore.set(rulesStore.get().map((r) => (last.has(r.id) ? { ...r, lastAt: last.get(r.id) } : r)));
  logStore.set([...[...events].reverse(), ...logStore.get()].slice(0, MAX_LOG));
}

export const clearLog = (): void => logStore.set([]);
