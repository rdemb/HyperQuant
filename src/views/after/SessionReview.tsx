import React, { useEffect, useId, useState } from 'react';
import { History } from 'lucide-react';
import { Badge, DASH, EmptyState, Panel, sourceTag } from '../../ui';
import { sessionExpectedOf } from '../../charts/pro/chart/layoutInputs';
import { fmtDm, fmtHm } from '../../charts/pro/core/time';
import { storeFor } from '../../charts/pro/store/proStore';
import { startRecording } from '../../charts/pro/store/recording';
import { useStoreVersion } from '../../charts/pro/store/useStoreVersion';
import { useBlogMaps } from '../../state/useBlogMaps';
import { useCohortFlow } from '../../state/useCohortFlow';
import { useDeskLedger } from '../../state/useDeskLedger';
import { useLiqTape } from '../../state/useLiqTape';
import type { TradeSession } from '../../utils/sessionDay';
import { TRADE_SESSION_NAME } from '../../utils/sessionNames';
import { type ReviewCard, type ReviewRow, reviewCards, reviewRows } from '../../utils/sessionReview';
import { cardBars1m } from './reviewInputs';
import { reviewReplay } from './reviewReplay';
import { tr } from '../../i18n';

/** Bez zmian w magazynie (cisza, brak połączenia) i tak co tyle przeliczamy: koniec sesji zmienia karty. */
const TICK_MS = 30_000;

/**
 * Rozliczenie sesji (Po sesji, `#rozliczenie`): karty ostatniej zamkniętej sesji Londynu i NY oraz sesji w toku (w Azji
 * zamiast niej godzina następnego otwarcia). Wiersze z `reviewRows`; wiersze z okna danych innego niż sesja (stożek 30 dni,
 * kohorty 24 h) raz, pod kartami. Tylko BTC (mapy z bloga, taśma likwidacji, kohorty i dziennik opisują BTC).
 */
export const SessionReview: React.FC = () => {
  const store = storeFor('BTC');
  useEffect(() => startRecording(store), [store]);
  useStoreVersion(store, 2_000);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const maps = useBlogMaps(true);
  const liq = useLiqTape();
  const cohorts = useCohortFlow();
  const ledger = useDeskLedger();

  const now = store.serverNow();
  const { cards, next } = reviewCards(now);
  const all = cards.map((card) => {
    // Świece każdej karty osobno: brak starszych minut wygasza tylko karty, które ich potrzebują
    const bars1m = cardBars1m(store, card.s, now);
    // Oczekiwany zakres z chwili otwarcia sesji (świece 1h sprzed niego), ten sam w toku i po zamknięciu
    const expected = sessionExpectedOf(store, card.s);
    return { card, rows: reviewRows({ s: card.s, inProgress: card.inProgress, now, bars1m, maps, expected, liq, cohorts, ledger }) };
  });
  const windowRows = all[0]?.rows.filter((r) => r.scope === 'window') ?? [];

  return (
    <section id="rozliczenie" aria-labelledby="po-rozliczenie" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="po-rozliczenie" className="text-sm font-semibold text-ink-1">
          {tr('Rozliczenie sesji', 'Session review')} <span className="font-normal text-ink-3">· BTC</span>
        </h2>
        <p className="text-[11px] leading-snug text-ink-3">
          {tr(
            'Dzień tradera to sesja: Londyn od 08:00 czasu londyńskiego, NY od 09:30 czasu nowojorskiego, IB to pierwsza godzina. Opis, nie sygnał.',
            'The trading day is a session: London from 08:00 London time, NY from 09:30 New York time, the IB is the first hour. A description, not a signal.'
          )}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {all.map(({ card, rows }) => (
          <SessionCard key={`${card.s.id}-${card.s.start}`} card={card} rows={rows.filter((r) => r.scope === 'session')} now={now} />
        ))}
        {next && <NextSession s={next} />}
      </div>
      {windowRows.length > 0 && (
        <Panel eyebrow={tr('Poza sesją', 'Outside the session')} title={tr('Okna danych dziennika i skanera', 'Ledger and scanner data windows')}>
          <div className="grid grid-cols-1 gap-x-6 px-4 py-1 sm:grid-cols-2">
            {windowRows.map((r) => (
              <RowView key={r.key} row={r} replay={null} />
            ))}
          </div>
        </Panel>
      )}
    </section>
  );
};

const SessionCard: React.FC<{ card: ReviewCard; rows: ReviewRow[]; now: number }> = ({ card, rows, now }) => {
  const { s, inProgress } = card;
  return (
    <Panel
      eyebrow={`${fmtHm(s.start)}–${fmtHm(s.end)} · ${inProgress ? tr('sesja trwa', 'running') : tr('zamknięta', 'closed')}`}
      title={`${TRADE_SESSION_NAME[s.id]} · ${fmtDm(s.start)}`}
      actions={
        inProgress ? (
          <Badge tone="neutral" title={tr('Sesja trwa: wiersze mogą się jeszcze zmienić', 'The session is running: the rows may still change')}>
            {tr('w toku', 'in progress')}
          </Badge>
        ) : undefined
      }
    >
      <div className="px-4 py-1">
        {rows.map((r) => (
          <RowView key={r.key} row={r} replay={reviewReplay(r.replayAt, s, now)} />
        ))}
      </div>
    </Panel>
  );
};

/** Sesja azjatycka: zamiast karty „w toku” godzina następnego otwarcia. */
const NextSession: React.FC<{ s: TradeSession }> = ({ s }) => (
  <Panel eyebrow={tr('Sesja azjatycka', 'Asian session')}>
    <EmptyState
      title={tr(`${TRADE_SESSION_NAME[s.id]} otwiera ${fmtDm(s.start)} o ${fmtHm(s.start)}`, `${TRADE_SESSION_NAME[s.id]} opens on ${fmtDm(s.start)} at ${fmtHm(s.start)}`)}
      detail={tr(
        'Teraz nie trwa sesja Londynu ani NY, więc nie ma karty „w toku”. Pojawi się z otwarciem sesji.',
        'Neither the London nor the NY session is running now, so there is no “in progress” card. It appears when the session opens.'
      )}
    />
  </Panel>
);

/**
 * Wiersz: podpis, wartość z plakietką (przy „—” bez plakietki źródła) i powodem braku; dotknięcie rozwija źródło liczby;
 * obok link do powtórki minuty.
 */
export const RowView: React.FC<{ row: ReviewRow; replay: string | null }> = ({ row, replay }) => {
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const missing = row.value === DASH;
  // Wspólna reguła plakietki (ui/sourceTag): „—” bez plakietki źródła, wynik z luką w tonie nieaktualnym
  const tag = sourceTag({ value: row.value, badge: row.badge, partial: !!row.why });
  return (
    <div className="py-2 border-t border-line first:border-t-0">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={hintId}
          title={row.hint}
          className="flex-1 min-w-0 -mx-1 px-1 rounded-md text-left hover:bg-surface-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="block text-[10.5px] uppercase tracking-[0.08em] leading-snug text-ink-3 font-medium">{row.label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {/* Krój zwykły (cyfry proporcjonalne): wartości to zdania z liczbami, nie kolumna liczb (w tym CSS tabular-nums = mono) */}
            <span className={`text-[13px] font-medium ${missing ? 'text-ink-3' : 'text-ink-1'}`}>{row.value}</span>
            {tag && <Badge tone={tag.tone}>{tag.text}</Badge>}
            {row.why && <span className={`text-[11px] leading-snug ${missing ? 'text-ink-3' : 'text-warn'}`}>{row.why}</span>}
          </span>
        </button>
        {replay && (
          <a
            href={replay}
            title={tr(`Powtórka na wykresie W sesji od ${fmtHm(row.replayAt!)}`, `Replay on the In session chart from ${fmtHm(row.replayAt!)}`)}
            aria-label={tr(`Powtórka: ${row.label}, ${fmtHm(row.replayAt!)}`, `Replay: ${row.label}, ${fmtHm(row.replayAt!)}`)}
            className="shrink-0 inline-flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-md border border-line text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <History className="w-4 h-4" aria-hidden="true" />
          </a>
        )}
      </div>
      {row.detail && <p className="mt-1 text-[11px] leading-snug text-ink-2 break-words">{row.detail}</p>}
      {/* Źródło liczby; gdy jest tylko powód braku (już widoczny obok „—”), nic więcej */}
      <p id={hintId} hidden={!open} className="mt-1 text-[11px] leading-snug text-ink-3">
        {row.hint === row.why ? tr('Brak liczby — powód obok.', 'No number — the reason is shown alongside.') : row.hint}
      </p>
    </div>
  );
};
