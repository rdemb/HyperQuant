#!/usr/bin/env node
// Dane do wykresów wpisu (content/blog/<id>/wykresy.json) z publicznego repozytorium danych desku: świece 15 min z deltą
// agresorów, VWAP dnia i tygodnia, profil wolumenu, open interest, likwidacje i footprint wybranego miejsca.
// Użycie:
//   node scripts/blog/chartdata.mjs --at 2026-10-25T06:00Z --out content/blog/<id>/wykresy.json [--fp 2026-10-25T04:00Z] [--source <url|katalog>]
//   node scripts/blog/chartdata.mjs --notka --at 2026-10-25T12:00Z --out content/blog/<id>/wykresy.json   (6 godzin, świece 5 min, bez footprintu)
// Na wyjściu standardowym: odczyt wykresu (liczby do tekstu analizy), te same, z których powstaje rysunek.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { diagonalImbalances } from './charts.mjs';

export const CHARTS_VERSION = 1;
export const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/rdemb/hyperquant-data';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const TF = 15 * MIN;
export const SESSION_BARS = 96;
export const FP_BARS = 8;
// Notka: krótsze okno w świecach 5 min, bez footprintu
export const NOTE_TF = 5 * MIN;
export const NOTE_BARS = 72;
const FP_MAX_ROWS = 26;
const FP_STEPS = [5, 10, 20, 25, 50, 100, 250];
const PROFILE_STEP = 25;
const VALUE_SHARE = 0.7;
// Krótkie przerwy w nagraniu (ponowne połączenie) nie psują delty świecy 15 min
const SPAN_GAP_MS = 30_000;

const pad = (x) => String(x).padStart(2, '0');
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const round = (x, k = 2) => Math.round(x * 10 ** k) / 10 ** k;
const floorTo = (x, step) => Math.floor(x / step) * step;

/** Źródło plików: adres repozytorium (gałąź/ścieżka) albo katalog z tym samym układem; brak pliku → null. */
export function openSource(base = DEFAULT_SOURCE) {
  const remote = /^https:\/\//.test(base);
  return async (branch, rel) => {
    if (remote) {
      const res = await fetch(`${base}/${branch}/${rel}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${branch}/${rel}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    try {
      return await readFile(path.join(base, branch, rel));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
}

/** Świece 1 min z archiwum (CSV t,o,h,l,c,v,n). */
export function parseCandles(csv) {
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(',').map(Number))
    .filter((r) => r.length >= 6 && r.every(Number.isFinite))
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
}

const undelta = (xs) => {
  let acc = 0;
  return xs.map((x, i) => (acc = i === 0 ? x : acc + x));
};

/** Plik taśmy (format src/utils/tapeHistory.ts): transakcje { t, px, sz, buy } i kontekst minutowy { t, oi }. */
export function decodeTape(raw) {
  const f = raw;
  if (!f || f.v !== 1 || !Array.isArray(f.t) || typeof f.side !== 'string' || f.side.length !== f.t.length) return null;
  const t = undelta(f.t);
  const trades = [];
  for (let i = 0; i < t.length; i++)
    if (f.px[i] > 0 && f.sz[i] > 0)
      trades.push({
        t: t[i],
        px: f.px[i],
        sz: f.sz[i],
        buy: f.side[i] === 'B',
      });
  const ctx = (f.ctx?.t ?? []).map((tt, i) => ({ t: tt, oi: f.ctx.oi[i] }));
  return { spans: (f.spans ?? []).filter((s) => s[1] > s[0]), trades, ctx };
}

/** Świece o interwale `tf` z transakcji: OHLC, wolumen, kupno i sprzedaż agresorów (BTC). */
export function tapeBars(trades, tf) {
  const out = new Map();
  for (const x of trades) {
    const t = floorTo(x.t, tf);
    let b = out.get(t);
    if (!b) out.set(t, (b = { t, o: x.px, h: x.px, l: x.px, c: x.px, v: 0, buy: 0, sell: 0 }));
    b.h = Math.max(b.h, x.px);
    b.l = Math.min(b.l, x.px);
    b.c = x.px;
    b.v += x.sz;
    if (x.buy) b.buy += x.sz;
    else b.sell += x.sz;
  }
  return out;
}

/** Świece 1 min sklejone w interwał `tf` (bez delty). */
export function rollup(candles, tf) {
  const out = new Map();
  for (const c of candles) {
    const t = floorTo(c.t, tf);
    const b = out.get(t);
    if (!b) out.set(t, { t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    else
      Object.assign(b, {
        h: Math.max(b.h, c.h),
        l: Math.min(b.l, c.l),
        c: c.c,
        v: b.v + c.v,
      });
  }
  return out;
}

/** VWAP zakotwiczony w `anchor` z odchyleniem ważonym wolumenem, próbkowany na końcu każdego interwału `tf`. */
export function anchoredVwap(candles, anchor, tf) {
  let pv = 0;
  let pv2 = 0;
  let vol = 0;
  const out = [];
  for (const c of candles) {
    if (c.t < anchor || c.v <= 0) continue;
    const tp = (c.h + c.l + c.c) / 3;
    pv += tp * c.v;
    pv2 += tp * tp * c.v;
    vol += c.v;
    const end = c.t + MIN;
    if (end % tf === 0) {
      const vw = pv / vol;
      out.push([end - tf, round(vw, 1), round(Math.sqrt(Math.max(0, pv2 / vol - vw * vw)), 1)]);
    }
  }
  return out;
}

/** Profil wolumenu ze świec 1 min (wolumen rozłożony równo na zakres świecy), POC i obszar wartości 70%. */
export function volumeProfile(candles, step = PROFILE_STEP) {
  const lo = floorTo(Math.min(...candles.map((c) => c.l)), step);
  const hi = floorTo(Math.max(...candles.map((c) => c.h)), step);
  const vol = new Array((hi - lo) / step + 1).fill(0);
  for (const c of candles) {
    const a = (floorTo(c.l, step) - lo) / step;
    const b = (floorTo(c.h, step) - lo) / step;
    for (let i = a; i <= b; i++) vol[i] += c.v / (b - a + 1);
  }
  let poc = 0;
  for (let i = 1; i < vol.length; i++) if (vol[i] > vol[poc]) poc = i;
  const total = vol.reduce((s, v) => s + v, 0);
  let [a, b] = [poc, poc];
  let acc = vol[poc];
  while (acc < total * VALUE_SHARE && (a > 0 || b < vol.length - 1)) {
    const up = b < vol.length - 1 ? vol[b + 1] : -1;
    const down = a > 0 ? vol[a - 1] : -1;
    if (up >= down) acc += vol[++b];
    else acc += vol[--a];
  }
  return {
    step,
    from: lo,
    vol: vol.map((v) => round(v, 1)),
    poc: lo + poc * step,
    val: lo + a * step,
    vah: lo + b * step + step,
  };
}

const pickStep = (range) => FP_STEPS.find((s) => range / s <= FP_MAX_ROWS) ?? FP_STEPS.at(-1);

/** Odcinki nagrania scalone, gdy przerwa między nimi nie przekracza `gap`. */
export function mergeSpans(spans, gap = SPAN_GAP_MS) {
  const out = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Open interest na końcu minuty przed chwilą `t` (kontekst minutowy taśmy); brak → null. */
const oiBefore = (ctx, t) => {
  let v = null;
  for (const c of ctx) {
    if (c.t >= t) break;
    v = c.oi;
  }
  return v;
};

/**
 * Footprint: `n` świec `tf` od `from` (tylko świece w pełni nagrane), wolumen sprzedaży i kupna agresorów w przedziałach
 * ceny `step` oraz zmiana open interest w świecy.
 */
export function footprint(trades, ctx, from, covered, n = FP_BARS, tf = TF) {
  const to = from + n * tf;
  const xs = trades.filter((x) => x.t >= from && x.t < to && covered(floorTo(x.t, tf), tf));
  if (!xs.length) return null;
  const step = pickStep(Math.max(...xs.map((x) => x.px)) - Math.min(...xs.map((x) => x.px)));
  const bars = [...tapeBars(xs, tf).values()].map((b) => {
    const cells = new Map();
    for (const x of xs) {
      if (floorTo(x.t, tf) !== b.t) continue;
      const p = floorTo(x.px, step);
      const cell = cells.get(p) ?? [p, 0, 0];
      cell[x.buy ? 2 : 1] += x.sz;
      cells.set(p, cell);
    }
    const oi0 = oiBefore(ctx, b.t);
    const oi1 = oiBefore(ctx, b.t + tf);
    return {
      t: b.t,
      ohlc: [b.o, b.h, b.l, b.c],
      oi: oi0 !== null && oi1 !== null ? round(oi1 - oi0, 1) : null,
      cells: [...cells.values()].sort((x, y) => y[0] - x[0]).map(([p, s, k]) => [p, round(s), round(k)]),
    };
  });
  return { tf: tf / MIN, step, bars: bars.sort((x, y) => x.t - y.t) };
}

/** Dane wykresów wpisu na chwilę `at` (koniec ostatniej pełnej świecy); `note` = krótkie okno notki bez footprintu. */
export async function buildCharts({ at, fpFrom = null, get, note = false }) {
  const bar = note ? NOTE_TF : TF;
  const end = floorTo(at, bar);
  const from = end - (note ? NOTE_BARS : SESSION_BARS) * bar;
  const json = async (branch, rel) => {
    const b = await get(branch, rel);
    return b ? JSON.parse(rel.endsWith('.gz') ? gunzipSync(b).toString('utf8') : b.toString('utf8')) : null;
  };

  // Świece 1 min z archiwum: wczoraj (szczyt i dołek dnia), dziś i okno wykresu
  const days = [...new Set([from - DAY, from, end - 1].map(dayKey))];
  const minute = [];
  for (const d of days) {
    const buf = await get('archive', `BTC/1m/${d.slice(0, 4)}/${d.slice(5)}.csv`);
    if (buf) minute.push(...parseCandles(buf.toString('utf8')));
  }

  // Taśma z serwera: pliki godzinowe i części bieżącej godziny w oknie
  const index = await json('history', 'index.json');
  const m = index?.markets?.BTC ?? { hours: [], parts: [] };
  const files = [
    ...m.hours.filter((h) => h + HOUR > from && h < end).map((h) => `BTC/${dayKey(h)}/${pad(new Date(h).getUTCHours())}.trades.json.gz`),
    ...m.parts
      .filter((p) => p >= from && p < end && !m.hours.includes(floorTo(p, HOUR)))
      .map((p) => `BTC/${dayKey(p)}/${pad(new Date(p).getUTCHours())}-${pad(new Date(p).getUTCMinutes())}.trades.json.gz`),
  ];
  const trades = [];
  const ctx = [];
  const spans = [];
  for (const f of files) {
    const tape = decodeTape(await json('history', f));
    if (!tape) continue;
    trades.push(...tape.trades.filter((x) => x.t >= from && x.t < end));
    ctx.push(...tape.ctx.filter((c) => c.t >= from && c.t < end));
    spans.push(...tape.spans);
  }
  trades.sort((a, b) => a.t - b.t);
  ctx.sort((a, b) => a.t - b.t);
  const merged = mergeSpans(spans);
  const covered = (t, tf) => merged.some(([a, b]) => a <= t && b >= t + tf);

  // Minuty z taśmy uzupełniają archiwum (archiwum dochodzi z opóźnieniem)
  const byMinute = new Map(minute.map((c) => [c.t, c]));
  for (const [t, b] of tapeBars(trades, MIN)) if (!byMinute.has(t) && covered(t, MIN)) byMinute.set(t, b);
  const ones = [...byMinute.values()].filter((c) => c.t < end).sort((a, b) => a.t - b.t);
  const inWindow = ones.filter((c) => c.t >= from);

  const tapeQ = tapeBars(trades, bar);
  const archQ = rollup(inWindow, bar);
  const candles = [];
  for (let t = from; t < end; t += bar) {
    const q = covered(t, bar) ? tapeQ.get(t) : null;
    const a = archQ.get(t);
    const b = q ?? a;
    if (!b) continue;
    candles.push([t, b.o, b.h, b.l, b.c, round(b.v), q ? round(q.buy) : null, q ? round(q.sell) : null]);
  }
  if (candles.length < 2) {
    const iso = (t) => new Date(t).toISOString();
    throw new Error(`Za mało świec w oknie ${iso(from)} – ${iso(end)} (${candles.length}): --at w przyszłości albo brak danych w archiwum i na taśmie`);
  }

  const oi = [];
  for (let t = from; t < end; t += bar) {
    const v = covered(t, bar) ? oiBefore(ctx, t + bar) : null;
    if (v !== null) oi.push([t, round(v, 1)]);
  }

  const liqTape = await json('main', 'liq-tape/BTC.json');
  const liqQ = new Map();
  for (const b of liqTape?.buckets ?? []) {
    if (b.t < from || b.t >= end) continue;
    const t = floorTo(b.t, bar);
    const x = liqQ.get(t) ?? [t, 0, 0];
    x[1] += b.longUsd / 1e6;
    x[2] += b.shortUsd / 1e6;
    liqQ.set(t, x);
  }
  const liq = [...liqQ.values()].sort((a, b) => a[0] - b[0]).map(([t, l, s]) => [t, round(l), round(s)]);

  const dayStart = floorTo(end - 1, DAY);
  const prev = ones.filter((c) => c.t >= dayStart - DAY && c.t < dayStart);
  const levels = prev.length
    ? [
        { label: 'PDH', price: Math.max(...prev.map((c) => c.h)) },
        { label: 'PDL', price: Math.min(...prev.map((c) => c.l)) },
      ]
    : [];

  const fpStart = fpFrom === null ? end - FP_BARS * TF : floorTo(fpFrom, TF);
  return {
    v: CHARTS_VERSION,
    coin: 'BTC',
    at: end,
    session: {
      tf: bar / MIN,
      from,
      to: end,
      tape: merged.filter(([a, b]) => b > from && a < end).map(([a, b]) => [Math.max(a, from), Math.min(b, end)]),
      candles,
      // VWAP dnia UTC: od północy UTC (dzień poprzedni bez VWAP, żeby nie mieszać dwóch kotwic na jednym wykresie)
      vwap: anchoredVwap(ones, dayStart, bar),
      dayStart,
      profile: volumeProfile(inWindow),
      levels,
      oi,
      liq,
    },
    footprint: trades.length && !note ? footprint(trades, ctx, fpStart, covered) : null,
  };
}

// ───────────────────────── Odczyt wykresu ─────────────────────────

const sum = (xs) => xs.reduce((s, x) => s + x, 0);

/** Fakty z wykresu do tekstu analizy: wartość, VWAP, delta i CVD, OI, likwidacje, footprint (te same liczby co rysunek). */
export function readCharts(d) {
  const s = d.session;
  const last = s.candles.at(-1);
  const px = last[4];
  const vw = s.vwap.at(-1);
  const withTape = s.candles.filter((c) => c[6] !== null);
  const perH = 60 / s.tf;
  const deltaH = (h) => round(sum(withTape.slice(-h * perH).map((c) => c[6] - c[7])), 1);
  const priceH = (h) => (withTape.length >= h * perH ? round(px - withTape.at(-h * perH)[1], 0) : null);
  const oiH = (h) => (s.oi.length > h * perH ? round(s.oi.at(-1)[1] - s.oi.at(-1 - h * perH)[1], 1) : null);
  const hi = Math.max(...s.candles.map((c) => c[2]));
  const lo = Math.min(...s.candles.map((c) => c[3]));
  const hours = Math.round((s.to - s.from) / HOUR);
  const out = {
    cena: px,
    [`zakres${hours}h`]: {
      max: hi,
      min: lo,
      maxAt: new Date(s.candles.find((c) => c[2] === hi)[0]).toISOString(),
      minAt: new Date(s.candles.find((c) => c[3] === lo)[0]).toISOString(),
    },
    // Notka (krótkie okno) nie rysuje profilu, więc odczyt nie podaje POC ani obszaru wartości
    wartosc:
      hours > 8
        ? {
            poc: s.profile.poc,
            vah: s.profile.vah,
            val: s.profile.val,
            cenaWzgledemWartosci: px > s.profile.vah ? 'nad' : px < s.profile.val ? 'pod' : 'w środku',
          }
        : undefined,
    vwapDnia: vw
      ? {
          vwap: vw[1],
          sigma: vw[2],
          odlegloscSigma: round((px - vw[1]) / (vw[2] || 1), 2),
        }
      : null,
    poziomy: s.levels,
    tasma: s.tape.map(([a, b]) => `${new Date(a).toISOString()} – ${new Date(b).toISOString()}`),
    delta: { h1: deltaH(1), h4: deltaH(4), cala: deltaH(withTape.length / perH) },
    cena1h: priceH(1),
    cena4h: priceH(4),
    oi: s.oi.length ? { teraz: s.oi.at(-1)[1], zmiana1h: oiH(1), zmiana4h: oiH(4) } : null,
    likwidacje: {
      longi: round(sum(s.liq.map((x) => x[1])), 1),
      shorty: round(sum(s.liq.map((x) => x[2])), 1),
      najwieksze: s.liq.length
        ? [...s.liq]
            .sort((a, b) => b[1] + b[2] - a[1] - a[2])
            .slice(0, 3)
            .map(([t, l, sh]) => ({
              t: new Date(t).toISOString(),
              longi: l,
              shorty: sh,
            }))
        : [],
    },
  };
  if (d.footprint) out.footprint = readFootprint(d.footprint);
  return out;
}

export function readFootprint(fp) {
  return {
    krok: fp.step,
    swiece: fp.bars.map((b) => {
      const poc = b.cells.reduce((a, c) => (c[1] + c[2] > a[1] + a[2] ? c : a));
      const imb = diagonalImbalances(b.cells, fp.step);
      return {
        t: new Date(b.t).toISOString(),
        ohlc: b.ohlc,
        delta: round(sum(b.cells.map((c) => c[2] - c[1])), 1),
        zmianaOi: b.oi,
        wolumen: round(sum(b.cells.map((c) => c[1] + c[2])), 1),
        poc: poc[0],
        nierownowagiKupna: [...imb.buy],
        nierownowagiSprzedazy: [...imb.sell],
      };
    }),
  };
}

async function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  const at = Date.parse(arg('--at') ?? new Date().toISOString());
  const out = arg('--out');
  if (!Number.isFinite(at) || !out) throw new Error('Użycie: chartdata.mjs --at <ISO> --out <plik.json> [--notka] [--fp <ISO>] [--source <url|katalog>]');
  const fp = arg('--fp') ? Date.parse(arg('--fp')) : null;
  const data = await buildCharts({
    at,
    fpFrom: fp,
    note: argv.includes('--notka'),
    get: openSource(arg('--source') ?? DEFAULT_SOURCE),
  });
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, `${JSON.stringify(data)}\n`);
  console.log(JSON.stringify(readCharts(data), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
