import { expect, it } from 'vitest';
import { makeChronographAnchor } from '../chronographAnchor';
import { conflictRepairHash, questionHash, questionLinkConflict } from '../questionLink';
import type { DepthDrop } from '../snapshotOrder';

const trade = { t: 1795159782058, tid: 978, px: 61_611, sz: 0.00681, side: -1 as const };
const drop: DepthDrop = { price: trade.px, side: 'bid', before: { t: 1795159781528, size: 39.66225 }, after: { t: 1795159794009, size: 7.40276 } };
const good = questionHash('BTC', 'level', makeChronographAnchor('level', 1795159812143, trade, drop));
const a = new URLSearchParams(good.split('?')[1]).get('a')!;
const hash = (m: string | null, w: string | null) => '#orderflow?' + [m !== null && `m=${encodeURIComponent(m)}`, w !== null && `w=${w}`, `a=${a}`].filter(Boolean).join('&');

it('poprawny link BTC/level bez konfliktu; zwykły link na żywo bez kontroli', () => {
  expect(questionLinkConflict(good)).toBeNull();
  expect(questionLinkConflict('#orderflow?m=ETH')).toBeNull();
  expect(questionLinkConflict('#orderflow?m=xyz%3AGOLD&w=level')).toBeNull();
});

it.each([
  ['ETH', 'level', 'market'],
  ['xyz:GOLD', 'level', 'market'],
  ['xyz:NVDA', 'level', 'market'],
  ['BTC', 'flip', 'workspace'],
  ['BTC', 'archive', 'workspace'],
  ['BTC', null, 'workspace'],
] as const)('m=%s w=%s z kotwicą level → konflikt %s', (m, w, reason) => {
  expect(questionLinkConflict(hash(m, w))).toMatchObject({ reason, market: m, workspace: w, clip: 'level' });
});

it('jawne wyjście prowadzi do BTC i klipu z kotwicy, z tą samą kotwicą', () => {
  const c = questionLinkConflict(hash('ETH', 'level'))!;
  expect(conflictRepairHash(hash('ETH', 'level'), c)).toBe(good);
});
