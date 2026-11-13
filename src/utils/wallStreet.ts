import { tr } from '../i18n';
import { DASH } from '../ui/format';
import calendarFile from '../data/nyseCalendar.json';
import type { ChartMarket } from './marketRegistry';

/**
 * Etykieta „Wall Street otwarta / zamknięta” w tabeli „Rynki”: sesja regularna NYSE (9:30–16:00 czasu Nowego Jorku) w dni
 * robocze, z kalendarzem świąt i sesji skróconych przepisanym z oficjalnej strony NYSE (`src/data/nyseCalendar.json`).
 * Opisuje giełdę bazową, nie rynek na Hyperliquid (ten działa całą dobę). Czysta logika: czas w argumencie, strefa
 * Nowego Jorku z `Intl` (zmiana czasu w USA bez ręcznych dat; strefa przeglądarki i zmiana czasu w Europie bez wpływu).
 * Rok bez kalendarza w pliku daje stan nieznany z powodem, nie zgadywany.
 */

export interface NyseYear {
  holidays: { date: string; name: string }[];
  /** Sesje skrócone: dzień i godzina zamknięcia (czas Nowego Jorku, HH:MM) */
  earlyCloses: { date: string; close: string }[];
}

export interface NyseCalendar {
  /** Adres strony NYSE, z której przepisano daty */
  source: string;
  /** Dzień odczytu strony (RRRR-MM-DD) */
  readAt: string;
  timeZone: 'America/New_York';
  /** Sesja regularna, czas Nowego Jorku (HH:MM) */
  open: string;
  close: string;
  /** Rok → święta i sesje skrócone */
  years: Record<string, NyseYear>;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Strażnik formatu pliku kalendarza (zły plik → brak kalendarza, etykieta „—” z powodem). */
export function isNyseCalendar(x: unknown): x is NyseCalendar {
  if (!isRecord(x) || typeof x.source !== 'string' || typeof x.readAt !== 'string' || !DAY_RE.test(x.readAt)) return false;
  if (x.timeZone !== 'America/New_York' || typeof x.open !== 'string' || !HM_RE.test(x.open) || typeof x.close !== 'string' || !HM_RE.test(x.close)) return false;
  if (!isRecord(x.years)) return false;
  for (const [year, y] of Object.entries(x.years)) {
    if (!/^\d{4}$/.test(year) || !isRecord(y) || !Array.isArray(y.holidays) || !Array.isArray(y.earlyCloses)) return false;
    for (const h of y.holidays) if (!isRecord(h) || typeof h.date !== 'string' || !h.date.startsWith(`${year}-`) || !DAY_RE.test(h.date) || typeof h.name !== 'string') return false;
    for (const e of y.earlyCloses) if (!isRecord(e) || typeof e.date !== 'string' || !e.date.startsWith(`${year}-`) || !DAY_RE.test(e.date) || typeof e.close !== 'string' || !HM_RE.test(e.close)) return false;
  }
  return true;
}

/** Kalendarz z repozytorium; zły format → null (etykieta „—” z powodem). */
export const NYSE_CALENDAR: NyseCalendar | null = isNyseCalendar(calendarFile) ? calendarFile : null;

export type WallStreetClosed = 'weekend' | 'holiday' | 'before-open' | 'after-close';

export type WallStreet =
  | { state: 'open'; /** Zamknięcie dziś, czas Nowego Jorku */ closesAt: string; early: boolean }
  | { state: 'closed'; why: WallStreetClosed; /** Nazwa święta */ holiday?: string; /** Zamknięcie dzisiejszej sesji skróconej */ closedAt?: string }
  | { state: 'unknown'; why: 'no-calendar'; year: string };

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

/** Data (RRRR-MM-DD), minuta doby i dzień tygodnia (0 = niedziela) w Nowym Jorku w chwili `ms`. */
export function nyClock(ms: number): { date: string; minute: number; weekday: number } {
  const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), weekday };
}

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Stan sesji regularnej NYSE w chwili `ms` według kalendarza `cal` (null = brak pliku). */
export function wallStreetAt(ms: number, cal: NyseCalendar | null = NYSE_CALENDAR): WallStreet {
  const { date, minute, weekday } = nyClock(ms);
  const year = date.slice(0, 4);
  const y = cal?.years[year];
  if (!cal || !y) return { state: 'unknown', why: 'no-calendar', year };
  if (weekday === 0 || weekday === 6) return { state: 'closed', why: 'weekend' };
  const holiday = y.holidays.find((h) => h.date === date);
  if (holiday) return { state: 'closed', why: 'holiday', holiday: holiday.name };
  const early = y.earlyCloses.find((e) => e.date === date);
  const close = early?.close ?? cal.close;
  if (minute < toMin(cal.open)) return { state: 'closed', why: 'before-open' };
  if (minute >= toMin(close)) return early ? { state: 'closed', why: 'after-close', closedAt: close } : { state: 'closed', why: 'after-close' };
  return { state: 'open', closesAt: close, early: !!early };
}

/** Etykieta i jej dopisek w komórce tabeli („—” przy braku kalendarza, dopisek mówi dlaczego). */
export function wallStreetText(ws: WallStreet, cal: NyseCalendar | null = NYSE_CALENDAR): { label: string; note: string } {
  const open = cal?.open ?? '09:30';
  switch (ws.state) {
    case 'open':
      return {
        label: tr('otwarta', 'open'),
        note: ws.early ? tr(`sesja skrócona do ${ws.closesAt} czasu NY`, `early close at ${ws.closesAt} New York time`) : tr(`do ${ws.closesAt} czasu NY`, `until ${ws.closesAt} New York time`),
      };
    case 'closed':
      return {
        label: tr('zamknięta', 'closed'),
        note:
          ws.why === 'weekend'
            ? tr('weekend', 'weekend')
            : ws.why === 'holiday'
              ? tr(`święto: ${ws.holiday}`, `holiday: ${ws.holiday}`)
              : ws.why === 'before-open'
                ? tr(`otwarcie o ${open} czasu NY`, `opens at ${open} New York time`)
                : ws.closedAt
                  ? tr(`sesja skrócona, zamknięta o ${ws.closedAt} czasu NY`, `early close, closed at ${ws.closedAt} New York time`)
                  : tr('po zamknięciu sesji', 'after the session close'),
      };
    case 'unknown':
      return { label: DASH, note: tr(`brak kalendarza NYSE na rok ${ws.year}`, `no NYSE calendar for ${ws.year}`) };
  }
}

/**
 * Komórka „Wall Street” wiersza tabeli: etykieta tylko dla klas akcji i indeksów (`class` z rejestru); inny rynek — „—”
 * z powodem w `why` (krypto bez giełdy bazowej, inna klasa, rejestr bez klasy).
 */
export interface WallStreetCellModel {
  /** „otwarta”, „zamknięta” albo „—” */
  label: string;
  /** Dopisek pod etykietą (do której, weekend, święto, sesja skrócona, brak kalendarza) */
  note: string | null;
  /** Powód „—”, gdy etykiety dla rynku nie ma (krypto, inna klasa, rejestr bez klasy); null — etykieta jest */
  why: string | null;
}

export function wallStreetCell(m: Pick<ChartMarket, 'dex' | 'class'>, ws: WallStreet, cal: NyseCalendar | null = NYSE_CALENDAR): WallStreetCellModel {
  if (m.class === 'equity' || m.class === 'index') {
    const t = wallStreetText(ws, cal);
    return { label: t.label, note: t.note, why: null };
  }
  const why =
    m.class !== undefined
      ? tr('etykieta tylko dla akcji i indeksów', 'label for equities and indices only')
      : m.dex === ''
        ? tr('rynek krypto, bez giełdy bazowej', 'crypto market, no underlying exchange')
        : tr('rejestr nie podaje jeszcze klasy rynku (akcja, indeks, surowiec)', 'the registry does not give the market class yet (equity, index, commodity)');
  return { label: DASH, note: null, why };
}
