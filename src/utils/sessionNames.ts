import { tr } from '../i18n';
import type { TradeSessionId } from './sessionDay';

/** Nazwa sesji w podpisach („sesja Londyn”, „sesja NY”) — osobno od `sessionDay`, żeby logika sesji nie ciągnęła i18n. */
export const TRADE_SESSION_NAME: Record<TradeSessionId, string> = { london: tr('Londyn', 'London'), ny: 'NY' };
