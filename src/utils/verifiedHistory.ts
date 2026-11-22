import { clipSpans, decodeBook, decodeTrades, HIST_HOUR_MS, HIST_PART_MS, HISTORY_VERSION, type HistKind, type HistSpan } from './tapeHistory.ts';
import { isHip3DeskMarket } from '../config/deskMarkets.ts';

export type ArchiveFile = { size: number; sha256: string };
export type ReplayArchiveManifest = {
  revision: string;
  coin: string;
  from: number;
  to: number;
  files: Record<HistKind, ArchiveFile>;
};

type RejectedChannel = {
  kind: 'missing' | 'read-failed' | 'integrity-mismatch' | 'invalid-gzip-or-json'
    | 'unsupported-version' | 'scope-mismatch' | 'invalid-records';
};
export type ArchiveChannel = RejectedChannel | {
  kind: 'verified';
  observations: number;
  declaredSpans: HistSpan[];
  declaredGaps: HistSpan[];
  continuity: 'unverified';
};
export const compressedLimit = 32 * 1024 * 1024;
const decodedLimit = 128 * 1024 * 1024;
const minuteMs = 60_000;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function describeArchiveBytes(bytes: Uint8Array<ArrayBuffer>): Promise<ArchiveFile> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { size: bytes.byteLength, sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') };
}

export function validManifest(m: ReplayArchiveManifest): boolean {
  if (!m.revision || !Number.isSafeInteger(m.from) || m.from < 0 || !Number.isSafeInteger(m.to)) return false;
  const span = m.to - m.from;
  if ((span !== HIST_PART_MS && span !== HIST_HOUR_MS) || m.from % span !== 0) return false;
  return (['trades', 'book'] as const).every(kind => {
    const file = m.files[kind];
    return Number.isSafeInteger(file.size) && file.size > 0 && file.size <= compressedLimit && /^[0-9a-f]{64}$/.test(file.sha256);
  });
}

export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Archive exceeds byte limit');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function verifyHistoryChannel(
  kind: HistKind, manifest: ReplayArchiveManifest, bytes: Uint8Array<ArrayBuffer>,
): Promise<{ status: ArchiveChannel; raw?: unknown }> {
  const expected = manifest.files[kind];
  if (bytes.byteLength !== expected.size || (await describeArchiveBytes(bytes)).sha256 !== expected.sha256) {
    return { status: { kind: 'integrity-mismatch' } };
  }
  let raw: unknown;
  try {
    const decoded = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), decodedLimit);
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
  } catch {
    return { status: { kind: 'invalid-gzip-or-json' } };
  }
  if (!record(raw) || typeof raw.v !== 'number') return { status: { kind: 'invalid-records' } };
  if (raw.v !== HISTORY_VERSION) return { status: { kind: 'unsupported-version' } };
  const { from, to, coin } = manifest;
  if (raw.coin !== coin || raw.from !== from || raw.to !== to) return { status: { kind: 'scope-mismatch' } };

  const inScope = (t: unknown): t is number => typeof t === 'number' && Number.isSafeInteger(t) && t >= from && t < to;
  const validSpan = (span: unknown): span is HistSpan => Array.isArray(span) && span.length === 2
    && inScope(span[0]) && Number.isSafeInteger(span[1]) && span[1] > span[0] && span[1] <= to;
  if (!Array.isArray(raw.spans) || !raw.spans.every(validSpan)) return { status: { kind: 'invalid-records' } };

  let observations: number;
  if (kind === 'trades') {
    const data = decodeTrades(raw);
    if (!data || !Array.isArray(raw.t) || data.trades.length !== raw.t.length
      || !unique(data.trades.map(t => `${t.t}:${t.tid}`))
      || !data.trades.every(t => inScope(t.t) && Number.isSafeInteger(t.tid) && t.tid >= 0)
      || !unique(data.ctx.map(c => c.t)) || !data.ctx.every(c => inScope(c.t) && (isHip3DeskMarket(coin) || c.t % minuteMs === 0))) {
      return { status: { kind: 'invalid-records' } };
    }
    observations = data.trades.length;
  } else {
    const data = decodeBook(raw);
    // Unlike aggregated views, exact v1 snapshots at the same millisecond have no sequence to disambiguate them.
    if (!data || !Array.isArray(raw.frames) || data.frames.length !== raw.frames.length
      || !unique(data.frames.map(f => `${f.t}:${f.step}:${!!f.exact}`))
      || !unique(data.frames.filter(f => f.exact === true).map(f => f.t))
      || !data.frames.every(f => inScope(f.t) && Number.isFinite(f.step)
        && validLevels(f.bids, false) && validLevels(f.asks, true))) {
      return { status: { kind: 'invalid-records' } };
    }
    observations = data.frames.length;
  }

  const declaredSpans = clipSpans(raw.spans, from, to);
  const declaredGaps: HistSpan[] = [];
  let cursor = from;
  for (const [start, end] of declaredSpans) {
    if (cursor < start) declaredGaps.push([cursor, start]);
    cursor = end;
  }
  if (cursor < to) declaredGaps.push([cursor, to]);
  return { status: { kind: 'verified', observations, declaredSpans, declaredGaps, continuity: 'unverified' }, raw };
}

const unique = (keys: readonly (string | number)[]) => new Set(keys).size === keys.length;

function validLevels(levels: readonly number[], ascending: boolean): boolean {
  for (let i = 0; i < levels.length; i += 3) {
    const [px, size, count] = [levels[i], levels[i + 1], levels[i + 2]];
    if (px <= 0 || size <= 0 || count < 0 || !Number.isSafeInteger(count)) return false;
    if (i > 0 && (ascending ? px <= levels[i - 3] : px >= levels[i - 3])) return false;
  }
  return true;
}
