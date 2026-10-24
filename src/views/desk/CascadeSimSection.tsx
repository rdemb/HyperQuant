import React, { useMemo } from 'react';
import { useLiquidityProfile } from '../../state/useLiquidityProfile';
import { Badge, DASH, fmtCompact } from '../../ui';
import { branchingRatio, cascadeDepth, sideCoverage, simulateCascade } from '../../utils/cascadeSim';
import type { LiqMap } from '../../utils/liqMap';
import { tr } from '../../i18n';

const SHOCKS = [-0.03, -0.02, -0.01, -0.005, 0.005, 0.01, 0.02, 0.03];
const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(2)}%`;

const nWord = (n: number) =>
  n >= 1
    ? tr('ruch może sam uruchomić likwidacje większe niż on', 'a move can trigger liquidations larger than itself')
    : n >= 0.5
    ? tr('blisko progu 1', 'close to the threshold of 1')
    : tr('poniżej progu', 'below threshold');

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
  const nTitle = tr(
    'Największy stosunek wpływu likwidacji uruchomionych ruchem o δ (5–50 bp) do δ — bez opóźnienia mark i odbudowy arkusza (przybliżenie)',
    'Largest ratio of the impact of liquidations triggered by a δ move (5–50 bp) to δ, without mark lag or book refill (approximation)'
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">
          {tr('Kaskada 2.0: zmierzony arkusz, cena mark, odbudowa, niepewność', 'Cascade 2.0: measured book, mark price, refill, uncertainty')}
        </div>
        <Badge tone="model" title={tr('Monte Carlo: 400 ścieżek, krok 30 s, horyzont 60 min', 'Monte Carlo: 400 paths, 30 s step, 60 min horizon')}>
          MODEL
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
        <span title={nTitle}>
          {tr('wzmocnienie lokalne', 'local amplification')} ▼ <span className="font-mono tabular-nums text-ink-1">{Number.isFinite(n.down) ? n.down.toFixed(2) : DASH}</span>{' '}
          <span className="text-ink-3">({Number.isFinite(n.down) ? nWord(n.down) : tr('brak danych', 'no data')})</span>
        </span>
        <span title={nTitle}>
          {tr('wzmocnienie lokalne', 'local amplification')} ▲ <span className="font-mono tabular-nums text-ink-1">{Number.isFinite(n.up) ? n.up.toFixed(2) : DASH}</span>{' '}
          <span className="text-ink-3">({Number.isFinite(n.up) ? nWord(n.up) : tr('brak danych', 'no data')})</span>
        </span>
        <span className="text-ink-3">
          {tr('arkusz ±10 bp', 'book ±10 bp')} {depth.source === 'now' ? tr('teraz', 'now') : tr('mediana tej godziny (brak świeżej minuty)', 'median for this hour (no fresh minute)')}:{' '}
          {tr('bidy', 'bids')} {fmtCompact(depth.params.bids.d10, '$')}, {tr('aski', 'asks')} {fmtCompact(depth.params.asks.d10, '$')}
          {depth.split === 'hour'
            ? tr(' (podział stron z mediany tej godziny)', ' (side split from this hour\'s median)')
            : depth.split === 'assumed'
            ? tr(' (podział stron założony po połowie — za mało danych)', ' (sides assumed 50/50, not enough data)')
            : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono tabular-nums text-[11px]">
          <caption className="sr-only">
            {tr(
              'Szok ceny i ruch szczytowy ceny Hyperliquid po kaskadzie: mediana i przedział 10–90%, P(wzmocnienie ≥ 2×), zlikwidowany nominał',
              'Price shock and peak Hyperliquid price move after the cascade: median and 10–90% range, P(amplification ≥ 2×), liquidated notional'
            )}
          </caption>
          <thead className="text-ink-3">
            <tr>
              <th className="py-1 pr-3 font-medium font-sans">{tr('Szok', 'Shock')}</th>
              <th className="py-1 pr-3 font-medium font-sans">{tr('Ruch szczytowy (mediana)', 'Peak move (median)')}</th>
              <th className="py-1 pr-3 font-medium font-sans">10–90%</th>
              <th className="py-1 pr-3 font-medium font-sans" title={tr('Odsetek ścieżek, w których ruch szczytowy co najmniej podwaja szok', 'Share of paths where the peak move at least doubles the shock')}>
                P(≥ 2×)
              </th>
              <th className="py-1 font-medium font-sans" title={tr('Mediana zlikwidowanego nominału, z przeskalowaniem na pozycje spoza mapy', 'Median liquidated notional, scaled up for positions outside the map')}>
                {tr('Likwidacje', 'Liquidations')}
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
                    {DASH} {tr('brak głębokości tej strony arkusza', 'no depth on this side of the book')}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        {tr(
          `Szok przesuwa cały rynek; likwidacje z mapy wchodzą transzami (20% na 30 s) i zjadają zmierzoną stronę arkusza Hyperliquid (longi — bidy, shorty — aski) wzdłuż krzywej głębokości z rejestratora (liniowo do ±20 bp, dalej prawo pierwiastka kwadratowego). Kolejne likwidacje wyzwala cena mark, która — gdy giełdy zewnętrzne stoją — podąża za ceną Hyperliquid z opóźnieniem (EMA 150 s), a arkusz w tym czasie się odbudowuje${
            profile?.resilience.medianMin == null ? ' (odporność bez pomiaru — założone 5 min)' : ' w tempie zmierzonej odporności'
          }. Pozycje spoza mapy: nominał × 1/pokrycie strony (longi ${(covDown * 100).toFixed(0)}%, shorty ${(covUp * 100).toFixed(0)}%) z czynnikiem wspólnym ścieżki i kubełka; w arkusz trafia 60–100% (resztę przejmuje Liquidator Vault). Wzmocnienie lokalne to przybliżenie liniowe: ≥ 1 oznacza, że likwidacje uruchomione ruchem o kilka dziesiątek bp mogłyby same przesunąć cenę o więcej — o tym, czy kaskada faktycznie się rozkręci, decyduje dopiero symulacja z opóźnieniem mark i odbudową. Scenariusz „co jeśli”, nie prognoza ruchu.`,
          `The shock moves the whole market; liquidations from the map enter in tranches (20% per 30 s) and eat the measured side of the Hyperliquid book (longs hit bids, shorts hit asks) along the depth curve from the recorder (linear up to ±20 bp, then the square-root law). Further liquidations are triggered by the mark price, which, when external exchanges are flat, follows the Hyperliquid price with a lag (EMA 150 s) while the book refills${
            profile?.resilience.medianMin == null ? ' (resilience not measured, 5 min assumed)' : ' at the measured resilience rate'
          }. Positions outside the map: notional × 1/side coverage (longs ${(covDown * 100).toFixed(0)}%, shorts ${(covUp * 100).toFixed(0)}%) with a common path and bucket factor; 60–100% hits the book (the rest is taken by the Liquidator Vault). Local amplification is a linear approximation: ≥ 1 means liquidations triggered by a move of a few dozen bp could move price further on their own; whether a cascade actually unfolds is decided only by the simulation with mark lag and refill. A "what if" scenario, not a move forecast.`
        )}
      </p>
    </div>
  );
};
