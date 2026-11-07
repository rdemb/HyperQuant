import { recordedRange } from '../charts/pro/replay/data';
import { replayHash } from '../charts/pro/replay/link';
import type { Market } from '../charts/pro/store/proStore';
import type { HistoryIndex } from './tapeHistory';

/**
 * Pierwszy kontakt z ekranem W sesji: dymki objaśniające i przycisk „Powtórka ostatnich 15 min”.
 * Jedyny klucz, który ten moduł zapisuje: `hq.onboarding.v1` = `{ firstAt, done }`; innych kluczy nie rusza.
 * Dostęp do pamięci jest osłonięty (tryb prywatny, zablokowana pamięć): każdy błąd = „już widziane”.
 */

export const ONBOARDING_KEY = 'hq.onboarding.v1';
/** Okno powtórki: ostatnie 15 minut. */
export const QUICK_REPLAY_MS = 15 * 60_000;
/** Przycisk powtórki zostaje przez 7 dni od pierwszej wizyty. */
export const TIPS_PENDING_MS = 7 * 86_400_000;

interface Record_ {
  firstAt: number;
  done: boolean;
}

function read(storage: Storage): Record_ | null {
  try {
    const raw = storage.getItem(ONBOARDING_KEY);
    if (raw === null) return null;
    const o = JSON.parse(raw) as Partial<Record_> | null;
    if (!o || typeof o.firstAt !== 'number' || !Number.isFinite(o.firstAt)) return null;
    return { firstAt: o.firstAt, done: o.done === true };
  } catch {
    return null;
  }
}

function write(storage: Storage, r: Record_): void {
  try {
    storage.setItem(ONBOARDING_KEY, JSON.stringify(r));
  } catch {
    // Pełna albo zablokowana pamięć: dymki mogą wrócić, nic więcej
  }
}

/** Czy to pierwsza wizyta: brak `hq.onboarding.v1` i brak kluczy `hq.charts.*` (stali użytkownicy nie widzą dymków). */
export function isFirstVisit(storage: Storage): boolean {
  try {
    if (storage.getItem(ONBOARDING_KEY) !== null) return false;
    for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith('hq.charts.')) return false;
    return true;
  } catch {
    return false;
  }
}

/** Zapamiętuje pierwszą wizytę (dymki czekają na „Rozumiem”); nie nadpisuje istniejącego zapisu. */
export function startOnboarding(storage: Storage, now: number): void {
  if (!isFirstVisit(storage)) return;
  write(storage, { firstAt: now, done: false });
}

/** Zamyka dymki na stałe; czas pierwszej wizyty zostaje (albo jest teraz, gdy zapisu nie było). */
export function markSeen(storage: Storage, now: number): void {
  const prev = read(storage);
  write(storage, { firstAt: prev?.firstAt ?? now, done: true });
}

/** Dymki mają się pokazać: pierwsza wizyta zapisana, ale jeszcze nie zamknięta. */
export function tipsPending(storage: Storage): boolean {
  const r = read(storage);
  return r !== null && !r.done;
}

/** Przycisk powtórki: tylko do 7 dni od pierwszej wizyty (bez zapisu — stały użytkownik — go nie ma). */
export function quickReplayVisible(storage: Storage, now: number): boolean {
  const r = read(storage);
  return r !== null && now - r.firstAt < TIPS_PENDING_MS;
}

export type QuickReplay = { ok: true; hash: string } | { ok: false; reason: 'market' | 'no-recording' };

/**
 * Link powtórki ostatnich 15 min na Kokpicie. Nagranie serwera jest tylko dla BTC w tej wersji ekranu (inny rynek —
 * powód `market`), a bez spisu albo gdy nagranie kończy się przed początkiem okna — `no-recording`, zamiast pustej powtórki.
 */
export function quickReplay(coin: Market, now: number, index: HistoryIndex | null): QuickReplay {
  if (coin !== 'BTC') return { ok: false, reason: 'market' };
  const range = index ? recordedRange(index, coin) : null;
  const from = now - QUICK_REPLAY_MS;
  if (!range || range.to <= from) return { ok: false, reason: 'no-recording' };
  return { ok: true, hash: replayHash({ source: 'history', coin, from, to: now, station: 'cockpit' }) };
}
