import { createHash, createHmac } from 'node:crypto';

/**
 * Podpis AWS Signature Version 4 dla zapytań do Cloudflare R2 (API zgodne z S3) — bez zależności zewnętrznych.
 * Zweryfikowany oficjalnym wektorem testowym AWS „get-vanilla”.
 */

export interface SignInput {
  method: string;
  url: string;
  /** Muszą zawierać `host` i `x-amz-date` (YYYYMMDDTHHMMSSZ); wszystkie podane nagłówki są podpisywane */
  headers: Record<string, string>;
  /** sha256 treści (hex) albo 'UNSIGNED-PAYLOAD' */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
const sha256Hex = (data: string) => createHash('sha256').update(data).digest('hex');

/** Kodowanie RFC 3986 każdego segmentu ścieżki (ukośniki zostają). */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export function signV4(r: SignInput): { authorization: string; canonicalRequest: string; stringToSign: string } {
  const u = new URL(r.url);
  const headers = Object.entries(r.headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = headers.map(([k]) => k).join(';');
  const query = [...u.searchParams]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    r.method.toUpperCase(),
    encodePath(u.pathname || '/'),
    query,
    headers.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders,
    r.payloadHash,
  ].join('\n');
  const amzDate = r.headers['x-amz-date'] ?? r.headers['X-Amz-Date'];
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${r.region}/${r.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${r.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, r.region), r.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${r.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
  };
}
