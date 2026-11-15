#!/usr/bin/env node
// Nazwy rynków desku w plikach statycznych z jednej konfiguracji (src/config/deskMarkets.ts, projekt 60 M3–M4):
// opisy w index.html (title, meta, Open Graph, X, JSON-LD, noscript), manifest aplikacji i blok rynków w README.
//   node scripts/markets/sync.mjs          → zapisuje pliki
//   node scripts/markets/sync.mjs --check  → kod 1, gdy któryś plik nie zgadza się z konfiguracją (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESK_MARKETS, ENABLED_MARKETS, deskPhrase } from '../../src/config/deskMarkets.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Teksty zależne od listy rynków (po angielsku: index.html i manifest są po angielsku). */
export function texts(markets = ENABLED_MARKETS) {
  const en = deskPhrase('en', 'nom', markets);
  const keywords = ['Hyperliquid', ...markets.map((m) => m.label), 'order flow', 'footprint', 'delta', 'CVD', 'order book heatmap', 'day trading', 'trading lessons', 'BTC analysis'];
  return {
    title: `HyperQuant: order-flow desk for ${en} on Hyperliquid`,
    description: `Free day-trading desk for ${en} on Hyperliquid: live order-flow charts (footprint, delta, CVD, heatmap), lessons on real data and BTC analyses.`,
    keywords: [...new Set(keywords)].join(', '),
    ogDescription: `Free order-flow charts for ${en} from Hyperliquid (footprint, delta, CVD, order book heatmap, replay of a recorded day), lessons on real days and analyses written before the fact. No signals.`,
    twDescription: `Free order-flow charts for ${en} from Hyperliquid, lessons on real days and analyses written before the fact. No signals.`,
    imageAlt: `HyperQuant: free day-trading desk for ${en} on Hyperliquid, footprint on Charts`,
    name: 'HyperQuant — Hyperliquid Day Trading Desk',
    ldDescription: `Free, open day-trading desk for ${en} on Hyperliquid: live order-flow charts (footprint, delta, CVD, order book heatmap, replay of a recorded day), lessons on real data, BTC analyses and a verifiable forecast ledger. Preparation, session and review of the day. It does not generate signals.`,
    noscript: `Free day-trading desk for ${en} on Hyperliquid: live order-flow charts (footprint, delta, CVD, order book heatmap), lessons on real data, BTC analyses written before the fact and a verifiable forecast ledger: preparation, session and review of the day. No buy or sell signals.`,
    manifest: `Free day-trading desk for ${en} on Hyperliquid: preparation, session and review of the day on market data. It does not generate signals.`,
  };
}

/** index.html z opisami z konfiguracji; brak któregoś miejsca to błąd (zmieniony szablon strony). */
export function syncIndex(src, t = texts()) {
  const rules = [
    [/<title>[^<]*<\/title>/, `<title>${html(t.title)}</title>`],
    [/(<meta name="description" content=")[^"]*(")/, `$1${html(t.description)}$2`],
    [/(<meta name="keywords" content=")[^"]*(")/, `$1${html(t.keywords)}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${html(t.title)}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${html(t.ogDescription)}$2`],
    [/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${html(t.imageAlt)}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${html(t.title)}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${html(t.twDescription)}$2`],
    [/(<meta name="twitter:image:alt" content=")[^"]*(")/, `$1${html(t.imageAlt)}$2`],
    [/("@type": "WebApplication",\s*"name": )"[^"]*"/, `$1${JSON.stringify(t.name)}`],
    [/("url": "https:\/\/hyperquant\.tech\/",\s*"inLanguage": \["en", "pl"\],\s*"description": )"[^"]*"/, `$1${JSON.stringify(t.ldDescription)}`],
    [/(<noscript>[\s\S]*?<h1[^>]*>)[^<]*(<\/h1>\s*<p[^>]*>\s*)[^<]*?(\s*<\/p>)/, `$1${html(t.name)}$2${html(t.noscript)}$3`],
  ];
  let out = src;
  for (const [re, rep] of rules) {
    if (!re.test(out)) throw new Error(`index.html: nie znaleziono miejsca ${re}`);
    out = out.replace(re, rep);
  }
  return out;
}

export function syncManifest(src, t = texts()) {
  // Tylko pola nazwy i opisu na górze pliku (pierwsze wystąpienia), bez przeformatowania reszty
  let out = src.replace(/^(  "name": )"[^"]*"/m, (_, k) => k + JSON.stringify(t.name));
  out = out.replace(/^(  "description": )"[^"]*"/m, (_, k) => k + JSON.stringify(t.manifest));
  JSON.parse(out);
  return out;
}

const START = '<!-- rynki:start -->';
const END = '<!-- rynki:end -->';
const CAL = { crypto: 'none, 24/7', cme: 'CME (metals): Sun 18:00 – Fri 17:00 ET, daily break 17:00–18:00 ET', 'nyse+cme': 'NYSE 09:30–16:00 ET (index), CME futures outside it', ice: 'ICE (Brent futures)' };

/** Blok README: tabela rynków desku z konfiguracji. */
export function readmeBlock(markets = DESK_MARKETS) {
  const rows = markets
    .filter((m) => m.enabled)
    .map((m) => {
      const data = m.scanner === 'full' ? 'candles, tape, book, liquidation map and tape, cohorts, trapped positions, forecast ledger, blog maps, exchange panels' : 'candles, tape, book and the indicators built on them; outside the underlying hours the price is set by the platform';
      return `| ${m.full.en} | \`${m.coin}\` | ${m.dex ? 'HIP-3 (trade.xyz)' : 'main'} | ${m.underlying.ref.en} | ${CAL[m.underlying.calendar]} | ${data} |`;
    });
  return [START, '| Market | Hyperliquid | Exchange | Oracle / underlying | Underlying hours | Data on the desk |', '| --- | --- | --- | --- | --- | --- |', ...rows, END].join('\n');
}

export function syncReadme(src) {
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error(`README.md: brak bloku ${START} … ${END}`);
  const title = `# HyperQuant — order-flow day-trading desk for ${deskPhrase('en')} on Hyperliquid`;
  return (src.slice(0, a) + readmeBlock() + src.slice(b + END.length)).replace(/^# .*$/m, title);
}

const FILES = [
  ['index.html', syncIndex],
  ['public/manifest.webmanifest', syncManifest],
  ['README.md', syncReadme],
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [file, sync] of FILES) {
    const p = path.join(ROOT, file);
    const before = readFileSync(p, 'utf8');
    const after = sync(before);
    if (after === before) continue;
    if (check) stale.push(file);
    else writeFileSync(p, after);
  }
  if (check && stale.length) {
    console.error(`Nazwy rynków niezgodne z src/config/deskMarkets.ts: ${stale.join(', ')}. Uruchom: node scripts/markets/sync.mjs`);
    process.exit(1);
  }
  console.log(check ? 'Rynki: pliki zgodne z konfiguracją' : 'Rynki: pliki zaktualizowane');
}
