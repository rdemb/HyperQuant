import { type InputStore, candlesFrom } from '../../charts/pro/chart/layoutInputs';
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
