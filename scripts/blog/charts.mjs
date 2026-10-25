// Wykresy wpisu jako SVG w treści strony (bez skryptów): mapa sesji i footprint z content/blog/<id>/wykresy.json.
// Każdy wykres w dwóch układach: szerokim (komputer) i wąskim (telefon, świece 30 min); CSS pokazuje jeden z nich.
// Kolory jak w wykresach desku (src/charts/pro/chart/theme.ts, paleta „Desk”).
import { TIME_ZONE } from './posts.mjs';

const MIN = 60_000;

const C = {
  bg: '#0b1019',
  grid: '#141c29',
  line: '#1b2533',
  lineStrong: '#283447',
  ink1: '#eef2f7',
  ink2: '#a9b4c4',
  ink3: '#7a889c',
  accent: '#3fc6dd',
  level: '#e0a045',
  buy: '#19a88e',
  sell: '#d9582e',
  buyInk: '#35c9a8',
  sellInk: '#f07c55',
  vwap: '#e6ebf2',
  oi: '#9085e9',
  profileVa: '#34425a',
  profileOut: '#1f2b3d',
  fpNeutral: '#1c2534',
  fpBidRamp: ['#2a3446', '#4c3532', '#743d2e', '#a6492f', '#d9582e'],
  fpAskRamp: ['#2a3446', '#1f4b52', '#1a6d63', '#19907d', '#1fb597'],
  imbBuy: '#5cf2cf',
  imbSell: '#ff9a6a',
};
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const hm = new Intl.DateTimeFormat('pl-PL', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
const dhm = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
const n0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
const s0 = new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});
const s1 = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});
const minus = (s) => s.replace('-', '−');
const px0 = (v) => n0.format(v);
const sig0 = (v) => minus(s0.format(v));
const sig1 = (v) => minus(s1.format(v));
/** Wolumen w kafelku: poniżej 10 z jednym miejscem po przecinku, pusty przy zerze. */
const vol = (v) => (v <= 0 ? '' : v < 9.95 ? n1.format(v) : n0.format(v));
const f = (x) => Math.round(x * 10) / 10;
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const text = (x, y, s, { size = 10, fill = C.ink3, anchor = 'start', weight = 400, family = MONO, base = 'middle' } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="${base}"${weight !== 400 ? ` font-weight="${weight}"` : ''} font-family="${family}">${xmlEsc(s)}</text>`;
const hline = (x1, x2, y, stroke, extra = '') => `<line x1="${f(x1)}" x2="${f(x2)}" y1="${f(y)}" y2="${f(y)}" stroke="${stroke}"${extra}/>`;
const vline = (x, y1, y2, stroke, extra = '') => `<line x1="${f(x)}" x2="${f(x)}" y1="${f(y1)}" y2="${f(y2)}" stroke="${stroke}"${extra}/>`;
const rect = (x, y, w, h, fill, extra = '') =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(Math.max(0, w))}" height="${f(Math.max(0, h))}" fill="${fill}"${extra}/>`;
const path = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');

/** Ładny krok siatki: ~`n` linii w zakresie. */
function niceStep(range, n) {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
}

/** Etykiety osi bez nakładania: pozycje y rozsunięte o co najmniej `gap`, w granicach [lo, hi]. */
export function spreadLabels(items, gap, lo, hi) {
  const xs = [...items].sort((a, b) => a.y - b.y).map((it) => ({ ...it, ly: it.y }));
  for (let i = 1; i < xs.length; i++) xs[i].ly = Math.max(xs[i].ly, xs[i - 1].ly + gap);
  if (xs.length && xs.at(-1).ly > hi) {
    xs.at(-1).ly = hi;
    for (let i = xs.length - 2; i >= 0; i--) xs[i].ly = Math.min(xs[i].ly, xs[i + 1].ly - gap);
  }
  for (const it of xs) it.ly = Math.max(lo, it.ly);
  return xs;
}

/** Świece o interwale `base` sklejone po `k` (układ wąski: dwa razy dłuższe); delta tylko, gdy wszystkie części ją mają. */
export function mergeCandles(candles, k, base = 15 * MIN) {
  if (k === 1) return candles;
  const out = [];
  for (const c of candles) {
    const t = c[0] - (c[0] % (k * base));
    const last = out.at(-1);
    if (!last || last[0] !== t) out.push([t, ...c.slice(1)]);
    else {
      last[2] = Math.max(last[2], c[2]);
      last[3] = Math.min(last[3], c[3]);
      last[4] = c[4];
      last[5] += c[5];
      last[6] = last[6] === null || c[6] === null ? null : last[6] + c[6];
      last[7] = last[7] === null || c[7] === null ? null : last[7] + c[7];
    }
  }
  return out;
}

/** Krótkie okno (notka): do 8 godzin. */
const isCompact = (s) => s.to - s.from <= 8 * 60 * MIN;

const HATCH = (id) =>
  `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${C.line}" stroke-width="2"/></pattern>`;

/**
 * Mapa sesji: świece, VWAP dnia z pasmami ±1σ i ±2σ, obszar wartości i POC z profilu, poziomy dnia poprzedniego,
 * strefy scenariuszy, likwidacje; panele delty agresorów, CVD i open interest; profil wolumenu przy osi ceny.
 * Krótkie okno (notka, do 8 godzin) jest lżejsze: bez profilu i open interest, z poziomami wpisu (`levels`)
 * podpisanymi w kolumnie przy osi.
 */
export function sessionSvg(s, { narrow = false, zones = [], levels = null, uid = 's', label = '' } = {}) {
  const compact = isCompact(s);
  const W = narrow ? 380 : 728;
  const AX = narrow ? 48 : 68;
  // Kolumna przy osi: profil wolumenu albo (notka) podpisy poziomów
  const PROF = compact ? (narrow ? 78 : 118) : narrow ? 38 : 72;
  const plotW = W - AX - PROF - 8;
  const priceTop = 18;
  const priceH = compact ? (narrow ? 190 : 230) : narrow ? 236 : 300;
  const paneH = compact ? (narrow ? 38 : 46) : narrow ? 44 : 56;
  const paneGap = 24;
  const panes = (compact ? ['delta', 'cvd'] : ['delta', 'cvd', 'oi']).map((k, i) => ({
    k,
    top: priceTop + priceH + paneGap + i * (paneH + paneGap),
  }));
  const timeY = panes.at(-1).top + paneH + 14;
  const H = timeY + 10;
  const profX = plotW + 8;

  const base = s.tf * MIN;
  const candles = mergeCandles(
    s.candles.map((c) => [...c]),
    narrow ? 2 : 1,
    base
  );
  const tf = (narrow ? 2 : 1) * base;
  const n = Math.round((s.to - s.from) / tf);
  const slot = plotW / n;
  const xOf = (t) => ((t - s.from) / tf) * slot;
  const cx = (t) => xOf(t) + slot / 2;
  const bodyW = Math.max(1.5, Math.min(7, slot * 0.62));

  // Zakres ceny: świece, pasmo ±1σ VWAP i strefy scenariuszy; poziomy spoza zakresu jako znaczniki przy krawędzi
  let lo = Math.min(...candles.map((c) => c[3]), ...zones.map((z) => z.zone[0]));
  let hi = Math.max(...candles.map((c) => c[2]), ...zones.map((z) => z.zone[1]));
  for (const [, v, sd] of s.vwap) {
    lo = Math.min(lo, v - sd);
    hi = Math.max(hi, v + sd);
  }
  const padP = (hi - lo) * 0.06;
  lo -= padP;
  hi += padP;
  const y = (p) => priceTop + ((hi - p) / (hi - lo)) * priceH;
  const inRange = (p) => p >= lo && p <= hi;

  const out = [];
  out.push(`<defs>${HATCH(`${uid}h`)}<clipPath id="${uid}c"><rect x="0" y="${priceTop}" width="${f(plotW)}" height="${priceH}"/></clipPath></defs>`);
  out.push(rect(0, 0, W, H, C.bg));

  // Siatka ceny
  const gStep = niceStep(hi - lo, narrow ? 5 : 7);
  const grid = [];
  for (let p = Math.ceil(lo / gStep) * gStep; p <= hi; p += gStep) {
    grid.push(p);
    out.push(hline(0, plotW, y(p), C.grid));
  }

  // Granica dnia UTC
  if (s.dayStart > s.from && s.dayStart < s.to) {
    const x = xOf(s.dayStart);
    out.push(vline(x, priceTop, panes.at(-1).top + paneH, C.lineStrong, ' stroke-dasharray="3 3"'));
    out.push(text(x + 4, priceTop - 8, narrow ? '00:00 UTC' : 'północ UTC, start VWAP dnia', { size: 9 }));
  }

  // Strefy scenariuszy
  for (const z of zones) {
    const [a, b] = z.zone;
    const col = z.bias === 'up' ? C.buy : z.bias === 'down' ? C.sell : C.ink3;
    out.push(rect(0, y(b), plotW, y(a) - y(b), col, ' fill-opacity="0.11"'));
    out.push(hline(0, plotW, y(b), col, ' stroke-opacity="0.45"'));
    out.push(hline(0, plotW, y(a), col, ' stroke-opacity="0.45"'));
  }

  // Obszar wartości, POC i poziomy dnia poprzedniego
  const pr = s.profile;
  const asLine = (l) => ({ label: l.label, price: l.price, color: C.ink2, dash: '1 3' });
  const levelLines = compact
    ? (levels ?? s.levels).map(asLine)
    : [
        { label: 'VAH', price: pr.vah, color: C.ink3, dash: '4 3' },
        { label: 'VAL', price: pr.val, color: C.ink3, dash: '4 3' },
        { label: 'POC', price: pr.poc + pr.step / 2, color: C.level, dash: null },
        ...s.levels.map(asLine),
      ];
  for (const l of levelLines.filter((l) => inRange(l.price)))
    out.push(
      hline(0, profX + PROF, y(l.price), l.color, `${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}${l.label === 'POC' ? '' : ' stroke-opacity="0.8"'}`)
    );

  // VWAP dnia: pasmo ±1σ, linie ±2σ, sam VWAP. Punkty stoją na końcu swojej świecy, w układzie wąskim co drugi.
  const endX = (t) => xOf(t + base);
  const thin = (xs) => (narrow ? xs.filter((v) => (v[0] + base - s.from) % tf === 0) : xs);
  out.push(`<g clip-path="url(#${uid}c)">`);
  const vw = thin(s.vwap);
  if (vw.length > 1) {
    const xs = vw.map((v) => endX(v[0]));
    const line = (k) => path(vw.map((v, i) => [xs[i], y(v[1] + k * v[2])]));
    const band = [...vw.map((v, i) => [xs[i], y(v[1] + v[2])]), ...vw.map((v, i) => [xs[i], y(v[1] - v[2])]).reverse()];
    out.push(`<path d="${path(band)}Z" fill="${C.vwap}" fill-opacity="0.06"/>`);
    for (const k of [2, -2]) out.push(`<path d="${line(k)}" fill="none" stroke="${C.vwap}" stroke-opacity="0.32" stroke-dasharray="2 3"/>`);
    out.push(`<path d="${line(0)}" fill="none" stroke="${C.vwap}" stroke-width="1.5" stroke-opacity="0.9"/>`);
  }

  // Świece
  for (const c of candles) {
    const [t, o, h, l, cl] = c;
    const col = cl >= o ? C.buy : C.sell;
    const x = cx(t);
    out.push(vline(x, y(h), y(l), col));
    const top = y(Math.max(o, cl));
    out.push(rect(x - bodyW / 2, top, bodyW, Math.max(1, y(Math.min(o, cl)) - top), col));
  }
  out.push('</g>');

  // Likwidacje: longi pod dołkiem świecy (kolor sprzedaży), shorty nad szczytem (kolor kupna); pole koła ∝ kwota
  const liq = new Map();
  for (const [t, l, sh] of s.liq) {
    const k = t - (t % tf);
    const x = liq.get(k) ?? [0, 0];
    liq.set(k, [x[0] + l, x[1] + sh]);
  }
  const liqMax = Math.max(1, ...[...liq.values()].flat());
  const rMax = narrow ? 8 : 11;
  const byT = new Map(candles.map((c) => [c[0], c]));
  let biggest = null;
  for (const [t, [l, sh]] of liq) {
    const c = byT.get(t);
    if (!c) continue;
    for (const [v, side] of [
      [l, 'long'],
      [sh, 'short'],
    ]) {
      if (v < 0.5) continue;
      const r = Math.max(2.5, rMax * Math.sqrt(v / liqMax));
      const cy = side === 'long' ? y(c[3]) + r + 4 : y(c[2]) - r - 4;
      const col = side === 'long' ? C.sell : C.buy;
      out.push(`<circle cx="${f(cx(t))}" cy="${f(cy)}" r="${f(r)}" fill="${col}" fill-opacity="0.45" stroke="${side === 'long' ? C.sellInk : C.buyInk}"/>`);
      if (!biggest || v > biggest.v) biggest = { v, x: cx(t), cy, r, side };
    }
  }
  if (biggest) {
    // Podpis po lewej stronie koła, a przy lewej krawędzi wykresu po prawej
    const left = biggest.x - biggest.r - 5 > 64;
    const x = left ? biggest.x - biggest.r - 5 : biggest.x + biggest.r + 5;
    const label = `${n1.format(biggest.v)} mln USD`;
    const w = label.length * 5.4 + 4;
    out.push(rect(left ? x - w + 2 : x - 2, biggest.cy - 7, w, 14, C.bg, ' fill-opacity="0.85" rx="2"'));
    out.push(text(x, biggest.cy, label, { size: 9, fill: C.ink2, anchor: left ? 'end' : 'start' }));
  }

  // Podpisy stref na wierzchu, na tle wykresu (czytelne także nad świecami)
  for (const z of zones) {
    const [a, b] = z.zone;
    const label = `${z.bias === 'up' ? '▲' : z.bias === 'down' ? '▼' : '◆'} ${px0(a)}–${px0(b)}`;
    const yy = (y(a) + y(b)) / 2;
    out.push(rect(2, yy - 7, label.length * 5.6 + 8, 14, C.bg, ' fill-opacity="0.85" rx="2"'));
    out.push(
      text(6, yy, label, {
        size: 9,
        fill: z.bias === 'up' ? C.buyInk : z.bias === 'down' ? C.sellInk : C.ink2,
      })
    );
  }

  // Profil wolumenu przy osi: obszar wartości grafitowy, POC bursztynowy (w notce bez profilu)
  const pMax = Math.max(...pr.vol);
  if (!compact)
    pr.vol.forEach((v, i) => {
      const p = pr.from + i * pr.step;
      if (!inRange(p) || !inRange(p + pr.step)) return;
      const y0 = y(p + pr.step);
      const hgt = Math.max(0.6, y(p) - y0 - (priceH / ((hi - lo) / pr.step) > 3 ? 1 : 0));
      const w = (v / pMax) * PROF;
      const col = p === pr.poc ? C.level : p >= pr.val && p < pr.vah ? C.profileVa : C.profileOut;
      out.push(rect(profX + PROF - w, y0, w, hgt, col));
    });

  // Oś ceny: cena bieżąca, poziomy z nazwą, siatka w wolnych miejscach
  const last = candles.at(-1);
  const axX = W - AX + 4;
  out.push(hline(cx(last[0]), W - AX, y(last[4]), C.accent, ' stroke-dasharray="1 2"'));
  const shown = levelLines.filter((l) => inRange(l.price));
  // Notka: najbliższy poziom nad i pod zakresem jako znacznik ze strzałką na krawędzi kolumny podpisów
  const above = compact ? levelLines.filter((l) => l.price > hi).sort((p, q) => p.price - q.price)[0] : null;
  const below = compact ? levelLines.filter((l) => l.price < lo).sort((p, q) => q.price - p.price)[0] : null;
  const tags = [
    { y: y(last[4]), label: px0(last[4]), kind: 'price' },
    ...shown.map((l) => ({ y: y(l.price), label: l.label, sub: px0(l.label === 'POC' ? pr.poc : l.price), color: l.color })),
    ...(above ? [{ y: priceTop + 5, label: `↑ ${above.label}`, sub: px0(above.price), color: C.ink2 }] : []),
    ...(below ? [{ y: priceTop + priceH - 5, label: `↓ ${below.label}`, sub: px0(below.price), color: C.ink2 }] : []),
  ];
  const placed = spreadLabels(tags, narrow ? 12 : 13, priceTop + 5, priceTop + priceH - 5);
  for (const g of grid) {
    if (placed.some((t) => Math.abs(t.ly - y(g)) < 12)) continue;
    out.push(text(axX, y(g), px0(g), { size: narrow ? 9 : 10 }));
  }
  const fit = Math.floor((PROF - 4) / 5.4);
  const short = (t) => (t.length > fit ? `${t.slice(0, fit - 1)}…` : t);
  for (const t of placed) {
    const ink = t.color === C.ink3 ? C.ink2 : t.color;
    if (t.kind === 'price') {
      out.push(rect(W - AX + 1, t.ly - 7, AX - 1, 14, C.accent, ' rx="2"'));
      out.push(text(axX, t.ly, t.label, { size: narrow ? 9 : 10, fill: C.bg, weight: 600 }));
    } else if (compact) {
      // Tło pod podpisem: linia poziomu i linia ceny nie przechodzą przez tekst
      out.push(
        `<g>${rect(profX, t.ly - 7, short(t.label).length * 5.4 + 4, 14, C.bg)}${text(profX + 2, t.ly, short(t.label), { size: 9, fill: ink })}<title>${xmlEsc(`${t.label} ${t.sub}`)}</title></g>`
      );
      out.push(text(axX, t.ly, t.sub, { size: 9, fill: C.ink3 }));
    } else if (narrow) out.push(text(axX, t.ly, t.label, { size: 9, fill: ink, weight: 500 }));
    else {
      out.push(text(axX, t.ly, t.label, { size: 9, fill: ink, weight: 500 }));
      out.push(text(W - 2, t.ly, t.sub, { size: 9, fill: C.ink3, anchor: 'end' }));
    }
  }
  // Mapa sesji: poziomy dnia poprzedniego poza zakresem jako napis ze strzałką przy prawej krawędzi
  if (!compact)
    s.levels
      .filter((l) => !inRange(l.price))
      .forEach((l, i) => {
        const up = l.price > hi;
        const yy = up ? priceTop + 6 + i * 12 : priceTop + priceH - 6 - i * 12;
        out.push(text(plotW - 2, yy, `${l.label} ${px0(l.price)} ${up ? '↑' : '↓'}`, { size: 9, fill: C.ink2, anchor: 'end' }));
      });

  // Panele: delta agresorów, CVD, open interest (każdy z własną skalą, bez wspólnej osi)
  const tape = s.tape ?? [];
  const coveredX = tape.map(([a, b]) => [xOf(a), xOf(b)]);
  const labels = {
    delta: 'Delta agresorów, BTC',
    cvd: 'CVD (skumulowana delta), BTC',
    oi: 'Open interest, BTC',
  };
  const withDelta = candles.filter((c) => c[6] !== null);
  let cum = 0;
  const cvd = withDelta.map((c) => [c[0], (cum += c[6] - c[7])]);
  for (const { k, top } of panes) {
    out.push(text(0, top - 8, labels[k], { size: 9, fill: C.ink2, family: MONO }));
    out.push(hline(0, plotW, top + paneH, C.line));
    // Brak taśmy: kreskowanie poza nagraniem
    let gx = 0;
    for (const [a, b] of [...coveredX, [plotW, plotW]]) {
      if (a - gx > 1) {
        out.push(rect(gx, top, a - gx, paneH, `url(#${uid}h)`));
        if (a - gx > 70)
          out.push(
            text((gx + a) / 2, top + paneH / 2, 'brak taśmy', {
              size: 9,
              anchor: 'middle',
            })
          );
      }
      gx = Math.max(gx, b);
    }
    if (k === 'delta' && withDelta.length) {
      const m = Math.max(1, ...withDelta.map((c) => Math.abs(c[6] - c[7])));
      const mid = top + paneH / 2;
      out.push(hline(0, plotW, mid, C.lineStrong));
      for (const c of withDelta) {
        const d = c[6] - c[7];
        const hgt = (Math.abs(d) / m) * (paneH / 2 - 2);
        out.push(rect(cx(c[0]) - bodyW / 2, d >= 0 ? mid - hgt : mid, bodyW, Math.max(0.8, hgt), d >= 0 ? C.buy : C.sell));
      }
      out.push(text(axX, top + 5, `+${n0.format(m)}`, { size: 9 }));
      out.push(text(axX, top + paneH - 5, minus(`-${n0.format(m)}`), { size: 9 }));
    }
    if (k === 'cvd' && cvd.length > 1) {
      const vals = [0, ...cvd.map((v) => v[1])];
      const a = Math.min(...vals);
      const b = Math.max(...vals);
      const yy = (v) => top + 4 + ((b - v) / (b - a || 1)) * (paneH - 8);
      const pts = cvd.map(([t, v]) => [cx(t), yy(v)]);
      out.push(hline(0, plotW, yy(0), C.lineStrong, ' stroke-dasharray="2 3"'));
      out.push(`<path d="${path([[pts[0][0], yy(0)], ...pts, [pts.at(-1)[0], yy(0)]])}Z" fill="${C.accent}" fill-opacity="0.1"/>`);
      out.push(`<path d="${path(pts)}" fill="none" stroke="${C.accent}" stroke-width="1.5"/>`);
      out.push(
        text(axX, pts.at(-1)[1], sig0(cvd.at(-1)[1]), {
          size: 9,
          fill: C.accent,
        })
      );
    }
    if (k === 'oi' && s.oi.length > 1) {
      const vals = s.oi.map((v) => v[1]);
      const a = Math.min(...vals);
      const b = Math.max(...vals);
      const yy = (v) => top + 4 + ((b - v) / (b - a || 1)) * (paneH - 8);
      const pts = thin(s.oi).map(([t, v]) => [endX(t), yy(v)]);
      out.push(`<path d="${path(pts)}" fill="none" stroke="${C.oi}" stroke-width="1.5"/>`);
      out.push(text(axX, top + 5, px0(b), { size: 9 }));
      out.push(text(axX, top + paneH - 5, px0(a), { size: 9 }));
    }
  }

  // Oś czasu (czas polski)
  const every = (compact ? (narrow ? 2 : 1) : narrow ? 6 : 3) * 60 * MIN;
  for (let t = Math.ceil(s.from / every) * every; t <= s.to; t += every) {
    const x = xOf(t);
    if (x < 16) continue;
    out.push(vline(x, timeY - 10, timeY - 6, C.lineStrong));
    out.push(text(x, timeY, hm.format(t), { size: 9, anchor: 'middle' }));
  }

  // Podpowiedzi po najechaniu na świecę
  for (const c of candles) {
    const [t, o, h, l, cl, v, b, sl] = c;
    const d = b === null ? '' : ` · delta ${sig0(b - sl)} BTC`;
    out.push(
      `<rect x="${f(xOf(t))}" y="${priceTop}" width="${f(slot)}" height="${f(panes.at(-1).top + paneH - priceTop)}" fill="transparent"><title>${xmlEsc(`${dhm.format(t)} · O ${px0(o)} H ${px0(h)} L ${px0(l)} C ${px0(cl)} · wolumen ${n0.format(v)} BTC${d}`)}</title></rect>`
    );
  }

  return `<svg class="chart chart--${narrow ? 'n' : 'w'}" viewBox="0 0 ${W} ${f(H)}" width="${W}" height="${f(H)}" role="img" aria-label="${xmlEsc(label)}" font-family="${MONO}">${out.join('')}</svg>`;
}

/** Komórki footprintu sklejone po `k` świec (układ wąski: 30 min). */
export function mergeBars(bars, k) {
  if (k === 1) return bars;
  const out = [];
  for (const b of bars) {
    const t = b.t - (b.t % (k * 15 * MIN));
    const last = out.at(-1);
    if (!last || last.t !== t) {
      out.push({
        t,
        ohlc: [...b.ohlc],
        oi: b.oi,
        cells: b.cells.map((c) => [...c]),
      });
      continue;
    }
    last.ohlc = [last.ohlc[0], Math.max(last.ohlc[1], b.ohlc[1]), Math.min(last.ohlc[2], b.ohlc[2]), b.ohlc[3]];
    last.oi = last.oi === null || b.oi === null ? null : last.oi + b.oi;
    for (const [p, s, k2] of b.cells) {
      const c = last.cells.find((x) => x[0] === p);
      if (c) {
        c[1] += s;
        c[2] += k2;
      } else last.cells.push([p, s, k2]);
    }
    last.cells.sort((x, y) => y[0] - x[0]);
  }
  return out;
}

/**
 * Nierównowagi po przekątnej: kupno na poziomie wobec sprzedaży poziom niżej, sprzedaż wobec kupna poziom wyżej,
 * co najmniej `ratio` razy; liczą się tylko komórki od 10% największej komórki świecy (min. 1 BTC), żeby szum nie świecił.
 */
export function diagonalImbalances(cells, step, ratio = 3) {
  const by = new Map(cells.map((c) => [c[0], c]));
  const min = Math.max(1, 0.1 * Math.max(...cells.flatMap((c) => [c[1], c[2]])));
  const buy = new Set();
  const sell = new Set();
  for (const [p, s, k] of cells) {
    if (k >= min && k >= ratio * Math.max(by.get(p - step)?.[1] ?? 0, 0.1)) buy.add(p);
    if (s >= min && s >= ratio * Math.max(by.get(p + step)?.[2] ?? 0, 0.1)) sell.add(p);
  }
  return { buy, sell };
}

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
};

/**
 * Footprint: dla każdej świecy sprzedaż × kupno agresorów na poziomach ceny, kafle w odcieniu strony wg wolumenu,
 * POC świecy w ramce, nierównowagi po przekątnej (pasek przy krawędzi kafla i pogrubiona liczba); pod spodem delta,
 * wolumen i zmiana open interest w świecy.
 */
export function footprintSvg(fp, { narrow = false, label = '' } = {}) {
  const bars = mergeBars(fp.bars, narrow ? 2 : 1);
  const step = fp.step;
  const W = narrow ? 380 : 728;
  const AX = narrow ? 46 : 54;
  const slot = (W - AX) / bars.length;
  const cellW = Math.min(36, (slot - 16) / 2);
  const rowH = narrow ? 15 : 17;
  const font = narrow ? 9 : 10;
  const top = 6;
  const hiP = Math.max(...bars.flatMap((b) => b.cells.map((c) => c[0])));
  const loP = Math.min(...bars.flatMap((b) => b.cells.map((c) => c[0])));
  const rows = Math.round((hiP - loP) / step) + 1;
  const gridH = rows * rowH;
  const yOfBin = (p) => top + ((hiP - p) / step) * rowH;
  const yOfPx = (p) => top + ((hiP + step - p) / step) * rowH;
  const sumTop = top + gridH + 10;
  const sumRows = ['Delta', 'Wolumen', 'ΔOI'];
  const sumH = 17;
  const timeY = sumTop + sumRows.length * sumH + 12;
  const H = timeY + 10;
  const maxCell = Math.max(...bars.flatMap((b) => b.cells.flatMap((c) => [c[1], c[2]])));
  const tile = (v, ramp) => (v <= 0 ? C.fpNeutral : ramp[Math.min(4, Math.max(1, Math.ceil(Math.sqrt(v / maxCell) * 4)))]);

  const out = [rect(0, 0, W, H, C.bg)];
  // Oś ceny: każdy poziom (albo co drugi, gdy wierszy dużo)
  const every = rows > 22 && narrow ? 2 : 1;
  for (let i = 0; i < rows; i += every) {
    const p = hiP - i * step;
    out.push(text(W - AX + 6, yOfBin(p) + rowH / 2, px0(p), { size: font - 1 }));
  }

  bars.forEach((b, i) => {
    const x0 = i * slot;
    const cx0 = x0 + slot - 4 - 2 * cellW;
    const [o, h, l, c] = b.ohlc;
    const col = c >= o ? C.buy : C.sell;
    const candleX = cx0 - 7;
    out.push(vline(candleX, yOfPx(h), yOfPx(l), col));
    const bt = yOfPx(Math.max(o, c));
    out.push(rect(candleX - 2, bt, 4, Math.max(1, yOfPx(Math.min(o, c)) - bt), col));
    const imb = diagonalImbalances(b.cells, step);
    const poc = b.cells.reduce((a, x) => (x[1] + x[2] > a[1] + a[2] ? x : a));
    const lowBin = l - (l % step);
    const highBin = h - (h % step);
    const by = new Map(b.cells.map((x) => [x[0], x]));
    for (let p = highBin; p >= lowBin; p -= step) {
      const [, s = 0, k = 0] = by.get(p) ?? [];
      const yy = yOfBin(p);
      const sc = tile(s, C.fpBidRamp);
      const kc = tile(k, C.fpAskRamp);
      out.push(rect(cx0, yy + 0.5, cellW - 0.5, rowH - 1, sc));
      out.push(rect(cx0 + cellW + 0.5, yy + 0.5, cellW - 0.5, rowH - 1, kc));
      const ts = lum(sc) > 0.16 ? C.bg : C.ink1;
      const tk = lum(kc) > 0.16 ? C.bg : C.ink1;
      const sw = imb.sell.has(p);
      const kw = imb.buy.has(p);
      if (sw) out.push(rect(cx0, yy + 0.5, 2.5, rowH - 1, C.imbSell));
      if (kw) out.push(rect(cx0 + 2 * cellW - 2, yy + 0.5, 2.5, rowH - 1, C.imbBuy));
      out.push(
        text(cx0 + cellW / 2, yy + rowH / 2 + 0.5, vol(s), {
          size: font,
          fill: ts,
          anchor: 'middle',
          weight: sw ? 700 : 400,
        })
      );
      out.push(
        text(cx0 + cellW * 1.5 + 0.5, yy + rowH / 2 + 0.5, vol(k), {
          size: font,
          fill: tk,
          anchor: 'middle',
          weight: kw ? 700 : 400,
        })
      );
      const s0v = s;
      const k0v = k;
      out.push(
        `<rect x="${f(cx0)}" y="${f(yy)}" width="${f(2 * cellW + 0.5)}" height="${rowH}" fill="transparent"><title>${xmlEsc(`${hm.format(b.t)} · ${px0(p)}–${px0(p + step)}: sprzedaż ${n1.format(s0v)} BTC, kupno ${n1.format(k0v)} BTC`)}</title></rect>`
      );
    }
    out.push(
      `<rect x="${f(cx0 - 0.5)}" y="${f(yOfBin(poc[0]))}" width="${f(2 * cellW + 1.5)}" height="${rowH}" fill="none" stroke="${C.level}" stroke-width="1.2"/>`
    );

    // Podsumowanie świecy
    const delta = b.cells.reduce((a, x) => a + x[2] - x[1], 0);
    const volume = b.cells.reduce((a, x) => a + x[1] + x[2], 0);
    const mid = cx0 + cellW;
    const sy = (r) => sumTop + r * sumH + sumH / 2;
    out.push(
      rect(cx0, sumTop + 1, 2 * cellW + 0.5, sumH - 2, delta >= 0 ? C.buy : C.sell, ` fill-opacity="${f(0.15 + 0.5 * Math.min(1, Math.abs(delta) / 400))}"`)
    );
    out.push(
      text(mid, sy(0), sig0(delta), {
        size: font,
        fill: C.ink1,
        anchor: 'middle',
        weight: 600,
      })
    );
    out.push(
      text(mid, sy(1), n0.format(volume), {
        size: font,
        fill: C.ink2,
        anchor: 'middle',
      })
    );
    out.push(
      text(mid, sy(2), b.oi === null ? '–' : sig0(b.oi), {
        size: font,
        fill: b.oi === null ? C.ink3 : C.ink2,
        anchor: 'middle',
      })
    );
    out.push(text(mid, timeY, hm.format(b.t), { size: font - 1, anchor: 'middle' }));
  });
  sumRows.forEach((r, i) => {
    out.push(hline(0, W - AX, sumTop + i * sumH, C.line));
    out.push(
      text(W - AX + 6, sumTop + i * sumH + sumH / 2, r, {
        size: font - 1,
        fill: C.ink2,
      })
    );
  });
  out.push(hline(0, W - AX, sumTop + sumRows.length * sumH, C.line));

  return `<svg class="chart chart--${narrow ? 'n' : 'w'}" viewBox="0 0 ${W} ${f(H)}" width="${W}" height="${f(H)}" role="img" aria-label="${xmlEsc(label)}" font-family="${MONO}">${out.join('')}</svg>`;
}

// ───────────────────────── Bloki wpisu ─────────────────────────

const LEGEND_SW = {
  candles: `<i class="sw sw--buy"></i><i class="sw sw--sell"></i>`,
  vwap: '<i class="sw sw--line sw--vwap"></i>',
  poc: '<i class="sw sw--line sw--poc"></i>',
  va: '<i class="sw sw--line sw--va"></i>',
  prev: '<i class="sw sw--line sw--prev"></i>',
  liq: '<i class="sw sw--dot sw--sell"></i><i class="sw sw--dot sw--buy"></i>',
  zone: '<i class="sw sw--zone-up"></i><i class="sw sw--zone-down"></i>',
};

/** Mapa sesji (albo w notce krótkie okno) z legendą i przypisem; strefy scenariuszy i poziomy wpisu na wykresie. */
export function sessionHtml(s, setups = [], levels = []) {
  const compact = isCompact(s);
  const zones = setups.map((x) => ({ bias: x.bias, zone: x.zone }));
  const lv = compact && levels.length ? levels : null;
  const last = s.candles.at(-1);
  const vw = s.vwap.at(-1);
  const hours = Math.round((s.to - s.from) / (60 * MIN));
  const label = compact
    ? `BTC, ostatnie ${hours} godzin do ${dhm.format(s.to)}: cena ${px0(last[4])}, VWAP dnia ${vw ? px0(vw[1]) : 'brak'}.`
    : `Mapa sesji BTC, 24 godziny do ${dhm.format(s.to)}: cena ${px0(last[4])}, VWAP dnia ${vw ? px0(vw[1]) : 'brak'}, POC ${px0(s.profile.poc)}, obszar wartości ${px0(s.profile.val)}–${px0(s.profile.vah)}.`;
  // Koła likwidacji są od 0,5 mln USD w świecy; świece na telefonie są dwa razy dłuższe, więc ich sumy są co najmniej takie same
  const liqBy = new Map();
  for (const [t, l, sh] of s.liq) {
    const k = t - (t % (2 * s.tf * MIN));
    const x = liqBy.get(k) ?? [0, 0];
    liqBy.set(k, [x[0] + l, x[1] + sh]);
  }
  const hasLiq = [...liqBy.values()].some(([l, sh]) => l >= 0.5 || sh >= 0.5);
  const panels = compact ? 'delty i CVD' : 'delty, CVD i open interest';
  const tape = s.tape?.length
    ? ` ${compact ? 'Delta i CVD' : 'Delta, CVD i open interest'} z taśmy transakcji Hyperliquid nagrywanej przez desk${s.tape[0][0] > s.from ? ` od ${hm.format(s.tape[0][0])}` : ''}.`
    : ` W tym oknie brak taśmy transakcji, panele ${panels} są puste.`;
  const legend = [
    `<span>${LEGEND_SW.candles}świece</span>`,
    `<span>${LEGEND_SW.vwap}VWAP dnia, pasma ±1σ i ±2σ</span>`,
    compact ? '' : `<span>${LEGEND_SW.poc}POC</span>`,
    compact ? '' : `<span>${LEGEND_SW.va}obszar wartości (VAH, VAL)</span>`,
    compact ? `<span>${LEGEND_SW.prev}${lv ? 'poziomy z wpisu' : 'szczyt i dołek wczoraj (PDH, PDL)'}</span>` : '',
    !compact && s.levels.length ? `<span>${LEGEND_SW.prev}szczyt i dołek wczoraj (PDH, PDL)</span>` : '',
    hasLiq ? `<span>${LEGEND_SW.liq}likwidacje longów i shortów</span>` : '',
    zones.length ? `<span>${LEGEND_SW.zone}strefy scenariuszy</span>` : '',
  ].join('');
  const candles = `świece ${s.tf} min (na telefonie ${2 * s.tf} min). VWAP od północy UTC.`;
  const frame = compact ? candles : `${candles} Profil wolumenu, POC i obszar wartości (70% obrotu) z całych 24 godzin.`;
  return `<p class="legend">${legend}</p>
<div class="chart-box">${sessionSvg(s, { zones, levels: lv, uid: 'sw', label })}${sessionSvg(s, { zones, levels: lv, narrow: true, uid: 'sn', label })}</div>
<p class="fig-note">Czas polski, ${frame}${tape} ${hasLiq ? 'Koła: likwidacje od 0,5 mln USD w świecy, pole koła według kwoty.' : 'W tym oknie nie było likwidacji od 0,5 mln USD w świecy.'}</p>`;
}

/** Tytuł bloku wykresu sesji: mapa 24 godzin albo krótkie okno notki. */
export function sessionTitle(s) {
  return isCompact(s) ? `Ostatnie ${Math.round((s.to - s.from) / (60 * MIN))} godzin` : 'Mapa sesji: ostatnie 24 godziny';
}

/** Footprint wybranego miejsca z legendą i przypisem. */
export function footprintHtml(fp) {
  const first = fp.bars[0].t;
  const end = fp.bars.at(-1).t + fp.tf * MIN;
  const label = `Footprint BTC ${hm.format(first)}–${hm.format(end)}, świece ${fp.tf} min, przedziały ceny co ${fp.step} USD: sprzedaż i kupno agresorów w BTC.`;
  return `<p class="legend"><span><i class="sw sw--sell"></i>sprzedaż agresorów (lewa kolumna)</span><span><i class="sw sw--buy"></i>kupno agresorów (prawa kolumna)</span><span><i class="sw sw--poc-frame"></i>POC świecy</span><span><i class="sw sw--imb"></i>nierównowaga 3:1</span></p>
<div class="chart-box">${footprintSvg(fp, { label })}${footprintSvg(fp, { narrow: true, label })}</div>
<p class="fig-note">Czas polski. Świece ${fp.tf} min (na telefonie 30 min), przedziały ceny co ${fp.step} USD, wolumen w BTC z taśmy transakcji Hyperliquid. Nierównowaga: kupno na poziomie co najmniej 3 razy większe niż sprzedaż poziom niżej (albo odwrotnie). Pod świecami: delta, wolumen i zmiana open interest w BTC.</p>`;
}
