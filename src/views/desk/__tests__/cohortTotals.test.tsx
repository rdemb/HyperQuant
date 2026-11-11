import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CohortFlow, CohortTotal } from '../../../utils/cohorts';

const T = (buy: number, sell: number, hidden = 0): CohortTotal => ({ buy, sell, takerBuy: buy / 2, takerSell: sell / 2, hidden, takerHidden: 0 });
const NOW = Date.UTC(2026, 10, 7, 13, 0);
const markout = { hours: 0, hiddenHours: 0, m1: null, m5: null, m60: null };
// Poinformowani bez żadnej transakcji w 24 h (adresy < 10); wieloryby z prawdziwym zerowym przepływem (kupno = sprzedaż > 0)
const FLOW: CohortFlow = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - 60_000,
  since: NOW - 4 * 3_600_000,
  bucketMin: 15,
  buckets: [],
  totals: {
    h1: { mm: T(2e6, 1e6), informed: T(0, 0), whale: T(5e5, 1e5), rest: T(1e6, 2e6) },
    h24: { mm: T(4e7, 3e7), informed: T(0, 0), whale: T(1e7, 1e7), rest: T(3e7, 5e7) },
  },
  // Widoczne kupno 80 mln + ukryte 13 mln = widoczna sprzedaż 90 mln + ukryte 3 mln = wolumen taśmy 93 mln
  tape: { h1: null, h24: { volume: 9.3e7, hidden: { buy: 1.3e7, sell: 3e6, takerBuy: 6e6, takerSell: 2e6 } } },
  members: { mm: 210, informed: 0, whale: 100, rest: 18_380 },
  informed: { candidates: 2470, selected: 0, fdrQ: 0.1, minN: 30, mu0Bp: null, tauBp: null, classifiedAt: NOW - 3_600_000 },
  oos: { mm: markout, informed: markout, whale: markout, rest: markout },
  kMin: 5,
  method: 'hl-cohorts-v1',
};

vi.mock('../../../state/useCohortFlow', () => ({ useCohortFlow: () => ({ status: 'ready', flow: FLOW }) }));

describe('Przepływ kohort: brak danych to „—”, nie zero', () => {
  it('kohorta bez transakcji w 24 h ma w tabeli „—” zamiast $0 (jak na karcie)', async () => {
    const { CohortFlowPanel } = await import('../CohortFlowPanel');
    const html = renderToStaticMarkup(<CohortFlowPanel coin="BTC" />);
    // Wiersze tabeli sum 24 h (pierwsza tabela z treścią)
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    const rows = body.split('<tr').filter((r) => r.includes('Poinformowani'));
    expect(rows.length).toBeGreaterThan(0);
    const totals = rows[0];
    expect(totals).not.toContain('$0');
    expect((totals.match(/>—</g) ?? []).length).toBeGreaterThanOrEqual(3);
    // Aktywna kohorta dalej z liczbami
    const mm = body.split('<tr').find((r) => r.includes('Market makerzy'))!;
    expect(mm).toContain('+$10');
    // Prawdziwe zero (kupno = sprzedaż > 0) zostaje zerem: netto i agresor $0, obrót 20 mln
    const whale = body.split('<tr').find((r) => r.includes('Wieloryby'))!;
    expect(whale.split('>$0<').length - 1).toBe(2);
    expect(whale).toContain('$20');
  }, 20_000); // dynamiczny import panelu (cały moduł widoku) bywa wolniejszy niż 5 s przy pełnym obciążeniu CI

  it('kohorta ze wszystkimi komórkami ukrytymi: „—” zamiast $0 w tabeli i na karcie, liczba ukrytych zostaje', async () => {
    const { CohortFlowPanel } = await import('../CohortFlowPanel');
    const keep = { h1: FLOW.totals.h1.whale, h24: FLOW.totals.h24.whale };
    FLOW.totals.h1.whale = T(0, 0, 4);
    FLOW.totals.h24.whale = T(0, 0, 62);
    try {
      const html = renderToStaticMarkup(<CohortFlowPanel coin="BTC" />);
      const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
      const whale = body.split('<tr').find((r) => r.includes('Wieloryby'))!;
      expect(whale).not.toContain('$0');
      expect((whale.match(/>—</g) ?? []).length).toBe(3);
      expect(whale).toContain('62 / 0');
      expect(html.slice(0, html.indexOf('<tbody'))).not.toMatch(/Wieloryby.{0,400}>\$0</);
    } finally {
      FLOW.totals.h1.whale = keep.h1;
      FLOW.totals.h24.whale = keep.h24;
    }
  }, 20_000);

  it('ukryte komórki jako jeden wiersz „Pozostali razem”; pusta kohorta „poinformowanych” — „nie wykryto” z liczbą sprawdzonych', async () => {
    const { CohortFlowPanel } = await import('../CohortFlowPanel');
    const html = renderToStaticMarkup(<CohortFlowPanel coin="BTC" />);
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    const others = body.split('<tr').find((r) => r.includes('Pozostali razem'));
    expect(others).toBeDefined();
    // Netto +10 mln, agresor +4 mln, obrót 16 mln
    expect(others).toContain('+$10');
    expect(others).toContain('+$4');
    expect(others).toContain('$16');
    expect(html).toContain('nie wykryto kont z trwałą przewagą (≈ 2470 sprawdzonych)');
  }, 20_000);
});
