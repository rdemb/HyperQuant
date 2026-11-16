import { readFileSync } from 'node:fs';
import { deskMarketOf } from '../../src/config/deskMarkets.ts';
import { marketQuality, type QualityLevel, type QualityReason } from '../../src/utils/marketQuality.ts';
import { type NyseCalendar, isNyseCalendar } from '../../src/utils/nyseSession.ts';
import { type UnderlyingState, underlyingAt, underlyingStateAt } from '../../src/utils/underlyingCore.ts';
import type { MarketRecorder } from './history.ts';

/** Kontekst starszy niż to: jakość nieznana („—: brak kontekstu”), nie ocena ze starej próbki. */
const CTX_FRESH_MS = 60_000;
const DAY_MS = 86_400_000;

/** Kalendarz NYSE z repozytorium (ten sam plik co na stronie); brak albo zły plik → null (bez świąt NYSE, jak na stronie). */
export function loadNyseCalendar(path: URL | string = new URL('../../src/data/nyseCalendar.json', import.meta.url)): NyseCalendar | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isNyseCalendar(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Czy kontekst rynku ma płynąć w chwili `t` (luki `ctx`, projekt 60 Q6): rynek desku — gdy rynek bazowy notuje albo rynek
 * jest całodobowy; rynek spoza desku (np. ETH z dawnej listy) — zawsze, jak BTC.
 */
export function ctxExpectedOf(coin: string, cal: NyseCalendar | null): (t: number) => boolean {
  const m = deskMarketOf(coin);
  if (!m) return () => true;
  return (t) => {
    const s = underlyingStateAt(m, t, cal);
    return s === 'open' || s === 'always';
  };
}

/** Stan jednego rynku desku w `status.json` (projekt 60, Q7). Brak danych → null, nigdy zero. */
export interface DeskMarketStatus {
  coin: string;
  quality: QualityLevel;
  reasons: QualityReason[];
  underlying: { state: UnderlyingState; next: number | null };
  lastTradeAt: number | null;
  lastBookAt: number | null;
  lastCtxAt: number | null;
  markOracleBpP95_1h: number | null;
  impactSpreadBpP50_1h: number | null;
  depthUsdP50_1h: number | null;
  gaps24h: number;
}

const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

/**
 * Sekcja `deskMarkets` w `status.json` (klucz: `slug` rynku desku), odświeżana z każdą publikacją statusu (co 60 s):
 * jakość danych z ostatniej próbki kontekstu (ta sama ocena co w przeglądarce, `marketQuality`, z progami z konfiguracji),
 * stan rynku bazowego i najbliższa zmiana, puls kanałów rejestratora, miary z ostatniej godziny i liczba luk z 24 h.
 * Tylko rynki desku z nagraniem: rynek bez rejestratora albo spoza desku nie ma klucza (nie zera). Same liczby, bez kont.
 */
export function deskMarketsStatus(recorders: readonly MarketRecorder[], now: number, cal: NyseCalendar | null): Record<string, DeskMarketStatus> {
  const out: Record<string, DeskMarketStatus> = {};
  for (const rec of recorders) {
    const m = deskMarketOf(rec.coin);
    if (!m) continue;
    const pulse = rec.pulses();
    const h = rec.hourStats(now);
    const u = underlyingAt(m, now, cal);
    const fresh = h.latest !== null && pulse.lastCtxAt !== null && now - pulse.lastCtxAt <= CTX_FRESH_MS;
    const c = fresh ? h.latest! : null;
    const q = marketQuality(
      m,
      c && {
        markPx: c.mark,
        dayNtlVlm: null,
        openInterest: null,
        funding: null,
        oraclePx: c.oracle,
        midPx: c.mid,
        impactPxs: c.impactBid !== null && c.impactAsk !== null ? [c.impactBid, c.impactAsk] : null,
      },
      u
    );
    out[m.slug] = {
      coin: rec.coin,
      quality: q.level,
      reasons: q.reasons,
      underlying: { state: u.state, next: u.next },
      lastTradeAt: pulse.lastTradeAt,
      lastBookAt: pulse.lastBookAt,
      lastCtxAt: pulse.lastCtxAt,
      markOracleBpP95_1h: r1(h.markOracleBpP95),
      impactSpreadBpP50_1h: r1(h.impactSpreadBpP50),
      depthUsdP50_1h: h.depthUsdP50 === null ? null : Math.round(h.depthUsdP50),
      gaps24h: rec.gapsSince(now - DAY_MS, now).length,
    };
  }
  return out;
}
