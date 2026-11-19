import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { HlStream, type StreamHandlers } from '../../../charts/pro/hl/stream';
import { dropStore, storeFor } from '../../../charts/pro/store/proStore';
import OrderFlowView from '../OrderFlowView';

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  const useSyncExternalStore: typeof react.useSyncExternalStore = (subscribe, read, serverRead = read) =>
    react.useSyncExternalStore(subscribe, read, serverRead);
  return { ...react, useSyncExternalStore };
});

const start = Date.UTC(2026, 10, 19, 11);
const markets = [['BTC', 64_000], ['xyz:GOLD', 3_700], ['xyz:SP500', 7_400]] as const;

afterEach(() => {
  for (const [coin] of markets) dropStore(coin);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(markets)('%s: wiek arkusza i okno obrotu nie cofają się do paczki historycznej', (coin, price) => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { location: { hash: `#orderflow?m=${encodeURIComponent(coin)}` } });
  let handlers: StreamHandlers = {};
  vi.spyOn(HlStream.prototype, 'listen').mockImplementation(listener => {
    handlers = listener;
    return () => {};
  });
  const store = storeFor(coin);
  const render = (time: number) => {
    vi.setSystemTime(time);
    return renderToStaticMarkup(<OrderFlowView />);
  };
  const subscribe = (time: number) => {
    handlers.onStatus?.('open');
    handlers.onSubscribed?.({ type: 'trades', coin }, time);
  };
  const trade = (time: number, tid: number) => ({ coin, time, tid, side: 'B', px: String(price), sz: '1', hash: `0x${tid.toString(16)}` });
  const seed = Array.from({ length: 30 }, (_, i) => trade(start - 118_000 + i * 2_000, i + 1));
  const book = (time: number) => ({ coin, time, levels: [
    [{ px: String(price - 0.1), sz: '1', n: 1 }],
    [{ px: String(price + 0.1), sz: '1', n: 1 }],
  ] });

  vi.setSystemTime(start);
  subscribe(start);
  handlers.onMessage?.('activeAssetCtx', { coin, ctx: {
    markPx: String(price), oraclePx: String(price), midPx: String(price), funding: '0', openInterest: '1', dayNtlVlm: '1', prevDayPx: String(price),
  } }, start);
  handlers.onMessage?.('trades', seed, start);
  handlers.onMessage?.('l2Book', book(start), start);
  expect.soft(store.serverNow()).toBe(start);
  expect(render(start)).toContain('Hyperliquid · LIVE');

  const idle = render(start + 20_000);
  expect.soft(idle).toMatch(/20 s temu|20 s ago/);
  expect.soft(idle).toMatch(/0 wyk\.|0 trades/);
  expect.soft(render(start + 31_000)).not.toContain('data-of-level=');

  handlers.onClosed?.(start + 20_000);
  handlers.onStatus?.('reconnecting');
  const reopened = start + 40_000;
  vi.setSystemTime(reopened);
  subscribe(reopened);
  handlers.onMessage?.('trades', seed, reopened);
  expect.soft(store.serverNow()).toBe(reopened);
  expect.soft(render(reopened)).not.toContain('Hyperliquid · LIVE');
  handlers.onMessage?.('l2Book', book(reopened), reopened);
  expect(render(reopened)).toContain('Hyperliquid · LIVE');
  expect(render(reopened)).toMatch(/0 wyk\.|0 trades/);

  handlers.onMessage?.('trades', [trade(reopened + 1_000, 31)], reopened + 1_000);
  expect(render(reopened + 2_000)).toMatch(/1 wyk\.|1 trades/);

  handlers.onClosed?.(reopened + 1_000);
  handlers.onStatus?.('reconnecting');
  subscribe(reopened + 3_000);
  handlers.onMessage?.('trades', seed, reopened + 3_000);
  handlers.onMessage?.('l2Book', book(reopened), reopened + 3_000);
  expect(render(reopened + 3_000)).not.toContain('Hyperliquid · LIVE');
  handlers.onMessage?.('l2Book', book(reopened + 3_000), reopened + 3_000);
  expect(render(reopened + 3_000)).toContain('Hyperliquid · LIVE');
});
