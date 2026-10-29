import { createDecipheriv, createECDH, createHmac, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pushHostOk } from '../../../src/utils/alertsServer.ts';
import { b64u, encryptPayload, fromB64u, sendPush, vapidAuth, vapidKeys } from '../push.ts';

// Przykład z RFC 8291, dodatek A (stałe klucze i sól)
const RFC = {
  plain: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** Odszyfrowanie po stronie przeglądarki (klucz prywatny subskrypcji), jak w RFC 8291. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const h = (k: Uint8Array, d: Uint8Array) => createHmac('sha256', k).update(d).digest();
  const one = Buffer.from([1]);
  const ikm = h(h(auth, ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic, one]));
  const prk = h(salt, ikm);
  const cek = h(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), one])).subarray(0, 16);
  const nonce = h(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), one])).subarray(0, 12);
  const data = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(-16));
  const out = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
  expect(out.at(-1)).toBe(2);
  return out.subarray(0, -1).toString();
}

describe('Web Push: szyfrowanie aes128gcm', () => {
  it('daje dokładnie pakiet z przykładu RFC 8291', () => {
    const out = encryptPayload(Buffer.from(RFC.plain), { p256dh: RFC.uaPublic, auth: RFC.auth }, fromB64u(RFC.asPrivate), fromB64u(RFC.salt));
    expect(b64u(out)).toBe(RFC.body);
  });

  it('przeglądarka odczytuje treść z losowym kluczem i solą (polskie znaki)', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const text = JSON.stringify({ body: 'Świeca 15m zamknięta pod poziomem' });
    const out = encryptPayload(Buffer.from(text), { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) });
    expect(decrypt(out, ua.getPrivateKey(), auth)).toBe(text);
  });

  it('odrzuca złe klucze subskrypcji', () => {
    expect(() => encryptPayload(Buffer.from('x'), { p256dh: b64u(Buffer.alloc(33, 2)), auth: RFC.auth })).toThrow();
    expect(() => encryptPayload(Buffer.from('x'), { p256dh: RFC.uaPublic, auth: b64u(Buffer.alloc(8)) })).toThrow();
  });
});

describe('Web Push: VAPID i wysyłka', () => {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string };
  const keys = vapidKeys(jwk);
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64u(ua.getPublicKey()), auth: b64u(Buffer.alloc(16, 1)) };

  it('token VAPID: odbiorca, ważność 12 h, podpis ES256 sprawdzalny kluczem publicznym', () => {
    const now = 1_800_000_000_000;
    const h = vapidAuth(target.endpoint, keys, 'https://rdemb.github.io/HyperQuant/', now);
    const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h) ?? [];
    expect(k).toBe(keys.publicKey);
    const [head, claims, sig] = t.split('.');
    expect(JSON.parse(fromB64u(claims).toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 43_200, sub: 'https://rdemb.github.io/HyperQuant/' });
    const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${head}.${claims}`), { key: pub, dsaEncoding: 'ieee-p1363' }, fromB64u(sig))).toBe(true);
  });

  it('wysyła tylko do usług push przeglądarek', () => {
    expect(pushHostOk('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(pushHostOk('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(pushHostOk('https://web.push.apple.com/x')).toBe(true);
    expect(pushHostOk('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(pushHostOk('http://fcm.googleapis.com/x')).toBe(false);
    expect(pushHostOk('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(pushHostOk('https://169.254.169.254/latest')).toBe(false);
    expect(pushHostOk('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(pushHostOk('https://user@fcm.googleapis.com/x')).toBe(false);
  });

  it('wynik wysłania: 201 ok, 410 wygasła, 500 i błąd sieci przejściowe; nagłówki usługi push', async () => {
    const calls: RequestInit[] = [];
    const reply = (status: number) => (async (_u: unknown, init?: RequestInit) => (calls.push(init ?? {}), new Response(null, { status }))) as typeof fetch;
    expect(await sendPush(target, { body: 'x' }, keys, 'mailto:a@b.c', { fetchFn: reply(201) })).toBe('ok');
    expect(await sendPush(target, { body: 'x' }, keys, 'mailto:a@b.c', { fetchFn: reply(410) })).toBe('gone');
    expect(await sendPush(target, { body: 'x' }, keys, 'mailto:a@b.c', { fetchFn: reply(500) })).toBe('error');
    const fail = (async () => {
      throw new Error('net');
    }) as typeof fetch;
    expect(await sendPush(target, { body: 'x' }, keys, 'mailto:a@b.c', { fetchFn: fail })).toBe('error');
    expect(await sendPush({ ...target, endpoint: 'https://evil.example/x' }, { body: 'x' }, keys, 'mailto:a@b.c', { fetchFn: reply(201) })).toBe('gone');
    expect(calls[0].headers).toMatchObject({ 'content-encoding': 'aes128gcm', ttl: '900', urgency: 'high' });
  });
});
