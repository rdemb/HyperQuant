import { useId, useState } from 'react';
import sample from '../../data/deltaBoundsExample.v1.json';
import { tr } from '../../i18n';
import { fmtSigned, fmtFixed } from '../../ui/format';
import { chronoTime } from './Chronograph';
import { boundMissingDelta } from './replayQuestions';

const at = (ms: number) => chronoTime(ms).slice(0, 8);
const btc = (units: bigint) => Number(units) / 10 ** sample.scale;
const signed = (units: bigint) => fmtSigned(btc(units), sample.scale, ' BTC');

export default function DeltaBoundsExample({ cursorMs, onCursorChange }: { cursorMs?: number; onCursorChange?: (value: number) => void } = {}) {
  const [localIndex, setIndex] = useState(sample.masks.length - 1);
  const [showUncertified, setShowUncertified] = useState(false);
  const heading = useId();
  const index = cursorMs === undefined ? localIndex : sample.masks.findIndex(candidate => candidate.gap[0] === cursorMs);
  const selectedIndex = index < 0 ? sample.masks.length - 1 : index;
  const mask = sample.masks[selectedIndex];
  const buy = BigInt(mask.buy);
  const sell = BigInt(mask.sell);
  const volume = BigInt(mask.volume);
  const result = boundMissingDelta({ buy, sell, volume, certified: !showUncertified, final: true });
  const sign = result.kind === 'bounded' ? {
    positive: tr('Przewaga kupna biorców', 'Taker buying dominates'),
    negative: tr('Przewaga sprzedaży biorców', 'Taker selling dominates'),
    balanced: tr('Równowaga', 'Balanced'),
    undetermined: tr('Znak nieustalony', 'Sign undetermined'),
  }[result.sign] : null;

  return <section className="oc-archive oc-basket" aria-labelledby={heading}>
    <h3 id={heading}>{tr('Czy mimo luki znamy znak delty?', 'Can we tell the sign of delta despite a gap?')}</h3>
    <p className="oc-order-source"><span className="oc-sim-tag">SIM</span> Hyperliquid BTC perp · 20.11.2026 · {at(mask.from)} UTC
      {' · '}{tr('Celowo ukryty odcinek publicznego nagrania', 'Deliberately masked interval of a public recording')}</p>
    <div className="oc-archive-q">
      <label>
        {tr('Ukryty odcinek (UTC)', 'Masked interval (UTC)')}
        <select className="oc-delta-mask" value={selectedIndex} onChange={e => {
          const index = Number(e.currentTarget.value);
          if (onCursorChange) onCursorChange(sample.masks[index].gap[0]);
          else setIndex(index);
        }}>
          {sample.masks.map((m, i) => <option key={m.gap[0]} value={i}>{at(m.gap[0])} – {at(m.gap[1])}</option>)}
        </select>
      </label>
      <label><input type="checkbox" checked={showUncertified} onChange={e => setShowUncertified(e.currentTarget.checked)} />
        {tr('SIM · Brak dowodu zgodności danych', 'SIM · No proof the records belong to the same minute')}</label>
    </div>
    <div role="status" className="oc-archive-obs" data-delta-bounds={result.kind === 'bounded' ? result.sign : 'unavailable'}>
      {result.kind === 'bounded' ? <>
        <p><strong>{sign}</strong></p>
        <p>{tr('Możliwa delta całej minuty', 'Possible delta for the full minute')} · {signed(result.lower)} … {signed(result.upper)}</p>
        <p>{tr('Delta z widocznej części', 'Delta from visible trades')} {signed(buy - sell)} ·{' '}
          {tr('Ukryty wolumen', 'Masked volume')} {fmtFixed(btc(result.missing), sample.scale)} BTC.</p>
      </> : <p><strong>{tr('Nie można wyznaczyć przedziału', 'Bounds unavailable')}</strong>
        {' · '}{tr('Brak dowodu, że widoczne wykonania należą do tego samego zamkniętego wolumenu minuty.', 'There is no proof the visible trades belong to the same final minute volume.')}</p>}
    </div>
    <p className="oc-order-note">{tr('Dowód zgodności pochodzi z kontrolowanego usunięcia wykonań z przypiętego nagrania. Przy rzeczywistej luce potrzebny jest osobny dowód zgodności.', 'The proof comes from masking trades in a pinned recording. A real gap requires separate proof.')}</p>
    <p className="oc-order-source">
      <a href={sample.sources.trades.url} target="_blank" rel="noreferrer">{tr('Taśma publiczna', 'Public tape')}</a>{' · '}
      <a href={sample.sources.candles.url} target="_blank" rel="noreferrer">{tr('Wolumen minuty', 'Minute volume')}</a>
    </p>
  </section>;
}
