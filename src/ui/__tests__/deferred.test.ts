import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debouncedRadio, deferred, radioStep } from '../deferred';

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
    expect(body).toMatch(/debouncedRadio\(/);
    expect(body).toMatch(/\.focus\(\)/);
  });
});

describe('PanelSetSwitch: zachowanie przełącznika (debouncedRadio)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const IDS = ['auction', 'absorption'];
  const make = () => {
    const focus = vi.fn();
    const change = vi.fn();
    const setPending = vi.fn();
    return { focus, change, setPending, r: debouncedRadio(350, { focus, change, setPending }) };
  };

  it('strzałka: zaznaczenie i fokus od razu na nowym radio, jedno onChange dopiero po przerwie', () => {
    const { focus, change, setPending, r } = make();
    expect(r.key('ArrowRight', IDS, 'auction')).toBe(true);
    expect(focus).toHaveBeenLastCalledWith('absorption');
    expect(setPending).toHaveBeenLastCalledWith('absorption');
    vi.advanceTimersByTime(349);
    expect(change).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith('absorption');
    expect(setPending).toHaveBeenLastCalledWith(null);
  });

  it('powtarzane strzałki: fokus za każdą, jedno onChange z ostatnim wyborem; powrót na bieżący — bez onChange', () => {
    const { focus, change, r } = make();
    r.key('ArrowRight', IDS, 'auction');
    vi.advanceTimersByTime(100);
    r.key('ArrowRight', IDS, 'auction');
    vi.advanceTimersByTime(100);
    r.key('ArrowRight', IDS, 'auction');
    expect(focus.mock.calls.map((c) => c[0])).toEqual(['absorption', 'auction', 'absorption']);
    vi.advanceTimersByTime(350);
    expect(change.mock.calls).toEqual([['absorption']]);
    // Tam i z powrotem: zaznaczenie wraca na bieżący zestaw, wykresy się nie przebudowują
    r.key('ArrowLeft', IDS, 'absorption');
    r.key('ArrowRight', IDS, 'absorption');
    vi.advanceTimersByTime(1000);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('kliknięcie zatwierdza od razu i porzuca oczekującą strzałkę; kliknięcie bieżącego — nic', () => {
    const { change, r } = make();
    r.key('ArrowRight', IDS, 'auction');
    r.click('absorption', 'auction');
    expect(change.mock.calls).toEqual([['absorption']]);
    vi.advanceTimersByTime(1000);
    expect(change).toHaveBeenCalledTimes(1);
    r.click('auction', 'auction');
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('inny klawisz — nieobsłużony, bez fokusu i bez zmiany', () => {
    const { focus, change, r } = make();
    expect(r.key('Enter', IDS, 'auction')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect([focus.mock.calls.length, change.mock.calls.length]).toEqual([0, 0]);
  });
});
