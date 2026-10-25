import { describe, expect, it } from 'vitest';
import { detectLang, lang, tr } from '../i18n';
import { fmtPx } from '../charts/pro/chart/layout';
import { fmtNum, numLang } from '../ui/format';

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

describe('numLang', () => {
  it('po polsku spacja tysięcy i przecinek dziesiętny — przecinek ma jedno znaczenie', () => {
    expect(numLang('80,768.5')).toBe('80\u00a0768,5');
    expect(numLang('+1.2K')).toBe('+1,2K');
    expect(numLang('—')).toBe('—');
    expect(fmtPx(80_768.4)).toBe('80\u00a0768');
    expect(fmtNum(-3.85)).toBe('−3,85');
  });
});
