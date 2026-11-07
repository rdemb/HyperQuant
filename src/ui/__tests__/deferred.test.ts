import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, radioStep } from '../deferred';

describe('przełącznik zestawu paneli: strzałki', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('powtarzane strzałki: jedno zatwierdzenie (jedna przebudowa wykresów) po przerwie, z ostatnim wyborem', () => {
    const run = vi.fn();
    const d = deferred<string>(300, run);
    d.push('absorption');
    vi.advanceTimersByTime(100);
    d.push('auction');
    vi.advanceTimersByTime(100);
    d.push('absorption');
    vi.advanceTimersByTime(299);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('absorption');
  });

  it('anulowanie (kliknięcie, odmontowanie) nie zatwierdza oczekującego wyboru', () => {
    const run = vi.fn();
    const d = deferred<string>(300, run);
    d.push('absorption');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('strzałka w prawo i w lewo z zawinięciem; inny klawisz — null', () => {
    const ids = ['auction', 'absorption'];
    expect(radioStep(ids, 'auction', 'ArrowRight')).toBe('absorption');
    expect(radioStep(ids, 'absorption', 'ArrowRight')).toBe('auction');
    expect(radioStep(ids, 'auction', 'ArrowLeft')).toBe('absorption');
    expect(radioStep(['a', 'b', 'c'], 'a', 'ArrowLeft')).toBe('c');
    expect(radioStep(ids, 'auction', 'Enter')).toBeNull();
    expect(radioStep([], 'auction', 'ArrowRight')).toBeNull();
  });

  it('PanelSetSwitch: fokus idzie za zaznaczonym radio, strzałki zatwierdzane z opóźnieniem', () => {
    const src = readFileSync('src/charts/pro/chart/TabsBar.tsx', 'utf8');
    const body = src.slice(src.indexOf('export const PanelSetSwitch'));
    expect(body).toMatch(/deferred</);
    expect(body).toMatch(/\.focus\(\)/);
  });
});
