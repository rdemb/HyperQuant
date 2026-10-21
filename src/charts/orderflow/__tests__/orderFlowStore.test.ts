import { describe, expect, it } from 'vitest';
import type { AggrTradeTick } from '../../../types/trading';
import { OrderFlowStore, pickSigFigs } from '../orderFlowStore';

const T0 = Date.UTC(2026, 9, 21, 14, 0, 0); // pełna minuta

function tick(ts: number, price: number, btc: number, side: 'buy' | 'sell', extra: Partial<AggrTradeTick> = {}): AggrTradeTick {
  return {
    id: `t-${ts}-${price}-${btc}-${side}`,
    timestamp: ts,
    exchange: 'HYPERLIQUID',
    market: 'BTC-USD-PERP',
    isPerp: true,
    side,
    price,
    sizeUsd: Math.round(price * btc),
    sizeBtc: btc,
    isLiquidation: false,
    tier: 'normal',
    ...extra,
  };
}

const lv = (px: number, sz: number) => ({ px: String(px), sz: String(sz), n: 1 });
function book(mid: number, sizes: (i: number, side: 'bid' | 'ask') => number = () => 1) {
  const bids = Array.from({ length: 20 }, (_, i) => lv(mid - 5 - i * 10, sizes(i, 'bid')));
  const asks = Array.from({ length: 20 }, (_, i) => lv(mid + 5 + i * 10, sizes(i, 'ask')));
  return { bids, asks };
}

describe('heatmapa: próbkowanie kolumn co 1 s', () => {
  it('w obrębie sekundy zostaje ostatni snapshot, kolejna sekunda → nowa kolumna', () => {
    const s = new OrderFlowStore({ heatCap: 60 });
    const a = book(100000, () => 1);
    const b = book(100000, () => 7);
    s.ingestBook(T0 + 100, a.bids, a.asks);
    s.ingestBook(T0 + 600, b.bids, b.asks);
    const sec = Math.floor(T0 / 1000);
    expect(s.hasColumn(sec)).toBe(true);
    const slot = s.slotOf(sec);
    expect(s.colCount[slot]).toBe(40);
    expect(s.lvSz[slot * s.maxLevels]).toBe(7);
    expect(s.colStep[slot]).toBe(10);
    expect(s.colMid[slot]).toBe(100000);

    s.ingestBook(T0 + 1200, a.bids, a.asks);
    expect(s.hasColumn(sec + 1)).toBe(true);
    expect(s.lastBookSec).toBe(sec + 1);
    expect(s.lvSz[s.slotOf(sec + 1) * s.maxLevels]).toBe(1);
  });

  it('bufor pierścieniowy zawija się i nie zwraca nadpisanych sekund', () => {
    const s = new OrderFlowStore({ heatCap: 5 });
    const a = book(100000);
    const sec0 = Math.floor(T0 / 1000);
    for (let k = 0; k < 8; k++) s.ingestBook(T0 + k * 1000 + 50, a.bids, a.asks);
    expect(s.lastBookSec).toBe(sec0 + 7);
    expect(s.hasColumn(sec0 + 7)).toBe(true);
    expect(s.hasColumn(sec0 + 3)).toBe(true);
    expect(s.hasColumn(sec0 + 2)).toBe(false); // nadpisana przez sec0+7
    expect(s.slotOf(sec0 + 7)).toBe(s.slotOf(sec0 + 2));
    expect(s.oldestBookSec()).toBe(sec0 + 3);
  });

  it('krótka przerwa (≤ 5 s) = arkusz bez zmian; dłuższa = puste kolumny', () => {
    const s = new OrderFlowStore({ heatCap: 60 });
    const a = book(100000, () => 3);
    const sec0 = Math.floor(T0 / 1000);
    s.ingestBook(T0, a.bids, a.asks);
    s.ingestBook(T0 + 3000, a.bids, a.asks);
    expect(s.hasColumn(sec0 + 1)).toBe(true);
    expect(s.hasColumn(sec0 + 2)).toBe(true);
    s.ingestBook(T0 + 20_000, a.bids, a.asks);
    expect(s.hasColumn(sec0 + 10)).toBe(false);
    expect(s.hasColumn(sec0 + 20)).toBe(true);
  });

  it('starsze snapshoty niż ostatnia kolumna są ignorowane', () => {
    const s = new OrderFlowStore({ heatCap: 60 });
    const a = book(100000, () => 2);
    s.ingestBook(T0 + 5000, a.bids, a.asks);
    s.ingestBook(T0 + 1000, a.bids, a.asks);
    expect(s.hasColumn(Math.floor(T0 / 1000) + 1)).toBe(false);
  });

  it('rozmiar arkusza w komórce (cena, sekunda) do tooltipa', () => {
    const s = new OrderFlowStore({ heatCap: 60 });
    const a = book(100000, (i, side) => (side === 'ask' && i === 2 ? 42 : 1));
    s.ingestBook(T0, a.bids, a.asks);
    const sec = Math.floor(T0 / 1000);
    // ask nr 2 = 100025 (kubełek 100020–100030)
    expect(s.bookAt(sec, 100027)).toEqual({ px: 100025, sz: 42, side: 'ask' });
    expect(s.bookAt(sec, 99995)?.side).toBe('bid');
    expect(s.bookAt(sec, 101000)).toBeNull();
    expect(s.bookAt(sec + 30, 100025)).toBeNull();
  });
});

describe('footprint per świeca i kubełek', () => {
  it('sumuje kupno/sprzedaż agresora, liczbę transakcji, deltę i POC', () => {
    const s = new OrderFlowStore();
    s.setTimeframe(60);
    s.ingestTrades([
      tick(T0 + 1000, 100001, 0.5, 'buy'),
      tick(T0 + 2000, 100003, 0.25, 'buy'),
      tick(T0 + 3000, 100004, 1, 'sell'),
      tick(T0 + 4000, 100012, 2, 'sell'),
      tick(T0 + 61_000, 100020, 1, 'buy'), // następna świeca
    ]);
    const c = s.candleAt(T0)!;
    expect(c).toBeDefined();
    expect(c.buy).toBeCloseTo(0.75, 9);
    expect(c.sell).toBeCloseTo(3, 9);
    expect(c.nBuy).toBe(2);
    expect(c.nSell).toBe(2);
    const cell = c.cells.get(20000)!; // 100000–100005
    expect(cell.buy).toBeCloseTo(0.75, 9);
    expect(cell.sell).toBeCloseTo(1, 9);
    expect(c.cells.get(20002)!.sell).toBe(2); // 100010–100015
    expect(c.minIdx).toBe(20000);
    expect(c.maxIdx).toBe(20002);
    expect(s.candlePoc(c)).toBe(20002); // 2 BTC > 1.75 BTC
    expect(s.candleAt(T0 + 60_000)!.buy).toBe(1);
  });

  it('zmiana interwału przelicza świece z surowych transakcji', () => {
    const s = new OrderFlowStore();
    s.setTimeframe(60);
    s.ingestTrades([tick(T0 + 1000, 100001, 1, 'buy'), tick(T0 + 61_000, 100001, 2, 'sell')]);
    s.setTimeframe(300);
    const c = s.candleAt(T0)!;
    expect(c.buy).toBe(1);
    expect(c.sell).toBe(2);
    expect(s.candleAt(T0 + 60_000)).toBeUndefined();
  });

  it('pomija ticki syntetyczne, CEX i powtórki po ponownym połączeniu', () => {
    const s = new OrderFlowStore();
    s.setTimeframe(60);
    const a = tick(T0 + 1000, 100001, 1, 'buy');
    s.ingestTrades([a, tick(T0 + 1000, 100001, 1, 'buy', { isSynthetic: true }), tick(T0 + 1000, 100001, 1, 'buy', { exchange: 'BINANCE' })]);
    // snapshot po reconnect: ta sama transakcja jeszcze raz + nowa
    s.ingestTrades([{ ...a, id: 'inne-id' }, tick(T0 + 2000, 100002, 0.5, 'sell')]);
    const c = s.candleAt(T0)!;
    expect(c.buy).toBe(1);
    expect(c.sell).toBe(0.5);
  });

  it('CVD agresora per sekunda od startu zapisu', () => {
    const s = new OrderFlowStore();
    s.ingestTrades([tick(T0 + 100, 100000, 1, 'buy'), tick(T0 + 900, 100000, 0.4, 'sell'), tick(T0 + 2500, 100000, 2, 'sell')]);
    const sec = Math.floor(T0 / 1000);
    expect(s.secDelta(sec)).toBeCloseTo(0.6, 9);
    expect(s.secDelta(sec + 1)).toBe(0);
    expect(s.secDelta(sec + 2)).toBe(-2);
    expect(s.cvdBefore(sec + 2)).toBeCloseTo(0.6, 9);
  });
});

describe('bąble', () => {
  it('agreguje per (sekunda, kubełek 10 USD, strona) z ceną VWAP', () => {
    const s = new OrderFlowStore();
    s.ingestTrades([
      tick(T0 + 100, 100001, 1, 'buy'),
      tick(T0 + 400, 100009, 1, 'buy'),
      tick(T0 + 500, 100009, 1, 'sell'),
      tick(T0 + 1100, 100001, 1, 'buy'),
    ]);
    expect(s.bubbleCount).toBe(3);
    const i = s.bubbleIndexOf(Math.floor(T0 / 1000), 100005, 'buy');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(s.bBtc[i]).toBe(2);
    expect(s.bPxSum[i] / s.bBtc[i]).toBe(100005);
    expect(s.bUsd[i]).toBe(200010);
  });

  it('próg: top 2%, auto (top 2% lub ≥ $50K) albo stała kwota', () => {
    const s = new OrderFlowStore();
    const ticks: AggrTradeTick[] = [];
    // 100 bąbli: 1..100 × 10k USD, każdy w innej sekundzie
    for (let k = 1; k <= 100; k++) ticks.push(tick(T0 + k * 1000, 100000, k / 10, 'buy'));
    s.ingestTrades(ticks);
    const thr = s.bubbleThreshold('top2', T0 + 200_000);
    // 98. percentyl ≈ 980k USD (dokładność histogramu logarytmicznego)
    expect(thr).toBeGreaterThan(900_000);
    expect(thr).toBeLessThan(1_050_000);
    expect(s.bubbleThreshold(50_000, T0)).toBe(50_000);
    // auto: niższy z progów — tu $50K < p98, więc pokazujemy też wszystko ≥ $50K
    expect(s.bubbleThreshold('auto', T0 + 200_000)).toBe(50_000);
  });
});

describe('start zapisu', () => {
  it('null przed danymi; potem najwcześniejszy z (transakcja, arkusz)', () => {
    const s = new OrderFlowStore();
    expect(s.startedAt).toBeNull();
    const a = book(100000);
    s.ingestBook(T0 + 5000, a.bids, a.asks);
    expect(s.startedAt).toBe(T0 + 5000);
    s.ingestTrades([tick(T0 + 7000, 100000, 1, 'buy')]);
    expect(s.startedAt).toBe(T0 + 5000);
    expect(s.tradesSince).toBe(T0 + 7000);
    expect(s.bookSince).toBe(T0 + 5000);
  });
});

describe('pickSigFigs', () => {
  it('celuje w kubełki 10 USD i ma histerezę przy granicy rzędu wielkości', () => {
    expect(pickSigFigs(97_000, 4)).toBe(4); // 5 cyfr → 4 cyfry znaczące = 10 USD
    expect(pickSigFigs(105_000, 4)).toBe(5); // 6 cyfr → 5 cyfr znaczących = 10 USD
    expect(pickSigFigs(100_050, 4)).toBe(4); // tuż przy 100k: bez zmiany
    expect(pickSigFigs(99_950, 5)).toBe(5);
  });
});

describe('WebSocket arkusza (atrapa)', () => {
  it('subskrybuje l2Book BTC z nSigFigs, zapisuje kolumny i zamyka po stop', () => {
    const sent: string[] = [];
    let sock: FakeWs | null = null;
    class FakeWs {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      closed = false;
      constructor() {
        sock = this;
      }
      send(m: string) {
        sent.push(m);
      }
      close() {
        this.closed = true;
      }
    }
    const s = new OrderFlowStore({ wsFactory: () => new FakeWs() as unknown as WebSocket });
    const stop = s.startBook();
    expect(s.bookStatus).toBe('connecting');
    sock!.readyState = 1;
    sock!.onopen!();
    expect(JSON.parse(sent[0])).toEqual({ method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC', nSigFigs: 4 } });
    const a = book(97000, () => 2);
    sock!.onmessage!({ data: JSON.stringify({ channel: 'l2Book', data: { coin: 'BTC', time: T0, levels: [a.bids, a.asks] } }) });
    expect(s.bookStatus).toBe('live');
    expect(s.hasColumn(Math.floor(T0 / 1000))).toBe(true);
    stop();
    expect(sock!.closed).toBe(true);
    expect(s.bookStatus).toBe('off');
  });
});
