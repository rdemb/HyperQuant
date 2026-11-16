import type { DeskMarket } from '../config/deskMarkets.ts';
import { NYSE_CALENDAR, type NyseCalendar } from './wallStreet.ts';
import { type ClosedSpan, type Underlying, closedSpans as closedSpansCore, underlyingAt as underlyingAtCore } from './underlyingCore.ts';

/**
 * Stan rynku bazowego rynku desku na stronie (projekt 60, Q1): logika w `underlyingCore.ts` (bez importów, działa też
 * na serwerze), tu z kalendarzem NYSE z repozytorium jako domyślnym.
 */
export { type ClosedSpan, type Underlying, type UnderlyingState, baseOpens, etToday, platformPriced } from './underlyingCore.ts';

export function underlyingAt(m: Pick<DeskMarket, 'underlying'>, ms: number, cal: NyseCalendar | null = NYSE_CALENDAR): Underlying {
  return underlyingAtCore(m, ms, cal);
}

export function closedSpans(m: Pick<DeskMarket, 'underlying' | 'slug'>, from: number, to: number, cal: NyseCalendar | null = NYSE_CALENDAR): ClosedSpan[] {
  return closedSpansCore(m, from, to, cal);
}
