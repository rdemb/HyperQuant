import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Win = { url: string; focus: () => Promise<Win>; navigate?: (u: string) => Promise<Win | null> };

/** Worker z public/sw.js w piaskownicy: zdarzenia rejestrowane przez self.addEventListener, karty z listy `tabs`. */
function loadWorker(tabs: Win[], env: Record<string, unknown> = {}) {
  const on: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  const self = {
    location: { href: 'https://x.test/HyperQuant/sw.js?v=t', origin: 'https://x.test' },
    registration: { scope: 'https://x.test/HyperQuant/' },
    addEventListener: (k: string, fn: (e: unknown) => void) => (on[k] = fn),
    clients: { matchAll: async () => tabs, openWindow: async (u: string) => void opened.push(u) },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL, caches: {}, fetch, ...env });
  const click = async (data: unknown) => {
    let done: Promise<unknown> = Promise.resolve();
    on.notificationclick({ notification: { data, close: () => undefined }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return { click, opened, on };
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
    const w = loadWorker([tab('https://x.test/HyperQuant/#before', log), tab('https://x.test/HyperQuant/#charts?m=BTC&i=5m&v=candles', log)]);
    await w.click({ url: './#charts?m=ETH' });
    expect(log).toEqual(['focus https://x.test/HyperQuant/#charts?m=BTC&i=5m&v=candles', 'navigate ./#charts?m=ETH']);
    expect(w.opened).toEqual([]);
  });

  it('alarm z otwartej karty (bez rynku w powiadomieniu): sam focus, bez zmiany widoku', async () => {
    const log: string[] = [];
    await loadWorker([tab('https://x.test/HyperQuant/#before', log)]).click(undefined);
    expect(log).toEqual(['focus https://x.test/HyperQuant/#before']);
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

describe('pliki do pobrania z agents/ (OpenBot, .mcpb): zawsze z sieci, bez zapisu w cache', () => {
  /** Odpowiedź workera na żądanie przy podanej odpowiedzi sieci i starej kopii pliku w cache. */
  async function request(url: string, mode: string, net: () => Promise<unknown>) {
    const puts: string[] = [];
    const stale = { stale: true };
    const cache = { match: async () => stale, put: (k: string) => void puts.push(String(k)) };
    const w = loadWorker([], { caches: { open: async () => cache }, fetch: net });
    let res: unknown = 'bez przechwycenia';
    w.on.fetch({ request: { method: 'GET', url, mode }, respondWith: (p: unknown) => (res = p) });
    return { res: await res, puts };
  }
  const FILES = ['agents/openbot/desk.md', 'agents/openbot/desk/AGENTS.md', 'agents/openbot/hyperquant/SKILL.md', 'agents/openbot/hyperquant/assets/icon.png', 'agents/hyperquant.mcpb'];

  it('po wdrożeniu nowa wersja z sieci, nie stara kopia z cache; nic nie trafia do cache', async () => {
    for (const f of FILES) {
      const net = { type: 'basic', ok: true, body: `nowy ${f}`, clone: () => net };
      for (const mode of ['cors', 'no-cors', 'same-origin']) expect(await request(`https://x.test/HyperQuant/${f}`, mode, async () => net), `${f} ${mode}`).toEqual({ res: net, puts: [] });
      // Pobranie przez link z atrybutem download jako nawigacja: worker go nie przechwytuje
      expect(await request(`https://x.test/HyperQuant/${f}`, 'navigate', async () => net), f).toEqual({ res: 'bez przechwycenia', puts: [] });
    }
  });
});

describe('nawigacja do powłoki aplikacji', () => {
  const shell = { cached: 'index.html' };
  /** Odpowiedź workera na wejście w ./ przy podanej odpowiedzi sieci. */
  async function navigate(net: Record<string, unknown>) {
    const puts: string[] = [];
    const cache = { match: async (k: string) => (k === './index.html' ? shell : undefined), put: (k: string) => void puts.push(k) };
    const w = loadWorker([], { caches: { open: async () => cache }, fetch: async () => net });
    let res: unknown;
    w.on.fetch({ request: { method: 'GET', url: 'https://x.test/HyperQuant/', mode: 'navigate' }, respondWith: (p: unknown) => (res = p) });
    return { res: await res, puts };
  }

  it('zwykła odpowiedź: strona z sieci, zapis powłoki do cache', async () => {
    const net = { type: 'basic', ok: true, headers: { get: () => 'text/html' }, clone: () => net };
    expect(await navigate(net)).toEqual({ res: net, puts: ['./index.html'] });
  });

  it('przekierowanie po przeprowadzce domeny: zcache\'owana aplikacja (przenosi ustawienia), bez zapisu', async () => {
    expect(await navigate({ type: 'opaqueredirect', ok: false, headers: { get: () => null } })).toEqual({ res: shell, puts: [] });
  });
});
