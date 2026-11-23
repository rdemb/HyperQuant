import { describe, expect, it } from 'vitest';
import { LIVE_MAX_CISZA_MS, stanSwiec } from '../ChartPanel';

const MIN = 60_000;
const now = Date.UTC(2026, 10, 23, 12, 5, 0);

describe('panel Wykres: znacznik z danych, nie z zegara', () => {
  it('świeca sprzed 30 min przy otwartym WS bez nowych świec: HISTORIA z godziną świecy, nie LIVE', () => {
    const last = { t: now - 30 * MIN, c: 60_000 };
    const s = stanSwiec({ status: 'open', loadState: 'ready', last, intervalMs: MIN, now, zmianaAt: now - 2_000 });
    expect(s).toEqual({ kind: 'historia', px: 60_000, candleAt: last.t });
    // Upływ czasu bez nowej świecy nie zmienia odczytu w LIVE
    expect(stanSwiec({ status: 'open', loadState: 'ready', last, intervalMs: MIN, now: now + 2_200, zmianaAt: now - 2_000 }).kind).toBe('historia');
  });

  it('bieżąca świeca i świeża zmiana: LIVE z godziną zmiany (odczytu), nie bieżącym zegarem', () => {
    const last = { t: now - 20_000, c: 61_000 };
    const s = stanSwiec({ status: 'open', loadState: 'ready', last, intervalMs: MIN, now, zmianaAt: now - 3_000 });
    expect(s).toEqual({ kind: 'live', px: 61_000, at: now - 3_000 });
  });

  it('cisza dłuższa niż próg, zamknięty strumień albo brak historii: nie LIVE', () => {
    const last = { t: now - 20_000, c: 61_000 };
    expect(stanSwiec({ status: 'open', loadState: 'ready', last, intervalMs: MIN, now, zmianaAt: now - LIVE_MAX_CISZA_MS - 1 }).kind).toBe('historia');
    expect(stanSwiec({ status: 'closed', loadState: 'ready', last, intervalMs: MIN, now, zmianaAt: now }).kind).toBe('historia');
    expect(stanSwiec({ status: 'open', loadState: 'loading', last: null, intervalMs: MIN, now, zmianaAt: null }).kind).toBe('czekam');
    expect(stanSwiec({ status: 'open', loadState: 'error', last: null, intervalMs: MIN, now, zmianaAt: null }).kind).toBe('blad');
  });
});
