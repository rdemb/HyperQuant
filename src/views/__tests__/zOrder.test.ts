import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Liczba z klasy `z-N` (Tailwind) w tekście albo null. */
const zOf = (cls: string): number | null => {
  const m = /(?:^|\s)z-(\d+)(?=\s|$)/.exec(cls);
  return m ? Number(m[1]) : null;
};

describe('kolejność warstw przy przewiniętej stronie', () => {
  const shell = readFileSync('src/shell/AppShell.tsx', 'utf8');
  const header = /<header[^>]*className="([^"]*)"/.exec(shell)![1];
  const headerZ = zOf(header)!;

  it('przypięty nagłówek aplikacji ma z-30', () => {
    expect(header).toContain('sticky');
    expect(headerZ).toBe(30);
  });

  it('szuflada DOM i taśmy (640–1279 px) pod nagłówkiem: z-20', () => {
    const charts = readFileSync('src/views/ChartsView.tsx', 'utf8');
    const drawer = /\{drawerOpen && \(\s*<div className="([^"]*)"/.exec(charts)![1];
    expect(zOf(drawer)).toBe(20);
    expect(zOf(drawer)!).toBeLessThan(headerZ);
  });

  it('pasek narzędzi rysowania bez własnej warstwy: nie maluje się na nagłówku ani na przypiętym pasku Pulse (z-20)', () => {
    const draw = readFileSync('src/charts/pro/draw/DrawToolbar.tsx', 'utf8');
    const bar = /role="toolbar"[\s\S]*?className=\{`([^`]*)`\}/.exec(draw)![1];
    expect(zOf(bar)).toBeNull();
    // Listy narzędzi obok paska (fixed) zostają nad wykresem i nagłówkiem
    expect(draw).toMatch(/role="menu"[\s\S]{0,80}className="fixed z-40/);
  });
});
