import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeskLedgerSummary, RetScores } from '../../../utils/deskLedger';
import { RetCard } from '../DeskLedgerPanel';

const TAUS = [0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.975];
const r: DeskLedgerSummary['latest']['ret'][number] = {
  t: 0,
  h: 60,
  px0: 100_000,
  taus: TAUS,
  q: TAUS.map((t) => (t - 0.5) / 100),
  bq: TAUS.map((t) => (t - 0.5) / 50),
  aci: { alpha: 0.08, alphaNow: 0.09, lo: -0.006, hi: 0.006 },
};
const cov = (rate: number) => ({ rate, n: 400, nEff: 100, kupiecP: 0.4 });
const sc: RetScores = { n: 400, crps: 0.003, crpsBench: 0.0032, crpss: 0.05, pitHist: Array(10).fill(40), cov90: cov(0.88), cov60: cov(0.6), covAci: cov(0.9) };

describe('Dziennik desku: karta zwrotu — opis ACI', () => {
  it('pokrycie ACI opisane wprost jako 90% z konstrukcji, z udziałem nieskończonych przedziałów', () => {
    const html = renderToStaticMarkup(<RetCard r={r} sc={{ ...sc, aciInf: { n: 400, inf: 6, share: 0.015 } }} />);
    expect(html).toContain('90% z konstrukcji');
    expect(html).toContain('nieskończony w 1,5%');
    expect(html).not.toContain('korekta online');
  });
  it('starsze podsumowanie bez udziału nieskończonych: sam opis konstrukcji', () => {
    const html = renderToStaticMarkup(<RetCard r={r} sc={sc} />);
    expect(html).toContain('90% z konstrukcji');
    expect(html).not.toContain('nieskończony w');
  });
});
