import { MACRO_EVENTS, type MacroEvent } from '../../data/macroCalendar';
import type { Forecast } from '../../utils/schrodi';
import type { MoveLevel } from './moveLevel';
import type { Mood } from './SchrodiCat';

// Lekka część kota dla paska pod wykresem: nastrój bez całego dymka (SchrodiPanel ładuje się dopiero po kliknięciu)
const MIN = 60_000;

/** Najbliższe zdarzenie o wysokiej wadze w ciągu doby (albo trwające do 15 min po publikacji). */
export function nextMacro(now: number): MacroEvent | null {
  return MACRO_EVENTS.find((e) => e.importance === 'high' && e.timeUtcMs > now - 15 * MIN && e.timeUtcMs - now <= 24 * 60 * MIN) ?? null;
}

/** Nastrój kota: chowa się bez danych, nerwowy przed makro, czujny przy podwyższonym ruchu, drzemie przy spokojnym. */
export function moodOf(f: Forecast | null, now: number, stale: boolean, level: MoveLevel | null): Mood {
  if (!f || stale) return 'hiding';
  const ev = nextMacro(now);
  if (ev && Math.abs(ev.timeUtcMs - now) <= 60 * MIN) return 'nervous';
  if (level === 'elevated') return 'alert';
  if (level === 'calm') return 'sleep';
  return 'calm';
}
