/**
 * Pomiar w cieniu dla rynków rejestru (etap M0) i przepływ minutowy (K2). Bez nowych zapytań REST: pozycje z odczytów
 * `clearinghouseState`, które skaner i tak robi dla mapy BTC, OI z kontekstów giełdy głównej pobieranych przez rejestr,
 * transakcje z jednej subskrypcji `trades` dla rynków rejestru.
 *
 * Publikowane są same liczby (`status.json`: `markets`, `xyz`, `marketsHours`); adresy zostają w stanie serwera.
 * Przepływ minutowy K2 (kupno i sprzedaż agresywna na rynek, USD) trafia wyłącznie do plików w `HQ_STATE_DIR`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Okno pomiaru M0 (udział nieznanych kont, konta `xyz`) */
export const M0_WINDOW_MS = 7 * DAY_MS;
/** Ile dób UTC trzymają pliki przepływu minutowego K2 (test po K2 potrzebuje 14 pełnych dób; zapas na luki i analizę) */
export const K2_KEEP_DAYS = 21;
/** Główny strumień skanera rozłączony dłużej niż to: pomiar w cieniu zwalnia połączenie (limit 10 połączeń na IP) */
export const SHADOW_YIELD_MS = 30_000;
/** Pomiar wraca dopiero po tylu ms stabilnego połączenia głównego strumienia */
export const SHADOW_RESUME_MS = 60_000;
/** Minuta zamykana tyle po swoim końcu (transakcje z WebSocket mogą przyjść z opóźnieniem) */
export const FLOW_SETTLE_MS = 30_000;
/** OI z rejestru (pobierany co godzinę) starszy niż to nie daje pokrycia */
export const OI_MAX_AGE_MS = 3 * HOUR_MS;
/** Giełda HIP-3 mierzona osobno (konta widziane na jej taśmach) */
export const XYZ_PREFIX = 'xyz:';

export interface ShadowTrade {
  coin: string;
  /** Strona agresora: B = kupujący (users[0]) jest biorcą, A = sprzedający (users[1]) */
  side?: string;
  px: string | number;
  sz: string | number;
  time: number;
  users?: [string, string];
}

export interface MarketStat {
  /** Pokrycie OI odczytanymi pozycjami (jak `coverage` BTC); null = rynek HIP-3 albo brak świeżego OI */
  coverage: number | null;
  /** Udział obrotu kont spoza księgi adresów (7 dni); null = brak transakcji */
  unseenShare: number | null;
}

export interface XyzStat {
  /** Różne konta widziane na taśmach `xyz` w 7 dniach */
  accounts: number;
  /** Z nich obecne teraz w księdze adresów */
  inBook: number;
  /** Udział obrotu `xyz` kont spoza księgi (7 dni) */
  unseenShare: number | null;
  /** Udział `xyz` w obrocie wszystkich mierzonych rynków (7 dni) */
  share: number | null;
}

export interface ShadowStatus {
  markets: Record<string, MarketStat>;
  xyz: XyzStat;
  /** Godziny z danymi w oknie 7 dni (pełny pomiar = 168) */
  marketsHours: number;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : Number.NaN);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMain = (coin: string) => !coin.includes(':');
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const ratio = (a: number, b: number) => (b > 0 ? round4(a / b) : null);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Ta sama miara co `coverage.share` mapy likwidacji: suma |rozmiar| odczytanych pozycji / (2 × OI), najwyżej 1. */
export function coverageShare(absSz: number, oi: number): number {
  return oi > 0 ? Math.min(1, absSz / (2 * oi)) : 0;
}

/**
 * Rozmiary pozycji (|szi|) w podanych rynkach z odpowiedzi `clearinghouseState`; pozycje bez ceny wejścia pomijane
 * jak w `parseCoinPosition`. Zły kształt → null (nieudany odczyt nie kasuje poprzedniego).
 */
export function parseAbsSizes(state: unknown, coins: ReadonlySet<string>): Record<string, number> | null {
  const list = (state as { assetPositions?: unknown } | null)?.assetPositions;
  if (!Array.isArray(list)) return null;
  const out: Record<string, number> = {};
  for (const ap of list) {
    const p = (ap as { position?: Record<string, unknown> } | null)?.position;
    if (!p || typeof p.coin !== 'string' || !coins.has(p.coin)) continue;
    const szi = num(p.szi);
    if (!Number.isFinite(szi) || szi === 0 || !(num(p.entryPx) > 0)) continue;
    out[p.coin] = Math.abs(szi);
  }
  return out;
}

/** `metaAndAssetCtxs` giełdy głównej → rynek → OI w jednostkach rynku (universe[i] ↔ ctxs[i]); śmieci → null. */
export function parseOpenInterest(raw: unknown): Record<string, number> | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [meta, ctxs] = raw;
  if (!isRecord(meta) || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return null;
  const out: Record<string, number> = {};
  for (let i = 0; i < Math.min(meta.universe.length, ctxs.length); i++) {
    const u = meta.universe[i];
    const c = ctxs[i];
    if (!isRecord(u) || !isRecord(c) || typeof u.name !== 'string') continue;
    const oi = num(c.openInterest);
    if (Number.isFinite(oi) && oi >= 0) out[u.name] = oi;
  }
  return out;
}

interface ShadowJson {
  v: 1;
  pos: [string, Record<string, number>][];
  hours: [number, Record<string, [number, number]>][];
  xyz: [string, number][];
  oi: { at: number; byCoin: Record<string, number> } | null;
}

/**
 * Stan pomiaru M0: pozycje kont księgi w rynkach głównych rejestru, godzinne kubełki obrotu (nieznani, razem) na rynek
 * i ostatnie wystąpienie kont na taśmach `xyz`. Czysta logika (czas z argumentów), stan przetrwa restart (`toJSON`).
 */
export class MarketShadow {
  private coins: string[] = [];
  private mainSet = new Set<string>();
  private readonly pos = new Map<string, Record<string, number>>();
  /** Początek godziny → rynek → [obrót kont spoza księgi, obrót razem] (obie strony transakcji) */
  private readonly hours = new Map<number, Record<string, [number, number]>>();
  private readonly xyz = new Map<string, number>();
  private oi: { at: number; byCoin: Record<string, number> } | null = null;

  setCoins(coins: readonly string[]): void {
    this.coins = [...new Set(coins)];
    this.mainSet = new Set(this.coins.filter(isMain));
  }

  get markets(): readonly string[] {
    return this.coins;
  }

  /** Odczyt `clearinghouseState` konta (ten sam, który skaner robi dla BTC): pozycje w rynkach głównych rejestru. */
  onScan(addr: string, state: unknown): void {
    const s = parseAbsSizes(state, this.mainSet);
    if (s === null) return;
    if (Object.keys(s).length > 0) this.pos.set(addr, s);
    else this.pos.delete(addr);
  }

  setOi(byCoin: Record<string, number>, at: number): void {
    this.oi = { at, byCoin: { ...byCoin } };
  }

  /** Transakcja z taśmy: obrót kupującego i sprzedającego do kubełka godziny; `inBook` — stan księgi w chwili transakcji. */
  onTrade(t: ShadowTrade, inBook: (addr: string) => boolean): void {
    const ntl = num(t.px) * num(t.sz);
    const users = t.users;
    if (!(ntl > 0) || !Array.isArray(users) || typeof users[0] !== 'string' || typeof users[1] !== 'string' || !Number.isFinite(t.time)) return;
    const h = Math.floor(t.time / HOUR_MS) * HOUR_MS;
    let bucket = this.hours.get(h);
    if (!bucket) this.hours.set(h, (bucket = {}));
    const cell = (bucket[t.coin] ??= [0, 0]);
    const isXyz = t.coin.startsWith(XYZ_PREFIX);
    for (const a of users) {
      cell[1] += ntl;
      if (!inBook(a)) cell[0] += ntl;
      if (isXyz) this.xyz.set(a, Math.max(this.xyz.get(a) ?? 0, t.time));
    }
  }

  /** Kubełki i konta `xyz` spoza okna 7 dni; pozycje kont, które wypadły z księgi. */
  prune(now: number, inBook?: (addr: string) => boolean): void {
    const cutoff = now - M0_WINDOW_MS;
    for (const h of [...this.hours.keys()]) if (h + HOUR_MS <= cutoff) this.hours.delete(h);
    for (const [a, last] of [...this.xyz]) if (last < cutoff) this.xyz.delete(a);
    if (inBook) for (const a of [...this.pos.keys()]) if (!inBook(a)) this.pos.delete(a);
  }

  /**
   * Pola `status.json`. Pokrycie rynku głównego: konta obecne w księdze, OI z ostatniego pobrania rejestru (nie starszy niż
   * 3 h); dla `btc.coin` dokładnie `coverage` statusu (ta sama mapa). Rynki HIP-3: pokrycie null (pozycje HIP-3 nie są odczytywane).
   */
  status(now: number, o: { inBook: (addr: string) => boolean; btc?: { coin: string; coverage: number } }): ShadowStatus {
    const cutoff = now - M0_WINDOW_MS;
    const sums = new Map<string, number>();
    for (const [a, rec] of this.pos) {
      if (!o.inBook(a)) continue;
      for (const [c, sz] of Object.entries(rec)) sums.set(c, (sums.get(c) ?? 0) + sz);
    }
    const flow = new Map<string, [number, number]>();
    let hoursN = 0;
    for (const [h, bucket] of this.hours) {
      if (h + HOUR_MS <= cutoff || h > now) continue;
      hoursN++;
      for (const [c, [u, t]] of Object.entries(bucket)) {
        const acc = flow.get(c) ?? [0, 0];
        acc[0] += u;
        acc[1] += t;
        flow.set(c, acc);
      }
    }
    const oiFresh = this.oi && now - this.oi.at <= OI_MAX_AGE_MS ? this.oi.byCoin : null;
    const markets: Record<string, MarketStat> = {};
    for (const c of this.coins) {
      let coverage: number | null = null;
      if (o.btc && c === o.btc.coin) coverage = round4(o.btc.coverage);
      else if (isMain(c) && oiFresh && oiFresh[c] > 0) coverage = round4(coverageShare(sums.get(c) ?? 0, oiFresh[c]));
      // Rynek skanera: księga dopisuje konta z jego taśmy na innym połączeniu, więc wynik zależałby od kolejności obsługi — null
      const f = o.btc && c === o.btc.coin ? undefined : flow.get(c);
      markets[c] = { coverage, unseenShare: f ? ratio(f[0], f[1]) : null };
    }
    let xu = 0;
    let xt = 0;
    let all = 0;
    for (const [c, [u, t]] of flow) {
      all += t;
      if (c.startsWith(XYZ_PREFIX)) {
        xu += u;
        xt += t;
      }
    }
    let accounts = 0;
    let inBook = 0;
    for (const [a, last] of this.xyz) {
      if (last < cutoff) continue;
      accounts++;
      if (o.inBook(a)) inBook++;
    }
    return { markets, xyz: { accounts, inBook, unseenShare: ratio(xu, xt), share: ratio(xt, all) }, marketsHours: hoursN };
  }

  toJSON(): ShadowJson {
    return { v: 1, pos: [...this.pos], hours: [...this.hours], xyz: [...this.xyz], oi: this.oi };
  }

  /** Odczyt stanu z dysku (nieczytelne wpisy pomijane); od razu przycięty do okna. */
  static fromJSON(x: unknown, now: number): MarketShadow {
    const s = new MarketShadow();
    if (!isRecord(x) || x.v !== 1) return s;
    const pairs = (v: unknown): [unknown, unknown][] => (Array.isArray(v) ? v.filter((e): e is [unknown, unknown] => Array.isArray(e) && e.length === 2) : []);
    for (const [a, rec] of pairs(x.pos)) {
      if (typeof a !== 'string' || !isRecord(rec)) continue;
      const clean: Record<string, number> = {};
      for (const [c, sz] of Object.entries(rec)) if (typeof sz === 'number' && sz > 0) clean[c] = sz;
      if (Object.keys(clean).length) s.pos.set(a, clean);
    }
    for (const [h, rec] of pairs(x.hours)) {
      if (typeof h !== 'number' || !isRecord(rec)) continue;
      const clean: Record<string, [number, number]> = {};
      for (const [c, cell] of Object.entries(rec)) {
        if (Array.isArray(cell) && cell.length === 2 && cell.every((v) => typeof v === 'number' && v >= 0)) clean[c] = [cell[0], cell[1]];
      }
      s.hours.set(h, clean);
    }
    for (const [a, t] of pairs(x.xyz)) if (typeof a === 'string' && typeof t === 'number') s.xyz.set(a, t);
    const oi = x.oi;
    if (isRecord(oi) && typeof oi.at === 'number' && isRecord(oi.byCoin)) {
      const byCoin: Record<string, number> = {};
      for (const [c, v] of Object.entries(oi.byCoin)) if (typeof v === 'number' && v >= 0) byCoin[c] = v;
      s.oi = { at: oi.at, byCoin };
    }
    s.prune(now);
    return s;
  }
}

/**
 * Ustępowanie pomiaru w cieniu: połączenie pomiaru działa tylko przy zdrowym głównym strumieniu skanera. Główny
 * rozłączony dłużej niż 30 s → `stop`; ponowny `start` dopiero po 60 s nieprzerwanego połączenia głównego (także po starcie
 * procesu). Krótsze przerwy niczego nie zmieniają; K2 ma na czas zatrzymania lukę. Czysta logika — czas z argumentu.
 */
export class ShadowGate {
  private running = false;
  private mainUp: boolean | null = null;
  private since = 0;

  get active(): boolean {
    return this.running;
  }

  /** Stan głównego strumienia w chwili `now`; zwraca akcję dla połączenia pomiaru albo null. */
  update(mainUp: boolean, now: number): 'start' | 'stop' | null {
    if (mainUp !== this.mainUp) {
      this.mainUp = mainUp;
      this.since = now;
    }
    const held = now - this.since;
    if (this.running && !mainUp && held > SHADOW_YIELD_MS) {
      this.running = false;
      return 'stop';
    }
    if (!this.running && mainUp && held >= SHADOW_RESUME_MS) {
      this.running = true;
      return 'start';
    }
    return null;
  }
}

/** Zamknięta minuta przepływu: `v` = [kupno₀, sprzedaż₀, kupno₁, …] w USD w kolejności `coins`; null = rynek nieobserwowany. */
export interface FlowRow {
  t: number;
  coins: readonly string[];
  v: (number | null)[];
}

/**
 * Przepływ minutowy K2: suma kupna i sprzedaży agresywnej (USD) na minutę dla rynków subskrypcji. Minuta trafia do
 * wyniku tylko wtedy, gdy połączenie było otwarte przez całą minutę (a przy otwartym — po niej przyszła już jakakolwiek
 * transakcja); minuta bez obserwacji nie ma wiersza, minuta bez transakcji ma zera. Rynek dopisany do subskrypcji
 * w trakcie minuty ma w niej null.
 */
export class FlowMinutes {
  private coins: string[] = [];
  private readonly since = new Map<string, number>();
  private readonly open = new Map<number, Map<string, [number, number]>>();
  private spans: [number, number | null][] = [];
  /** Minuty wcześniejsze są już wydane albo porzucone */
  private done = 0;
  private lastTradeTime = 0;

  setCoins(coins: readonly string[], now: number): void {
    const next = [...new Set(coins)];
    for (const c of next) if (!this.since.has(c)) this.since.set(c, now);
    for (const c of [...this.since.keys()]) if (!next.includes(c)) this.since.delete(c);
    this.coins = next;
  }

  /** Połączenie otwarte albo zamknięte (koniec = ostatnia wiadomość przed zerwaniem). */
  onState(up: boolean, at: number): void {
    const last = this.spans[this.spans.length - 1];
    if (up) {
      if (last && last[1] === null) last[1] = at;
      this.spans.push([at, null]);
    } else if (last && last[1] === null) last[1] = at;
  }

  onTrade(coin: string, side: string | undefined, ntlUsd: number, time: number): void {
    if (!Number.isFinite(time)) return;
    this.lastTradeTime = Math.max(this.lastTradeTime, time);
    if (!this.since.has(coin) || !(ntlUsd > 0) || (side !== 'B' && side !== 'A')) return;
    const m = Math.floor(time / MIN_MS) * MIN_MS;
    if (m < this.done) return;
    let byCoin = this.open.get(m);
    if (!byCoin) this.open.set(m, (byCoin = new Map()));
    const cell = byCoin.get(coin) ?? [0, 0];
    cell[side === 'B' ? 0 : 1] += ntlUsd;
    byCoin.set(coin, cell);
  }

  private covered(m: number): boolean | 'wait' {
    for (const [from, to] of this.spans) {
      if (from > m) continue;
      if (to !== null) {
        if (to >= m + MIN_MS) return true;
        continue;
      }
      return this.lastTradeTime >= m + MIN_MS ? true : 'wait';
    }
    return false;
  }

  /** Minuty zamknięte do `now − 30 s`, w kolejności czasu. */
  flush(now: number): FlowRow[] {
    const out: FlowRow[] = [];
    const first = this.spans[0];
    if (!first) return out;
    let m = Math.max(this.done, Math.ceil(first[0] / MIN_MS) * MIN_MS);
    for (; m + MIN_MS + FLOW_SETTLE_MS <= now; m += MIN_MS) {
      const cov = this.covered(m);
      if (cov === 'wait') break;
      if (!cov) continue;
      const byCoin = this.open.get(m);
      const v: (number | null)[] = [];
      for (const c of this.coins) {
        if ((this.since.get(c) ?? Infinity) > m) v.push(null, null);
        else {
          const cell = byCoin?.get(c) ?? [0, 0];
          v.push(Math.round(cell[0]), Math.round(cell[1]));
        }
      }
      out.push({ t: m, coins: this.coins, v });
    }
    this.done = Math.max(this.done, m);
    for (const k of [...this.open.keys()]) if (k < this.done) this.open.delete(k);
    this.spans = this.spans.filter(([, to], i) => to === null || to >= this.done || i === this.spans.length - 1);
    return out;
  }
}

const FLOW_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * Pliki przepływu K2 w stanie serwera: jeden plik JSONL na dobę UTC. Wiersz nagłówka `{"v":1,"coins":[…]}` (po starcie,
 * na początku doby i przy zmianie rynków), dalej wiersze `[t, kupno₀, sprzedaż₀, …]`. Pliki starsze niż 21 dób usuwane.
 */
export class FlowFile {
  private readonly dir: string;
  /** Doba → ostatnio zapisany nagłówek w tym procesie */
  private readonly header = new Map<string, string>();

  constructor(dir: string) {
    this.dir = dir;
  }

  append(rows: readonly FlowRow[]): void {
    if (rows.length === 0) return;
    mkdirSync(this.dir, { recursive: true });
    const byDay = new Map<string, string[]>();
    for (const r of rows) {
      const day = utcDay(r.t);
      let lines = byDay.get(day);
      if (!lines) {
        lines = [];
        // Pierwszy zapis doby w tym procesie: po przerwanym zapisie (brak końca linii) nowy wiersz od nowej linii
        const path = join(this.dir, `${day}.jsonl`);
        if (!this.header.has(day) && existsSync(path)) {
          const text = readFileSync(path, 'utf8');
          if (text.length > 0 && !text.endsWith('\n')) lines.push('');
        }
        byDay.set(day, lines);
      }
      const key = JSON.stringify(r.coins);
      if (this.header.get(day) !== key) {
        lines.push(JSON.stringify({ v: 1, coins: r.coins }));
        this.header.set(day, key);
      }
      lines.push(JSON.stringify([r.t, ...r.v]));
    }
    for (const [day, lines] of byDay) appendFileSync(join(this.dir, `${day}.jsonl`), lines.join('\n') + '\n');
  }

  /** Usuwa doby, które całe są starsze niż `keepDays` dób przed `now`; zwraca liczbę usuniętych plików. */
  prune(now: number, keepDays = K2_KEEP_DAYS): number {
    if (!existsSync(this.dir)) return 0;
    let n = 0;
    for (const name of readdirSync(this.dir)) {
      const m = FLOW_FILE.exec(name);
      if (!m) continue;
      const start = Date.parse(`${m[1]}T00:00:00Z`);
      if (start + DAY_MS <= now - keepDays * DAY_MS) {
        unlinkSync(join(this.dir, name));
        n++;
      }
    }
    return n;
  }
}

/** Odczyt pliku doby (analiza offline i testy): minuta → rynek → [kupno, sprzedaż] albo null; złe linie pomijane. */
export function readFlowDay(text: string): { t: number; m: Record<string, [number, number] | null> }[] {
  const out: { t: number; m: Record<string, [number, number] | null> }[] = [];
  let coins: string[] | null = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let x: unknown;
    try {
      x = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(x) && Array.isArray(x.coins)) {
      coins = x.coins.filter((c): c is string => typeof c === 'string');
      continue;
    }
    if (!coins || !Array.isArray(x) || typeof x[0] !== 'number' || x.length !== 1 + 2 * coins.length) continue;
    const m: Record<string, [number, number] | null> = {};
    coins.forEach((c, i) => {
      const b = x[1 + 2 * i];
      const s = x[2 + 2 * i];
      m[c] = typeof b === 'number' && typeof s === 'number' ? [b, s] : null;
    });
    out.push({ t: x[0], m });
  }
  return out;
}
