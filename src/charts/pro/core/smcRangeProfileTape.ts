import type { Coverage } from './coverage';
import { btcNotionalMicros, type ProfileSpan } from './smcRangeProfile';
import type { PriceBucket } from './smcRangeProfileFlow';
import type { Tape } from './tape';

const WINDOW_MS = 10_000;

export interface TapeWindow extends ProfileSpan {
  coverage: 'full' | 'partial' | 'gap';
}

export interface TapeCell {
  buy: bigint;
  sell: bigint;
}

export function rangeTapeWindows(span: ProfileSpan, coverage: Pick<Coverage, 'coveredMs'>): TapeWindow[] {
  return [2, 1, 0].map(offset => {
    const to = span.to - offset * WINDOW_MS;
    // Milisekundy z okna (T−10 s, T] zapisujemy jako [od, do), wspólne dla taśmy i pokrycia.
    const end = Math.floor(to) + 1;
    const from = Math.min(end, Math.max(Math.ceil(span.from), end - WINDOW_MS));
    const covered = coverage.coveredMs(from, end);
    return { from, to: end, coverage: covered === WINDOW_MS ? 'full' : covered > 0 ? 'partial' : 'gap' };
  });
}

export function readRangeTape(tape: Tape, windows: readonly TapeWindow[], bands: readonly PriceBucket[]) {
  const byPrice = new Map<number, (TapeCell | undefined)[]>();
  let maxSide = 0n;
  if (!bands.length) return { byPrice, maxSide };

  windows.forEach(({ from, to }, index) => {
    if (from >= to) return;
    tape.forEach(from, to, (_time, price, size, side) => {
      const band = bands.find(({ low, high }) => price >= low && price < high);
      if (!band || !Number.isFinite(price * size)) return;
      const notional = btcNotionalMicros(price, size);
      if (notional <= 0n) return;
      let cells = byPrice.get(band.low);
      if (!cells) {
        cells = Array<TapeCell | undefined>(windows.length).fill(undefined);
        byPrice.set(band.low, cells);
      }
      const cell = cells[index] ??= { buy: 0n, sell: 0n };
      const total = side === 1 ? (cell.buy += notional) : (cell.sell += notional);
      if (total > maxSide) maxSide = total;
    });
  });
  return { byPrice, maxSide };
}
