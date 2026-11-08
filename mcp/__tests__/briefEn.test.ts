import { afterEach, describe, expect, it, vi } from 'vitest';

// Serwer po angielsku (domyślny język paczki bez HQ_LANG): język ustalany raz przy starcie modułu i18n
vi.mock('../../src/i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/i18n')>();
  return { ...m, lang: 'en', locale: 'en-GB', tr: <T,>(_pl: T, en: T): T => en };
});

const { connect, testSources } = await import('./helpers');
const { NOW, mapsJson, routes, todayMap } = await import('./briefFixtures');
const { fmtHm } = await import('../../src/charts/pro/core/time');

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('market_brief po angielsku', () => {
  it('odpowiedź z pełnych danych (Czwórka, poziomy, uwagi po angielsku) przechodzi strażnika treści', async () => {
    const c = await connect(testSources(routes(), NOW).src);
    close = c.close;
    const res = await c.client.callTool({ name: 'market_brief', arguments: {} });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const env = res.structuredContent as { notes: string[]; data: { four: { title: string; hint: string; text: string }[]; levels: { label: string | null }[] } };
    expect(env.notes.join(' ')).not.toMatch(/[ąęłńśźż]/);
    expect(env.data.four.map((i) => i.title)).toEqual(["Yesterday's clarity", 'Fuel ±1%', `Width · London ${fmtHm(Date.UTC(2026, 10, 7, 8))}`, 'From VWAP']);
    for (const i of env.data.four) expect(i.text).not.toBe('—');
    expect(env.data.levels.map((l) => l.label)).toContain('Prev. session VAH');
  });

  it('etykieta z radą po angielsku: label null z powodem po angielsku, bez isError', async () => {
    const c = await connect(testSources(routes({ maps: { json: mapsJson(todayMap(['Buy the dip', 'Support'])) } }), NOW).src);
    close = c.close;
    const res = await c.client.callTool({ name: 'market_brief', arguments: {} });
    expect(res.isError).toBeFalsy();
    const levels = (res.structuredContent as { data: { levels: { label: string | null; labelWhy: string | null }[] } }).data.levels;
    const held = levels.find((l) => l.label === null);
    expect(held?.labelWhy).toMatch(/^label withheld by the content guards/);
    expect(JSON.stringify(res)).not.toMatch(/buy the dip/i);
  });
});
