import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALERT_MARKETS, type AlertCandle, AlertEngine, type AlertEvent, type AlertRule, type AlertTrade, eventBody, eventTitle, isZeroHash, ivMs, tradeKey } from '../../src/utils/alertRules.ts';
import { ALERTS_URL } from '../../src/utils/alertsServer.ts';
import { HlRest, HlStream, type HlTrade } from '../scanner/hl.ts';
import { WeightLimiter } from '../scanner/rateLimiter.ts';
import { DeviceBook, type DeviceEvent, type DeviceStart, readState } from './book.ts';
import { loadKeys } from './keys.ts';
import { Mailbox } from './mailbox.ts';
import { quantile, retryDelay, sendPush } from './push.ts';

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
const MIN = 60_000;

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
/** Zdarzenia jeszcze niezgłoszone skrzynce (zapisywane od razu: po twardej awarii alarm nie uruchomi się drugi raz) */
const pendingPath = join(STATE_DIR, 'alerts-pending.json');
const book = new DeviceBook();
const engine = new AlertEngine(true);
try {
  const st = readState(JSON.parse(readFileSync(statePath, 'utf8')));
  book.restore(st.rules);
  // Czas od ostatniej transakcji sprzed restartu to luka: świece 1m z API po pierwszej transakcji po starcie
  for (const [coin, t] of Object.entries(st.last)) engine.gap(coin, t);
} catch {
  // Pierwszy start albo brak alarmów w toku
}

const mailbox = URL_ ? new Mailbox(URL_, keys.sign) : null;
// Ten sam adres IP co skaner (razem najwyżej 800 wag/min z limitu giełdy 1200): luka w taśmie to jedno zapytanie od razu
const rest = new HlRest(new WeightLimiter(120));
const streams = new Map<string, HlStream>();
const seeded = new Map<string, number>();
let cursor = '0';
let pending: { events: DeviceEvent[]; starts: DeviceStart[]; gone: Set<string> } = { events: [], starts: [], gone: new Set() };
try {
  const p = JSON.parse(readFileSync(pendingPath, 'utf8')) as { events?: unknown; starts?: unknown; gone?: unknown };
  pending = {
    events: Array.isArray(p.events) ? (p.events as DeviceEvent[]) : [],
    starts: Array.isArray(p.starts) ? (p.starts as DeviceStart[]) : [],
    gone: new Set(Array.isArray(p.gone) ? (p.gone as string[]) : []),
  };
  book.hold(pending.events);
} catch {
  // Pierwszy start albo wszystko zgłoszone
}
const stats = { sent: 0, gone: 0, failed: 0 };
/** Opóźnienie uruchomienia z taśmy (transakcja albo koniec świecy) do przyjęcia powiadomienia przez usługę push, ms. */
let latency: number[] = [];
const pulsePath = join(STATE_DIR, 'alerts-pulse.json');
// Start liczy się jak synchronizacja: strażnik ocenia ciszę dopiero od uruchomienia
let syncOkAt = Date.now();
/** Ostatni komunikat Hyperliquid na rynek ze strumieniem (transakcje albo kontekst rynku ~co 1 s). */
const heard = new Map<string, number>();
/** Rynki, dla których trwa uzupełnianie luki w taśmie. */
const filling = new Set<string>();

function savePending(): void {
  writeJsonAtomic(pendingPath, { events: pending.events, starts: pending.starts, gone: [...pending.gone] });
}

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

/**
 * Web Push alarmu (tytuł: rynek i co się stało); błąd przejściowy usługi push — ponowienia z rosnącym odstępem
 * (`retryDelay`), dopiero potem nieudane. Kroki o niesprawdzonej luce mają wspólny znacznik rynku: na telefonie jedno
 * powiadomienie zamiast jednego na każdy alarm.
 */
async function notify(e: DeviceEvent, attempt = 0): Promise<void> {
  const d = book.devices.get(e.device);
  if (!d) return;
  const now = Date.now();
  const tag = e.hole ? `gap-${e.rule.coin}` : e.rule.id;
  const payload = { title: eventTitle(e, d.lang), body: eventBody(e, d.lang, now), tag, url: `./#charts?m=${e.rule.coin}` };
  const r = await sendPush(d, payload, keys.vapid, SUBJECT, { now });
  if (r === 'ok') {
    stats.sent++;
    if (e.type === 'fire' && !e.gap) latency.push(Date.now() - e.at);
  } else if (r === 'gone') {
    stats.gone++;
    pending.gone.add(d.id);
    book.apply({ ...d, rules: null });
  } else {
    const ms = retryDelay(attempt, typeof r === 'object' ? r.retryAfterMs : null);
    if (ms === null) stats.failed++;
    else setTimeout(() => void notify(e, attempt + 1), ms);
  }
}

/** Wynik silnika: nowa lista alarmów, zdarzenia do skrzynki (zapisane przed wysyłką) i powiadomienia. */
function apply(before: readonly AlertRule[], r: { rules: AlertRule[] | null; events: AlertEvent[] }): void {
  if (r.rules) book.rules = r.rules;
  if (r.events.length === 0) return;
  const out = book.split(r.events, before);
  book.hold(out.events);
  pending.events.push(...out.events);
  pending.starts.push(...out.starts);
  savePending();
  for (const e of out.events) if (e.type === 'fire' || e.type === 'step') void notify(e);
}

/** Świece 1m z API od `from` do `to`; null, gdy API nie odpowiedziało 3 razy. */
async function minutes(coin: string, from: number, to: number): Promise<AlertCandle[] | null> {
  const req = { type: 'candleSnapshot', req: { coin, interval: '1m', startTime: Math.floor(from / MIN) * MIN, endTime: to } };
  let raw: unknown = null;
  for (let k = 0; k < 3 && !Array.isArray(raw); k++) raw = await rest.info(req, 21);
  if (!Array.isArray(raw)) return null;
  return (raw as Record<string, unknown>[])
    .map((c) => ({ t: Number(c.t), h: Number(c.h), l: Number(c.l), c: Number(c.c) }))
    .filter((c) => c.t > 0 && c.h > 0 && c.l > 0 && c.c > 0);
}

/**
 * Luka w taśmie rynku (przerwa w połączeniu albo restart usługi): świece 1m z API od ostatniej transakcji przed luką
 * (albo od najstarszego alarmu rynku, gdy jest późniejszy) do pierwszej po niej, aż luka się zamknie. Do tego czasu
 * silnik wstrzymuje zamknięcia świec i wygaśnięcia rynku; dotknięcia z taśmy działają bez czekania.
 */
async function backfill(coin: string): Promise<void> {
  if (filling.has(coin)) return;
  filling.add(coin);
  try {
    for (let h = engine.hole(coin); h; h = engine.hole(coin)) {
      const mine = book.rules.filter((r) => r.coin === coin);
      const from = Math.max(h.from, Math.min(h.to, ...mine.map((r) => r.created)));
      const candles = mine.length > 0 && from < h.to ? await minutes(coin, from, h.to) : [];
      const before = book.rules;
      const r = engine.fillGap(before, coin, h.to, candles);
      apply(before, r);
      const what = candles ? `uzupełniona (świece 1m: ${candles.length})` : 'NIESPRAWDZONA (API nie dało świec 1m po 3 próbach)';
      log(`${coin}: luka w taśmie ${Math.round((h.to - h.from) / 1000)} s ${what}, zdarzenia: ${r.events.length}`);
    }
  } finally {
    filling.delete(coin);
  }
}

function onTrades(coin: string, hl: HlTrade[]): void {
  const trades: AlertTrade[] = [];
  for (const t of hl) {
    const px = Number(t.px);
    const sz = Number(t.sz);
    if (!(px > 0 && sz > 0) || (t.side !== 'B' && t.side !== 'A')) continue;
    trades.push({ time: t.time, px, sz, side: t.side === 'B' ? 1 : -1, key: tradeKey(t.hash, t.tid), ...(isZeroHash(t.hash) ? { zero: true } : {}) });
  }
  if (trades.length === 0) return;
  const before = book.rules;
  apply(before, engine.onTrades(before, coin, trades));
  if (engine.hole(coin)) void backfill(coin).catch((e) => log(`${coin}: błąd uzupełniania luki (${String(e)})`));
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
        engine.reset(coin);
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
        // Zamknięcie strumienia bez alarmów (watch) to nie przerwa; lukę zamyka pierwsza transakcja po powrocie połączenia
        if (streams.get(coin) === st && !up) engine.gap(coin);
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
    book.release(batch.events);
  } catch {
    // Następna próba razem z nowymi zdarzeniami
    pending = {
      events: [...batch.events, ...pending.events].slice(-PENDING_MAX),
      starts: [...batch.starts, ...pending.starts].slice(-PENDING_MAX),
      gone: new Set([...batch.gone, ...pending.gone]),
    };
  }
  savePending();
}

/** Puls dla strażnika (scripts/watchdog.mjs): czas zapisu, ostatnia synchronizacja, najstarszy ostatni komunikat HL. */
function savePulse(): void {
  writeJsonAtomic(pulsePath, { v: 1, at: Date.now(), syncAt: mailbox ? syncOkAt : null, wsAt: heard.size > 0 ? Math.min(...heard.values()) : null });
}

let saved = '';
/** Stan pilnowania i ostatnia transakcja na rynek (po restarcie od niej liczy się luka do uzupełnienia). */
function saveState(): void {
  const s = JSON.stringify({ v: 2, rules: book.snapshot(), last: engine.lastTrades() });
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
  if (latency.length > 0) {
    const l = [...latency].sort((a, b) => a - b);
    log(`opóźnienie zdarzenie z taśmy → push przyjęty (${l.length}): p50 ${quantile(l, 0.5)} ms, p95 ${quantile(l, 0.95)} ms, najwięcej ${l[l.length - 1]} ms`);
  }
  stats.sent = stats.gone = stats.failed = 0;
  latency = [];
}, 3600_000);

for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    saveState();
    for (const s of streams.values()) s.stop();
    const done = () => process.exit(0);
    void reportTick().finally(done);
    setTimeout(done, 3000).unref();
  });
