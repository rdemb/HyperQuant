import { lang, tr } from '../../../i18n';
import { type AlertEvent, AlertEngine, eventText, factsText, ivMs, ruleText } from '../../../utils/alertRules';
import { parseAssetCtx, parseFills } from '../hl/parse';
import { fetchCandles } from '../hl/rest';
import { MARKETS, storeFor } from '../store/proStore';
import { LOG_MAX, alertBook, alertLog, notifyAlert, primeAlertSound } from './alerts';

/**
 * Pilnowanie alarmów na stronie: każda wiadomość z transakcjami rynku z alarmem przechodzi przez silnik reguł.
 * Zdarzenia sieci, a nie zegar, więc karta w tle sprawdza tak samo szybko (przeglądarki zwalniają zegary kart w tle
 * nawet do raz na minutę). Działa od pierwszego otwarcia Wykresów do zamknięcia strony, także w innych zakładkach desku.
 */

const engine = new AlertEngine();
const watched = new Set<string>();
const seeded = new Set<string>();
const listeners = new Set<(events: AlertEvent[]) => void>();
let started = false;
let savedTitle: string | null = null;

/** Treść powiadomienia: co się stało i fakty ze świecy (wygaśnięcie: jaki był warunek). */
export function eventBody(e: AlertEvent): string {
  const head = `${e.rule.note ? `${e.rule.note} · ` : ''}${eventText(e, lang)}`;
  if (e.type === 'expire') return `${head}: ${ruleText(e.rule, lang)}.`;
  return e.facts ? `${head}. ${factsText(e.facts, e.rule.coin, lang)}` : `${head}.`;
}

/** Karta w tle: dzwonek i treść alarmu w tytule, aż do powrotu do karty. */
function flagTitle(text: string): void {
  if (document.visibilityState === 'visible') return;
  if (savedTitle === null) {
    savedTitle = document.title;
    const restore = () => {
      if (document.visibilityState !== 'visible' || savedTitle === null) return;
      document.title = savedTitle;
      savedTitle = null;
      document.removeEventListener('visibilitychange', restore);
    };
    document.addEventListener('visibilitychange', restore);
  }
  document.title = `🔔 ${text}`;
}

function onTrades(coin: string, data: unknown): void {
  const fills = parseFills(data, coin);
  if (fills.length === 0) return;
  const trades = fills.map((f) => ({ time: f.time, px: f.px, sz: f.sz, side: f.side, key: f.hash || `t${f.tid}` }));
  const { rules, events } = engine.onTrades(alertBook.get(), coin, trades);
  if (rules) alertBook.update(() => rules);
  if (events.length === 0) return;
  alertLog.update((l) => [...[...events].reverse(), ...l].slice(0, LOG_MAX));
  for (const e of events) if (e.type !== 'cancel') notifyAlert(eventBody(e), e.rule.id, e.type === 'fire');
  const fired = events.find((e) => e.type === 'fire');
  if (fired) flagTitle(eventText(fired, lang));
  listeners.forEach((fn) => fn(events));
}

/** Średni wolumen do faktów: zamknięte świece interwału z API (raz na rynek i interwał na stronę). */
function seed(coin: string, iv: string): void {
  const k = `${coin}:${iv}`;
  if (seeded.has(k)) return;
  seeded.add(k);
  const now = Date.now();
  fetchCandles(coin, iv, now - 25 * ivMs(iv), now)
    .then((c) => engine.seedVolumes(coin, iv, c, Date.now()))
    .catch(() => seeded.delete(k));
}

/** Rynki z alarmami dostają strumień (raz otwarty nagrywa dalej) i słuchacza transakcji oraz kontekstu. */
function watch(): void {
  const list = alertBook.get();
  for (const m of MARKETS) {
    if (!list.some((a) => a.coin === m)) continue;
    for (const iv of engine.intervals(list, m)) if (iv !== '1m') seed(m, iv);
    if (watched.has(m)) continue;
    watched.add(m);
    const st = storeFor(m);
    st.stream.listen({
      onMessage: (ch, data) => {
        if (ch === 'trades') onTrades(m, data);
        else if (ch === 'activeAssetCtx') {
          const d = data as { coin?: unknown; ctx?: unknown } | null;
          const ctx = d?.coin === m ? parseAssetCtx(d.ctx) : null;
          if (ctx) engine.onOi(m, ctx.openInterest);
        }
      },
      onClosed: () => engine.gap(m),
    });
    st.start();
  }
}

/** Start pilnowania (raz na stronę); dźwięk odblokowuje pierwsze dotknięcie strony. */
export function startAlertWatch(): void {
  if (started) return;
  started = true;
  watch();
  alertBook.subscribe(watch);
  window.addEventListener('pointerdown', primeAlertSound, { once: true, capture: true });
}

/** Zdarzenia alarmów (komunikat na wykresie). */
export function onAlertEvents(fn: (events: AlertEvent[]) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test z panelu: sygnał i przykładowe powiadomienie. */
export function testAlert(): void {
  primeAlertSound();
  notifyAlert(tr('Test alarmu: tak wygląda powiadomienie z HyperQuant.', 'Alert test: this is how a HyperQuant notification looks.'), 'hq-test');
}
