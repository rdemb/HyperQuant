import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LIVE_RETRY_MAX_MS, LIVE_RETRY_MIN_MS, LiveChannel, type LiveWs, filesOf, liveUrl } from '../liveChannel';
import { acceptPushed } from '../usePublished';
import { encodeTailFrames } from '../../utils/tailFrames';

const gz = (v: unknown) => new Uint8Array(gzipSync(JSON.stringify(v)));
const gunzip = async (b: Uint8Array) => gunzipSync(b).toString('utf8');
const msg = (entries: [string, Uint8Array][]) => {
  const u = encodeTailFrames(entries);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
};

describe('kanał na żywo w przeglądarce', () => {
  it('adres: https → wss, http → ws, ścieżka /v1/live', () => {
    expect(liveUrl('https://hyperquant-live.example.workers.dev')).toBe('wss://hyperquant-live.example.workers.dev/v1/live');
    expect(liveUrl('http://127.0.0.1:8799/')).toBe('ws://127.0.0.1:8799/v1/live');
  });

  it('wiadomość: same pliki f:<ścieżka> z JSON-em; ogony rynków i uszkodzone ramki pominięte, zła wiadomość — nic', async () => {
    const files = await filesOf(msg([['BTC', gz({ v: 1 })], ['f:liq-tape/BTC.json', gz({ asOf: 5 })], ['f:status.json', new Uint8Array([1, 2, 3])]]), gunzip);
    expect(files).toEqual([['liq-tape/BTC.json', { asOf: 5 }]]);
    expect(await filesOf(new Uint8Array([0, 9]), gunzip)).toEqual([]);
  });

  it('połączenie: pliki do odbiorcy; zerwane — ponownie po 5 s, potem 10, 20… do 60 s; udane połączenie zeruje przerwę', async () => {
    const sockets: LiveWs[] = [];
    const timers: number[] = [];
    const pending: (() => void)[] = [];
    const got: [string, unknown][] = [];
    const ch = new LiveChannel('wss://x/v1/live', (p, j) => got.push([p, j]), {
      open: () => {
        const ws: LiveWs = { binaryType: '', onmessage: null, onopen: null, onclose: null, close: () => {} };
        sockets.push(ws);
        return ws;
      },
      gunzip,
      setTimeout: (fn, ms) => {
        timers.push(ms);
        pending.push(fn);
      },
    });
    ch.start();
    ch.start();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].binaryType).toBe('arraybuffer');
    sockets[0].onmessage!({ data: msg([['f:whales.json', gz({ asOf: 7 })]]) });
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([['whales.json', { asOf: 7 }]]);
    for (let i = 0; i < 6; i++) {
      sockets.at(-1)!.onclose!();
      pending.shift()!();
    }
    expect(timers).toEqual([LIVE_RETRY_MIN_MS, 10_000, 20_000, 40_000, LIVE_RETRY_MAX_MS, LIVE_RETRY_MAX_MS]);
    sockets.at(-1)!.onopen!();
    sockets.at(-1)!.onclose!();
    expect(timers.at(-1)).toBe(LIVE_RETRY_MIN_MS);
  });

  it('wartość z kanału: tylko przy strażniku wpisu, przechodząca go i nie starsza od bieżącej', () => {
    const guard = (x: unknown): boolean => typeof (x as { asOf?: unknown })?.asOf === 'number';
    expect(acceptPushed({ cache: null }, { asOf: 1 })).toBe(false); // żaden hook jeszcze nie czytał pliku
    const entry = { cache: { asOf: 10 } as { asOf: number } | null, guard };
    expect(acceptPushed(entry, { nie: 'mapa' })).toBe(false);
    expect(acceptPushed(entry, { asOf: 9 })).toBe(false);
    expect(acceptPushed(entry, { asOf: 11, x: 1 })).toBe(true);
    expect(entry.cache).toEqual({ asOf: 11, x: 1 });
  });
});
