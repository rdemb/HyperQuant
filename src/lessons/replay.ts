import { REPLAY_LINK_VERSION, replayHash } from '../charts/pro/replay/link';
import type { ExerciseSpec } from './exercises';

/** Linki budujemy tylko w znanym formacie; po zmianie wersji formatu przycisk znika, dopóki lekcje go nie poznają. */
export const REPLAY_SUPPORTED = REPLAY_LINK_VERSION === 1;

/** Adres powtórki tej samej chwili w Wykresach (kopia nagrania przy lekcjach); null, gdy ćwiczenie nie ma nagrania. */
export function exerciseReplayHash(e: ExerciseSpec): string | null {
  const r = e.replay;
  if (!r || !REPLAY_SUPPORTED) return null;
  return replayHash({
    source: 'lessons',
    coin: 'BTC',
    interval: r.interval,
    view: r.view,
    from: Date.parse(r.from),
    to: Date.parse(r.to),
    t: Date.parse(r.t),
    station: e.station,
    layers: [...r.layers],
    zone: r.zone ? [r.zone[0], r.zone[1]] : null,
  });
}
