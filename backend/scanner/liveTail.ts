import { gzipSync } from 'node:zlib';
import type { TailFile } from '../../src/utils/tapeHistory.ts';

/**
 * Wysyłka gorącego ogona do przekaźnika na żywo (Cloudflare Worker `workers/live`): co TAIL_PUSH_MS ogon każdego
 * rejestratora (`MarketRecorder.tail`) jako JSON w gzip, PUT z tokenem. Przeglądarka pobiera ogon przy starcie,
 * więc między ostatnią opublikowaną częścią historii a strumieniem na żywo nie ma minut luki. Serwer skanera
 * łączy się z przekaźnikiem, nigdy odwrotnie — przeglądarki dalej nie widzą jego adresu.
 */

export const TAIL_PUSH_MS = 3_000;
/** Treść ponad tyle bajtów (po gzip) nie jest wysyłana — przekaźnik i tak by ją odrzucił. */
export const TAIL_MAX_BYTES = 4 << 20;

export interface LiveConfig {
  /** Adres przekaźnika (https, bez ukośnika na końcu) */
  url: string;
  token: string;
}

/** Jeden ogon: true po przyjęciu przez przekaźnik. Błąd sieci albo odpowiedź spoza 2xx — false (bez wyjątku). */
export async function pushTail(cfg: LiveConfig, tail: TailFile, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const body = gzipSync(JSON.stringify(tail));
  if (body.length > TAIL_MAX_BYTES) return false;
  try {
    const res = await fetchFn(`${cfg.url}/v1/tail/${encodeURIComponent(tail.coin)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/octet-stream' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Takt wysyłki: dla każdego źródła ogona najwyżej jedna wysyłka naraz (wolny przekaźnik nie mnoży zapytań).
 * Zwraca funkcję jednego taktu — wywołuje ją timer skanera; `onResult` dostaje wynik każdej wysyłki (licznik błędów w logu).
 */
export function tailPusher(
  cfg: LiveConfig,
  sources: readonly { coin: string; tail: (now: number) => TailFile | null }[],
  onResult: (coin: string, ok: boolean) => void = () => {},
  fetchFn: typeof fetch = fetch
): (now: number) => Promise<void> {
  const busy = new Set<string>();
  return async (now) => {
    await Promise.all(
      sources.map(async (s) => {
        if (busy.has(s.coin)) return;
        const tail = s.tail(now);
        if (!tail) return;
        busy.add(s.coin);
        try {
          onResult(s.coin, await pushTail(cfg, tail, fetchFn));
        } finally {
          busy.delete(s.coin);
        }
      })
    );
  };
}
