import { HlMarketsStream, HlStream, type MarketSink } from './hl.ts';
import type { MarketRecorder } from './history.ts';

/** Połączenie rejestratora historii i rynki, które niesie. */
export interface RecorderStream {
  readonly coins: readonly string[];
  readonly recorders: readonly MarketRecorder[];
  readonly connected: boolean;
  start(): void;
  stop(): void;
}

/** Rynek HIP-3: nazwa z przedrostkiem giełdy (`xyz:GOLD`). */
const isHip3 = (coin: string) => coin.includes(':');

/**
 * Połączenia WebSocket rejestratorów historii (projekt 60, R3). Rynek giełdy głównej (BTC; dawniej też ETH, SOL, HYPE)
 * ma własne połączenie jak dotąd, a wszystkie rynki HIP-3 jedno wspólne, z rozdzielaniem zdarzeń po rynku. Przy BTC,
 * złocie i S&P 500 to 2 połączenia zamiast 3 (limit giełdy: 10 na IP, razem ze skanerem, pomiarem w cieniu i alarmami).
 * Zerwanie wspólnego połączenia kończy odcinek nagrania wszystkich rynków HIP-3 naraz (luka zapisana w każdym).
 * Po każdej cenie z kontekstu rejestrator dobiera agregacje arkusza; zmiana = wymiana subskrypcji na tym samym połączeniu.
 */
export function recorderStreams(recorders: readonly MarketRecorder[], wsCtor: typeof WebSocket = WebSocket): RecorderStream[] {
  const out: RecorderStream[] = [];
  for (const rec of recorders.filter((r) => !isHip3(r.coin))) {
    const s: HlStream = new HlStream(
      rec.coin,
      (t) => rec.onTrades(t),
      (c) => {
        rec.onCtx(c, Date.now());
        const aggs = rec.aggs();
        if (aggs) s.setBookAggs(aggs, rec.exactBook());
      },
      wsCtor,
      (t, levels) => rec.onBook(t, levels),
      (up, at) => rec.onState(up, at)
    );
    out.push({
      coins: [rec.coin],
      recorders: [rec],
      get connected() {
        return s.connected;
      },
      start: () => s.start(),
      stop: () => s.stop(),
    });
  }
  const hip3 = recorders.filter((r) => isHip3(r.coin));
  if (hip3.length === 0) return out;
  const sinks = new Map<string, MarketSink>();
  for (const rec of hip3) {
    sinks.set(rec.coin, {
      onTrades: (t) => rec.onTrades(t),
      onCtx: (c) => {
        rec.onCtx(c, Date.now());
        const aggs = rec.aggs();
        if (aggs) shared.setBookAggs(rec.coin, aggs, rec.exactBook());
      },
      onBook: (t, levels) => rec.onBook(t, levels),
    });
  }
  const shared: HlMarketsStream = new HlMarketsStream(
    sinks,
    (up, at) => {
      for (const rec of hip3) rec.onState(up, at);
    },
    wsCtor
  );
  out.push({
    coins: hip3.map((r) => r.coin),
    recorders: hip3,
    get connected() {
      return shared.connected;
    },
    start: () => shared.start(),
    stop: () => shared.stop(),
  });
  return out;
}
