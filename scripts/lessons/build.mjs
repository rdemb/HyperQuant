#!/usr/bin/env node
// Dane ćwiczeń zakładki Lekcje (public/lessons/<id>.json): wycinki prawdziwego rynku BTC z publicznego repozytorium
// danych desku. Świece od północy UTC (kotwica VWAP dnia) do końca okna, szczyt i dołek dnia poprzedniego ze świec
// dziennych, a tam, gdzie desk nagrywał taśmę: delta agresorów, open interest, likwidacje i footprint.
// Wskaźniki (VWAP, profil, IB) liczy strona tymi samymi funkcjami co Wykresy, więc tu są tylko surowe dane.
// Użycie: node scripts/lessons/build.mjs [--source <url|katalog>] [--only <id>]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_SOURCE, decodeTape, footprint, mergeSpans, openSource, parseCandles, rollup, tapeBars } from '../blog/chartdata.mjs';

export const LESSONS_VERSION = 1;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const OUT_DIR = 'public/lessons';

/** Wycinki: okno widoku [from, to), interwał świec w minutach, taśma (delta, OI, likwidacje) i footprint. */
export const SLICES = [
  { id: '2026-10-20-ny', from: '2026-10-20T10:00Z', to: '2026-10-20T21:00Z', tf: 5 },
  { id: '2026-10-21-trend', from: '2026-10-21T05:00Z', to: '2026-10-21T22:00Z', tf: 15 },
  { id: '2026-10-22-trend', from: '2026-10-22T00:00Z', to: '2026-10-22T19:00Z', tf: 15 },
  { id: '2026-10-23-balance', from: '2026-10-23T06:00Z', to: '2026-10-23T21:00Z', tf: 5 },
  { id: '2026-10-24-cascade', from: '2026-10-24T12:00Z', to: '2026-10-24T21:30Z', tf: 5, tape: true },
  { id: '2026-10-24-footprint', from: '2026-10-24T18:00Z', to: '2026-10-24T21:30Z', tf: 15, tape: true, fp: true },
];

const pad = (x) => String(x).padStart(2, '0');
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const round = (x, k = 2) => Math.round(x * 10 ** k) / 10 ** k;
const floorTo = (x, step) => Math.floor(x / step) * step;

/** Open interest na końcu ostatniej minuty przed `t`; brak → null. */
function oiBefore(ctx, t) {
  let v = null;
  for (const c of ctx) {
    if (c.t >= t) break;
    v = c.oi;
  }
  return v;
}

/** Jeden wycinek: same liczby z archiwum i taśmy, bez wskaźników. */
export async function buildSlice(spec, get) {
  const from = Date.parse(spec.from);
  const to = Date.parse(spec.to);
  const tf = spec.tf * MIN;
  const dayStart = floorTo(from, DAY);
  const text = async (branch, rel) => (await get(branch, rel))?.toString('utf8') ?? null;
  const json = async (branch, rel) => {
    const b = await get(branch, rel);
    return b ? JSON.parse(rel.endsWith('.gz') ? gunzipSync(b).toString('utf8') : b.toString('utf8')) : null;
  };

  const minute = [];
  for (let d = dayStart; d < to; d += DAY) {
    const csv = await text('archive', `BTC/1m/${dayKey(d).slice(0, 4)}/${dayKey(d).slice(5)}.csv`);
    if (csv) minute.push(...parseCandles(csv).filter((c) => c.t >= dayStart && c.t < to));
  }

  // Szczyt i dołek dnia poprzedniego ze świec dziennych (jak poziomy dnia na Wykresach)
  const years = [...new Set([dayStart - DAY, to - 1].map((t) => new Date(t).getUTCFullYear()))];
  const daily = [];
  for (const y of years) {
    const csv = await text('archive', `BTC/1d/${y}.csv`);
    if (csv) daily.push(...parseCandles(csv));
  }
  const levels = [];
  for (let d = dayStart; d < to; d += DAY) {
    const prev = daily.find((c) => c.t === d - DAY);
    const cur = daily.find((c) => c.t === d);
    if (prev) levels.push({ t: d, open: cur?.o ?? null, pdh: prev.h, pdl: prev.l });
  }

  let trades = [];
  let ctx = [];
  let spans = [];
  if (spec.tape) {
    const index = await json('history', 'index.json');
    const m = index?.markets?.BTC ?? { hours: [], parts: [] };
    const files = [
      ...m.hours.filter((h) => h + HOUR > dayStart && h < to).map((h) => `BTC/${dayKey(h)}/${pad(new Date(h).getUTCHours())}.trades.json.gz`),
      ...m.parts
        .filter((p) => p >= dayStart && p < to && !m.hours.includes(floorTo(p, HOUR)))
        .map((p) => `BTC/${dayKey(p)}/${pad(new Date(p).getUTCHours())}-${pad(new Date(p).getUTCMinutes())}.trades.json.gz`),
    ];
    for (const f of files) {
      const tape = decodeTape(await json('history', f));
      if (!tape) continue;
      trades.push(...tape.trades.filter((x) => x.t < to));
      ctx.push(...tape.ctx.filter((c) => c.t < to));
      spans.push(...tape.spans);
    }
    trades.sort((a, b) => a.t - b.t);
    ctx.sort((a, b) => a.t - b.t);
    spans = mergeSpans(spans);
  }
  const covered = (t, len) => spans.some(([a, b]) => a <= t && b >= t + len);

  // Świece interwału: z taśmy, gdy w całości nagrana (z deltą), inaczej z archiwum minutowego
  const tapeQ = tapeBars(trades, tf);
  const archQ = rollup(minute, tf);
  const candles = [];
  for (let t = dayStart; t < to; t += tf) {
    const q = covered(t, tf) ? tapeQ.get(t) : null;
    const b = q ?? archQ.get(t);
    if (b) candles.push([t, b.o, b.h, b.l, b.c, round(b.v), q ? round(q.buy) : null, q ? round(q.sell) : null]);
  }
  if (candles.length < 2) throw new Error(`${spec.id}: za mało świec (${candles.length})`);

  const out = {
    v: LESSONS_VERSION,
    id: spec.id,
    coin: 'BTC',
    tf: spec.tf,
    from,
    to,
    dayStart,
    candles,
    levels,
    tape: spans.filter(([a, b]) => b > dayStart && a < to).map(([a, b]) => [Math.max(a, dayStart), Math.min(b, to)]),
  };
  if (spec.tape) {
    const oi = [];
    for (let t = dayStart; t < to; t += tf) {
      const v = covered(t, tf) ? oiBefore(ctx, t + tf) : null;
      if (v !== null) oi.push([t, round(v, 1)]);
    }
    out.oi = oi;
    // Likwidacje z publicznej taśmy likwidacji desku (kubełki 5 min), w mln USD na świecę
    const liqTape = await json('main', 'liq-tape/BTC.json');
    const liq = new Map();
    for (const b of liqTape?.buckets ?? []) {
      if (b.t < dayStart || b.t >= to) continue;
      const t = floorTo(b.t, tf);
      const x = liq.get(t) ?? [t, 0, 0];
      x[1] += b.longUsd / 1e6;
      x[2] += b.shortUsd / 1e6;
      liq.set(t, x);
    }
    out.liq = [...liq.values()].sort((a, b) => a[0] - b[0]).map(([t, l, s]) => [t, round(l), round(s)]);
  }
  if (spec.fp) out.fp = footprint(trades, ctx, from, covered, Math.round((to - from) / tf), tf);
  return out;
}

async function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  const get = openSource(arg('--source') ?? DEFAULT_SOURCE);
  const only = arg('--only');
  await mkdir(OUT_DIR, { recursive: true });
  for (const spec of SLICES.filter((s) => !only || s.id === only)) {
    const data = await buildSlice(spec, get);
    const file = path.join(OUT_DIR, `${spec.id}.json`);
    await writeFile(file, `${JSON.stringify(data)}\n`);
    const withTape = data.candles.filter((c) => c[6] !== null).length;
    console.log(`${file}: ${data.candles.length} świec (${withTape} z taśmą)${data.fp ? `, footprint ${data.fp.bars.length} świec co ${data.fp.step} USD` : ''}`);
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
