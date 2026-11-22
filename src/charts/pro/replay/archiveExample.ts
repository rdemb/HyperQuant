import { loadVerifiedReplay, type ReplayArchiveManifest } from './archive';
import type { Fetcher } from '../store/serverHistory';

export const PUBLIC_BTC_08: ReplayArchiveManifest = {
  revision: 'e4fe9533235ee5810a69a192215f5a32e955d1f8',
  coin: 'BTC',
  from: 1795161600000,
  to: 1795165200000,
  files: {
    trades: { size: 175306, sha256: '99857fcca7cda2f68be053e5f30fb92e55ebb1b92553f3ef014114f7eb4a3685' },
    book: { size: 203229, sha256: '4838c3d7aa76e7976841c18d4e427f1296bbd11200cc095d5897a15da49f9373' },
  },
};

export const PUBLIC_BTC_08_BASE = `https://raw.githubusercontent.com/rdemb/hyperquant-data/${PUBLIC_BTC_08.revision}`;
const fetchPublic: Fetcher = url => fetch(url, { signal: AbortSignal.timeout(15_000) });

export function loadBtcArchiveExample(fetcher: Fetcher = fetchPublic, base = PUBLIC_BTC_08_BASE) {
  return loadVerifiedReplay(base, PUBLIC_BTC_08, fetcher);
}
