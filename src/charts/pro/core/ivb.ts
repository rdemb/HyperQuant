import { tradeSessionOn } from '../../../utils/sessionDay';
import type { IndicatorBar } from './indicators';
import { utcDayStart } from './sessions';
import { DAY } from './time';

/**
 * IVB (model IVB z dokumentacji Deep-M, z którego korzysta Fabio Valentini): zakres ceny pierwszych 30 albo 60 minut od otwarcia giełdy w Nowym Jorku, osobno od
 * IB (pierwsza godzina każdej sesji). Otwarcie według kalendarza — 09:30 czasu nowojorskiego z czasem letnim liczonym
 * przez Intl (`tradeSessionOn`), więc w czasie polskim 15:30, a w tygodniach rozjazdu zmiany czasu (marzec, przełom
 * października i listopada) 14:30; nie stała godzina.
 *
 * Zasady warstwy (CONTRIBUTING, warstwy z obiektami): tylko bieżąca sesja NY (po jej końcu nic), zakres tylko z zamkniętych
 * świec okna, prostokąt rośnie z każdą zamkniętą świecą, a linie szczytu i dołka zaczynają się dopiero na końcu okna,
 * gdy zakres jest znany; najwyżej 3 obiekty.
 */

export const IVB_WINDOWS = [30, 60] as const;
export type IvbMinutes = (typeof IVB_WINDOWS)[number];
/** Domyślnie 30 min, jak zaleca Deep-M IVB. */
export const IVB_DEFAULT: IvbMinutes = 30;
/** Największy interwał: świece 30m zaczynają się o otwarciu NY (:30), godzinowe już nie. */
export const IVB_MAX_TF = 30 * 60_000;
/** Prostokąt okna oraz linie szczytu i dołka. */
export const IVB_OBJECTS_MAX = 3;

export interface Ivb {
  /** Otwarcie NY (początek okna) i koniec okna (ms). */
  start: number;
  end: number;
  /** Koniec sesji NY (00:00 UTC): do niego sięgają linie. */
  sessionEnd: number;
  hi: number;
  lo: number;
  /** Okno minęło i wszystkie jego świece są zamknięte (zakres ostateczny). */
  complete: boolean;
  /** Koniec ostatniej zamkniętej świecy okna (prawa krawędź prostokąta w budowie). */
  through: number;
}

export type IvbState =
  | { kind: 'ok'; ivb: Ivb }
  /** Sesja NY trwa, ale żadna świeca okna się jeszcze nie zamknęła. */
  | { kind: 'waiting'; open: number }
  /** W oknie brakuje świecy (historia od później albo luka): zakresu nie podajemy. */
  | { kind: 'gap'; open: number }
  /** Ostatnia świeca poza sesją NY; `next` — najbliższe otwarcie NY. */
  | { kind: 'outside'; next: number }
  | { kind: 'interval' }
  | { kind: 'noData' };

/** Długość okna z parametru wskaźnika: 60 albo domyślne 30 (inna liczba z ręcznie zmienionego zapisu → 30). */
export const ivbMinutes = (v: number): IvbMinutes => (v === 60 ? 60 : IVB_DEFAULT);

/**
 * IVB bieżącej sesji NY dla świec `bars` (rosnąco, interwał `ms`) w chwili `now`: świeca należy do okna, gdy się w nim
 * zaczyna, i liczy się dopiero po zamknięciu (koniec ≤ `now`).
 */
export function ivbAt(bars: readonly IndicatorBar[], ms: number, minutes: number, now: number): IvbState {
  if (ms > IVB_MAX_TF) return { kind: 'interval' };
  if (bars.length === 0) return { kind: 'noData' };
  const t = bars[bars.length - 1].t;
  const day = utcDayStart(t);
  let ny = tradeSessionOn(day, 'ny');
  if (t < ny.start) {
    // Przed otwarciem NY tej doby: poprzednia sesja NY skończyła się o 00:00 UTC, więc jesteśmy poza sesją
    return { kind: 'outside', next: ny.start };
  }
  if (t >= ny.end) {
    ny = tradeSessionOn(day + DAY, 'ny');
    return { kind: 'outside', next: ny.start };
  }
  const start = ny.start;
  const end = start + ivbMinutes(minutes) * 60_000;
  let hi = Number.NEGATIVE_INFINITY;
  let lo = Number.POSITIVE_INFINITY;
  let through = start;
  let count = 0;
  for (let i = bars.length - 1; i >= 0 && bars[i].t >= start; i--) {
    const b = bars[i];
    if (b.t >= end || b.t + ms > now) continue;
    hi = Math.max(hi, b.candle.h);
    lo = Math.min(lo, b.candle.l);
    through = Math.max(through, b.t + ms);
    count++;
  }
  if (!(hi >= lo)) return { kind: 'waiting', open: start };
  // Brak którejś świecy okna (historia zaczęta po otwarciu albo luka w danych): bez zakresu z niepełnego okna
  if (count * ms < through - start) return { kind: 'gap', open: start };
  return { kind: 'ok', ivb: { start, end, sessionEnd: ny.end, hi, lo, complete: through >= end, through } };
}

/** Obiekty rysunku: w budowie sam prostokąt, po oknie prostokąt oraz linie szczytu i dołka. */
export const ivbObjects = (s: IvbState): number => (s.kind !== 'ok' ? 0 : s.ivb.complete ? IVB_OBJECTS_MAX : 1);
