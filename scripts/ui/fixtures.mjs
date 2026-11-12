// Dane stałe pomiaru układu (`npm run ui:check`): odpowiedzi API Hyperliquid bez sieci, ze stałym zegarem.
// Świece BTC z minut nagranych dób w kopii przy lekcjach (public/lessons/*.json, 20–24.10.2026), HYPE i xyz:NVDA (HIP-3)
// z tych samych minut przeskalowanych do swojej ceny; poza nimi i dla ETH i SOL — świece syntetyczne z funkcji czasu (bez
// losowości). Rejestr rynków `markets.json` z rynkiem HIP-3. Arkusz, kontekst rynku i finansowanie — stałe wartości
// wokół ostatniej ceny. Te same zapytania dają zawsze te same odpowiedzi, niezależnie od pory uruchomienia.
import fs from 'node:fs';
import path from 'node:path';

/** Zegar strony w pomiarze: ostatnia pełna minuta nagranej doby 24.10 (minuty kopii przy lekcjach kończą się o 21:29). */
export const FIXED_NOW = Date.UTC(2026, 9, 24, 21, 29, 20);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MAX_CANDLES = 5000;
const STEP_MS = { '1m': MIN, '3m': 3 * MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': HOUR, '2h': 2 * HOUR, '4h': 4 * HOUR, '8h': 8 * HOUR, '12h': 12 * HOUR, '1d': DAY, '3d': 3 * DAY, '1w': 7 * DAY };
/** Rynki głównej giełdy perp. */
export const COINS = ['BTC', 'ETH', 'SOL', 'HYPE'];
/** Rynki giełd HIP-3 (nazwa z przedrostkiem giełdy, jak w API i w rejestrze). */
export const HIP3 = { xyz: ['xyz:NVDA'] };
const ALL = [...COINS, ...Object.values(HIP3).flat()];
/** Ceny odniesienia rynków bez nagrania BTC (rząd wielkości z października 2026). */
const BASE = { ETH: 3900, SOL: 190, HYPE: 40, 'xyz:NVDA': 180 };
/** Rynki z kształtem nagranej doby BTC przeskalowanym do swojej ceny (`scaleMinutes`); pozostałe — fala syntetyczna. */
const SCALED = ['HYPE', 'xyz:NVDA'];
/** Liczba miejsc po przecinku ceny (jak tick Hyperliquid przy tych cenach). */
const DIGITS = { BTC: 0, ETH: 1, SOL: 2, HYPE: 3, 'xyz:NVDA': 2 };
/** Liczba miejsc po przecinku wielkości (`szDecimals`; HYPE i xyz:NVDA jak w rejestrze rynków). */
const SZ = { BTC: 4, ETH: 3, SOL: 2, HYPE: 2, 'xyz:NVDA': 3 };
/** Największa dźwignia (jak w rejestrze rynków dla HIP-3; główna giełda — jak dotąd w danych stałych). */
const LEVERAGE = { 'xyz:NVDA': 10 };

/**
 * Adres danych skanera w buildzie pomiaru (`scripts/ui/build.mjs`): host bez sieci, z którego `layout-check.mjs` podaje
 * tylko rejestr rynków (`markets.json`) w przebiegu rynków; wszystkie inne pliki — błąd jak bez połączenia.
 */
export const DATA_BASE_URL = 'https://dane.ui-check.invalid/main';

/**
 * Minuty [t, o, h, l, c, v] przeskalowane tak, że ostatnie zamknięcie to `target`: ceny × k zaokrąglone do `digits`
 * miejsc, wolumen ÷ k zaokrąglony do `szDigits` (ten sam obrót w USD). Czas i kolejność bez zmian.
 */
export function scaleMinutes(m1, target, digits, szDigits) {
  const k = target / m1[m1.length - 1][4];
  return m1.map(([t, o, h, l, c, v]) => [t, round(o * k, digits), round(h * k, digits), round(l * k, digits), round(c * k, digits), round(v / k, szDigits)]);
}

/**
 * Rejestr rynków (`markets.json`, format `src/utils/marketRegistry.ts`) z czterema stałymi rynkami (parametry jak
 * `DEFAULT_MARKETS`) i rynkami HIP-3 fikstury, według średnich otwartych pozycji z 7 dni.
 */
export function registry() {
  const row = (coin, dex, oiUsd7d, szDecimals, maxLeverage, scanner) => ({ coin, dex, oiUsd7d, szDecimals, maxLeverage, scanner, since: '2026-10-01' });
  const markets = [
    row('BTC', '', 2.9e9, 5, 40, 'full'),
    row('ETH', '', 1.6e9, 4, 25, 'none'),
    row('HYPE', '', 1.1e9, 2, 10, 'none'),
    row('SOL', '', 5.2e8, 2, 20, 'none'),
    row('xyz:NVDA', 'xyz', 1.4e8, SZ['xyz:NVDA'], LEVERAGE['xyz:NVDA'], 'none'),
  ];
  return { asOf: FIXED_NOW - 20 * MIN, rule: 'reg-v1', markets: markets.map((m, i) => ({ ...m, rank: i + 1 })) };
}

/** Liczba z [0, 1) z liczby całkowitej (stały skrót, bez Math.random). */
function hash01(n) {
  let x = Math.floor(n) % 2147483647;
  x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Wolna fala ceny (względna), ta sama dla każdego rynku. */
const wave = (t) => 0.03 * Math.sin((2 * Math.PI * t) / (9 * DAY)) + 0.01 * Math.sin((2 * Math.PI * t) / (31 * HOUR)) + 0.002 * Math.sin((2 * Math.PI * t) / (97 * MIN));

const round = (p, d) => Number(p.toFixed(d));

/** Początek świecy interwału zawierającej `t` (tydzień od poniedziałku, miesiąc kalendarzowy UTC). */
function bucketStart(t, iv) {
  if (iv === '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  if (iv === '1w') return Math.floor((t - 4 * DAY) / (7 * DAY)) * 7 * DAY + 4 * DAY;
  return Math.floor(t / STEP_MS[iv]) * STEP_MS[iv];
}
function bucketEnd(b, iv) {
  if (iv === '1M') {
    const d = new Date(b);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return b + STEP_MS[iv];
}

export function createFixtures(root) {
  // Minuty BTC: [t, o, h, l, c, v] ze wszystkich plików lekcji, bez powtórzeń, rosnąco
  const byT = new Map();
  const dir = path.join(root, 'public', 'lessons');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (j.coin !== 'BTC' || !Array.isArray(j.m1)) continue;
    for (const m of j.m1) if (!byT.has(m[0])) byT.set(m[0], m.slice(0, 6).map(Number));
  }
  const m1 = [...byT.values()].sort((a, b) => a[0] - b[0]);
  const times = m1.map((m) => m[0]);
  const lastClose = m1[m1.length - 1][4];
  /** Minuty rynku: BTC z nagrania, rynki z `SCALED` — przeskalowane minuty BTC, pozostałe — brak (fala). */
  const series = { BTC: m1 };
  for (const c of SCALED) series[c] = scaleMinutes(m1, BASE[c], DIGITS[c], SZ[c]);

  /** Indeks pierwszej minuty o czasie ≥ t. */
  const lower = (t) => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  /** Cena w chwili t: między minutami rynku — liniowo, przed nimi — fala zaczepiona o pierwszą; rynki bez minut — fala. */
  function price(coin, t) {
    const m1 = series[coin];
    if (!m1) return BASE[coin] * (1 + wave(t));
    const i = lower(t);
    if (i === 0) return m1[0][1] * (1 + wave(t) - wave(m1[0][0]));
    if (i >= m1.length) return m1[m1.length - 1][4];
    const a = m1[i - 1];
    const b = m1[i];
    const k = (t - (a[0] + MIN)) / Math.max(1, b[0] - (a[0] + MIN));
    return a[4] + (b[1] - a[4]) * Math.min(1, Math.max(0, k));
  }

  function synthetic(coin, b, e) {
    const d = DIGITS[coin];
    const o = price(coin, b);
    const c = price(coin, Math.min(e, FIXED_NOW));
    const span = Math.sqrt((e - b) / MIN);
    const h = Math.max(o, c) * (1 + 0.0004 * span * hash01(b / MIN + 7));
    const l = Math.min(o, c) * (1 - 0.0004 * span * hash01(b / MIN + 13));
    const v = (5 + 45 * hash01(b / MIN + 29)) * span * (coin === 'BTC' ? 1 : 80000 / BASE[coin]) * 0.05;
    return { o: round(o, d), h: round(h, d), l: round(l, d), c: round(c, d), v: Number(v.toFixed(4)), n: Math.round(v * 10) + 1 };
  }

  function candle(coin, iv, b) {
    const e = bucketEnd(b, iv);
    let body = null;
    const m1 = series[coin];
    if (m1) {
      const rows = [];
      for (let i = lower(b); i < m1.length && m1[i][0] < e; i++) rows.push(m1[i]);
      if (rows.length > 0)
        body = {
          o: rows[0][1],
          h: Math.max(...rows.map((r) => r[2])),
          l: Math.min(...rows.map((r) => r[3])),
          c: rows[rows.length - 1][4],
          v: Number(rows.reduce((a, r) => a + r[5], 0).toFixed(5)),
          n: rows.length * 40,
        };
    }
    body ??= synthetic(coin, b, e);
    return { t: b, T: e - 1, s: coin, i: iv, o: String(body.o), c: String(body.c), h: String(body.h), l: String(body.l), v: String(body.v), n: body.n };
  }

  function candles({ coin = 'BTC', interval = '5m', startTime = 0, endTime }) {
    if (!ALL.includes(coin) || !(interval in STEP_MS || interval === '1M')) return [];
    const end = Math.min(endTime ?? FIXED_NOW, FIXED_NOW);
    const out = [];
    // Od świecy z chwilą `end` wstecz, dopóki świeca kończy się po `startTime` (najwyżej 5000, jak API)
    for (let b = bucketStart(end, interval); bucketEnd(b, interval) > startTime && out.length < MAX_CANDLES; b = bucketStart(b - 1, interval)) {
      out.push(candle(coin, interval, b));
    }
    return out.reverse();
  }

  const markPx = (coin) => (series[coin] ? series[coin].at(-1)[4] : round(price(coin, FIXED_NOW), DIGITS[coin]));

  /** Arkusz: 20 poziomów na stronę co krok z liczby cyfr znaczących (bez niej — tick rynku), stałe wielkości. */
  function book(coin, nSigFigs) {
    const p = markPx(coin);
    const tick = 10 ** -DIGITS[coin];
    const step = nSigFigs ? Math.max(tick, 10 ** (Math.floor(Math.log10(p)) + 1 - nSigFigs)) : tick;
    const d = Math.max(0, -Math.floor(Math.log10(step)));
    const mid = Math.round(p / step) * step;
    const side = (dir, salt) =>
      Array.from({ length: 20 }, (_, i) => {
        const px = mid + dir * (i + (dir > 0 ? 1 : 0)) * step;
        const sz = (0.2 + 9.8 * hash01(i * 7919 + salt + (nSigFigs ?? 0) * 31)) * (coin === 'BTC' ? 1 : 80000 / BASE[coin]);
        return { px: px.toFixed(d), sz: sz.toFixed(4), n: 1 + Math.floor(40 * hash01(i * 104729 + salt)) };
      });
    return { coin, time: FIXED_NOW, levels: [side(-1, 11), side(1, 23)] };
  }

  /**
   * Rynki wynikowe HIP-4: 14 rynków BTC „cena powyżej K o północy UTC” z progami co 250 USD wokół ostatniej ceny (7 nad,
   * 7 pod) i płynnym arkuszem strony „Tak” (cena udziału z odległości progu od ceny).
   */
  const OUTCOME_STEP = 250;
  const outcomeBase = Math.floor(lastClose / OUTCOME_STEP) * OUTCOME_STEP - 6 * OUTCOME_STEP;
  const outcomeK = (id) => outcomeBase + (id - 1) * OUTCOME_STEP;
  function outcomeMeta() {
    const d = new Date(FIXED_NOW + DAY);
    const time = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-0000`;
    return { outcomes: Array.from({ length: 14 }, (_, i) => ({ outcome: i + 1, name: 'template:binaryPrice', description: `perp:BTC|threshold:${outcomeK(i + 1)}|time:${time}|priceDescription:mark` })) };
  }
  function outcomeBook(coin) {
    const id = Number(coin.slice(1)) / 10;
    if (!(id >= 1 && id <= 14)) return null;
    const p = Math.min(0.97, Math.max(0.03, 1 / (1 + Math.exp((outcomeK(id) - lastClose) / 600))));
    const lv = (px) => [{ px: px.toFixed(2), sz: '5000', n: 3 }];
    return { coin, time: FIXED_NOW, levels: [lv(p - 0.01), lv(p + 0.01)] };
  }

  function ctx(coin) {
    const p = markPx(coin);
    const s = String(p);
    return { funding: '0.0000125', openInterest: String(coin === 'BTC' ? 31000 : Math.round(2.5e9 / p)), prevDayPx: String(round(p * 0.99, DIGITS[coin])), dayNtlVlm: '2500000000', premium: '0.0001', oraclePx: s, markPx: s, midPx: s, impactPxs: [s, s], dayBaseVlm: '30000' };
  }

  function respond(body) {
    switch (body?.type) {
      case 'candleSnapshot':
        return candles(body.req ?? {});
      case 'metaAndAssetCtxs': {
        const list = body.dex ? (HIP3[body.dex] ?? []) : COINS;
        return [{ universe: list.map((name) => ({ name, szDecimals: SZ[name], maxLeverage: LEVERAGE[name] ?? 40 })) }, list.map(ctx)];
      }
      case 'l2Book':
        if (typeof body.coin === 'string' && body.coin.startsWith('#')) return outcomeBook(body.coin);
        return ALL.includes(body.coin) ? book(body.coin, body.nSigFigs) : null;
      case 'outcomeMeta':
        return outcomeMeta();
      case 'fundingHistory': {
        const out = [];
        for (let t = Math.ceil(Math.max(body.startTime ?? 0, FIXED_NOW - 500 * HOUR) / HOUR) * HOUR; t <= FIXED_NOW && out.length < 500; t += HOUR) {
          out.push({ coin: body.coin ?? 'BTC', fundingRate: (0.0000125 * (1 + 0.5 * Math.sin(t / (13 * HOUR)))).toFixed(8), premium: '0.0001', time: t });
        }
        return out;
      }
      default:
        return [];
    }
  }

  return {
    respond,
    minutes: (coin) => series[coin] ?? [],
    /** Wiadomości kanałów WebSocket na subskrypcję (atrapa strumienia w stronie): arkusz, kontekst i najlepsze kwotowania. */
    stream: () => {
      const out = {};
      for (const c of ALL) {
        out[`activeAssetCtx|${c}`] = { coin: c, ctx: ctx(c) };
        for (const n of ['', 2, 3, 4, 5]) out[`l2Book|${c}|${n}`] = book(c, n || undefined);
        const b = book(c);
        out[`bbo|${c}`] = { coin: c, time: FIXED_NOW, bbo: [b.levels[0][0], b.levels[1][0]] };
      }
      return out;
    },
  };
}
