import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLang, lang, tr } from '../i18n';
import { fmtPx } from '../charts/pro/chart/layout';
import { fmtFixed, fmtNum, numLang } from '../ui/format';

describe('detectLang', () => {
  it('używa zapisanego wyboru na zwykłym adresie', () => {
    expect(detectLang('en')).toBe('en');
    expect(detectLang('pl')).toBe('pl');
  });

  it('jawny język adresu wygrywa dla tej strony', () => {
    expect(detectLang('en', 'pl')).toBe('pl');
    expect(detectLang('pl', 'en')).toBe('en');
    expect(detectLang('pl', 'fr')).toBe('pl');
  });

  it('brak wyboru lub błędny zapis oznacza angielski', () => {
    expect(detectLang(null)).toBe('en');
    expect(detectLang('de')).toBe('en');
  });
});

describe('język w przeglądarce', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(['/', '/#charts', '/#orderflow?m=BTC'])('otwiera %s po angielsku przy polskich ustawieniach', async (path) => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { language: 'pl-PL', languages: ['pl-PL', 'en-GB'] });
    vi.stubGlobal('window', {
      location: new URL(path, 'https://example.test'),
      localStorage: { getItem: () => null },
    });
    vi.resetModules();
    expect((await import('../i18n')).lang).toBe('en');
  });

  it('po zmianie języka zachowuje pozostałe parametry i widok', async () => {
    const setItem = vi.fn();
    const replace = vi.fn();
    const url = new URL('https://example.test/?lang=pl&layout=wide#orderflow?m=GOLD');
    vi.stubGlobal('document', {});
    vi.stubGlobal('window', {
      location: { href: url.href, search: url.search, replace },
      localStorage: { getItem: () => 'en', setItem },
    });
    vi.resetModules();
    const i18n = await import('../i18n');
    expect(i18n.lang).toBe('pl');
    expect(setItem).not.toHaveBeenCalled();
    i18n.setLang('en');
    expect(setItem).toHaveBeenCalledWith('hq.lang', 'en');
    expect(replace).toHaveBeenCalledWith('https://example.test/?layout=wide#orderflow?m=GOLD');
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
    expect(fmtFixed(-23.84, 1)).toBe('−23,8');
    expect(fmtFixed(18_048.66, 1)).toBe('18\u00a0048,7');
  });
});
