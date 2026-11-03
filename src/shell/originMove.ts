/**
 * Przeprowadzka strony z rdemb.github.io/HyperQuant/ na hyperquant.tech. Inny adres to osobna pamięć przeglądarki,
 * więc ustawienia (klucze hq.*: rysunki, karty, szablony, alarmy, dziennik, urządzenie 24/7) przenosimy w # adresu.
 * - Stary adres: GitHub przekierowuje każde zapytanie, a service worker podaje wtedy zcache'owaną aplikację; ona wysyła
 *   pakiet ustawień i widok (#…) na nową domenę.
 * - Nowy adres: pierwszy pakiet zapisuje się przed startem aplikacji (ten moduł jest pierwszym importem main.tsx),
 *   kolejne tylko przywracają widok. Urządzenie 24/7 przechodzi bez zmian: powiadomienia dalej dostarcza subskrypcja
 *   ze starego adresu, a nowy adres synchronizuje alarmy tym samym tokenem.
 */

export const OLD_ORIGIN = 'https://rdemb.github.io';
export const NEW_ORIGIN = 'https://hyperquant.tech';
const PREFIX = '#move=';
/** Chwila przyjęcia pakietu na nowym adresie (raz na przeglądarkę). */
const TAKEN = 'hq.move.taken.v1';

type Win = Pick<Window, 'location' | 'localStorage' | 'history' | 'confirm' | 'fetch'> & { document: Pick<Document, 'referrer'> };

interface Pack {
  /** Widok sprzed przeprowadzki (#charts?…), pusty bez widoku. */
  h: string;
  k: Record<string, string>;
}

function toB64u(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const fromB64u = (s: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

const viewHash = (h: unknown): string => (typeof h === 'string' && h.startsWith('#') && !h.startsWith(PREFIX) ? h : '');

/** Pakiet: wszystkie klucze hq.* tej przeglądarki i bieżący widok. */
export function packStorage(store: Storage, hash: string): string {
  const k: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith('hq.') && key !== TAKEN) k[key] = store.getItem(key) ?? '';
  }
  return toB64u(JSON.stringify({ h: viewHash(hash), k }));
}

/** Odczyt pakietu: tylko klucze hq.* z tekstowymi wartościami; uszkodzony pakiet = null. */
export function unpack(payload: string): Pack | null {
  try {
    const p = JSON.parse(fromB64u(payload)) as { h?: unknown; k?: unknown } | null;
    if (!p || typeof p.k !== 'object' || p.k === null) return null;
    const k: Record<string, string> = {};
    for (const [key, v] of Object.entries(p.k)) if (key.startsWith('hq.') && key !== TAKEN && typeof v === 'string') k[key] = v;
    return { h: viewHash(p.h), k };
  } catch {
    return null;
  }
}

/**
 * Nowy adres: przyjęcie pakietu, gdy przyszedł ze starego adresu (albo po zgodzie, gdy przeglądarka ukryła skąd)
 * i ta przeglądarka jeszcze żadnego nie przyjęła; potem # wraca do widoku. Zwraca true po zapisie ustawień.
 */
export function moveIn(win: Win): boolean {
  const { location: loc } = win;
  if (!loc.hash.startsWith(PREFIX)) return false;
  const pack = unpack(loc.hash.slice(PREFIX.length));
  let taken = false;
  try {
    const store = win.localStorage;
    if (
      pack &&
      !store.getItem(TAKEN) &&
      (win.document.referrer.startsWith(`${OLD_ORIGIN}/`) ||
        win.confirm('Wczytać ustawienia HyperQuant ze starego adresu?\nLoad HyperQuant settings from the old address?'))
    ) {
      for (const [k, v] of Object.entries(pack.k)) store.setItem(k, v);
      store.setItem(TAKEN, String(Date.now()));
      taken = true;
    }
  } catch {
    // Zablokowana albo pełna pamięć: strona startuje bez przeniesionych ustawień
  }
  win.history.replaceState(null, '', loc.pathname + loc.search + (pack?.h ?? ''));
  return taken;
}

/** Stary adres: gdy GitHub już przekierowuje na nową domenę, przejście tam z pakietem ustawień i bieżącym widokiem. */
export async function moveOut(win: Win): Promise<void> {
  if (win.location.origin !== OLD_ORIGIN) return;
  try {
    // HEAD bez podążania za przekierowaniem (service worker go nie przechwytuje): przed przeprowadzką zwykłe 200
    const res = await win.fetch('./manifest.webmanifest', { method: 'HEAD', redirect: 'manual', cache: 'no-store' });
    if (res.type !== 'opaqueredirect') return;
  } catch {
    return;
  }
  let target = `${NEW_ORIGIN}/${viewHash(win.location.hash)}`;
  try {
    target = `${NEW_ORIGIN}/${PREFIX}${packStorage(win.localStorage, win.location.hash)}`;
  } catch {
    // Bez dostępu do pamięci: samo przejście
  }
  win.location.replace(target);
}

// Przed modułami aplikacji, które czytają ustawienia przy imporcie (język, alarmy, wykresy)
if (typeof window !== 'undefined') moveIn(window);
