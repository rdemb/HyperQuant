import { expect, it } from 'vitest';
import { LevelControlTrial } from '../core/smcControlReplay';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow } from '../core/smcOrderflow';

const target = { lo: 99, hi: 101 };
const print = (time: number, px: number) => ({
  time, px, observedAt: time, receivedAt: time, seq: time, tid: time,
  side: 1 as const, sz: 1, late: false,
});

it('counts no observed contact when every transaction executed outside the price band', () => {
  const trial = new LevelControlTrial({ selectedAt: 0, horizonMs: 20, atr: 10,
    dir: 1, target, control: null, maxGapMs: 12000 });
  trial.observe([print(1, 102), print(2, 98), print(22, 97)], 22, true);
  expect(trial.snapshot()).toMatchObject({ smcFrom: null, nSmc: 0, smcAtr: null });
});

it('does not record a metric event per print before either contact', () => {
  const j = new ObservationJournal('BTC');
  j.open(0, 0);
  const m = new SmcOrderflow(j, 60000);
  const e = { id: 'zone', kind: 'ob' as const, known: 0, ...target,
    atr: 10, dir: 1 as const, expiresAt: 1000000 };
  m.update([e], [], 'mixed', 0);
  for (let t = 1; t <= 300; t++) {
    j.trades([print(t, 110)], t);
    m.update([e], [], 'mixed', t);
  }
  expect(m.events(e.id).filter(x => x.kind === 'metrics').length).toBeLessThan(5);
});
