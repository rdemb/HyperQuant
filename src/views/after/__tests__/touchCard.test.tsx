import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeskLedgerSummary } from '../../../utils/deskLedger';
import { TouchCard } from '../DeskLedgerPanel';

const summary = (touch: Partial<DeskLedgerSummary['scores']['touch']>): DeskLedgerSummary => ({
  v: 1,
  coin: 'BTC',
  asOf: 0,
  model: 'test',
  head: { hash: 'h', lines: 1 },
  pending: 0,
  voided: 0,
  latest: { ret: [], touch: null },
  scores: { ret: {}, touch: { n: 1892, pairs: 5180, brier: 0.0734, brierBase: 0.1226, bss: 0.401, reliability: [], calibration: [], ...touch } },
  ots: [],
  slotStamps: 0,
  participation: { issued: 0, skipped: 0, gaps: [] },
  method: 'hq-ledger-v1',
});

describe('Dziennik desku: karta dotknięć', () => {
  it('BSS wobec odległości i wobec częstości obok siebie, z Brierem obu baz', () => {
    const html = renderToStaticMarkup(<TouchCard s={summary({ bssClim: 0.401, brierDist: 0.0822, bssDist: 0.106, pairsDist: 5180 })} />);
    expect(html).toContain('10,6%');
    expect(html).toContain('40,1%');
    expect(html).toContain('0,082');
    expect(html).toContain('0,123');
    expect(html).toMatch(/odległoś/);
    expect(html).toMatch(/częstoś/);
  });

  it('starsze podsumowanie bez bazy odległości: BSS „—” z powodem, a liczby wobec samej częstości nie ma bez pary', () => {
    const html = renderToStaticMarkup(<TouchCard s={summary({})} />);
    expect(html).not.toContain('40,1%');
    expect(html).toContain('brak bazy odległości w podsumowaniu');
  });
});
