import { useEffect, useState } from 'react';
import { LiqMap, isLiqMap } from '../utils/liqMap';
import { liqMapFreshness } from '../utils/liqMapView';

export interface LiqMapState {
  /** unconfigured = brak adresu danych w buildzie; stale = mapa starsza niż 10 min (nie jest pokazywana jako aktualna) */
  status: 'unconfigured' | 'loading' | 'ready' | 'stale' | 'error';
  map: LiqMap | null;
}

/** Publiczny adres danych (bucket Cloudflare R2) — z builda; serwer skanera nigdy nie jest widoczny dla przeglądarki. */
const BASE = String(import.meta.env.VITE_DATA_BASE_URL ?? '').replace(/\/+$/, '');
const REFRESH_MS = 60_000;

let cache: LiqMap | null = null;
let inflight: Promise<LiqMap | null> | null = null;

async function loadLiqMap(): Promise<LiqMap | null> {
  try {
    const res = await fetch(`${BASE}/liq-map/BTC.json`, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j: unknown = await res.json();
    return isLiqMap(j) ? j : null;
  } catch {
    return null;
  }
}

const stateOf = (map: LiqMap | null, failed: boolean): LiqMapState =>
  map ? { status: liqMapFreshness(map, Date.now()), map } : { status: failed ? 'error' : 'loading', map: null };

/** Mapa likwidacji z pozycji on-chain (skaner HyperQuant) — odświeżana co minutę, wspólna dla widoków. */
export function useLiqMap(): LiqMapState {
  const [state, setState] = useState<LiqMapState>(() => (BASE ? stateOf(cache, false) : { status: 'unconfigured', map: null }));

  useEffect(() => {
    if (!BASE) return;
    let alive = true;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      if (!inflight) inflight = loadLiqMap().finally(() => (inflight = null));
      inflight.then((m) => {
        if (m && (!cache || m.asOf >= cache.asOf)) cache = m;
        if (alive) setState(stateOf(cache, m === null));
      });
    };
    run();
    const id = window.setInterval(run, REFRESH_MS);
    document.addEventListener('visibilitychange', run);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);

  return state;
}
