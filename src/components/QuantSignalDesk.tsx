import React, { useId, useState } from 'react';
import { QuantMathMetrics } from '../types/trading';
import { Badge, Panel, Stat, DASH, fmtCompact, fmtPrice, fmtSigned, fmtFixed, fmtNum } from '../ui';
import { hurstSide } from '../utils/noiseBands';
import { hurstReadText, ouHalfLifeText } from './noiseText';
import { tr } from '../i18n';

// Panel metryk mikrostruktury — bez sygnałów transakcyjnych (desk ocenia plan tradera, nie podsuwa wejść).


// Nazwy reżimów z regułowej klasyfikacji silnika: opis ostatnich świec, nie kierunek ani rada
export const REGIME_TEXT: Record<QuantMathMetrics['regimeClassification'], { label: string; detail: string }> = {
  'Spot CVD Lead': {
    label: tr('CVD spot wyprzedzał perp', 'Spot CVD led perp'),
    detail: tr(
      'W ostatnich 16 świecach zmiana CVD spot była wyraźnie większa niż zmiana CVD perp, bez przewagi świeżych OB podaży w pobliżu. Opis przeszłości, nie kierunek. Wymaga danych spot (CEX opt-in).',
      'Over the last 16 candles the spot CVD change was clearly larger than the perp CVD change, with no fresh supply OBs dominating nearby. A description of the past, not a direction. Needs spot data (CEX opt-in).'
    ),
  },
  'Perp CVD Lead': {
    label: tr('CVD perp wyprzedzał spot', 'Perp CVD led spot'),
    detail: tr(
      'W ostatnich 16 świecach zmiana CVD perp była wyraźnie większa niż zmiana CVD spot, bez przewagi świeżych OB popytu w pobliżu. Opis przeszłości, nie kierunek. Wymaga danych spot (CEX opt-in).',
      'Over the last 16 candles the perp CVD change was clearly larger than the spot CVD change, with no fresh demand OBs dominating nearby. A description of the past, not a direction. Needs spot data (CEX opt-in).'
    ),
  },
  'Momentum Breakout': {
    label: 'Trend / momentum',
    detail: tr('Wykładnik Hursta > 0,6 — zwroty ostatnich świec są dodatnio skorelowane.', 'Hurst exponent > 0.6: returns of recent candles are positively correlated.'),
  },
  'Mean-Reversion Equilibrium': {
    label: tr('Równowaga', 'Equilibrium'),
    detail: tr('Żadna reguła trendu ani absorpcji nie jest spełniona — stan domyślny.', 'No trend or absorption rule is met; the default state.'),
  },
};

/** Reżim z reguł silnika: opis ostatnich świec, bez kierunku ceny. */
export const QuantRegimePanel: React.FC<{ quant: QuantMathMetrics }> = ({ quant }) => {
  const regime = REGIME_TEXT[quant.regimeClassification];
  return (
    <Panel
      title={tr('Reżim (reguły)', 'Regime (rules)')}
      eyebrow={tr('Opis ostatnich świec', 'Recent candles')}
      actions={
        <Badge tone="model" title={tr('Klasyfikacja regułowa ostatnich świec, bez prognozy', 'Rule-based classification of recent candles, no forecast')}>
          MODEL
        </Badge>
      }
      bodyClassName="p-4"
    >
      <div className="text-xl font-semibold text-ink-1 leading-tight">{regime.label}</div>
      <p className="text-xs text-ink-3 leading-relaxed mt-1">{regime.detail}</p>
    </Panel>
  );
};

/** Kafle metryk: OU, Hawkes, Hurst, Shannon, VPIN, λ Kyle'a — każda z metodą w znaczniku MODEL. */
export const QuantMetricTiles: React.FC<{ quant: QuantMathMetrics; className?: string }> = ({
  quant,
  className = 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
}) => {
  const h = quant.hurstExponent;
  const tiles: { key: string; node: React.ReactNode }[] = [
    {
      key: 'ou',
      node: (
        <Stat
          label="OU"
          source={{
            tone: 'model',
            card: 'ou',
            label: 'MODEL',
            title: tr('Ornstein-Uhlenbeck: regresja ΔP na odchyleniu od 0,65·D-EQ + 0,35·W-EQ (40 świec)', 'Ornstein-Uhlenbeck: regression of ΔP on the deviation from 0.65·D-EQ + 0.35·W-EQ (40 candles)'),
          }}
          value={<span>Z {fmtSigned(quant.ouZScore, 2)}σ</span>}
          hint={`${tr('kotwica', 'anchor')} ${fmtPrice(quant.ouEquilibriumPrice, 0)} · ${ouHalfLifeText(quant.ouTheta, quant.ouHalfLifeBars)}`}
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
            // W wąskim kafelku (1024 px) druga intensywność przechodzi do drugiego wiersza zamiast wielokropka
            <span className="text-base whitespace-normal">
              <span className="whitespace-nowrap">
                <span className="text-buy-ink" aria-hidden="true">▲</span> {fmtFixed(quant.hawkesBuyIntensity, 2)}
              </span>{' '}
              <span className="text-ink-3">/</span>{' '}
              <span className="whitespace-nowrap">
                <span className="text-sell-ink" aria-hidden="true">▼</span> {fmtFixed(quant.hawkesSellIntensity, 2)}
              </span>
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
          source={{ tone: 'model', card: 'hurst', label: 'MODEL', title: tr('R/S z korektą Anis-Lloyd na 45 log-zwrotach', 'R/S with the Anis-Lloyd correction on 45 log returns') }}
          value={h === null ? DASH : <span className={hurstSide(h) === 'noise' ? 'text-ink-3' : undefined}>H {fmtFixed(h, 3)}</span>}
          hint={
            h === null ? (
              tr('za mało zwrotów (min. 8) albo cena bez zmian', 'too few returns (min. 8) or a flat price')
            ) : (
              <>
                {hurstReadText(h)}. {tr('R/S z korektą Anis-Lloyd; Lo (1991) — test może mylić krótką pamięć z długą.', 'R/S with the Anis-Lloyd correction; Lo (1991): the test can mistake short memory for long.')}
              </>
            )
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
          source={{ tone: 'model', card: 'vpin', label: 'MODEL', title: tr('Bulk volume classification, 50 kubełków wolumenowych', 'Bulk volume classification, 50 volume buckets') }}
          value={quant.vpinToxicity === null ? DASH : <span>{fmtFixed(quant.vpinToxicity * 100, 1)}%</span>}
          hint={
            quant.vpinToxicity === null
              ? tr('brak wolumenu w świecach (żaden pełny kubełek)', 'no candle volume (no full bucket)')
              : tr('Kontrowersyjny — Andersen & Bondarenko 2014; czytaj względem własnej historii.', 'Controversial (Andersen & Bondarenko 2014); read it against its own history.')
          }
        />
      ),
    },
    {
      key: 'kyle',
      node: (
        <Stat
          label="Kyle"
          missing={quant.kyleLambdaPer1M === null}
          source={{
            tone: 'model',
            card: 'kyle',
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
            <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium leading-snug">{row.k}</dt>
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
