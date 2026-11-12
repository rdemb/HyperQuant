import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isAbC, type DeskLedgerSummary } from '../../../utils/deskLedger';
import { ModelAbCard } from '../ModelAbCard';
import { ModelAbCCard } from '../ModelAbCCard';

const D = 86_400_000;
const E = Date.UTC(2026, 9, 23);
const abC: NonNullable<DeskLedgerSummary['abC']> = {
  h: 60,
  model: 'ledger-har-fhs-rvmix-v1',
  plan: 'ab-v2',
  blockDays: 14,
  registeredAt: E + 27 * D,
  firstBlock: E + 28 * D,
  current: { start: E + 42 * D, end: E + 56 * D, n: 300, crpsA: 0.0019, crpsB: 0.00185, diff: null },
  closing: null,
  last: { start: E + 28 * D, end: E + 42 * D, n: 1300, crpsA: 0.0019, crpsB: 0.00186, diff: { d: -0.00004, lo: -0.00007, hi: -0.00001 }, cal: { n: 325, cov60: 0.612, cov90: 0.895 } },
  latest: { t: E + 43 * D, x: 0.42, rv60: 2.5e-5 },
};

describe('karta A/B wariantu C', () => {
  it('okresy z CRPS C i różnicą C − A, wniosek, kalibracja na próbie rozłącznej, plan i pierwszy oceniany okres', () => {
    expect(isAbC(abC)).toBe(true);
    const html = renderToStaticMarkup(<ModelAbCCard ab={abC} />);
    expect(html).toContain('A/B wariantu C');
    expect(html).toContain('CRPS C');
    expect(html).toContain('C − A');
    expect(html).toContain('wersja C trafniejsza');
    expect(html).toContain('61,2%');
    expect(html).toContain('89,5%');
    expect(html).toContain('ab-v2');
    expect(html).toContain('n = 325');
  });
  it('karta wariantu B bez zmian w nagłówkach (CRPS B, B − A); stare podsumowanie bez abC nie przechodzi strażnika C', () => {
    const ab: NonNullable<DeskLedgerSummary['ab']> = { h: 60, model: 'ledger-har-fhs-bocpd-v1', blockDays: 14, registeredAt: E, current: abC.current, closing: null, last: null, latest: null };
    const html = renderToStaticMarkup(<ModelAbCard ab={ab} />);
    expect(html).toContain('CRPS B');
    expect(html).toContain('B − A');
    expect(isAbC(undefined)).toBe(false);
    expect(isAbC({ ...abC, latest: { t: 1, x: 'a', rv60: 1 } })).toBe(false);
  });
});
