import { describe, expect, it, vi } from 'vitest';

// Strona po angielsku: język ustalany raz przy starcie modułu i18n
vi.mock('../../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../../i18n')>();
  return { ...m, lang: 'en', tr: <T,>(_pl: T, en: T): T => en };
});

const { LABELS } = await import('../renderer');
const { defaultText } = await import('../../pro/draw/model');

describe('podpisy płótna i domyślny tekst rysunku w wersji angielskiej', () => {
  it('legenda CVD, delty i start zapisu bez polskich słów', () => {
    expect(LABELS).toEqual({
      recStart: 'recording since',
      cvd: 'HL aggressor CVD · BTC',
      cvdLast: 'last',
      cvdWait: 'HL aggressor CVD · waiting for trades',
      delta: 'Candle Δ · BTC',
      buy: '+ buy',
      sell: '− sell',
    });
    for (const v of Object.values(LABELS)) expect(v).not.toMatch(/[ąćęłńóśźż]|kupno|zapisu|czekam|ostatnio/i);
  });

  it('nowy tekst i notatka dostają angielski tekst, inne narzędzia żadnego', () => {
    expect(defaultText('text')).toBe('Text');
    expect(defaultText('note')).toBe('Note');
    expect(defaultText('trend')).toBeUndefined();
  });
});
