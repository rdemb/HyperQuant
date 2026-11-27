#!/usr/bin/env node
// Zrzuty ekranu do README (docs/media/*.webp): zbudowana strona (`vite preview`) w Chrome bez okna (CDP, scripts/ui/cdp.mjs),
// prawdziwe dane z Hyperliquid i z repo danych skanera, ciemny motyw, angielski interfejs, gęstość pikseli 2× (telefon 3×).
// Z kadru wykresu powstaje też obrazek podglądu repo na GitHubie (docs/media/social-preview.png, Settings → Social preview).
// Wymaga buildu z adresem danych skanera (bez niego nie ma mapy likwidacji, historii taśmy ani kohort):
//   VITE_DATA_BASE_URL=https://raw.githubusercontent.com/rdemb/hyperquant-data/main npm run build
// Użycie: node scripts/readme/shots.mjs [--only chart,today] [--port 4410]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ogSvg, renderPng } from '../blog/og.mjs';
import { launch, sleep } from '../ui/cdp.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = Number(opt('port', '4410'));
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.resolve('docs/media');
const ONLY = opt('only', '').split(',').filter(Boolean);

/** Stan powracającego użytkownika: ciemny motyw, angielski, przewodnik zakończony, dok Załogi zwinięty w rogu. */
const SEED = `try {
  localStorage.setItem('hq.theme', 'dark');
  localStorage.setItem('hq.lang', 'en');
  localStorage.setItem('hq.onboarding.v1', JSON.stringify({ firstAt: Date.now() - 8 * 864e5, done: true }));
  localStorage.setItem('hq.wyspa.dok.v1', JSON.stringify({ x: 1, y: 1, zwiniety: true }));
} catch (e) {}`;

const DESKTOP = { width: 1600, height: 1000, scale: 2, mobile: false };
const PHONE = { width: 390, height: 844, scale: 3, mobile: true };

/** Ujęcia: `zoom` — liczba kroków kółka myszy nad wykresem (przybliżenie ostatnich godzin sesji). */
const SHOTS = [
  { name: 'chart', hash: '#charts?m=BTC&i=15m&v=footprint', screen: DESKTOP, wait: 20_000, zoom: 4, social: true },
  { name: 'today', hash: '#dzis', screen: DESKTOP, wait: 12_000 },
  { name: 'pre-session', hash: '#before', screen: DESKTOP, wait: 18_000 },
  { name: 'day-review', hash: '#after', screen: DESKTOP, wait: 18_000 },
  { name: 'order-flow', hash: '#orderflow', screen: DESKTOP, wait: 15_000 },
  { name: 'lessons', hash: '#lessons', screen: DESKTOP, wait: 10_000 },
  { name: 'phone-chart', hash: '#charts?m=BTC&i=15m&v=candles', screen: PHONE, wait: 18_000 },
];

const up = async () => {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
};

async function serve() {
  if (!fs.existsSync(path.resolve('dist/index.html'))) throw new Error('Brak dist/ — najpierw zbuduj stronę (komentarz na początku pliku)');
  const proc = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  if (!(await up())) throw new Error('vite preview nie wystartował');
  return proc;
}

/** Kółko myszy nad środkiem największego płótna (pole świec wykresu). */
async function zoomChart(page, steps) {
  const box = await page.ev(`(() => {
    const c = [...document.querySelectorAll('canvas')].map((e) => e.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return c ? { x: c.left + c.width * 0.7, y: c.top + c.height * 0.5 } : null;
  })()`);
  if (!box) return;
  for (let i = 0; i < steps; i++) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -120 });
    await sleep(150);
  }
  await page.mouseAway();
  await sleep(1500);
}

/** Karta 1200×630 w oprawie kart Open Graph strony (scripts/blog/og.mjs) z wycinkiem pola świec po prawej. */
async function socialPreview(page, { width, height, scale }) {
  const r = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  const card = {
    section: 'Open source',
    title: 'Order-flow desk for Hyperliquid',
    subtitle: 'BTC, gold and the S&P 500: footprint, heatmap, CVD, liquidations',
    shot: { href: `data:image/jpeg;base64,${r.result.data}`, w: width * scale, h: height * scale, crop: [320 * scale, 150 * scale, 780 * scale, 710 * scale] },
    foot: ['github.com/rdemb/HyperQuant', 'open data · no recommendations'],
  };
  const file = path.join(OUT, 'social-preview.png');
  fs.writeFileSync(file, renderPng(ogSvg(card)));
  console.log(`${path.relative(process.cwd(), file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

async function shoot(page, s) {
  const { width, height, scale, mobile } = s.screen;
  await page.viewport(width, height, mobile);
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  // Pełne przeładowanie: ustawienia wykresu z linku są czytane tylko przy starcie widoku
  await page.go('about:blank', 200);
  await page.go(`${BASE}${s.hash}`, s.wait);
  if (s.zoom) await zoomChart(page, s.zoom);
  const r = await page.send('Page.captureScreenshot', { format: 'webp', quality: 90 });
  const file = path.join(OUT, `${s.name}.webp`);
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log(`${path.relative(process.cwd(), file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  if (s.social) await socialPreview(page, s.screen);
}

const server = await serve();
const page = await launch({ port: 9348, lang: 'en', init: SEED, timezone: 'UTC', locale: 'en-GB' });
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SHOTS.filter((x) => ONLY.length === 0 || ONLY.includes(x.name))) await shoot(page, s);
} finally {
  page.close();
  server.kill();
}
