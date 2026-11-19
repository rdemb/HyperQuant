import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MobileSmcRangeProfile } from '../chart/MobileSmcRangeProfile';
import { SmcRangeProfileLayer, type RangeProfileInfo } from '../chart/smcRangeProfileLayer';
import { Coverage } from '../core/coverage';
import { Tape } from '../core/tape';

it('przekazuje ten sam model do mobilnego panelu, bez rysowania na osi', () => {
  const tape = new Tape();
  tape.insert([{ t: 80_000, px: 64_600, sz: 1, side: 1, tid: 1 }, { t: 96_000, px: 64_700, sz: 2, side: -1, tid: 2 }]);
  const layer = new SmcRangeProfileLayer(tape, new Coverage([[1, 100_001]]), () => ({ from: 1, to: 100_000 }),
    true, () => [], new Coverage(), () => 100_000);
  const info: { current: RangeProfileInfo | null } = { current: null };
  layer.onInfo = snapshot => { info.current = snapshot; };
  layer.setLayout({ kind: 'panel' });
  layer.attached({
    chart: { paneSize: () => ({ width: 300, height: 300 }) },
    series: { coordinateToPrice: (y: number) => 64_800 - y, priceToCoordinate: (p: number) => 64_800 - p },
    requestUpdate: () => layer.updateAllViews(),
  } as Parameters<typeof layer.attached>[0]);
  layer.updateAllViews();
  expect(layer.priceAxisPaneViews()).toHaveLength(0);
  expect(info.current?.panel?.rows.map(row => [row.low, row.turnoverUsd, row.deltaUsd])).toEqual([
    [64_700, 129_400, -129_400], [64_600, 64_600, 64_600],
  ]);
  const render = (expanded: boolean) => renderToStaticMarkup(
    <MobileSmcRangeProfile id="profile" info={info.current} expanded={expanded} onToggle={() => {}} replayAt={100_000} details={<div>reakcje</div>} />);
  const closed = render(false), open = render(true);
  expect(closed).toContain('aria-expanded="false"');
  expect(closed).toContain('data-smc-mobile-current');
  expect(closed).toContain('−129,4K');
  expect(closed).not.toContain('data-smc-mobile-row');
  expect(open).toContain('aria-controls="profile"');
  expect(open.match(/data-smc-mobile-row/g)).toHaveLength(2);
  expect(open).toContain('reakcje');
  expect(open).not.toContain('data-smc-mobile-current');
  expect(info.current?.panel?.trace?.byPrice.get(64_600)?.[0]?.buy).toBe(64_600_000_000n);
  expect(info.current?.panel?.trace?.byPrice.get(64_700)?.[2]?.sell).toBe(129_400_000_000n);

  layer.setLayout({ kind: 'axis', inset: 0 });
  expect(layer.priceAxisPaneViews()).toHaveLength(1);
  expect(info.current?.panel).toBeNull();
  layer.setLayout({ kind: 'panel' });
  tape.insert([{ t: 99_000, px: 64_900, sz: 1, side: 1, tid: 3 }]);
  layer.setTraceVisible(false);
  expect(render(false)).toContain('Aktywny przedział poza wykresem');
  expect(render(false)).not.toContain('data-smc-mobile-current');
  expect(render(true).match(/data-smc-mobile-row/g)).toHaveLength(2);
  layer.detached();
});

it('pokazuje brak wykonań przed wczytaniem danych', () => {
  const empty = renderToStaticMarkup(<MobileSmcRangeProfile id="profile" info={null} expanded={false} onToggle={() => {}} replayAt={null} details={null} />);
  expect(empty).toContain('Brak wykonań w zakresie');
  expect(empty).not.toContain('USD</strong>');
});
