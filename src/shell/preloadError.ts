/**
 * Rozjazd wersji po wdrożeniu: GitHub Pages podmienia całą stronę, więc karta otwarta przed wdrożeniem dostaje 404
 * przy pierwszym leniwym module (widok, wykresy) i pokazywała ekran błędu. Vite zgłasza to zdarzeniem
 * `vite:preloadError` (dokumentacja: „Load Error Handling”). Reakcja: jedno przeładowanie strony (nowa wersja);
 * znacznik w pamięci sesji z czasem przeładowania chroni przed pętlą, gdy błąd ma inną przyczynę.
 */
export const PRZELADOWANIE_KEY = 'hq.preloadReload.v1';
export const PRZERWA_MS = 60_000;

type Sesja = Pick<Storage, 'getItem' | 'setItem'>;

/** true = przeładowanie zlecone (błąd przechwycony); false = błąd idzie dalej do ekranu błędu. */
export function obsluzBladLadowania(e: { preventDefault: () => void }, sesja: Sesja, reload: () => void, now: number): boolean {
  try {
    const ost = Number(sesja.getItem(PRZELADOWANIE_KEY));
    if (Number.isFinite(ost) && ost > 0 && now - ost < PRZERWA_MS) return false;
    sesja.setItem(PRZELADOWANIE_KEY, String(now));
  } catch {
    return false;
  }
  e.preventDefault();
  reload();
  return true;
}

/** Podpięcie w main.tsx (raz, przed renderem). */
export function sluchajBledowLadowania(win: Window = window): void {
  win.addEventListener('vite:preloadError', (e) => {
    obsluzBladLadowania(e, win.sessionStorage, () => win.location.reload(), Date.now());
  });
}
