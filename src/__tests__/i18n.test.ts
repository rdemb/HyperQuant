import { describe, expect, it } from 'vitest';
import { detectLang, lang, tr } from '../i18n';

describe('detectLang', () => {
  it('zapisany wybór ma pierwszeństwo przed przeglądarką', () => {
    expect(detectLang('en', ['pl-PL'])).toBe('en');
    expect(detectLang('pl', ['en-US'])).toBe('pl');
  });

  it('bierze pierwszy polski lub angielski język przeglądarki', () => {
    expect(detectLang(null, ['pl-PL', 'en-US'])).toBe('pl');
    expect(detectLang(null, ['de-DE', 'en-GB', 'pl'])).toBe('en');
    expect(detectLang(null, ['fr', 'PL'])).toBe('pl');
  });

  it('inne języki i błędny zapis → angielski', () => {
    expect(detectLang(null, ['de-DE', 'fr-FR'])).toBe('en');
    expect(detectLang(null, [])).toBe('en');
    expect(detectLang('de', ['es'])).toBe('en');
  });
});

describe('tr', () => {
  it('poza przeglądarką zwraca polski tekst', () => {
    expect(lang).toBe('pl');
    expect(tr('Plan', 'Plan EN')).toBe('Plan');
  });
});
