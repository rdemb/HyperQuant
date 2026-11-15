/**
 * Usługa hyperquant-tematy: co 30 s świece BTC z publicznego API Hyperliquid (1m z 20 min, 1d z 3 dób), katalog
 * warunków (`katalog.ts`) i publikacja zdarzeń do tematów ntfy `${HQ_TOPIC_PREFIX}-<temat>` na naszym serwerze.
 *
 * Środowisko (/etc/hyperquant/topics.env, 0600, root):
 * - HQ_TOPICS=1 — publikacja włączona; bez niej usługa tylko liczy i pisze do dziennika liczbę zdarzeń (próba na sucho).
 * - HQ_NTFY_URL — adres serwera ntfy (lokalnie http://127.0.0.1:2586), HQ_NTFY_TOKEN — token wydawcy (tylko zapis
 *   tematów z przedrostkiem). Token nigdy nie trafia do dziennika.
 * - HQ_TOPIC_PREFIX — przedrostek tematów (domyślnie hq-btc), HQ_STATE_DIR — katalog stanu (przerwy i liczniki).
 * Cofnięcie: HQ_TOPICS=0 (albo usunięcie pliku) i `systemctl stop hyperquant-tematy`.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { type TopicEvent, type TopicState, emptyState, evaluate, snapFrom } from './katalog.ts';

const API = 'https://api.hyperliquid.xyz/info';
const env = process.env;
const enabled = env.HQ_TOPICS === '1';
const ntfyUrl = (env.HQ_NTFY_URL ?? '').replace(/\/+$/, '');
const token = env.HQ_NTFY_TOKEN ?? '';
const prefix = (env.HQ_TOPIC_PREFIX ?? 'hq-btc').trim();
const stateFile = join(env.HQ_STATE_DIR ?? '/var/lib/hyperquant/state', 'topics-state.json');
if (!/^[a-z0-9-]{2,40}$/.test(prefix)) throw new Error('HQ_TOPIC_PREFIX: małe litery, cyfry i myślnik');
if (enabled && (!/^https?:\/\//.test(ntfyUrl) || !/^tk_[a-z0-9]{29}$/i.test(token))) throw new Error('HQ_TOPICS=1 wymaga HQ_NTFY_URL i HQ_NTFY_TOKEN (tk_…)');

async function candles(interval: '1m' | '1d', ms: number): Promise<{ t: number; h: number; l: number; c: number }[]> {
  const now = Date.now();
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval, startTime: now - ms, endTime: now } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Hyperliquid ${r.status}`);
  const a = (await r.json()) as { t: number; h: string; l: string; c: string }[];
  return a.map((b) => ({ t: b.t, h: Number(b.h), l: Number(b.l), c: Number(b.c) })).filter((b) => Number.isFinite(b.c));
}

function load(): TopicState {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8')) as TopicState;
    return s && typeof s === 'object' && 'last' in s ? s : emptyState();
  } catch {
    return emptyState();
  }
}
function save(s: TopicState): void {
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(s));
  renameSync(`${stateFile}.tmp`, stateFile);
}

async function publish(e: TopicEvent): Promise<number> {
  const r = await fetch(`${ntfyUrl}/${prefix}-${e.topic}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Title: encodeURIComponent(e.title), Tags: e.tags, 'X-Title-Encoding': 'uri' },
    body: e.message,
    signal: AbortSignal.timeout(10_000),
  });
  return r.status;
}

let state = load();
let sent = 0;
let dry = 0;

async function tick(): Promise<void> {
  const [m1, d1] = await Promise.all([candles('1m', 20 * 60_000), candles('1d', 3 * 86_400_000)]);
  const snap = snapFrom(Date.now(), m1, d1);
  if (!snap) return;
  const r = evaluate(state, snap);
  for (const e of r.events) {
    if (!enabled) {
      dry++;
      continue;
    }
    const code = await publish(e).catch(() => 0);
    if (code === 200) sent++;
    else console.error(`[tematy] publikacja ${e.topic}: kod ${code}`);
  }
  state = r.state;
  save(state);
}

setInterval(() => void tick().catch((e) => console.error(`[tematy] ${String(e).slice(0, 200)}`)), 30_000);
setInterval(() => console.log(`[tematy] ${enabled ? `wysłane ${sent}` : `próba na sucho: zdarzeń ${dry}`} (godzina)`), 3_600_000);
console.log(`[tematy] start: ${enabled ? 'publikacja włączona' : 'próba na sucho (HQ_TOPICS≠1)'}, tematy ${prefix}-*`);
void tick().catch((e) => console.error(`[tematy] ${String(e).slice(0, 200)}`));
