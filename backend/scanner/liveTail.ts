import { gzipSync } from 'node:zlib';
import { encodeTailFrames } from '../../src/utils/tailFrames.ts';
import type { TailFile } from '../../src/utils/tapeHistory.ts';

/**
 * Wysyłka gorącego ogona do przekaźnika na żywo (Cloudflare Worker `workers/live`): co `everyS` sekund ogony wszystkich
 * rejestratorów (`MarketRecorder.tail`) jako jedna paczka (ramki `src/utils/tailFrames.ts`, każdy ogon to JSON w gzip),
 * PUT z tokenem. Jedno żądanie na takt niezależnie od liczby rynków — przekaźnik mieści się w darmowym planie Cloudflare.
 * Przeglądarka pobiera ogon przy starcie, więc między ostatnią opublikowaną częścią historii a strumieniem na żywo nie ma
 * minut luki. Serwer skanera łączy się z przekaźnikiem, nigdy odwrotnie — przeglądarki dalej nie widzą jego adresu.
 */

/** Domyślny takt wysyłki w sekundach (HQ_LIVE_EVERY_S): 17 280 żądań na dobę, poniżej darmowych 100 000. */
export const TAIL_PUSH_S = 5;
/** Ogon jednego rynku ponad tyle bajtów (po gzip) nie jest wysyłany — przekaźnik odrzuciłby całą paczkę. */
export const TAIL_MAX_BYTES = 4 << 20;

export interface LiveConfig {
  /** Adres przekaźnika (https, bez ukośnika na końcu) */
  url: string;
  token: string;
  /** Takt wysyłki w sekundach */
  everyS: number;
}

/**
 * Paczka ogonów: true po przyjęciu przez przekaźnik. Ogon ponad TAIL_MAX_BYTES jest pomijany (reszta idzie); pusta
 * paczka nie jest wysyłana (true). Błąd sieci albo odpowiedź spoza 2xx — false (bez wyjątku).
 */
export async function pushTails(cfg: LiveConfig, tails: readonly TailFile[], fetchFn: typeof fetch = fetch): Promise<boolean> {
  const frames = tails.map((t) => [t.coin, gzipSync(JSON.stringify(t))] as const).filter(([, body]) => body.length <= TAIL_MAX_BYTES);
  if (frames.length === 0) return tails.length === 0;
  try {
    const res = await fetchFn(`${cfg.url}/v1/tails`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/octet-stream' },
      body: encodeTailFrames(frames),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Takt wysyłki: najwyżej jedna paczka naraz (wolny przekaźnik nie mnoży zapytań). Zwraca funkcję jednego taktu —
 * wywołuje ją timer skanera; `onResult` dostaje wynik każdej wysłanej paczki (licznik błędów w logu).
 */
export function tailPusher(
  cfg: LiveConfig,
  sources: readonly { tail: (now: number) => TailFile | null }[],
  onResult: (ok: boolean) => void = () => {},
  fetchFn: typeof fetch = fetch
): (now: number) => Promise<void> {
  let busy = false;
  return async (now) => {
    if (busy) return;
    const tails = sources.map((s) => s.tail(now)).filter((t): t is TailFile => t !== null);
    if (tails.length === 0) return;
    busy = true;
    try {
      onResult(await pushTails(cfg, tails, fetchFn));
    } finally {
      busy = false;
    }
  };
}
