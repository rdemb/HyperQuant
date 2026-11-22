import { HIST_PART_MS, historyPath, type HistKind } from '../../../utils/tapeHistory';
import {
  compressedLimit, readBounded, validManifest, verifyHistoryChannel,
  type ArchiveChannel, type ReplayArchiveManifest,
} from '../../../utils/verifiedHistory';
import type { Fetcher } from '../store/serverHistory';
import { joinUnits, type ReplayData } from './data';

export { describeArchiveBytes, type ArchiveChannel, type ReplayArchiveManifest } from '../../../utils/verifiedHistory';

export type VerifiedReplay = {
  revision: string;
  manifest: ReplayArchiveManifest;
  trades: ArchiveChannel;
  book: ArchiveChannel;
  data: ReplayData;
};

/** Reads one pinned v1 unit. The caller supplies the trusted manifest and immutable base URL. */
export async function loadVerifiedReplay(
  base: string, manifest: ReplayArchiveManifest, fetcher: Fetcher,
): Promise<VerifiedReplay> {
  if (!validManifest(manifest)) throw new Error('Invalid replay archive manifest');
  const { revision, coin, from, to } = manifest;
  const part = to - from === HIST_PART_MS;
  const load = async (kind: HistKind): Promise<{ status: ArchiveChannel; raw?: unknown }> => {
    const url = `${base}/${historyPath(coin, from, kind, part)}`;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const response = await fetcher(url);
      if (response.status === 404 || response.status === 410) return { status: { kind: 'missing' } };
      if (!response.ok) return { status: { kind: 'read-failed' } };
      if (!response.body) return { status: { kind: 'integrity-mismatch' } };
      bytes = await readBounded(response.body, compressedLimit);
    } catch {
      return { status: { kind: 'read-failed' } };
    }
    return verifyHistoryChannel(kind, manifest, bytes);
  };
  const [trades, book] = await Promise.all([load('trades'), load('book')]);
  const data = joinUnits(coin, [{ unit: { start: from, part }, trades: trades.raw, book: book.raw }]);
  // A v1 declared span cannot establish transport continuity across a reconnect.
  // The raw observations remain usable in explicitly retrospective queries.
  data.spans = [];
  data.zeroSpans = [];
  data.bookSpans = [];
  return { revision, manifest, trades: trades.status, book: book.status, data };
}
