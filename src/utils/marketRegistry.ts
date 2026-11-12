/**
 * Rejestr rynków `markets.json` — format współdzielony przez skaner i stronę (bez importów zewnętrznych; uruchamiany
 * także natywnie przez Node 24). Czysta logika: bez sieci i bez zegara.
 *
 * Reguła `reg-v1`: rynki Hyperliquid ze wszystkich giełd perp (główna i HIP-3, nazwa HIP-3 to `dex:COIN`) rangowane
 * średnią otwartych pozycji w USD z 7 dni UTC. Rynek wchodzi, gdy przez 3 kolejne zamknięte dni UTC jest w pierwszej 20,
 * a wychodzi, gdy przez 7 kolejnych zamkniętych dni jest poniżej 30. miejsca. BTC, ETH, SOL i HYPE są zawsze.
 * Rynki wycofane (`isDelisted`) albo z zerowym OI nie wchodzą; członek wycofany wypada od razu, a nieobecny w odpowiedzi
 * giełdy — dopiero po zamkniętym dniu UTC bez żadnej próbki (jedna zła godzinna odpowiedź nie zmienia członków).
 */

export const REG_V1 = {
  id: 'reg-v1',
  /** Wejście: miejsce najwyżej `top` przez `enterDays` kolejnych zamkniętych dni UTC */
  top: 20,
  enterDays: 3,
  /** Wyjście: miejsce dalsze niż `exitRank` (albo brak miejsca) przez `exitDays` kolejnych zamkniętych dni UTC */
  exitRank: 30,
  exitDays: 7,
  /** Okno średniej OI (dni UTC, łącznie z dniem oceny) */
  windowDays: 7,
  /** Ile dni próbek trzyma stan */
  keepDays: 10,
  always: ['BTC', 'ETH', 'SOL', 'HYPE'],
} as const;

export type RegistryRule = typeof REG_V1.id;
/** `full` = rynek ma warstwy skanera (mapa i taśma likwidacji, kohorty, prognozy); `none` = tylko wykres ze strumienia */
export type ScannerLevel = 'full' | 'none';

export interface MarketEntry {
  /** Nazwa rynku w API Hyperliquid: `BTC` albo `dex:COIN` (np. `xyz:NVDA`) */
  coin: string;
  /** Giełda perp: `""` = główna, inaczej nazwa giełdy HIP-3 */
  dex: string;
  /** Średnia otwartych pozycji z 7 dni UTC (łącznie z bieżącym), USD */
  oiUsd7d: number;
  /** Miejsce według `oiUsd7d` wśród wszystkich rynków wszystkich giełd (od 1) */
  rank: number;
  szDecimals: number;
  maxLeverage: number;
  /** Dzień UTC wejścia do rejestru (RRRR-MM-DD) */
  since: string;
  scanner: ScannerLevel;
}

export interface MarketRegistry {
  /** Czas próbki, z której zbudowano plik (ms) */
  asOf: number;
  rule: RegistryRule;
  /** Według miejsca rosnąco */
  markets: MarketEntry[];
}

/** Rynek z jednej odpowiedzi `metaAndAssetCtxs` */
export interface MarketSample {
  coin: string;
  dex: string;
  /** openInterest × markPx, USD (0 przy braku ceny) */
  oiUsd: number;
  szDecimals: number;
  maxLeverage: number;
  delisted: boolean;
}

interface MarketMeta {
  dex: string;
  szDecimals: number;
  maxLeverage: number;
  delisted: boolean;
  /** OI z ostatniej próbki, USD */
  oiUsd: number;
  /** Ostatni dzień UTC, w którym rynek był w odpowiedzi swojej giełdy */
  seen: string;
}

/** Stan serwera (`HQ_STATE_DIR`): przetrwa restart; próbki z najwyżej `keepDays` dni. */
export interface RegistryState {
  v: 1;
  rule: RegistryRule;
  /** Czas ostatniej próbki (ms); 0 = brak */
  lastAt: number;
  /** Dzień UTC → rynek → suma i liczba godzinnych próbek OI (USD); zapisywane tylko OI > 0 */
  days: Record<string, Record<string, { s: number; n: number }>>;
  /**
   * Ostatnio widziane parametry rynków. Rynek, którego nie ma w odpowiedzi pobranej giełdy, zostaje do oceny dnia:
   * znika dopiero, gdy nie było go w żadnej próbce zamkniętego dnia UTC, w którym jego giełda była pobrana.
   */
  meta: Record<string, MarketMeta>;
  /** Dzień UTC → giełdy pobrane w tym dniu co najmniej raz */
  dexDays: Record<string, string[]>;
  /** Giełda → czas ostatniego udanego pobrania (ms); kolejność rotacji przy limicie zapytań */
  dexFetchedAt: Record<string, number>;
  /** Członkowie rejestru (także stałe rynki) → dzień wejścia */
  members: Record<string, { since: string }>;
  /** Serie zamkniętych dni: `in` — w pierwszej 20, `out` — poza 30. miejscem (tylko niezerowe) */
  streaks: Record<string, { in: number; out: number }>;
  /** Ostatni oceniony zamknięty dzień UTC */
  evaluatedThrough: string | null;
}

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
const num = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(x) ? x : null;
};

/** Nazwa rynku zgodna z giełdą: główna bez dwukropka, HIP-3 z przedrostkiem `dex:` */
function coinMatchesDex(coin: string, dex: string): boolean {
  if (dex === '') return /^[A-Za-z0-9]{1,20}$/.test(coin);
  return /^[A-Za-z0-9]{1,20}$/.test(dex) && coin.startsWith(`${dex}:`) && /^[A-Za-z0-9]{1,20}$/.test(coin.slice(dex.length + 1));
}

/** Format nazwy rynku z linku albo zapisu: `COIN` albo `dex:COIN` (bez sprawdzania, czy rynek jest w rejestrze). */
export function isCoinName(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  const i = x.indexOf(':');
  return coinMatchesDex(x, i < 0 ? '' : x.slice(0, i));
}

export function emptyRegistryState(): RegistryState {
  return { v: 1, rule: REG_V1.id, lastAt: 0, days: {}, meta: {}, dexDays: {}, dexFetchedAt: {}, members: {}, streaks: {}, evaluatedThrough: null };
}

/** Strażnik stanu odczytanego z dysku (inna reguła albo uszkodzony plik → stan od nowa). */
export function isRegistryState(x: unknown): x is RegistryState {
  if (!isRecord(x) || x.v !== 1 || x.rule !== REG_V1.id || !fin(x.lastAt)) return false;
  if (!(x.evaluatedThrough === null || (typeof x.evaluatedThrough === 'string' && DAY_RE.test(x.evaluatedThrough)))) return false;
  if (!isRecord(x.days) || !isRecord(x.meta) || !isRecord(x.members) || !isRecord(x.streaks) || !isRecord(x.dexDays) || !isRecord(x.dexFetchedAt)) return false;
  for (const [day, byCoin] of Object.entries(x.days)) {
    if (!DAY_RE.test(day) || !isRecord(byCoin)) return false;
    for (const v of Object.values(byCoin)) if (!isRecord(v) || !fin(v.s) || !isInt(v.n, 1, 1e6)) return false;
  }
  for (const m of Object.values(x.meta))
    if (!isRecord(m) || typeof m.dex !== 'string' || !fin(m.szDecimals) || !fin(m.maxLeverage) || typeof m.delisted !== 'boolean' || !fin(m.oiUsd) || typeof m.seen !== 'string' || !DAY_RE.test(m.seen))
      return false;
  for (const [day, dexes] of Object.entries(x.dexDays)) if (!DAY_RE.test(day) || !Array.isArray(dexes) || !dexes.every((d) => typeof d === 'string')) return false;
  for (const at of Object.values(x.dexFetchedAt)) if (!fin(at)) return false;
  for (const m of Object.values(x.members)) if (!isRecord(m) || typeof m.since !== 'string' || !DAY_RE.test(m.since)) return false;
  for (const s of Object.values(x.streaks)) if (!isRecord(s) || !isInt(s.in, 0, 1e6) || !isInt(s.out, 0, 1e6)) return false;
  return true;
}

/** `{"type":"perpDexs"}` → nazwy giełd z główną (`""`) na początku; śmieci → null. */
export function parsePerpDexs(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = [''];
  for (const d of raw) if (isRecord(d) && typeof d.name === 'string' && /^[A-Za-z0-9]{1,20}$/.test(d.name) && !out.includes(d.name)) out.push(d.name);
  return out;
}

/** `metaAndAssetCtxs` jednej giełdy → rynki (universe[i] ↔ ctxs[i]); nieczytelne wiersze pomijane; śmieci → null. */
export function parseDexMarkets(raw: unknown, dex: string): MarketSample[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [meta, ctxs] = raw;
  if (!isRecord(meta) || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return null;
  const out: MarketSample[] = [];
  const n = Math.min(meta.universe.length, ctxs.length);
  for (let i = 0; i < n; i++) {
    const u = meta.universe[i];
    const c = ctxs[i];
    if (!isRecord(u) || !isRecord(c) || typeof u.name !== 'string') continue;
    if (!isInt(u.szDecimals, 0, 20) || !fin(u.maxLeverage) || u.maxLeverage <= 0) continue;
    const coin = dex === '' || u.name.startsWith(`${dex}:`) ? u.name : `${dex}:${u.name}`;
    if (!coinMatchesDex(coin, dex)) continue;
    const oi = num(c.openInterest);
    const px = num(c.markPx);
    const oiUsd = oi !== null && px !== null && oi > 0 && px > 0 ? oi * px : 0;
    out.push({ coin, dex, oiUsd, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, delisted: u.isDelisted === true });
  }
  return out;
}

/** Średnia OI z okna `windowDays` kończącego się w `day`; mianownik = dni okna z jakąkolwiek próbką (dzień bez rynku = 0). */
function averages(state: RegistryState, day: string): Map<string, number> {
  const sums = new Map<string, number>();
  let daysWithData = 0;
  for (let k = 0; k < REG_V1.windowDays; k++) {
    const byCoin = state.days[addDays(day, -k)];
    if (!byCoin) continue;
    daysWithData++;
    for (const [coin, { s, n }] of Object.entries(byCoin)) sums.set(coin, (sums.get(coin) ?? 0) + s / n);
  }
  const out = new Map<string, number>();
  if (daysWithData > 0) for (const [coin, s] of sums) out.set(coin, s / daysWithData);
  return out;
}

/** Miejsca według średniej (malejąco, remis — nazwa rynku) wśród rynków znanych, niewycofanych i z OI > 0. */
function ranking(state: RegistryState, day: string): Map<string, { rank: number; oiUsd7d: number }> {
  const rows = [...averages(state, day)]
    .filter(([coin, avg]) => avg > 0 && state.meta[coin] !== undefined && !state.meta[coin].delisted)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return new Map(rows.map(([coin, oiUsd7d], i) => [coin, { rank: i + 1, oiUsd7d }]));
}

const ALWAYS: ReadonlySet<string> = new Set(REG_V1.always);

/** Ocena zamkniętego dnia `day`: serie i zmiany członkostwa; wejście i wyjście datowane dniem następnym (`entryDay`). */
function evaluateDay(state: RegistryState, day: string, entryDay: string): void {
  const ranks = ranking(state, day);
  const coins = new Set([...ranks.keys(), ...Object.keys(state.members), ...Object.keys(state.streaks)]);
  for (const coin of coins) {
    const rank = ranks.get(coin)?.rank;
    const prev = state.streaks[coin] ?? { in: 0, out: 0 };
    const next = {
      in: rank !== undefined && rank <= REG_V1.top ? prev.in + 1 : 0,
      out: rank === undefined || rank > REG_V1.exitRank ? prev.out + 1 : 0,
    };
    const member = state.members[coin] !== undefined;
    const meta = state.meta[coin];
    if (!member && next.in >= REG_V1.enterDays && meta && !meta.delisted && meta.oiUsd > 0) state.members[coin] = { since: entryDay };
    else if (member && !ALWAYS.has(coin) && next.out >= REG_V1.exitDays) delete state.members[coin];
    // Poza rejestrem liczy się tylko seria wejścia
    const kept = state.members[coin] !== undefined ? next : { in: next.in, out: 0 };
    if (kept.in === 0 && kept.out === 0) delete state.streaks[coin];
    else state.streaks[coin] = kept;
  }
}

/**
 * Rynki nieobecne w każdej próbce zamkniętego dnia `day`, w którym ich giełda była pobrana: parametry i członkostwo
 * znikają (także stałych rynków — wracają z nowym `since`, gdy giełda znów je poda). Jedna zła godzinna odpowiedź nic nie
 * zmienia; giełda niepobrana przez cały dzień (niedostępna albo poza rotacją) też nie.
 */
function dropAbsent(state: RegistryState, day: string): void {
  const fetched = new Set(state.dexDays[day] ?? []);
  for (const [coin, m] of Object.entries(state.meta)) {
    if (!fetched.has(m.dex) || m.seen >= day) continue;
    delete state.meta[coin];
    delete state.members[coin];
  }
}

/**
 * Godzinna próbka: ocena zamkniętych dni sprzed dnia próbki (na stanie sprzed próbki), parametry rynków pobranych giełd
 * (`dexes`), dopisanie OI do dnia próbki, przycięcie starych dni. Zwraca nowy stan (wejście nie jest zmieniane); próbka
 * z dnia już ocenionego (cofnięty zegar) — stan bez zmian.
 */
export function recordSnapshot(prev: RegistryState, snap: { at: number; dexes: readonly string[]; samples: readonly MarketSample[] }): RegistryState {
  const today = utcDay(snap.at);
  if (prev.evaluatedThrough !== null && today <= prev.evaluatedThrough) return prev;
  const state: RegistryState = structuredClone(prev);
  state.lastAt = snap.at;

  // Zamknięte dni z próbkami, jeszcze nieocenione (po przerwie — po kolei), przed parametrami z tej próbki
  const pending = Object.keys(state.days)
    .filter((d) => d < today && (state.evaluatedThrough === null || d > state.evaluatedThrough))
    .sort();
  for (const d of pending) {
    dropAbsent(state, d);
    evaluateDay(state, d, addDays(d, 1));
    state.evaluatedThrough = d;
  }

  // Parametry rynków z odpowiedzi pobranych giełd; rynku bez wiersza w tej odpowiedzi nie usuwamy (patrz dropAbsent)
  const fetched = new Set(snap.dexes);
  for (const s of snap.samples) {
    if (!fetched.has(s.dex)) continue;
    state.meta[s.coin] = { dex: s.dex, szDecimals: s.szDecimals, maxLeverage: s.maxLeverage, delisted: s.delisted, oiUsd: s.oiUsd, seen: today };
  }
  const dexesToday = new Set([...(state.dexDays[today] ?? []), ...fetched]);
  state.dexDays[today] = [...dexesToday].sort();
  for (const dex of fetched) state.dexFetchedAt[dex] = snap.at;

  // Członek wycofany (isDelisted) wypada od razu; stałe rynki wracają, gdy znów są notowane
  for (const coin of Object.keys(state.members)) {
    const m = state.meta[coin];
    if (!m || m.delisted) delete state.members[coin];
  }
  for (const coin of REG_V1.always) {
    const m = state.meta[coin];
    if (m && !m.delisted && !state.members[coin]) state.members[coin] = { since: today };
  }

  const byCoin = (state.days[today] ??= {});
  for (const s of snap.samples) {
    if (!fetched.has(s.dex) || s.delisted || !(s.oiUsd > 0)) continue;
    const cell = (byCoin[s.coin] ??= { s: 0, n: 0 });
    cell.s += s.oiUsd;
    cell.n += 1;
  }

  const oldest = addDays(today, -(REG_V1.keepDays - 1));
  for (const d of Object.keys(state.days)) if (d < oldest) delete state.days[d];
  for (const d of Object.keys(state.dexDays)) if (d < oldest) delete state.dexDays[d];
  for (const [dex, at] of Object.entries(state.dexFetchedAt)) if (at < snap.at - REG_V1.keepDays * DAY_MS) delete state.dexFetchedAt[dex];
  // Parametry rynków spoza rejestru niewidzianych od okna stanu (np. giełda zniknęła z listy)
  for (const [coin, m] of Object.entries(state.meta)) if (m.seen < oldest && !state.members[coin]) delete state.meta[coin];
  return state;
}

/**
 * Giełdy do pobrania w przebiegu: najwyżej `max` (z główną, zawsze pierwszą). Wybór: najpierw giełdy pobrane najdawniej
 * (nigdy = najpierw), przy równym czasie większe OI; dlatego przy liście dłuższej niż limit pominięte giełdy idą
 * w następnych przebiegach (rotacja), a przy liście w limicie co przebieg pobierane są wszystkie. Kolejność zapytań:
 * malejąco według ostatniego znanego OI giełdy (suma OI jej rynków), giełdy bez danych na końcu.
 */
export function pickDexes(state: RegistryState, listed: readonly string[], max: number): { dexes: string[]; skipped: string[] } {
  const oi = new Map<string, number>();
  for (const m of Object.values(state.meta)) if (!m.delisted) oi.set(m.dex, (oi.get(m.dex) ?? 0) + m.oiUsd);
  const byOi = (a: string, b: string) => (oi.get(b) ?? -1) - (oi.get(a) ?? -1) || (a < b ? -1 : a > b ? 1 : 0);
  const fetchedAt = (d: string) => state.dexFetchedAt[d] ?? Number.NEGATIVE_INFINITY;
  const others = [...new Set(listed)].filter((d) => d !== '');
  const ranked = [...others].sort((a, b) => fetchedAt(a) - fetchedAt(b) || byOi(a, b));
  const take = Math.max(0, max - 1);
  const chosen = ranked.slice(0, take).sort(byOi);
  const skipped = ranked.slice(take).sort(byOi);
  return { dexes: ['', ...chosen], skipped };
}

/** Plik `markets.json` ze stanu: członkowie z miejscem z okna kończącego się dniem ostatniej próbki, według miejsca. */
export function buildRegistry(state: RegistryState, scannerCoins: readonly string[]): MarketRegistry {
  const ranks = ranking(state, utcDay(state.lastAt));
  const full = new Set(scannerCoins);
  const markets: MarketEntry[] = [];
  for (const [coin, { since }] of Object.entries(state.members)) {
    const r = ranks.get(coin);
    const m = state.meta[coin];
    if (!r || !m) continue; // bez OI w oknie (np. giełda niedostępna od tygodnia) — rynek nie ma miejsca
    markets.push({
      coin,
      dex: m.dex,
      oiUsd7d: Math.round(r.oiUsd7d),
      rank: r.rank,
      szDecimals: m.szDecimals,
      maxLeverage: m.maxLeverage,
      since,
      scanner: full.has(coin) ? 'full' : 'none',
    });
  }
  markets.sort((a, b) => a.rank - b.rank);
  return { asOf: state.lastAt, rule: REG_V1.id, markets };
}

function isEntry(x: unknown): x is MarketEntry {
  if (!isRecord(x) || typeof x.coin !== 'string' || typeof x.dex !== 'string' || !coinMatchesDex(x.coin, x.dex)) return false;
  return (
    fin(x.oiUsd7d) &&
    x.oiUsd7d >= 0 &&
    isInt(x.rank, 1, 100_000) &&
    isInt(x.szDecimals, 0, 20) &&
    fin(x.maxLeverage) &&
    x.maxLeverage > 0 &&
    typeof x.since === 'string' &&
    DAY_RE.test(x.since) &&
    (x.scanner === 'full' || x.scanner === 'none')
  );
}

/** Strażnik formatu `markets.json` (plik z sieci). */
export function isMarketRegistry(x: unknown): x is MarketRegistry {
  if (!isRecord(x) || !fin(x.asOf) || x.rule !== REG_V1.id || !Array.isArray(x.markets) || x.markets.length === 0) return false;
  if (!x.markets.every(isEntry)) return false;
  return new Set(x.markets.map((m) => (m as MarketEntry).coin)).size === x.markets.length;
}

/** Rynek do wyboru na stronie (pola, których strona potrzebuje niezależnie od tego, czy rejestr jest dostępny). */
export type ChartMarket = Pick<MarketEntry, 'coin' | 'dex' | 'szDecimals' | 'maxLeverage' | 'scanner'>;

/** Dzisiejsze 4 rynki strony (parametry z API Hyperliquid, 11.2026) — gdy rejestru nie ma albo ma zły format. */
export const DEFAULT_MARKETS: readonly ChartMarket[] = [
  { coin: 'BTC', dex: '', szDecimals: 5, maxLeverage: 40, scanner: 'full' },
  { coin: 'ETH', dex: '', szDecimals: 4, maxLeverage: 25, scanner: 'none' },
  { coin: 'SOL', dex: '', szDecimals: 2, maxLeverage: 20, scanner: 'none' },
  { coin: 'HYPE', dex: '', szDecimals: 2, maxLeverage: 10, scanner: 'none' },
];

/** Rejestr albo 4 rynki domyślne: poprawny plik → jego rynki według miejsca, brakujący stały rynek dopisany na końcu. */
export function marketsOrDefault(x: unknown): readonly ChartMarket[] {
  if (!isMarketRegistry(x)) return DEFAULT_MARKETS;
  const list: ChartMarket[] = x.markets.map(({ coin, dex, szDecimals, maxLeverage, scanner }) => ({ coin, dex, szDecimals, maxLeverage, scanner }));
  for (const d of DEFAULT_MARKETS) if (!list.some((m) => m.coin === d.coin)) list.push(d);
  return list;
}
