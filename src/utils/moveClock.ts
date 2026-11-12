/**
 * Zegar ruchu (projekt B) przed awansem kalibracji `cat-cal-v1` — czyste funkcje dla skanera (podsumowanie), strony
 * i serwera MCP:
 *  - najbliższa godzina (okno prognozy kota, 60 min od jej startu): poziom bez procentu — tercyl `pBig` ostatniej prognozy
 *    wśród rozstrzygniętych prognoz z 14 dni (od 96); procent jako szansa dopiero po awansie;
 *  - godziny 2–24 najbliższej doby: baza sezonowa — w ilu z 20 ostatnich dni tego samego typu (robocze albo sobota
 *    i niedziela UTC) w tej godzinie UTC był duży ruch (pełne godziny kota z dziennika); bez twierdzenia o przewadze.
 * Bez tekstów (powody jako kody), bez sieci i stanu.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const CLOCK_DAYS = 14;
export const CLOCK_MIN_N = 96;
export const CLOCK_SEASON_DAYS = 20;
/** Ostatnia prognoza kota starsza niż tyle (od startu jej okna) nie opisuje już najbliższej godziny */
export const CLOCK_STALE = 45 * MIN;

export type MoveLevel = 'calm' | 'typical' | 'elevated';
export interface ClockTerciles {
  q1: number;
  q2: number;
  n: number;
}
export interface SeasonCell {
  k: number;
  n: number;
}
export interface ClockSeason {
  weekday: SeasonCell[];
  weekend: SeasonCell[];
}
/** Sekcja `cat.clock` podsumowania */
export interface CatClock {
  terciles: ClockTerciles | null;
  season: ClockSeason;
}

const weekendDay = (day: number) => {
  const dow = (((day + 4) % 7) + 7) % 7;
  return dow === 0 || dow === 6;
};
export const clockWeekend = (t: number) => weekendDay(Math.floor(t / DAY));

/** Kwantyl posortowanej próby (interpolacja liniowa między sąsiednimi wartościami) */
const quantile = (s: readonly number[], q: number) => {
  const x = q * (s.length - 1);
  const i = Math.floor(x);
  return i + 1 < s.length ? s[i] + (x - i) * (s[i + 1] - s[i]) : s[i];
};

/** Tercyle `pBig` rozstrzygniętych prognoz kota z 14 dni przed `now`; mniej niż 96 → null. */
export function clockTerciles(rows: readonly { t: number; pBig: number }[], now: number): ClockTerciles | null {
  const s = rows.filter((r) => r.t >= now - CLOCK_DAYS * DAY && r.t <= now && Number.isFinite(r.pBig)).map((r) => r.pBig).sort((a, b) => a - b);
  if (s.length < CLOCK_MIN_N) return null;
  return { q1: quantile(s, 1 / 3), q2: quantile(s, 2 / 3), n: s.length };
}

export const moveLevelOf = (pBig: number, t: { q1: number; q2: number }): MoveLevel => (pBig < t.q1 ? 'calm' : pBig < t.q2 ? 'typical' : 'elevated');

/**
 * Baza sezonowa: dla każdej godziny UTC i typu dnia — w ilu (`k`) z dni z wynikiem (`n`) był duży ruch, z 20 ostatnich
 * dób UTC tego typu przed dobą `now`. `hours`: wynik pełnej godziny kota według startu godziny (z całego dziennika).
 */
export function clockSeason(hours: ReadonlyMap<number, 0 | 1>, now: number): ClockSeason {
  const today = Math.floor(now / DAY);
  const out = (we: boolean): SeasonCell[] => {
    const cells = Array.from({ length: 24 }, () => ({ k: 0, n: 0 }));
    let found = 0;
    for (let d = today - 1; found < CLOCK_SEASON_DAYS && d > today - 400; d--) {
      if (weekendDay(d) !== we) continue;
      found++;
      for (let h = 0; h < 24; h++) {
        const y = hours.get(d * DAY + h * HOUR);
        if (y === undefined) continue;
        cells[h].n++;
        cells[h].k += y;
      }
    }
    return cells;
  };
  return { weekday: out(false), weekend: out(true) };
}

/** Godziny 2–24: 23 pełne godziny zegara od drugiej pełnej godziny po `now`, z bazą sezonową swojego typu dnia (UTC). */
export function clockHours(season: ClockSeason, now: number): { hour: number; weekend: boolean; k: number; n: number }[] {
  const first = Math.ceil(now / HOUR) * HOUR + HOUR;
  return Array.from({ length: 23 }, (_, i) => {
    const hour = first + i * HOUR;
    const weekend = clockWeekend(hour);
    const c = (weekend ? season.weekend : season.weekday)[new Date(hour).getUTCHours()];
    return { hour, weekend, k: c.k, n: c.n };
  });
}

export type NearestHour = { from: number; to: number; level: MoveLevel; n: number } | { missing: 'no-forecast' | 'stale' | 'few' };

/** Najbliższa godzina z ostatniej prognozy kota (start okna `t`, surowe `pBig`) i tercyli z 14 dni. */
export function nearestHour(latest: { t: number; pBig: number } | null | undefined, terciles: ClockTerciles | null | undefined, now: number): NearestHour {
  if (!latest) return { missing: 'no-forecast' };
  if (now - latest.t > CLOCK_STALE) return { missing: 'stale' };
  if (!terciles) return { missing: 'few' };
  return { from: latest.t, to: latest.t + HOUR, level: moveLevelOf(latest.pBig, terciles), n: terciles.n };
}
