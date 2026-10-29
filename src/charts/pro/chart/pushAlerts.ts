import { useSyncExternalStore } from 'react';
import { lang } from '../../../i18n';
import { DATA_BASE } from '../../../state/usePublished';
import { ALERTS_URL } from '../../../utils/alertsServer';
import { type AlertEvent, type AlertRule } from '../../../utils/alertRules';
import { LOG_MAX, alertBook, alertLog, parseLog } from './alerts';

/**
 * Powiadomienia 24/7 (także przy zamkniętej stronie i zablokowanym telefonie): subskrypcja push tej przeglądarki
 * i jej alarmy trafiają do skrzynki HyperQuant, a serwer pilnuje ich na taśmie Hyperliquid tym samym silnikiem co strona.
 * Bez konta: losowy identyfikator i token urządzenia w pamięci przeglądarki. Wyłączenie usuwa urządzenie ze skrzynki.
 * Zdarzenia z serwera (uruchomione, wygasłe, anulowane alarmy i starty z łańcucha) wracają tu przy każdej synchronizacji.
 */

const KEY = 'hq.charts.push.v1';
/** Tyle alarmów urządzenia pilnuje serwer. */
export const PUSH_MAX = 30;

interface Stored {
  id: string;
  token: string;
  /** Ostatnie zdarzenie z serwera już dopisane do historii. */
  since: number;
}

export type PushStatus = 'unsupported' | 'off' | 'on' | 'busy' | 'error';

class PushHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function load(): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    return v && typeof v.id === 'string' && typeof v.token === 'string' ? { id: v.id, token: v.token, since: typeof v.since === 'number' ? v.since : 0 } : null;
  } catch {
    return null;
  }
}

function save(s: Stored | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Bez zapisu urządzenie działa do końca sesji
  }
}

export const pushSupported = (): boolean =>
  ALERTS_URL !== '' && DATA_BASE !== '' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

/** iPhone i iPad w Safari: powiadomienia push są dopiero w aplikacji dodanej do ekranu początkowego. */
export const pushNeedsHomeScreen = (): boolean =>
  ALERTS_URL !== '' && DATA_BASE !== '' && typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) && !('PushManager' in window);

let status: PushStatus = pushSupported() ? (load() ? 'on' : 'off') : 'unsupported';
const listeners = new Set<() => void>();
function setStatus(s: PushStatus): void {
  status = s;
  listeners.forEach((l) => l());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Stan przełącznika „24/7” dla panelu alarmów. */
export const usePushStatus = (): PushStatus => useSyncExternalStore(subscribe, () => status);

async function call<T>(method: string, path: string, body?: object, token?: string): Promise<T> {
  const res = await fetch(ALERTS_URL + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new PushHttpError(res.status);
  return (await res.json()) as T;
}

const fromB64u = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Rejestracja service workera (tylko wersja produkcyjna strony), najwyżej 10 s. */
function registration(): Promise<ServiceWorkerRegistration> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sw')), 10_000))]);
}

/** Włączenie: zgoda na powiadomienia, subskrypcja push z kluczem serwera i zapis urządzenia w skrzynce. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  setStatus('busy');
  try {
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new Error('permission');
    const reg = await registration();
    const keys = (await (await fetch(`${DATA_BASE}/alerts/keys.json`, { cache: 'no-cache' })).json()) as { vapid?: unknown };
    if (typeof keys.vapid !== 'string') throw new Error('keys');
    const key = fromB64u(keys.vapid);
    let sub = await reg.pushManager.getSubscription();
    // Subskrypcja z innym kluczem serwera nie przyjmie powiadomień
    const old = sub?.options.applicationServerKey;
    if (sub && !(old && new Uint8Array(old).join() === key.join())) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const prev = load();
    const res = await call<{ id: string; token: string }>('POST', '/v1/devices', { sub: sub.toJSON(), lang, rules: alertBook.get() });
    save({ id: res.id, token: res.token, since: prev?.since ?? Date.now() });
    lastSig = signature(alertBook.get());
    setStatus('on');
    return true;
  } catch {
    setStatus(load() ? 'on' : 'error');
    return false;
  }
}

/** Wyłączenie: urządzenie znika ze skrzynki, subskrypcja push zostaje anulowana. */
export async function disablePush(): Promise<void> {
  const s = load();
  save(null);
  setStatus(pushSupported() ? 'off' : 'unsupported');
  if (s) await call('DELETE', `/v1/devices/${s.id}`, undefined, s.token).catch(() => undefined);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // Subskrypcja wygaśnie sama; skrzynka już jej nie zna
  }
}

/** Zmiana listy dla serwera: alarmy dodane, usunięte, zmienione (nowa chwila ustawienia) i starty z łańcucha; język. */
const signature = (rules: readonly AlertRule[]): string => JSON.stringify([lang, rules.map((r) => [r.id, r.created, r.after])]);
const eventKey = (e: AlertEvent): string => `${e.type}:${e.rule.id}:${e.at}`;
let lastSig = '';
let timer: ReturnType<typeof setTimeout> | undefined;

/** Zdarzenia z serwera: do historii (bez powtórek), zakończone alarmy znikają z listy, starty z łańcucha przyjęte. */
function applyServer(rules: AlertRule[], raw: unknown, s: Stored): void {
  const events = parseLog(raw);
  const done = new Set(events.map((e) => e.rule.id));
  if (events.length) {
    alertLog.update((l) => {
      const seen = new Set(l.map(eventKey));
      return [...events.filter((e) => !seen.has(eventKey(e))), ...l].sort((a, b) => b.at - a.at).slice(0, LOG_MAX);
    });
    save({ ...s, since: Math.max(s.since, ...events.map((e) => e.at)) });
  }
  const started = new Map(rules.filter((r) => !r.after).map((r) => [r.id, r]));
  const list = alertBook.get();
  if (list.some((r) => done.has(r.id) || (r.after && started.has(r.id))))
    alertBook.update((l) =>
      l
        .filter((r) => !done.has(r.id))
        .map((r) => {
          const st = started.get(r.id);
          return st && r.after ? { ...r, after: '', created: st.created, from: st.from } : r;
        })
    );
}

/** Synchronizacja ze skrzynką (`force`: także bez zmian listy, np. po powrocie do strony). */
export async function syncPush(force = false): Promise<void> {
  const s = load();
  if (!s || !pushSupported()) return;
  const rules = alertBook.get();
  const sig = signature(rules);
  if (!force && sig === lastSig) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    const res = await call<{ rules: AlertRule[]; events: unknown }>('PUT', `/v1/devices/${s.id}`, { sub: sub?.toJSON(), lang, rules, since: s.since }, s.token);
    lastSig = sig;
    if (status !== 'on') setStatus('on');
    applyServer(res.rules, res.events, s);
  } catch (e) {
    // Urządzenie usunięte w skrzynce (wygasła subskrypcja albo 30 dni bez wizyty): przełącznik wraca do „wyłączone”
    if (e instanceof PushHttpError && e.status === 404) {
      save(null);
      setStatus('off');
    }
  }
}

/** Start synchronizacji (raz na stronę): przy zmianie alarmów, po powrocie do strony i po powiadomieniu 24/7. */
export function startPushSync(): void {
  if (!pushSupported()) return;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncPush(), 1500);
  };
  alertBook.subscribe(later);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncPush(true));
  navigator.serviceWorker.addEventListener('message', (e) => (e.data as { type?: unknown } | null)?.type === 'hq-alert-push' && void syncPush(true));
  void syncPush(true);
}
