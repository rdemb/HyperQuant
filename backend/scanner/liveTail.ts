import { gzipSync } from 'node:zlib';
import { LIVE_FILE_NAME, LIVE_FILE_PREFIX, encodeTailFrames } from '../../src/utils/tailFrames.ts';
import type { TailFile } from '../../src/utils/tapeHistory.ts';

/**
 * Wysyłka gorącego ogona do przekaźnika na żywo (Cloudflare Worker `workers/live`): co `everyS` sekund ogony wszystkich
 * rejestratorów (`MarketRecorder.tail`) jako jedna paczka (ramki `src/utils/tailFrames.ts`, każdy ogon to JSON w gzip),
 * PUT z tokenem. Jedno żądanie na takt niezależnie od liczby rynków — przekaźnik mieści się w darmowym planie Cloudflare.
 * Przeglądarka pobiera ogon przy starcie, więc między ostatnią opublikowaną częścią historii a strumieniem na żywo nie ma
 * minut luki. Serwer skanera łączy się z przekaźnikiem, nigdy odwrotnie — przeglądarki dalej nie widzą jego adresu.
 *
 * Ta sama paczka niesie publiczne pliki skanera (ramki `f:<ścieżka>`: status, mapy, taśma likwidacji, kohorty, wieloryby),
 * które przekaźnik rozsyła przeglądarkom przez WebSocket — bez czekania na publikację w repo danych i pamięć CDN.
 */

/** Domyślny takt wysyłki w sekundach (HQ_LIVE_EVERY_S): 17 280 żądań na dobę, poniżej darmowych 100 000. */
export const TAIL_PUSH_S = 5;
/** Ogon jednego rynku ponad tyle bajtów (po gzip) nie jest wysyłany — przekaźnik odrzuciłby całą paczkę. */
export const TAIL_MAX_BYTES = 4 << 20;
/** Co tyle taktów wszystkie pliki, także niezmienione: przekaźnik po restarcie (pamięć obiektu) odzyskuje je w minutę. */
export const FILES_FULL_EVERY = 12;

export interface LiveConfig {
  /** Adres przekaźnika (https, bez ukośnika na końcu) */
  url: string;
  token: string;
  /** Takt wysyłki w sekundach */
  everyS: number;
}

/**
 * Paczka ogonów (i plików skanera `files`: ścieżka i JSON w gzip, ramki `f:<ścieżka>`): true po przyjęciu przez przekaźnik.
 * Ogon ponad TAIL_MAX_BYTES jest pomijany (reszta idzie); pusta paczka nie jest wysyłana (true). Błąd sieci albo odpowiedź
 * spoza 2xx — false (bez wyjątku).
 */
export async function pushTails(
  cfg: LiveConfig,
  tails: readonly TailFile[],
  fetchFn: typeof fetch = fetch,
  files: readonly (readonly [string, Uint8Array])[] = []
): Promise<boolean> {
  const tailFrames = tails.map((t) => [t.coin, gzipSync(JSON.stringify(t))] as const).filter(([, body]) => body.length <= TAIL_MAX_BYTES);
  // Nazwa spoza wzorca przekaźnika odrzuciłaby całą paczkę (także ogony) — taki plik nie idzie
  const fileFrames = files.map(([path, body]) => [`${LIVE_FILE_PREFIX}${path}`, body] as const).filter(([name]) => LIVE_FILE_NAME.test(name));
  if (tailFrames.length === 0 && tails.length > 0 && fileFrames.length === 0) return false;
  const frames = [...tailFrames, ...fileFrames];
  if (frames.length === 0) return true;
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
 * wywołuje ją timer skanera; `onResult` dostaje wynik każdej wysłanej paczki (licznik błędów w logu). `files` — bieżące
 * pliki skanera (ścieżka i treść JSON): w paczce tylko zmienione od ostatniej udanej wysyłki, co `FILES_FULL_EVERY` taktów
 * wszystkie; plik ponad TAIL_MAX_BYTES (po gzip) pominięty.
 */
export function tailPusher(
  cfg: LiveConfig,
  sources: readonly { tail: (now: number) => TailFile | null }[],
  onResult: (ok: boolean) => void = () => {},
  fetchFn: typeof fetch = fetch,
  files: () => readonly (readonly [string, string])[] = () => []
): (now: number) => Promise<void> {
  let busy = false;
  let tick = 0;
  const sent = new Map<string, string>();
  return async (now) => {
    if (busy) return;
    const tails = sources.map((s) => s.tail(now)).filter((t): t is TailFile => t !== null);
    const full = tick++ % FILES_FULL_EVERY === 0;
    const due = files().filter(([path, text]) => full || sent.get(path) !== text);
    const frames = due.map(([path, text]) => [path, gzipSync(text)] as const).filter(([, body]) => body.length <= TAIL_MAX_BYTES);
    if (tails.length === 0 && frames.length === 0) return;
    busy = true;
    try {
      const ok = await pushTails(cfg, tails, fetchFn, frames);
      if (ok) for (const [path, text] of due) sent.set(path, text);
      onResult(ok);
    } finally {
      busy = false;
    }
  };
}
