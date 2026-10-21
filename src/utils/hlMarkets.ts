/**
 * Silnik widoku „Rynek”: czyste parsery odpowiedzi publicznego API Hyperliquid (`POST /info`)
 * i statystyki międzyrynkowe. Bez sieci i bez stanu — odpytywanie jest w `state/useCrossMarket.ts`.
 * Zasada: brak/nieczytelne dane = null (UI pokaże „—” / „n/a”), nigdy liczba zastępcza.
 */

export type FundingVenue = 'HlPerp' | 'BinPerp' | 'BybitPerp';

/** Stała kolejność wierszy w UI: najpierw HL, potem CEX. */
export const FUNDING_VENUES: FundingVenue[] = ['HlPerp', 'BinPerp', 'BybitPerp'];
export const VENUE_LABEL: Record<FundingVenue, string> = { HlPerp: 'Hyperliquid', BinPerp: 'Binance', BybitPerp: 'Bybit' };

/** Domyślny interwał płatności, gdy API nie poda `fundingIntervalHours` (HL co 1 h, CEX zwykle co 8 h). */
const DEFAULT_INTERVAL_H: Record<FundingVenue, number> = { HlPerp: 1, BinPerp: 8, BybitPerp: 8 };

export interface VenueFunding {
  venue: FundingVenue;
  /** Stawka za jeden okres płatności (ułamek, np. 0.0001 = 0.01%) */
  rate: number;
  intervalH: number;
  aprPct: number;
  nextFundingTime: number | null;
}

export interface PredictedFundings {
  coin: string;
  byVenue: Record<FundingVenue, VenueFunding | null>;
  /** HL − Binance i HL − Bybit w punktach procentowych APR */
  spreadHlBinancePp: number | null;
  spreadHlBybitPp: number | null;
}

export interface MarketRow {
  coin: string;
  markPx: number;
  change24hPct: number | null;
  oiUsd: number;
  volume24hUsd: number;
  fundingAprPct: number | null;
  premiumBps: number | null;
}

export interface Hip3Spec {
  key: string;
  label: string;
  /** Akceptowane sufiksy nazwy rynku (po „dex:”), w kolejności priorytetu */
  aliases: string[];
}

export interface Hip3Tile {
  key: string;
  label: string;
  /** Pełna nazwa rynku w HL (np. „xyz:SP500”) albo null, gdy dex go nie ma */
  coin: string | null;
  markPx: number | null;
  change24hPct: number | null;
  oiUsd: number | null;
  volume24hUsd: number | null;
  fundingAprPct: number | null;
  /** Zerowy wolumen 24h — podejrzenie zamkniętej sesji kasowej */
  quiet: boolean;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface TimedClose {
  t: number;
  c: number;
}

export interface BetaR2 {
  beta: number;
  r2: number;
  corr: number;
  n: number;
}

export interface FundingZ {
  z: number;
  mean: number;
  sd: number;
  n: number;
}

/**
 * Rynki HIP-3 (trade.xyz, dex „xyz”) używane jako proxy makro. Lista nazw pochodzi ze źródeł
 * zewnętrznych i jest NIEPEWNA — rynki rozwiązujemy w runtime po sufiksie z `meta.universe`.
 */
export const HIP3_MACRO: Hip3Spec[] = [
  { key: 'SP500', label: 'S&P 500', aliases: ['SP500', 'SPX', 'US500'] },
  { key: 'XYZ100', label: 'Nasdaq-100', aliases: ['XYZ100', 'NDX', 'NAS100', 'US100'] },
  { key: 'GOLD', label: 'Złoto', aliases: ['GOLD', 'XAU'] },
  { key: 'CL', label: 'Ropa WTI', aliases: ['CL', 'WTI', 'WTIOIL'] },
  { key: 'EUR', label: 'EUR', aliases: ['EUR', 'EURUSD'] },
  { key: 'JPY', label: 'JPY', aliases: ['JPY', 'USDJPY'] },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Liczba skończona ze stringa/liczby API albo null. */
function num(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const x = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

/** Stawka okresowa → APR w %: rate · (24 / interwał h) · 365 · 100. */
export function fundingAprPct(rate: number, intervalH: number): number {
  return rate * (24 / intervalH) * 365 * 100;
}

/** `{"type":"predictedFundings"}` → stawki BTC (lub `coin`) per venue, znormalizowane do APR, i spready HL−CEX. */
export function parsePredictedFundings(raw: unknown, coin = 'BTC'): PredictedFundings | null {
  if (!Array.isArray(raw)) return null;
  const entry = raw.find((e) => Array.isArray(e) && e[0] === coin);
  if (!entry || !Array.isArray(entry[1])) return null;

  const byVenue: Record<FundingVenue, VenueFunding | null> = { HlPerp: null, BinPerp: null, BybitPerp: null };
  for (const pair of entry[1] as unknown[]) {
    if (!Array.isArray(pair)) continue;
    const venue = pair[0] as FundingVenue;
    const info = pair[1];
    if (!(venue in byVenue) || !isRecord(info)) continue;
    const rate = num(info.fundingRate);
    if (rate === null) continue;
    const ih = num(info.fundingIntervalHours);
    const intervalH = ih !== null && ih > 0 ? ih : DEFAULT_INTERVAL_H[venue];
    byVenue[venue] = { venue, rate, intervalH, aprPct: fundingAprPct(rate, intervalH), nextFundingTime: num(info.nextFundingTime) };
  }

  const hl = byVenue.HlPerp;
  const spread = (cex: VenueFunding | null) => (hl && cex ? hl.aprPct - cex.aprPct : null);
  return { coin, byVenue, spreadHlBinancePp: spread(byVenue.BinPerp), spreadHlBybitPp: spread(byVenue.BybitPerp) };
}

interface RawRow {
  coin: string;
  delisted: boolean;
  markPx: number | null;
  prevDayPx: number | null;
  openInterest: number | null;
  volume24hUsd: number | null;
  funding: number | null;
  premium: number | null;
}

/** `metaAndAssetCtxs` → wiersze wyrównane indeksem (universe[i] ↔ ctxs[i]), bez filtrowania. */
function parseCtxRows(metaCtxs: unknown): RawRow[] {
  if (!Array.isArray(metaCtxs) || metaCtxs.length < 2) return [];
  const [meta, ctxs] = metaCtxs;
  if (!isRecord(meta) || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return [];
  const n = Math.min(meta.universe.length, ctxs.length);
  const rows: RawRow[] = [];
  for (let i = 0; i < n; i++) {
    const u = meta.universe[i];
    const c = ctxs[i];
    if (!isRecord(u) || typeof u.name !== 'string' || !isRecord(c)) continue;
    rows.push({
      coin: u.name,
      delisted: u.isDelisted === true,
      markPx: num(c.markPx),
      prevDayPx: num(c.prevDayPx),
      openInterest: num(c.openInterest),
      volume24hUsd: num(c.dayNtlVlm),
      funding: num(c.funding),
      premium: num(c.premium),
    });
  }
  return rows;
}

const change24h = (mark: number | null, prev: number | null) =>
  mark !== null && prev !== null && prev > 0 ? ((mark - prev) / prev) * 100 : null;

/** Mapa rynku perpów HL: OI w USD (= openInterest w monetach × markPx), zmiana 24h, funding APR (stawka godzinowa), premia w bps. */
export function parseMarketMap(metaCtxs: unknown): MarketRow[] {
  const out: MarketRow[] = [];
  for (const r of parseCtxRows(metaCtxs)) {
    if (r.delisted || r.markPx === null || r.markPx <= 0) continue;
    const oiUsd = r.openInterest !== null ? r.openInterest * r.markPx : 0;
    const volume24hUsd = r.volume24hUsd ?? 0;
    if (!(oiUsd > 0) && !(volume24hUsd > 0)) continue;
    out.push({
      coin: r.coin,
      markPx: r.markPx,
      change24hPct: change24h(r.markPx, r.prevDayPx),
      oiUsd,
      volume24hUsd,
      fundingAprPct: r.funding !== null ? fundingAprPct(r.funding, 1) : null,
      premiumBps: r.premium !== null ? r.premium * 1e4 : null,
    });
  }
  return out;
}

/** Kafle proxy makro z dexu HIP-3: rynek wyszukany po sufiksie nazwy (aliasy), brak = coin null. */
export function parseHip3(metaCtxs: unknown, wanted: Hip3Spec[]): Hip3Tile[] {
  const rows = parseCtxRows(metaCtxs).filter((r) => !r.delisted);
  const suffix = (name: string) => (name.split(':').pop() ?? name).toUpperCase();
  return wanted.map((spec) => {
    let row: RawRow | undefined;
    for (const a of spec.aliases) {
      row = rows.find((r) => suffix(r.coin) === a.toUpperCase());
      if (row) break;
    }
    if (!row) {
      return { key: spec.key, label: spec.label, coin: null, markPx: null, change24hPct: null, oiUsd: null, volume24hUsd: null, fundingAprPct: null, quiet: false };
    }
    const mark = row.markPx !== null && row.markPx > 0 ? row.markPx : null;
    return {
      key: spec.key,
      label: spec.label,
      coin: row.coin,
      markPx: mark,
      change24hPct: change24h(mark, row.prevDayPx),
      oiUsd: mark !== null && row.openInterest !== null ? row.openInterest * mark : null,
      volume24hUsd: row.volume24hUsd,
      fundingAprPct: row.funding !== null ? fundingAprPct(row.funding, 1) : null,
      quiet: row.volume24hUsd === 0,
    };
  });
}

/** `candleSnapshot` → świece liczbowe posortowane po czasie otwarcia; uszkodzone pomijane. */
export function parseCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const k of raw) {
    if (!isRecord(k)) continue;
    const t = num(k.t), o = num(k.o), h = num(k.h), l = num(k.l), c = num(k.c), v = num(k.v);
    if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
    out.push({ t, o, h, l, c, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** `{"type":"fundingHistory"}` → godzinowe stawki HL `{time, rate}` posortowane po czasie. */
export function parseFundingHistory(raw: unknown): { time: number; rate: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { time: number; rate: number }[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const time = num(r.time);
    const rate = num(r.fundingRate);
    if (time !== null && rate !== null) out.push({ time, rate });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Pary log-zwrotów BTC i proxy na wspólnej siatce czasu. Zwrot liczymy tylko między kolejnymi
 * wspólnymi świecami odległymi o ≤ 1.5 kroku (mediana) — zwroty „przez lukę” (weekend, przerwa
 * w sesji, brak świecy) mieszałyby różne horyzonty i są pomijane.
 */
export function pairedLogReturns(btc: TimedClose[], proxy: TimedClose[]): { rb: number; rp: number }[] {
  const proxyAt = new Map<number, number>();
  for (const p of proxy) if (p.c > 0) proxyAt.set(p.t, p.c);
  const aligned = btc
    .filter((b) => b.c > 0 && proxyAt.has(b.t))
    .sort((a, b) => a.t - b.t)
    .map((b) => ({ t: b.t, b: b.c, p: proxyAt.get(b.t)! }));
  if (aligned.length < 2) return [];
  const diffs = aligned.slice(1).map((x, i) => x.t - aligned[i].t).sort((a, b) => a - b);
  const step = diffs[Math.floor(diffs.length / 2)];
  const out: { rb: number; rp: number }[] = [];
  for (let i = 1; i < aligned.length; i++) {
    if (aligned[i].t - aligned[i - 1].t > step * 1.5) continue;
    out.push({ rb: Math.log(aligned[i].b / aligned[i - 1].b), rp: Math.log(aligned[i].p / aligned[i - 1].p) });
  }
  return out;
}

/**
 * β i R² z OLS: r_btc = α + β · r_proxy + ε na log-zwrotach (np. 5m, ostatnie 24 h).
 * R² czytamy jako „udział makro”: jaka część wariancji ruchu BTC współwystępuje z ruchem proxy.
 * Uwaga — zależność jest NIESTABILNA: IMF (2022, „Crypto Prices Move More in Sync With Stocks”)
 * pokazuje wzrost korelacji BTC–S&P 500 z ~0.01 (2017–2019) do ~0.36 (2020–2021); w krótkim oknie
 * estymata mocno skacze. Proxy HIP-3 nie mają realnego notowania kasowego w weekend/poza sesją —
 * wtedy proxy stoi (zerowa wariancja → null) albo R² spada do zera, co nie znaczy „brak makro”.
 * Zwraca null, gdy n < 30 albo któraś wariancja jest zerowa.
 */
export function rollingBetaR2(btc: TimedClose[], proxy: TimedClose[], minN = 30): BetaR2 | null {
  const pairs = pairedLogReturns(btc, proxy);
  const n = pairs.length;
  if (n < minN) return null;
  let mb = 0, mp = 0;
  for (const x of pairs) {
    mb += x.rb;
    mp += x.rp;
  }
  mb /= n;
  mp /= n;
  let sbb = 0, spp = 0, sbp = 0;
  for (const x of pairs) {
    const db = x.rb - mb, dp = x.rp - mp;
    sbb += db * db;
    spp += dp * dp;
    sbp += db * dp;
  }
  // Próg względny chroni przed szumem zmiennoprzecinkowym przy „stojącym” rynku
  if (!(spp > 1e-18) || !(sbb > 1e-18)) return null;
  const corr = sbp / Math.sqrt(sbb * spp);
  return { beta: sbp / spp, r2: corr * corr, corr, n };
}

/**
 * Z-score bieżącej stawki fundingu HL względem godzinowych stawek z ostatnich 7 dni — miernik
 * zatłoczenia pozycji (crowding). Podstawa: Schmeling, Schrimpf, Todorov (2023, BIS WP 1087 „Crypto
 * carry”) — wysoki funding/carry poprzedza większe ryzyko gwałtownych odwróceń; He, Manela, Ross,
 * von Wachter (2022, „Fundamentals of Perpetual Futures”) — funding jako cena popytu na dźwignię.
 * Zwraca null, gdy w oknie < `minN` stawek albo σ = 0.
 */
export function fundingZ(
  history: { time: number; rate: number }[],
  currentRate: number,
  nowMs: number,
  windowMs = 7 * 24 * 3_600_000,
  minN = 24
): FundingZ | null {
  const xs = history.filter((h) => h.time >= nowMs - windowMs && h.time <= nowMs).map((h) => h.rate);
  const n = xs.length;
  if (n < minN || !Number.isFinite(currentRate)) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  // Funding HL często stoi na stałej stawce bazowej — σ bliskie zeru to szum zmiennoprzecinkowy, nie zmienność
  if (!(sd > 1e-12)) return null;
  return { z: (currentRate - mean) / sd, mean, sd, n };
}

/**
 * Czy rynek wygląda na zamknięty (poza sesją kasową): brak świec od ≥ 3 interwałów albo ostatnie
 * 3 świece bez zakresu lub wolumenu. Heurystyka — UI pokazuje to jako pytanie („rynek zamknięty?”).
 */
export function recentlyFlat(candles: Candle[], nowMs: number, intervalMs: number): boolean | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  if (nowMs - last.t >= 3 * intervalMs) return true;
  return candles.slice(-3).every((k) => k.v === 0 || k.h === k.l);
}

/** Top N wierszy malejąco wg `value` (tylko dodatnie) i suma reszty jako „Inne”. */
export function topWithOther<T>(rows: T[], value: (r: T) => number, n: number): { top: T[]; other: { count: number; total: number } | null } {
  const sorted = rows.filter((r) => value(r) > 0).sort((a, b) => value(b) - value(a));
  const rest = sorted.slice(n);
  return {
    top: sorted.slice(0, n),
    other: rest.length ? { count: rest.length, total: rest.reduce((a, r) => a + value(r), 0) } : null,
  };
}
