import { useEffect, useId, useMemo, useState } from 'react';
import { tr } from '../../i18n';
import { fmtFixed } from '../../ui/format';
import type { ArchiveChannel, VerifiedReplay } from '../../charts/pro/replay/archive';
import { latestExactArchiveBookAt } from '../../charts/pro/replay/archiveBookReading';
import { resolveArchiveObservation, type ArchiveObservationAnchor } from '../../charts/pro/replay/archiveAnchor';
import { loadBtcArchiveExample, PUBLIC_BTC_08, PUBLIC_BTC_08_BASE } from '../../charts/pro/replay/archiveExample';
import type { Fetcher } from '../../charts/pro/store/serverHistory';
import { chronoTime } from './Chronograph';
import { LevelReading } from './LevelReading';
import { Coverage } from '../../charts/pro/core/coverage';
import { findReplayWindows } from './replayQuestions';
import './tradeOrderQuestion.css';

/**
 * Wejście do przypiętej, zweryfikowanej godziny BTC 08:00–09:00 UTC (20.11.2026).
 * Taśma i arkusz mają osobne wyniki:
 * odrzucenie jednego kanału nie wyłącza drugiego. Archiwum v1 nie podaje czasu odbioru ani dowodu ciągłości.
 */
const price = new Intl.NumberFormat('pl-PL');
const at = (t: number) => `${chronoTime(t)} UTC`;
const hm = (t: number) => new Date(t).toISOString().slice(11, 16);

// Przypięta obserwacja (kupno 0,02415 BTC po 61 972 USD i dwa pomiary ASK)
const OBS: Omit<ArchiveObservationAnchor, 'cursorMs'> = {
  version: 1, source: 'hyperliquid/BTC-perp', revision: PUBLIC_BTC_08.revision,
  sha256: { trades: PUBLIC_BTC_08.files.trades.sha256, book: PUBLIC_BTC_08.files.book.sha256 },
  trade: { eventAtMs: 1795163407089, tid: '218491795194486', price: 61972, size: 0.02415, side: 1 },
  book: { side: 'ask', beforeMs: 1795163404733, afterMs: 1795163416997 },
};

type Sim = 'none' | 'drop-book' | 'corrupt-trades';

function simFetcher(sim: Sim): Fetcher | undefined {
  if (sim === 'none') return undefined;
  return async (url) => {
    if (sim === 'drop-book' && url.includes('.book.')) return new Response(null, { status: 404 });
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (sim === 'corrupt-trades' && url.includes('.trades.') && res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      bytes[bytes.length >> 1] ^= 0xff; // jeden bajt, ten sam rozmiar
      return new Response(bytes, { status: 200 });
    }
    return res;
  };
}

function channelText(c: ArchiveChannel): { ok: boolean; head: string; lines: string[] } {
  if (c.kind === 'verified') return {
    ok: true, head: tr('Zweryfikowane', 'Verified'),
    lines: [
      tr(`SHA-256 i rozmiar zgodne z manifestem · ${c.observations.toLocaleString('pl-PL')} zapisów`, `SHA-256 and size match the manifest · ${c.observations.toLocaleString('en-GB')} records`),
      tr(`Zakres zadeklarowany: ${c.declaredSpans.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(', ') || '—'} UTC · luki zadeklarowane: ${c.declaredGaps.length}`,
        `Declared range: ${c.declaredSpans.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(', ') || '—'} UTC · declared gaps: ${c.declaredGaps.length}`),
      tr('Ciągłość transportu: niezweryfikowana (archiwum v1)', 'Transport continuity: unverified (archive v1)'),
    ] };
  const why: Record<string, string> = {
    missing: tr('brak pliku', 'file missing'), 'read-failed': tr('nie udało się odczytać', 'read failed'),
    'integrity-mismatch': tr('suma SHA-256 lub rozmiar niezgodne z manifestem', 'SHA-256 or size does not match the manifest'),
    'invalid-gzip-or-json': tr('uszkodzony gzip lub JSON', 'damaged gzip or JSON'), 'unsupported-version': tr('nieobsługiwana wersja', 'unsupported version'),
    'scope-mismatch': tr('inny rynek lub zakres niż w manifeście', 'market or range differs from the manifest'), 'invalid-records': tr('niepoprawne rekordy', 'invalid records'),
  };
  return { ok: false, head: tr('Odrzucone', 'Rejected'), lines: [why[c.kind] ?? c.kind, tr('Ten kanał nie jest używany; drugi działa niezależnie.', 'This channel is not used; the other works independently.')] };
}

const reasonText = (r: string) => ({
  'trade-unavailable': tr('taśma odrzucona', 'tape rejected'), 'trade-missing': tr('brak transakcji w tej wersji', 'trade not in this version'),
  'trade-conflict': tr('pod kluczem jest inna transakcja', 'a different trade sits under the key'), 'after-cursor': tr('migawka B jest po kursorze', 'snapshot B is after the cursor'),
  'tape-gap': tr('poza zadeklarowanym zakresem taśmy', 'outside the declared tape range'), 'book-gap': tr('poza zadeklarowanym zakresem arkusza', 'outside the declared book range'),
  'book-unavailable': tr('arkusz odrzucony', 'book rejected'), 'book-missing': tr('brak tej pary migawek', 'this snapshot pair is missing'),
  'wrong-revision': tr('inna wersja nagrania', 'another recording version'), 'wrong-source': tr('inne źródło', 'another source'), 'invalid-anchor': tr('uszkodzona kotwica', 'damaged anchor'),
} as Record<string, string>)[r] ?? r;

const SKIP: Record<string, string> = {
  unread: tr('kanał nieodczytany (plik odrzucony)', 'channel unread (file rejected)'), 'tape-gap': tr('luka taśmy', 'tape gap'),
  'book-snapshot': tr('brak dokładnej migawki na granicy okna', 'no exact snapshot at the window edge'), 'book-stale': tr('migawka graniczna starsza niż 5 s', 'edge snapshot older than 5 s'),
  'book-level': tr('brak odczytu poziomu w migawce', 'level not readable in the snapshot'), 'book-gap': tr('brak pokrycia arkusza', 'book coverage missing'),
};

// „Znajdź 30 s do sprawdzenia” (UI Designera do `findReplayWindows` Kodera): od chwili kursora, pierwsze okno z kompletem danych dla pytania
function FindWindow({ replay, cursor }: { replay: VerifiedReplay; cursor: number }) {
  const radioName = useId();
  const [question, setQuestion] = useState<'delta' | 'delta-and-book'>('delta');
  const res = useMemo(() => {
    const end = replay.manifest.to;
    const unread = { tape: replay.trades.kind === 'verified' ? undefined : [[replay.manifest.from, end]] as [number, number][],
      book: replay.book.kind === 'verified' ? undefined : [[replay.manifest.from, end]] as [number, number][] };
    // Pokrycie z zadeklarowanych odcinków zweryfikowanego kanału minus zadeklarowane luki (archiwum v1: ciągłość niezweryfikowana)
    const declared = (c: ArchiveChannel) => {
      if (c.kind !== 'verified') return new Coverage();
      let spans: [number, number][] = c.declaredSpans.map(([a, b]) => [a, b]);
      for (const [ga, gb] of c.declaredGaps) spans = spans.flatMap(([a, b]): [number, number][] => gb <= a || ga >= b ? [[a, b]] : [[a, ga], [gb, b]].filter(([x, y]) => y > x) as [number, number][]);
      return new Coverage(spans);
    };
    return findReplayWindows({ from: cursor, to: end, question: question === 'delta' ? { kind: 'delta' } : { kind: 'delta-and-book', side: 'ask', price: OBS.trade.price },
      tape: declared(replay.trades), book: declared(replay.book), frames: replay.data.frames, unread });
  }, [replay, cursor, question]);
  return <div className="oc-archive-obs" aria-live="polite">
    <h4>{tr('Znajdź 30 s do sprawdzenia', 'Find 30 s to check')}</h4>
    <div role="radiogroup" aria-label={tr('Pytanie', 'Question')} className="oc-archive-q">
      <label><input type="radio" name={radioName} checked={question === 'delta'} onChange={() => setQuestion('delta')} />{tr('Delta taśmy', 'Tape delta')}</label>
      <label><input type="radio" name={radioName} checked={question === 'delta-and-book'} onChange={() => setQuestion('delta-and-book')} />
        {tr(`Delta i ASK przy ${price.format(OBS.trade.price)} USD`, `Delta and ASK at ${price.format(OBS.trade.price)} USD`)}</label>
    </div>
    <p>{res.first
      ? tr(`Pierwsze okno od kursora: ${at(res.first.from)} – ${at(res.first.to)} · okien w zadeklarowanym pokryciu: ${res.qualified}`, `First window from the cursor: ${at(res.first.from)} – ${at(res.first.to)} · windows within declared coverage: ${res.qualified}`)
      : tr('Brak okna w zadeklarowanym pokryciu w sprawdzonym zakresie (do końca godziny).', 'No window within declared coverage in the checked range (to the end of the hour).')}</p>
    {res.skipped.length > 0 && <details><summary>{tr(`Pominięte odcinki startów: ${res.skipped.length}`, `Skipped start runs: ${res.skipped.length}`)}</summary>
      <ul className="oc-order-reasons">{res.skipped.slice(0, 8).map(s => <li key={s.from}>{hm(s.from)}:{new Date(s.from).toISOString().slice(17, 19)}–{hm(s.to)}:{new Date(s.to).toISOString().slice(17, 19)} · {s.reasons.map(r => SKIP[r] ?? r).join(', ')}</li>)}</ul>
      {res.skipped.length > 8 && <p className="oc-order-note">{tr(`…i ${res.skipped.length - 8} kolejnych`, `…and ${res.skipped.length - 8} more`)}</p>}
    </details>}
    <p className="oc-order-note">{tr('Okno to start w pełnej sekundzie UTC i 30 s danych. Zakres deklarowany przez archiwum; ciągłość transportu niezweryfikowana.', 'A window starts at a full UTC second and spans 30 s. Range declared by the archive; transport continuity unverified.')}</p>
  </div>;
}

export default function ArchiveHourView({ cursorMs, onCursorChange }: { cursorMs?: number; onCursorChange?: (value: number) => void } = {}) {
  const heading = useId();
  const radioName = useId();
  const [sim, setSim] = useState<Sim>('none');
  const [cursorAfterB, setCursorAfterB] = useState(false);
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; replay: VerifiedReplay }>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    loadBtcArchiveExample(simFetcher(sim) ?? undefined, PUBLIC_BTC_08_BASE)
      .then(replay => { if (alive) setState({ kind: 'ready', replay }); })
      .catch(() => { if (alive) setState({ kind: 'error' }); });
    return () => { alive = false; };
  }, [sim]);
  const afterB = cursorMs === undefined ? cursorAfterB : cursorMs >= OBS.book!.afterMs;
  const cursor = afterB ? OBS.book!.afterMs : OBS.trade.eventAtMs;
  const obs = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const withBook = resolveArchiveObservation(state.replay, { ...OBS, cursorMs: cursor });
    if (withBook.kind === 'resolved') return { trade: withBook, bookNote: null as string | null };
    const tradeOnly = resolveArchiveObservation(state.replay, { ...OBS, book: undefined, cursorMs: cursor });
    return { trade: tradeOnly, bookNote: reasonText(withBook.reason) };
  }, [state, cursor]);
  // Okno taśmy wokół obserwacji: 5 wierszy przed i 6 po, tylko do kursora (bez danych z przyszłości); wiersz obserwacji zawsze w oknie
  const near = useMemo(() => {
    if (state.kind !== 'ready' || state.replay.trades.kind !== 'verified') return [];
    const fills = state.replay.data.fills.filter(f => f.time <= cursor);
    const i = fills.findIndex(f => f.time === OBS.trade.eventAtMs && String(f.tid) === OBS.trade.tid);
    return i < 0 ? fills.slice(-12) : fills.slice(Math.max(0, i - 5), i + 7);
  }, [state, cursor]);

  return <section className="oc-archive" aria-labelledby={heading}>
    <h3 id={heading}>{tr('Zweryfikowane nagranie BTC · 20.11.2026, 08:00–09:00 UTC', 'Verified BTC recording · 20 Nov 2026, 08:00–09:00 UTC')}</h3>
    <p className="oc-order-source">{tr('Publiczne archiwum v1', 'Public archive v1')} · {tr('rewizja', 'revision')} {PUBLIC_BTC_08.revision.slice(0, 12)}… ·{' '}
      {tr('czas odbioru nieznany: odczyty dotyczą zdarzeń na giełdzie, nie tego, co było widać w aplikacji', 'receipt time unknown: readings are exchange events, not what was visible in the app')}</p>
    <fieldset className="oc-archive-sim"><legend>{tr('Symulacja (SIM) do odbioru niezależności kanałów', 'Simulation (SIM) for channel independence checks')}</legend>
      {(['none', 'drop-book', 'corrupt-trades'] as Sim[]).map(s => <label key={s}><input type="radio" name={radioName} checked={sim === s} onChange={() => setSim(s)} />
        {s === 'none' ? tr('Bez symulacji', 'No simulation') : s === 'drop-book' ? tr('SIM · brak pliku L2', 'SIM · L2 file missing') : tr('SIM · jeden bajt taśmy zmieniony', 'SIM · one tape byte changed')}</label>)}
    </fieldset>
    {state.kind === 'loading' && <p role="status">{tr('Weryfikuję pliki nagrania…', 'Verifying recording files…')}</p>}
    {state.kind === 'error' && <p role="status">{tr('Nie udało się wczytać nagrania (manifest lub sieć). Nic nie podstawiono.', 'Could not load the recording (manifest or network). Nothing was substituted.')}</p>}
    {state.kind === 'ready' && <>
      <div className="oc-archive-channels">
        {([['trades', tr('Taśma', 'Tape')], ['book', tr('Arkusz L2', 'L2 book')]] as const).map(([k, label]) => {
          const c = channelText(state.replay[k]);
          return <div key={k} className="oc-archive-channel" data-ok={c.ok} role="group" aria-label={label}>
            <strong>{label} · {c.head}</strong>{c.lines.map((l, i) => <span key={i}>{l}</span>)}
          </div>;
        })}
      </div>
      <div className="oc-archive-obs" aria-live="polite">
        <h4>{tr('Przypięta obserwacja', 'Pinned observation')}</h4>
        <label><input type="checkbox" checked={afterB} onChange={e => {
          const checked = e.currentTarget.checked;
          if (onCursorChange) onCursorChange(checked ? OBS.book!.afterMs : OBS.trade.eventAtMs);
          else setCursorAfterB(checked);
        }} />
          {tr('Kursor po migawce B (08:30:16,997 UTC)', 'Cursor after snapshot B (08:30:16.997 UTC)')}</label>
        {obs && obs.trade.kind === 'resolved'
          ? <p>{tr('Kupno', 'Buy')} {fmtFixed(obs.trade.trade.sz, 5)} BTC {tr('po', 'at')} {price.format(obs.trade.trade.px)} USD · {at(obs.trade.trade.time)} · tid {String(obs.trade.trade.tid)}
            {obs.trade.book ? <> · ASK {price.format(obs.trade.trade.px)}: {fmtFixed(obs.trade.book.before.size, 5)} BTC (A {at(obs.trade.book.before.t)}) → {fmtFixed(obs.trade.book.after.size, 5)} BTC (B {at(obs.trade.book.after.t)})</>
              : <> · {tr('pomiary ASK', 'ASK readings')}: — ({obs.bookNote})</>}</p>
          : <p>{tr('Obserwacja niedostępna', 'Observation unavailable')}: {obs && obs.trade.kind === 'unavailable' ? reasonText(obs.trade.reason) : '—'}. {tr('Nic nie podstawiono.', 'Nothing was substituted.')}</p>}
        <LevelReading recorded frame={latestExactArchiveBookAt(state.replay, cursor)} side="ask" price={OBS.trade.price} unit="BTC" sizeDecimals={5} fmtPx={px => price.format(px)} />
        <p className="oc-order-note">{tr('Różnica ilości nie mówi, czy zlecenia anulowano, czy wykonano, ani kto to zrobił.', 'A size difference does not tell whether orders were cancelled or filled, or by whom.')}</p>
      </div>
      <FindWindow replay={state.replay} cursor={cursor} />
      <table className="oc-archive-tape">
        <caption>{tr('Taśma wokół obserwacji (do kursora)', 'Tape around the observation (up to the cursor)')}</caption>
        <thead><tr><th scope="col">UTC</th><th scope="col">{tr('Strona', 'Side')}</th><th scope="col">{tr('Cena', 'Price')}</th><th scope="col">BTC</th></tr></thead>
        <tbody>{near.length ? near.map(f => <tr key={f.tid} data-oc-anchor={String(f.tid) === OBS.trade.tid || undefined}>
          <td>{chronoTime(f.time)}</td><td>{f.side === 1 ? tr('kupno', 'buy') : tr('sprzedaż', 'sell')}</td><td>{price.format(f.px)}</td><td>{fmtFixed(f.sz, 5)}</td></tr>)
          : <tr><td colSpan={4}>{state.replay.trades.kind === 'verified' ? '—' : tr('— taśma odrzucona', '— tape rejected')}</td></tr>}</tbody>
      </table>
    </>}
  </section>;
}
