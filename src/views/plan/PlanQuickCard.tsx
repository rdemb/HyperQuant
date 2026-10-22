import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useDesk } from '../../state/DeskContext';
import { Badge, Panel, Segmented, fmtPrice, fmtSigned } from '../../ui';
import { PlanDirection, analyzePlan, attachMarketModel, proposeLevels } from '../../utils/planAnalyzer';
import { ProbabilityBar } from './ProbabilityBar';
import { parseNum, useDebounced, usePlanMarket } from './hooks';

const HORIZON_MIN = 120;
/** Założony nominał do kosztów (poślizg z arkusza) w szybkiej ocenie — pełna analiza pozwala go zmienić. */
const QUICK_SIZE_USD = 10_000;

const inputCls =
  'w-full h-11 sm:h-9 bg-page border border-line rounded-md px-2.5 text-sm font-mono tabular-nums text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * Szybka ocena planu na ekranie Desk: kierunek, stop, cel → P(cel przed stopem) i EV w R (horyzont 2h).
 * Wejście = cena rynkowa (odświeżana co 3 s). Bez sygnałów: poziomy startowe to oznaczona propozycja ±1.5σ/±3σ.
 */
export const PlanQuickCard: React.FC = () => {
  const { prefillPlan } = useDesk();
  const market = usePlanMarket(HORIZON_MIN);
  const [direction, setDirection] = useState<PlanDirection>('LONG');
  // null = użytkownik nie edytował — pokazujemy propozycję liczoną na bieżąco
  const [stopStr, setStopStr] = useState<string | null>(null);
  const [targetStr, setTargetStr] = useState<string | null>(null);

  const entry = market.price;
  const proposal = proposeLevels(direction, entry, market.sigma);
  const isProposal = stopStr === null && targetStr === null;
  const stopShown = stopStr ?? (proposal ? String(Math.round(proposal.stop)) : '');
  const targetShown = targetStr ?? (proposal ? String(Math.round(proposal.target)) : '');
  const stop = parseNum(stopShown);
  const target = parseNum(targetShown);

  const input = useMemo(
    () =>
      attachMarketModel(
        {
          direction,
          entry,
          stop,
          target,
          sizeUsd: QUICK_SIZE_USD,
          horizonMin: HORIZON_MIN,
          sigmaHorizon: market.sigma,
          book: market.book,
          eventMultiplier: market.eventMultiplier,
        },
        market
      ),
    [direction, entry, stop, target, market.sigma, market.book, market.eventMultiplier, market.vol, market.price]
  );
  const deb = useDebounced(input, 200);
  const a = useMemo(() => analyzePlan(deb, { paths: 2000, seed: 7 }), [deb]);

  const changeDirection = (d: PlanDirection) => {
    setDirection(d);
    // Zmiana kierunku unieważnia poziomy po złej stronie — wracamy do propozycji
    setStopStr(null);
    setTargetStr(null);
  };

  const openFull = () =>
    prefillPlan({
      direction,
      entry: Number.isFinite(entry) ? Math.round(entry) : undefined,
      stop: Number.isFinite(stop) ? stop : undefined,
      target: Number.isFinite(target) ? target : undefined,
      source: 'Szybka ocena (Desk)',
      note: isProposal ? 'Poziomy z propozycji ±1.5σ/±3σ (2h) — do edycji.' : undefined,
    });

  return (
    <Panel
      title="Szybka ocena planu"
      eyebrow="Analizator · horyzont 2h · wejście po cenie rynkowej"
      actions={
        <Badge tone={market.source.tone} title={market.source.title}>
          {market.source.label}
        </Badge>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-start">
        <div className="md:col-span-5 lg:col-span-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Segmented<PlanDirection>
              ariaLabel="Kierunek planu"
              size="md"
              value={direction}
              onChange={changeDirection}
              options={[
                { value: 'LONG', label: <span><span className="text-buy-ink" aria-hidden="true">▲</span> LONG</span> },
                { value: 'SHORT', label: <span><span className="text-sell-ink" aria-hidden="true">▼</span> SHORT</span> },
              ]}
            />
            <span className="text-[11px] text-ink-3 font-mono tabular-nums">wejście {fmtPrice(entry, 0)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="quick-stop" className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1">
                <span className="text-sell-ink" aria-hidden="true">−</span> Stop
              </label>
              <input id="quick-stop" className={inputCls} inputMode="decimal" autoComplete="off" value={stopShown} onChange={(e) => setStopStr(e.target.value)} />
            </div>
            <div>
              <label htmlFor="quick-target" className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1">
                <span className="text-buy-ink" aria-hidden="true">+</span> Cel
              </label>
              <input id="quick-target" className={inputCls} inputMode="decimal" autoComplete="off" value={targetShown} onChange={(e) => setTargetStr(e.target.value)} />
            </div>
          </div>
          {isProposal && (
            <div className="text-[11px] text-ink-3">Propozycja startowa ±1.5σ / ±3σ (2h) — nie sygnał; wpisz własne poziomy.</div>
          )}
        </div>

        <div className="md:col-span-7 lg:col-span-8 flex flex-col gap-3 min-w-0">
          {a.ok ? (
            <>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">P(cel przed stopem)</div>
                  <div className="text-[28px] leading-tight font-semibold text-ink-1">{(a.mc.pTarget * 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">EV po kosztach</div>
                  <div className="text-xl leading-tight font-semibold text-ink-1 font-mono tabular-nums">{fmtSigned(a.evR, 2, ' R')}</div>
                </div>
                <div className="text-[11px] text-ink-3 pb-1">
                  R = 1 : {a.R.toFixed(2)} · koszty dla ${QUICK_SIZE_USD.toLocaleString('en-US')} nominału
                </div>
              </div>
              <ProbabilityBar pTarget={a.mc.pTarget} pStop={a.mc.pStop} pNeither={a.mc.pNeither} horizonLabel="2 h" />
            </>
          ) : (
            <ul role="alert" className="text-sm text-ink-2 space-y-1">
              {a.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div>
            <button
              type="button"
              onClick={openFull}
              className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-md bg-accent/15 border border-accent/40 text-accent text-sm font-medium hover:bg-accent/25 transition-colors"
            >
              Pełna analiza <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
};
