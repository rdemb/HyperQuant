/**
 * Wspólne ustalenia powiadomień 24/7 dla strony, skrzynki (Cloudflare Worker) i serwera powiadomień na VPS.
 */

/** Adres skrzynki alarmów (pusty = powiadomienia 24/7 niewdrożone: strona ich nie proponuje, serwer czeka). */
export const ALERTS_URL: string = 'https://hyperquant-alerts.hyperquant-desk.workers.dev';

/**
 * Usługi push przeglądarek (Google, Mozilla, Apple, Microsoft). Adres subskrypcji przychodzi od odwiedzającego, więc
 * skrzynka przyjmuje i serwer wysyła tylko na te adresy (https, bez portu, bez danych logowania w adresie).
 */
const PUSH_HOST = /^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

export function pushHostOk(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && u.port === '' && u.username === '' && PUSH_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** Wiadomość podpisywana kluczem Ed25519 serwera przy każdym zapytaniu do skrzynki: metoda, ścieżka z zapytaniem, czas (ms), treść. */
export const signedMessage = (method: string, path: string, time: number, body: string): string => `${method}\n${path}\n${time}\n${body}`;
