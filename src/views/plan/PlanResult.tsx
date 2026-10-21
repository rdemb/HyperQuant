import React from 'react';
import { AlertTriangle, BookmarkPlus, Check, OctagonAlert } from 'lucide-react';
import { Badge, Stat, fmtCompact, fmtPrice, fmtSigned } from '../../ui';
import { BTC_MAX_LEVERAGE, DEFAULT_TAKER_FEE, PlanAnalysis, quarterKelly, wilsonLowerBound } from '../../utils/planAnalyzer';
import { LedgerEntry, bucketIndex, bucketStats } from '../../utils/forecastLedger';
import { MacroEvent } from '../../data/macroCalendar';
import { ProbabilityBar } from './ProbabilityBar';
import { PathFan } from './PathFan';
import { PlanMarket, fmtMinutes } from './hooks';

/** Minimalna liczba rozstrzygniętych planów, zanim pokażemy ćwierć-Kelly. */
const KELLY_MIN_RESOLVED = 50;

interface PlanResultProps {
  analysis: PlanAnalysis;
  entry: number;
  stop: number;
  target: number;
  sizeUsd: number;
  leverage?: number;
  horizonMin: number;
  market: PlanMarket;
  ledgerEntries: LedgerEntry[];
  resolvedCount: number;
  risk: { equity: number; riskPct: number } | null;
  onSave: () => void;
  saveBlocked: string | null;
  justSaved: boolean;
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const evtFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Wynik analizy: P(cel przed stopem) jako bohater, pasek trzech wyników, wachlarz ścieżek, EV, koszty, likwidacja, wielkość. */
export const PlanResult: React.FC<PlanResultProps> = (p) => {
  const { analysis: a, market } = p;
  if (!a.ok) {
    return (
      <div role="alert" className="flex flex-col gap-2">
        {a.errors.map((e) => (
          <div key={e} className="flex items-start gap-2 text-sm text-ink-1">
            <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" aria-hidden="true" />
            <span>{e}</span>
          </div>
        ))}
        <div className="text-xs text-ink-3 mt-1">Popraw plan — wynik pojawi się automatycznie.</div>
      </div>
    );
  }

  const { mc, costs } = a;
  const horizonLabel = fmtMinutes(p.horizonMin);
  const btc = p.sizeUsd / p.entry;

  // Ćwierć-Kelly dopiero przy ≥ 50 rozstrzygniętych planach — z dolnej granicy Wilsona w koszyku prognozy
  let kelly: React.ReactNode;
  let kellyHint: React.ReactNode;
  if (p.resolvedCount < KELLY_MIN_RESOLVED) {
    kelly = '—';
    kellyHint = `zablokowany: ${p.resolvedCount}/${KELLY_MIN_RESOLVED} rozstrzygniętych planów w dzienniku`;
  } else {
    const b = bucketStats(p.ledgerEntries, mc.pTarget);
    const pL = wilsonLowerBound(b.hits, b.n);
    const f = quarterKelly(pL, a.R);
    const idx = bucketIndex(mc.pTarget);
    kelly = `${(f * 100).toFixed(1)}% kapitału`;
    kellyHint = `¼·max(0, p_L − (1−p_L)/R); p_L = ${pct1(pL)} (Wilson 95%) w koszyku ${idx * 10}–${idx * 10 + 10}% · n = ${b.n}, trafień ${b.hits}`;
  }

  const liq = a.liquidation;
  const limitGap = Number.isFinite(market.price) && market.price > 0 ? ((p.entry - market.price) / market.price) * 100 : null;
  const levGiven = p.leverage !== undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* Bohater: P(cel przed stopem) + pasek trzech wyników */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">P(cel przed stopem) · {horizonLabel}</span>
              <Badge tone={market.source.tone} title={market.source.title}>
                {market.source.label}
              </Badge>
            </div>
            <div className="text-[28px] sm:text-[44px] leading-none font-semibold text-ink-1 mt-1.5">{pct1(mc.pTarget)}</div>
            <div className="text-xs text-ink-3 mt-1.5">
              R = 1 : {a.R.toFixed(2)} · bez limitu czasu (formuła): cel {pct1(a.closedForm.pTarget)} · stop {pct1(a.closedForm.pStop)}
            </div>
            {limitGap !== null && Math.abs(limitGap) > 0.1 && (
              <div className="text-xs text-ink-3 mt-0.5">
                Wejście {fmtSigned(limitGap, 2, '%')} od rynku — wynik warunkowy na wypełnienie zlecenia (nie ocenia, czy cena tam dojdzie).
              </div>
            )}
          </div>
          <SaveButton onSave={p.onSave} blocked={p.saveBlocked} justSaved={p.justSaved} />
        </div>
        <div className="mt-4">
          <ProbabilityBar pTarget={mc.pTarget} pStop={mc.pStop} pNeither={mc.pNeither} horizonLabel={horizonLabel} />
        </div>
        <div className="text-[11px] text-ink-3 mt-2 font-mono tabular-nums">
          {mc.timeToTarget && `do celu: mediana ${fmtMinutes(mc.timeToTarget.p50)} (P25–P75 ${fmtMinutes(mc.timeToTarget.p25)}–${fmtMinutes(mc.timeToTarget.p75)})`}
          {mc.timeToTarget && mc.timeToStop && ' · '}
          {mc.timeToStop && `do stopu: mediana ${fmtMinutes(mc.timeToStop.p50)} (P25–P75 ${fmtMinutes(mc.timeToStop.p25)}–${fmtMinutes(mc.timeToStop.p75)})`}
        </div>
      </div>

      <MacroWindow events={market.events} loaded={market.calendarLoaded} multiplier={market.eventMultiplier} />

      <PathFan mc={mc} entry={p.entry} stop={p.stop} target={p.target} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-4">
        <Stat
          label="EV po kosztach"
          source={{ tone: 'model', label: 'MODEL' }}
          value={<span className="font-mono tabular-nums">{fmtSigned(a.evR, 2, ' R')}</span>}
          hint={
            <>
              przed kosztami {fmtSigned(a.evRGross, 2, ' R')} · koszty {costs.totalR.toFixed(2)} R ({fmtPrice(costs.totalUsd, 2)} $)
              <br />
              dryf 0 ⇒ ≈ 0 R przed kosztami — przewagę wykaże tylko dziennik
            </>
          }
        />
        <Stat
          label="Poślizg wejścia (L2)"
          source={a.entrySlip ? { tone: market.source.tone === 'sim' ? 'sim' : 'live', label: market.source.tone === 'sim' ? 'SIM' : 'LIVE' } : undefined}
          value={
            a.entrySlip ? (
              <span className="font-mono tabular-nums">
                {a.entrySlip.insufficientDepth ? '≥ ' : ''}
                {a.entrySlip.slipBps.toFixed(1)} bps
              </span>
            ) : (
              '—'
            )
          }
          hint={
            a.entrySlip ? (
              <>
                {fmtPrice(costs.entrySlipUsd, 2)} $ · VWAP {fmtPrice(a.entrySlip.vwap, 1)} · {a.entrySlip.levelsUsed} poz.
                {a.entrySlip.insufficientDepth && (
                  <span className="flex items-center gap-1 text-warn mt-0.5">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> arkusz za płytki: wypełniono {fmtCompact(a.entrySlip.filledUsd, '$')}
                  </span>
                )}
                <br />
                stop (przybliżenie, bieżący arkusz): {a.stopSlip ? `${a.stopSlip.slipBps.toFixed(1)} bps` : '—'}
              </>
            ) : (
              'brak arkusza L2 — poślizg nie wliczony do kosztów'
            )
          }
        />
        <Stat
          label="Cena likwidacji (isolated)"
          source={liq ? { tone: 'model', label: 'MODEL', title: 'Wzór z dokumentacji Hyperliquid' } : undefined}
          value={
            <span className="font-mono tabular-nums">
              {liq ? fmtPrice(liq.price, 0) : levGiven ? 'brak' : '—'}
            </span>
          }
          hint={
            liq ? (
              <>
                {fmtSigned(((liq.price - p.entry) / p.entry) * 100, 2, '%')} od wejścia · MMR {(liq.maintenanceRate * 100).toFixed(2)}% (BTC max {liq.maxLeverage}×)
                {liq.warning === 'liq_before_stop' && (
                  <span className="flex items-center gap-1 text-critical mt-0.5 font-medium">
                    <OctagonAlert className="w-3 h-3" aria-hidden="true" /> Likwidacja przed stopem — zmniejsz dźwignię
                  </span>
                )}
                {liq.warning === 'stop_near_liq' && (
                  <span className="flex items-center gap-1 text-warn mt-0.5 font-medium">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Stop bliżej niż 1σ od likwidacji
                  </span>
                )}
              </>
            ) : levGiven ? (
              'przy tej dźwigni depozyt pokrywa cały nominał'
            ) : (
              `podaj dźwignię (1–${BTC_MAX_LEVERAGE}×), aby sprawdzić bufor`
            )
          }
        />
        <Stat
          label="Wielkość pozycji"
          value={<span className="font-mono tabular-nums">{fmtCompact(p.sizeUsd, '$')}</span>}
          hint={
            <>
              {btc.toFixed(4)} BTC · ryzyko {fmtPrice(costs.riskUsd, 0)} $
              {p.risk && ` (${p.risk.riskPct}% z ${fmtCompact(p.risk.equity, '$')}, z kosztami)`}
              {p.leverage ? ` · depozyt ${fmtCompact(p.sizeUsd / p.leverage, '$')}` : ''}
            </>
          }
        />
        <Stat
          label="Koszty transakcji"
          value={<span className="font-mono tabular-nums">{fmtPrice(costs.totalUsd, 2)} $</span>}
          hint={
            <>
              opłaty taker 2×{(a.feeRateTaker * 100).toFixed(3)}%: {fmtPrice(costs.feeUsd, 2)} $ · poślizg stopu (oczek.): {fmtPrice(costs.stopSlipUsdExpected, 2)} $
            </>
          }
        />
        <Stat label="Ćwierć-Kelly (z dziennika)" value={<span className="font-mono tabular-nums">{kelly}</span>} hint={kellyHint} />
      </div>

      <Methodology timeframeSec={market.timeframeSec} sigma={market.sigma} />
    </div>
  );
};

const SaveButton: React.FC<{ onSave: () => void; blocked: string | null; justSaved: boolean }> = ({ onSave, blocked, justSaved }) => (
  <div className="flex flex-col items-end gap-1">
    <button
      type="button"
      onClick={onSave}
      disabled={blocked !== null}
      className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-md bg-accent/15 border border-accent/40 text-accent text-sm font-medium hover:bg-accent/25 disabled:opacity-40 disabled:pointer-events-none transition-colors"
    >
      {justSaved ? <Check className="w-4 h-4" aria-hidden="true" /> : <BookmarkPlus className="w-4 h-4" aria-hidden="true" />}
      {justSaved ? 'Zapisano' : 'Zapisz do dziennika'}
    </button>
    {blocked && <span className="text-[11px] text-ink-3 max-w-[220px] text-right">{blocked}</span>}
  </div>
);

const MacroWindow: React.FC<{ events: MacroEvent[]; loaded: boolean; multiplier: number }> = ({ events, loaded, multiplier }) => {
  if (!loaded) {
    return <div className="text-[11px] text-ink-3">Kalendarz makro: n/a (tabela publikacji niedostępna) — brak korekty zmienności o zdarzenia.</div>;
  }
  if (events.length === 0) return <div className="text-[11px] text-ink-3">Brak publikacji makro w oknie horyzontu.</div>;
  return (
    <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-warn font-medium">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Zdarzenie makro w oknie — wariancja ×{multiplier.toFixed(2)} (założenie)
      </div>
      <ul className="mt-1 text-ink-2 space-y-0.5">
        {events.map((e) => (
          <li key={e.id}>
            {evtFmt.format(e.timeUtcMs)} · {e.name}{' '}
            <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="text-ink-3 underline hover:text-ink-1">
              {e.source}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Methodology: React.FC<{ timeframeSec: number; sigma: number }> = ({ timeframeSec, sigma }) => (
  <details className="group rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs text-ink-2">
    <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">Uwagi metodologiczne i źródła</summary>
    <ul className="list-disc pl-4 mt-2 space-y-1.5 leading-relaxed">
      <li>
        Model: ruch Browna w log-cenie z dryfem μ = 0 — desk nie zakłada przewagi. Przy μ = 0 oczekiwana wartość przed kosztami ≈ 0 R
        dla dowolnego R: wyższe R „kupuje się” niższym P(cel).
      </li>
      <li>
        σ na horyzont: estymator Parkinsona (high/low) z 60 ostatnich świec {Math.round(timeframeSec / 60)}m, skalowany √(h/Δ)
        {sigma > 0 ? ` (teraz ${(sigma * 100).toFixed(2)}%)` : ''}. Świeca w toku zaniża zakres; ogony BTC są grubsze niż w GBM, a luki
        cenowe mogą przeskoczyć stop.
      </li>
      <li>
        Ocena startuje w chwili wejścia: dla zlecenia z limitem z dala od rynku wynik jest warunkowy na wypełnienie. Poślizg wejścia
        dotyczy zlecenia rynkowego przy bieżącym arkuszu.
      </li>
      <li>Zdarzenia makro w oknie: wariancja × mnożnik ≥ 1 z kalendarza — to założenie, nie estymata z danych desku.</li>
      <li>
        Monte Carlo: ≥ 2000 ścieżek, krok 1 min, korekta mostu Browna na przekroczenie bariery między krokami; „żadne” = wyjście po cenie
        z końca horyzontu (średni wynik tych ścieżek w R wliczony do EV). Formuła zamknięta (bez limitu czasu) jako punkt odniesienia.
      </li>
      <li>
        Koszty: opłata taker {(DEFAULT_TAKER_FEE * 100).toFixed(3)}% (Hyperliquid tier 0 — założenie; maker 0.015%) przy wejściu i wyjściu; poślizg wejścia z
        przejścia po bieżącym arkuszu L2; stop jako zlecenie rynkowe po przeciwnej stronie bieżącego arkusza (przybliżenie). Funding pominięty.
      </li>
      <li>
        Likwidacja (isolated): liq = E − side·margin_available/size/(1 − l·side), l = 1/MAINTENANCE_LEVERAGE; maintenance margin = ½ initial
        margin przy max dźwigni (BTC 40× → 1.25%, do 150M USDC nominału). Bez opłat i fundingu.
      </li>
      <li>Wielkość ze stałego ryzyka %: size = kapitał·r / (|E−S|/E + koszty). Kelly dopiero po ≥ 50 rozstrzygniętych planach.</li>
    </ul>
    <div className="mt-3 text-ink-3">Źródła:</div>
    <ul className="pl-4 mt-1 space-y-1 text-ink-3">
      <li>Broadie, Glasserman, Kou (1997), „A continuity correction for discrete barrier options”, Mathematical Finance 7(4).</li>
      <li>Parkinson (1980), „The extreme value method for estimating the variance of the rate of return”, Journal of Business 53(1).</li>
      <li>
        Dokumentacja Hyperliquid:{' '}
        {[
          ['likwidacje', 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations'],
          ['margines', 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining'],
          ['progi marginesu', 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers'],
          ['opłaty', 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees'],
        ].map(([label, href], i) => (
          <React.Fragment key={href}>
            {i > 0 && ' · '}
            <a href={href} target="_blank" rel="noreferrer" className="underline hover:text-ink-1">
              {label}
            </a>
          </React.Fragment>
        ))}
      </li>
    </ul>
  </details>
);

