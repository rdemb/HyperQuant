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
