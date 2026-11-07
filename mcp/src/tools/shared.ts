/** Wspólne pomocniki narzędzi: świece jako `Got`, cena z ostatniej świecy 1m i opisy źródeł w kopercie. */
import type { Candle } from '../../../src/charts/pro/hl/parse';
import { tr } from '../../../src/i18n';
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
