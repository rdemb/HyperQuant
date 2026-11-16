import { type InputStore, candlesFrom, valueSourceOf } from '../../charts/pro/chart/layoutInputs';
import type { ValueSource } from '../../charts/pro/core/valueReference';
import { type VBar, toVBars } from '../../utils/auction';
import { type TradeSession, previousSameSession } from '../../utils/sessionDay';
import { type Got, isAbsent } from '../../utils/sessionText';

/**
 * Świece 1m BTC karty Rozliczenia sesji `s`: od otwarcia poprzedniej sesji tego samego typu (migracja VA), jak w nagłówku
 * układu (`candlesFrom`). Każda karta osobno: nieudane doczytanie starszej strony wygasza tylko karty, którym brakuje tych
 * minut (powód z ponowną próbą po 30 s), a karta w toku zostaje przy swoich wczytanych świecach. W trakcie doczytywania —
 * undefined („czekam”).
 */
export function cardBars1m(store: InputStore, s: TradeSession, now: number): Got<readonly VBar[]> | undefined {
  const c = candlesFrom(store, '1m', previousSameSession(s).start, now);
  return c === undefined || isAbsent(c) ? c : toVBars(c);
}

/**
 * Jedno źródło wartości karty (migracja VA): świece 5m z taśmą od otwarcia poprzedniej sesji tego samego typu, jak nagłówek
 * układu Rozliczenie. W trakcie wczytywania albo po błędzie — brak (karta liczy wtedy ze świec 5m złożonych z minut).
 */
export function cardValue(store: InputStore, s: TradeSession, now: number): ValueSource | undefined {
  const v = valueSourceOf(store, previousSameSession(s).start, now);
  return v === undefined || isAbsent(v) ? undefined : v;
}
