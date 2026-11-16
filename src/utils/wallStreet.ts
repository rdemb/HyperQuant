import { tr } from '../i18n';
import { DASH } from '../ui/format';
import calendarFile from '../data/nyseCalendar.json';
import type { ChartMarket } from './marketRegistry';
import { type NyseCalendar, type WallStreet, isNyseCalendar, nyseSessionAt } from './nyseSession.ts';

export { type NyseCalendar, type NyseYear, type WallStreet, type WallStreetClosed, isNyseCalendar, nyClock } from './nyseSession.ts';

/**
 * Etykieta „Wall Street otwarta / zamknięta” w tabeli „Rynki”: sesja regularna NYSE (9:30–16:00 czasu Nowego Jorku) w dni
 * robocze, z kalendarzem świąt i sesji skróconych przepisanym z oficjalnej strony NYSE (`src/data/nyseCalendar.json`).
 * Opisuje giełdę bazową, nie rynek na Hyperliquid (ten działa całą dobę). Logika sesji w `nyseSession.ts` (bez importów,
 * działa też na serwerze); tu kalendarz z repozytorium jako domyślny i teksty etykiet.
 */

/** Kalendarz z repozytorium; zły format → null (etykieta „—” z powodem). */
export const NYSE_CALENDAR: NyseCalendar | null = isNyseCalendar(calendarFile) ? calendarFile : null;

/** Stan sesji regularnej NYSE w chwili `ms` według kalendarza `cal` (null = brak pliku). */
export function wallStreetAt(ms: number, cal: NyseCalendar | null = NYSE_CALENDAR): WallStreet {
  return nyseSessionAt(ms, cal);
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
