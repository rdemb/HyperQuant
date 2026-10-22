import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDesk } from '../state/DeskContext';
import { PlanDraft } from '../state/types';
import { Panel, Segmented } from '../ui';
import { PlanInput, analyzePlan, attachMarketModel, proposeLevels, sizeFromRiskWithBook } from '../utils/planAnalyzer';
import { makeEntry } from '../utils/forecastLedger';
import { DayTradingPrepDesk } from '../components/DayTradingPrepDesk';
import { PlanForm, PlanFormState } from './plan/PlanForm';
import { PlanResult } from './plan/PlanResult';
import { LedgerPanel } from './plan/LedgerPanel';
import { DeskLedgerPanel } from './plan/DeskLedgerPanel';
import { AuctionContextPanel } from './plan/AuctionContextPanel';
import { usePlanLedger } from './plan/usePlanLedger';
import { parseNum, planSigma, useDebounced, usePlanMarket, useStoredString } from './plan/hooks';

type Tab = 'analyzer' | 'tomorrow';

// Stan formularza przeżywa przełączanie widoków w obrębie sesji (widok jest montowany leniwie)
let savedForm: PlanFormState | null = null;
let appliedDraft: PlanDraft | null = null;

const fmtInput = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : '');

function defaultForm(price: number, sigma: number): PlanFormState {
  const lv = proposeLevels('LONG', price, sigma);
  return {
    direction: 'LONG',
    entry: fmtInput(price),
    stop: fmtInput(lv?.stop),
    target: fmtInput(lv?.target),
    sizeMode: 'usd',
    sizeUsd: '10000',
    riskPct: '1',
    leverage: '3',
    horizonMin: 120,
    proposal: true,
    pristine: true,
    draft: null,
  };
}

/** Szkic z panelu → formularz; brak poziomów w szkicu = propozycja ±1.5σ/±3σ (oznaczona). */
function formFromDraft(d: PlanDraft, base: PlanFormState, price: number, sigmaFor: (h: number) => number): PlanFormState {
  const entry = d.entry ?? price;
  const hasLevels = d.stop !== undefined && d.target !== undefined;
  const lv = hasLevels ? null : proposeLevels(d.direction, entry, sigmaFor(base.horizonMin));
  return {
    ...base,
    direction: d.direction,
    entry: fmtInput(entry),
    stop: fmtInput(hasLevels ? d.stop : lv?.stop),
    target: fmtInput(hasLevels ? d.target : lv?.target),
    proposal: !hasLevels,
    pristine: false,
    draft: { source: d.source, note: d.note },
  };
}

/** Widok „Analizator planu”: formularz + wynik (bohater), dziennik trafności, zakładka „Plan na jutro”. */
const PlanView: React.FC = () => {
  const { feed, shaakuni, quant, planDraft, prefillPlan } = useDesk();
  const [tab, setTab] = useState<Tab>('analyzer');
  const volModel = feed.vol.model;
  const sigmaFor = useCallback(
    (h: number) => planSigma(volModel, feed.bars, feed.timeframeSec, Date.now(), h),
    [volModel, feed.bars, feed.timeframeSec]
  );
  // Szkic czekający przy montażu trafia od razu do stanu początkowego (inicjalizator bez efektów ubocznych)
  const initDraft = useRef<PlanDraft | null>(planDraft && planDraft !== appliedDraft ? planDraft : null);
  const [form, setForm] = useState<PlanFormState>(() => {
    const base = savedForm ?? defaultForm(feed.currentPrice, sigmaFor(120));
    return initDraft.current ? formFromDraft(initDraft.current, base, feed.currentPrice, sigmaFor) : base;
  });
  const [equity, setEquity] = useStoredString('hq.plan.equity', '10000');
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const market = usePlanMarket(form.horizonMin);

  useEffect(() => {
    savedForm = form;
  }, [form]);

  // Nowy szkic z innego panelu (także z zakładki „Plan na jutro”) → formularz i zakładka analizatora
  useEffect(() => {
    if (!planDraft || planDraft === appliedDraft) return;
    appliedDraft = planDraft;
    if (planDraft === initDraft.current) return;
    setForm((f) => formFromDraft(planDraft, f, feed.currentPrice, sigmaFor));
    setTab('analyzer');
    window.scrollTo({ top: 0 });
  }, [planDraft, feed.currentPrice, sigmaFor]);

  // Nietknięty formularz odświeżamy, gdy świece zastępcze zastąpią realne dane albo dojdzie model zmienności
  const hasVolModel = volModel !== null;
  useEffect(() => {
    if (!market.realBars) return;
    setForm((f) => (f.pristine ? defaultForm(feed.currentPrice, sigmaFor(f.horizonMin)) : f));
  }, [market.realBars, hasVolModel]); // celowo tylko przy zmianie źródła świec lub σ

  const onChange = useCallback(
    (patch: Partial<PlanFormState>) =>
      setForm((f) => {
        const next: PlanFormState = { ...f, ...patch, pristine: 'draft' in patch && Object.keys(patch).length === 1 ? f.pristine : false };
        // Propozycja σ podąża za kierunkiem, horyzontem i wejściem, dopóki użytkownik nie wpisze własnych poziomów
        if (next.proposal && ('direction' in patch || 'horizonMin' in patch || 'entry' in patch)) {
          const lv = proposeLevels(next.direction, parseNum(next.entry), sigmaFor(next.horizonMin));
          if (lv) {
            next.stop = fmtInput(lv.stop);
            next.target = fmtInput(lv.target);
          }
        }
        return next;
      }),
    [sigmaFor]
  );

  const entry = parseNum(form.entry);
  const stop = parseNum(form.stop);
  const target = parseNum(form.target);
  const leverage = form.leverage.trim() === '' ? undefined : parseNum(form.leverage);
  const equityN = parseNum(equity);
  const riskPctN = parseNum(form.riskPct);
  const riskSizeUsd = useMemo(
    () =>
      form.sizeMode === 'risk'
        ? sizeFromRiskWithBook({ equity: equityN, riskPct: riskPctN, direction: form.direction, entry, stop, book: market.book })
        : Number.NaN,
    [form.sizeMode, equityN, riskPctN, form.direction, entry, stop, market.book]
  );
  const sizeUsd = form.sizeMode === 'usd' ? parseNum(form.sizeUsd) : riskSizeUsd;

  const input: PlanInput = useMemo(
    () =>
      attachMarketModel(
        {
          direction: form.direction,
          entry,
          stop,
          target,
          sizeUsd,
          horizonMin: form.horizonMin,
          leverage,
          sigmaHorizon: market.sigma,
          book: market.book,
          eventMultiplier: market.eventMultiplier,
        },
        // Model zmienności i cena rynku (faza wypełnienia — tak samo rozlicza dziennik)
        market
      ),
    [
      form.direction,
      entry,
      stop,
      target,
      sizeUsd,
      form.horizonMin,
      leverage,
      market.sigma,
      market.book,
      market.eventMultiplier,
      market.vol,
      market.price,
    ]
  );
  // Przy szybkim pisaniu liczymy po 200 ms ciszy; do tego czasu zostaje poprzedni wynik
  const debInput = useDebounced(input, 200);
  const analysis = useMemo(() => analyzePlan(debInput, { paths: 2000, seed: 7 }), [debInput]);

  const ledger = usePlanLedger();

  const saveBlocked = !analysis.ok
    ? 'Popraw plan, aby go zapisać.'
    : market.source.tone === 'sim'
    ? 'Zapis wyłączony: świece zastępcze (SIM) — czekam na dane Hyperliquid.'
    : null;

  const onSave = () => {
    if (!analysis.ok || saveBlocked) return;
    ledger.add(
      makeEntry(
        {
          direction: debInput.direction,
          entry: debInput.entry,
          stop: debInput.stop,
          target: debInput.target,
          horizonMin: debInput.horizonMin,
          pTarget: analysis.mc.pTarget,
          pStop: analysis.mc.pStop,
          pNeither: analysis.mc.pNeither,
          pFill: analysis.mc.pFill,
          fillRare: analysis.mc.fillRare,
          modelVersion: analysis.mc.modelVersion,
          startPrice: debInput.startPrice,
          source: form.draft?.source,
        },
        Date.now()
      )
    );
    setJustSaved(true);
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setJustSaved(false), 1600);
  };
  useEffect(() => () => {
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Tab>
          ariaLabel="Sekcja widoku planu"
          size="md"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'analyzer', label: 'Analizator planu' },
            { value: 'tomorrow', label: 'Plan na jutro' },
          ]}
        />
        <span className="text-xs text-ink-3">Desk ocenia Twój plan — nie podsuwa wejść.</span>
      </div>

      {tab === 'analyzer' ? (
        <>
          <Panel hero title="Analizator planu" eyebrow="BTC-PERP · Hyperliquid">
            <div className="grid grid-cols-1 lg:grid-cols-12">
              <div className="lg:col-span-5 xl:col-span-4 p-4 border-b lg:border-b-0 lg:border-r border-line">
                <PlanForm
                  form={form}
                  onChange={onChange}
                  equity={equity}
                  onEquity={setEquity}
                  marketPrice={market.price}
                  sigma={market.sigma}
                  riskSizeUsd={riskSizeUsd}
                />
              </div>
              <div className="lg:col-span-7 xl:col-span-8 p-4 min-w-0">
                <PlanResult
                  analysis={analysis}
                  entry={debInput.entry}
                  stop={debInput.stop}
                  target={debInput.target}
                  sizeUsd={debInput.sizeUsd}
                  leverage={debInput.leverage}
                  horizonMin={debInput.horizonMin}
                  market={market}
                  ledgerEntries={ledger.entries}
                  resolvedCount={ledger.metrics.resolved}
                  risk={form.sizeMode === 'risk' ? { equity: equityN, riskPct: riskPctN } : null}
                  onSave={onSave}
                  saveBlocked={saveBlocked}
                  justSaved={justSaved}
                />
              </div>
            </div>
          </Panel>
          <AuctionContextPanel />
          <LedgerPanel ledger={ledger} />
          <DeskLedgerPanel />
        </>
      ) : (
        <DayTradingPrepDesk shaakuni={shaakuni} quant={quant} currentPrice={feed.currentPrice} onPrefillPlan={prefillPlan} />
      )}
    </div>
  );
};
export default PlanView;
