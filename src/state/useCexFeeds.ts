import { useEffect, useMemo, useRef, useState } from 'react';
import { AggrTradeTick, ExchangeId } from '../types/trading';
import { aggregateSmallTrades, CEX_ADAPTERS, CexAdapter, tickTradeCount } from '../utils/cexAdapters';

export type CexConnState = 'open' | 'connecting' | 'closed';

export interface CexFeedStatus {
  /** Stan połączenia per giełda (np. BINANCE_FUTURES: 'open' | 'connecting' | 'closed') */
  venues: Record<string, CexConnState>;
  /** Liczba realnych transakcji odebranych per giełda od włączenia (sumy drobnych liczone po składnikach) */
  received: Record<string, number>;
  /** Czas (ms) ostatniej paczki z transakcjami (lub otwarcia połączenia) per giełda — do wykrywania „otwarte, ale cisza” */
  lastTickAt: Record<string, number>;
}

const FLUSH_MS = 250;

/** Opóźnienie ponownego połączenia: 1 s, 2 s, 4 s … do 30 s. */
export function cexReconnectDelayMs(attempt: number): number {
  return Math.min(30000, 1000 * 2 ** Math.max(0, attempt));
}

/** Tekst ramki → ticki; ramki nie-JSON (np. „pong” z OKX) i nieznane wiadomości są pomijane. */
function parseFrame(adapter: CexAdapter, data: unknown): AggrTradeTick[] {
  if (typeof data !== 'string' || data === 'pong') return [];
  try {
    return adapter.parse(JSON.parse(data));
  } catch {
    return [];
  }
}

/**
 * Menedżer połączeń bez Reacta (testowalny): jedno gniazdo na giełdę, reconnect z backoffem,
 * ping wg adaptera, paczki ticków co 250 ms (drobne transakcje sumowane). Zwraca funkcję sprzątającą.
 */
export function startCexFeeds(
  adapters: CexAdapter[],
  cb: { onTicks: (ticks: AggrTradeTick[]) => void; onStatus: (id: ExchangeId, state: CexConnState) => void }
): () => void {
  let disposed = false;
  let buffer: AggrTradeTick[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    if (disposed || buffer.length === 0) return;
    const batch = aggregateSmallTrades(buffer);
    buffer = [];
    cb.onTicks(batch);
  };
  const push = (ticks: AggrTradeTick[]) => {
    for (const t of ticks) buffer.push(t);
    if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_MS);
  };

  const stops = adapters.map((adapter) => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const clearPing = () => {
      if (pingTimer !== null) clearInterval(pingTimer);
      pingTimer = null;
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      const delay = cexReconnectDelayMs(attempt);
      attempt++;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      cb.onStatus(adapter.id, 'connecting');
      let sock: WebSocket;
      try {
        sock = new WebSocket(adapter.url);
      } catch {
        cb.onStatus(adapter.id, 'closed');
        scheduleReconnect();
        return;
      }
      ws = sock;
      sock.onopen = () => {
        if (disposed) return;
        cb.onStatus(adapter.id, 'open');
        for (const s of adapter.subscribe ?? []) sock.send(JSON.stringify(s));
        clearPing();
        if (adapter.pingIntervalMs && adapter.pingPayload) {
          const payload = adapter.pingPayload;
          pingTimer = setInterval(() => {
            if (sock.readyState === WebSocket.OPEN) sock.send(payload);
          }, adapter.pingIntervalMs);
        }
      };
      sock.onmessage = (ev: MessageEvent) => {
        if (disposed) return;
        // Backoff zerujemy dopiero po realnej wiadomości (serwer, który otwiera i od razu zamyka, nie zapętli nas co 1 s)
        attempt = 0;
        const ticks = parseFrame(adapter, ev.data);
        if (ticks.length > 0) push(ticks);
      };
      sock.onclose = () => {
        if (ws === sock) ws = null;
        clearPing();
        if (disposed) return;
        cb.onStatus(adapter.id, 'closed');
        scheduleReconnect();
      };
      // onerror zawsze poprzedza onclose — reconnect obsługuje onclose
    };

    connect();
    return () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearPing();
      // Zamykamy także gniazdo w stanie CONNECTING — inaczej po wyłączeniu dalej płyną dane
      if (ws) ws.close();
      ws = null;
    };
  });

  return () => {
    disposed = true;
    for (const stop of stops) stop();
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    buffer = [];
  };
}

const EMPTY: Record<string, never> = {};

/**
 * Opcjonalne realne strumienie CEX (Binance/Bybit/OKX/Coinbase) — wyłącznie opt-in użytkownika,
 * łączone z jego przeglądarki do użytku osobistego; w publicznej wersji domyślnie wyłączone.
 * Gdy `enabled` = false nic nie jest łączone ani liczone (zero kosztów).
 */
export function useCexFeeds(opts: { enabled: boolean; onTicks: (ticks: AggrTradeTick[]) => void }): CexFeedStatus {
  const { enabled, onTicks } = opts;
  // Callback w refie — rodzic podaje nową funkcję przy każdym renderze, a połączeń nie wolno przez to zrywać
  const onTicksRef = useRef(onTicks);
  useEffect(() => {
    onTicksRef.current = onTicks;
  }, [onTicks]);

  const [venues, setVenues] = useState<Record<string, CexConnState>>(EMPTY);
  const [received, setReceived] = useState<Record<string, number>>(EMPTY);
  const [lastTickAt, setLastTickAt] = useState<Record<string, number>>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    const stop = startCexFeeds(CEX_ADAPTERS, {
      onTicks: (ticks) => {
        onTicksRef.current(ticks);
        const now = Date.now();
        const add: Record<string, number> = {};
        for (const t of ticks) add[t.exchange] = (add[t.exchange] ?? 0) + tickTradeCount(t);
        setReceived((prev) => {
          const next = { ...prev };
          for (const [ex, n] of Object.entries(add)) next[ex] = (next[ex] ?? 0) + n;
          return next;
        });
        setLastTickAt((prev) => {
          const next = { ...prev };
          for (const ex of Object.keys(add)) next[ex] = now;
          return next;
        });
      },
      onStatus: (id, state) => {
        setVenues((prev) => (prev[id] === state ? prev : { ...prev, [id]: state }));
        // Otwarcie startuje licznik ciszy — „otwarte, ale bez transakcji” jest wtedy wykrywalne
        if (state === 'open') setLastTickAt((prev) => ({ ...prev, [id]: Date.now() }));
      },
    });
    return () => {
      stop();
      setVenues(EMPTY);
      setReceived(EMPTY);
      setLastTickAt(EMPTY);
    };
  }, [enabled]);

  return useMemo(
    () => (enabled ? { venues, received, lastTickAt } : { venues: EMPTY, received: EMPTY, lastTickAt: EMPTY }),
    [enabled, venues, received, lastTickAt]
  );
}
