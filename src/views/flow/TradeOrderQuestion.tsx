import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { TradeRow } from '../../charts/pro/core/tape';
import type { Coverage } from '../../charts/pro/core/coverage';
import { locale, tr } from '../../i18n';
import { fmtFixed } from '../../ui/format';
import { chronoTime } from './Chronograph';
import { compareTradeToDrop, type DepthDrop, type DropChoices, type DepthOrder, type MissingBook } from './snapshotOrder';
import './tradeOrderQuestion.css';

const priceFormat = new Intl.NumberFormat(locale);
const pairId = (d: DepthDrop) => `${d.side}:${d.before.t}:${d.after.t}`;
const at = (t: number) => chronoTime(t) + ' UTC';

// Oś A |———| B z kropką wydruku na tej samej osi, w barwie strony agresora; pozycje z czasu giełdy
function OrderTimeline({ drop, trade }: { drop: DepthDrop; trade: TradeRow }) {
  const lo = Math.min(drop.before.t, trade.t), hi = Math.max(drop.after.t, trade.t);
  const pad = Math.max(400, (hi - lo) * 0.12);
  const x = (t: number) => 10 + ((t - (lo - pad)) / (hi - lo + 2 * pad)) * 300;
  const a = x(drop.before.t), b = x(drop.after.t);
  return <svg className="oc-order-timeline" viewBox="0 0 320 44" aria-hidden="true">
    <line x1="10" x2="310" y1="24" y2="24" stroke="var(--color-line-strong)" />
    <rect className="oc-order-band" x={a} y="14" width={Math.max(2, b - a)} height="20" fill="var(--color-lume)" opacity=".16" />
    <line x1={a} x2={a} y1="10" y2="38" stroke="var(--color-ink-1)" strokeWidth="2" />
    <line x1={b} x2={b} y1="10" y2="38" stroke="var(--color-ink-1)" strokeWidth="2" />
    <text x={a} y="8" textAnchor="middle" fontSize="8" fill="var(--color-ink-2)">A</text>
    <text x={b} y="8" textAnchor="middle" fontSize="8" fill="var(--color-ink-2)">B</text>
    <circle className="oc-order-print" cx={x(trade.t)} cy="24" r="5" fill={trade.side === 1 ? 'var(--color-buy)' : 'var(--color-sell)'} stroke="var(--color-ink-1)" strokeWidth="1.5" />
  </svg>;
}

const seconds = (ms: number) => `${fmtFixed(Math.abs(ms) / 1000, 3)} s`;

// Werdykt jako zdanie o kolejności (nie samo „Nieustalone”)
function verdict(kind: DepthOrder['kind']) {
  return kind === 'earlier' ? tr('Wydruk był wcześniej', 'The print came first')
    : kind === 'later' ? tr('Wydruk był później', 'The print came later')
    : tr('Kolejność nieustalona', 'Order undetermined');
}

// Zdanie z odległością od A albo B (albo szerokością przedziału)
function distance(result: DepthOrder, drop: DepthDrop, trade: TradeRow) {
  const t = at(trade.t), A = at(drop.before.t), B = at(drop.after.t);
  if (result.kind !== 'undetermined') {
    if (result.kind === 'earlier') return tr(`Wydruk ${t} był ${seconds(drop.before.t - trade.t)} przed migawką A (${A}); spadek ilości zaobserwowano dopiero między A i B.`,
    `Print ${t} was ${seconds(drop.before.t - trade.t)} before snapshot A (${A}); the size drop was only observed between A and B.`);
    return tr(`Wydruk ${t} był ${seconds(trade.t - drop.after.t)} po migawce B (${B}); spadek ilości był już widoczny w B.`,
    `Print ${t} was ${seconds(trade.t - drop.after.t)} after snapshot B (${B}); the drop was already visible in B.`);
  }
  if (result.reason === 'between') return tr(`Wydruk ${t} leży w przedziale A–B szerokim na ${seconds(drop.after.t - drop.before.t)}: spadek mógł nastąpić przed nim albo po nim.`,
    `Print ${t} lies inside A–B, ${seconds(drop.after.t - drop.before.t)} wide: the drop may have happened before or after it.`);
  return reasonLabel(result.reason);
}

type Simulation = { tapeGap: boolean; bookGap: boolean; fromLink: boolean };

// Luka z przełącznika SIM jest symulacją, nie cechą nagrania: mówimy to przy każdym powodzie, który z niej wynika
function simSuffix(reason: string, simulation?: Simulation | null) {
  if (!simulation) return '';
  if (reason === 'tape-gap' && simulation.tapeGap) return ' ' + tr('Luka z symulacji SIM, nie z nagrania.', 'The gap comes from the SIM simulation, not from the recording.');
  if (reason === 'book-gap' && simulation.bookGap) return ' ' + tr('Brak ciągłości z symulacji SIM, nie z nagrania.', 'The discontinuity comes from the SIM simulation, not from the recording.');
  return '';
}

function reasonLabel(reason: MissingBook | Extract<DepthOrder, { kind: 'undetermined' }>['reason']) {
  return {
    snapshot: tr('Brak dwóch kolejnych dokładnych migawek.', 'Two consecutive exact snapshots are unavailable.'),
    level: tr('Brak jawnego odczytu tej ceny po tej samej stronie obu migawek.', 'This price is missing from the same side in both snapshots.'),
    'side-change': tr('Cena zmieniła stronę arkusza między migawkami.', 'The price changed book sides between snapshots.'),
    'book-gap': tr('Brak ciągłego pokrycia arkusza między migawkami.', 'Book coverage is incomplete between the snapshots.'),
    'no-drop': tr('Brak potwierdzonego spadku ilości przy tej cenie.', 'No confirmed decrease in size at this price.'),
    between: tr('Transakcja przypada między migawkami lub dokładnie na granicy.', 'The trade falls between the snapshots or exactly at an endpoint.'),
    clock: tr('Czasy źródeł nie są porównywalne.', 'The source clocks are not comparable.'),
    'tape-gap': tr('Taśma nie potwierdza pokrycia w chwili transakcji.', 'Tape coverage is unavailable at the trade time.'),
    'different-price': tr('Transakcja i odczyt dotyczą różnych cen.', 'The trade and the book reading are at different prices.'),
  }[reason];
}

export function TradeOrderQuestion({ trade, choices, tapeCoverage, reveal, dismiss, initialPair = null, onPair, pairNote = null, source, evidence, simulation = null }: {
  trade: TradeRow;
  choices: DropChoices;
  tapeCoverage: Coverage;
  reveal?: () => void;
  dismiss: () => void;
  /** Para A/B z linku: wybierana tylko, gdy jest wśród dostępnych przy tym kursorze (bez danych z przyszłości). */
  initialPair?: string | null;
  onPair?: (id: string | null) => void;
  /** Powód, dla którego para A/B z linku nie została odtworzona (transakcja tak). */
  pairNote?: string | null;
  /** Klasa źródła: nazwa nagrania, rewizja bajtów i to, czy znamy czas odbioru (archiwum v1: nie). */
  source?: { label: string; revision?: string; receiptTime: 'known' | 'unknown' };
  /** Pochodzenie danych (archiwum v1: zakres zadeklarowany, ciągłość niezweryfikowana). Bez tego nie twierdzimy niczego o pokryciu. */
  evidence?: { coverage: 'declared' | 'verified'; continuity: 'unverified' | 'verified' };
  /** Włączone przełączniki SIM i czy pochodzą z otwartego linku. */
  simulation?: Simulation | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const pair = useId();
  const [selection, setSelectionState] = useState<string | null>(() => initialPair && choices.drops.some(d => pairId(d) === initialPair) ? initialPair : null);
  const setSelection = (id: string | null) => { setSelectionState(id); onPair?.(id); };
  const linkedPairMissing = !!initialPair && !choices.drops.some(d => pairId(d) === initialPair);
  // Po jawnym odsłonięciu późniejszej migawki para z linku może stać się dostępna — wtedy ją wybieramy
  useEffect(() => {
    if (!selection && initialPair && choices.drops.some(d => pairId(d) === initialPair)) setSelectionState(initialPair);
  }, [choices, initialPair, selection]);
  const selected = choices.drops.find(drop => pairId(drop) === selection);
  const result = selected && compareTradeToDrop(selected, trade, tapeCoverage, { book: 'exchange', tape: 'exchange' });
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  return <dialog ref={dialog} className="oc-order-question" aria-labelledby={title} onCancel={e => {
    e.preventDefault();
    dismiss();
  }}>
    <div className="oc-order-content">
      <header>
        <h2 id={title}>{tr('Co było pierwsze?', 'What came first?')}</h2>
        <button type="button" autoFocus onClick={dismiss}>{tr('Wróć do taśmy', 'Back to tape')}</button>
      </header>
      <p className="oc-order-context">{priceFormat.format(trade.px)} USD · {tr('Nagranie BTC', 'BTC recording')} · Hyperliquid</p>
      <p><strong>{tr('Taśma', 'Tape')}</strong> · {at(trade.t)} · {trade.side === 1 ? tr('Kupno', 'Buy') : tr('Sprzedaż', 'Sell')} · {fmtFixed(trade.sz, 5)} BTC</p>
      <fieldset>
        <legend>{tr('Wybierz przedział spadku ilości w arkuszu', 'Choose a book-size decrease interval')}</legend>
        {choices.drops.map(drop => <label key={pairId(drop)}>
          <input type="radio" name={pair} checked={selection === pairId(drop)} onChange={() => setSelection(pairId(drop))} />
          <span><b>{drop.side.toUpperCase()}</b> · {chronoTime(drop.before.t)}–{at(drop.after.t)}
            <small>{fmtFixed(drop.before.size, 5)} → {fmtFixed(drop.after.size, 5)} BTC</small>
          </span>
        </label>)}
        {choices.drops.length === 0 && <div data-oc-order-result="undetermined">
          <p>{tr('Brak uskoku przy tej cenie w nagraniu. Powody:', 'No book step at this price in the recording. Reasons:')}</p>
          <ul className="oc-order-reasons">
            {(['book-gap', 'side-change', 'level', 'no-drop', 'snapshot'] as const).filter(r => choices.missing.has(r)).map(r => <li key={r}>{reasonLabel(r)}{simSuffix(r, simulation)}</li>)}
            {choices.missing.size === 0 && <li>{reasonLabel('snapshot')}</li>}
          </ul>
        </div>}
      </fieldset>
      {pairNote && !selection && <p className="oc-order-note" role="status">{pairNote}</p>}
      {!pairNote && linkedPairMissing && !selection && <p className="oc-order-note" role="status">{tr('Para A–B z linku nie jest dostępna przy tym kursorze: migawka B jeszcze niewidoczna albo inna wersja nagrania.',
        'The linked A–B pair is not available at this cursor: snapshot B is not visible yet, or this is a different recording version.')}</p>}
      {reveal && <button className="oc-order-reveal" type="button" onClick={reveal}>
        {tr('Pokaż późniejszą migawkę', 'Show later snapshot')}
      </button>}
      <div aria-live="polite" aria-atomic="true">
        {selected && result && <section className="oc-order-result" data-oc-order-result={result.kind}>
          <h3>{verdict(result.kind)}</h3>
          {result.kind !== 'undetermined' || result.reason === 'between'
            ? <OrderTimeline key={pairId(selected)} drop={selected} trade={trade} /> : null}
          <p>{distance(result, selected, trade)}{result.kind === 'undetermined' ? simSuffix(result.reason, simulation) : ''}</p>
          <dl>
            <div><dt>{tr('Migawka A', 'Snapshot A')}</dt><dd>{at(selected.before.t)} · {fmtFixed(selected.before.size, 5)} BTC</dd></div>
            <div><dt>{tr('Migawka B', 'Snapshot B')}</dt><dd>{at(selected.after.t)} · {fmtFixed(selected.after.size, 5)} BTC</dd></div>
            <div><dt>{tr('Długość przedziału', 'Interval width')}</dt><dd>{fmtFixed((selected.after.t - selected.before.t) / 1000, 3)} s</dd></div>
          </dl>
          <p className="oc-order-note">{tr('Różnica ilości nie mówi, czy zlecenia anulowano, czy wykonano, ani kto to zrobił.',
            'A size difference does not tell whether orders were cancelled or filled, or by whom.')}</p>
          <p className="oc-order-source">{tr('Migawki dokładne · czas giełdy w ms', 'Exact snapshots · exchange time in ms')} · B − A = {seconds(selected.after.t - selected.before.t)}</p>
          {/* Trzy osobne rzeczy: co archiwum deklaruje, czego nie sprawdzono i co jest symulacją */}
          <dl className="oc-order-evidence" aria-label={tr('Pochodzenie wyniku', 'Where the answer comes from')}>
            {evidence && <div><dt>{tr('Zakres nagrania', 'Recording range')}</dt><dd>{evidence.coverage === 'declared'
              ? tr('zadeklarowany w archiwum v1, nie zmierzony', 'declared in archive v1, not measured') : tr('zmierzony', 'measured')}</dd></div>}
            {evidence && <div><dt>{tr('Ciągłość taśmy i arkusza', 'Tape and book continuity')}</dt><dd>{evidence.continuity === 'unverified'
              ? tr('niezweryfikowana', 'not verified') : tr('zweryfikowana', 'verified')}</dd></div>}
            <div><dt>{tr('Symulacja', 'Simulation')}</dt><dd>{simulation && (simulation.tapeGap || simulation.bookGap)
              ? <><span className="oc-sim-tag">SIM</span> {[simulation.tapeGap && tr('luka taśmy', 'tape gap'), simulation.bookGap && tr('brak ciągłości arkusza', 'incomplete book coverage')].filter(Boolean).join(' · ')}
                {' · '}{simulation.fromLink ? tr('zapisana w otwartym linku', 'saved in the opened link') : tr('włączona w tym widoku', 'switched on in this view')}</>
              : tr('brak', 'none')}</dd></div>
            {source && <div><dt>{tr('Czas odbioru', 'Receipt time')}</dt><dd>{source.receiptTime === 'unknown'
              ? tr('nieznany: wynik dotyczy kolejności zdarzeń na giełdzie, nie tego, co było widać w aplikacji', 'unknown: the answer is about exchange event order, not what was visible in the app')
              : tr('znany', 'known')}</dd></div>}
          </dl>
          {source && <p className="oc-order-source">{source.label}{source.revision ? ` · ${tr('rewizja', 'revision')} ${source.revision.replace(/^sha256:/, 'sha256 ').slice(0, 19)}…` : ''}</p>}
        </section>}
      </div>
    </div>
  </dialog>;
}
