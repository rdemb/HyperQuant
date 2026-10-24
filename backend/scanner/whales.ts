import { createHmac, randomBytes } from 'node:crypto';
import { WHALES_VERSION, type WhaleLayer, type WhaleOrder, type WhalePosition } from '../../src/utils/whaleLayer.ts';
import type { InfoClient } from './liqDetect.ts';

/**
 * Warstwa wielorybów: pozycje (`clearinghouseState`, waga 2) i zlecenia oczekujące z wyzwalanymi (`frontendOpenOrders`,
 * waga 20) największych kont, we własnym budżecie wag. Pozycje każdego kandydata co POS_EVERY_MS, zlecenia — co
 * ORD_EVERY_MS dla ORD_MAX kont z największymi pozycjami w publikowanych rynkach. Adresy zostają na serwerze;
 * w pliku konto ma pseudonim na dobę UTC (HMAC z sekretem doby, który nie opuszcza serwera).
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Rynki warstwy (te same co w widoku Wykresy) */
export const WHALE_MARKETS = ['BTC', 'ETH', 'SOL', 'HYPE'] as const;
export const POS_EVERY_MS = 5 * MIN;
export const ORD_EVERY_MS = 5 * MIN;
export const ORD_MAX = 40;
/** Odczyt starszy niż to nie trafia do pliku (konto wypadło z kandydatów albo API milczy) */
const STALE_MS = 15 * MIN;
/** Najwyżej tyle zleceń konta na rynek i zleceń na rynek w pliku (największe) */
const ORD_PER_ACCOUNT = 12;
const ORD_PER_MARKET = 80;

/** Progi publikacji (USD): pozycja i zlecenie; rynki spoza listy — progi BTC */
export const MIN_POSITION_USD: Record<string, number> = { BTC: 1_000_000, ETH: 500_000, SOL: 250_000, HYPE: 250_000 };
export const MIN_ORDER_USD: Record<string, number> = { BTC: 250_000, ETH: 150_000, SOL: 50_000, HYPE: 50_000 };
const minPos = (coin: string) => MIN_POSITION_USD[coin] ?? MIN_POSITION_USD.BTC;
const minOrd = (coin: string) => MIN_ORDER_USD[coin] ?? MIN_ORDER_USD.BTC;

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN);

type RawPos = Omit<WhalePosition, 'id'> & { coin: string };
type RawOrd = Omit<WhaleOrder, 'id'> & { coin: string };

/** Pozycje w wybranych rynkach z `clearinghouseState` (bez progu); zły kształt → null. */
export function parsePositions(state: unknown, coins: readonly string[], at: number): RawPos[] | null {
  const list = (state as { assetPositions?: unknown } | null)?.assetPositions;
  if (!Array.isArray(list)) return null;
  const out: RawPos[] = [];
  for (const ap of list) {
    const p = (ap as { position?: Record<string, unknown> } | null)?.position;
    if (!p || typeof p.coin !== 'string' || !coins.includes(p.coin)) continue;
    const szi = num(p.szi);
    const entry = num(p.entryPx);
    const usd = num(p.positionValue);
    if (!Number.isFinite(szi) || szi === 0 || !(entry > 0) || !(usd > 0)) continue;
    const liq = p.liquidationPx === null || p.liquidationPx === undefined ? Number.NaN : num(p.liquidationPx);
    const lev = num((p.leverage as { value?: unknown } | undefined)?.value);
    const upnl = num(p.unrealizedPnl);
    out.push({ coin: p.coin, side: szi > 0 ? 'long' : 'short', usd, sz: Math.abs(szi), entry, liq: liq > 0 ? liq : null, lev: Number.isFinite(lev) ? lev : 0, upnl: Number.isFinite(upnl) ? upnl : 0, at });
  }
  return out;
}

/**
 * Zlecenia w wybranych rynkach z `frontendOpenOrders` (bez progu); wyzwalane po cenie wyzwolenia, TP/SL całej pozycji
 * (wielkość 0) — z wielkością pozycji konta. Zły kształt → null.
 */
export function parseOrders(raw: unknown, coins: readonly string[], positions: readonly RawPos[], at: number): RawOrd[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RawOrd[] = [];
  for (const o of raw as Record<string, unknown>[]) {
    if (!o || typeof o.coin !== 'string' || !coins.includes(o.coin) || (o.side !== 'B' && o.side !== 'A')) continue;
    const trig = o.isTrigger === true;
    const px = trig ? num(o.triggerPx) : num(o.limitPx);
    let sz = num(o.sz);
    if (sz === 0 && o.isPositionTpsl === true) sz = positions.find((p) => p.coin === o.coin)?.sz ?? 0;
    if (!(px > 0) || !(sz > 0)) continue;
    const type = String(o.orderType ?? '');
    const kind: WhaleOrder['kind'] = !trig ? 'limit' : /take profit/i.test(type) ? 'tp' : 'stop';
    out.push({ coin: o.coin, side: o.side === 'B' ? 'bid' : 'ask', px, usd: px * sz, kind, reduce: o.reduceOnly === true || o.isPositionTpsl === true, at });
  }
  return out;
}

interface Acct {
  posAt: number;
  positions: RawPos[];
  ordAt: number;
  orders: RawOrd[];
}

export interface WhaleDeps {
  rest: InfoClient;
  /** Kandydaci (adresy tylko na serwerze), najważniejsi pierwsi */
  candidates: () => string[];
  coins: readonly string[];
  /** Sekret doby (stan serwera); domyślnie losowy */
  salt?: { day: number; key: string };
}

export class WhaleWatcher {
  private readonly d: WhaleDeps;
  private readonly accts = new Map<string, Acct>();
  private salt: { day: number; key: string };
  private candidatesN = 0;

  constructor(d: WhaleDeps) {
    this.d = d;
    this.salt = d.salt ?? { day: -1, key: '' };
  }

  /** Sekret doby do zapisania w stanie (pseudonimy bez zmian po restarcie w tej samej dobie). */
  get secret(): { day: number; key: string } {
    return this.salt;
  }

  /** Pseudonim konta na dobę UTC: „W” + 6 znaków HMAC-SHA256 adresu z sekretem doby. */
  alias(addr: string, now: number): string {
    const day = Math.floor(now / DAY);
    if (this.salt.day !== day) this.salt = { day, key: randomBytes(32).toString('hex') };
    return `W${createHmac('sha256', this.salt.key).update(addr.toLowerCase()).digest('hex').slice(0, 6)}`;
  }

  private bestUsd(a: Acct): number {
    let m = 0;
    for (const p of a.positions) if (p.usd >= minPos(p.coin)) m = Math.max(m, p.usd);
    return m;
  }

  /** Jeden przebieg: odczyt pozycji kandydatów, których termin minął, potem zleceń kont z dużymi pozycjami; zwraca liczbę zapytań. */
  async tick(now: () => number): Promise<number> {
    const cands = this.d.candidates();
    this.candidatesN = cands.length;
    const keep = new Set(cands);
    for (const a of this.accts.keys()) if (!keep.has(a)) this.accts.delete(a);
    let n = 0;
    for (const addr of cands) {
      const a = this.accts.get(addr);
      if (a && now() - a.posAt < POS_EVERY_MS) continue;
      const st = await this.d.rest.info({ type: 'clearinghouseState', user: addr }, 2);
      n++;
      const positions = parsePositions(st, this.d.coins, now());
      if (!positions) continue;
      this.accts.set(addr, { posAt: now(), positions, ordAt: a?.ordAt ?? Number.NEGATIVE_INFINITY, orders: a?.orders ?? [] });
    }
    const big = [...this.accts.entries()]
      .map(([addr, a]) => [addr, a, this.bestUsd(a)] as const)
      .filter(([, , usd]) => usd > 0)
      .sort((x, y) => y[2] - x[2])
      .slice(0, ORD_MAX);
    const bigSet = new Set(big.map(([addr]) => addr));
    for (const [addr, a] of this.accts) if (!bigSet.has(addr)) a.orders = [];
    for (const [addr, a] of big) {
      if (now() - a.ordAt < ORD_EVERY_MS) continue;
      const raw = await this.d.rest.info({ type: 'frontendOpenOrders', user: addr }, 20);
      n++;
      const orders = parseOrders(raw, this.d.coins, a.positions, now());
      if (!orders) continue;
      a.ordAt = now();
      a.orders = orders;
    }
    return n;
  }

  /** Plik warstwy: pozycje i zlecenia od progów rynku, z odczytów nie starszych niż 15 min, bez adresów. */
  build(now: number): WhaleLayer {
    const markets: WhaleLayer['markets'] = {};
    for (const c of this.d.coins) markets[c] = { positions: [], orders: [] };
    let accounts = 0;
    for (const [addr, a] of this.accts) {
      if (now - a.posAt > STALE_MS) continue;
      accounts++;
      const id = this.alias(addr, now);
      for (const { coin, ...p } of a.positions) if (p.usd >= minPos(coin)) markets[coin].positions.push({ id, ...p, usd: Math.round(p.usd) });
      if (now - a.ordAt > STALE_MS) continue;
      const byCoin = new Map<string, RawOrd[]>();
      for (const o of a.orders) if (o.usd >= minOrd(o.coin)) byCoin.set(o.coin, [...(byCoin.get(o.coin) ?? []), o]);
      for (const [coin, list] of byCoin) {
        for (const { coin: _c, ...o } of list.sort((x, y) => y.usd - x.usd).slice(0, ORD_PER_ACCOUNT)) markets[coin].orders.push({ id, ...o, usd: Math.round(o.usd) });
      }
    }
    for (const m of Object.values(markets)) {
      m.positions.sort((x, y) => y.usd - x.usd);
      m.orders = m.orders.sort((x, y) => y.usd - x.usd).slice(0, ORD_PER_MARKET);
    }
    const pick = (src: Record<string, number>) => Object.fromEntries(this.d.coins.map((c) => [c, src[c] ?? src.BTC]));
    return { v: WHALES_VERSION, asOf: now, accounts, candidates: this.candidatesN, minPositionUsd: pick(MIN_POSITION_USD), minOrderUsd: pick(MIN_ORDER_USD), markets };
  }
}
