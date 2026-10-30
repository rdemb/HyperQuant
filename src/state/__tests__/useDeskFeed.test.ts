import { describe, expect, it } from 'vitest';
import { WS_SILENCE_MS, wsWatch } from '../useDeskFeed';

const T0 = Date.UTC(2026, 9, 30, 12);

describe('strażnik WebSocket desku: martwe połączenie bez zdarzenia close', () => {
  it('świeże wiadomości: nic, a ping dopiero po 30 s od poprzedniego', () => {
    expect(wsWatch(T0 + 5_000, T0 + 4_900, T0)).toBeNull();
    expect(wsWatch(T0 + 30_000, T0 + 29_900, T0)).toBe('ping');
  });

  it('cisza dłuższa niż próg zrywa połączenie, także gdy ping właśnie wyszedł', () => {
    expect(wsWatch(T0 + WS_SILENCE_MS, T0, T0)).toBe('ping'); // równo na progu jeszcze nie
    expect(wsWatch(T0 + WS_SILENCE_MS + 1, T0, T0 + WS_SILENCE_MS)).toBe('reconnect');
  });

  it('próg jest dużo dłuższy od rytmu bbo (~150 ms) i krótszy od zamknięcia przez serwer (60 s)', () => {
    expect(WS_SILENCE_MS).toBeGreaterThan(100 * 150);
    expect(WS_SILENCE_MS).toBeLessThan(60_000);
  });
});
