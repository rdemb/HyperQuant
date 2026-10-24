import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ShaakuniConfig } from '../types/trading';
import { computeAggrLiquidationHeatmap, computeShaakuniIndicator } from '../utils/shaakuniEngine';
import { computeOrderFlowImbalanceHeatmap, computeQuantMathAndNeuralForecast } from '../utils/quantMathEngine';
import { soundEngine } from '../utils/soundEngine';
import { DeskFeed, useDeskFeed } from './useDeskFeed';
import { PlanDraft, ViewId } from './types';

const VIEWS: ViewId[] = ['desk', 'charts', 'plan', 'market', 'lab', 'micro', 'lessons', 'sources'];
const CEX_KEY = 'hq.cexEnabled';

function readHashView(): ViewId {
  // Po „?” parametry widoku (np. link do wykresu: #charts?m=ETH&i=5m)
  const h = typeof window !== 'undefined' ? window.location.hash.replace('#', '').split('?')[0] : '';
  return (VIEWS as string[]).includes(h) ? (h as ViewId) : 'desk';
}

function readBool(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

const DEFAULT_SHAAKUNI: ShaakuniConfig = {
  tzChoice: 'Auto (DST)',
  showWeek: true,
  showEQ: true,
  showPrevW: true,
  showDay: true,
  showDEQ: true,
  showOB: true,
  showFresh: true,
  showMit: false,
  obSwingLen: 10,
  impMult: 0.7,
  showKeltner: true,
  showLiqHeatmap: true,
  // Stożek heurystyczny domyślnie wyłączony — na głównym wykresie nie pokazujemy kierunkowych podpowiedzi
  showNeuralCone: false,
};

function useDeskState() {
  const [view, setViewState] = useState<ViewId>(readHashView);
  const [cexEnabled, setCexEnabledState] = useState<boolean>(() => readBool(CEX_KEY));
  const [audioEnabled, setAudioEnabledState] = useState<boolean>(false);
  const [shaakuniConfig, setShaakuniConfig] = useState<ShaakuniConfig>(DEFAULT_SHAAKUNI);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);

  const feed: DeskFeed = useDeskFeed({ cexEnabled });

  // Nawigacja synchronizowana z hashem (głębokie linki, przycisk Wstecz, skróty PWA)
  useEffect(() => {
    const onHash = () => setViewState(readHashView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setView = useCallback((v: ViewId) => {
    if (window.location.hash.split('?')[0] !== `#${v}`) window.location.hash = v;
    setViewState(v);
  }, []);

  const setCexEnabled = useCallback((v: boolean) => {
    setCexEnabledState(v);
    try {
      window.localStorage.setItem(CEX_KEY, v ? '1' : '0');
    } catch {
      // Brak dostępu do storage (tryb prywatny) — ustawienie tylko na tę sesję
    }
  }, []);

  const setAudioEnabled = useCallback((v: boolean) => {
    soundEngine.setEnabled(v);
    setAudioEnabledState(v);
  }, []);

  /** Przekazuje kierunek/poziomy z dowolnego panelu do Analizatora planu i przełącza widok. */
  const prefillPlan = useCallback(
    (draft: PlanDraft) => {
      setPlanDraft(draft);
      setView('plan');
    },
    [setView]
  );

  const shaakuni = useMemo(
    () => computeShaakuniIndicator(feed.bars, shaakuniConfig, feed.timeframeSec, feed.realHtfLevels),
    [feed.bars, shaakuniConfig, feed.timeframeSec, feed.realHtfLevels]
  );
  const heatmap = useMemo(() => computeAggrLiquidationHeatmap(feed.bars), [feed.bars]);
  const quant = useMemo(
    () => computeQuantMathAndNeuralForecast(feed.bars, shaakuni, heatmap, feed.hlTrades, feed.bids, feed.asks),
    [feed.bars, shaakuni, heatmap, feed.hlTrades, feed.bids, feed.asks]
  );
  // OFI tylko z transakcji z ostatnich 60 s — w spokojnym rynku stare transakcje nie mogą „wykrywać” wyczerpania
  const recentHlTrades = useMemo(() => {
    const newest = feed.hlTrades[0]?.timestamp ?? 0;
    return feed.hlTrades.filter((t) => t.timestamp >= Math.max(newest, Date.now()) - 60_000);
  }, [feed.hlTrades, feed.nowTick]);
  const ofi = useMemo(
    () => computeOrderFlowImbalanceHeatmap(feed.bids, feed.asks, recentHlTrades, feed.bars, feed.currentPrice),
    [feed.bids, feed.asks, recentHlTrades, feed.bars, feed.currentPrice]
  );

  return {
    view,
    setView,
    feed,
    shaakuni,
    heatmap,
    quant,
    ofi,
    shaakuniConfig,
    setShaakuniConfig,
    cexEnabled,
    setCexEnabled,
    audioEnabled,
    setAudioEnabled,
    planDraft,
    prefillPlan,
  };
}

export type DeskState = ReturnType<typeof useDeskState>;

const Ctx = createContext<DeskState | null>(null);

export const DeskProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const state = useDeskState();
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
};

/** Dostęp do stanu desku w widokach i komponentach. */
export function useDesk(): DeskState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDesk musi być użyte wewnątrz <DeskProvider>');
  return v;
}

/** Adapter starych przycisków „Signal” (dir, title, reason) → szkic planu. */
export function usePrefillFromSignal(source: string) {
  const { prefillPlan } = useDesk();
  return useCallback(
    (direction: 'LONG' | 'SHORT', title?: string, reason?: string) =>
      prefillPlan({ direction, source, note: [title, reason].filter(Boolean).join(' — ') }),
    [prefillPlan, source]
  );
}
