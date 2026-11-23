import { describe, expect, it } from 'vitest';
import { applyGridLayout, currentGridLayout, fromPreset, isPreset, makePanel } from '../composition';
import { exportWorkspaceComposition, importWorkspaceComposition } from '../../state/workspaceComposition';

describe('Stanowisko: wykresy i układy siatki', () => {
  it('siatka wykresów: cztery panele „chart” na żywo z rynkiem i interwałem, po 6 kolumn', () => {
    const d = fromPreset('charts', 'desk-0000abcd');
    expect(d.panels.map((p) => [p.kind, p.market, p.settings?.interval, p.clock.kind])).toEqual([
      ['chart', 'BTC', '1m', 'live'],
      ['chart', 'BTC', '15m', 'live'],
      ['chart', 'xyz:GOLD', '5m', 'live'],
      ['chart', 'xyz:SP500', '5m', 'live'],
    ]);
    expect(new Set(d.panels.map((p) => p.id)).size).toBe(4);
    expect(d.cards.map((c) => c.weight)).toEqual([6, 6, 6, 6]);
    expect(currentGridLayout(d)).toBe('grid');
    expect(isPreset('charts') && isPreset('chartflow')).toBe(true);
  });

  it('zapis i import zachowują interwał wykresu; nieznany interwał odrzuca import', () => {
    const d = fromPreset('chartflow', 'desk-0000abcd');
    const json = exportWorkspaceComposition(d)!;
    expect(json).toBeTruthy();
    const back = importWorkspaceComposition(json)!;
    expect(back.panels[0]).toMatchObject({ kind: 'chart', market: 'BTC', settings: { interval: '1m' } });
    expect(importWorkspaceComposition(json.replace('"interval":"1m"', '"interval":"7m"'))).toBeNull();
  });

  it('układy zmieniają tylko szerokości kart, w kolejności kart', () => {
    const d = fromPreset('charts', 'desk-0000abcd');
    expect(applyGridLayout(d, 'three').cards.map((c) => c.weight)).toEqual([4, 4, 4, 4]);
    expect(applyGridLayout(d, 'hero').cards.map((c) => c.weight)).toEqual([12, 6, 6, 6]);
    expect(applyGridLayout(d, 'focus').cards.map((c) => c.weight)).toEqual([8, 4, 8, 4]);
    expect(applyGridLayout(d, 'one').cards.map((c) => c.panels)).toEqual(d.cards.map((c) => c.panels));
    expect(currentGridLayout(applyGridLayout(d, 'hero'))).toBe('hero');
  });

  it('nowy panel wykresu: BTC 5m na żywo', () => {
    expect(makePanel('chart', 'chart-x')).toEqual({ id: 'chart-x', kind: 'chart', market: 'BTC', marketGroup: null, clock: { kind: 'live' }, settings: { interval: '5m' } });
  });
});

describe('Stanowisko w aplikacji: skoki bez zmiany trasy', () => {
  it('linki „#…” w Stanowisku mają onClick z preventDefault (zmiana adresu zamknęłaby widok i szkic)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/workbench/Workbench.tsx', 'utf8');
    const linki = [...src.matchAll(/href="#[^"]+"/g)].map((m) => src.slice(m.index!, m.index! + 220));
    expect(linki.length).toBeGreaterThan(0);
    for (const l of linki) expect(l).toContain('preventDefault');
  });
});

describe('Panel Wykres: tylko zegar na żywo', () => {
  it('import panelu „chart” z kursorem nagrania nie pokazuje danych na żywo', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/workbench/Panels.tsx', 'utf8');
    expect(src).toMatch(/panel\.kind === 'chart'\) return panel\.clock\.kind === 'live'/);
  });
});
