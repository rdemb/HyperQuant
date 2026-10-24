import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { ProChart } from '../charts/pro/ProChart';
import { ChartLayout, loadLayout, saveLayout } from '../charts/pro/chart/settings';

const WIDE = '(min-width: 1024px)';

const subscribeWide = (fn: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

const isWide = () => window.matchMedia(WIDE).matches;

/**
 * Wykresy: świece i footprint perpów (BTC, ETH, SOL, HYPE) na silniku TradingView Lightweight Charts z danymi Hyperliquid
 * na żywo. Na szerokim ekranie układ 1, 2 albo 4 wykresów; każdy panel ma własny rynek, interwał i ustawienia.
 */
const ChartsView: React.FC = () => {
  const [layout, setLayoutState] = useState<ChartLayout>(loadLayout);
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const setLayout = useCallback((l: ChartLayout) => {
    setLayoutState(l);
    saveLayout(l);
  }, []);
  const n = wide ? layout : 1;
  // Ten sam kontener dla każdego układu: pierwszy panel nie tworzy się od nowa przy zmianie układu
  return (
    <div className={n === 1 ? '' : 'grid grid-cols-2 gap-2'}>
      {Array.from({ length: n }, (_, i) => (
        <ProChart key={i} panel={i} layout={n} onLayout={i === 0 ? setLayout : undefined} />
      ))}
    </div>
  );
};

export default ChartsView;
