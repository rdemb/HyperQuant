import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeCtx, historyPath } from '../../../src/utils/tapeHistory.ts';
import { MarketRecorder, SETTLE_MS } from '../history.ts';
import { type HlCtx, parseCtx } from '../hl.ts';

const T0 = Date.UTC(2026, 10, 16, 14, 0, 0);
const MIN = 60_000;
const gz = (dir: string, rel: string) => JSON.parse(gunzipSync(readFileSync(join(dir, rel))).toString('utf8'));
const ctxAt = (k: number): HlCtx => ({ markPx: 3840 + k / 100, oiBtc: 1000, dayNtlVlm: 1e8, funding: 1e-5, oraclePx: 3840, midPx: 3840.05, impactPxs: [3839.8, 3840.3], premium: 2e-5 });

describe('kontekst rynku co 5 s w plikach `ctx` (projekt 60, Q5)', () => {
  it('parseCtx: wyrocznia, mid, ceny impact i premia z activeAssetCtx; brak albo zły kształt → null w polu', () => {
    const raw = { markPx: '3840.1', openInterest: '1000', dayNtlVlm: '1e8', funding: '0.00001', oraclePx: '3840', midPx: '3840.05', impactPxs: ['3839.8', '3840.3'], premium: '0.00002' };
    expect(parseCtx(raw)).toEqual({ markPx: 3840.1, oiBtc: 1000, dayNtlVlm: 1e8, funding: 0.00001, oraclePx: 3840, midPx: 3840.05, impactPxs: [3839.8, 3840.3], premium: 0.00002 });
    expect(parseCtx({ ...raw, midPx: null, impactPxs: null, premium: undefined, oraclePx: 'x' })).toMatchObject({ oraclePx: null, midPx: null, impactPxs: null, premium: null });
    expect(parseCtx({ ...raw, impactPxs: ['1'] })?.impactPxs).toBeNull();
    expect(parseCtx({ ...raw, markPx: undefined })).toBeNull();
  });

  it('próbka co 5 s (późniejsza w okienku wygrywa) w części i pliku godzinowym: godzina ma 720 próbek, części usunięte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-ctx-'));
    const r = new MarketRecorder('xyz:GOLD', dir);
    r.onState(true, T0);
    r.onTrades([{ coin: 'xyz:GOLD', side: 'B', px: '3840', sz: '1', time: T0, tid: 1 }]);
    let files = 0;
    for (let s = 0; s < 3600; s++) {
      r.onCtx(ctxAt(s), T0 + s * 1000);
      if (s % 15 === 0) files += r.flush(T0 + s * 1000);
    }
    // Pierwsza część: taśma, arkusz i kontekst; próbki na siatce 5 s, ostatni odczyt okienka (s = 4, 9, …)
    const part = decodeCtx(gz(dir, historyPath('xyz:GOLD', T0, 'ctx', true)))!;
    expect(part.samples).toHaveLength(60);
    expect(part.samples.slice(0, 2)).toEqual([
      { t: T0, mark: 3840.04, oracle: 3840, mid: 3840.05, impactBid: 3839.8, impactAsk: 3840.3, premium: 2e-5 },
      { t: T0 + 5000, mark: 3840.09, oracle: 3840, mid: 3840.05, impactBid: 3839.8, impactAsk: 3840.3, premium: 2e-5 },
    ]);
    expect(part.spans).toEqual([[T0, T0 + 5 * MIN]]);
    expect(files).toBeGreaterThan(0);
    r.flush(T0 + 60 * MIN + SETTLE_MS);
    const hour = decodeCtx(gz(dir, historyPath('xyz:GOLD', T0, 'ctx', false)))!;
    expect(hour.samples).toHaveLength(720);
    expect(hour.samples.every((x, i) => x.t === T0 + i * 5000)).toBe(true);
    expect(readdirSync(join(dir, 'xyz-GOLD', '2026-11-16')).filter((f) => /^\d{2}-\d{2}\./.test(f))).toEqual([]);
  });

  it('bez odczytu kontekstu w części — bez pliku `ctx` (taśma i arkusz jak dotąd)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-ctx-'));
    const r = new MarketRecorder('BTC', dir);
    r.onState(true, T0);
    r.onTrades([{ coin: 'BTC', side: 'B', px: '95000', sz: '1', time: T0 + 1000, tid: 1 }]);
    expect(r.flush(T0 + 5 * MIN + SETTLE_MS)).toBe(2);
    expect(existsSync(join(dir, historyPath('BTC', T0, 'ctx', true)))).toBe(false);
  });
});
