// Odtwarzalne wejście REST/WS do normalnej aplikacji. Wszystkie zewnętrzne połączenia są atrapami.
const ms = 300000;
const from = Date.UTC(2026, 10, 18, 5), end = from + 25 * ms;
let now = end + 1000;
Date.now = () => now;
const candles = Array.from({ length: 26 }, (_, i) => {
  const c = i < 22 ? 100 : i === 22 ? 98 : i === 23 ? 100 : i === 24 ? 102 : 101;
  const t = from + i * ms;
  return { t, T: t + ms - 1, o: c, h: c + .5, l: c - .5, c, v: 10, n: 10 };
});
const fetchLocal = window.fetch.bind(window);
const ctx = { markPx: '101', oraclePx: '101', prevDayPx: '100', funding: '0', openInterest: '200', dayNtlVlm: '1000', dayBaseVlm: '10', midPx: '101', premium: '0' };
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin === location.origin) return fetchLocal(input, init);
  if (url.hostname !== 'api.hyperliquid.xyz' || url.pathname !== '/info') return new Response(null, { status: 404 });
  const request = JSON.parse(init?.body ?? '{}');
  if (request.type === 'candleSnapshot' && request.req?.interval === '5m') {
    return Response.json(candles.filter(c => c.t >= request.req.startTime && c.t <= request.req.endTime));
  }
  if (request.type === 'metaAndAssetCtxs') return Response.json([{ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] }, [ctx]]);
  if (request.type === 'allMids') return Response.json({ BTC: '101' });
  if (request.type === 'l2Book') return Response.json({ coin: 'BTC', time: now, levels: [[{ px: '100', sz: '10' }], [{ px: '102', sz: '10' }]] });
  return Response.json([]);
};
const streams = new Set();
let tid = 10;
function print(time, px, sz, side, id = ++tid) {
  return { coin: 'BTC', side, time, px: String(px), sz: String(sz), tid: id };
}
class SimSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  constructor() {
    queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); });
  }
  send(raw) {
    const q = JSON.parse(raw);
    if (q.method === 'subscribe' && q.subscription.type === 'trades' && q.subscription.coin === 'BTC' && !streams.has(this)) {
      streams.add(this);
      queueMicrotask(() => this.emit('trades', [print(end + 500, 102.4, 1, 'B', 1)]));
    } else if (q.method === 'ping') this.emit('pong', {});
  }
  emit(channel, data) { this.onmessage?.({ data: JSON.stringify({ channel, data }) }); }
  close() { this.readyState = 3; streams.delete(this); this.onclose?.({}); }
}
window.WebSocket = SimSocket;
location.hash = '#charts?m=BTC&i=5m&v=candles&ind=smc()';
const advance = document.querySelector('#sim-print');
let step = 0;
const sequence = [[2, 100, 'B'], [1, 100, 'A'], [1, 104, 'B'], [2, 100, 'A']];
advance.addEventListener('click', () => {
  if (!streams.size || step === sequence.length) return;
  const [size, price, side] = sequence[step++];
  now += 10000;
  const row = print(now - 50, price, size, side);
  for (const stream of streams) stream.emit('trades', [row, row]);
  advance.dataset.at = String(now);
  advance.textContent = `SIM · taśma / tape ${step}/4`;
});
await import('../../src/main.tsx');
