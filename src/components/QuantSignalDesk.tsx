import React, { useId, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { QuantMathMetrics } from '../types/trading';
import { Badge, Panel, Stat, DASH, fmtCompact, fmtPrice, fmtSigned } from '../ui';
import { candlesLabel, horizonDuration } from '../views/micro/horizon';

// Panel metryk mikrostruktury — bez sygnałów transakcyjnych (desk ocenia plan tradera, nie podsuwa wejść).

type Direction = 'LONG' | 'SHORT';

// Polskie nazwy reżimów z regułowej klasyfikacji silnika
const REGIME_PL: Record<QuantMathMetrics['regimeClassification'], { label: string; detail: string }> = {
  'Spot Absorption Bullish': {
    label: 'Absorpcja spot (wzrostowa)',
    detail: 'Spot CVD rośnie mimo słabości perp przy świeżym OB popytowym. Wymaga danych spot (CEX opt-in).',
  },
  'Perp Exhaustion Bearish': {
    label: 'Wyczerpanie perp (spadkowa)',
    detail: 'Perp CVD wyprzedza spot przy świeżym OB podażowym. Wymaga danych spot (CEX opt-in).',
  },
  'Momentum Breakout': {
    label: 'Trend / momentum',
    detail: 'Wykładnik Hursta > 0,6 — zwroty ostatnich świec są dodatnio skorelowane.',
  },
  'Mean-Reversion Equilibrium': {
    label: 'Równowaga',
    detail: 'Żadna reguła trendu ani absorpcji nie jest spełniona — stan domyślny.',
  },
  'Liquidation Cascade Squeeze': {
    label: 'Kaskada likwidacji',
    detail: 'Szybki ruch napędzany szacowanym paliwem likwidacyjnym.',
  },
};

// Kolejność serii kategorycznych stała (series-1…5), legenda pod paskiem
const WEIGHT_SERIES: { key: keyof QuantMathMetrics['neuralAttentionWeights']; label: string; color: string }[] = [
  { key: 'shaakuniOBProximity', label: 'Bliskość OB', color: 'bg-series-1' },
  { key: 'spotCvdDelta', label: 'CVD spot/perp', color: 'bg-series-2' },
  { key: 'perpFundingAndLiq', label: 'Likwidacje (szac.)', color: 'bg-series-3' },
  { key: 'l2BookImbalance', label: 'Nierównowaga L2', color: 'bg-series-4' },
  { key: 'hawkesCascadeVelocity', label: 'Hawkes', color: 'bg-series-5' },
];

const fmtHalfLife = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} świec` : '∞ (brak powrotu)');

/** Przyciski przekazania kierunku do Analizatora planu — kierunek wybiera trader. */
export const PrefillButtons: React.FC<{ onPick: (dir: Direction) => void }> = ({ onPick }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <ClipboardList className="w-3.5 h-3.5 text-ink-3" aria-hidden="true" />
      Przekaż do planu
    </span>
    {(['LONG', 'SHORT'] as const).map((dir) => (
      <button
        key={dir}
        type="button"
        onClick={() => onPick(dir)}
        aria-label={`Przekaż do planu: ${dir === 'LONG' ? 'Long' : 'Short'}`}
        className={`min-h-11 sm:min-h-8 px-3 rounded-lg border text-xs font-semibold transition-colors duration-150 bg-surface-2 hover:bg-surface-3 ${
          dir === 'LONG' ? 'text-buy-ink border-buy/40' : 'text-sell-ink border-sell/40'
        }`}
      >
        <span aria-hidden="true">{dir === 'LONG' ? '▲' : '▼'}</span> {dir === 'LONG' ? 'Long' : 'Short'}
      </button>
    ))}
  </div>
);

/** Reżim (reguły), trajektoria heurystyczna w świecach i wagi cech heurystyki. */
export const QuantRegimePanel: React.FC<{
  quant: QuantMathMetrics;
  currentPrice: number;
  timeframeSec: number;
  onPrefillPlan?: (dir: Direction, title?: string, reason?: string) => void;
}> = ({ quant, currentPrice, timeframeSec, onPrefillPlan }) => {
  const regime = REGIME_PL[quant.regimeClassification];
  const weights = quant.neuralAttentionWeights;

  return (
    <Panel
      title="Reżim i trajektoria"
      eyebrow="Heurystyka"
      actions={<Badge tone="model" title="Klasyfikacja regułowa i ważona suma cech — bez sieci neuronowej">MODEL</Badge>}
      bodyClassName="p-4 flex flex-col gap-4"
    >
      <div>
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Reżim (reguły)</div>
        <div className="text-xl font-semibold text-ink-1 leading-tight mt-0.5">{regime.label}</div>
        <p className="text-xs text-ink-3 leading-relaxed mt-1">{regime.detail}</p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Trajektoria heurystyczna</span>
          <span className="text-[11px] text-ink-3">±1σ z ATR</span>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {quant.forecastHorizon.map((fh) => {
            const diff = fh.predictedPrice - currentPrice;
            const up = diff >= 0;
            return (
              <div key={fh.stepBars} className="bg-page border border-line rounded-lg px-1.5 py-2 text-center min-w-0">
                <div className="text-[11px] text-ink-2 font-medium truncate">{candlesLabel(fh.stepBars)}</div>
                <div className="text-[10px] text-ink-3">= {horizonDuration(fh.stepBars, timeframeSec)}</div>
                <div className="mt-1 font-mono tabular-nums text-xs text-ink-1 truncate">{fmtPrice(fh.predictedPrice, 0)}</div>
                <div className={`font-mono tabular-nums text-[10px] ${up ? 'text-buy-ink' : 'text-sell-ink'}`}>
                  <span aria-hidden="true">{up ? '▲' : '▼'}</span> {fmtSigned(diff, 0)}
                </div>
                <div className="font-mono tabular-nums text-[10px] text-ink-3">±{fmtPrice(fh.upper1Sigma - fh.predictedPrice, 0)}</div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-ink-3 leading-relaxed mt-1.5">
          Kalman + OU + ważona suma cech; horyzonty to liczba świec przy bieżącym interwale. Nieskalibrowana — nie jest prognozą ani
          prawdopodobieństwem. Siła heurystyki: {quant.neuralConfidence}/100.
        </p>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">Wagi cech heurystyki</div>
        <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-page" role="img" aria-label="Udział cech w heurystyce">
          {WEIGHT_SERIES.map((s) => (
            <span
              key={s.key}
              className={`${s.color} h-full border-r border-surface-1 last:border-r-0`}
              style={{ width: `${(weights[s.key] * 100).toFixed(1)}%` }}
              title={`${s.label}: ${(weights[s.key] * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-2">
          {WEIGHT_SERIES.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-2 min-w-0">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-sm shrink-0 ${s.color}`} aria-hidden="true" />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="font-mono tabular-nums text-ink-1">{(weights[s.key] * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      </div>

      {onPrefillPlan && (
        <div className="pt-3 border-t border-line">
          <PrefillButtons
            onPick={(dir) =>
              onPrefillPlan(
                dir,
                'Mikrostruktura',
                `Reżim: ${regime.label} · OU Z ${fmtSigned(quant.ouZScore, 2)}σ · Hurst ${quant.hurstExponent} · VPIN ${(quant.vpinToxicity * 100).toFixed(0)}%`
              )
            }
          />
        </div>
      )}
    </Panel>
  );
};

/** Kafle metryk: OU, Hawkes, Hurst, Shannon, VPIN, λ Kyle'a — każda z metodą w znaczniku MODEL. */
export const QuantMetricTiles: React.FC<{ quant: QuantMathMetrics; className?: string }> = ({
  quant,
  className = 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
}) => {
  const h = quant.hurstExponent;
  const hurstRead = h < 0.45 ? 'antypersystencja (powroty)' : h > 0.6 ? 'persystencja (trend)' : 'blisko błądzenia losowego';
  const tiles: { key: string; node: React.ReactNode }[] = [
    {
      key: 'ou',
      node: (
        <Stat
          label="OU"
          source={{ tone: 'model', label: 'MODEL', title: 'Ornstein-Uhlenbeck: regresja ΔP na odchyleniu od 0,65·D-EQ + 0,35·W-EQ (40 świec)' }}
          value={<span>Z {fmtSigned(quant.ouZScore, 2)}σ</span>}
          hint={`powrót do EQ ${fmtPrice(quant.ouEquilibriumPrice, 0)} · t½ ${fmtHalfLife(quant.ouHalfLifeBars)}`}
        />
      ),
    },
    {
      key: 'hawkes',
      node: (
        <Stat
          label="Hawkes"
          source={{ tone: 'model', label: 'MODEL', title: 'λ(t) = μ + Σ α·e^(−β(t−tᵢ)) na transakcjach HL; μ, α, β stałe (nieestymowane)' }}
          value={
            <span className="text-base">
              <span className="text-buy-ink" aria-hidden="true">▲</span> {quant.hawkesBuyIntensity.toFixed(2)}{' '}
              <span className="text-ink-3">/</span> <span className="text-sell-ink" aria-hidden="true">▼</span>{' '}
              {quant.hawkesSellIntensity.toFixed(2)}
            </span>
          }
          hint={`kupno / sprzedaż · η = ${quant.hawkesBranchingRatio ?? 'n/a'} (wymaga MLE)`}
        />
      ),
    },
    {
      key: 'hurst',
      node: (
        <Stat
          label="Hurst"
          source={{ tone: 'model', label: 'MODEL', title: 'R/S z korektą Anis-Lloyd na 45 log-zwrotach' }}
          value={<span>H {h.toFixed(3)}</span>}
          hint={
            <>
              {hurstRead}. R/S z korektą Anis-Lloyd; Lo (1991) — test może mylić krótką pamięć z długą.
            </>
          }
        />
      ),
    },
    {
      key: 'shannon',
      node: (
        <Stat
          label="Entropia"
          source={{ tone: 'model', label: 'MODEL', title: 'Entropia rozkładu: kupno/sprzedaż spot i perp ostatniej świecy + strony arkusza; znormalizowana do 0–1' }}
          value={<span>{quant.shannonEntropyBits.toFixed(3)}</span>}
          hint="Shannon, 0–1; 1 = masa równo rozłożona między stronami przepływu i arkusza"
        />
      ),
    },
    {
      key: 'vpin',
      node: (
        <Stat
          label="VPIN"
          source={{ tone: 'model', label: 'MODEL', title: 'Bulk volume classification, 50 kubełków wolumenowych' }}
          value={<span>{(quant.vpinToxicity * 100).toFixed(1)}%</span>}
          hint="Kontrowersyjny — Andersen & Bondarenko 2014; czytaj względem własnej historii."
        />
      ),
    },
    {
      key: 'kyle',
      node: (
        <Stat
          label="Kyle"
          source={{ tone: 'model', label: 'MODEL', title: 'OLS: ΔP na netto przepływie agresora z WebSocket HL; n/a gdy < 10 świec z realnym przepływem' }}
          value={
            <span>
              {quant.kyleLambdaPer1M !== null ? `$${quant.kyleLambdaPer1M.toFixed(2)}` : 'n/a'}
            </span>
          }
          hint={
            quant.kyleLambdaPer1M !== null ? 'λ: ruch ceny na $1M netto przepływu' : 'λ: za mało świec z realnym przepływem WS'
          }
        />
      ),
    },
  ];

  return (
    <div className={`grid gap-3 ${className}`}>
      {tiles.map((t) => (
        <Panel key={t.key} bodyClassName="p-3.5">
          {t.node}
        </Panel>
      ))}
    </div>
  );
};

/** Kalkulator wielkości pozycji ze stałego ryzyka % kapitału (bez Kelly — brak skalibrowanych prawdopodobieństw). */
export const PositionSizer: React.FC<{ atr14: number; currentPrice: number }> = ({ atr14, currentPrice }) => {
  const id = useId();
  const [equity, setEquity] = useState<number>(25000);
  const [riskPct, setRiskPct] = useState<number>(1);
  const [stopUsd, setStopUsd] = useState<number | null>(null);

  const defaultStop = Number.isFinite(atr14) && atr14 > 0 ? Math.round(atr14 * 1.2) : null;
  const stop = stopUsd ?? defaultStop;
  const dollarRisk = equity > 0 && riskPct > 0 ? equity * (riskPct / 100) : null;
  const sizeBtc = dollarRisk !== null && stop !== null && stop > 0 ? dollarRisk / stop : null;
  const notional = sizeBtc !== null && currentPrice > 0 ? sizeBtc * currentPrice : null;
  const leverage = notional !== null && equity > 0 ? notional / equity : null;

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const inputCls =
    'w-32 min-h-11 sm:min-h-9 bg-page border border-line-strong rounded-lg px-2.5 text-right font-mono tabular-nums text-sm text-ink-1';

  return (
    <Panel
      title="Wielkość pozycji"
      eyebrow="Stałe ryzyko %"
      actions={<Badge tone="neutral" title="Kelly pominięty: prawdopodobieństwa heurystyki nie są skalibrowane">bez Kelly</Badge>}
      className="h-full"
      bodyClassName="p-4 flex flex-col gap-3"
    >
      <label htmlFor={`${id}-eq`} className="flex items-center justify-between gap-3 text-sm text-ink-2">
        Kapitał (USD)
        <input id={`${id}-eq`} type="number" inputMode="decimal" min={0} step={500} value={equity} onChange={(e) => setEquity(num(e.target.value))} className={inputCls} />
      </label>
      <label htmlFor={`${id}-risk`} className="flex items-center justify-between gap-3 text-sm text-ink-2">
        Ryzyko na transakcję (%)
        <input
          id={`${id}-risk`}
          type="number"
          inputMode="decimal"
          min={0.1}
          max={10}
          step={0.25}
          value={riskPct}
          onChange={(e) => setRiskPct(Math.min(10, num(e.target.value)))}
          className={inputCls}
        />
      </label>
      <label htmlFor={`${id}-stop`} className="flex items-center justify-between gap-3 text-sm text-ink-2">
        <span>
          Dystans stopu (USD)
          <span className="block text-[11px] text-ink-3">puste = 1,2 × ATR(14){defaultStop !== null ? ` = ${defaultStop}` : ''}</span>
        </span>
        <input
          id={`${id}-stop`}
          type="number"
          inputMode="decimal"
          min={1}
          step={5}
          value={stopUsd ?? ''}
          placeholder={defaultStop !== null ? String(defaultStop) : DASH}
          onChange={(e) => setStopUsd(e.target.value === '' ? null : num(e.target.value))}
          className={inputCls}
        />
      </label>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-3 border-t border-line">
        {[
          { k: 'Ryzyko 1R', v: dollarRisk !== null ? fmtCompact(dollarRisk, '$') : DASH },
          { k: 'Wielkość', v: sizeBtc !== null ? `${sizeBtc.toFixed(3)} BTC` : DASH },
          { k: 'Nominał', v: notional !== null ? fmtCompact(notional, '$') : DASH },
          { k: 'Dźwignia efektywna', v: leverage !== null ? `${leverage.toFixed(1)}×` : DASH },
        ].map((row) => (
          <div key={row.k} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium truncate">{row.k}</dt>
            <dd className="font-mono tabular-nums text-base text-ink-1 truncate">{row.v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Wielkość = (kapitał × ryzyko %) / dystans stopu. Nie uwzględnia opłat, poślizgu ani ceny likwidacji.
      </p>
    </Panel>
  );
};
