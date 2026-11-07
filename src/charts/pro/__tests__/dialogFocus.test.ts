import { describe, expect, it, vi } from 'vitest';
import { dialogKeyDown, holdFocus, tabTarget } from '../chart/dialogFocus';

const el = (name: string) => ({ name, focus: vi.fn() });
const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, preventDefault: vi.fn() });

describe('okno Klatki: fokus', () => {
  it('fokus wraca do przycisku, który otworzył okno', () => {
    const opener = el('Klatka');
    const dialog = el('okno');
    const release = holdFocus({ activeElement: opener }, dialog);
    expect(dialog.focus).toHaveBeenCalledTimes(1);
    expect(opener.focus).not.toHaveBeenCalled();
    release();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('otwierający element usunięty z dokumentu (menu „Więcej”) — bez błędu i bez fokusu na nim', () => {
    const gone = { ...el('pozycja menu'), isConnected: false };
    holdFocus({ activeElement: gone }, el('okno'))();
    expect(gone.focus).not.toHaveBeenCalled();
    expect(() => holdFocus({ activeElement: null }, null)()).not.toThrow();
  });

  it('Klatka z menu „Więcej” na telefonie: pozycji menu już nie ma — fokus na przycisk „Więcej” (zapas), nie na dokument', () => {
    const more = el('Więcej');
    // Menu znika w tym samym renderze, w którym otwiera się okno: aktywny jest wtedy sam dokument (body)
    const body = el('body');
    holdFocus({ activeElement: body, body }, el('okno'), () => more)();
    expect(more.focus).toHaveBeenCalledTimes(1);
    expect(body.focus).not.toHaveBeenCalled();
    // Pozycja menu odpięta do chwili zamknięcia — też zapas
    const gone = { ...el('pozycja menu'), isConnected: false };
    const more2 = el('Więcej');
    holdFocus({ activeElement: gone }, el('okno'), () => more2)();
    expect(more2.focus).toHaveBeenCalledTimes(1);
    // Otwierający przycisk jest — zapas nieużyty
    const opener = el('Klatka');
    const spare = el('Więcej');
    holdFocus({ activeElement: opener, body }, el('okno'), () => spare)();
    expect([opener.focus.mock.calls.length, spare.focus.mock.calls.length]).toEqual([1, 0]);
    // Zapas bez elementu (przycisk schowany) — bez błędu
    expect(() => holdFocus({ activeElement: body, body }, el('okno'), () => null)()).not.toThrow();
  });

  it('Tab z ostatniego wraca na pierwszy, Shift+Tab z pierwszego na ostatni', () => {
    const [a, b, c] = [el('zamknij'), el('tytuł'), el('pobierz')];
    const items = [a, b, c];
    const tab = key('Tab');
    expect(dialogKeyDown(tab, items, c, vi.fn())).toBe(true);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(a.focus).toHaveBeenCalledTimes(1);
    const back = key('Tab', true);
    expect(dialogKeyDown(back, items, a, vi.fn())).toBe(true);
    expect(c.focus).toHaveBeenCalledTimes(1);
  });

  it('Tab w środku listy — zwykły ruch przeglądarki; z samego okna — na skrajny element', () => {
    const [a, b, c] = [el('a'), el('b'), el('c')];
    const mid = key('Tab');
    expect(dialogKeyDown(mid, [a, b, c], b, vi.fn())).toBe(false);
    expect(mid.preventDefault).not.toHaveBeenCalled();
    expect(tabTarget([a, b, c], null, false)).toBe(a);
    expect(tabTarget([a, b, c], el('okno'), true)).toBe(c);
    expect(tabTarget([], a, false)).toBeNull();
  });

  it('Escape zamyka okno', () => {
    const onClose = vi.fn();
    const esc = key('Escape');
    expect(dialogKeyDown(esc, [el('a')], null, onClose)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogKeyDown(key('a'), [el('a')], null, onClose)).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
