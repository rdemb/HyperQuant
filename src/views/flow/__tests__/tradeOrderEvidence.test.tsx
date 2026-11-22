import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Coverage } from '../../../charts/pro/core/coverage';
import { CHRONOGRAPH_V1_EVIDENCE } from '../chronographAnchor';
import type { DepthDrop } from '../snapshotOrder';
import { TradeOrderQuestion } from '../TradeOrderQuestion';

// Odbiór Astry: wynik M4 nie mówi „taśma z pokryciem”; deklaracja v1, niezweryfikowana ciągłość i SIM są osobno
const trade = { t: 1795159782058, tid: 978, px: 61_611, sz: 0.00681, side: -1 as const };
const drop: DepthDrop = { price: trade.px, side: 'bid',
  before: { t: 1795159781528, size: 39.66225 }, after: { t: 1795159794009, size: 7.40276 } };
const pair = `bid:${drop.before.t}:${drop.after.t}`;
const covered = new Coverage([[trade.t - 60_000, trade.t + 60_000]]);
const source = { label: 'Nagranie publiczne BTC 20.11.2026 (archiwum v1)', receiptTime: 'unknown' as const };
const render = (props: Partial<Parameters<typeof TradeOrderQuestion>[0]>) => renderToStaticMarkup(
  <TradeOrderQuestion trade={trade} choices={{ drops: [drop], missing: new Set() }} tapeCoverage={covered}
    initialPair={pair} dismiss={() => {}} source={source} evidence={CHRONOGRAPH_V1_EVIDENCE} {...props} />);

it('zdrowy wynik wskazuje zakres zadeklarowany i niezweryfikowaną ciągłość, bez „taśmy z pokryciem”', () => {
  const html = render({});
  expect(html).toContain('Kolejność nieustalona');
  expect(html).toContain('zadeklarowany w archiwum v1, nie zmierzony');
  expect(html).toContain('niezweryfikowana');
  expect(html).toMatch(/Symulacja<\/dt><dd>brak/);
  expect(html).not.toMatch(/z pokryciem|covered tape/);
});

it('wynik pod SIM z linku nazywa symulację osobno i nie miesza jej z deklaracją', () => {
  const gap = new Coverage([[trade.t - 60_000, trade.t - 1_000], [trade.t + 1_000, trade.t + 60_000]]);
  const html = render({ tapeCoverage: gap, simulation: { tapeGap: true, bookGap: false, fromLink: true } });
  expect(html).toContain('zadeklarowany w archiwum v1, nie zmierzony');
  expect(html).toContain('niezweryfikowana');
  expect(html).toContain('luka taśmy · zapisana w otwartym linku');
  expect(html).toContain('Luka z symulacji SIM, nie z nagrania.');
});

it('SIM braku ciągłości arkusza: powód oznaczony jako symulacja, bez liczb pary', () => {
  const html = render({ choices: { drops: [], missing: new Set(['book-gap'] as const) },
    simulation: { tapeGap: false, bookGap: true, fromLink: true }, pairNote: 'Para z linku: BID 07:29:41,528 → 07:29:54,009 UTC.' });
  expect(html).toContain('Brak ciągłości z symulacji SIM, nie z nagrania.');
  expect(html).toContain('Para z linku: BID');
  expect(html).not.toContain('39,66225');
  expect(html).not.toContain('7,40276');
});
