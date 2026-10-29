import { type KeyObject, createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { pushHostOk } from '../../src/utils/alertsServer.ts';

/**
 * Web Push bez bibliotek: szyfrowanie treści aes128gcm (RFC 8291 na RFC 8188) i podpis VAPID (RFC 8292), tylko node:crypto.
 * Usługa push przeglądarki (Google, Mozilla, Apple, Microsoft) widzi wyłącznie zaszyfrowany pakiet; odczyta go tylko
 * przeglądarka, która dała klucze subskrypcji.
 */

export const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
export const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

/** Subskrypcja z przeglądarki: adres usługi push i klucze (p256dh: publiczny P-256 65 B, auth: 16 B). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const hmac = (key: Uint8Array, data: Uint8Array): Buffer => createHmac('sha256', key).update(data).digest();
/** HKDF-Expand dla jednego bloku (wynik do 32 B). */
const expand = (prk: Uint8Array, info: Uint8Array, len: number): Buffer => hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

/**
 * Treść zaszyfrowana dla jednej subskrypcji: nagłówek (sól, rozmiar rekordu, klucz nadawcy) i jeden rekord AES-128-GCM.
 * `ephemeral` i `salt` podaje tylko test (wektor z RFC 8291); normalnie każde wysłanie ma nowy klucz i sól.
 */
export function encryptPayload(plain: Uint8Array, target: Pick<PushTarget, 'p256dh' | 'auth'>, ephemeral?: Uint8Array, salt: Uint8Array = randomBytes(16)): Buffer {
  const uaPublic = fromB64u(target.p256dh);
  const authSecret = fromB64u(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('nieprawidłowe klucze subskrypcji');
  const ecdh = createECDH('prime256v1');
  if (ephemeral) ecdh.setPrivateKey(ephemeral);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const ikm = expand(hmac(authSecret, secret), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // Jeden rekord: treść i ogranicznik 0x02 (ostatni rekord)
  const body = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Klucze VAPID serwera (P-256): publiczny w formie 65 B dla przeglądarek, prywatny jako JWK. */
export interface VapidKeys {
  publicKey: string;
  privateKey: KeyObject;
}

export function vapidKeys(jwk: { d: string; x: string; y: string }): VapidKeys {
  const privateKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', ...jwk }, format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), privateKey };
}

/** Nagłówek Authorization VAPID dla usługi push adresu `endpoint` (token ważny 12 h). */
export function vapidAuth(endpoint: string, keys: VapidKeys, subject: string, now: number): string {
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const sig = sign('sha256', Buffer.from(unsigned), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Wynik wysłania: doręczone usłudze push, subskrypcja wygasła (do usunięcia) albo błąd przejściowy. */
export type PushResult = 'ok' | 'gone' | 'error';

/** Wysłanie jednego powiadomienia; `ttlS` — jak długo usługa ma czekać na urządzenie bez sieci. */
export async function sendPush(
  target: PushTarget,
  payload: object,
  keys: VapidKeys,
  subject: string,
  opts: { ttlS?: number; now?: number; fetchFn?: typeof fetch } = {}
): Promise<PushResult> {
  if (!pushHostOk(target.endpoint)) return 'gone';
  let body: Buffer;
  try {
    body = encryptPayload(Buffer.from(JSON.stringify(payload)), target);
  } catch {
    return 'gone';
  }
  try {
    const res = await (opts.fetchFn ?? fetch)(target.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidAuth(target.endpoint, keys, subject, opts.now ?? Date.now()),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(opts.ttlS ?? 900),
        urgency: 'high',
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
