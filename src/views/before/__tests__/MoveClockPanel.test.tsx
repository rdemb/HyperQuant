import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { guardHits } from '../../../utils/safeguards.mjs';

/**
 * Zegar ruchu w „Przed sesją” przed awansem kalibracji: najbliższa godzina jako poziom bez procentu (tercyl z 14 dni),
 * obok AUC z rejestru i zdanie o kalibracji; godziny 2–24 jako baza sezonowa „k z n dni”; brak danych — „—” z powodem;
 * bez słów rady i kierunku (PL i EN).
 */

const S = vi.hoisted(() => ({ lang: 'pl' as 'pl' | 'en', summary: null as unknown }));
vi.mock('../../../i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../../i18n')>();
  return { ...m, tr: <T,>(pl: T, en: T): T => (S.lang === 'en' ? en : pl) };
});
vi.mock('../../../state/useDeskLedger', () => ({ useDeskLedger: () => ({ status: S.summary ? 'ready' : 'loading', summary: S.summary }) }));

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 12, 9, 20);
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const cells = (k: number) => Array.from({ length: 24 }, (_, h) => ({ k: h === 14 ? 19 : k, n: 20 }));
const head = { brier: 0.15, brierBase: 0.24, bss: 0.38, auc: 0.878, hit: 0.76 };
/** Sekcja kota podsumowania przechodząca strażnika `isCat` */
const cat = (over: Record<string, unknown> = {}) => ({
  model: 'schrodi-v1',
  since: NOW - 14 * 24 * 60 * MIN,
  issued: 1300,
  slots: 1310,
  latest: { t: NOW - 10 * MIN, px0: 100_000, pUp: 0.5, pBig: 0.4321, thr: 40 },
  scores: {
    n: 1300,
    nEff: 330,
    dir: { ...head, auc: 0.52, long: { n: 1, hit: 0.5 }, short: { n: 1, hit: 0.5 }, unsure: 1 },
    big: { ...head, reliability: [] },
  },
  clock: { terciles: { q1: 0.3, q2: 0.6, n: 1320 }, season: { weekday: cells(7), weekend: cells(2) } },
  ...over,
});

async function html(): Promise<string> {
  vi.resetModules();
  const { MoveClockPanel } = await import('../MoveClockPanel');
  return renderToStaticMarkup(<MoveClockPanel />);
}
const text = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe.each(['pl', 'en'] as const)('Zegar ruchu (%s)', (lang) => {
  it('najbliższa godzina: poziom bez procentu, AUC z rejestru i zdanie o kalibracji; godziny 2–24: k z n dni', async () => {
    S.lang = lang;
    S.summary = { cat: cat() };
    const t = text(await html());
    const nearest = t.slice(0, t.indexOf(lang === 'en' ? 'Hours 2–24' : 'Godziny 2–24'));
    expect(nearest).not.toContain('%');
    expect(nearest).not.toContain('43');
    expect(nearest).toContain(lang === 'en' ? 'typical' : 'zwykły');
    expect(nearest).toContain(lang === 'en' ? 'AUC 0.88' : 'AUC 0,88');
    expect(nearest.toLowerCase()).toContain(lang === 'en' ? 'percentages under calibration' : 'procenty w trakcie kalibracji');
    // 23 godziny bazy sezonowej (czwartek): 14:00 UTC — 19 z 20 dni
    expect((t.match(lang === 'en' ? /\d+ of 20 days/g : /\d+ z 20 dni/g) ?? []).length).toBe(23);
    expect(t).toContain(lang === 'en' ? '19 of 20 days' : '19 z 20 dni');
    expect(t).toContain(lang === 'en' ? 'seasonal base' : 'baza sezonowa');
    // Strażniki rady i kierunku (bez reguł stylu wpisów: „—” to tu symbol braku danych)
    expect(guardHits(t).filter((h: { guard: { kind: string } }) => h.guard.kind !== 'style')).toEqual([]);
  });

  it('brak danych: „—” z powodem (za mało prognoz z 14 dni, stara prognoza, brak sekcji zegara)', async () => {
    S.lang = lang;
    S.summary = { cat: cat({ clock: { terciles: null, season: { weekday: cells(7), weekend: cells(2) } } }) };
    let t = text(await html());
    expect(t).toContain('—');
    expect(t).toContain(lang === 'en' ? 'too few resolved cat forecasts' : 'za mało rozstrzygniętych prognoz kota');
    S.summary = { cat: cat({ latest: { t: NOW - 2 * 60 * MIN, px0: 1, pUp: 0.5, pBig: 0.4, thr: 40 } }) };
    t = text(await html());
    expect(t).toContain(lang === 'en' ? 'older than 45 min' : 'starsza niż 45 min');
    S.summary = { cat: cat({ clock: undefined }) };
    t = text(await html());
    expect(t).toContain(lang === 'en' ? 'no clock section in the ledger summary' : 'brak sekcji zegara w podsumowaniu rejestru');
    expect(t).not.toMatch(/\d+ z 20 dni|\d+ of 20 days/);
  });
});
