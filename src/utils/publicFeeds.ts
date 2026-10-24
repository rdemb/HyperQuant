import { useEffect, useState } from 'react';
import type { MacroEvent } from '../data/macroCalendar';
import type { BadgeTone } from '../ui/Badge';
import { locale, tr } from '../i18n';

/**
 * Loader plików z potoku danych publicznych (`scripts/fetch-public-data.mjs` → `public/data/feeds/*.json`).
 * Pliki są statyczne (GitHub Pages), więc cache w module + odświeżanie co 10 min wystarcza.
 * Brak pliku = null — UI pokazuje uczciwy EmptyState zamiast liczb zastępczych.
 */

export type NewsCategory = 'crypto' | 'macro' | 'regulation';
export interface NewsItem {
  title: string;
  link: string;
  source: string;
  /** Czas publikacji (ms UTC) */
  time: number;
  category: NewsCategory;
}
/** Rentowności UST w %, dzień sesji (YYYY-MM-DD) */
export interface UstPoint {
  date: string;
  y2: number | null;
  y10: number | null;
}
/** Wartość dzienna w $ mld */
export interface DatedValue {
  date: string;
  value: number;
}
/** CFTC TFF, Bitcoin CME (kontrakty po 5 BTC): pozycje netto long − short */
export interface CotRow {
  date: string;
  levNet: number;
  assetMgrNet: number;
  dealerNet: number;
  oi: number;
}
export interface FngPoint {
  time: number;
  value: number;
  classification: string;
}
export interface TonePoint {
  time: number;
  tone: number;
}
export interface MempoolFees {
  fastestFee: number | null;
  halfHourFee: number | null;
  hourFee: number | null;
  economyFee: number | null;
  minimumFee: number | null;
}
export interface DifficultyAdjustment {
  progressPercent: number | null;
  difficultyChange: number | null;
  remainingBlocks: number | null;
  estimatedRetargetDate: number | null;
}
export interface HashratePoint {
  time: number;
  /** H/s */
  hashrate: number;
}

export interface FeedDataMap {
  news: { items: NewsItem[] | null };
  macro: { ust: UstPoint[] | null; tga: DatedValue[] | null; rrp: DatedValue[] | null };
  cot: { btc: CotRow[] | null };
  sentiment: { fng: FngPoint[] | null; gdeltTone: TonePoint[] | null };
  onchain: { fees: MempoolFees | null; difficulty: DifficultyAdjustment | null; hashrate: HashratePoint[] | null };
  calendar: { bea: MacroEvent[] | null };
}
export type FeedName = keyof FeedDataMap;

export interface FeedPartMeta {
  ok: boolean;
  /** Kiedy ta część była naprawdę pobrana (przy fallbacku — data poprzedniej wersji) */
  asOf: string | null;
  error?: string;
}
export interface FeedEnvelope<T> {
  generatedAt: string;
  source: string;
  attribution: string;
  data: T;
  parts?: Record<string, FeedPartMeta>;
}

export const FEED_TTL_MS = 10 * 60000;
/** Próg świeżości: dane młodsze niż 90 min = LIVE, starsze = STALE */
export const LIVE_MAX_AGE_MS = 90 * 60000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const cache = new Map<FeedName, { at: number; promise: Promise<FeedEnvelope<unknown> | null> }>();

function isEnvelope(v: unknown): v is FeedEnvelope<unknown> {
  const o = v as FeedEnvelope<unknown> | null;
  return !!o && typeof o === 'object' && typeof o.generatedAt === 'string' && !!o.data && typeof o.data === 'object';
}

async function fetchFeed(name: FeedName, fetchImpl: FetchLike): Promise<FeedEnvelope<unknown> | null> {
  try {
    const res = await fetchImpl(`./data/feeds/${name}.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isEnvelope(body) ? body : null;
  } catch {
    // Brak sieci, plik nie istnieje (dev zwraca index.html) albo uszkodzony JSON
    return null;
  }
}

/** Pobiera plik feedu z cache w module (TTL 10 min). Nigdy nie rzuca — brak danych = null. */
export function loadFeed<K extends FeedName>(
  name: K,
  opts: { fetchImpl?: FetchLike; now?: number } = {}
): Promise<FeedEnvelope<FeedDataMap[K]> | null> {
  const now = opts.now ?? Date.now();
  const hit = cache.get(name);
  if (hit && now - hit.at < FEED_TTL_MS) return hit.promise as Promise<FeedEnvelope<FeedDataMap[K]> | null>;
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const promise = fetchFeed(name, fetchImpl);
  cache.set(name, { at: now, promise });
  return promise as Promise<FeedEnvelope<FeedDataMap[K]> | null>;
}

/** Tylko do testów. */
export function clearFeedCache(): void {
  cache.clear();
}

/** Data pobrania części pliku: parts[nazwa].asOf, a gdy brak metadanych — generatedAt. */
export function partAsOf(env: FeedEnvelope<unknown> | null, part: string): string | null {
  if (!env) return null;
  const meta = env.parts?.[part];
  return meta ? meta.asOf : env.generatedAt;
}

export function feedFreshness(asOf: string | null | undefined, nowMs: number): 'live' | 'stale' | null {
  const t = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(t)) return null;
  return nowMs - t < LIVE_MAX_AGE_MS ? 'live' : 'stale';
}

/** Znacznik świeżości do `Stat.source` / `Badge`: LIVE / STALE / BRAK + data pobrania w podpowiedzi. */
export function freshnessBadge(asOf: string | null | undefined, nowMs: number): { tone: BadgeTone; label: string; title: string } {
  const f = feedFreshness(asOf, nowMs);
  if (!f || !asOf) return { tone: 'neutral', label: tr('BRAK', 'NONE'), title: tr('Brak danych z potoku publicznego', 'No data from the public pipeline') };
  const t = Date.parse(asOf);
  const when = `${tr('Pobrano', 'Fetched')} ${new Date(t).toLocaleString(locale)} (${fmtAgo(t, nowMs)})`;
  return f === 'live'
    ? { tone: 'live', label: 'LIVE', title: when }
    : { tone: 'stale', label: 'STALE', title: `${when} ${tr('— starsze niż 90 min', '(older than 90 min)')}` };
}

/** Czas względny: „przed chwilą” / „5 min temu” / „3 h temu” / „2 dni temu”. */
export function fmtAgo(timeMs: number, nowMs: number): string {
  if (!Number.isFinite(timeMs)) return '—';
  const min = Math.floor((nowMs - timeMs) / 60000);
  if (min < 1) return tr('przed chwilą', 'just now');
  if (min < 60) return tr(`${min} min temu`, `${min} min ago`);
  const h = Math.floor(min / 60);
  if (h < 24) return tr(`${h} h temu`, `${h} h ago`);
  const d = Math.floor(h / 24);
  return d === 1 ? tr('1 dzień temu', '1 day ago') : tr(`${d} dni temu`, `${d} days ago`);
}

export type FeedStatus = 'loading' | 'ready' | 'missing';

/**
 * Hook: plik feedu z odświeżaniem co 10 min. Przy nieudanym odświeżeniu trzyma poprzednie dane
 * (bez skoków układu); `missing` tylko gdy pliku nie było od początku.
 */
export function usePublicFeed<K extends FeedName>(name: K): { feed: FeedEnvelope<FeedDataMap[K]> | null; status: FeedStatus } {
  const [feed, setFeed] = useState<FeedEnvelope<FeedDataMap[K]> | null>(null);
  const [status, setStatus] = useState<FeedStatus>('loading');

  useEffect(() => {
    let alive = true;
    const run = () =>
      loadFeed(name).then((env) => {
        if (!alive) return;
        if (env) {
          setFeed(env);
          setStatus('ready');
        } else setStatus((s) => (s === 'ready' ? s : 'missing'));
      });
    run();
    // +1 s, żeby odświeżenie nie trafiło tuż przed wygaśnięciem cache
    const id = window.setInterval(run, FEED_TTL_MS + 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [name]);

  return { feed, status };
}

/** Zegar UI (odliczania, wiek danych) — tyka co `intervalMs`. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
