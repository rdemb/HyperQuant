import { History, X } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { fetchIndex } from '../../charts/pro/replay/data';
import { replayBase } from '../../charts/pro/replay/session';
import type { Market } from '../../charts/pro/store/proStore';
import { tr } from '../../i18n';
import { dismissOnEscape, markSeen, quickReplay, quickReplayVisible, startOnboarding, tipsPending } from '../../utils/onboarding';

/** Pamięć przeglądarki; null, gdy zablokowana (wtedy nic się nie pokazuje). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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
  // Ustalane i zapisywane przy pierwszym renderze, przed efektami wykresu, który sam zapisuje klucze hq.charts.*
  // (po nich nie byłoby już widać pierwszej wizyty); zapis jest idempotentny, więc podwójny render go nie psuje
  const [tips, setTips] = useState(() => {
    if (!store) return false;
    startOnboarding(store, Date.now());
    return tipsPending(store);
  });
  const [now] = useState(() => Date.now());
  const cardRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  const close = () => {
    if (store) markSeen(store, Date.now());
    setTips(false);
  };
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
    const base = replayBase('history');
    const index = base ? await fetchIndex(base, (u) => fetch(u, { signal: AbortSignal.timeout(20_000) })) : null;
    const r = quickReplay(coin, Date.now(), index);
    setBusy(false);
    if (r.ok) window.location.hash = r.hash;
    else
      setWhy(
        r.reason === 'market'
          ? tr('Powtórka ostatnich 15 min jest tylko dla BTC — zmień rynek wykresu na BTC.', 'The last-15-minutes replay is BTC only — switch the chart market to BTC.')
          : tr('Serwer nie ma teraz nagrania z ostatnich 15 min — spróbuj za chwilę.', 'The server has no recording of the last 15 minutes right now — try again shortly.')
      );
  };

  return (
    <div className="flex flex-col gap-2">
      {tips && (
        <section ref={cardRef} onKeyDown={(e) => dismissOnEscape(e, cardRef.current, close)} aria-label={tr('Jak czytać ten ekran', 'How to read this screen')} className="rounded-xl border border-line-strong bg-surface-2 p-3 text-xs">
          <div className="flex items-start gap-2">
            <h2 className="flex-1 font-semibold text-ink-1">{tr('Jak czytać ten ekran', 'How to read this screen')}</h2>
            <button type="button" onClick={close} aria-label={tr('Zamknij', 'Close')} className="shrink-0 grid place-items-center w-11 h-11 sm:w-8 sm:h-8 -m-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface-3">
              <X className="w-4 h-4" />
            </button>
          </div>
          <ol className="mt-1 grid gap-2 sm:grid-cols-3 list-none p-0">
            {TIPS.map((t, i) => (
              <li key={i} className="flex gap-2 text-ink-2 leading-snug">
                <span aria-hidden className="shrink-0 grid place-items-center w-5 h-5 rounded-full bg-surface-3 text-ink-1 font-semibold">
                  {i + 1}
                </span>
                <span>{tr(t.pl, t.en)}</span>
              </li>
            ))}
          </ol>
          <button type="button" onClick={close} className="mt-2 min-h-11 sm:min-h-8 px-3 rounded-lg bg-surface-3 border border-line-strong font-medium text-ink-1 hover:bg-surface-1">
            {tr('Rozumiem', 'Got it')}
          </button>
        </section>
      )}
      {showReplay && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={openReplay}
            disabled={busy}
            className="min-h-11 sm:min-h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface-3 border border-line-strong font-medium text-ink-1 hover:bg-surface-1 disabled:opacity-60"
          >
            <History className="w-4 h-4" aria-hidden />
            {tr('Powtórka ostatnich 15 min', 'Replay the last 15 min')}
          </button>
          {why && (
            <span role="status" className="text-ink-2">
              {why}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
