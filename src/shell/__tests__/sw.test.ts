import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Win = { url: string; focus: () => Promise<Win>; navigate?: (u: string) => Promise<Win | null> };

/** Worker z public/sw.js w piaskownicy: zdarzenia rejestrowane przez self.addEventListener, karty z listy `tabs`. */
function loadWorker(tabs: Win[]) {
  const on: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  const self = {
    location: { href: 'https://x.test/HyperQuant/sw.js?v=t', origin: 'https://x.test' },
    registration: { scope: 'https://x.test/HyperQuant/' },
    addEventListener: (k: string, fn: (e: unknown) => void) => (on[k] = fn),
    clients: { matchAll: async () => tabs, openWindow: async (u: string) => void opened.push(u) },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL, caches: {}, fetch });
  const click = async (data: unknown) => {
    let done: Promise<unknown> = Promise.resolve();
    on.notificationclick({ notification: { data, close: () => undefined }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return { click, opened };
}

function tab(url: string, log: string[], navigate = true): Win {
  const w: Win = {
    url,
    focus: async () => (log.push(`focus ${url}`), w),
  };
  if (navigate) w.navigate = async (u: string) => (log.push(`navigate ${u}`), w);
  return w;
}

describe('kliknięcie powiadomienia alarmu', () => {
  it('powiadomienie 24/7: otwarta karta Wykresów dostaje focus i przechodzi na rynek alarmu', async () => {
    const log: string[] = [];
    const w = loadWorker([tab('https://x.test/HyperQuant/#desk', log), tab('https://x.test/HyperQuant/#charts?m=BTC&i=5m&v=candles', log)]);
    await w.click({ url: './#charts?m=ETH' });
    expect(log).toEqual(['focus https://x.test/HyperQuant/#charts?m=BTC&i=5m&v=candles', 'navigate ./#charts?m=ETH']);
    expect(w.opened).toEqual([]);
  });

  it('alarm z otwartej karty (bez rynku w powiadomieniu): sam focus, bez zmiany widoku', async () => {
    const log: string[] = [];
    await loadWorker([tab('https://x.test/HyperQuant/#desk', log)]).click(undefined);
    expect(log).toEqual(['focus https://x.test/HyperQuant/#desk']);
  });

  it('karta spoza workera (navigate odrzuca) albo bez navigate: focus zostaje; bez karty: nowe okno na rynku', async () => {
    const log: string[] = [];
    const t = tab('https://x.test/HyperQuant/#charts', log);
    t.navigate = async () => Promise.reject(new TypeError('not controlled'));
    await loadWorker([t]).click({ url: './#charts?m=SOL' });
    await loadWorker([tab('https://x.test/HyperQuant/#charts', log, false)]).click({ url: './#charts?m=SOL' });
    expect(log).toEqual(['focus https://x.test/HyperQuant/#charts', 'focus https://x.test/HyperQuant/#charts']);
    const w = loadWorker([]);
    await w.click({ url: './#charts?m=HYPE' });
    expect(w.opened).toEqual(['./#charts?m=HYPE']);
  });
});
