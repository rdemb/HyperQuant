import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ShaakuniConfig } from '../types/trading';
import { computeAggrLiquidationHeatmap, computeShaakuniIndicator } from '../utils/shaakuniEngine';
import { computeOrderFlowImbalanceHeatmap, computeQuantMathAndNeuralForecast } from '../utils/quantMathEngine';
import { soundEngine } from '../utils/soundEngine';
import { DeskFeed, useDeskFeed } from './useDeskFeed';
import { LAST_VIEW_KEY, followHash, landingView } from './route';
import { ViewId } from './types';
import { needsVolModel } from './viewNeeds';
import { startOnboarding } from '../utils/firstVisit';

const CEX_KEY = 'hq.cexEnabled';

/** Widok z adresu strony; stary adres (#desk, #plan…) zastępuje nowym (`#move=` obsłużył już originMove.ts). */
function readHashView(): ViewId {
  const view = followHash(window);
  // Pusty adres: pierwsza wizyta → Start, powrót → ostatni widok (route.landingView)
  return window.location.hash.replace(/^#/, '') === '' ? landingView(storageOrNull()) : view;
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

/** Pamięć przeglądarki; null, gdy zablokowana (tryb prywatny). */
function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Wejście do aplikacji, w tej kolejności:
 * 1. pusty adres: widok z pamięci (landingView) przed zapisem pierwszej wizyty — inaczej zapis hq.onboarding.v1 robi
 *    z pierwszej wizyty stałego użytkownika i zamiast Startu otwiera się W sesji;
 * 2. zapis pierwszej wizyty, zanim adres #flow (followHash) albo wykresy zapiszą klucze hq.charts.*: dymki W sesji
 *    pokażą się także po wejściu z innej fazy; stały użytkownik (hq.charts.* sprzed tej wersji) ich nie zobaczy;
 * 3. widok z adresu.
 */
export function enterApp(now = Date.now()): ViewId {
  const s = storageOrNull();
  const landing = window.location.hash.replace(/^#/, '') === '' ? landingView(s) : null;
  if (s) startOnboarding(s, now);
  return landing ?? readHashView();
}

function useDeskState() {
  const [view, setViewState] = useState<ViewId>(() => enterApp());
  const [cexEnabled, setCexEnabledState] = useState<boolean>(() => readBool(CEX_KEY));
  const [audioEnabled, setAudioEnabledState] = useState<boolean>(false);
  const [shaakuniConfig, setShaakuniConfig] = useState<ShaakuniConfig>(DEFAULT_SHAAKUNI);

  const feed: DeskFeed = useDeskFeed({ cexEnabled, volModel: needsVolModel(view) });

  // Nawigacja synchronizowana z hashem (głębokie linki, przycisk Wstecz, skróty PWA). Przepisany stary adres
  // (replaceState nie wysyła zdarzenia) ogłaszamy jeszcze raz, żeby inne widoki przeczytały już nowy adres.
  useEffect(() => {
    const onHash = () => {
      const before = window.location.hash;
      setViewState(readHashView());
      if (window.location.hash !== before) window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Ostatni widok: powrót na stronę bez adresu otwiera go (route.landingView)
  useEffect(() => {
    try {
      storageOrNull()?.setItem(LAST_VIEW_KEY, view);
    } catch {
      // Pełny albo zablokowany storage: wejście znów od Startu
    }
  }, [view]);

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
