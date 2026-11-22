import { ChevronLeft, ChevronRight, History, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { FOCUSABLE } from '../../charts/pro/chart/dialogFocus';
// Nagranie i powtórka (moduły wykresu) ładowane dopiero po kliknięciu: karta pierwszego kontaktu to element LCP W sesji
type Market = string;
import { tr } from '../../i18n';
import { dismissOnEscape, markSeen, quickReplay, quickReplayVisible, startOnboarding, tipsPending } from '../../utils/onboarding';
import { capsOf } from '../../state/markets';

/** Pamięć przeglądarki; null, gdy zablokowana (wtedy nic się nie pokazuje). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Pierwszy widoczny element do fokusu za kartą w kolejności dokumentu (przycisk powtórki 15 min, a bez niego pierwszy
 * przycisk wykresu): tam przechodzi fokus po zamknięciu karty, zamiast przepaść w dokumencie.
 */
function focusAfter(card: HTMLElement): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.tabIndex < 0 || card.contains(el) || !(card.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

/** Trzy krótkie objaśnienia (bez słów kupno/sprzedaż). */
const TIPS: readonly { pl: string; en: string }[] = [
  { pl: 'Footprint: w każdej świecy ilość zleceń po stronie bid i ask na każdej cenie. Pokazuje, gdzie handel był gęsty.', en: 'Footprint: inside each candle, the bid and ask volume at every price. It shows where trading was dense.' },
  { pl: 'Mapa ciepła: jasność to wielkość zleceń w arkuszu na danej cenie. Legenda przy wykresie mówi, co oznacza skala.', en: 'Heatmap: brightness is the size of resting orders in the book at a price. The chart legend explains the scale.' },
  { pl: 'LIVE to liczba z giełdy w tej chwili; MODEL to szacunek z naszego modelu; SIM to symulacja. Nie mieszamy ich.', en: 'LIVE is a number from the exchange right now; MODEL is an estimate from our model; SIM is a simulation. We never mix them.' },
];

/**
 * Pierwszy kontakt na ekranie W sesji. Dymki: jedna mała karta z trzema numerowanymi punktami nad wykresem — kotwiczenie
 * przy footprincie, legendzie mapy ciepła i plakietce LIVE/MODEL zależy od układu i szerokości (zasłaniałoby oś cen
 * albo dolną nawigację na telefonie), a karta w przepływie strony nie zasłania niczego. Nie jest oknem modalnym:
 * Esc (przy fokusie w karcie) albo „Rozumiem” zamyka i zapisuje `hq.onboarding.v1`. Obok (przez 7 dni od pierwszej wizyty) przycisk powtórki
 * ostatnich 15 minut; na rynku innym niż BTC albo bez nagrania mówi, dlaczego nie otwiera powtórki.
 */
export const FirstContact: React.FC<{ coin: Market }> = ({ coin }) => {
  const [store] = useState(storage);
  // Pierwszą wizytę zapisuje już start aplikacji (DeskProvider), zanim wykres zapisze klucze hq.charts.*; tu powtórzone
  // na wszelki wypadek przy pierwszym renderze (zapis jest idempotentny, więc podwójny render go nie psuje)
  const [tips, setTips] = useState(() => {
    if (!store) return false;
    startOnboarding(store, Date.now());
    return tipsPending(store);
  });
  const [now] = useState(() => Date.now());
  const cardRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  // Przewodnik w jednym wierszu: jedna wskazówka naraz, strzałki i postęp linią wody
  const [krok, setKrok] = useState(0);

  // Zamknięcie z fokusem w karcie (Esc, „Rozumiem”, krzyżyk): fokus na następny element za kartą
  const next = useRef<HTMLElement | null>(null);
  const close = () => {
    const card = cardRef.current;
    next.current = card && card.contains(document.activeElement) ? focusAfter(card) : null;
    if (store) markSeen(store, Date.now());
    setTips(false);
  };
  useEffect(() => {
    if (tips || !next.current) return;
    if (next.current.isConnected) next.current.focus();
    next.current = null;
  }, [tips]);
  const showReplay = store !== null && (tips || quickReplayVisible(store, now));
  if (!tips && !showReplay) return null;

  const openReplay = async () => {
    if (busy) return;
    setBusy(true);
    setWhy(null);
    if (typeof DecompressionStream === 'undefined') {
      setBusy(false);
      setWhy(tr('Ta przeglądarka nie odczyta nagrania — użyj nowszej wersji.', 'This browser cannot read the recording — use a newer version.'));
      return;
    }
    const [{ fetchIndex }, { replayBase }] = await Promise.all([import('../../charts/pro/replay/data'), import('../../charts/pro/replay/session')]);
    const base = replayBase('history');
    const index = base ? await fetchIndex(base, (u) => fetch(u, { signal: AbortSignal.timeout(20_000) })) : null;
    const r = quickReplay(coin, capsOf(coin), Date.now(), index);
    setBusy(false);
    if (r.ok) window.location.hash = r.hash;
    else
      setWhy(
        r.reason === 'market'
          ? tr(
              'Powtórka ostatnich 15 min jest dla rynków z pełnym skanerem (nagranie serwera) — zmień rynek wykresu, np. na BTC.',
              'The last-15-minutes replay exists for markets with the full scanner (the server recording) — switch the chart market, e.g. to BTC.'
            )
          : tr('Serwer nie ma teraz nagrania z ostatnich 15 min — spróbuj za chwilę.', 'The server has no recording of the last 15 minutes right now — try again shortly.')
      );
  };

  const replayLabel = tr('Powtórka ostatnich 15 min', 'Replay the last 15 min');
  const replayButton = showReplay && (
    <button
      type="button"
      onClick={openReplay}
      disabled={busy}
      aria-label={replayLabel}
      title={replayLabel}
      className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-lg bg-surface-3 border border-line-strong font-medium text-ink-1 hover:bg-surface-1 disabled:opacity-60"
    >
      <History className="w-4 h-4" aria-hidden />
      <span className={tips ? 'hidden min-[360px]:inline' : undefined}>{tips ? tr('Powtórka', 'Replay') : replayLabel}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {tips && (
        <section
          ref={cardRef}
          onKeyDown={(e) => {
            dismissOnEscape(e, cardRef.current, close);
            if (e.key === 'ArrowRight' && krok < TIPS.length - 1) setKrok(krok + 1);
            if (e.key === 'ArrowLeft' && krok > 0) setKrok(krok - 1);
          }}
          aria-label={tr('Jak czytać ten ekran', 'How to read this screen')}
          className="hq-przewodnik hq-spot relative overflow-hidden flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 rounded-2xl pl-3 pr-1.5 py-1.5 text-xs"
        >
          <h2 className="sr-only">{tr('Jak czytać ten ekran', 'How to read this screen')}</h2>
          <span className="shrink-0 font-mono text-[10px] font-semibold tracking-wider text-ink-3" aria-hidden="true">
            {krok + 1}/{TIPS.length}
          </span>
          <p key={krok} aria-live="polite" className="hq-przewodnik-krok order-last sm:order-none basis-full sm:basis-auto flex-1 min-w-0 m-0 text-ink-2 leading-snug">
            <span className="sr-only">{tr(`Wskazówka ${krok + 1} z ${TIPS.length}: `, `Tip ${krok + 1} of ${TIPS.length}: `)}</span>
            {tr(TIPS[krok].pl, TIPS[krok].en)}
          </p>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {replayButton}
            <button
              type="button"
              onClick={() => setKrok(krok - 1)}
              disabled={krok === 0}
              aria-label={tr('Poprzednia wskazówka', 'Previous tip')}
              className="grid place-items-center w-11 h-11 sm:w-8 sm:h-8 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-3 disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            {krok < TIPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setKrok(krok + 1)}
                className="min-h-11 sm:min-h-8 px-3 inline-flex items-center gap-1 rounded-lg bg-surface-3 border border-line-strong font-medium text-ink-1 hover:bg-surface-1"
              >
                {tr('Dalej', 'Next')}
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button type="button" onClick={close} className="min-h-11 sm:min-h-8 px-3 rounded-lg bg-lume text-[#0c0d0f] font-semibold hover:brightness-105">
                {tr('Rozumiem', 'Got it')}
              </button>
            )}
            <button type="button" onClick={close} aria-label={tr('Zamknij', 'Close')} className="grid place-items-center w-11 h-11 sm:w-8 sm:h-8 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3">
              <X className="w-4 h-4" />
            </button>
          </div>
          <span aria-hidden="true" className="hq-przewodnik-postep absolute left-0 bottom-0 h-0.5 rounded-full bg-lume" style={{ width: `${((krok + 1) / TIPS.length) * 100}%` }} />
        </section>
      )}
      {showReplay && !tips && <div className="flex text-xs">{replayButton}</div>}
      {why && <p role="status" className="text-xs text-ink-2">{why}</p>}
    </div>
  );
};
