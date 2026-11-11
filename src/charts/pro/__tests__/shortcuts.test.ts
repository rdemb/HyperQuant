import { describe, expect, it } from 'vitest';
import { chartKeyAction, workspaceKeyAction } from '../chart/shortcuts';

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; code: string }> = {}) => ({
  key,
  code: mods.code ?? (/^\d$/.test(key) ? `Digit${key}` : key.length === 1 ? `Key${key.toUpperCase()}` : key),
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

/**
 * Mapa skrótów klawiszowych wykresu i miejsca pracy — ta sama co przed przeniesieniem przycisków do list rozwijanych
 * (lista „?” w menu wykresu). Zmiana któregokolwiek skrótu musi świadomie zmienić ten test.
 */
describe('skróty klawiszowe bez zmian', () => {
  it('wykres: cyfry 1…9, 0 to kolejne interwały', () => {
    expect([...'1234567890'].map((d) => chartKeyAction(k(d)))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => ({ kind: 'interval', index })));
  });

  it('wykres: litery, End, ? i /', () => {
    const map = Object.fromEntries(['?', '/', 'End', 'c', 'C', 't', 'm', 'r', 'a', 'f', 'F'].map((key) => [key, chartKeyAction(k(key))?.kind ?? null]));
    expect(map).toEqual({
      '?': 'keys',
      '/': 'indicators',
      End: 'now',
      c: 'view',
      C: 'view',
      t: 'tape',
      m: 'market',
      r: 'reset',
      a: 'autoscale',
      f: 'fullscreen',
      F: 'fullscreen',
    });
  });

  it('wykres: inne klawisze i każdy z Ctrl, Cmd albo Alt — bez skutku', () => {
    for (const key of ['b', 'd', 'x', 'Home', 'ArrowUp', 'Escape', '-']) expect(chartKeyAction(k(key)), key).toBeNull();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) for (const key of ['1', 'c', '?', 'End']) expect(chartKeyAction(k(key, { [mod]: true })), `${mod}+${key}`).toBeNull();
  });

  it('miejsce pracy: D — kolumna DOM i taśmy; Alt+1…9 — układy i karty; Alt+↑/↓ — interwał karty', () => {
    expect(workspaceKeyAction(k('d'))).toEqual({ kind: 'dock' });
    expect(workspaceKeyAction(k('D'))).toEqual({ kind: 'dock' });
    for (let d = 1; d <= 9; d++) expect(workspaceKeyAction(k(String(d), { altKey: true }))).toEqual({ kind: 'tab', digit: d });
    // Alt z cyfrą liczy się po kodzie klawisza (układ klawiatury zmienia `key`)
    expect(workspaceKeyAction(k('¡', { altKey: true, code: 'Digit1' }))).toEqual({ kind: 'tab', digit: 1 });
    expect(workspaceKeyAction(k('ArrowUp', { altKey: true }))).toEqual({ kind: 'ladder', dir: 1 });
    expect(workspaceKeyAction(k('ArrowDown', { altKey: true }))).toEqual({ kind: 'ladder', dir: -1 });
  });

  it('miejsce pracy: bez skutku — Alt+0, Alt+litera, D z Alt, każdy z Ctrl albo Cmd, inne litery', () => {
    expect(workspaceKeyAction(k('0', { altKey: true }))).toBeNull();
    expect(workspaceKeyAction(k('d', { altKey: true }))).toBeNull();
    expect(workspaceKeyAction(k('x'))).toBeNull();
    expect(workspaceKeyAction(k('ArrowUp'))).toBeNull();
    for (const mod of ['ctrlKey', 'metaKey'] as const) {
      expect(workspaceKeyAction(k('d', { [mod]: true }))).toBeNull();
      expect(workspaceKeyAction(k('3', { [mod]: true, altKey: true }))).toBeNull();
    }
  });
});
