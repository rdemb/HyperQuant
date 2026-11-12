/**
 * Syntetyczne pliki skanera i nagrania taśmy dla testów narzędzi danych skanera: przechodzą strażniki strony, bez adresów
 * i hashy (wyjątek: celowo dodane pole z adresem w pliku wielorybów, które nie może wyjść w odpowiedzi).
 */
import { gzipSync } from 'node:zlib';
import { utcDayStart } from '../../src/charts/pro/core/sessions';
import type { CohortFlow, CohortTotal } from '../../src/utils/cohorts';
import type { DeskLedgerSummary } from '../../src/utils/deskLedger';
import type { LiqMap } from '../../src/utils/liqMap';
import type { LiqEvent, LiqTape } from '../../src/utils/liqTape';
import { type HistTrade, type HistoryIndex, encodeTrades, historyPath } from '../../src/utils/tapeHistory';
import type { WhaleLayer } from '../../src/utils/whaleLayer';
import { DATA_BASE, HISTORY_BASE, HL_INFO, HOUR, MIN, type Route, flatBars, hlRoute } from './helpers';

// Środa 4.11.2026 15:45 UTC; wszystkie pliki syntetyczne (przechodzą strażniki strony, bez adresów i hashy)
export const NOW = Date.UTC(2026, 10, 4, 15, 45);
export const DAY = 24 * HOUR;
export const ADDR = '0x' + 'c'.repeat(40);
export const ADDRESS = /0x[0-9a-fA-F]{40}/;

export const LIQ_URL = `${DATA_BASE}/liq-map/BTC.json`;
export const TAPE_URL = `${DATA_BASE}/liq-tape/BTC.json`;
export const COHORTS_URL = `${DATA_BASE}/cohorts/BTC.json`;
export const WHALES_URL = `${DATA_BASE}/whales.json`;
export const LEDGER_URL = `${DATA_BASE}/ledger/BTC/summary.json`;
export const INDEX_URL = `${HISTORY_BASE}/index.json`;

/** Świece 1m od początku doby do bieżącej minuty: zamknięcie 100 000 (cena odpowiedzi). */
export const PRICE = 100_000;
export const hl = () => hlRoute(flatBars(utcDayStart(NOW), NOW + MIN, 99_900, 100_100));

// ───────── liq-map ─────────

/** Mapa z kubełkami w 1% i 3% od ceny 100 000 (środki kubełków: px + 50) i poza nimi. */
export const liqMap = (age = 30_000): LiqMap => ({
  v: 1,
  coin: 'BTC',
  asOf: NOW - age,
  ctxAt: NOW - age,
  markPx: 100_050,
  stepUsd: 100,
  longs: [
    { px: 96_000, ntlUsd: 7e6, n: 9 },
    { px: 97_500, ntlUsd: 4e6, n: 6 },
    { px: 98_500, ntlUsd: 1.5e6, n: 4 },
    { px: 99_200, ntlUsd: 2e6, n: 5 },
    { px: 99_800, ntlUsd: 3e6, n: 7 },
    { px: 99_900, ntlUsd: 5e5, n: 3 },
  ],
  shorts: [
    { px: 100_100, ntlUsd: 2.5e6, n: 6 },
    { px: 100_700, ntlUsd: 1e6, n: 2 },
    { px: 101_500, ntlUsd: 6e6, n: 8 },
    { px: 103_500, ntlUsd: 9e6, n: 10 },
  ],
  coverage: { positions: 400, addresses: 300, scannedBtc: 8000, longBtc: 4100, shortBtc: 3900, wrongSide: 2, oiBtc: 9500, share: 0.42 },
  ageMin: { p50: 3, p90: 8, ntlP50: 4 },
  method: 'hl-clearinghouse-v1',
});

// ───────── liq-tape ─────────

const event = (k: number, side: LiqEvent['side']): LiqEvent => ({
  t: NOW - (k + 1) * 7 * MIN,
  side,
  sz: 0.5 + k / 10,
  px: 99_000 + k * 100,
  usd: (0.5 + k / 10) * (99_000 + k * 100),
  method: k % 3 === 0 ? 'backstop' : 'market',
  markPx: 99_000 + k * 100,
  mapLiqPx: null,
  mapAgeMin: null,
});
export const TAPE: LiqTape = {
  v: 1,
  coin: 'BTC',
  asOf: NOW - 40_000,
  since: NOW - 30 * HOUR,
  events: Array.from({ length: 12 }, (_, k) => event(k, k % 2 === 0 ? 'long' : 'short')),
  buckets: [],
  totals: { h1: { longUsd: 1.2e6, shortUsd: 3.4e5, n: 4 }, h24: { longUsd: 8.5e6, shortUsd: 6.1e6, n: 31 } },
  calib: { n: 0, medAbsErrBp: null, p90AbsErrBp: null, medSignedErrBp: null, medAgeMin: null },
  checks: { candidates: 40, confirmed: 31, rejected: 9, failed: 0 },
  method: 'hl-fills-liquidation-v1',
};

// ───────── cohorts ─────────

const tot = (buy: number, sell: number, takerBuy: number, takerSell: number, hidden = 0, takerHidden = 0): CohortTotal => ({ buy, sell, takerBuy, takerSell, hidden, takerHidden });
const zero = tot(0, 0, 0, 0);
export const BUCKET = 15 * MIN;
export const lastBucket = Math.floor(NOW / BUCKET) * BUCKET - BUCKET;
export const cohortFlow = (age = 2 * MIN): CohortFlow => ({
  v: 1,
  coin: 'BTC',
  asOf: NOW - age,
  since: NOW - 3 * DAY,
  bucketMin: 15,
  buckets: [
    { t: lastBucket - 20 * HOUR, cells: { mm: null, informed: null, whale: null, rest: null } },
    { t: lastBucket, cells: { mm: null, informed: null, whale: null, rest: null } },
  ],
  totals: {
    h1: { mm: tot(4e6, 3e6, 1e6, 5e5), informed: tot(1e6, 2e6, 8e5, 1.5e6), whale: tot(2e6, 1e6, 1e6, 0, 1), rest: zero },
    h24: { mm: tot(9e7, 8e7, 2e7, 1e7), informed: tot(2e7, 3e7, 1e7, 2e7), whale: tot(3e7, 2e7, 1e7, 5e6, 2, 1), rest: tot(1e7, 2e7, 5e6, 1e7) },
  },
  // Wolumen taśmy = widoczne kupno + ukryte kupno = widoczna sprzedaż + ukryta sprzedaż (1 h: 7 + 1 = 6 + 2 = 8 mln)
  tape: {
    h1: { volume: 8e6, hidden: { buy: 1e6, sell: 2e6, takerBuy: 1.2e6, takerSell: 2e6 } },
    h24: { volume: 1.6e8, hidden: { buy: 1e7, sell: 1e7, takerBuy: 4e7, takerSell: 3e7 } },
  },
  members: { mm: 10, informed: 20, whale: 30, rest: 900 },
  informed: { candidates: 50, selected: 12, fdrQ: 0.1, minN: 30, mu0Bp: 0.5, tauBp: 2.1, classifiedAt: NOW - HOUR },
  oos: {
    mm: { hours: 24, hiddenHours: 0, m1: null, m5: null, m60: -1.2 },
    informed: { hours: 24, hiddenHours: 0, m1: null, m5: null, m60: 4.1 },
    whale: { hours: 24, hiddenHours: 0, m1: null, m5: null, m60: 0.3 },
    rest: { hours: 24, hiddenHours: 0, m1: null, m5: null, m60: -0.8 },
  },
  kMin: 5,
  method: 'hl-cohorts-v1',
});

// ───────── whales ─────────

/** Pozycje i zlecenia pod pseudonimami doby; dodatkowe pole z adresem (strażnik strony go nie sprawdza) nie może wyjść. */
export const whales = (age = 3 * MIN): WhaleLayer =>
  ({
    v: 2,
    asOf: NOW - age,
    accounts: 140,
    candidates: 180,
    minPositionUsd: { BTC: 1_000_000, ETH: 500_000 },
    minOrderUsd: { BTC: 250_000, ETH: 150_000 },
    markets: {
      BTC: {
        positions: [
          { id: 'Wa1b2c3', side: 'long', usd: 4.2e7, entry: 97_250, liq: 81_000, lev: 5, at: NOW - 4 * MIN, addr: ADDR },
          { id: 'Wd4e5f6', side: 'short', usd: 1.9e7, entry: 101_500, liq: null, lev: 3, at: NOW - 6 * MIN },
          { id: 'W0a9b8c', side: 'long', usd: 6.5e6, entry: 99_000, liq: 90_250, lev: 10, at: NOW - 5 * MIN },
        ],
        orders: [
          { id: 'Wa1b2c3', side: 'ask', px: 104_000, usd: 2e6, kind: 'limit', reduce: true, at: NOW - 4 * MIN, addr: ADDR },
          { id: 'Wa1b2c3', side: 'ask', px: 104_500, usd: 1.5e6, kind: 'limit', reduce: true, at: NOW - 4 * MIN },
          { id: 'Wd4e5f6', side: 'bid', px: 96_000, usd: 8e5, kind: 'tp', reduce: true, at: NOW - 6 * MIN },
          { id: 'W0a9b8c', side: 'ask', px: 92_000, usd: 6.5e6, kind: 'stop', reduce: true, at: NOW - 5 * MIN },
        ],
      },
      ETH: { positions: [{ id: 'We7f8a9', side: 'short', usd: 3e6, entry: 3_100, liq: 3_900, lev: 4, at: NOW - 4 * MIN }], orders: [] },
    },
  }) as WhaleLayer;

// ───────── ledger ─────────

const cov = (rate: number, kupiecP: number | null = 0.41) => ({ rate, n: 400, nEff: 100, kupiecP });
const ret = (n: number, crpss: number | null) => ({
  n,
  crps: 0.003,
  crpsBench: 0.0032,
  crpss,
  pitHist: [],
  cov90: cov(0.884),
  cov60: cov(0.612),
  covAci: cov(0.901, null),
  ...(n >= 100
    ? {
        kupiec60: { n: 100, x: 58, cover: 0.58, lr: 0.1667, p: 0.683 },
        pit: { n: 100, bins: [12, 9, 10, 11, 8, 10, 9, 11, 10, 10], chi2: 1.2, p: 0.9988 },
        crpssCi: { value: 0.052, lo: 0.021, hi: 0.08, days: 30 },
        aciInf: { n, inf: 6, share: 0.015 },
      }
    : {
        kupiec60: { n: 3, x: 2, cover: 0.6667, lr: 0.0566, p: 0.812 },
        pit: { n: 3, bins: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0], chi2: null, p: null, reason: 'min-n' as const },
        crpssCi: { value: 0.02, lo: null, hi: null, days: 3, reason: 'min-days' as const },
        aciInf: { n, inf: 0, share: 0 },
      }),
});
export const ledger = (age = 5 * MIN): DeskLedgerSummary => ({
  v: 1,
  coin: 'BTC',
  asOf: NOW - age,
  model: 'synthetic',
  head: { hash: 'synthetic-head', lines: 1200 },
  pending: 4,
  voided: 1,
  latest: { ret: [], touch: null },
  scores: {
    ret: { '240': ret(12, 0.02), '60': ret(400, 0.052) },
    touch: {
      n: 300,
      pairs: 800,
      brier: 0.181,
      brierBase: 0.205,
      bss: 0.117,
      bssClim: 0.117,
      brierDist: 0.19,
      bssDist: 0.047,
      pairsDist: 800,
      bssCi: { value: 0.117, lo: 0.05, hi: 0.18, days: 30 },
      bssDistCi: { value: 0.047, lo: -0.012, hi: 0.1, days: 30 },
      reliability: [],
      calibration: [],
    },
  },
  cat: {
    model: 'm',
    since: NOW - 30 * 24 * HOUR,
    issued: 2800,
    slots: 2800,
    latest: null,
    scores: {
      n: 2700,
      nEff: 675,
      dir: { brier: 0.25, brierBase: 0.25, bss: 0, auc: 0.5, hit: 0.5, long: { n: 0, hit: null }, short: { n: 0, hit: null }, unsure: 2700 },
      big: { brier: 0.2, brierBase: 0.21, bss: 0.048, auc: 0.6, hit: 0.7, reliability: [], bssSeasonal: { value: 0.031, lo: -0.004, hi: 0.066, days: 30, n: 2650 } },
    },
  },
  ots: [],
  slotStamps: 90,
  participation: { issued: 2800, skipped: 6, gaps: [] },
  method: 'hq-ledger-v1',
});

// ───────── history (TWAP) ─────────

export const H14 = Date.UTC(2026, 10, 4, 14);
export const H15 = H14 + HOUR;
export const PART = 5 * MIN;

/**
 * Taśma co minutę: kupno 3000 USD z hashem zerowym, kupno 4000 USD i sprzedaż 3000 USD bez niego — wypełnienia z hashem
 * zerowym to 30% wartości, wszystkie po stronie kupna.
 */
export function tape(from: number, to: number): HistTrade[] {
  const out: HistTrade[] = [];
  let tid = Math.floor(from / 1000);
  for (let t = from; t < to; t += MIN) {
    out.push({ t: t + 1000, px: 100_000, sz: 0.03, side: 'B', tid: tid++, o: 1, k: 1, m: 2, z: true });
    out.push({ t: t + 2000, px: 100_000, sz: 0.04, side: 'B', tid: tid++, o: 2, k: 3, m: 2 });
    out.push({ t: t + 3000, px: 100_000, sz: 0.03, side: 'A', tid: tid++, o: 3, k: 4, m: 2 });
  }
  return out;
}
export const tradesGz = (from: number, to: number, zeroKnown = true) => gzipSync(JSON.stringify(encodeTrades('BTC', from, to, [[from, to]], tape(from, to), [], zeroKnown)));
export const hourUrl = (h: number) => `${HISTORY_BASE}/${historyPath('BTC', h, 'trades', false)}`;
export const partUrl = (p: number) => `${HISTORY_BASE}/${historyPath('BTC', p, 'trades', true)}`;
export const index = (at: number, hours: number[], parts: number[]): HistoryIndex => ({ v: 1, asOf: at - 30_000, keepDays: 2, partMs: PART, markets: { BTC: { hours, parts } } });

/** Godzina 14:00 (plik godzinowy) i części 15:00, 15:05 — nagranie do 15:10; teraz 15:13. */
export const TW_NOW = H15 + 13 * MIN;
export const twRoutes = (o: { zeroKnownHour?: boolean } = {}): Record<string, Route> => ({
  [INDEX_URL]: { json: index(TW_NOW, [H14 - HOUR, H14], [H15, H15 + PART]) },
  [hourUrl(H14)]: { bytes: tradesGz(H14, H15, o.zeroKnownHour ?? true) },
  [partUrl(H15)]: { bytes: tradesGz(H15, H15 + PART) },
  [partUrl(H15 + PART)]: { bytes: tradesGz(H15 + PART, H15 + 2 * PART) },
});

export const allRoutes = (patch: Record<string, Route> = {}): Record<string, Route> => ({
  [HL_INFO]: hl(),
  [LIQ_URL]: { json: liqMap() },
  [TAPE_URL]: { json: TAPE },
  [COHORTS_URL]: { json: cohortFlow() },
  [WHALES_URL]: { json: whales() },
  [LEDGER_URL]: { json: ledger() },
  ...patch,
});
