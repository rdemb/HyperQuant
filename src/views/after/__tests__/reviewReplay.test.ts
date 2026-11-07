import { describe, expect, it } from 'vitest';
import { parseReplayLink } from '../../../charts/pro/replay/link';
import { currentTradeSession, tradeSessionOn } from '../../../utils/sessionDay';
import { REPLAY_KEEP_MS, reviewReplay } from '../reviewReplay';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const NOW = at(2026, 11, 3, 16, 20);
const L = tradeSessionOn(at(2026, 11, 3, 0), 'london');
const NY = currentTradeSession(NOW)!;

describe('link powtórki minuty wiersza Rozliczenia', () => {
  it('układ Rozliczenie na 5m w zakresie zamkniętej sesji, zatrzymany w minucie wiersza', () => {
    const h = reviewReplay(L.start + 30 * MIN, L, NOW);
    expect(h).toBe('#charts?replay=history&m=BTC&i=5m&from=2026-11-03T08:00:00Z&to=2026-11-03T14:30:00Z&t=2026-11-03T08:30:00Z&station=review');
    expect(parseReplayLink(h!)).toMatchObject({ source: 'history', coin: 'BTC', interval: '5m', station: 'review', t: L.start + 30 * MIN });
  });

  it('sesja w toku: zakres do teraz, nie do jej przyszłego końca', () => {
    expect(parseReplayLink(reviewReplay(NY.start + H, NY, NOW)!)).toMatchObject({ from: NY.start, to: NOW, t: NY.start + H });
  });

  it('minuta przed otwarciem sesji (dotknięcie mapy w Azji): zakres zaczyna się od tej minuty', () => {
    const asia = L.start - 54 * MIN;
    expect(parseReplayLink(reviewReplay(asia, L, NOW)!)).toMatchObject({ from: asia, to: L.end, t: asia });
  });

  it('tylko minuty z ostatnich 7 dni (tyle serwer trzyma nagranie); starsze, przyszłe i brak minuty — bez linku', () => {
    const t = L.start + 30 * MIN;
    expect(REPLAY_KEEP_MS).toBe(7 * DAY);
    expect(reviewReplay(t, L, t + REPLAY_KEEP_MS)).not.toBeNull();
    expect(reviewReplay(t, L, t + REPLAY_KEEP_MS + 1)).toBeNull();
    expect(reviewReplay(NOW + MIN, NY, NOW)).toBeNull();
    expect(reviewReplay(null, L, NOW)).toBeNull();
  });
});
