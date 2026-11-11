import { describe, expect, it } from 'vitest';
import { menuKey, openFocusIndex } from '../menuKeys';

describe('klawiatura listy rozwijanej', () => {
  it('strzałki chodzą po pozycjach z zawinięciem', () => {
    expect(menuKey('ArrowDown', 0, 3)).toEqual({ kind: 'move', to: 1 });
    expect(menuKey('ArrowDown', 2, 3)).toEqual({ kind: 'move', to: 0 });
    expect(menuKey('ArrowUp', 0, 3)).toEqual({ kind: 'move', to: 2 });
    expect(menuKey('ArrowUp', 2, 3)).toEqual({ kind: 'move', to: 1 });
  });

  it('fokus poza pozycjami: strzałka w dół na pierwszą, w górę na ostatnią', () => {
    expect(menuKey('ArrowDown', -1, 4)).toEqual({ kind: 'move', to: 0 });
    expect(menuKey('ArrowUp', -1, 4)).toEqual({ kind: 'move', to: 3 });
  });

  it('Home i End na skraj', () => {
    expect(menuKey('Home', 2, 5)).toEqual({ kind: 'move', to: 0 });
    expect(menuKey('End', 0, 5)).toEqual({ kind: 'move', to: 4 });
  });

  it('Escape zamyka i oddaje fokus przyciskowi, Tab zamyka bez cofania fokusu', () => {
    expect(menuKey('Escape', 1, 3)).toEqual({ kind: 'close', refocus: true });
    expect(menuKey('Tab', 1, 3)).toEqual({ kind: 'close', refocus: false });
    expect(menuKey('Escape', -1, 0)).toEqual({ kind: 'close', refocus: true });
  });

  it('inne klawisze i pusta lista: bez skutku', () => {
    expect(menuKey('a', 0, 3)).toBeNull();
    expect(menuKey('ArrowDown', 0, 0)).toBeNull();
  });

  it('po otwarciu fokus na zaznaczonej pozycji, bez niej na pierwszej', () => {
    expect(openFocusIndex([false, true, false])).toBe(1);
    expect(openFocusIndex([false, false])).toBe(0);
    expect(openFocusIndex([])).toBe(0);
  });
});
