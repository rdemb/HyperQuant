/**
 * Dziennik zagrań użytkownika i playbook (setupy). Dane wyłącznie w przeglądarce (localStorage) — nic nie jest wysyłane.
 * Wynik w R od stopu początkowego, MAE/MFE (w R) ze świec 1m Hyperliquid, statystyki per setup z niepewnością:
 * trafność z przedziałem Wilsona, średnie R z przedziałem bootstrap (stałe ziarno — powtarzalny wynik).
 */
import { mulberry32 } from './pathEngine';
import { wilson, type OpenLoc } from './auction';
import type { RangeBar } from './volatility';

export interface Setup {
  id: string;
  name: string;
  /** Kontekst → Lokalizacja → Wyzwalacz → Wykonanie (+ unieważnienie) */
  context: string;
  location: string;
  trigger: string;
  execution: string;
  invalidation: string;
  createdAt: number;
}

export interface TradeCtx {
  /** Odległość od VWAP sesji w σ przy wejściu */
  vwapZ: number | null;
  /** Otwarcie sesji względem VA poprzedniej */
  openLoc: OpenLoc | null;
  /** Stan Initial Balance przy wejściu */
  ib: 'w trakcie' | 'w zakresie' | 'wybity ↑' | 'wybity ↓' | 'wybity ↑↓' | null;
}

export interface Trade {
  id: string;
  setupId: string | null;
  dir: 'LONG' | 'SHORT';
  entryT: number;
  entryPx: number;
  /** Stop początkowy (definiuje 1R) */
  stopPx: number;
  exitT: number | null;
  exitPx: number | null;
  sizeBtc: number | null;
  note: string;
  /** Najgorszy i najlepszy ruch w trakcie (R), ze świec 1m; null = brak danych */
  mae: number | null;
  mfe: number | null;
  ctx: TradeCtx | null;
}

export interface Journal {
  v: 1;
  setups: Setup[];
  trades: Trade[];
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Ryzyko na jednostkę (|wejście − stop|) — 0 albo nieskończone → null. */
function riskPer(t: Trade): number | null {
  const r = Math.abs(t.entryPx - t.stopPx);
  return r > 0 && Number.isFinite(r) ? r : null;
}

/** Wynik zamkniętego zagrania w R; otwarte albo bez ryzyka → null. */
export function rMultiple(t: Trade): number | null {
  const risk = riskPer(t);
  if (risk === null || t.exitPx === null || !Number.isFinite(t.exitPx)) return null;
  return (t.dir === 'LONG' ? t.exitPx - t.entryPx : t.entryPx - t.exitPx) / risk;
}

/**
 * MAE/MFE (R) ze świec 1m w oknie [minuta wejścia, minuta wyjścia] włącznie (czas z dokładnością do minuty — zlecenie
 * zamykające wykonało się w minucie wyjścia): long — MAE z minimum, MFE z maksimum; short odwrotnie. Świece brzegowe mogą
 * zawierać ceny spoza zagrania (przybliżenie do minuty). Ekstremum nie może być płytsze niż wynik: MAE ≤ min(0, R),
 * MFE ≥ max(0, R). Brak świec / ryzyka → null.
 */
export function excursions(t: Trade, bars: RangeBar[]): { mae: number; mfe: number } | null {
  const risk = riskPer(t);
  if (risk === null || t.exitT === null) return null;
  const from = Math.floor(t.entryT / 60_000) * 60_000;
  const to = Math.floor(t.exitT / 60_000) * 60_000;
  const win = bars.filter((b) => b.time >= from && b.time <= to);
  if (win.length === 0) return null;
  const hi = Math.max(...win.map((b) => b.high));
  const lo = Math.min(...win.map((b) => b.low));
  const fav = t.dir === 'LONG' ? hi - t.entryPx : t.entryPx - lo;
  const adv = t.dir === 'LONG' ? lo - t.entryPx : t.entryPx - hi;
  const r = rMultiple(t);
  let mae = Math.min(0, adv) / risk;
  let mfe = Math.max(0, fav) / risk;
  if (r !== null) {
    mae = Math.min(mae, r, 0);
    mfe = Math.max(mfe, r, 0);
  }
  return { mae: r6(mae), mfe: r6(mfe) };
}

/** Przedział bootstrap (percentylowy) dla średniej; stałe ziarno → ten sam wynik dla tych samych danych. */
export function bootstrapMeanCi(xs: number[], level = 0.9, reps = 2000, seed = 1): { lo: number; hi: number } | null {
  if (xs.length === 0) return null;
  const u = mulberry32(seed);
  const means = new Float64Array(reps);
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(u() * xs.length)];
    means[r] = s / xs.length;
  }
  means.sort();
  const a = (1 - level) / 2;
  return { lo: means[Math.floor(a * (reps - 1))], hi: means[Math.ceil((1 - a) * (reps - 1))] };
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface SetupStats {
  /** Zamknięte zagrania z wynikiem */
  n: number;
  open: number;
  wins: number;
  winRate: { p: number; lo: number; hi: number } | null;
  meanR: number | null;
  meanCi: { lo: number; hi: number } | null;
  /** Σ zysków R / |Σ strat R|; brak strat → null (nieokreślony) */
  profitFactor: number | null;
  /** Mediana MAE zwycięskich (jak głęboko szły przeciw, zanim wygrały) */
  medMaeWinners: number | null;
  /** Mediana MFE przegranych (ile dały zarobić, zanim przegrały) */
  medMfeLosers: number | null;
}

/** Statystyki zagrań setupu (`setupId` null = bez setupu). */
export function setupStats(trades: Trade[], setupId: string | null): SetupStats {
  const own = trades.filter((t) => t.setupId === setupId);
  const closed = own.map((t) => ({ t, r: rMultiple(t) })).filter((x): x is { t: Trade; r: number } => x.r !== null);
  const rs = closed.map((x) => x.r);
  const wins = closed.filter((x) => x.r > 0);
  const losses = closed.filter((x) => x.r < 0);
  const gain = wins.reduce((a, x) => a + x.r, 0);
  const loss = -losses.reduce((a, x) => a + x.r, 0);
  return {
    n: closed.length,
    open: own.length - closed.length,
    wins: wins.length,
    winRate: wilson(wins.length, closed.length),
    meanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    meanCi: bootstrapMeanCi(rs, 0.9, 2000, 7),
    profitFactor: loss > 0 ? gain / loss : null,
    medMaeWinners: median(wins.map((x) => x.t.mae).filter((v): v is number => v !== null)),
    medMfeLosers: median(losses.map((x) => x.t.mfe).filter((v): v is number => v !== null)),
  };
}

export const serializeJournal = (j: Journal): string => JSON.stringify(j);

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown) => v === null || isNum(v);
const posNum = (v: unknown) => isNum(v) && v > 0;
/** Czas w ms z sensownego zakresu (2009–2100) — np. nanosekundy wywróciłyby formatowanie dat */
const isTime = (v: unknown) => isNum(v) && v >= 1.23e12 && v <= 4.1e12;
const IB_STATES = new Set(['w trakcie', 'w zakresie', 'wybity ↑', 'wybity ↓', 'wybity ↑↓']);

/** Kontekst przy wejściu: tylko znane pola z poprawnymi typami; inaczej null (zagranie zostaje). */
function cleanCtx(c: unknown): TradeCtx | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const vwapZ = o.vwapZ === null || o.vwapZ === undefined ? null : isNum(o.vwapZ) ? o.vwapZ : undefined;
  const openLoc = o.openLoc === null || o.openLoc === undefined ? null : o.openLoc === 'above' || o.openLoc === 'inside' || o.openLoc === 'below' ? o.openLoc : undefined;
  const ib = o.ib === null || o.ib === undefined ? null : isStr(o.ib) && IB_STATES.has(o.ib) ? (o.ib as TradeCtx['ib']) : undefined;
  if (vwapZ === undefined || openLoc === undefined || ib === undefined) return null;
  return { vwapZ, openLoc, ib };
}

function isSetup(o: Record<string, unknown>): boolean {
  return isStr(o.id) && isStr(o.name) && ['context', 'location', 'trigger', 'execution', 'invalidation'].every((k) => isStr(o[k])) && isNum(o.createdAt);
}

function isTrade(o: Record<string, unknown>): boolean {
  return (
    isStr(o.id) &&
    (o.setupId === null || isStr(o.setupId)) &&
    (o.dir === 'LONG' || o.dir === 'SHORT') &&
    isTime(o.entryT) &&
    posNum(o.entryPx) &&
    posNum(o.stopPx) &&
    (o.exitT === null || isTime(o.exitT)) &&
    (o.exitPx === null || posNum(o.exitPx)) &&
    (o.sizeBtc === null || posNum(o.sizeBtc)) &&
    isStr(o.note) &&
    numOrNull(o.mae) &&
    numOrNull(o.mfe)
  );
}

/**
 * Import z JSON (wymagane `v: 1`): niepoprawne wpisy są pomijane (nie psują reszty), zagrania z nieznanym setupem
 * trafiają do „bez setupu”, kontekst tylko ze znanymi polami; zły JSON / inny format → null.
 */
export function parseJournal(text: string): Journal | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const o = raw as { v?: unknown; setups?: unknown; trades?: unknown } | null;
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]).filter((e) => e && typeof e === 'object') : []);
  const setups = arr(o.setups).filter(isSetup) as unknown as Setup[];
  const ids = new Set(setups.map((s) => s.id));
  const trades = (arr(o.trades).filter(isTrade) as unknown as Trade[]).map((t) => ({
    ...t,
    setupId: t.setupId !== null && ids.has(t.setupId) ? t.setupId : null,
    ctx: cleanCtx((t as { ctx?: unknown }).ctx),
  }));
  return { v: 1, setups, trades };
}
