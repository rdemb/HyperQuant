import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeTrades, historyPath } from '../../../src/utils/tapeHistory.ts';
import { MarketRecorder, SETTLE_MS } from '../history.ts';
import { recorderStreams } from '../recorderStreams.ts';

class FakeWs {
  static OPEN = 1;
  static instances: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWs.instances.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  msg(channel: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ channel, data }) });
  }
  subs(): { type: string; coin: string; nSigFigs?: number }[] {
    return this.sent.map((x) => JSON.parse(x)).filter((x) => x.method === 'subscribe').map((x) => x.subscription);
  }
}

const T0 = Date.UTC(2026, 10, 16, 14, 0, 0);
const MIN = 60_000;
const COINS = ['BTC', 'xyz:GOLD', 'xyz:SP500'];
const PX: Record<string, number> = { BTC: 95_000, 'xyz:GOLD': 3840, 'xyz:SP500': 6800 };
const trades = (coin: string, t: number, tid: number) => [{ coin, side: 'B', px: String(PX[coin]), sz: '1', time: t, tid, hash: `0x${String(tid).padStart(64, '1')}`, users: [`0x${'1'.repeat(40)}`, `0x${'2'.repeat(40)}`] }];
const ctx = (coin: string) => ({ coin, ctx: { markPx: String(PX[coin]), openInterest: '1000', dayNtlVlm: '1e8', funding: '0.00001', oraclePx: String(PX[coin]) } });
const read = (dir: string, coin: string) => decodeTrades(JSON.parse(gunzipSync(readFileSync(join(dir, historyPath(coin, T0, 'trades', true)))).toString('utf8')))!;

function setup() {
  FakeWs.instances = [];
  const dir = mkdtempSync(join(tmpdir(), 'hq-rs-'));
  const recs = COINS.map((c) => new MarketRecorder(c, dir));
  const streams = recorderStreams(recs, FakeWs as unknown as typeof WebSocket);
  return { dir, recs, streams };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('połączenia rejestratora historii (projekt 60, R3)', () => {
  it('BTC, złoto i S&P 500 → 2 połączenia: osobne dla BTC, jedno wspólne dla rynków HIP-3 z taśmą i kontekstem każdego rynku', () => {
    vi.useFakeTimers();
    const { streams } = setup();
    expect(streams.map((s) => s.coins)).toEqual([['BTC'], ['xyz:GOLD', 'xyz:SP500']]);
    for (const s of streams) s.start();
    expect(FakeWs.instances).toHaveLength(2);
    const [btc, hip3] = FakeWs.instances;
    btc.open();
    hip3.open();
    expect(btc.subs().filter((s) => s.type !== 'l2Book')).toEqual([
      { type: 'trades', coin: 'BTC' },
      { type: 'activeAssetCtx', coin: 'BTC' },
    ]);
    expect(hip3.subs()).toEqual([
      { type: 'trades', coin: 'xyz:GOLD' },
      { type: 'activeAssetCtx', coin: 'xyz:GOLD' },
      { type: 'trades', coin: 'xyz:SP500' },
      { type: 'activeAssetCtx', coin: 'xyz:SP500' },
    ]);
    // Arkusz rynku HIP-3 po pierwszej cenie: bliska i daleka agregacja oraz bez agregacji (R4), tylko dla tego rynku
    hip3.sent = [];
    hip3.msg('activeAssetCtx', ctx('xyz:GOLD'));
    expect(hip3.subs()).toEqual([
      { type: 'l2Book', coin: 'xyz:GOLD', nSigFigs: 4 },
      { type: 'l2Book', coin: 'xyz:GOLD', nSigFigs: 3 },
      { type: 'l2Book', coin: 'xyz:GOLD' },
    ]);
    // Ta sama cena drugi raz — bez nowych subskrypcji
    hip3.sent = [];
    hip3.msg('activeAssetCtx', ctx('xyz:GOLD'));
    expect(hip3.sent).toEqual([]);
    // Ponowne połączenie: od razu z arkuszem złota (agregacje zapamiętane), S&P 500 jeszcze bez ceny — bez arkusza
    hip3.close();
    vi.advanceTimersByTime(1000);
    expect(FakeWs.instances).toHaveLength(3);
    FakeWs.instances[2].open();
    expect(FakeWs.instances[2].subs().filter((s) => s.type === 'l2Book')).toEqual([
      { type: 'l2Book', coin: 'xyz:GOLD', nSigFigs: 4 },
      { type: 'l2Book', coin: 'xyz:GOLD', nSigFigs: 3 },
      { type: 'l2Book', coin: 'xyz:GOLD' },
    ]);
    for (const s of streams) s.stop();
  });

  it('rozdzielacz po rynku: taśma i kontekst trafiają do właściwego rejestratora, obcy rynek i powtórzenia pominięte', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { dir, streams } = setup();
    for (const s of streams) s.start();
    const hip3 = FakeWs.instances[1];
    hip3.open();
    for (const c of ['xyz:GOLD', 'xyz:SP500']) hip3.msg('activeAssetCtx', ctx(c));
    hip3.msg('trades', trades('xyz:GOLD', T0 + 1000, 1));
    hip3.msg('trades', trades('xyz:SP500', T0 + 1500, 7));
    // Wiadomość z rynkami pomieszanymi i nieznanym rynkiem: każda transakcja do swojego rynku, obcy pominięty
    hip3.msg('trades', [...trades('xyz:SP500', T0 + 2000, 8), ...trades('xyz:GOLD', T0 + 2000, 2), ...trades('xyz:NVDA', T0 + 2000, 99)]);
    hip3.msg('trades', trades('xyz:GOLD', T0 + 2000, 2)); // powtórzenie po ponownej subskrypcji — pominięte
    vi.setSystemTime(T0 + 5 * MIN + SETTLE_MS);
    for (const s of streams) s.stop();
    const flushAll = (recs: MarketRecorder[]) => recs.forEach((r) => r.flush(T0 + 5 * MIN + SETTLE_MS));
    flushAll(streams.flatMap((s) => s.recorders));
    expect(read(dir, 'xyz:GOLD').trades.map((x) => [x.tid, x.px])).toEqual([
      [1, 3840],
      [2, 3840],
    ]);
    expect(read(dir, 'xyz:SP500').trades.map((x) => [x.tid, x.px])).toEqual([
      [7, 6800],
      [8, 6800],
    ]);
  });

  it('zerwanie wspólnego połączenia zamyka odcinek nagrania obu rynków HIP-3 naraz; BTC na swoim połączeniu nagrywa dalej', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { dir, streams } = setup();
    for (const s of streams) s.start();
    const [btc, hip3] = FakeWs.instances;
    btc.open();
    hip3.open();
    btc.msg('trades', trades('BTC', T0 + 1000, 1));
    hip3.msg('trades', trades('xyz:GOLD', T0 + 1000, 1));
    hip3.msg('trades', trades('xyz:SP500', T0 + 1000, 1));
    vi.setSystemTime(T0 + 2 * MIN);
    hip3.msg('activeAssetCtx', ctx('xyz:GOLD'));
    vi.setSystemTime(T0 + 3 * MIN);
    hip3.close(); // koniec odcinka na ostatniej wiadomości (T0 + 2 min)
    const now = T0 + 5 * MIN + SETTLE_MS;
    for (const r of streams.flatMap((s) => s.recorders)) r.flush(now);
    expect(read(dir, 'xyz:GOLD').spans).toEqual([[T0 + 1000, T0 + 2 * MIN]]);
    expect(read(dir, 'xyz:SP500').spans).toEqual([[T0 + 1000, T0 + 2 * MIN]]);
    expect(read(dir, 'BTC').spans).toEqual([[T0 + 1000, T0 + 5 * MIN]]);
    for (const s of streams) s.stop();
  });

  it('rynki giełdy głównej poza BTC (np. ETH z dawnej listy) dalej po jednym połączeniu; same rynki HIP-3 — jedno', () => {
    FakeWs.instances = [];
    const dir = mkdtempSync(join(tmpdir(), 'hq-rs-'));
    const mk = (cs: string[]) => recorderStreams(cs.map((c) => new MarketRecorder(c, dir)), FakeWs as unknown as typeof WebSocket).map((s) => s.coins);
    expect(mk(['BTC', 'ETH', 'xyz:GOLD'])).toEqual([['BTC'], ['ETH'], ['xyz:GOLD']]);
    expect(mk(['xyz:GOLD', 'xyz:SP500'])).toEqual([['xyz:GOLD', 'xyz:SP500']]);
    expect(mk([])).toEqual([]);
  });
});
