/**
 * Zapis pierwszej wizyty (`hq.onboarding.v1` = `{ firstAt, done }`) — jedyny klucz, który ten moduł zapisuje; innych nie
 * rusza. Bez modułów wykresu: DeskProvider zapisuje pierwszą wizytę przy starcie aplikacji, zanim jakikolwiek wykres
 * (albo adres #flow) zapisze klucze `hq.charts.*`, więc wejście na Przed sesją albo Po sesji nie gubi dymków W sesji
 * (views/session/FirstContact). Dostęp do pamięci jest osłonięty (tryb prywatny, zablokowana pamięć): każdy błąd = „już
 * widziane”.
 */

export const ONBOARDING_KEY = 'hq.onboarding.v1';
/** Przycisk powtórki zostaje przez 7 dni od pierwszej wizyty. */
export const QUICK_REPLAY_WINDOW_MS = 7 * 86_400_000;

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
  return r !== null && now - r.firstAt < QUICK_REPLAY_WINDOW_MS;
}
