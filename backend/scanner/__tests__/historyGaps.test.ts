import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deskMarketOf } from '../../../src/config/deskMarkets.ts';
import { underlyingStateAt } from '../../../src/utils/underlyingCore.ts';
import { MarketRecorder, SETTLE_MS, historyIndex } from '../history.ts';
import type { HlCtx } from '../hl.ts';

const SEC = 1000;
const MIN = 60_000;
/** Poniedziałek 16.11.2026 10:00 ET (15:00 UTC): rynek bazowy złota notuje */
const MON = Date.UTC(2026, 10, 16, 15, 0, 0);
/** Niedziela 15.11.2026 12:00 ET (17:00 UTC): rynek bazowy zamknięty, cena platformy */
const SUN = Date.UTC(2026, 10, 15, 17, 0, 0);

const GOLD = deskMarketOf('xyz:GOLD')!;
const ctx: HlCtx = { markPx: 3840, oiBtc: 1000, dayNtlVlm: 1e8, funding: 1e-5, oraclePx: 3840 };
const book = [[{ px: '3840', sz: '1', n: 1 }], [{ px: '3841', sz: '1', n: 1 }]];
/** Jak na serwerze: kontekst oczekiwany tylko, gdy rynek bazowy notuje (albo rynek całodobowy) */
const expected = (t: number) => ['open', 'always'].includes(underlyingStateAt(GOLD, t, null));

function recorder() {
  const dir = mkdtempSync(join(tmpdir(), 'hq-gaps-'));
  return { dir, r: new MarketRecorder('xyz:GOLD', dir, { ctxExpected: expected }) };
}

/** Takt historii na serwerze: zapis części i luk. */
const tick = (r: MarketRecorder, now: number) => {
  r.flush(now);
  r.trackGaps(now);
};

/** Takt rejestratora co 15 s z arkuszem i kontekstem co 5 s w [from, to), poza wyłączonymi przedziałami. */
function feed(r: MarketRecorder, from: number, to: number, o: { noBook?: [number, number]; noCtx?: [number, number] } = {}) {
  const off = (t: number, w?: [number, number]) => !!w && t >= w[0] && t < w[1];
  for (let t = from; t < to; t += 5 * SEC) {
    if (!off(t, o.noBook)) r.onBook(t, book);
    if (!off(t, o.noCtx)) r.onCtx(ctx, t);
    if ((t - from) % (15 * SEC) === 0) tick(r, t);
  }
}

const gapsOf = (dir: string, now: number) => historyIndex(dir, ['xyz:GOLD'], 7, now).markets['xyz:GOLD']?.gaps;

describe('luki w danych rejestratora (projekt 60, Q6)', () => {
  it('przerwa arkusza 45 s → luka `book` w spisie (od ostatniej migawki do następnej); kontekst po 15 s — bez luki', () => {
    const { dir, r } = recorder();
    r.onState(true, MON);
    r.onTrades([{ coin: 'xyz:GOLD', side: 'B', px: '3840', sz: '1', time: MON, tid: 1 }]);
    feed(r, MON, MON + 10 * MIN, { noBook: [MON + 60 * SEC + 1, MON + 105 * SEC], noCtx: [MON + 3 * MIN + 1, MON + 3 * MIN + 15 * SEC] });
    const now = MON + 10 * MIN + SETTLE_MS;
    tick(r, now);
    expect(gapsOf(dir, now)).toEqual([{ from: MON + 60 * SEC, to: MON + 105 * SEC, kind: 'book' }]);
    // Plik luk doby obok plików taśmy
    expect(JSON.parse(readFileSync(join(dir, 'xyz-GOLD', '2026-11-16', 'gaps.json'), 'utf8')).gaps).toHaveLength(1);
  });

  it('kontekst: cisza > 15 s przy otwartym rynku bazowym → luka `ctx`; niedziela: 10 min bez transakcji i kontekstu, arkusz jest — bez luki', () => {
    const a = recorder();
    a.r.onState(true, MON);
    feed(a.r, MON, MON + 5 * MIN, { noCtx: [MON + MIN + 1, MON + MIN + 30 * SEC] });
    tick(a.r, MON + 5 * MIN);
    expect(gapsOf(a.dir, MON + 5 * MIN)).toEqual([{ from: MON + MIN, to: MON + MIN + 30 * SEC, kind: 'ctx' }]);

    const b = recorder();
    b.r.onState(true, SUN);
    feed(b.r, SUN, SUN + 12 * MIN, { noCtx: [SUN + MIN, SUN + 11 * MIN] });
    tick(b.r, SUN + 12 * MIN + SETTLE_MS);
    expect(gapsOf(b.dir, SUN + 12 * MIN + SETTLE_MS) ?? []).toEqual([]);
  });

  it('luka w toku widoczna od razu (koniec = takt), domknięta przy powrocie danych; zerwanie połączenia → luka `ws` bez podwójnej luki arkusza', () => {
    const { dir, r } = recorder();
    r.onState(true, MON);
    feed(r, MON, MON + MIN);
    // Arkusz milknie: takt po 45 s ciszy pokazuje lukę w toku
    for (let t = MON + MIN; t <= MON + MIN + 45 * SEC; t += 15 * SEC) {
      r.onCtx(ctx, t);
      tick(r, t);
    }
    expect(gapsOf(dir, MON + 2 * MIN)).toEqual([{ from: MON + MIN - 5 * SEC, to: MON + MIN + 45 * SEC, kind: 'book' }]);
    r.onBook(MON + MIN + 50 * SEC, book);
    tick(r, MON + MIN + 55 * SEC);
    expect(gapsOf(dir, MON + 2 * MIN)).toEqual([{ from: MON + MIN - 5 * SEC, to: MON + MIN + 50 * SEC, kind: 'book' }]);
    // Zerwanie na 2 min: jedna luka `ws`, po powrocie arkusz i kontekst od nowa (bez luki od ostatniej migawki sprzed zerwania)
    r.onState(false, MON + 2 * MIN);
    tick(r, MON + 3 * MIN);
    r.onState(true, MON + 4 * MIN);
    feed(r, MON + 4 * MIN, MON + 6 * MIN);
    tick(r, MON + 6 * MIN);
    expect(gapsOf(dir, MON + 6 * MIN)).toEqual([
      { from: MON + MIN - 5 * SEC, to: MON + MIN + 50 * SEC, kind: 'book' },
      { from: MON + 2 * MIN, to: MON + 4 * MIN, kind: 'ws' },
    ]);
    // Liczba luk z ostatnich 24 h (do `status.json`)
    expect(r.gapsSince(MON, MON + 6 * MIN)).toHaveLength(2);
    expect(r.gapsSince(MON + 3 * MIN, MON + 6 * MIN)).toEqual([{ from: MON + 2 * MIN, to: MON + 4 * MIN, kind: 'ws' }]);
    // Nowe uruchomienie widzi luki z pliku doby
    expect(new MarketRecorder('xyz:GOLD', dir).gapsSince(MON, MON + 6 * MIN)).toHaveLength(2);
  });
});
