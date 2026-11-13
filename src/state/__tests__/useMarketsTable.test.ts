import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HL_WEIGHT_LIMIT_PER_MIN, META_CTXS_WEIGHT } from '../../utils/marketsTable';
import { MarketsPoller, type PollerDeps } from '../useMarketsTable';

/**
 * Atrapa transportu: odpowiedź `metaAndAssetCtxs` po 50 ms (albo null = błąd), zapis zapytań; karta widoczna albo nie
 * (przełączana z testu).
 */
function fakeDeps(opts: { fail?: Set<string> } = {}) {
  const calls: { dex: string; at: number }[] = [];
  let visible = true;
  const subs = new Set<() => void>();
  const deps: PollerDeps = {
    fetchDex: (dex) => {
      calls.push({ dex, at: Date.now() });
      return new Promise((resolve) =>
        setTimeout(() => resolve(opts.fail?.has(dex) ? null : [{ universe: [{ name: dex === '' ? 'BTC' : `${dex}:X` }] }, [{ markPx: '100', openInterest: '5', dayNtlVlm: '1', funding: '0' }]]), 50)
      );
    },
    now: () => Date.now(),
    visible: () => visible,
    onVisibility: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  const setVisible = (v: boolean) => {
    visible = v;
    subs.forEach((fn) => fn());
  };
  return { deps, calls, setVisible };
}

const DEXES = ['', 'xyz', 'io'];
const MIN = 60_000;

describe('odświeżanie tabeli „Rynki”: wagi zapytań', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 13, 21, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('10 minut otwartej strony przy 3 giełdach: najwyżej 600 wag (jedno metaAndAssetCtxs na giełdę co 60 s)', async () => {
    const { deps, calls } = fakeDeps();
    const p = new MarketsPoller(deps);
    p.run(DEXES);
    await vi.advanceTimersByTimeAsync(10 * MIN - 1);
    expect(p.meter.total).toBeLessThanOrEqual(600);
    expect(p.meter.total).toBe(600);
    expect(calls.length).toBe(30);
    expect(new Set(calls.map((c) => c.dex))).toEqual(new Set(DEXES));
    // W żadnej minucie więcej niż 3 × 20 = 60 wag (5% limitu 1200 na adres IP)
    for (let t = 0; t <= 10 * MIN; t += 5_000) expect(p.meter.lastMinute(Date.UTC(2026, 10, 13, 21, 0, 0) + t)).toBeLessThanOrEqual(3 * META_CTXS_WEIGHT);
    expect(3 * META_CTXS_WEIGHT).toBe(HL_WEIGHT_LIMIT_PER_MIN * 0.05);
    p.stop();
  });

  it('pierwsza runda od razu: dane wszystkich giełd po odpowiedzi', async () => {
    const { deps } = fakeDeps();
    const p = new MarketsPoller(deps);
    p.run(DEXES);
    await vi.advanceTimersByTimeAsync(100);
    expect(Object.keys(p.snapshot().dexes).sort()).toEqual(['', 'io', 'xyz']);
    expect(p.snapshot().dexes.xyz.ctxs?.get('xyz:X')?.markPx).toBe(100);
    p.stop();
  });

  it('karta schowana: żadnych zapytań; częste przełączanie kart nie zwiększa wag (runda najwcześniej 60 s po poprzedniej)', async () => {
    const { deps, calls, setVisible } = fakeDeps();
    const p = new MarketsPoller(deps);
    p.run(DEXES);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.length).toBe(3);
    setVisible(false);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(calls.length).toBe(3);
    // Powrót po 5 min: runda od razu (ostatnia była dawno)
    setVisible(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.length).toBe(6);
    // Przełączanie co 5 s przez 10 min: nadal najwyżej jedna runda na 60 s
    const from = p.meter.total;
    for (let i = 0; i < 120; i++) {
      setVisible(i % 2 === 1);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(p.meter.total - from).toBeLessThanOrEqual(600);
    p.stop();
  });

  it('nieudana odpowiedź giełdy: czas próby zapisany, inne giełdy z danymi; stop kończy odświeżanie', async () => {
    const { deps, calls } = fakeDeps({ fail: new Set(['io']) });
    const p = new MarketsPoller(deps);
    p.run(DEXES);
    await vi.advanceTimersByTimeAsync(100);
    expect(p.snapshot().dexes.io).toMatchObject({ at: null, ctxs: null });
    expect(p.snapshot().dexes.io.failedAt).not.toBeNull();
    expect(p.snapshot().dexes[''].at).not.toBeNull();
    p.stop();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(calls.length).toBe(3);
  });

  it('nowa giełda w rejestrze po pierwszej rundzie: jedno zapytanie od razu, potem w rundach', async () => {
    const { deps, calls } = fakeDeps();
    const p = new MarketsPoller(deps);
    p.run(['', 'xyz']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(2);
    p.run(['', 'xyz', 'io']);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.map((c) => c.dex)).toEqual(['', 'xyz', 'io']);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(calls.length).toBe(6);
    // Giełda, która wypadła z rejestru, znika ze stanu i z rund
    p.run(['']);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(Object.keys(p.snapshot().dexes)).toEqual(['']);
    expect(calls.slice(6).map((c) => c.dex)).toEqual(['']);
    p.stop();
  });
});
