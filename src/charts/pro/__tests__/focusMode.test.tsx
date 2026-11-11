import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FocusExit, focusExitKey, focusOn } from '../chart/focusMode';

describe('tryb skupienia na telefonie', () => {
  it('wejście w skupienie (z „⋯” albo dotknięciem) pokazuje kartę „Wykres” — Liczby i DOM nie leżą na wykresie', () => {
    for (const tab of ['chart', 'tape', 'dom', 'numbers'] as const) expect(focusOn(tab)).toEqual({ focus: true, tab: 'chart' });
  });

  it('Escape kończy skupienie (także poziomo), inne klawisze i Escape bez skupienia — nie', () => {
    expect(focusExitKey('Escape', true)).toBe(true);
    expect(focusExitKey('Escape', false)).toBe(false);
    expect(focusExitKey('Enter', true)).toBe(false);
  });

  it('w skupieniu stały przycisk wyjścia: prawdziwy przycisk z nazwą dla czytnika ekranu i celem dotyku 44 px', () => {
    const html = renderToStaticMarkup(<FocusExit onExit={() => {}} />);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-label="Zamknij tryb skupienia (Esc)"');
    expect(html).toMatch(/w-11 h-11/);
  });
});
