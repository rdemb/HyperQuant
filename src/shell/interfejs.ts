/**
 * Przełącznik nowego wyglądu (do czasu domyślnego włączenia po akceptacji właściciela).
 * `?ui=nowy` włącza i zapamiętuje wybór w pamięci przeglądarki, `?ui=stary` wraca i usuwa zapis; bez parametru
 * decyduje zapis, domyślnie stary interfejs. Moduł bez importów aplikacji:
 * czyta go pierwszy pakiet (main.tsx); kod nowego wyglądu leży w src/nowy/ i ładuje się leniwie.
 */
export const UI_KEY = 'hq.ui.v1';

export type Interfejs = 'nowy' | 'stary';

type Pamiec = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function wybierzInterfejs(search: string, pamiec: Pamiec): Interfejs {
  const p = new URLSearchParams(search).get('ui');
  try {
    if (p === 'nowy') pamiec.setItem(UI_KEY, 'nowy');
    else if (p === 'stary') pamiec.removeItem(UI_KEY);
  } catch {
    // Pamięć niedostępna (tryb prywatny, blokada): wybór z parametru działa tylko w tej wizycie
  }
  if (p === 'nowy' || p === 'stary') return p;
  try {
    return pamiec.getItem(UI_KEY) === 'nowy' ? 'nowy' : 'stary';
  } catch {
    return 'stary';
  }
}

/** Adres bez parametru `ui` (reszta zapytania i hash bez zmian); null, gdy parametru nie było. */
export function bezParametruUi(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has('ui')) return null;
  u.searchParams.delete('ui');
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Start aplikacji (main.tsx, przed pierwszym renderem): wybór interfejsu, atrybut `data-ui` na <html> (style bazowe
 * nowego wyglądu bez mignięcia starego) i usunięcie `?ui=` z paska adresu, żeby skopiowany link nie przełączał wyglądu
 * innym. Zmiana interfejsu działa tylko przez wejście z parametrem (przeładowanie strony).
 */
export function ustawInterfejs(win: Window = window): Interfejs {
  let pamiec: Pamiec;
  try {
    pamiec = win.localStorage;
  } catch {
    pamiec = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
  const ui = wybierzInterfejs(win.location.search, pamiec);
  win.document.documentElement.dataset.ui = ui;
  const czysty = bezParametruUi(win.location.href);
  if (czysty !== null) {
    try {
      win.history.replaceState(win.history.state, '', czysty);
    } catch {
      // Bez zmiany adresu: parametr zostaje w pasku, wybór i tak jest już zapisany
    }
  }
  return ui;
}
