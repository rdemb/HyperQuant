/**
 * Fokus okna modalnego (Klatka): przy otwarciu zapamiętuje element aktywny i oddaje mu fokus przy zamknięciu, Tab i
 * Shift+Tab krążą między pierwszym i ostatnim elementem okna, Escape zamyka. Sygnatury bez typów DOM — testy na atrapach.
 */

export interface Focusable {
  focus(): void;
}

/** Elementy okna, do których prowadzi Tab (wyłączone pola i radia z tabIndex −1 odpadają). */
export const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Element, na który przenieść fokus po Tab (`shift` — wstecz): z ostatniego na pierwszy, z pierwszego na ostatni, spoza
 * listy (np. samo okno) na skrajny w kierunku ruchu; w środku listy — null (ruch zwykły, przeglądarka).
 */
export function tabTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const i = active === null ? -1 : items.indexOf(active);
  if (i < 0) return shift ? last : first;
  if (shift && i === 0) return last;
  if (!shift && i === items.length - 1) return first;
  return null;
}

export interface DialogKey {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

/** Klawisz w oknie: Escape — `onClose`, Tab na krawędzi listy — zawinięcie (`tabTarget`); true, gdy obsłużony. */
export function dialogKeyDown<T extends Focusable>(e: DialogKey, items: readonly T[], active: T | null, onClose: () => void): boolean {
  if (e.key === 'Escape') {
    e.preventDefault();
    onClose();
    return true;
  }
  if (e.key !== 'Tab') return false;
  const target = tabTarget(items, active, e.shiftKey);
  if (!target) return false;
  e.preventDefault();
  target.focus();
  return true;
}

/**
 * Zapamiętuje element aktywny dokumentu i przenosi fokus na `target`; zwrócona funkcja oddaje fokus zapamiętanemu
 * elementowi, jeśli jest jeszcze w dokumencie. Gdy go nie ma (okno otwarte z menu, które zniknęło razem z kliknięciem,
 * więc aktywny był sam dokument, albo element odpięty do chwili zamknięcia) — elementowi z `fallback`, np. przyciskowi
 * „Więcej” na telefonie.
 */
export function holdFocus(doc: { activeElement: unknown; body?: unknown }, target: Focusable | null, fallback?: () => Focusable | null | undefined): () => void {
  const opener = doc.activeElement as (Partial<Focusable> & { isConnected?: boolean }) | null;
  target?.focus();
  return () => {
    if (opener && opener !== doc.body && opener.isConnected !== false && typeof opener.focus === 'function') opener.focus();
    else fallback?.()?.focus();
  };
}
