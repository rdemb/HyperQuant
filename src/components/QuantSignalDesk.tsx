import React, { useId, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { QuantMathMetrics } from '../types/trading';
import { Badge, Panel, Stat, DASH, fmtCompact, fmtPrice, fmtSigned, fmtFixed, fmtNum } from '../ui';
import { candlesLabel, horizonDuration } from '../views/micro/horizon';
import { tr } from '../i18n';

// Panel metryk mikrostruktury — bez sygnałów transakcyjnych (desk ocenia plan tradera, nie podsuwa wejść).

type Direction = 'LONG' | 'SHORT';

// Polskie nazwy reżimów z regułowej klasyfikacji silnika
const REGIME_PL: Record<QuantMathMetrics['regimeClassification'], { label: string; detail: string }> = {
  'Spot Absorption Bullish': {
    label: tr('Absorpcja spot (wzrostowa)', 'Spot absorption (bullish)'),
    detail: tr('Spot CVD rośnie mimo słabości perp przy świeżym OB popytowym. Wymaga danych spot (CEX opt-in).', 'Spot CVD rises despite perp weakness at a fresh demand OB. Needs spot data (CEX opt-in).'),
  },
  'Perp Exhaustion Bearish': {
    label: tr('Wyczerpanie perp (spadkowa)', 'Perp exhaustion (bearish)'),
    detail: tr('Perp CVD wyprzedza spot przy świeżym OB podażowym. Wymaga danych spot (CEX opt-in).', 'Perp CVD leads spot at a fresh supply OB. Needs spot data (CEX opt-in).'),
  },
  'Momentum Breakout': {
    label: 'Trend / momentum',
    detail: tr('Wykładnik Hursta > 0,6 — zwroty ostatnich świec są dodatnio skorelowane.', 'Hurst exponent > 0.6: returns of recent candles are positively correlated.'),
  },
  'Mean-Reversion Equilibrium': {
    label: tr('Równowaga', 'Equilibrium'),
    detail: tr('Żadna reguła trendu ani absorpcji nie jest spełniona — stan domyślny.', 'No trend or absorption rule is met; the default state.'),
  },
  'Liquidation Cascade Squeeze': {
    label: tr('Kaskada likwidacji', 'Liquidation cascade'),
    detail: tr('Szybki ruch napędzany szacowanym paliwem likwidacyjnym.', 'A fast move driven by estimated liquidation fuel.'),
  },
};

// Kolejność serii kategorycznych stała (series-1…5), legenda pod paskiem
const WEIGHT_SERIES: { key: keyof QuantMathMetrics['neuralAttentionWeights']; label: string; color: string }[] = [
  { key: 'shaakuniOBProximity', label: tr('Bliskość OB', 'OB proximity'), color: 'bg-series-1' },
  { key: 'spotCvdDelta', label: 'CVD spot/perp', color: 'bg-series-2' },
  { key: 'perpFundingAndLiq', label: tr('Likwidacje (szac.)', 'Liquidations (est.)'), color: 'bg-series-3' },
  { key: 'l2BookImbalance', label: tr('Nierównowaga L2', 'L2 imbalance'), color: 'bg-series-4' },
  { key: 'hawkesCascadeVelocity', label: 'Hawkes', color: 'bg-series-5' },
];

const fmtHalfLife = (v: number) => (Number.isFinite(v) ? `${fmtFixed(v, 1)} ${tr('świec', 'candles')}` : tr('∞ (brak powrotu)', '∞ (no reversion)'));

/** Przyciski przekazania kierunku do Analizatora planu — kierunek wybiera trader. */
export const PrefillButtons: React.FC<{ onPick: (dir: Direction) => void }> = ({ onPick }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <ClipboardList className="w-3.5 h-3.5 text-ink-3" aria-hidden="true" />
      {tr('Przekaż do planu', 'Send to plan')}
    </span>
    {(['LONG', 'SHORT'] as const).map((dir) => (
      <button
        key={dir}
        type="button"
        onClick={() => onPick(dir)}
        aria-label={`${tr('Przekaż do planu', 'Send to plan')}: ${dir === 'LONG' ? 'Long' : 'Short'}`}
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
      title={tr('Reżim i trajektoria', 'Regime and trajectory')}
      eyebrow={tr('Heurystyka', 'Heuristic')}
      actions={
        <Badge tone="model" title={tr('Klasyfikacja regułowa i ważona suma cech — bez sieci neuronowej', 'Rule-based classification and a weighted sum of features; no neural network')}>
          MODEL
        </Badge>
      }
      bodyClassName="p-4 flex flex-col gap-4"
    >
      <div>
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Reżim (reguły)', 'Regime (rules)')}</div>
        <div className="text-xl font-semibold text-ink-1 leading-tight mt-0.5">{regime.label}</div>
        <p className="text-xs text-ink-3 leading-relaxed mt-1">{regime.detail}</p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Trajektoria heurystyczna', 'Heuristic trajectory')}</span>
          <span className="text-[11px] text-ink-3">{tr('±1σ z ATR', '±1σ from ATR')}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {quant.forecastHorizon.map((fh) => {
            const diff = fh.predictedPrice - currentPrice;
            const up = diff >= 0;
            return (
              <div key={fh.stepBars} className="bg-page border border-line rounded-lg px-1.5 py-2 text-center min-w-0">
                <div className="text-[11px] text-ink-2 font-medium leading-tight">{candlesLabel(fh.stepBars)}</div>
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
          {tr(
            `Kalman + OU + ważona suma cech; horyzonty to liczba świec przy bieżącym interwale. Nieskalibrowana — nie jest prognozą ani prawdopodobieństwem. Siła heurystyki: ${quant.neuralConfidence}/100.`,
            `Kalman + OU + weighted sum of features; horizons are numbers of candles at the current interval. Uncalibrated: not a forecast or a probability. Heuristic strength: ${quant.neuralConfidence}/100.`
          )}
        </p>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Wagi cech heurystyki', 'Heuristic feature weights')}</div>
        <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-page" role="img" aria-label={tr('Udział cech w heurystyce', 'Share of features in the heuristic')}>
          {WEIGHT_SERIES.map((s) => (
            <span
              key={s.key}
              className={`${s.color} h-full border-r border-surface-1 last:border-r-0`}
              style={{ width: `${(weights[s.key] * 100).toFixed(1)}%` }}
              title={`${s.label}: ${fmtFixed(weights[s.key] * 100, 0)}%`}
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
              <span className="font-mono tabular-nums text-ink-1">{fmtFixed(weights[s.key] * 100, 0)}%</span>
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
                tr('Mikrostruktura', 'Microstructure'),
                `${tr('Reżim', 'Regime')}: ${regime.label} · OU Z ${fmtSigned(quant.ouZScore, 2)}σ · Hurst ${quant.hurstExponent} · VPIN ${fmtFixed(quant.vpinToxicity * 100, 0)}%`
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
  const hurstRead =
    h < 0.45 ? tr('antypersystencja (powroty)', 'anti-persistence (reversals)') : h > 0.6 ? tr('persystencja (trend)', 'persistence (trend)') : tr('blisko błądzenia losowego', 'close to a random walk');
  const tiles: { key: string; node: React.ReactNode }[] = [
    {
      key: 'ou',
      node: (
        <Stat
          label="OU"
          source={{
            tone: 'model',
            label: 'MODEL',
            title: tr('Ornstein-Uhlenbeck: regresja ΔP na odchyleniu od 0,65·D-EQ + 0,35·W-EQ (40 świec)', 'Ornstein-Uhlenbeck: regression of ΔP on the deviation from 0.65·D-EQ + 0.35·W-EQ (40 candles)'),
          }}
          value={<span>Z {fmtSigned(quant.ouZScore, 2)}σ</span>}
          hint={`${tr('powrót do EQ', 'reversion to EQ')} ${fmtPrice(quant.ouEquilibriumPrice, 0)} · t½ ${fmtHalfLife(quant.ouHalfLifeBars)}`}
        />
      ),
    },
    {
      key: 'hawkes',
      node: (
        <Stat
          label="Hawkes"
          source={{ tone: 'model', label: 'MODEL', title: tr('λ(t) = μ + Σ α·e^(−β(t−tᵢ)) na transakcjach HL; μ, α, β stałe (nieestymowane)', 'λ(t) = μ + Σ α·e^(−β(t−tᵢ)) on HL trades; μ, α, β fixed (not estimated)') }}
          value={
            <span className="text-base">
              <span className="text-buy-ink" aria-hidden="true">▲</span> {fmtFixed(quant.hawkesBuyIntensity, 2)}{' '}
              <span className="text-ink-3">/</span> <span className="text-sell-ink" aria-hidden="true">▼</span>{' '}
              {fmtFixed(quant.hawkesSellIntensity, 2)}
            </span>
          }
          hint={tr(`kupno / sprzedaż · η = ${quant.hawkesBranchingRatio != null ? fmtNum(quant.hawkesBranchingRatio) : 'b/d'} (wymaga MLE)`, `buy / sell · η = ${quant.hawkesBranchingRatio != null ? fmtNum(quant.hawkesBranchingRatio) : 'n/a'} (needs MLE)`)}
        />
      ),
    },
    {
      key: 'hurst',
      node: (
        <Stat
          label="Hurst"
          source={{ tone: 'model', label: 'MODEL', title: tr('R/S z korektą Anis-Lloyd na 45 log-zwrotach', 'R/S with the Anis-Lloyd correction on 45 log returns') }}
          value={<span>H {fmtFixed(h, 3)}</span>}
          hint={
            <>
              {hurstRead}. {tr('R/S z korektą Anis-Lloyd; Lo (1991) — test może mylić krótką pamięć z długą.', 'R/S with the Anis-Lloyd correction; Lo (1991): the test can mistake short memory for long.')}
            </>
          }
        />
      ),
    },
    {
      key: 'shannon',
      node: (
        <Stat
          label={tr('Entropia', 'Entropy')}
          source={{
            tone: 'model',
            label: 'MODEL',
            title: tr(
              'Entropia rozkładu: kupno/sprzedaż spot i perp ostatniej świecy + strony arkusza; znormalizowana do 0–1',
              'Entropy of the distribution: spot and perp buy/sell of the last candle + book sides; normalised to 0–1'
            ),
          }}
          value={<span>{fmtFixed(quant.shannonEntropyBits, 3)}</span>}
          hint={tr('Shannon, 0–1; 1 = masa równo rozłożona między stronami przepływu i arkusza', 'Shannon, 0–1; 1 = mass spread evenly between the flow and book sides')}
        />
      ),
    },
    {
      key: 'vpin',
      node: (
        <Stat
          label="VPIN"
          source={{ tone: 'model', label: 'MODEL', title: tr('Bulk volume classification, 50 kubełków wolumenowych', 'Bulk volume classification, 50 volume buckets') }}
          value={<span>{fmtFixed(quant.vpinToxicity * 100, 1)}%</span>}
          hint={tr('Kontrowersyjny — Andersen & Bondarenko 2014; czytaj względem własnej historii.', 'Controversial (Andersen & Bondarenko 2014); read it against its own history.')}
        />
      ),
    },
    {
      key: 'kyle',
      node: (
        <Stat
          label="Kyle"
          source={{
            tone: 'model',
            label: 'MODEL',
            title: tr('OLS: ΔP na netto przepływie agresora z WebSocket HL; b/d, gdy < 10 świec z realnym przepływem', 'OLS: ΔP on net aggressor flow from the HL WebSocket; n/a with < 10 candles of real flow'),
          }}
          value={
            <span>
              {quant.kyleLambdaPer1M !== null ? `$${fmtFixed(quant.kyleLambdaPer1M, 2)}` : tr('b/d', 'n/a')}
            </span>
          }
          hint={
            quant.kyleLambdaPer1M !== null ? tr('λ: ruch ceny na $1M netto przepływu', 'λ: price move per $1M of net flow') : tr('λ: za mało świec z realnym przepływem WS', 'λ: too few candles with real WS flow')
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
      title={tr('Wielkość pozycji', 'Position size')}
      eyebrow={tr('Stałe ryzyko %', 'Fixed risk %')}
      actions={
        <Badge tone="neutral" title={tr('Kelly pominięty: prawdopodobieństwa heurystyki nie są skalibrowane', 'Kelly skipped: the heuristic probabilities are not calibrated')}>
          {tr('bez Kelly', 'no Kelly')}
        </Badge>
      }
      className="h-full"
      bodyClassName="p-4 flex flex-col gap-3"
    >
      <label htmlFor={`${id}-eq`} className="flex items-center justify-between gap-3 text-sm text-ink-2">
        {tr('Kapitał (USD)', 'Capital (USD)')}
        <input id={`${id}-eq`} type="number" inputMode="decimal" min={0} step={500} value={equity} onChange={(e) => setEquity(num(e.target.value))} className={inputCls} />
      </label>
      <label htmlFor={`${id}-risk`} className="flex items-center justify-between gap-3 text-sm text-ink-2">
        {tr('Ryzyko na transakcję (%)', 'Risk per trade (%)')}
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
          {tr('Dystans stopu (USD)', 'Stop distance (USD)')}
          <span className="block text-[11px] text-ink-3">
            {tr('puste = 1,2 × ATR(14)', 'empty = 1.2 × ATR(14)')}
            {defaultStop !== null ? ` = ${defaultStop}` : ''}
          </span>
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
          { k: tr('Ryzyko 1R', '1R risk'), v: dollarRisk !== null ? fmtCompact(dollarRisk, '$') : DASH },
          { k: tr('Wielkość', 'Size'), v: sizeBtc !== null ? `${fmtFixed(sizeBtc, 3)} BTC` : DASH },
          { k: tr('Nominał', 'Notional'), v: notional !== null ? fmtCompact(notional, '$') : DASH },
          { k: tr('Dźwignia efektywna', 'Effective leverage'), v: leverage !== null ? `${fmtFixed(leverage, 1)}×` : DASH },
        ].map((row) => (
          <div key={row.k} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium truncate">{row.k}</dt>
            <dd className="font-mono tabular-nums text-base text-ink-1 truncate">{row.v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        {tr(
          'Wielkość = (kapitał × ryzyko %) / dystans stopu. Nie uwzględnia opłat, poślizgu ani ceny likwidacji.',
          'Size = (capital × risk %) / stop distance. Excludes fees, slippage and the liquidation price.'
        )}
      </p>
    </Panel>
  );
};
