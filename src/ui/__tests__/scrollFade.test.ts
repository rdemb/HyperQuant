import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fadeEdge } from '../scrollFade';

describe('podpowiedź przewijania rzędu w bok', () => {
  it('treść mieści się — bez wygaszenia', () => {
    expect(fadeEdge(0, 374, 374)).toBe('none');
    expect(fadeEdge(0, 374, 375)).toBe('none');
  });

  it('treść za prawą krawędzią (pasek telefonu 390 px na starcie) — wygasza się prawa', () => {
    expect(fadeEdge(0, 374, 420)).toBe('right');
  });

  it('w środku — obie, na końcu — lewa', () => {
    expect(fadeEdge(20, 374, 420)).toBe('both');
    expect(fadeEdge(46, 374, 420)).toBe('left');
  });

  it('pasek narzędzi telefonu i rząd liczb nagłówka używają podpowiedzi', () => {
    expect(readFileSync('src/charts/pro/ProChart.tsx', 'utf8')).toMatch(/ref=\{scrollFadeRef\}[^>]*hq-fade-x|hq-fade-x[^>]*ref=\{scrollFadeRef\}/);
    expect(readFileSync('src/charts/pro/chart/LayoutHeader.tsx', 'utf8')).toMatch(/ref=\{scrollFadeRef\}[^>]*hq-fade-x|hq-fade-x[^>]*ref=\{scrollFadeRef\}/);
    const css = readFileSync('src/index.css', 'utf8');
    for (const e of ['left', 'right', 'both']) expect(css).toContain(`.hq-fade-x[data-fade='${e}']`);
  });
});
