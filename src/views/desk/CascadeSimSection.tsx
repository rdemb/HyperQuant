import React, { useMemo } from 'react';
import { useLiquidityProfile } from '../../state/useLiquidityProfile';
import { Badge, DASH, fmtCompact } from '../../ui';
import { branchingRatio, simulateCascade, type CascadeSimParams } from '../../utils/cascadeSim';
import type { LiqMap } from '../../utils/liqMap';
import type { LiquidityProfile } from '../../utils/liquidity';

const SHOCKS = [-0.03, -0.02, -0.01, -0.005, 0.005, 0.01, 0.02, 0.03];
const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(2)}%`;

/** Głębokość stron teraz: bieżąca minuta rejestratora (suma), podział na strony jak w medianie tej godziny. */
function depthNow(p: LiquidityProfile): CascadeSimParams | null {
  const h = p.now ? new Date(p.now.t).getUTCHours() : new Date().getUTCHours();
  const hb = p.byHour[h];
  const d10 = p.now?.d10 ?? hb?.d10 ?? null;
  const d20 = p.now?.d20 ?? hb?.d20 ?? null;
  if (!(d10 && d10 > 0)) return null;
  const shareB = hb && hb.b10 != null && hb.a10 != null && hb.b10 + hb.a10 > 0 ? hb.b10 / (hb.b10 + hb.a10) : 0.5;
  return {
    bids: { d10: d10 * shareB, d20: d20 === null ? null : d20 * shareB },
    asks: { d10: d10 * (1 - shareB), d20: d20 === null ? null : d20 * (1 - shareB) },
    resilienceMin: p.resilience.medianMin,
  };
}

const nWord = (n: number) => (n >= 1 ? 'nadkrytycznie — mały ruch może się sam podtrzymać' : n >= 0.5 ? 'blisko krytyczności' : 'podkrytycznie');

/**
 * Kaskada 2.0: Monte Carlo na zmierzonej mapie i zmierzonym arkuszu (rejestrator płynności) z odbudową głębokości i
 * niepewnością pozycji spoza mapy; lokalny współczynnik rozgałęzienia pętli kaskady.
 */
export const CascadeSimSection: React.FC<{ map: LiqMap }> = ({ map }) => {
  const { profile } = useLiquidityProfile();
  const params = useMemo(() => (profile ? depthNow(profile) : null), [profile]);
  const res = useMemo(() => (params ? SHOCKS.map((s) => simulateCascade(map, s, params)) : null), [map, params]);
  const n = useMemo(() => (params ? { down: branchingRatio(map, 'down', params), up: branchingRatio(map, 'up', params) } : null), [map, params]);
  if (!params || !res || !n) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Kaskada 2.0: zmierzony arkusz, odbudowa, niepewność</div>
        <Badge tone="model" title="Monte Carlo: 400 ścieżek, krok 1 min, horyzont 60 min">
          MODEL
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
        <span title="Gęstość likwidacji w pierwszych 50 bp × wpływ krańcowy pustego arkusza; ≥ 1 — pętla kaskady sama się podtrzymuje">
          rozgałęzienie ▼ <span className="font-mono tabular-nums text-ink-1">{Number.isFinite(n.down) ? n.down.toFixed(2) : DASH}</span>{' '}
          <span className="text-ink-3">({Number.isFinite(n.down) ? nWord(n.down) : 'brak danych'})</span>
        </span>
        <span>
          rozgałęzienie ▲ <span className="font-mono tabular-nums text-ink-1">{Number.isFinite(n.up) ? n.up.toFixed(2) : DASH}</span>{' '}
          <span className="text-ink-3">({Number.isFinite(n.up) ? nWord(n.up) : 'brak danych'})</span>
        </span>
        <span className="text-ink-3">
          arkusz ±10 bp: bidy {fmtCompact(params.bids.d10, '$')}, aski {fmtCompact(params.asks.d10, '$')}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono tabular-nums text-[11px]">
          <caption className="sr-only">Szok ceny i ruch szczytowy po kaskadzie: mediana i przedział 10–90%, P(wzmocnienie ≥ 2×), zlikwidowany nominał</caption>
          <thead className="text-ink-3">
            <tr>
              <th className="py-1 pr-3 font-medium font-sans">Szok</th>
              <th className="py-1 pr-3 font-medium font-sans">Ruch szczytowy (mediana)</th>
              <th className="py-1 pr-3 font-medium font-sans">10–90%</th>
              <th className="py-1 pr-3 font-medium font-sans" title="Odsetek ścieżek, w których ruch szczytowy co najmniej podwaja szok">
                P(≥ 2×)
              </th>
              <th className="py-1 font-medium font-sans" title="Mediana zlikwidowanego nominału, z przeskalowaniem na pozycje spoza mapy">
                Likwidacje
              </th>
            </tr>
          </thead>
          <tbody>
            {res.map((r) => (
              <tr key={r.shockPct} className="border-t border-line">
                <td className="py-1.5 pr-3">{pct(r.shockPct)}</td>
                <td className="py-1.5 pr-3 text-ink-1">
                  {pct(r.move.p50)} <span className="text-[10px] text-ink-3">×{(r.move.p50 / r.shockPct).toFixed(2)}</span>
                </td>
                <td className="py-1.5 pr-3 text-ink-2">
                  {pct(r.move.p10)} … {pct(r.move.p90)}
                </td>
                <td className="py-1.5 pr-3">{(r.pAmplify2 * 100).toFixed(0)}%</td>
                <td className="py-1.5">{fmtCompact(r.liquidated.p50, '$')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Likwidacje z mapy zjadają zmierzoną stronę arkusza (longi — bidy, shorty — aski) wzdłuż krzywej głębokości z rejestratora (liniowo do ±20 bp, dalej prawo
        pierwiastka kwadratowego), a arkusz odbudowuje się w tempie zmierzonej odporności{profile?.resilience.medianMin == null ? ' (brak pomiaru — założone 5 min)' : ''}.
        Pozycje spoza mapy: nominał × 1/pokrycie ({(map.coverage.share * 100).toFixed(0)}%) z losowym rozrzutem; w arkusz trafia 60–100% (resztę przejmuje
        Liquidator Vault). Rozgałęzienie to lokalne wzmocnienie pętli „ruch → likwidacje → wpływ” w pierwszych 50 bp — jak współczynnik rozgałęzienia procesu
        Hawkesa: poniżej 1 kaskada wygasa, od 1 może się sama podtrzymać. Scenariusz „co jeśli”, nie prognoza ruchu.
      </p>
    </div>
  );
};
