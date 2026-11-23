import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Zegar doby: wskazówka z godziny zegarowej (dni zmiany czasu)', () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Warsaw';
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  it('południe w dniu zmiany czasu (29 III i 25 X 2026) wskazuje 12, nie 11 ani 13', async () => {
    const { katDoby, sekundyDoby } = await import('../ZegarDoby');
    const wiosna = Date.UTC(2026, 2, 29, 10, 0, 0); // 12:00 CEST
    const jesien = Date.UTC(2026, 9, 25, 11, 0, 0); // 12:00 CET
    expect(katDoby(wiosna)).toBeCloseTo(180, 6);
    expect(katDoby(jesien)).toBeCloseTo(180, 6);
    expect(sekundyDoby(wiosna)).toBeCloseTo(12 * 3600, 3);
    expect(sekundyDoby(jesien)).toBeCloseTo(12 * 3600, 3);
    // Zwykły dzień: 18:30 → 277,5°
    expect(katDoby(Date.UTC(2026, 10, 23, 17, 30, 0))).toBeCloseTo(277.5, 6);
  });
});
