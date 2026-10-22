import { useEffect, useState } from 'react';

/**
 * Publiczny adres danych skanera (repo rdemb/hyperquant-data przez raw.githubusercontent.com) — z builda.
 * Serwer skanera nigdy nie jest widoczny dla przeglądarki.
 */
export const DATA_BASE = String(import.meta.env.VITE_DATA_BASE_URL ?? '').replace(/\/+$/, '');
/**
 * Gałąź `ledger` tego samego repo (dziennik prognoz z przyrostową historią): …/hyperquant-data/main → …/hyperquant-data/ledger.
 * Lokalny podgląd bez „/main” serwuje oba zestawy plików z jednego katalogu.
 */
export const LEDGER_BASE = DATA_BASE.replace(/\/main$/, '/ledger');
const REFRESH_MS = 60_000;

interface Entry {
  cache: { asOf: number } | null;
  inflight: Promise<{ asOf: number } | null> | null;
}
const entries = new Map<string, Entry>();

async function load<T>(url: string, guard: (x: unknown) => x is T): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
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
export function usePublished<T extends { asOf: number }>(path: string, guard: (x: unknown) => x is T, base: string = DATA_BASE): Published<T> {
  const url = `${base}/${path}`;
  const entry = entries.get(url) ?? { cache: null, inflight: null };
  entries.set(url, entry);
  const [state, setState] = useState<Published<T>>(() => ({ configured: !!DATA_BASE, value: entry.cache as T | null, failed: false }));

  useEffect(() => {
    if (!DATA_BASE) return;
    let alive = true;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      if (!entry.inflight) entry.inflight = load(url, guard).finally(() => (entry.inflight = null));
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
    // Strażnik jest stałą modułu wywołującego — zależność tylko od adresu
  }, [url]);

  return state;
}
