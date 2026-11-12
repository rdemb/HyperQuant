import { describe, expect, it } from 'vitest';
import { ForecastData } from '../forecaster.ts';

/**
 * Świece 1h do `hrel-v1` w ForecastData: tylko zamknięte w chwili odczytu, z odczytu modelu zmienności i krótkiego
 * dopełnienia po pełnej godzinie; bez zapytań, gdy ostatnia zamknięta godzina już jest.
 */

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 12, 10);

function client() {
  const calls: { interval: string; startTime: number }[] = [];
  const rest = {
    info: async (body: unknown) => {
      const req = (body as { req: { interval: string; startTime: number } }).req;
      calls.push({ interval: req.interval, startTime: req.startTime });
      if (req.interval !== '1h') return [];
      // Świece od startTime do bieżącej (w toku) włącznie
      const out = [];
      for (let t = Math.ceil(req.startTime / HOUR) * HOUR; t <= now; t += HOUR) out.push({ t, o: '1', h: String(101 + (t / HOUR) % 3), l: '99', c: '100' });
      return out;
    },
  };
  let now = T0;
  return { rest, calls, setNow: (t: number) => (now = t) };
}

describe('ForecastData: świece 1h do hrel-v1', () => {
  it('pierwszy odczyt: ~104 dni zamkniętych świec, bez świecy w toku; potem bez zapytań do następnej godziny', async () => {
    const c = client();
    const d = new ForecastData({ coin: 'BTC', rest: c.rest }, null);
    c.setNow(T0 + 30_000);
    await d.refreshHourBars(T0 + 30_000);
    expect(c.calls).toHaveLength(1);
    expect(d.hourBars.has(T0 - HOUR)).toBe(true);
    expect(d.hourBars.has(T0)).toBe(false);
    expect(d.hourBars.size).toBeGreaterThanOrEqual(2400);
    await d.refreshHourBars(T0 + 5 * 60_000);
    expect(c.calls).toHaveLength(1);
    // Nowa godzina: krótkie dopełnienie od 3 h przed najnowszą zapisaną
    c.setNow(T0 + HOUR + 20_000);
    await d.refreshHourBars(T0 + HOUR + 20_000);
    expect(c.calls).toHaveLength(2);
    expect(c.calls[1].startTime).toBe(T0 - 4 * HOUR);
    expect(d.hourBars.has(T0)).toBe(true);
    expect(d.hourBars.get(T0)).toEqual({ t: T0, h: 101 + (T0 / HOUR) % 3, l: 99 });
  });

  it('brak świecy ostatniej godziny w odpowiedzi: najwyżej 3 próby w tej godzinie', async () => {
    const c = client();
    const d = new ForecastData({ coin: 'BTC', rest: { info: async (b: unknown) => (c.rest.info(b), []) } }, null);
    for (let k = 0; k < 6; k++) await d.refreshHourBars(T0 + k * 60_000);
    expect(c.calls).toHaveLength(3);
    await d.refreshHourBars(T0 + HOUR + 1000);
    expect(c.calls).toHaveLength(4);
  });
});
