import { replayHash } from '../../charts/pro/replay/link';
import type { TradeSession } from '../../utils/sessionDay';

/** Serwer trzyma nagranie taśmy i arkusza przez 7 dni — starsze minuty nie mają powtórki. */
export const REPLAY_KEEP_MS = 7 * 24 * 3_600_000;

/**
 * Link do powtórki minuty `at` wiersza Rozliczenia w układzie Rozliczenie (5m): zakres od otwarcia sesji (albo od wcześniejszej
 * minuty, np. dotknięcia mapy w Azji) do końca sesji, a sesji w toku — do teraz. Tylko minuty z ostatnich 7 dni (starsze
 * nagranie serwer już usunął); brak minuty albo minuta z przyszłości — null.
 */
export function reviewReplay(at: number | null, s: TradeSession, now: number): string | null {
  if (at === null || !Number.isFinite(at) || at > now || now - at > REPLAY_KEEP_MS) return null;
  return replayHash({
    source: 'history',
    coin: 'BTC',
    interval: '5m',
    from: Math.max(Math.min(s.start, at), now - REPLAY_KEEP_MS),
    to: Math.min(s.end, now),
    t: at,
    station: 'review',
  });
}
