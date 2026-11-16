import { afterEach, describe, expect, it, vi } from 'vitest';
import { menuEntries } from '../indicators/registry';

/** Karty wskaźników (plan 59, F1): każdy wskaźnik z menu ma twierdzenie PL i EN i status; bez kierunku ceny i zaleceń. */

const S = vi.hoisted(() => ({ lang: 'pl' as 'pl' | 'en' }));
vi.mock('../../../i18n', async (orig) => {
  const m = await orig<typeof import('../../../i18n')>();
  return { ...m, tr: (pl: unknown, en: unknown) => (S.lang === 'pl' ? pl : en) };
});

const FORBIDDEN = /sygna[łl]|\bsignals?\b|wzrośnie|spadnie|kupuj|sprzedawaj|wejdź|\bgo long\b|\bgo short\b/i;

describe.each(['pl', 'en'] as const)('karty wskaźników (%s)', (lang) => {
  afterEach(() => vi.resetModules());

  it('każdy wskaźnik z menu (grupy i klasyczne) ma twierdzenie ≥ 20 znaków i status; teksty bez zakazanych słów', async () => {
    S.lang = lang;
    vi.resetModules();
    const { indicatorCard, STATUS_LABEL } = await import('../indicators/cards');
    const ids = [...menuEntries('front'), ...menuEntries('classic')].map((d) => d.id);
    expect(ids.length).toBe(27);
    for (const id of ids) {
      const c = indicatorCard(id);
      expect(c.claim.length, id).toBeGreaterThanOrEqual(20);
      expect(Object.keys(STATUS_LABEL), id).toContain(c.status);
      for (const t of [c.claim, c.noise ?? '']) expect(t, id).not.toMatch(FORBIDDEN);
    }
  });

  it('statusy z planu: Effort sprawdzony bez mocy, stożek i HIP-4 zapisywane przed faktem, klasyczne opis', async () => {
    S.lang = lang;
    vi.resetModules();
    const { indicatorCard } = await import('../indicators/cards');
    expect(indicatorCard('effort').status).toBe('bezMocy');
    expect(indicatorCard('cone').status).toBe('zapis');
    expect(indicatorCard('outcomes').status).toBe('zapis');
    expect(indicatorCard('ema').status).toBe('opis');
  });
});
