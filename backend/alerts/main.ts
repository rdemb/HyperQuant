import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALERT_MARKETS, AlertEngine, type AlertTrade, eventBody, ivMs } from '../../src/utils/alertRules.ts';
import { ALERTS_URL } from '../../src/utils/alertsServer.ts';
import { HlRest, HlStream, type HlTrade } from '../scanner/hl.ts';
import { WeightLimiter } from '../scanner/rateLimiter.ts';
import { DeviceBook, type DeviceEvent, type DeviceStart } from './book.ts';
import { loadKeys } from './keys.ts';
import { Mailbox } from './mailbox.ts';
import { sendPush } from './push.ts';

/**
 * Serwer powiadomień HyperQuant (VPS): pobiera ze skrzynki alarmy urządzeń z włączonym „24/7”, pilnuje ich na taśmie
 * Hyperliquid tym samym silnikiem co strona i wysyła Web Push przy uruchomieniu. Tylko połączenia wychodzące.
 */

const STATE_DIR = process.env.HQ_STATE_DIR ?? '';
const OUT_DIR = process.env.HQ_OUT_DIR ?? '';
if (!STATE_DIR || !OUT_DIR) {
  console.error('[alarmy] brak HQ_STATE_DIR albo HQ_OUT_DIR');
  process.exit(1);
}
const URL_ = (process.env.HQ_ALERTS_URL || ALERTS_URL).replace(/\/+$/, '');
/** Kontakt VAPID dla usług push (strona projektu). */
const SUBJECT = 'https://rdemb.github.io/HyperQuant/';
const SYNC_MS = 3000;
const REPORT_MS = 1000;
const SAVE_MS = 30_000;
const SEED_MS = 6 * 3600_000;
const PENDING_MAX = 5000;

const log = (msg: string) => console.log(`[alarmy] ${msg}`);

function writeJsonAtomic(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value));
  renameSync(`${path}.tmp`, path);
}

const keys = loadKeys(STATE_DIR);
// Części publiczne kluczy: skaner publikuje je w repo danych (skrzynka i strona czytają je stamtąd)
mkdirSync(join(OUT_DIR, 'alerts'), { recursive: true });
writeJsonAtomic(join(OUT_DIR, 'alerts', 'keys.json'), { v: 1, vapid: keys.vapid.publicKey, server: keys.signPublic });

const statePath = join(STATE_DIR, 'alerts-state.json');
const book = new DeviceBook();
try {
  book.restore(JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, { armed?: unknown; streak?: unknown }>);
} catch {
  // Pierwszy start albo brak alarmów w toku
}

const engine = new AlertEngine();
const mailbox = URL_ ? new Mailbox(URL_, keys.sign) : null;
const rest = new HlRest(new WeightLimiter(60));
const streams = new Map<string, HlStream>();
const seeded = new Map<string, number>();
let cursor = '0';
let pending: { events: DeviceEvent[]; starts: DeviceStart[]; gone: Set<string> } = { events: [], starts: [], gone: new Set() };
const stats = { sent: 0, gone: 0, failed: 0 };
const pulsePath = join(STATE_DIR, 'alerts-pulse.json');
// Start liczy się jak synchronizacja: strażnik ocenia ciszę dopiero od uruchomienia
let syncOkAt = Date.now();
/** Ostatni komunikat Hyperliquid na rynek ze strumieniem (transakcje albo kontekst rynku ~co 1 s). */
const heard = new Map<string, number>();

/** Średni wolumen do faktów: zamknięte świece interwału z API (raz na 6 h na rynek i interwał). */
async function seed(coin: string, iv: string): Promise<void> {
  const k = `${coin}:${iv}`;
  const now = Date.now();
  if (now - (seeded.get(k) ?? 0) < SEED_MS) return;
  seeded.set(k, now);
  const raw = await rest.info({ type: 'candleSnapshot', req: { coin, interval: iv, startTime: now - 25 * ivMs(iv), endTime: now } }, 21);
  if (!Array.isArray(raw)) {
    seeded.delete(k);
    return;
  }
  engine.seedVolumes(coin, iv, (raw as { t: number; v: string }[]).map((c) => ({ t: Number(c.t), v: Number(c.v) })), Date.now());
}

async function notify(e: DeviceEvent, retry = true): Promise<void> {
  const d = book.devices.get(e.device);
  if (!d) return;
  const payload = { title: d.lang === 'en' ? 'HyperQuant · alert' : 'HyperQuant · alarm', body: eventBody(e, d.lang), tag: e.rule.id, url: `./#charts?m=${e.rule.coin}` };
  const r = await sendPush(d, payload, keys.vapid, SUBJECT);
  if (r === 'ok') stats.sent++;
  else if (r === 'gone') {
    stats.gone++;
    pending.gone.add(d.id);
    book.apply({ ...d, rules: null });
  } else if (retry) setTimeout(() => void notify(e, false), 5000);
  else stats.failed++;
}

function onTrades(coin: string, hl: HlTrade[]): void {
  const trades: AlertTrade[] = [];
  for (const t of hl) {
    const px = Number(t.px);
    const sz = Number(t.sz);
    if (!(px > 0 && sz > 0) || (t.side !== 'B' && t.side !== 'A')) continue;
    trades.push({ time: t.time, px, sz, side: t.side === 'B' ? 1 : -1, key: t.hash || `t${t.tid}` });
  }
  if (trades.length === 0) return;
  const before = book.rules;
  const { rules, events } = engine.onTrades(before, coin, trades);
  if (rules) book.rules = rules;
  if (events.length === 0) return;
  const out = book.split(events, before);
  pending.events.push(...out.events);
  pending.starts.push(...out.starts);
  for (const e of out.events) if (e.type === 'fire') void notify(e);
}

/** Strumień dla każdego rynku z alarmem (bez alarmów: zamknięty). */
function watch(): void {
  for (const coin of ALERT_MARKETS) {
    const ivs = engine.intervals(book.rules, coin);
    const s = streams.get(coin);
    if (ivs.length === 0) {
      if (s) {
        s.stop();
        streams.delete(coin);
        heard.delete(coin);
        engine.gap(coin);
      }
      continue;
    }
    for (const iv of ivs) if (iv !== '1m') void seed(coin, iv);
    if (s) continue;
    heard.set(coin, Date.now());
    const st = new HlStream(
      coin,
      (t) => {
        heard.set(coin, Date.now());
        onTrades(coin, t);
      },
      (c) => {
        heard.set(coin, Date.now());
        engine.onOi(coin, c.oiBtc);
      },
      WebSocket,
      null,
      (up) => {
        if (!up) engine.gap(coin);
      }
    );
    streams.set(coin, st);
    st.start();
  }
}

let syncFailedAt = 0;
async function syncTick(): Promise<void> {
  if (!mailbox) return;
  try {
    const n = book.devices.size;
    for (let page = 0; page < 20; page++) {
      const r = await mailbox.sync(cursor);
      for (const d of r.devices) book.apply(d);
      cursor = r.cursor;
      if (!r.more) break;
    }
    syncOkAt = Date.now();
    if (book.devices.size !== n) log(`urządzenia: ${book.devices.size}, alarmy: ${book.rules.length}`);
    watch();
  } catch (e) {
    if (Date.now() - syncFailedAt > 600_000) log(`skrzynka niedostępna (${e instanceof Error ? e.message : e}), ponawiam`);
    syncFailedAt = Date.now();
  }
}

async function reportTick(): Promise<void> {
  if (!mailbox || (pending.events.length === 0 && pending.starts.length === 0 && pending.gone.size === 0)) return;
  const batch = pending;
  pending = { events: [], starts: [], gone: new Set() };
  try {
    await mailbox.report({ events: batch.events, starts: batch.starts, gone: [...batch.gone] });
  } catch {
    // Następna próba razem z nowymi zdarzeniami
    pending = {
      events: [...batch.events, ...pending.events].slice(-PENDING_MAX),
      starts: [...batch.starts, ...pending.starts].slice(-PENDING_MAX),
      gone: new Set([...batch.gone, ...pending.gone]),
    };
  }
}

/** Puls dla strażnika (scripts/watchdog.mjs): czas zapisu, ostatnia synchronizacja, najstarszy ostatni komunikat HL. */
function savePulse(): void {
  writeJsonAtomic(pulsePath, { v: 1, at: Date.now(), syncAt: mailbox ? syncOkAt : null, wsAt: heard.size > 0 ? Math.min(...heard.values()) : null });
}

let saved = '';
function saveState(): void {
  const s = JSON.stringify(book.snapshot());
  if (s === saved) return;
  writeJsonAtomic(statePath, JSON.parse(s));
  saved = s;
}

function loop(fn: () => Promise<void>, ms: number): void {
  const run = () => void fn().finally(() => setTimeout(run, ms));
  run();
}

if (mailbox) {
  loop(syncTick, SYNC_MS);
  loop(reportTick, REPORT_MS);
  log(`start, skrzynka ${new URL(URL_).host}`);
} else log('brak adresu skrzynki: klucze opublikowane, czekam na wdrożenie skrzynki');
setInterval(saveState, SAVE_MS);
savePulse();
setInterval(savePulse, SAVE_MS);
setInterval(() => {
  if (stats.sent + stats.gone + stats.failed === 0) return;
  log(`powiadomienia w ostatniej godzinie: wysłane ${stats.sent}, wygasłe subskrypcje ${stats.gone}, nieudane ${stats.failed}`);
  stats.sent = stats.gone = stats.failed = 0;
}, 3600_000);

for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    saveState();
    for (const s of streams.values()) s.stop();
    const done = () => process.exit(0);
    void reportTick().finally(done);
    setTimeout(done, 3000).unref();
  });
