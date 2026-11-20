import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { create, quote } from '../../public/orderflow/replay/engine.js';

const archive = JSON.parse(readFileSync(
  new URL('../../public/orderflow/replay/sample-2026-11-20.json', import.meta.url), 'utf8',
));
const replay = create(archive);

describe('nagranie Order Flow z 20 listopada', () => {
  it('prowadzi od ceny i klasy do dwóch wykonań źródłowych w tej samej milisekundzie', () => {
    const time = 1795161115327;
    const frame = replay.frame('BTC', time, 61866);
    const level = frame.levels[61866];
    const fills = frame.atPrice.filter(row => row[0] === time && row[5] === 4);
    expect(frame.coverage).toBe(120000);
    expect(frame.total[0] - frame.total[1]).toBe(21784964703360);
    expect(level.now[0] - level.now[1]).toBe(573306654060);
    expect(level.bands[4]).toBe(464104502820);
    expect(fills.map(row => row[4]).sort((a, b) => a - b)).toEqual([145367777520, 318736725300]);
  });

  it('przy cofaniu pamięta czasy pomiarów L2 i ich odległość od wykonania', () => {
    const market = replay.markets().BTC;
    const [time, price] = market.marks[1];
    replay.frame('BTC', market.end, price);
    const { history } = replay.frame('BTC', time, price);
    const lastThree = history.slice(-3);
    expect(lastThree.map(book => quote(book, price)?.ask)).toEqual([625531803600, 618512155470, 565876847250]);
    expect(time - lastThree.at(-1)[0]).toBe(334);
    expect(history.every(book => book[0] <= time)).toBe(true);
  });

  it.each(['GOLD', 'SP500'])('%s zachowuje niepełne pokrycie na początku nagrania', market => {
    const [time, price] = replay.markets()[market].marks[1];
    expect(replay.frame(market, time, price).coverage).toBe(99066);
  });

  it('przypisuje lukę wewnątrz okna do właściwej kolumny 5 s', () => {
    const [time, price] = archive.BTC.marks[1];
    const tapeSpans = [[time - 120000, time - 8000], [time - 7000, time + 1]];
    const sample = create({ BTC: { ...archive.BTC, tapeSpans } }).frame('BTC', time, price);
    expect(sample.coverage).toBe(119000);
    expect(sample.sliceCoverage).toEqual([5000, 5000, 4000, 5000]);
    expect(sample.recentCoverage).toBe(2000);
  });
});
