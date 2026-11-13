import { tr } from '../i18n';
import { fmtPx } from '../charts/pro/core/footprintBar';
import { DASH, fmtCompact, fmtPct } from '../ui/format';
import type { ChartMarket } from './marketRegistry';

/**
 * Tabela „Rynki” (`#markets`): przeliczenia liczb z odpowiedzi `metaAndAssetCtxs` każdej giełdy z rejestru, świeżość
 * odczytu i powód „—” wiersza. Czysta logika: bez sieci i bez zegara (czas przychodzi w argumencie).
 */

/** Odświeżanie tabeli (tylko przy widocznej karcie). */
export const MARKETS_REFRESH_MS = 60_000;
/** Odczyt starszy niż 3 min: liczby wiersza „—”. */
export const MARKETS_STALE_MS = 180_000;
/**
 * Waga zapytania `metaAndAssetCtxs` (z `dex` i bez): 20, bo nie ma go na liście zapytań o wadze 2 ani 60 („All other
 * documented info requests have weight 20”). Limit: 1200 wag na minutę na adres IP. Źródło: dokumentacja Hyperliquid,
 * „Rate limits and user limits”, odczyt 13.11.2026.
 */
export const META_CTXS_WEIGHT = 20;
export const HL_WEIGHT_LIMIT_PER_MIN = 1200;

/** Liczby rynku z jednej odpowiedzi giełdy; pole, którego giełda nie podała albo podała złe — null. */
export interface MarketCtx {
  markPx: number | null;
  /** Obrót 24 h, USD */
  dayNtlVlm: number | null;
  /** Otwarte pozycje w jednostkach rynku (jak na giełdzie głównej; HIP-3 przyjęte tak samo) */
  openInterest: number | null;
  /** Stawka finansowania za godzinę (ułamek) */
  funding: number | null;
}

/** Stan jednej giełdy: ostatni udany odczyt (`at`, ms) i czas ostatniej nieudanej próby. */
export interface DexState {
  at: number | null;
  ctxs: ReadonlyMap<string, MarketCtx> | null;
  failedAt: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(x) ? x : null;
};

/** Giełdy rynków z listy: główna (`""`) pierwsza, potem w kolejności listy, bez powtórzeń. */
export function registryDexes(markets: readonly ChartMarket[]): string[] {
  const out = new Set<string>();
  if (markets.some((m) => m.dex === '')) out.add('');
  for (const m of markets) out.add(m.dex);
  return [...out];
}

/**
 * `metaAndAssetCtxs` jednej giełdy → liczby rynków według nazwy z rejestru (`BTC`, `xyz:NVDA`; giełda HIP-3 podaje nazwę
 * z przedrostkiem albo bez). Zła odpowiedź → null (cała giełda bez odpowiedzi), zły wiersz → pominięty.
 */
export function parseDexCtxs(raw: unknown, dex: string): Map<string, MarketCtx> | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [meta, ctxs] = raw;
  if (!isRecord(meta) || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return null;
  const out = new Map<string, MarketCtx>();
  const n = Math.min(meta.universe.length, ctxs.length);
  for (let i = 0; i < n; i++) {
    const u = meta.universe[i];
    const c = ctxs[i];
    if (!isRecord(u) || !isRecord(c) || typeof u.name !== 'string') continue;
    const coin = dex === '' || u.name.startsWith(`${dex}:`) ? u.name : `${dex}:${u.name}`;
    const px = num(c.markPx);
    const vlm = num(c.dayNtlVlm);
    const oi = num(c.openInterest);
    out.set(coin, {
      markPx: px !== null && px > 0 ? px : null,
      dayNtlVlm: vlm !== null && vlm >= 0 ? vlm : null,
      openInterest: oi !== null && oi >= 0 ? oi : null,
      funding: num(c.funding),
    });
  }
  return out;
}

/** Otwarte pozycje w USD: `openInterest × markPx`; brak którejś liczby → null. */
export function openInterestUsd(openInterest: number | null, markPx: number | null): number | null {
  return openInterest !== null && markPx !== null && openInterest >= 0 && markPx > 0 ? openInterest * markPx : null;
}

/**
 * Cena jak oś wykresu rynku (`fmtPx`): 5 cyfr znaczących, cena całkowita zawsze w całości (BTC od 100 tys. bez miejsc po
 * przecinku), najwyżej 6 − `szDecimals` miejsc (rynek poniżej 0,01). Brak ceny → „—”.
 */
export const fmtMarketPrice = (px: number | null, szDecimals: number): string => (px === null ? DASH : fmtPx(px, szDecimals));

/** Funding za godzinę w procentach (stawka godzinowa × 100). */
export const fundingHourPct = (hourly: number | null): number | null => (hourly === null ? null : hourly * 100);

/** Funding roczny w procentach, przeliczony: stawka godzinowa × 24 × 365 × 100 (bez składania, jak APR na giełdzie). */
export const fundingYearPct = (hourly: number | null): number | null => (hourly === null ? null : hourly * 24 * 365 * 100);

/** Odczyt świeży: nie starszy niż 3 min (odczyt „z przyszłości” przy przestawionym zegarze też liczy się jako świeży). */
export const isFresh = (at: number | null, now: number): boolean => at !== null && now - at <= MARKETS_STALE_MS;

export type RowWhy = 'waiting' | 'no-response' | 'not-listed' | 'stale';

export interface MarketRow {
  market: ChartMarket;
  /** Nazwa bez przedrostka giełdy (`xyz:NVDA` → `NVDA`) */
  name: string;
  /** Liczby z odczytu (null, gdy wiersz ma „—” z powodem `why`) */
  ctx: MarketCtx | null;
  oiUsd: number | null;
  /** Czas odczytu giełdy rynku (ms) */
  at: number | null;
  why: RowWhy | null;
}

export const bareName = (m: Pick<ChartMarket, 'coin' | 'dex'>): string => (m.dex === '' ? m.coin : m.coin.slice(m.dex.length + 1));

/**
 * Wiersz tabeli dla każdego rynku z listy (rynek bez danych też ma wiersz, z powodem): świeży odczyt jego giełdy z tym
 * rynkiem — liczby; inaczej „—” z powodem (czekam na pierwszą odpowiedź, giełda nie odpowiada, rynku nie ma w
 * odpowiedzi, odczyt starszy niż 3 min).
 */
export function marketRows(markets: readonly ChartMarket[], dexes: Readonly<Record<string, DexState>>, now: number): MarketRow[] {
  return markets.map((market) => {
    const base = { market, name: bareName(market), ctx: null, oiUsd: null };
    const s = dexes[market.dex];
    if (!s || (s.at === null && s.failedAt === null)) return { ...base, at: null, why: 'waiting' as const };
    if (!isFresh(s.at, now) || !s.ctxs) {
      // Ostatnia próba nieudana: giełda nie odpowiada; udany, ale stary odczyt (karta była schowana) — odczyt za stary
      const failedLast = s.failedAt !== null && (s.at === null || s.failedAt > s.at);
      return { ...base, at: s.at, why: failedLast ? ('no-response' as const) : ('stale' as const) };
    }
    const ctx = s.ctxs.get(market.coin);
    if (!ctx) return { ...base, at: s.at, why: 'not-listed' as const };
    return { ...base, ctx, oiUsd: openInterestUsd(ctx.openInterest, ctx.markPx), at: s.at, why: null };
  });
}

export type SortKey = 'oi' | 'volume';

/** Malejąco według otwartych pozycji (domyślnie) albo obrotu; wiersze bez liczby na końcu, w kolejności rejestru. */
export function sortRows(rows: readonly MarketRow[], key: SortKey = 'oi'): MarketRow[] {
  const val = (r: MarketRow) => (key === 'oi' ? r.oiUsd : (r.ctx?.dayNtlVlm ?? null));
  return rows
    .map((r, i) => ({ r, i, v: val(r) }))
    .sort((a, b) => (a.v === null ? (b.v === null ? a.i - b.i : 1) : b.v === null ? -1 : b.v - a.v || a.i - b.i))
    .map((x) => x.r);
}

/** Nazwa giełdy w tekście: główna Hyperliquid albo giełda HIP-3. */
export const dexLabel = (dex: string): string => (dex === '' ? tr('Hyperliquid (główna)', 'Hyperliquid (main)') : `${dex} (HIP-3)`);

/** Powód „—” wiersza. */
export function rowWhyText(why: RowWhy, dex: string): string {
  switch (why) {
    case 'waiting':
      return tr('czekam na pierwszą odpowiedź giełdy', 'waiting for the first exchange response');
    case 'no-response':
      return tr(`giełda ${dexLabel(dex)} nie odpowiedziała`, `exchange ${dexLabel(dex)} did not respond`);
    case 'not-listed':
      return tr('rynku nie ma w odpowiedzi giełdy', 'the exchange response does not list this market');
    case 'stale':
      return tr('odczyt starszy niż 3 min', 'reading older than 3 min');
  }
}

/**
 * Wiersz gotowy do pokazania (komponenty widoku dostają same teksty, bez logiki danych): liczby sformatowane albo „—”,
 * godzina odczytu LIVE albo powód „—”.
 */
export interface MarketRowModel {
  coin: string;
  /** Nazwa bez przedrostka giełdy */
  name: string;
  /** Etykieta giełdy (`Hyperliquid` albo nazwa giełdy HIP-3) i jej pełny opis */
  exchange: string;
  exchangeTitle: string;
  price: string;
  volume: string;
  openInterest: string;
  fundingHour: string;
  /** Funding roczny przeliczony (null, gdy brak stawki) */
  fundingYear: string | null;
  /** Godzina odczytu LIVE (czas lokalny) — gdy liczby są; inaczej null i powód w `why` */
  readAt: string | null;
  why: string | null;
  chartHref: string;
  /** „mapa likwidacji” przy pełnym skanerze; inaczej „—” z powodem */
  scanner: { text: string; why: string | null };
}

export interface MarketGroupModel {
  id: string;
  title: string;
  rows: MarketRowModel[];
}

export function rowModel(r: MarketRow, fmtTime: (ms: number) => string, scannerWhy: (coin: string) => string): MarketRowModel {
  const c = r.ctx;
  const m = r.market;
  return {
    coin: m.coin,
    name: r.name,
    exchange: m.dex === '' ? 'Hyperliquid' : m.dex,
    exchangeTitle: dexLabel(m.dex),
    price: c ? fmtMarketPrice(c.markPx, m.szDecimals) : DASH,
    volume: c ? fmtCompact(c.dayNtlVlm, '$') : DASH,
    openInterest: c ? fmtCompact(r.oiUsd, '$') : DASH,
    fundingHour: c ? fmtPct(fundingHourPct(c.funding), 4) : DASH,
    fundingYear: c && c.funding !== null ? fmtPct(fundingYearPct(c.funding), 1) : null,
    readAt: r.why === null && r.at !== null ? fmtTime(r.at) : null,
    why: r.why === null ? null : rowWhyText(r.why, m.dex),
    chartHref: `#charts?m=${m.coin}`,
    scanner: m.scanner === 'full' ? { text: tr('mapa likwidacji', 'liquidation map'), why: null } : { text: DASH, why: scannerWhy(m.coin) },
  };
}

/**
 * Cała tabela: wiersze każdego rynku z listy, posortowane (`sortRows`) i pogrupowane jak wybór rynku wykresu
 * (`groupsOf`: krypto oraz rynki HIP-3), każdy jako gotowy model wiersza.
 */
export function marketTableModel(
  markets: readonly ChartMarket[],
  dexes: Readonly<Record<string, DexState>>,
  now: number,
  sort: SortKey,
  deps: {
    groupsOf: (markets: readonly ChartMarket[]) => { id: string; title: string; markets: readonly ChartMarket[] }[];
    fmtTime: (ms: number) => string;
    scannerWhy: (coin: string) => string;
  }
): MarketGroupModel[] {
  const rows = sortRows(marketRows(markets, dexes, now), sort);
  const byCoin = new Map(rows.map((r) => [r.market.coin, r]));
  return deps.groupsOf(rows.map((r) => r.market)).map((g) => ({
    id: g.id,
    title: g.title,
    rows: g.markets.map((m) => rowModel(byCoin.get(m.coin)!, deps.fmtTime, deps.scannerWhy)),
  }));
}

/**
 * Licznik wag zapytań strony (limit Hyperliquid liczy wagi na adres IP w oknie minuty). `add` przy każdym zapytaniu;
 * `lastMinute` — suma wag z ostatnich 60 s, `total` — od otwarcia strony.
 */
export class WeightMeter {
  private log: { at: number; w: number }[] = [];
  total = 0;

  add(at: number, w: number): void {
    this.log.push({ at, w });
    this.total += w;
    // Wpisy starsze niż minuta nie są już potrzebne
    const from = at - 60_000;
    while (this.log.length > 0 && this.log[0].at <= from) this.log.shift();
  }

  lastMinute(now: number): number {
    return this.log.reduce((s, e) => (e.at > now - 60_000 && e.at <= now ? s + e.w : s), 0);
  }
}
