import { useEffect, useId, useSyncExternalStore } from 'react';
import { useDesk } from './DeskContext';
import {
  BetaR2,
  Candle,
  FundingZ,
  fundingZ,
  HIP3_MACRO,
  Hip3Tile,
  MarketRow,
  parseCandles,
  parseFundingHistory,
  parseHip3,
  parseMarketMap,
  parsePredictedFundings,
  PredictedFundings,
  rollingBetaR2,
  pairedLogReturns,
} from '../utils/hlMarkets';

/**
 * Dane międzyrynkowe z publicznego API Hyperliquid dla widoku „Rynek” i paska na Desku.
 * Jeden wspólny harmonogram w module (cache przeżywa zmianę widoku), odpytuje tylko to, czego
 * potrzebują zamontowane komponenty. Budżet wag (limit 1200/min na IP; desk zużywa już część):
 * - funding: predictedFundings (20) co 60 s + fundingHistory BTC 7 dni (~20 + 9) co 15 min ≈ 22/min
 * - map: metaAndAssetCtxs główny dex (20) co 60 s = 20/min
 * - macro: metaAndAssetCtxs dex „xyz” (20) co 60 s + świece co 5 min (6×1h·48 + 3×5m·288) ≈ 60/min
 * Pauza, gdy karta niewidoczna albo strumień desku wstrzymany.
 */

export type CrossMarketNeed = 'funding' | 'map' | 'macro';

const INFO_URL = 'https://api.hyperliquid.xyz/info';
const H = 3_600_000;

export const PERIOD_MS = { funding: 60_000, map: 60_000, macro: 60_000, macroCandles: 5 * 60_000, fundingHistory: 15 * 60_000 } as const;

export interface MacroFit {
  /** null, gdy n < 30 albo proxy stoi (zerowa wariancja) */
  fit: BetaR2 | null;
  /** Liczba sparowanych zwrotów 5m w oknie */
  n: number;
}

export interface CrossMarketSnapshot {
  funding: PredictedFundings | null;
  fundingAt: number | null;
  fundingZ: FundingZ | null;
  markets: MarketRow[] | null;
  marketsAt: number | null;
  hip3: Hip3Tile[] | null;
  hip3At: number | null;
  /** Świece 1h (ostatnie 48) per klucz kafla HIP-3 */
  hip3Candles: Record<string, Candle[]>;
  macroFit: Record<'XYZ100' | 'SP500', MacroFit> | null;
  macroFitAt: number | null;
}

let snapshot: CrossMarketSnapshot = {
  funding: null,
  fundingAt: null,
  fundingZ: null,
  markets: null,
  marketsAt: null,
  hip3: null,
  hip3At: null,
  hip3Candles: {},
  macroFit: null,
  macroFitAt: null,
};
let fundingHistory: { time: number; rate: number }[] | null = null;

const listeners = new Set<() => void>();
function update(patch: Partial<CrossMarketSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

async function postInfo(body: unknown): Promise<unknown> {
  const r = await fetch(INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(10_000) : undefined,
  });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json();
}

const candles = async (coin: string, interval: string, startTime: number) =>
  parseCandles(await postInfo({ type: 'candleSnapshot', req: { coin, interval, startTime } }));

function recomputeFundingZ() {
  const hl = snapshot.funding?.byVenue.HlPerp;
  update({ fundingZ: hl && fundingHistory ? fundingZ(fundingHistory, hl.rate, Date.now()) : null });
}

type JobId = 'predicted' | 'fundingHistory' | 'metaMain' | 'metaXyz' | 'macroCandles';
interface Job {
  need: CrossMarketNeed;
  periodMs: number;
  ready?: () => boolean;
  run: () => Promise<void>;
}

const JOBS: Record<JobId, Job> = {
  predicted: {
    need: 'funding',
    periodMs: PERIOD_MS.funding,
    run: async () => {
      const f = parsePredictedFundings(await postInfo({ type: 'predictedFundings' }));
      if (!f) throw new Error('predictedFundings: brak BTC');
      update({ funding: f, fundingAt: Date.now() });
      recomputeFundingZ();
    },
  },
  fundingHistory: {
    need: 'funding',
    periodMs: PERIOD_MS.fundingHistory,
    run: async () => {
      const h = parseFundingHistory(await postInfo({ type: 'fundingHistory', coin: 'BTC', startTime: Date.now() - 7 * 24 * H }));
      if (h.length === 0) throw new Error('fundingHistory: pusto');
      fundingHistory = h;
      recomputeFundingZ();
    },
  },
  metaMain: {
    need: 'map',
    periodMs: PERIOD_MS.map,
    run: async () => {
      const rows = parseMarketMap(await postInfo({ type: 'metaAndAssetCtxs', dex: '' }));
      if (rows.length === 0) throw new Error('metaAndAssetCtxs: pusto');
      update({ markets: rows, marketsAt: Date.now() });
    },
  },
  metaXyz: {
    need: 'macro',
    periodMs: PERIOD_MS.macro,
    run: async () => {
      // Brak dexu „xyz” → wszystkie kafle n/a (to też jest odpowiedź, nie błąd sieci)
      update({ hip3: parseHip3(await postInfo({ type: 'metaAndAssetCtxs', dex: 'xyz' }), HIP3_MACRO), hip3At: Date.now() });
    },
  },
  macroCandles: {
    need: 'macro',
    periodMs: PERIOD_MS.macroCandles,
    ready: () => snapshot.hip3 !== null,
    run: async () => {
      const now = Date.now();
      const tiles = (snapshot.hip3 ?? []).filter((t) => t.coin !== null);
      const coinOf = (key: string) => tiles.find((t) => t.key === key)?.coin ?? null;
      const ndx = coinOf('XYZ100');
      const spx = coinOf('SP500');
      const [hourly, btc5, ndx5, spx5] = await Promise.all([
        Promise.all(tiles.map((t) => candles(t.coin!, '1h', now - 49 * H).catch(() => [] as Candle[]))),
        candles('BTC', '5m', now - 24 * H),
        ndx ? candles(ndx, '5m', now - 24 * H) : Promise.resolve([] as Candle[]),
        spx ? candles(spx, '5m', now - 24 * H) : Promise.resolve([] as Candle[]),
      ]);
      const hip3Candles: Record<string, Candle[]> = {};
      tiles.forEach((t, i) => (hip3Candles[t.key] = hourly[i].slice(-48)));
      const fit = (proxy: Candle[]): MacroFit => ({
        fit: rollingBetaR2(btc5, proxy),
        n: pairedLogReturns(btc5, proxy).length,
      });
      update({ hip3Candles, macroFit: { XYZ100: fit(ndx5), SP500: fit(spx5) }, macroFitAt: now });
    },
  },
};
const JOB_IDS = Object.keys(JOBS) as JobId[];

const subscribers = new Map<string, Set<CrossMarketNeed>>();
const lastRun: Record<JobId, number> = { predicted: 0, fundingHistory: 0, metaMain: 0, metaXyz: 0, macroCandles: 0 };
const running = new Set<JobId>();
let streaming = true;
let timer: ReturnType<typeof setInterval> | null = null;

const needed = (n: CrossMarketNeed) => [...subscribers.values()].some((s) => s.has(n));
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Uruchamia zaległe zadania; po błędzie ponowienie po ~15 s, poprzednie dane zostają. */
function tick() {
  if (!streaming || !visible()) return;
  const now = Date.now();
  for (const id of JOB_IDS) {
    const job = JOBS[id];
    if (!needed(job.need) || running.has(id) || now - lastRun[id] < job.periodMs) continue;
    if (job.ready && !job.ready()) continue;
    running.add(id);
    lastRun[id] = now;
    job
      .run()
      .catch(() => {
        lastRun[id] = Date.now() - job.periodMs + 15_000;
      })
      .finally(() => {
        running.delete(id);
        // Zadania zależne (świece HIP-3 po metadanych dexu) startują od razu
        if (id === 'metaXyz') tick();
      });
  }
}

const onVisibility = () => tick();

function register(id: string, needs: Set<CrossMarketNeed>) {
  subscribers.set(id, needs);
  if (timer === null) {
    timer = setInterval(tick, 5_000);
    document.addEventListener('visibilitychange', onVisibility);
  }
  tick();
}

function unregister(id: string) {
  subscribers.delete(id);
  if (subscribers.size === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibility);
  }
}

function listen(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getSnapshot = () => snapshot;

/** Świeżość danych dla znacznika: LIVE do 3 okresów odpytywania, potem STALE, brak = none. */
export function freshness(at: number | null, periodMs: number, nowMs: number): 'live' | 'stale' | 'none' {
  if (at === null) return 'none';
  return nowMs - at <= 3 * periodMs ? 'live' : 'stale';
}

/** Subskrypcja danych międzyrynkowych; `needs` decyduje, które zapytania są wykonywane. */
export function useCrossMarket(needs: CrossMarketNeed[]): CrossMarketSnapshot {
  const { feed } = useDesk();
  const id = useId();
  const key = [...needs].sort().join(',');

  useEffect(() => {
    streaming = feed.isStreaming;
    tick();
  }, [feed.isStreaming]);

  useEffect(() => {
    register(id, new Set(key.split(',') as CrossMarketNeed[]));
    return () => unregister(id);
  }, [id, key]);

  return useSyncExternalStore(listen, getSnapshot, getSnapshot);
}
