import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Radio } from 'lucide-react';
import { ProChart } from '../ProChart';
import { loadStation, stationById } from '../chart/stations';
import type { ReplayLink } from './link';
import { ReplaySession } from './session';

const none = () => () => {};

/**
 * Widok powtórki (#charts?replay=…): wczytuje nagranie z linku i pokazuje je na jednym wykresie z paskiem odtwarzania.
 * Bez stacji w linku wygląd z bieżącej stacji (zapisane ustawienia pierwszego panelu), a z linku — z wzorca stacji.
 */
export const ReplayView: React.FC<{ link: ReplayLink }> = ({ link }) => {
  const [session, setSession] = useState<ReplaySession | null>(null);
  useEffect(() => {
    const s = new ReplaySession({ source: link.source, coin: link.coin, from: link.from, to: link.to, t: link.t });
    setSession(s);
    void s.load();
    return () => s.close();
    // Nowa powtórka tylko dla innego nagrania albo chwili; wygląd z linku czyta wykres przy starcie
  }, [link.source, link.coin, link.from, link.to, link.t]);
  useSyncExternalStore(session?.subscribe ?? none, () => (session ? `${session.state}:${session.storeGen}:${session.progress.done}` : ''));
  const [station] = useState(() => (link.station ? stationById(link.station) : loadStation()));

  const exit = () => {
    window.location.hash = '#charts';
  };
  const store = session?.store;
  if (!session || session.state !== 'ready' || !store) return <ReplayStatus session={session} onExit={exit} />;
  return (
    <ProChart
      station={station}
      coin={link.coin}
      fromLink={false}
      replay={{ session, store, link, onExit: exit }}
    />
  );
};

const ReplayStatus: React.FC<{ session: ReplaySession | null; onExit: () => void }> = ({ session, onExit }) => {
  const state = session?.state ?? 'loading';
  const { done, total } = session?.progress ?? { done: 0, total: 0 };
  const title =
    state === 'loading'
      ? total > 0
        ? `Wczytuję nagranie: ${done} z ${total} godzin i części`
        : 'Wczytuję spis nagrań…'
      : state === 'empty'
        ? 'Brak nagrania w tym zakresie'
        : 'Nie udało się wczytać nagrania';
  const note =
    state === 'empty'
      ? 'Serwer nagrywa taśmę i arkusz Hyperliquid i trzyma je 7 dni. Ten rynek albo zakres z linku nie ma jeszcze nagrania.'
      : state === 'error'
        ? 'Sprawdź połączenie lub rozszerzenia blokujące pobieranie plików nagrania.'
        : 'Taśma transakcji i migawki arkusza z serwera, potem wykres od wybranej chwili.';
  return (
    <div className="rounded-xl border border-line-strong bg-surface-1 h-[calc(100dvh-11.75rem)] sm:h-[calc(100dvh-16.5rem)] lg:h-[calc(100dvh-12rem)] min-h-[440px] grid place-items-center p-4">
      <div role="status" className="max-w-sm w-full rounded-xl border border-line-strong bg-surface-2 px-4 py-3 text-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Powtórka</div>
        <div className="mt-1 font-medium text-ink-1">{title}</div>
        <p className="mt-1 text-xs text-ink-3 leading-relaxed">{note}</p>
        {state === 'loading' && total > 0 && (
          <div className="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
        )}
        {state !== 'loading' && (
          <button
            type="button"
            onClick={onExit}
            className="mt-2 inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg bg-surface-3 border border-line-strong text-xs font-medium hover:bg-surface-1"
          >
            <Radio className="w-4 h-4" />
            Wróć na żywo
          </button>
        )}
      </div>
    </div>
  );
};
