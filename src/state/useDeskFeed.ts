import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { microEngine } from '../utils/microEngine';
import {
  AggrTradeTick,
  BackendQuantTelemetry,
  L2OrderbookLevel,
  OHLCVBar,
} from '../types/trading';
import {
  applyLiveTradesToBars,
  applyRealFlowSplit,
  applyVenueFlow,
  collectWhaleNodes,
  fetchRealHyperliquidMarketData,
  HyperliquidHTFLevels,
  mapHyperliquidTrade,
  parseL2Levels,
  VenueFlowMap,
} from '../utils/marketDataFeed';
import { soundEngine } from '../utils/soundEngine';
import { orderFlowStore } from '../charts/orderflow/orderFlowStore';
import { useCexFeeds } from './useCexFeeds';
import { useVolModel } from './useVolModel';
import { VolModel } from '../utils/volatility';

export type DataStatus = 'SYNTH' | 'LIVE' | 'STALE' | 'PAUSED';

const EMPTY_LEVELS: L2OrderbookLevel[] = [];

/**
 * Warstwa danych desku: REST + WebSocket Hyperliquid, opcjonalne źródła CEX (opt-in, lokalnie),
 * stan świeżości danych. Wydzielona z App.tsx, żeby widoki były czystymi konsumentami.
 */
export function useDeskFeed(options: { cexEnabled: boolean }) {
  const [timeframeSec, setTimeframeSec] = useState<number>(300);
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [hlConnected, setHlConnected] = useState<boolean>(false);
  const [lastSyncOkAt, setLastSyncOkAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [backendTelemetry, setBackendTelemetry] = useState<BackendQuantTelemetry | null>(null);
  /** Duże poziomy z arkusza WS — gdy działa WebSocket, odczyt REST arkusza (i jego węzły) nie jest pobierany */
  const [wsWhaleNodes, setWsWhaleNodes] = useState<BackendQuantTelemetry['whaleNodes']>([]);
  // Start bez świec: do pierwszej udanej synchronizacji widoki pokazują stan „łączenie”, nie liczby zastępcze
  const [bars, setBars] = useState<OHLCVBar[]>([]);
  const [realHtfLevels, setRealHtfLevels] = useState<HyperliquidHTFLevels | null>(null);
  const [realL2Book, setRealL2Book] = useState<{ bids: L2OrderbookLevel[]; asks: L2OrderbookLevel[] } | null>(null);
  const [trades, setTrades] = useState<AggrTradeTick[]>([]);
  // Osobny bufor HL — ticki CEX nie mogą wypychać transakcji HL używanych przez OFI i metryki
  const [hlTrades, setHlTrades] = useState<AggrTradeTick[]>([]);

  // Model zmienności (sezonowy log-HAR + FHS) — pas MC 2h i Analizator planu; ref, bo sync jest stabilnym callbackiem
  const vol = useVolModel();
  const volRef = useRef<VolModel | null>(null);
  volRef.current = vol.model;

  const timeframeRef = useRef<number>(timeframeSec);
  const syncSeqRef = useRef<number>(0);
  const syncInFlightRef = useRef<boolean>(false);
  const hasBookRef = useRef<boolean>(false);
  // Interwał, do którego należą bieżące świece — ticki trafiają do świec tylko gdy zgadza się z wybranym
  const barsTfRef = useRef<number | null>(null);
  // Deduplikacja transakcji HL po tid (np. powtórka po ponownym połączeniu WS)
  const seenTradeIdsRef = useRef<Set<string>>(new Set());
  // Paczkowanie ticków (≤ 4 commity/s zamiast jednego na każdą wiadomość WS)
  const pendingRef = useRef<{ hl: AggrTradeTick[]; cex: AggrTradeTick[]; timer: number | null }>({ hl: [], cex: [], timer: null });
  const hlConnectedRef = useRef<boolean>(false);
  // Realny przepływ agresora z WS per czas świecy (do nałożenia na wolumen z REST)
  const wsFlowRef = useRef<Map<number, { buy: number; sell: number }>>(new Map());
  // Realny przepływ z giełd CEX (opt-in) per świeca — ponownie nakładany po każdym REST
  const venueFlowRef = useRef<VenueFlowMap>(new Map());

  useEffect(() => {
    timeframeRef.current = timeframeSec;
    wsFlowRef.current = new Map();
    venueFlowRef.current = new Map();
  }, [timeframeSec]);

  useEffect(() => {
    hlConnectedRef.current = hlConnected;
  }, [hlConnected]);

  // Zegar do oceny świeżości danych (STALE), także gdy nic nie przychodzi
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Synchronizacja REST; numer sekwencji odrzuca spóźnione odpowiedzi (np. stary interwał)
  const sync = useCallback(async (tfSec: number, force = false) => {
    // Nie nakładaj zapytań: kolejne startuje dopiero po zakończeniu poprzedniego (chyba że zmiana interwału)
    if (syncInFlightRef.current && !force) return;
    syncInFlightRef.current = true;
    const seq = ++syncSeqRef.current;
    try {
      const isLocalServer =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      const [marketData, backendRes] = await Promise.all([
        // L2 przez REST tylko bez WS albo gdy WS jeszcze nie dostarczył arkusza (waga 2)
        fetchRealHyperliquidMarketData(tfSec, {
          includeL2Book: !hlConnectedRef.current || !hasBookRef.current,
          volModel: volRef.current,
        }),
        isLocalServer
          ? fetch('/api/quant/hyperliquid-live')
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      if (seq !== syncSeqRef.current || tfSec !== timeframeRef.current) return;

      if (marketData.bars.length > 20) {
        barsTfRef.current = tfSec;
        setBars(applyVenueFlow(applyRealFlowSplit(marketData.bars, wsFlowRef.current), venueFlowRef.current));
        setLastSyncOkAt(Date.now());
      }
      if (marketData.htfLevels) setRealHtfLevels(marketData.htfLevels);
      if (marketData.l2Book) setRealL2Book(marketData.l2Book);

      // Brak telemetrii = zostaje ostatnia realna (status pokaże STALE), nigdy stałe zastępcze.
      // Najpierw telemetria z przeglądarki (ma model zmienności); endpoint serwera dev (bez modelu) tylko jako zapas.
      if (marketData.liveTelemetry) setBackendTelemetry(marketData.liveTelemetry);
      else if (backendRes && backendRes.markPrice) setBackendTelemetry(backendRes);
    } catch {
      // Zostaw bieżący stan przy braku sieci
    } finally {
      if (seq === syncSeqRef.current) syncInFlightRef.current = false;
    }
  }, []);

  // REST co 15 s przy działającym WS (WS na bieżąco aktualizuje świecę), co 10 s bez WS;
  // pauza w ukrytej karcie (oszczędza limit 1200 wag/min na IP), natychmiastowa synchronizacja po powrocie
  useEffect(() => {
    sync(timeframeSec, true);
    const period = hlConnected ? 15000 : 10000;
    const id = window.setInterval(() => {
      if (isStreaming && document.visibilityState === 'visible') sync(timeframeSec);
    }, period);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isStreaming) sync(timeframeSec);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [timeframeSec, isStreaming, hlConnected, sync]);

  // Opróżnienie paczki: jeden commit Reacta na taśmę i świece
  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    pending.timer = null;
    const hl = pending.hl;
    const cexTicks = pending.cex;
    pending.hl = [];
    pending.cex = [];
    if (hl.length === 0 && cexTicks.length === 0) return;
    const all = [...hl, ...cexTicks].sort((a, b) => a.timestamp - b.timestamp);
    const loud = all.find((t) => t.tier !== 'normal');
    if (loud) soundEngine.playTradeTick(loud.side, loud.tier, loud.isLiquidation);
    setTrades((prev) => [...[...all].reverse(), ...prev].slice(0, 160));
    if (hl.length > 0) setHlTrades((prev) => [...[...hl].reverse(), ...prev].slice(0, 120));
    // Świece aktualizujemy tylko, gdy należą do bieżącego interwału (po zmianie czekamy na REST)
    if (barsTfRef.current === timeframeRef.current) {
      setBars((prev) => {
        let next = hl.length > 0 ? applyLiveTradesToBars(prev, hl, timeframeRef.current, 145) : prev;
        if (cexTicks.length > 0) {
          next = applyLiveTradesToBars(next, cexTicks, timeframeRef.current, 145, { updatePrice: false });
        }
        return next;
      });
    }
  }, []);

  // Wspólne wejście dla realnych ticków (HL i opcjonalne CEX): przepływ per świeca od razu, UI w paczkach
  const ingestTicks = useCallback((incoming: AggrTradeTick[], isHyperliquid: boolean) => {
    let ticks = incoming;
    if (isHyperliquid) {
      const seen = seenTradeIdsRef.current;
      ticks = incoming.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      if (seen.size > 6000) {
        // Zostaw ostatnie ~3000 identyfikatorów
        const keep = [...seen].slice(-3000);
        seenTradeIdsRef.current = new Set(keep);
      }
    }
    if (ticks.length === 0) return;
    const tfMs = timeframeRef.current * 1000;
    if (isHyperliquid) {
      orderFlowStore.ingestTrades(ticks);
      const flow = wsFlowRef.current;
      for (const t of ticks) {
        const barTime = Math.floor(t.timestamp / tfMs) * tfMs;
        const f = flow.get(barTime) ?? { buy: 0, sell: 0 };
        if (t.side === 'buy') f.buy += t.sizeUsd;
        else f.sell += t.sizeUsd;
        flow.set(barTime, f);
      }
      pruneOldest(flow, 300);
    } else {
      const flow = venueFlowRef.current;
      for (const t of ticks) {
        const barTime = Math.floor(t.timestamp / tfMs) * tfMs;
        const venues = flow.get(barTime) ?? new Map();
        const f = venues.get(t.exchange) ?? { buy: 0, sell: 0, isPerp: t.isPerp, liqBuy: 0, liqSell: 0 };
        if (t.isLiquidation) {
          if (t.side === 'buy') f.liqBuy = (f.liqBuy ?? 0) + t.sizeUsd;
          else f.liqSell = (f.liqSell ?? 0) + t.sizeUsd;
        } else if (t.side === 'buy') f.buy += t.sizeUsd;
        else f.sell += t.sizeUsd;
        venues.set(t.exchange, f);
        flow.set(barTime, venues);
      }
      pruneOldest(flow, 300);
    }
    const pending = pendingRef.current;
    if (isHyperliquid) pending.hl.push(...ticks);
    else pending.cex.push(...ticks);
    if (pending.timer === null) pending.timer = window.setTimeout(flushPending, 250);
  }, [flushPending]);

  // Sprzątanie zaplanowanego opróżnienia paczki przy odmontowaniu
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      if (pending.timer !== null) clearTimeout(pending.timer);
    };
  }, []);

  // WebSocket Hyperliquid: reconnect z backoffem, ping co 30 s (serwer zamyka po 60 s ciszy)
  useEffect(() => {
    if (!isStreaming) {
      setHlConnected(false);
      return;
    }
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      attempt++;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      try {
        const sock = new WebSocket('wss://api.hyperliquid.xyz/ws');
        ws = sock;
        sock.onopen = () => {
          if (disposed) return;
          attempt = 0;
          setHlConnected(true);
          sock.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } }));
          sock.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } }));
          // Najlepsze kwotowania ~co 150 ms (arkusz l2Book przychodzi ~co 5 s) — OFI i mikrocena w mechanice arkusza
          sock.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'bbo', coin: 'BTC' } }));
          if (pingTimer !== null) clearInterval(pingTimer);
          pingTimer = window.setInterval(() => {
            if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ method: 'ping' }));
          }, 30000);
        };
        sock.onmessage = (event: MessageEvent) => {
          if (disposed) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.channel === 'trades' && Array.isArray(msg.data)) {
              microEngine.onTrades(msg.data);
              const ticks: AggrTradeTick[] = [];
              for (const raw of msg.data) {
                const t = mapHyperliquidTrade(raw);
                if (t) ticks.push(t);
              }
              ingestTicks(ticks, true);
            } else if (msg.channel === 'bbo' && msg.data && Array.isArray(msg.data.bbo)) {
              microEngine.onBbo(msg.data);
            } else if (msg.channel === 'l2Book' && msg.data && Array.isArray(msg.data.levels)) {
              microEngine.onBook(msg.data);
              setWsWhaleNodes(collectWhaleNodes(msg.data.levels[0] || [], msg.data.levels[1] || []).slice(0, 12));
              const parsed = parseL2Levels(msg.data.levels[0] || [], msg.data.levels[1] || []);
              if (parsed.bids.length > 0 && parsed.asks.length > 0) setRealL2Book(parsed);
            }
          } catch {
            // Pomijamy uszkodzone pakiety
          }
        };
        sock.onclose = () => {
          if (ws === sock) ws = null;
          if (pingTimer !== null) {
            clearInterval(pingTimer);
            pingTimer = null;
          }
          if (disposed) return;
          setHlConnected(false);
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pingTimer !== null) clearInterval(pingTimer);
      // Zamknięcie także w stanie CONNECTING — inaczej stary socket dubluje transakcje
      if (ws) ws.close();
      ws = null;
    };
  }, [isStreaming, ingestTicks]);

  // Opcjonalne realne źródła CEX — tylko po świadomym włączeniu przez użytkownika (lokalnie)
  const cex = useCexFeeds({
    enabled: options.cexEnabled && isStreaming,
    onTicks: (ticks) => ingestTicks(ticks, false),
  });

  hasBookRef.current = (realL2Book?.bids.length ?? 0) > 0;
  const bids = realL2Book?.bids ?? EMPTY_LEVELS;
  const asks = realL2Book?.asks ?? EMPTY_LEVELS;
  const latestBar = bars[bars.length - 1];
  const currentPrice = latestBar?.close ?? Number.NaN;

  const dataStatus: DataStatus = !isStreaming
    ? 'PAUSED'
    : lastSyncOkAt === null
    ? 'SYNTH'
    : nowTick - lastSyncOkAt > 45000 || !hlConnected
    ? 'STALE'
    : 'LIVE';


  // Stabilna referencja — nowy obiekt w każdym renderze unieważniał memoizację odbiorców (np. powierzchnia 3D)
  const telemetry = useMemo(
    () =>
      backendTelemetry && backendTelemetry.whaleNodes.length === 0 && wsWhaleNodes.length > 0 ? { ...backendTelemetry, whaleNodes: wsWhaleNodes } : backendTelemetry,
    [backendTelemetry, wsWhaleNodes]
  );

  return {
    timeframeSec,
    setTimeframeSec,
    isStreaming,
    setIsStreaming,
    hlConnected,
    lastSyncOkAt,
    nowTick,
    dataStatus,
    backendTelemetry: telemetry,
    bars,
    latestBar,
    currentPrice,
    realHtfLevels,
    bids,
    asks,
    trades,
    hlTrades,
    cex,
    vol,
    syncNow: () => sync(timeframeRef.current, true),
  };
}

export type DeskFeed = ReturnType<typeof useDeskFeed>;

/** Ogranicza mapę per-świeca do `keep` najnowszych kluczy (czas świecy). */
function pruneOldest<V>(map: Map<number, V>, keep: number): void {
  if (map.size <= keep) return;
  const keys = [...map.keys()].sort((a, b) => a - b);
  for (const k of keys.slice(0, map.size - keep)) map.delete(k);
}
