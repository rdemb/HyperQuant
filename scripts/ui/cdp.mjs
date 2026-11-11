// Minimalny klient Chrome DevTools Protocol (bez zależności): Chrome bez okna, jedna karta, ekran komputera albo telefonu.
// Używa globalnego WebSocket z Node 22+.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function chromePath() {
  const p = CHROME_PATHS.find((x) => fs.existsSync(x));
  if (!p) throw new Error('Nie znaleziono Chrome — ustaw CHROME_PATH');
  return p;
}

/**
 * Przeglądarka z jedną kartą; `init` — skrypty wykonywane w każdym nowym dokumencie przed skryptami strony. `intercept` —
 * każde żądanie strony przechodzi przez tę funkcję: `{ status, body, type }` — odpowiedź bez sieci, `'continue'` — zwykłe
 * żądanie, `'fail'` — błąd sieci. `timezone` i `locale` — stała strefa i język strony.
 */
export async function launch({ port = 9338, lang = 'pl', init = [], intercept = null, timezone = null, locale = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ui-'));
  // Linux w CI (kontener bez przestrzeni nazw użytkownika): bez piaskownicy i bez małego /dev/shm
  const ci = process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const proc = spawn(chromePath(), ['--headless=new', ...ci, `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--lang=${lang}`, `--accept-lang=${lang}`, '--no-first-run', '--hide-scrollbars', '--font-render-hinting=none', 'about:blank'], {
    stdio: 'ignore',
  });
  let targets = [];
  for (let i = 0; i < 80 && targets.length === 0; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');
    } catch {
      // Chrome jeszcze startuje
    }
    if (targets.length === 0) await sleep(250);
  }
  if (targets.length === 0) throw new Error('Chrome nie wystartował');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else if (d.method === 'Fetch.requestPaused') void onPaused(d.params);
    else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const intercepted = { served: 0, failed: [], passed: 0 };
  async function onPaused(p) {
    let r;
    try {
      r = intercept(p.request);
    } catch (e) {
      r = 'fail';
    }
    if (r === 'continue') {
      intercepted.passed++;
      return send('Fetch.continueRequest', { requestId: p.requestId });
    }
    if (r === 'fail' || !r) {
      intercepted.failed.push(p.request.url.slice(0, 80));
      return send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' });
    }
    intercepted.served++;
    const headers = [
      { name: 'Content-Type', value: r.type ?? 'application/json' },
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Headers', value: '*' },
      { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
    ];
    return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: r.status ?? 200, responseHeaders: headers, body: Buffer.from(r.body ?? '').toString('base64') });
  }
  await send('Runtime.enable');
  await send('Page.enable');
  for (const src of [init].flat().filter(Boolean)) await send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  if (timezone) await send('Emulation.setTimezoneOverride', { timezoneId: timezone });
  if (locale) await send('Emulation.setLocaleOverride', { locale });
  if (intercept) await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

  const page = {
    errors,
    intercepted,
    send,
    async viewport(w, h, mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile, screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 });
      // Ekran dotykowy telefonu (zapytania CSS pointer i hover)
      await send('Emulation.setEmulatedMedia', { features: mobile ? [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] : [] });
    },
    async go(url, wait = 0) {
      await send('Page.navigate', { url });
      await sleep(wait);
    },
    /** Wynik wyrażenia JS w stronie (wartości przez JSON; wyjątek — obiekt z `error`). */
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
      return r.result?.result?.value;
    },
    async waitFor(expr, ms = 20000, step = 250) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const v = await page.ev(expr);
        if (v && !v.error) return v;
        await sleep(step);
      }
      return null;
    },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    },
    async key(key, { code, alt = false, shift = false } = {}) {
      const modifiers = (alt ? 1 : 0) | (shift ? 8 : 0);
      const text = key.length === 1 ? key : undefined;
      const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Escape: 27, End: 35, ArrowUp: 38, ArrowDown: 40, Enter: 13, Tab: 9 }[key];
      const base = { key, code: code ?? (key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key), modifiers, windowsVirtualKeyCode: vk };
      await send('Input.dispatchKeyEvent', { type: text && !alt ? 'keyDown' : 'rawKeyDown', ...base, text: alt ? undefined : text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    async tap(x, y) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async mouseAway() {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    },
    close() {
      try {
        ws.close();
      } catch {
        // już zamknięte
      }
      proc.kill();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Chrome trzyma jeszcze pliki — katalog tymczasowy zostaje
      }
    },
  };
  return page;
}
