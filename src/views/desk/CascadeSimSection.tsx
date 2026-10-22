import React, { useMemo } from 'react';
import { useLiquidityProfile } from '../../state/useLiquidityProfile';
import { Badge, DASH, fmtCompact } from '../../ui';
import { branchingRatio, cascadeDepth, sideCoverage, simulateCascade } from '../../utils/cascadeSim';
import type { LiqMap } from '../../utils/liqMap';

const SHOCKS = [-0.03, -0.02, -0.01, -0.005, 0.005, 0.01, 0.02, 0.03];
const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(2)}%`;

const nWord = (n: number) => (n >= 1 ? 'ruch może sam uruchomić likwidacje większe niż on' : n >= 0.5 ? 'blisko progu 1' : 'poniżej progu');

/**
 * Kaskada 2.0: Monte Carlo na zmierzonej mapie i zmierzonym arkuszu (rejestrator płynności) — likwidacje w transzach,
 * wyzwalanie po cenie mark (z opóźnieniem EMA 150 s), odbudowa arkusza, niepewność pozycji spoza mapy; wzmocnienie lokalne.
 */
export const CascadeSimSection: React.FC<{ map: LiqMap }> = ({ map }) => {
  const { profile, status } = useLiquidityProfile();
  const depth = useMemo(() => (profile ? cascadeDepth(profile, status === 'ready', Date.now()) : null), [profile, status]);
  const res = useMemo(() => (depth ? SHOCKS.map((s) => simulateCascade(map, s, depth.params)) : null), [map, depth]);
  const n = useMemo(() => (depth ? { down: branchingRatio(map, 'down', depth.params), up: branchingRatio(map, 'up', depth.params) } : null), [map, depth]);
  if (!depth || !res || !n) return null;
  const covDown = sideCoverage(map, true);
  const covUp = sideCoverage(map, false);
  const nTitle = 'Największy stosunek wpływu likwidacji uruchomionych ruchem o δ (5–50 bp) do δ — bez opóźnienia mark i odbudowy arkusza (przybliżenie)';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Kaskada 2.0: zmierzony arkusz, cena mark, odbudowa, niepewność</div>
        <Badge tone="model" title="Monte Carlo: 400 ścieżek, krok 30 s, horyzont 60 min">
          MODEL
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
        <span title={nTitle}>
          wzmocnienie lokalne ▼ <span className="font-mono tabular-nums text-ink-1">{Number.isFinite(n.down) ? n.down.toFixed(2) : DASH}</span>{' '}
          <span className="text-ink-3">({Number.isFinite(n.down) ? nWord(n.down) : 'brak danych'})</span>
        </span>
        <span title={nTitle}>
          wzmocnienie lokalne ▲ <span className="font-mono tabular-nums text-ink-1">{Number.isFinite(n.up) ? n.up.toFixed(2) : DASH}</span>{' '}
          <span className="text-ink-3">({Number.isFinite(n.up) ? nWord(n.up) : 'brak danych'})</span>
        </span>
        <span className="text-ink-3">
          arkusz ±10 bp {depth.source === 'now' ? 'teraz' : 'mediana tej godziny (brak świeżej minuty)'}: bidy {fmtCompact(depth.params.bids.d10, '$')}, aski{' '}
          {fmtCompact(depth.params.asks.d10, '$')}
          {depth.split === 'hour' ? ' (podział stron z mediany tej godziny)' : depth.split === 'assumed' ? ' (podział stron założony po połowie — za mało danych)' : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono tabular-nums text-[11px]">
          <caption className="sr-only">Szok ceny i ruch szczytowy ceny Hyperliquid po kaskadzie: mediana i przedział 10–90%, P(wzmocnienie ≥ 2×), zlikwidowany nominał</caption>
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
            {res.map((r, i) =>
              r ? (
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
              ) : (
                <tr key={SHOCKS[i]} className="border-t border-line">
                  <td className="py-1.5 pr-3">{pct(SHOCKS[i])}</td>
                  <td className="py-1.5 pr-3 text-ink-3" colSpan={4}>
                    {DASH} brak głębokości tej strony arkusza
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Szok przesuwa cały rynek; likwidacje z mapy wchodzą transzami (20% na 30 s) i zjadają zmierzoną stronę arkusza Hyperliquid (longi — bidy, shorty —
        aski) wzdłuż krzywej głębokości z rejestratora (liniowo do ±20 bp, dalej prawo pierwiastka kwadratowego). Kolejne likwidacje wyzwala cena mark, która
        — gdy giełdy zewnętrzne stoją — podąża za ceną Hyperliquid z opóźnieniem (EMA 150 s), a arkusz w tym czasie się odbudowuje
        {profile?.resilience.medianMin == null ? ' (odporność bez pomiaru — założone 5 min)' : ' w tempie zmierzonej odporności'}. Pozycje spoza mapy:
        nominał × 1/pokrycie strony (longi {(covDown * 100).toFixed(0)}%, shorty {(covUp * 100).toFixed(0)}%) z czynnikiem wspólnym ścieżki i kubełka; w arkusz
        trafia 60–100% (resztę przejmuje Liquidator Vault). Wzmocnienie lokalne to przybliżenie liniowe: ≥ 1 oznacza, że likwidacje uruchomione ruchem o kilka
        dziesiątek bp mogłyby same przesunąć cenę o więcej — o tym, czy kaskada faktycznie się rozkręci, decyduje dopiero symulacja z opóźnieniem mark
        i odbudową. Scenariusz „co jeśli”, nie prognoza ruchu.
      </p>
    </div>
  );
};
