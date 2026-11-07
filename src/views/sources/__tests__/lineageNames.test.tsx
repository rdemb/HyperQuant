import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LineageTable } from '../LineageTable';

describe('Źródła: rodowód liczb', () => {
  it('miejsce liczby to nowa nazwa widoku („W sesji”), nie dawna zakładka „Wykresy”', () => {
    const html = renderToStaticMarkup(<LineageTable />);
    expect(html).not.toMatch(/\(Wykresy\)|, Wykresy\)|na Wykresach/);
    expect(html).toContain('Footprint, świece delty, CVD (W sesji)');
  });
});
