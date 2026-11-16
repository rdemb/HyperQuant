import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoScannerNote } from '../SessionView';

describe('W sesji: rynek bez skanera', () => {
  it('złoto: jedno zdanie zamiast pustych kart BTC, z tym, co jest na żywo, i powodem braku historii', () => {
    const html = renderToStaticMarkup(<NoScannerNote coin="xyz:GOLD" />);
    expect(html).toContain('tylko dla BTC');
    expect(html).toContain('Dla złota masz na żywo taśmę');
    expect(html).toContain('Zapisu taśmy na serwerze dla tego rynku jeszcze nie ma');
    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(/\d/);
  });

  it('S&P 500: nazwa rynku z konfiguracji', () => {
    expect(renderToStaticMarkup(<NoScannerNote coin="xyz:SP500" />)).toContain('Dla S&amp;P 500 masz');
  });
});
