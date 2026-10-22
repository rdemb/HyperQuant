import { useEffect, useState } from 'react';

/**
 * Publiczny adres danych skanera (repo rdemb/hyperquant-data przez raw.githubusercontent.com) — z builda.
 * Serwer skanera nigdy nie jest widoczny dla przeglądarki.
 */
export const DATA_BASE = String(import.meta.env.VITE_DATA_BASE_URL ?? '').replace(/\/+$/, '');
const REFRESH_MS = 60_000;

interface Entry {
  cache: { asOf: number } | null;
  inflight: Promise<{ asOf: number } | null> | null;
}
const entries = new Map<string, Entry>();

async function load<T>(path: string, guard: (x: unknown) => x is T): Promise<T | null> {
  try {
    const res = await fetch(`${DATA_BASE}/${path}`, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j: unknown = await res.json();
    return guard(j) ? j : null;
  } catch {
    return null;
  }
}

export interface Published<T> {
  /** false = build bez adresu danych */
  configured: boolean;
  value: T | null;
  /** Ostatnie pobranie nieudane (wartość może pochodzić z wcześniejszego pobrania) */
  failed: boolean;
}

/**
 * Plik JSON z publicznych danych skanera — odświeżany co minutę (tylko w widocznej karcie), wspólny dla widoków.
 * Nowsza publikacja zastępuje starszą; odpowiedź starsza (np. z pamięci podręcznej CDN) jej nie cofa.
 */
export function usePublished<T extends { asOf: number }>(path: string, guard: (x: unknown) => x is T): Published<T> {
  const entry = entries.get(path) ?? { cache: null, inflight: null };
  entries.set(path, entry);
  const [state, setState] = useState<Published<T>>(() => ({ configured: !!DATA_BASE, value: entry.cache as T | null, failed: false }));

  useEffect(() => {
    if (!DATA_BASE) return;
    let alive = true;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      if (!entry.inflight) entry.inflight = load(path, guard).finally(() => (entry.inflight = null));
      entry.inflight.then((v) => {
        if (v && (!entry.cache || v.asOf >= entry.cache.asOf)) entry.cache = v;
        if (alive) setState({ configured: true, value: entry.cache as T | null, failed: v === null });
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
    // Strażnik jest stałą modułu wywołującego — zależność tylko od ścieżki
  }, [path]);

  return state;
}
