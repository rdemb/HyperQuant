import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sessionNameAt } from '../sessionNames';
import { currentTradeSession } from '../sessionDay';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

describe('nazwa trwającej sesji (pasek „W sesji”)', () => {
  it('7.11 07:41 UTC to jeszcze Azja: Londyn otwiera o 08:00 czasu londyńskiego (GMT = UTC)', () => {
    const t = at(2026, 11, 7, 7, 41);
    expect(sessionNameAt(t)).toBe('Azja');
    expect(currentTradeSession(t)).toBeNull();
  });

  it('granice jak w sesjach dnia tradera: 08:00 UTC Londyn, 14:30 UTC (09:30 EST) Nowy Jork, 00:00 UTC Azja', () => {
    expect(sessionNameAt(at(2026, 11, 7, 8, 0))).toBe('Londyn');
    expect(sessionNameAt(at(2026, 11, 7, 14, 29))).toBe('Londyn');
    expect(sessionNameAt(at(2026, 11, 7, 14, 30))).toBe('Nowy Jork');
    expect(sessionNameAt(at(2026, 11, 7, 23, 59))).toBe('Nowy Jork');
    expect(sessionNameAt(at(2026, 11, 8, 0, 0))).toBe('Azja');
  });

  it('latem Londyn od 07:00 UTC (BST)', () => {
    expect(sessionNameAt(at(2026, 7, 7, 6, 59))).toBe('Azja');
    expect(sessionNameAt(at(2026, 7, 7, 7, 0))).toBe('Londyn');
  });

  it('zgadza się z currentTradeSession w każdej minucie doby', () => {
    const day = at(2026, 11, 7, 0);
    for (let m = 0; m < 24 * 60; m += 1) {
      const t = day + m * 60_000;
      const s = currentTradeSession(t);
      expect(sessionNameAt(t)).toBe(s === null ? 'Azja' : s.id === 'london' ? 'Londyn' : 'Nowy Jork');
    }
  });

  it('pasek ceny i pas kontekstu nie biorą sesji z okien Pine (Shaakuni), tylko z sesji dnia tradera', () => {
    for (const f of ['src/shell/AppShell.tsx', 'src/views/desk/DeskRail.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/sessionLabel\(|nySession/);
      expect(src, f).toMatch(/sessionNameAt\(/);
    }
  });
});
