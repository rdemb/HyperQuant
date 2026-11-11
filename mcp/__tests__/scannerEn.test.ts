import { afterEach, describe, expect, it, vi } from 'vitest';

// Serwer po angielsku (domyślny język paczki bez HQ_LANG): język ustalany raz przy starcie modułu i18n
vi.mock('../../src/i18n', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/i18n')>();
  return { ...m, lang: 'en', locale: 'en-GB', tr: <T,>(_pl: T, en: T): T => en };
});

const { connect, testSources } = await import('./helpers');
const { COHORTS_URL, LEDGER_URL, LIQ_URL, NOW, TAPE, TAPE_URL, TW_NOW, WHALES_URL, allRoutes, cohortFlow, ledger, liqMap, twRoutes, whales } = await import('./scannerFixtures');
type Route = import('./helpers').Route;

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('narzędzia danych skanera po angielsku', () => {
  it('odpowiedź każdego narzędzia z fikstur (z opisami i uwagami po angielsku) przechodzi strażnika treści', async () => {
    for (const name of ['liquidation_map', 'liquidation_tape', 'cohort_flow', 'whales', 'twaps', 'forecast_ledger']) {
      const twap = name === 'twaps';
      const c = await connect(testSources(twap ? twRoutes() : allRoutes(), twap ? TW_NOW : NOW).src);
      close = c.close;
      const res = await c.client.callTool({ name, arguments: {} });
      expect(res.isError, `${name}: ${JSON.stringify(res.content)}`).toBeFalsy();
      // Teksty naprawdę po angielsku (uwagi koperty)
      const notes = (res.structuredContent as { notes: string[] }).notes.join(' ');
      expect(notes, name).not.toMatch(/[ąęłńśźż]/);
      if (name === 'cohort_flow') {
        expect(notes).toContain(
          'volumeShare = cohort buy+sell ÷ 2 × tape volume in the window (every trade has a buyer and a seller); cells hidden for privacy are combined in othersCombined, so the cohort shares and othersCombined add up to 1'
        );
        expect(JSON.stringify(res)).toContain('Others combined (hidden)');
      }
      if (name === 'twaps') {
        expect(JSON.stringify(res)).toContain('requires the live stream (planned)');
        expect(JSON.stringify(res)).not.toMatch(/1d-2|stage/);
      }
      await close();
      close = null;
    }
  });

  it('powody braku po angielsku (pliki niedostępne, nieaktualne, opóźnione) też przechodzą strażnika', async () => {
    const MIN = 60_000;
    const stale = allRoutes({
      [LIQ_URL]: { json: liqMap(11 * MIN) },
      [TAPE_URL]: { json: { ...TAPE, asOf: NOW - 12 * MIN } },
      [COHORTS_URL]: { json: cohortFlow(15 * MIN) },
      [WHALES_URL]: { json: whales(21 * MIN) },
      [LEDGER_URL]: { json: ledger(50 * MIN) },
    });
    const delayed = allRoutes({ [LIQ_URL]: { json: { ...liqMap(5 * MIN), ageMin: { p50: 20, p90: 30, ntlP50: 25 } } } });
    // Obserwacja krótsza niż doba (po restarcie skanera)
    const partial = allRoutes({ [TAPE_URL]: { json: { ...TAPE, since: NOW - 180 * MIN } }, [COHORTS_URL]: { json: { ...cohortFlow(), since: NOW - 180 * MIN } } });
    const cases: [string, Record<string, Route>, number][] = [
      ...['liquidation_map', 'liquidation_tape', 'cohort_flow', 'whales', 'forecast_ledger'].flatMap((n): [string, Record<string, Route>, number][] => [
        [n, {}, NOW],
        [n, stale, NOW],
      ]),
      ['liquidation_map', delayed, NOW],
      ['liquidation_tape', partial, NOW],
      ['cohort_flow', partial, NOW],
      ['twaps', {}, TW_NOW],
      ['twaps', twRoutes({ zeroKnownHour: false }), TW_NOW],
    ];
    for (const [name, routes, now] of cases) {
      const c = await connect(testSources(routes, now).src);
      close = c.close;
      const res = await c.client.callTool({ name, arguments: {} });
      expect(res.isError, `${name}: ${JSON.stringify(res.content)}`).toBeFalsy();
      await close();
      close = null;
    }
  });

  it('po angielsku: wiek danych dziennika prognoz („data from N min ago”) i kohorta w pełni ukryta („N cells hidden for privacy”)', async () => {
    const MIN = 60_000;
    const flow = cohortFlow();
    flow.totals.h1.rest = { buy: 0, sell: 0, takerBuy: 0, takerSell: 0, hidden: 3, takerHidden: 0 };
    const c = await connect(testSources(allRoutes({ [LEDGER_URL]: { json: ledger(50 * MIN) }, [COHORTS_URL]: { json: flow } }), NOW).src);
    close = c.close;
    const led = (await c.client.callTool({ name: 'forecast_ledger', arguments: {} })).structuredContent as { data: { returns: { crpss: { note?: string } }[] } };
    expect(led.data.returns[0].crpss.note).toBe(`data from 50 min ago (as of ${new Date(NOW - 50 * MIN).toISOString()})`);
    const co = (await c.client.callTool({ name: 'cohort_flow', arguments: {} })).structuredContent as { data: { h1: { cohorts: { net: { why: string | null }; volume: { note?: string } }[] } } };
    expect(co.data.h1.cohorts[3].net.why).toBe('3 cells hidden for privacy');
    expect(co.data.h1.cohorts[2].volume.note).toBe('1 cell hidden for privacy (not included)');
  });

  it('tools/list: opisy narzędzi po angielsku', async () => {
    const c = await connect(testSources({}, NOW).src);
    close = c.close;
    const { tools } = await c.client.listTools();
    for (const t of tools) expect(t.description ?? '', t.name).not.toMatch(/[ąęłńśźż]/);
  });
});
