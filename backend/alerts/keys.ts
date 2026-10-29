import { type KeyObject, createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type VapidKeys, vapidKeys } from './push.ts';

/**
 * Klucze serwera powiadomień, tworzone przy pierwszym starcie w katalogu stanu (plik 0600) i potem zawsze te same:
 * VAPID (P-256, subskrypcje przeglądarek są z nim związane) i Ed25519 (podpis zapytań do skrzynki). Części publiczne
 * trafiają do repo danych; prywatne nigdy nie opuszczają serwera.
 */
export interface ServerKeys {
  vapid: VapidKeys;
  sign: KeyObject;
  /** Klucz publiczny Ed25519 (32 B, base64url). */
  signPublic: string;
}

interface Stored {
  vapid: { d: string; x: string; y: string };
  sign: { d: string; x: string };
}

export function loadKeys(stateDir: string): ServerKeys {
  const file = join(stateDir, 'alerts-keys.json');
  let raw: Stored;
  if (existsSync(file)) raw = JSON.parse(readFileSync(file, 'utf8')) as Stored;
  else {
    const v = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    const s = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    raw = { vapid: { d: String(v.d), x: String(v.x), y: String(v.y) }, sign: { d: String(s.d), x: String(s.x) } };
    writeFileSync(`${file}.tmp`, JSON.stringify(raw), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  return {
    vapid: vapidKeys(raw.vapid),
    sign: createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', ...raw.sign }, format: 'jwk' }),
    signPublic: raw.sign.x,
  };
}
