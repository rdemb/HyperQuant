import { useEffect, useMemo, useRef, useState } from 'react';
import { Coverage } from '../../charts/pro/core/coverage';
import type { TradeRow } from '../../charts/pro/core/tape';
import { locale, tr } from '../../i18n';
import { DASH, fmtFixed } from '../../ui/format';
import { Chronograph, chronoTime, type TapeExcerpt } from './Chronograph';
import { levelTrial } from './chronographModel';
import { ARCHIVE_WINDOW_MS, demoSource, demoWindows, LEVEL_TEST_PRICE, nextDemoSnapshot, openChronographClip, type ChronographDemo } from './chronographHistory';
import { depthDrops } from './snapshotOrder';
import { TradeOrderQuestion } from './TradeOrderQuestion';
import { anchorReasonText, readQuestionLink, writeQuestionLink } from './questionLink';
import { CHRONOGRAPH_CLIP_REVISION, CHRONOGRAPH_V1_EVIDENCE, makeChronographAnchor, readChronographSimulation, resolveChronographAnchor, type ChronographAnchor, type ChronographAnchorResult } from './chronographAnchor';

const formatPrice = new Intl.NumberFormat(locale).format;
const trialWindow = 5_000;
const noBookCoverage = new Coverage();
type LinkedPair = { side: 'bid' | 'ask'; a: number; b: number };
const pairKey = (p: LinkedPair) => `${p.side}:${p.a}:${p.b}`;
const pairText = (p: LinkedPair) => `${p.side.toUpperCase()} ${chronoTime(p.a)} → ${chronoTime(p.b)} UTC`;
function readLinkedPair(anchor: unknown): LinkedPair | null {
  const book = anchor && typeof anchor === 'object' ? (anchor as { book?: { side?: unknown; a?: unknown; b?: unknown } }).book : undefined;
  return book && (book.side === 'bid' || book.side === 'ask') && Number.isInteger(book.a) && Number.isInteger(book.b)
    ? { side: book.side, a: book.a as number, b: book.b as number } : null;
}

export default function ChronographReplay({ kind }: { kind: ChronographDemo }) {
  const windows = demoWindows(kind);
  // Link do pytania (adres): przykład, transakcja, para A/B i jawne odsłonięcie — czytane raz przy wejściu
  const [link] = useState(() => {
    const l = readQuestionLink(window.location.hash);
    return l && l.workspace === kind ? l : null;
  });
  // Kotwica z linku rozwiązywana raz przy wejściu (model Kodera); przy niezgodnej parze A/B otwieramy samą transakcję
  // Symulacja SIM zapisana w linku (Koder: `readChronographSimulation`) — przywracana razem z przełącznikami
  const [linkSim] = useState(() => {
    const sim = link?.anchor ? readChronographSimulation(link.anchor) : null;
    return sim && (sim.tapeGap || sim.bookGap) ? sim : null;
  });
  const [initial] = useState(() => {
    if (!link) return null;
    if (link.broken) return { result: null as ChronographAnchorResult | null, pairNote: null as string | null, notice: anchorReasonText('broken'), reason: null as string | null };
    if (!link.anchor) return null;
    const full = resolveChronographAnchor(link.anchor);
    if (full.kind === 'resolved') return { result: full, pairNote: null, notice: null, reason: null };
    const linked = readLinkedPair(link.anchor);
    if (full.reason.startsWith('book-') && typeof link.anchor === 'object') {
      const { book: _book, ...withoutBook } = link.anchor as Record<string, unknown>;
      const trade = resolveChronographAnchor(withoutBook);
      if (trade.kind === 'resolved') {
        // Tożsamość pary zostaje w komunikacie; liczb z SIM nie odtwarzamy
        const note = full.reason === 'book-gap' && linkSim?.bookGap && linked
          ? tr(`Para z linku: ${pairText(linked)}. Link zapisano przy symulacji „SIM · brak ciągłości arkusza”, więc wynik tej pary nie jest pokazywany. Aby porównać ją z nagraniem, wróć do taśmy, wyłącz ten przełącznik i wybierz tę parę.`,
            `Linked pair: ${pairText(linked)}. The link was saved with the “SIM · incomplete book coverage” simulation, so this pair’s result is not shown. To compare it with the recording, go back to the tape, switch it off and choose this pair.`)
          : linked ? `${anchorReasonText(full.reason)} (${pairText(linked)})` : anchorReasonText(full.reason);
        return { result: trade, pairNote: note, notice: null, reason: full.reason };
      }
    }
    const notice = full.reason === 'tape-gap' && linkSim?.tapeGap
      ? tr('Transakcja z linku leży w luce taśmy, ale ta luka pochodzi z symulacji „SIM · luka taśmy” zapisanej w linku, nie z nagrania. Wyłącz przełącznik, aby otworzyć transakcję.',
        'The linked trade lies in a tape gap, but the gap comes from the “SIM · tape gap” simulation saved in the link, not from the recording. Switch it off to open the trade.')
      : anchorReasonText(full.reason);
    return { result: null, pairNote: null, notice, reason: full.reason };
  });
  // Kursor z linku także przy odmowie „tape-gap” (kotwica poprawna, transakcja w luce SIM): stan po otwarciu jak przy zapisie
  const anchorThrough = (initial?.result?.kind === 'resolved' || initial?.reason === 'tape-gap') && link?.anchor && typeof link.anchor === 'object' ? Number((link.anchor as Record<string, unknown>).through) : null;
  const [example, setExample] = useState(() => {
    const i = anchorThrough !== null ? windows.indexOf(anchorThrough) : -1;
    return i >= 0 ? i : kind === 'level' ? 1 : 0;
  });
  const [gap, setGap] = useState(() => !!linkSim?.tapeGap);
  const [bookGap, setBookGap] = useState(() => !!linkSim?.bookGap);
  const [showTrades, setShowTrades] = useState(false);
  const [priceTape, setPriceTape] = useState(() => initial?.result?.kind === 'resolved');
  const [question, setQuestion] = useState<TradeRow | null>(() => initial?.result?.kind === 'resolved' ? initial.result.trade : null);
  const [pair, setPair] = useState<string | null>(() => {
    const d = initial?.result?.kind === 'resolved' ? initial.result.drop : null;
    if (d) return `${d.side}:${d.before.t}:${d.after.t}`;
    // Para z linku niedostępna przy tym kursorze lub pod SIM: zachowujemy jej klucz, by po jawnym odsłonięciu albo wyłączeniu SIM wybrać tę samą parę
    const linked = initial?.pairNote ? readLinkedPair(link?.anchor) : null;
    return linked ? pairKey(linked) : null;
  });
  const [notice, setNotice] = useState<string | null>(() => initial?.notice ?? null);
  const [pairNote] = useState<string | null>(() => initial?.pairNote ?? null);
  const [revealedThrough, setRevealedThrough] = useState<number | null>(() => anchorThrough !== null && !windows.includes(anchorThrough) ? anchorThrough : null);
  const openTape = useRef<HTMLButtonElement>(null);
  const questionTrigger = useRef<HTMLButtonElement>(null);
  const through = revealedThrough ?? windows[example];
  const clip = useMemo(() => openChronographClip(kind, through, gap), [kind, through, gap]);
  const choices = useMemo(() => question
    ? depthDrops(clip.history.list(), bookGap ? noBookCoverage : clip.bookCoverage, question.px, through, 5)
    : null, [clip, question, through, bookGap]);
  const nextSnapshot = question ? nextDemoSnapshot(kind, through) : undefined;
  // Stan pytania w adresie (kotwica Kodera): po przeładowaniu wraca ta sama transakcja i para A/B — albo jawny powód braku
  const selectedDrop = useMemo(() => {
    if (!question || !pair) return undefined;
    return depthDrops(clip.history.list(), bookGap ? noBookCoverage : clip.bookCoverage, question.px, through, 5).drops
      .find(d => `${d.side}:${d.before.t}:${d.after.t}` === pair);
  }, [clip, question, pair, through, bookGap]);
  useEffect(() => {
    if (kind !== 'level') return;
    if (notice && !question) return; // nie nadpisujemy linku, którego nie dało się otworzyć
    if (!question) { writeQuestionLink('BTC', kind, null); return; }
    let anchor: ChronographAnchor = makeChronographAnchor(kind, through, question, selectedDrop, { tapeGap: gap, bookGap });
    // Wybrana para ukryta przez SIM braku ciągłości arkusza: zapisujemy jej tożsamość (bez liczb), żeby link ją nazwał.
    // Kolejność pól jak w `makeChronographAnchor` (book przed simulation), żeby ten sam stan dawał ten sam adres.
    if (!selectedDrop && bookGap && pair) {
      const [side, a, b] = pair.split(':');
      if ((side === 'bid' || side === 'ask') && Number(b) < through) {
        const { simulation, ...rest } = anchor;
        anchor = { ...rest, book: { side, a: Number(a), b: Number(b) }, ...(simulation ? { simulation } : {}) };
      }
    }
    writeQuestionLink('BTC', kind, anchor);
  }, [kind, question, selectedDrop, through, notice, gap, bookGap, pair]);
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
          setRevealedThrough(null);
          setNotice(null);
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
  const controls = <>
    <label><input type="checkbox" checked={gap} onChange={e => {
      const on = e.currentTarget.checked;
      setGap(on);
      setShowTrades(false);
      // Link zablokowany przez zapisaną lukę SIM: wyłączenie przełącznika świadomie zastępuje flagę z zapisu
      if (!on && !question && initial?.reason === 'tape-gap' && linkSim?.tapeGap && link?.anchor) {
        const open = resolveChronographAnchor(link.anchor, { tapeGap: false });
        const trade = open.kind === 'resolved' ? open : null;
        if (trade) {
          setPriceTape(true);
          setPair(trade.drop ? `${trade.drop.side}:${trade.drop.before.t}:${trade.drop.after.t}` : null);
          setNotice(null);
          setQuestion(trade.trade);
        }
      }
    }} />{tr('SIM · luka taśmy', 'SIM · tape gap')}</label>
    {(priceTape || bookGap) && kind === 'level' && <label><input type="checkbox" checked={bookGap} onChange={e => setBookGap(e.currentTarget.checked)} />
      {tr('SIM · brak ciągłości arkusza', 'SIM · incomplete book coverage')}</label>}
  </>;
  return <>
    <p className="oc-replay-label"><strong>{tr('Nagranie BTC · 20.11.2026', 'BTC recording · 20 Nov 2026')}</strong> ·{' '}
      {chronoTime(through - ARCHIVE_WINDOW_MS)} – {chronoTime(through)} UTC ·{' '}
      <a href={demoSource} target="_blank" rel="noreferrer">{tr('Publiczne archiwum', 'Public archive')}</a></p>
    <Chronograph key={windows[example]} source={{ ...clip, bookCoverage: bookGap ? noBookCoverage : clip.bookCoverage,
      through, fmtPx: formatPrice, unit: 'BTC', sizeDecimals: 5, bookFresh: false, recorded: true }}
      demoControls={controls} trial={trial} excerpt={excerpt} showSideFilter={kind !== 'flip'}
      tapeQuestion={kind === 'level' ? {
        control: <button type="button" className="oc-question-filter" aria-pressed={priceTape} onClick={() => {
          if (priceTape) setBookGap(false);
          setPriceTape(!priceTape);
        }}>
          {tr('Taśma przy', 'Tape at')} {formatPrice(LEVEL_TEST_PRICE)} USD
        </button>,
        price: priceTape ? LEVEL_TEST_PRICE : null,
        open: (trade, trigger) => {
          questionTrigger.current = trigger;
          setPair(null);
          setNotice(null);
          setQuestion(trade);
        },
      } : undefined}
      initialMinimum={kind === 'flip' ? 100_000 : 0} initialPrice={kind === 'level' ? LEVEL_TEST_PRICE : 61_874} fixedWindow={ARCHIVE_WINDOW_MS} />
    {linkSim && ((linkSim.tapeGap && gap) || (linkSim.bookGap && bookGap)) && <p className="oc-question-notice oc-sim-origin" role="status">
      <span className="oc-sim-tag">SIM</span>{' '}{tr('Ten link zapisano z włączoną symulacją', 'This link was saved with the simulation switched on')}:{' '}
      {[linkSim.tapeGap && gap && tr('luka taśmy', 'tape gap'), linkSim.bookGap && bookGap && tr('brak ciągłości arkusza', 'incomplete book coverage')].filter(Boolean).join(' · ')}.{' '}
      {tr('Przełączniki ustawiono jak przy zapisie. To nie są luki w nagraniu.', 'The switches are set as when it was saved. These are not gaps in the recording.')}
    </p>}
    {notice && <p className="oc-question-notice" role="status">
      {notice}{' '}<button type="button" onClick={() => setNotice(null)}>{tr('Zamknij', 'Close')}</button>
    </p>}
    {question && choices && <TradeOrderQuestion key={`${question.t}:${question.tid}`} trade={question} choices={choices} tapeCoverage={clip.coverage}
      initialPair={pair} onPair={setPair} pairNote={bookGap || !initial?.reason?.startsWith('book-gap') ? pairNote : null}
      evidence={CHRONOGRAPH_V1_EVIDENCE}
      simulation={gap || bookGap ? { tapeGap: gap, bookGap, fromLink: !!linkSim && (!gap || linkSim.tapeGap) && (!bookGap || linkSim.bookGap) } : null}
      source={{ label: tr('Nagranie publiczne BTC 20.11.2026 (archiwum v1)', 'Public BTC recording 20 Nov 2026 (archive v1)'), revision: CHRONOGRAPH_CLIP_REVISION, receiptTime: CHRONOGRAPH_V1_EVIDENCE.receiptTime }}
      reveal={nextSnapshot === undefined ? undefined : () => setRevealedThrough(nextSnapshot + 1)}
      dismiss={() => {
        const opened = question;
        const trigger = questionTrigger.current?.isConnected ? questionTrigger.current
          : document.querySelector<HTMLButtonElement>(`[data-oc-question-trade="${opened.tid}"]`);
        questionTrigger.current = null;
        setQuestion(null);
        requestAnimationFrame(() => {
          const target = trigger?.isConnected ? trigger : document.querySelector<HTMLButtonElement>(`[data-oc-question-trade="${opened.tid}"]`);
          if (!target) return;
          target.focus({ preventScroll: true });
          target.closest('tr')?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        });
      }} />}
  </>;
}
