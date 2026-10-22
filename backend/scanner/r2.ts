import { createHash } from 'node:crypto';
import type { R2Config } from './config.ts';
import { signV4 } from './sigv4.ts';

/** `YYYYMMDDTHHMMSSZ` dla nagłówka x-amz-date. */
function amzDate(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Zapis obiektu do Cloudflare R2 (API zgodne z S3, region `auto`) z podpisem SigV4.
 * Przeglądarki czytają bucket publicznie — serwer skanera nigdy nie jest dla nich widoczny.
 */
export async function putObject(
  cfg: R2Config,
  key: string,
  body: string,
  opts: { contentType?: string; cacheControl?: string; now?: number; fetchFn?: typeof fetch } = {}
): Promise<boolean> {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${cfg.bucket}/${key}`;
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const signed = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate(opts.now ?? Date.now()) };
  const { authorization } = signV4({
    method: 'PUT',
    url,
    headers: signed,
    payloadHash,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: 'auto',
    service: 's3',
  });
  try {
    const res = await (opts.fetchFn ?? fetch)(url, {
      method: 'PUT',
      headers: {
        ...signed,
        authorization,
        'content-type': opts.contentType ?? 'application/json',
        'cache-control': opts.cacheControl ?? 'public, max-age=30',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
