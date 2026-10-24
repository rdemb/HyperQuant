import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import { Segmented } from '../ui';
import { ProChart, subscribeNarrow } from '../charts/pro/ProChart';
import { ChartLayout, isNarrow, loadSettings } from '../charts/pro/chart/settings';
import { STATIONS, Station, StationId, clearStation, loadStation, loadStationLayout, saveStation, saveStationLayout, stationById, stationKey } from '../charts/pro/chart/stations';
import type { Market } from '../charts/pro/store/proStore';
import { parseReplayLink, replayHash } from '../charts/pro/replay/link';
import { ReplayView } from '../charts/pro/replay/ReplayView';

const WIDE = '(min-width: 1024px)';

const subscribeWide = (fn: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

const isWide = () => window.matchMedia(WIDE).matches;

const STATION_OPTIONS = STATIONS.map((s) => ({ value: s.id, label: s.name, title: s.question }));
/** Bez szerokiego ekranu jeden wykres — stacja „Dwa interwały” nie ma tam sensu (zostaje, gdy jest wybrana). */
const NARROW_STATION_OPTIONS = STATION_OPTIONS.filter((o) => o.value !== 'mtf');

/**
 * Wykresy: świece i footprint perpów (BTC, ETH, SOL, HYPE) na silniku TradingView Lightweight Charts z danymi Hyperliquid
 * na żywo. Nad wykresami stacje robocze (na telefonie lista w pasku wykresu); na szerokim ekranie układ 1, 2 albo 4 wykresów,
 * każdy panel ma własny rynek, interwał i ustawienia. Link powtórki (#charts?replay=…) pokazuje zamiast nich nagranie z serwera.
 */
const ChartsView: React.FC = () => {
  const [station, setStation] = useState<Station>(loadStation);
  const [layout, setLayoutState] = useState<ChartLayout>(() => loadStationLayout(station));
  // Zmiana stacji i przywrócenie wzorca tworzą wykresy od nowa; rynek bieżącego wykresu przechodzi do nowych
  const [gen, setGen] = useState(0);
  const [coin, setCoin] = useState<Market | null>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const [replay, setReplay] = useState(() => parseReplayLink(window.location.hash));
  useEffect(() => {
    const onHash = () => setReplay(parseReplayLink(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setLayout = useCallback(
    (l: ChartLayout) => {
      setLayoutState(l);
      saveStationLayout(station.id, l);
    },
    [station]
  );
  const open = (next: Station, restore: boolean) => {
    // Ustawienia pierwszego panelu są zapisywane przy każdej zmianie, więc zapis ma bieżący rynek
    setCoin(loadSettings(stationKey(station.id, 0)).coin);
    if (restore) clearStation(next.id);
    saveStation(next.id);
    setStation(next);
    setLayoutState(loadStationLayout(next));
    setGen((g) => g + 1);
  };
  const n = wide ? layout : 1;
  if (replay) return <ReplayView key={replayHash(replay)} link={replay} />;
  return (
    <>
      {!narrow && (
        <div className="flex items-center gap-2 mb-2 min-w-0">
          <span className="hidden sm:inline text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium shrink-0">Stacja</span>
          <div className="min-w-0 overflow-x-auto [scrollbar-width:none]">
            <Segmented<StationId>
              ariaLabel="Stacja robocza"
              value={station.id}
              onChange={(id) => id !== station.id && open(stationById(id), false)}
              options={wide || station.id === 'mtf' ? STATION_OPTIONS : NARROW_STATION_OPTIONS}
              size={wide ? 'sm' : 'xs'}
            />
          </div>
          <button
            type="button"
            onClick={() => open(station, true)}
            aria-label={`Przywróć wzorzec stacji ${station.name}`}
            title={`Przywróć wzorzec stacji ${station.name}: Twoje zmiany w tej stacji (ustawienia wykresów i układ) zostaną zastąpione`}
            className="ml-auto shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line text-xs font-medium text-ink-2 hover:text-ink-1 hover:bg-surface-2 transition-colors duration-150"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Przywróć</span>
          </button>
        </div>
      )}
      {/* Ten sam kontener dla każdego układu: pierwszy panel nie tworzy się od nowa przy zmianie układu */}
      <div className={n === 1 ? '' : 'grid grid-cols-2 gap-2'}>
        {Array.from({ length: n }, (_, i) => (
          <ProChart
            key={`${station.id}.${gen}.${i}`}
            panel={i}
            station={station}
            coin={coin}
            fromLink={gen === 0}
            layout={n}
            onLayout={i === 0 ? setLayout : undefined}
            phoneStation={
              narrow && i === 0
                ? {
                    value: station.id,
                    options: station.id === 'mtf' ? STATION_OPTIONS : NARROW_STATION_OPTIONS,
                    onChange: (id) => id !== station.id && open(stationById(id), false),
                    onRestore: () => open(station, true),
                  }
                : undefined
            }
          />
        ))}
      </div>
    </>
  );
};

export default ChartsView;
