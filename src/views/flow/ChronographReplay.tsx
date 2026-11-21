import { useMemo, useRef, useState } from 'react';
import { locale, tr } from '../../i18n';
import { DASH, fmtFixed } from '../../ui/format';
import { Chronograph, chronoTime, type TapeExcerpt } from './Chronograph';
import { levelTrial } from './chronographModel';
import { ARCHIVE_WINDOW_MS, demoSource, demoWindows, LEVEL_TEST_PRICE, openChronographClip, type ChronographDemo } from './chronographHistory';

const formatPrice = new Intl.NumberFormat(locale).format;
const trialWindow = 5_000;

export default function ChronographReplay({ kind }: { kind: ChronographDemo }) {
  const [example, setExample] = useState(kind === 'level' ? 1 : 0);
  const [gap, setGap] = useState(false);
  const [showTrades, setShowTrades] = useState(false);
  const openTape = useRef<HTMLButtonElement>(null);
  const windows = demoWindows(kind);
  const through = windows[example];
  const clip = useMemo(() => openChronographClip(kind, through, gap), [kind, through, gap]);
  const from = through - trialWindow;
  const result = useMemo(() => kind === 'level' ? levelTrial(clip.tape, clip.coverage, from, through, LEVEL_TEST_PRICE) : null,
    [clip, kind, from, through]);
  const label = chronoTime(from) + ' – ' + chronoTime(through) + ' UTC';
  const excerpt: TapeExcerpt | undefined = useMemo(() => showTrades && result?.kind === 'covered' ? {
    rows: result.rows, firstBelow: result.firstBelow, label,
    close: () => {
      setShowTrades(false);
      openTape.current?.focus({ preventScroll: true });
    },
  } : undefined, [showTrades, result, label]);
  const none = tr('Brak w oknie', 'None in window');
  const trial = result && <section className="oc-trial" aria-label={tr('Próba poziomu', 'Level test')}>
    <header>
      <h3>{tr('Próba poziomu', 'Level test')}</h3>
      <strong>{formatPrice(LEVEL_TEST_PRICE)} USD</strong>
      <div role="group" aria-label={tr('Przykłady z nagrania', 'Recorded examples')}>
        {windows.map((value, index) => <button type="button" key={value} aria-pressed={index === example} onClick={() => {
          setExample(index);
          setShowTrades(false);
        }}>{chronoTime(value).slice(0, 5)}</button>)}
      </div>
      <span>{label}</span>
      <button ref={openTape} type="button" disabled={result.kind !== 'covered' || !result.rows.length}
        aria-pressed={!!excerpt} onClick={() => setShowTrades(value => !value)}>
        {excerpt ? tr('Pokazano wykonania', 'Trades shown') : tr('Zobacz wykonania', 'View trades')}
      </button>
    </header>
    {result.kind === 'covered' ? <dl>
      <div><dt>{tr('Sprzedaż przed zejściem', 'Sells before the break')}</dt>
        <dd>{result.before ? `${fmtFixed(result.before.size, 5)} BTC · ${result.before.count} ${tr('wyk.', 'trades')}`
          : tr('Nieznana kolejność w 1 ms', 'Order within 1 ms is unknown')}</dd></div>
      <div><dt>{tr('Pierwsze wykonanie poniżej', 'First trade below')}</dt>
        <dd className="of-sell">{result.firstBelow ? `${formatPrice(result.firstBelow.px)} USD · +${result.firstBelow.t - from} ms` : none}</dd></div>
      <div><dt>{tr('Pierwszy powrót do poziomu', 'First return to level')}</dt>
        <dd>{result.returned ? `${formatPrice(result.returned.px)} USD · ${chronoTime(result.returned.t)}` : result.firstBelow ? none : DASH}</dd></div>
    </dl> : <p>{tr('Luka w 5 s taśmy. Nie można ustalić przebiegu próby.', 'A gap in the 5 s tape prevents reading the level test.')}</p>}
  </section>;
  const controls = <label><input type="checkbox" checked={gap} onChange={e => {
    setGap(e.currentTarget.checked);
    setShowTrades(false);
  }} />{tr('SIM · luka taśmy', 'SIM · tape gap')}</label>;
  return <>
    <p className="oc-replay-label"><strong>{tr('Nagranie BTC · 20.11.2026', 'BTC recording · 20 Nov 2026')}</strong> ·{' '}
      {chronoTime(through - ARCHIVE_WINDOW_MS)} – {chronoTime(through)} UTC ·{' '}
      <a href={demoSource} target="_blank" rel="noreferrer">{tr('Publiczne archiwum', 'Public archive')}</a></p>
    <Chronograph key={through} source={{ ...clip, through, fmtPx: formatPrice, unit: 'BTC', sizeDecimals: 5, bookFresh: false, recorded: true }}
      demoControls={controls} trial={trial} excerpt={excerpt} showSideFilter={kind !== 'flip'}
      initialMinimum={kind === 'flip' ? 100_000 : 0} initialPrice={kind === 'level' ? LEVEL_TEST_PRICE : 61_874} fixedWindow={ARCHIVE_WINDOW_MS} />
  </>;
}
