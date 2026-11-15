import React, { useId, useState } from 'react';
import { QuantMathMetrics } from '../types/trading';
import { Badge, Panel, Stat, DASH, fmtCompact, fmtPrice, fmtSigned, fmtFixed } from '../ui';
import { hurstSide } from '../utils/noiseBands';
import { hurstReadText, kyleParts, ouHalfLifeText, regimeParts, vpinParts } from './noiseText';
import { tr } from '../i18n';

// Panel metryk mikrostruktury — opis, bez rekomendacji (desk ocenia plan tradera, nie podsuwa wejść).

/** Reżim zmienności (BOCPD) na zamkniętych świecach: prawdopodobieństwo niedawnej zmiany i σ reżimu, bez kierunku ceny. */
export const QuantRegimePanel: React.FC<{ quant: QuantMathMetrics }> = ({ quant }) => {
  const r = regimeParts(quant.regime);
  return (
    <Panel
      title={tr('Reżim zmienności (BOCPD)', 'Volatility regime (BOCPD)')}
      eyebrow={tr('Zamknięte świece wykresu', 'Closed chart candles')}
      actions={
        <Badge
          tone="model"
          title={tr(
            'BOCPD (Adams i MacKay 2007) na log-zwrotach zamkniętych świec (do 300), prior ze 100 pierwszych, oczekiwana długość reżimu 200 świec — jak wskaźnik „Reżim zmienności” na wykresie',
            'BOCPD (Adams and MacKay 2007) on log returns of closed candles (up to 300), prior from the first 100, expected regime length 200 candles, as in the chart’s “Volatility regime” indicator'
          )}
        >
          MODEL
        </Badge>
      }
      bodyClassName="p-4"
    >
      <div className="text-xl font-semibold text-ink-1 leading-tight font-mono tabular-nums">{r.value ?? DASH}</div>
      <p className="text-xs text-ink-3 leading-relaxed mt-1">{r.detail}</p>
      <p className="text-[11px] text-ink-3 leading-relaxed mt-2">
        {tr(
          'Opis zmienności ostatnich świec, nie kierunek ceny. Rytm doby (np. otwarcie Nowego Jorku) też podnosi prawdopodobieństwo zmiany.',
          'A description of recent volatility, not a price direction. The daily rhythm (e.g. the New York open) also raises the change probability.'
        )}
      </p>
    </Panel>
  );
};

/** Kafle metryk: OU, Hurst, VPIN, λ Kyle'a — każda z metodą w znaczniku MODEL i niepewnością albo pasmem szumu. */
export const QuantMetricTiles: React.FC<{ quant: QuantMathMetrics; className?: string }> = ({
  quant,
  className = 'grid-cols-2 md:grid-cols-4',
}) => {
  const h = quant.hurstExponent;
  const vpin = vpinParts(quant.vpin);
  const kyle = kyleParts(quant.kyle);
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
      key: 'vpin',
      node: (
        <Stat
          label="VPIN"
          source={{ tone: 'model', card: 'vpin', label: 'MODEL', title: tr('Bulk volume classification, 50 kubełków wolumenowych; przedział 95% ze średnich 10 partii', 'Bulk volume classification, 50 volume buckets; 95% interval from the means of 10 batches') }}
          value={vpin.value === null ? DASH : <span>{vpin.value}</span>}
          hint={
            vpin.value === null
              ? vpin.detail
              : `${vpin.detail}. ${tr('Kontrowersyjny — Andersen & Bondarenko 2014; czytaj względem własnej historii.', 'Controversial (Andersen & Bondarenko 2014); read it against its own history.')}`
          }
        />
      ),
    },
    {
      key: 'kyle',
      node: (
        <Stat
          label="Kyle"
          missing={quant.kyle === null}
          source={{
            tone: 'model',
            card: 'kyle',
            label: 'MODEL',
            title: tr('OLS: ΔP na netto przepływie agresora z WebSocket HL, przedział t 95%; b/d, gdy < 10 świec z realnym przepływem', 'OLS: ΔP on net aggressor flow from the HL WebSocket, 95% t interval; n/a with < 10 candles of real flow'),
          }}
          value={<span className={quant.kyle?.zeroInside ? 'text-ink-3' : undefined}>{kyle.value ?? tr('b/d', 'n/a')}</span>}
          hint={kyle.detail}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-3 ${className}`}>
        {tiles.map((t) => (
          <Panel key={t.key} bodyClassName="p-3.5">
            {t.node}
          </Panel>
        ))}
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        {tr(
          'Endogeniczność taśmy (Hawkes dopasowany metodą największej wiarygodności): w panelu mechaniki arkusza.',
          'Tape endogeneity (Hawkes fitted by maximum likelihood): in the book mechanics panel.'
        )}
      </p>
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
