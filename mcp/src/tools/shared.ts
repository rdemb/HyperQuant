/**
 * Wspólne pomocniki narzędzi: świece jako `Got`, cena z ostatniej świecy 1m, opisy źródeł w kopercie, uwaga o wieku migawki
 * skanera i opis poziomu z bloga.
 */
import type { Candle } from '../../../src/charts/pro/hl/parse';
import { tr } from '../../../src/i18n';
import { scannerAge } from '../../../src/utils/scanState';
import { type Got, isAbsent } from '../../../src/utils/sessionText';
import { type Num, type SourceRef, iso, num } from '../envelope';
import type { CandleInterval, Fetched } from '../sources';

/** Świece z Hyperliquid jako `Got`: nieudane żądanie albo pusta lista — powód (nigdy liczba z braku danych). */
export function candlesGot(c: Fetched<Candle[]>, iv: CandleInterval): Got<Candle[]> {
  if (!c.ok) return { why: tr(`świece ${iv} Hyperliquid niedostępne (${c.why})`, `Hyperliquid ${iv} candles unavailable (${c.why})`) };
  if (c.value.length === 0) return { why: tr(`Hyperliquid nie zwrócił świec ${iv}`, `Hyperliquid returned no ${iv} candles`) };
  return c.value;
}

export const candleSource = (iv: CandleInterval, c: Fetched<Candle[]>): SourceRef => ({ name: `Hyperliquid candleSnapshot BTC ${iv}`, url: c.url, asOf: c.ok ? iso(c.at) : null });

/** Plik z repo danych: czas danych według pliku (`asOf`), inaczej chwila pobrania; nieudane pobranie — null. */
export const fileSource = (name: string, f: Fetched<unknown>): SourceRef => ({ name, url: f.url, asOf: f.ok ? iso(f.asOf ?? f.at) : null });

/** Cena: zamknięcie ostatniej świecy 1m (w chwili pobrania świec); bez świec — null z powodem. */
export function closeNum(c1: Got<Candle[]>): Num {
  if (isAbsent(c1)) return num(null, 'price', 'LIVE', { why: c1.why });
  const last = c1[c1.length - 1];
  return num(last.c, 'price', 'LIVE', { note: tr(`zamknięcie świecy 1m z ${iso(last.t)}`, `close of the 1m candle from ${iso(last.t)}`) });
}

/** Uwaga o wieku migawki skanera starszej niż 2 min (`scannerAge`, jak plakietka warstwy na wykresie); świeża — brak uwagi. */
export function ageNote(asOf: number, now: number): string | undefined {
  const age = scannerAge(asOf, now);
  return age === null ? undefined : tr(`migawka skanera sprzed ${age} (stan z ${iso(asOf)})`, `scanner snapshot from ${age} ago (as of ${iso(asOf)})`);
}

/** Opis ceny poziomu z mapy z bloga (`day_map`, `market_brief`). */
export const BLOG_LEVEL_NOTE = tr('poziom z wpisu na blogu (tekst autora, nie model)', 'level from the blog post (author text, not a model)');
