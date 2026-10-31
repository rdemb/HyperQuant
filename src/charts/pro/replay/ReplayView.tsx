import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Radio } from 'lucide-react';
import { ProChart } from '../ProChart';
import { stationById } from '../chart/stations';
import { activeTab, loadTabs, presetStation } from '../chart/tabs';
import type { ReplayLink } from './link';
import { ReplaySession } from './session';
import { tr } from '../../../i18n';

const none = () => () => {};

/**
 * Widok powtórki (#charts?replay=…): wczytuje nagranie z linku i pokazuje je na jednym wykresie z paskiem odtwarzania.
 * Bez stacji w linku wygląd z bieżącej karty układu (zapisane ustawienia pierwszego panelu), a z linku — z wzorca stacji.
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
  const [tab] = useState(() => activeTab(loadTabs()));
  const [station] = useState(() => (link.station ? stationById(link.station) : presetStation(tab.preset)));

  const exit = () => {
    window.location.hash = '#charts';
  };
  const store = session?.store;
  if (!session || session.state !== 'ready' || !store) return <ReplayStatus session={session} onExit={exit} />;
  return (
    <ProChart
      station={station}
      tabId={tab.id}
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
        ? tr(`Wczytuję nagranie: ${done} z ${total} godzin i części`, `Loading the recording: ${done} of ${total} hours and parts`)
        : tr('Wczytuję spis nagrań…', 'Loading the list of recordings…')
      : state === 'empty'
        ? tr('Brak nagrania w tym zakresie', 'No recording in this range')
        : tr('Nie udało się wczytać nagrania', 'Could not load the recording');
  const note =
    state === 'empty'
      ? tr(
          'Serwer nagrywa taśmę i arkusz Hyperliquid i trzyma je 7 dni. Ten rynek albo zakres z linku nie ma jeszcze nagrania.',
          'The server records the Hyperliquid tape and book and keeps them for 7 days. This market or the range from the link has no recording yet.'
        )
      : state === 'error'
        ? tr('Sprawdź połączenie lub rozszerzenia blokujące pobieranie plików nagrania.', 'Check your connection or extensions that block downloading the recording files.')
        : tr('Taśma transakcji i migawki arkusza z serwera, potem wykres od wybranej chwili.', 'The trade tape and book snapshots from the server, then the chart from the chosen moment.');
  return (
    <div className="rounded-xl border border-line-strong bg-surface-1 h-[calc(100dvh-11.75rem)] sm:h-[calc(100dvh-16.5rem)] lg:h-[calc(100dvh-12rem)] min-h-[440px] grid place-items-center p-4">
      <div role="status" className="max-w-sm w-full rounded-xl border border-line-strong bg-surface-2 px-4 py-3 text-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">{tr('Powtórka', 'Replay')}</div>
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
            {tr('Wróć na żywo', 'Back to live')}
          </button>
        )}
      </div>
    </div>
  );
};
