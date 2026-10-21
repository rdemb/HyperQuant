import { AggrTradeTick, ExchangeId } from '../types/trading';
import { classifyAggrThresholdTier } from './marketDataFeed';

/**
 * Adaptery publicznych strumieni WebSocket giełd CEX (opt-in użytkownika, łączone z jego przeglądarki).
 * Każdy adapter to konfiguracja połączenia + czysty parser wiadomości → realne ticki (bez modelu).
 * Formaty zweryfikowane z oficjalną dokumentacją giełd (stan: 2026-10).
 */
export interface CexAdapter {
  id: ExchangeId;
  /** Nazwa do UI */
  label: string;
  url: string;
  isPerp: boolean;
  /** Wiadomości wysyłane po otwarciu (JSON) */
  subscribe?: object[];
  /** Zwraca ticki z jednej sparsowanej wiadomości; pusto, gdy wiadomość nie dotyczy transakcji */
  parse: (msg: unknown) => AggrTradeTick[];
  pingIntervalMs?: number;
  /** Surowy tekst pingu (wysyłany bez dodatkowej serializacji) */
  pingPayload?: string;
}

/** Wartość kontraktu OKX BTC-USDT-SWAP (ctVal z /api/v5/public/instruments): 1 kontrakt = 0.01 BTC. */
export const OKX_BTC_SWAP_CT_VAL = 0.01;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN);

/** Wspólny konstruktor ticka: sizeUsd = cena·ilość, próg wg tabel Aggr. Zwraca null dla błędnych danych. */
function makeTick(
  id: string,
  exchange: ExchangeId,
  market: string,
  isPerp: boolean,
  side: 'buy' | 'sell',
  price: number,
  qtyBtc: number,
  timestamp: number,
  isLiquidation = false
): AggrTradeTick | null {
  if (!(price > 0) || !(qtyBtc > 0) || !Number.isFinite(price) || !Number.isFinite(qtyBtc)) return null;
  const sizeUsd = Math.round(price * qtyBtc);
  return {
    id,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    exchange,
    market,
    isPerp,
    side,
    price,
    sizeUsd,
    sizeBtc: Number(qtyBtc.toFixed(4)),
    isLiquidation,
    tier: classifyAggrThresholdTier(sizeUsd, isPerp, isLiquidation),
  };
}

const compact = (arr: (AggrTradeTick | null)[]): AggrTradeTick[] => arr.filter((t): t is AggrTradeTick => t !== null);

/** Binance aggTrade: m = „kupujący jest makerem” ⇒ agresorem jest sprzedający. */
function parseBinanceAggTrade(d: Rec, exchange: ExchangeId, market: string, isPerp: boolean, prefix: string): AggrTradeTick | null {
  if (d.s !== 'BTCUSDT') return null;
  return makeTick(`${prefix}-${String(d.a)}`, exchange, market, isPerp, d.m === true ? 'sell' : 'buy', num(d.p), num(d.q), num(d.T));
}

/** Combined stream Binance opakowuje zdarzenie w { stream, data }. */
const binanceData = (msg: unknown): Rec | null => {
  if (!isRec(msg)) return null;
  const d = isRec(msg.data) ? msg.data : msg;
  return typeof d.e === 'string' ? d : null;
};

export const binanceFuturesAdapter: CexAdapter = {
  id: 'BINANCE_FUTURES',
  label: 'Binance Futures',
  // Od 2026-04-23 strumienie aggTrade/forceOrder działają tylko pod ścieżką /market
  url: 'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder',
  isPerp: true,
  // Serwer sam wysyła ping (ramka kontrolna); przeglądarka odpowiada pong automatycznie
  parse(msg) {
    const d = binanceData(msg);
    if (!d) return [];
    if (d.e === 'aggTrade') return compact([parseBinanceAggTrade(d, 'BINANCE_FUTURES', 'BTCUSDT-PERP', true, 'bnf')]);
    if (d.e === 'forceOrder' && isRec(d.o)) {
      const o = d.o;
      if (o.s !== 'BTCUSDT') return [];
      // Zlecenie likwidacyjne: SELL = likwidacja longa (wymuszona sprzedaż), BUY = likwidacja shorta
      const filled = num(o.z);
      const qty = filled > 0 ? filled : num(o.q);
      const avg = num(o.ap);
      const px = avg > 0 ? avg : num(o.p);
      const side = o.S === 'BUY' ? 'buy' : 'sell';
      return compact([makeTick(`bnf-liq-${String(o.T)}-${side}-${qty}`, 'BINANCE_FUTURES', 'BTCUSDT-PERP', true, side, px, qty, num(o.T), true)]);
    }
    return [];
  },
};

export const binanceSpotAdapter: CexAdapter = {
  id: 'BINANCE',
  label: 'Binance Spot',
  url: 'wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade',
  isPerp: false,
  parse(msg) {
    const d = binanceData(msg);
    if (!d || d.e !== 'aggTrade') return [];
    return compact([parseBinanceAggTrade(d, 'BINANCE', 'BTCUSDT', false, 'bns')]);
  },
};

export const bybitAdapter: CexAdapter = {
  id: 'BYBIT',
  label: 'Bybit Linear',
  url: 'wss://stream.bybit.com/v5/public/linear',
  isPerp: true,
  subscribe: [{ op: 'subscribe', args: ['publicTrade.BTCUSDT', 'allLiquidation.BTCUSDT'] }],
  pingIntervalMs: 20000,
  pingPayload: JSON.stringify({ op: 'ping' }),
  parse(msg) {
    if (!isRec(msg) || typeof msg.topic !== 'string' || !Array.isArray(msg.data)) return [];
    const rows = msg.data.filter(isRec).filter((r) => r.s === 'BTCUSDT');
    if (msg.topic === 'publicTrade.BTCUSDT') {
      // S = strona agresora (takera)
      return compact(
        rows.map((r) =>
          makeTick(`byb-${String(r.i)}`, 'BYBIT', 'BTCUSDT-PERP', true, r.S === 'Buy' ? 'buy' : 'sell', num(r.p), num(r.v), num(r.T))
        )
      );
    }
    if (msg.topic === 'allLiquidation.BTCUSDT') {
      // Dokumentacja: „Buy” = zlikwidowano pozycję LONG ⇒ wymuszona sprzedaż (side 'sell'); p = cena bankructwa
      return compact(
        rows.map((r, i) => {
          const side = r.S === 'Buy' ? 'sell' : 'buy';
          return makeTick(`byb-liq-${String(r.T)}-${i}-${side}-${String(r.v)}`, 'BYBIT', 'BTCUSDT-PERP', true, side, num(r.p), num(r.v), num(r.T), true);
        })
      );
    }
    return [];
  },
};

const OKX_INST = 'BTC-USDT-SWAP';

export const okxAdapter: CexAdapter = {
  id: 'OKEX',
  label: 'OKX Swap',
  // Aktualna dokumentacja podaje adres bez portu 8443 (port 443)
  url: 'wss://ws.okx.com/ws/v5/public',
  isPerp: true,
  subscribe: [
    {
      op: 'subscribe',
      args: [
        { channel: 'trades', instId: OKX_INST },
        { channel: 'liquidation-orders', instType: 'SWAP' },
      ],
    },
  ],
  // Serwer zamyka połączenie po 30 s ciszy; ping tekstem, odpowiedź „pong”
  pingIntervalMs: 25000,
  pingPayload: 'ping',
  parse(msg) {
    if (!isRec(msg) || !isRec(msg.arg) || !Array.isArray(msg.data)) return [];
    const channel = msg.arg.channel;
    const rows = msg.data.filter(isRec).filter((r) => r.instId === OKX_INST);
    if (channel === 'trades') {
      // sz w kontraktach; side = strona agresora
      return compact(
        rows.map((r) =>
          makeTick(`okx-${String(r.tradeId)}`, 'OKEX', OKX_INST, true, r.side === 'buy' ? 'buy' : 'sell', num(r.px), num(r.sz) * OKX_BTC_SWAP_CT_VAL, num(r.ts))
        )
      );
    }
    if (channel === 'liquidation-orders') {
      // side zlecenia likwidacyjnego: buy = zamknięcie zlikwidowanego shorta, sell = longa; bkPx = cena bankructwa
      const out: AggrTradeTick[] = [];
      for (const r of rows) {
        if (!Array.isArray(r.details)) continue;
        r.details.filter(isRec).forEach((d, i) => {
          const side = d.side === 'buy' ? 'buy' : 'sell';
          const t = makeTick(
            `okx-liq-${String(d.ts)}-${i}-${side}-${String(d.sz)}`,
            'OKEX',
            OKX_INST,
            true,
            side,
            num(d.bkPx),
            num(d.sz) * OKX_BTC_SWAP_CT_VAL,
            num(d.ts),
            true
          );
          if (t) out.push(t);
        });
      }
      return out;
    }
    return [];
  },
};

/** Coinbase podaje czas z nanosekundami — skracamy do milisekund (bezpieczne Date.parse w każdej przeglądarce). */
const parseIsoMs = (v: unknown): number => (typeof v === 'string' ? Date.parse(v.replace(/(\.\d{3})\d+/, '$1')) : NaN);

export const coinbaseAdapter: CexAdapter = {
  id: 'COINBASE',
  label: 'Coinbase Spot',
  // Advanced Trade: market_trades i heartbeats nie wymagają uwierzytelnienia (JWT)
  url: 'wss://advanced-trade-ws.coinbase.com',
  isPerp: false,
  subscribe: [
    { type: 'subscribe', product_ids: ['BTC-USD'], channel: 'market_trades' },
    // Heartbeats utrzymują połączenie, gdy brak transakcji (inaczej zamknięcie po 60–90 s)
    { type: 'subscribe', product_ids: ['BTC-USD'], channel: 'heartbeats' },
  ],
  parse(msg) {
    if (!isRec(msg) || msg.channel !== 'market_trades' || !Array.isArray(msg.events)) return [];
    const out: AggrTradeTick[] = [];
    for (const ev of msg.events) {
      // Pomijamy snapshot (historia przy subskrypcji) — przy reconnect dublowałby transakcje
      if (!isRec(ev) || ev.type !== 'update' || !Array.isArray(ev.trades)) continue;
      for (const tr of ev.trades) {
        if (!isRec(tr) || tr.product_id !== 'BTC-USD') continue;
        // Dokumentacja: side to strona MAKERA ⇒ agresor jest po przeciwnej stronie
        const side = tr.side === 'BUY' ? 'sell' : 'buy';
        const t = makeTick(`cb-${String(tr.trade_id)}`, 'COINBASE', 'BTC-USD', false, side, num(tr.price), num(tr.size), parseIsoMs(tr.time));
        if (t) out.push(t);
      }
    }
    return out;
  },
};

/** Kolejność: najpierw perpy, potem spot. */
export const CEX_ADAPTERS: CexAdapter[] = [binanceFuturesAdapter, bybitAdapter, okxAdapter, binanceSpotAdapter, coinbaseAdapter];

const SUM_RE = /-sum(\d+)$/;

/** Liczba realnych transakcji w ticku (>1 dla sumy drobnych transakcji z paczki). */
export function tickTradeCount(t: AggrTradeTick): number {
  const m = SUM_RE.exec(t.id);
  return m ? Number(m[1]) : 1;
}

/**
 * Sumuje drobne transakcje (próg „normal”, bez likwidacji) z jednej paczki per giełda, strona i sekunda —
 * jak agregacja w Aggr. Duże transakcje i likwidacje zostają pojedynczo. Wolumen USD zachowany co do dolara,
 * cena = VWAP. Koszyk sekundowy nie przekracza granicy świecy (interwały są wielokrotnością 1 s).
 * Suma nie dostaje wyższego progu — to nie jest jedno duże zlecenie.
 */
export function aggregateSmallTrades(ticks: AggrTradeTick[]): AggrTradeTick[] {
  const out: AggrTradeTick[] = [];
  const groups = new Map<string, { first: AggrTradeTick; usd: number; btc: number; pxBtc: number; n: number; lastTs: number }>();
  for (const t of ticks) {
    if (t.isLiquidation || t.tier !== 'normal') {
      out.push(t);
      continue;
    }
    const key = `${t.exchange}|${t.side}|${Math.floor(t.timestamp / 1000)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { first: t, usd: t.sizeUsd, btc: t.sizeBtc, pxBtc: t.price * t.sizeBtc, n: 1, lastTs: t.timestamp });
    } else {
      g.usd += t.sizeUsd;
      g.btc += t.sizeBtc;
      g.pxBtc += t.price * t.sizeBtc;
      g.n += 1;
      g.lastTs = Math.max(g.lastTs, t.timestamp);
    }
  }
  groups.forEach((g) => {
    if (g.n === 1) {
      out.push(g.first);
      return;
    }
    out.push({
      ...g.first,
      id: `${g.first.id}-sum${g.n}`,
      timestamp: g.lastTs,
      price: g.btc > 0 ? g.pxBtc / g.btc : g.first.price,
      sizeUsd: g.usd,
      sizeBtc: Number(g.btc.toFixed(4)),
    });
  });
  return out.sort((a, b) => a.timestamp - b.timestamp);
}
