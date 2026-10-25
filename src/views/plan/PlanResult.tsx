import React from 'react';
import { AlertTriangle, BookmarkPlus, Check, OctagonAlert } from 'lucide-react';
import { Badge, Stat, fmtCompact, fmtPrice, fmtSigned, fmtFixed, fmtNum } from '../../ui';
import { BTC_MAX_LEVERAGE, DEFAULT_TAKER_FEE, PlanAnalysis, quarterKelly, wilsonLowerBound } from '../../utils/planAnalyzer';
import { LedgerEntry, bucketIndex, bucketStats } from '../../utils/forecastLedger';
import { MacroEvent } from '../../data/macroCalendar';
import { useLiqMap } from '../../state/useLiqMap';
import { stopNearCluster } from '../../utils/liqMapView';
import { ProbabilityBar } from './ProbabilityBar';
import { PathFan } from './PathFan';
import { PlanMarket, fmtMinutes } from './hooks';
import { locale, tr } from '../../i18n';

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

const pct1 = (v: number) => `${fmtFixed(v * 100, 1)}%`;
const evtFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

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
        <div className="text-xs text-ink-3 mt-1">{tr('Popraw plan — wynik pojawi się automatycznie.', 'Fix the plan and the result appears automatically.')}</div>
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
    kellyHint = tr(
      `zablokowany: ${p.resolvedCount}/${KELLY_MIN_RESOLVED} rozstrzygniętych planów w dzienniku`,
      `locked: ${p.resolvedCount}/${KELLY_MIN_RESOLVED} settled plans in the journal`
    );
  } else {
    const b = bucketStats(p.ledgerEntries, mc.pTarget);
    const pL = wilsonLowerBound(b.hits, b.n);
    const f = quarterKelly(pL, a.R);
    const idx = bucketIndex(mc.pTarget);
    kelly = tr(`${fmtFixed(f * 100, 1)}% kapitału`, `${fmtFixed(f * 100, 1)}% of equity`);
    kellyHint = tr(
      `¼·max(0, p_L − (1−p_L)/R); p_L = ${pct1(pL)} (Wilson 95%) w koszyku ${idx * 10}–${idx * 10 + 10}% · n = ${b.n}, trafień ${b.hits}`,
      `¼·max(0, p_L − (1−p_L)/R); p_L = ${pct1(pL)} (Wilson 95%) in the ${idx * 10}–${idx * 10 + 10}% bucket · n = ${b.n}, hits ${b.hits}`
    );
  }

  const liq = a.liquidation;
  const limitGap = Number.isFinite(market.price) && market.price > 0 ? ((p.entry - market.price) / market.price) * 100 : null;
  const levGiven = p.leverage !== undefined;
  const showFill = mc.fillRare || mc.pFill < 0.999;

  return (
    <div className="flex flex-col gap-5">
      {/* Bohater: P(cel przed stopem) + pasek trzech wyników */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">
                {tr('P(cel przed stopem)', 'P(target before stop)')} · {horizonLabel}
              </span>
              <Badge tone={market.source.tone} title={market.source.title}>
                {market.source.label}
              </Badge>
            </div>
            <div className="text-[28px] sm:text-[44px] leading-none font-semibold text-ink-1 mt-1.5">{pct1(mc.pTarget)}</div>
            <div className="text-xs text-ink-3 mt-1.5">
              R = 1 : {fmtFixed(a.R, 2)} · {tr('bez limitu czasu (formuła): cel', 'no time limit (formula): target')} {pct1(a.closedForm.pTarget)} · stop{' '}
              {pct1(a.closedForm.pStop)}
            </div>
            {showFill && (
              <div className={`text-xs mt-0.5 ${mc.fillRare ? 'text-warn' : 'text-ink-3'}`}>
                {limitGap !== null && tr(`Wejście ${fmtSigned(limitGap, 2, '%')} od rynku · `, `Entry ${fmtSigned(limitGap, 2, '%')} from market · `)}
                {tr('P(wypełnienia w horyzoncie)', 'P(fill within horizon)')} <span className="font-mono tabular-nums text-ink-1">{pct1(mc.pFill)}</span>
                {mc.fillRare
                  ? tr(
                      ' — wejście rzadko osiągane; wynik powyżej policzony przy założeniu natychmiastowego wypełnienia.',
                      ': entry rarely reached; the result above assumes an immediate fill.'
                    )
                  : tr(' — wynik powyżej jest warunkowy na wypełnienie (tak samo rozlicza dziennik).', ': the result above is conditional on the fill (the journal settles it the same way).')}
              </div>
            )}
          </div>
          <SaveButton onSave={p.onSave} blocked={p.saveBlocked} justSaved={p.justSaved} />
        </div>
        <div className="mt-4">
          <ProbabilityBar pTarget={mc.pTarget} pStop={mc.pStop} pNeither={mc.pNeither} horizonLabel={horizonLabel} />
        </div>
        <div className="text-[11px] text-ink-3 mt-2 font-mono tabular-nums">
          {mc.timeToTarget &&
            `${tr('do celu: mediana', 'to target: median')} ${fmtMinutes(mc.timeToTarget.p50)} (P25–P75 ${fmtMinutes(mc.timeToTarget.p25)}–${fmtMinutes(mc.timeToTarget.p75)})`}
          {mc.timeToTarget && mc.timeToStop && ' · '}
          {mc.timeToStop &&
            `${tr('do stopu: mediana', 'to stop: median')} ${fmtMinutes(mc.timeToStop.p50)} (P25–P75 ${fmtMinutes(mc.timeToStop.p25)}–${fmtMinutes(mc.timeToStop.p75)})`}
        </div>
      </div>

      <MacroWindow events={market.events} loaded={market.calendarLoaded} multiplier={market.eventMultiplier} />
      <StopClusterWarning entry={p.entry} stop={p.stop} />

      <PathFan mc={mc} entry={p.entry} stop={p.stop} target={p.target} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-4">
        <Stat
          label={tr('EV po kosztach', 'EV after costs')}
          source={{ tone: 'model', label: 'MODEL' }}
          value={<span className="font-mono tabular-nums">{fmtSigned(a.evR, 2, ' R')}</span>}
          hint={
            <>
              {tr('przed kosztami', 'before costs')} {fmtSigned(a.evRGross, 2, ' R')} · {tr('koszty', 'costs')} {fmtFixed(costs.totalR, 2)} R ({fmtPrice(costs.totalUsd, 2)} $)
              <br />
              {tr('dryf 0 ⇒ ≈ 0 R przed kosztami — przewagę wykaże tylko dziennik', 'zero drift ⇒ ≈ 0 R before costs; only the journal can show an edge')}
            </>
          }
        />
        <Stat
          label={tr('Poślizg wejścia (L2)', 'Entry slippage (L2)')}
          source={a.entrySlip ? { tone: market.source.tone === 'sim' ? 'sim' : 'live', label: market.source.tone === 'sim' ? 'SIM' : 'LIVE' } : undefined}
          value={
            a.entrySlip ? (
              <span className="font-mono tabular-nums">
                {a.entrySlip.insufficientDepth ? '≥ ' : ''}
                {fmtFixed(a.entrySlip.slipBps, 1)} bps
              </span>
            ) : (
              '—'
            )
          }
          hint={
            a.entrySlip ? (
              <>
                {fmtPrice(costs.entrySlipUsd, 2)} $ · VWAP {fmtPrice(a.entrySlip.vwap, 1)} · {a.entrySlip.levelsUsed} {tr('poz.', 'lvls')}
                {a.entrySlip.insufficientDepth && (
                  <span className="flex items-center gap-1 text-warn mt-0.5">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {tr('arkusz za płytki: wypełniono', 'book too thin: filled')}{' '}
                    {fmtCompact(a.entrySlip.filledUsd, '$')}
                  </span>
                )}
                <br />
                {tr('stop (przybliżenie, bieżący arkusz)', 'stop (approximation, current book)')}: {a.stopSlip ? `${fmtFixed(a.stopSlip.slipBps, 1)} bps` : '—'}
              </>
            ) : (
              tr('brak arkusza L2 — poślizg nie wliczony do kosztów', 'no L2 book, slippage not included in costs')
            )
          }
        />
        <Stat
          label={tr('Cena likwidacji (isolated)', 'Liquidation price (isolated)')}
          source={liq ? { tone: 'model', label: 'MODEL', title: tr('Wzór z dokumentacji Hyperliquid', 'Formula from the Hyperliquid docs') } : undefined}
          value={
            <span className="font-mono tabular-nums">
              {liq ? fmtPrice(liq.price, 0) : levGiven ? tr('brak', 'none') : '—'}
            </span>
          }
          hint={
            liq ? (
              <>
                {fmtSigned(((liq.price - p.entry) / p.entry) * 100, 2, '%')} {tr('od wejścia', 'from entry')} · MMR {fmtFixed(liq.maintenanceRate * 100, 2)}% (BTC max{' '}
                {liq.maxLeverage}×)
                {liq.warning === 'liq_before_stop' && (
                  <span className="flex items-center gap-1 text-critical mt-0.5 font-medium">
                    <OctagonAlert className="w-3 h-3" aria-hidden="true" /> {tr('Likwidacja przed stopem — zmniejsz dźwignię', 'Liquidation before stop, reduce leverage')}
                  </span>
                )}
                {liq.warning === 'stop_near_liq' && (
                  <span className="flex items-center gap-1 text-warn mt-0.5 font-medium">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {tr('Stop bliżej niż 1σ od likwidacji', 'Stop within 1σ of liquidation')}
                  </span>
                )}
              </>
            ) : levGiven ? (
              tr('przy tej dźwigni depozyt pokrywa cały nominał', 'at this leverage the margin covers the full notional')
            ) : (
              tr(`podaj dźwignię (1–${BTC_MAX_LEVERAGE}×), aby sprawdzić bufor`, `enter leverage (1–${BTC_MAX_LEVERAGE}×) to check the buffer`)
            )
          }
        />
        <Stat
          label={tr('Wielkość pozycji', 'Position size')}
          value={<span className="font-mono tabular-nums">{fmtCompact(p.sizeUsd, '$')}</span>}
          hint={
            <>
              {fmtFixed(btc, 4)} BTC · {tr('ryzyko', 'risk')} {fmtPrice(costs.riskUsd, 0)} $
              {p.risk && tr(` (${fmtNum(p.risk.riskPct)}% z ${fmtCompact(p.risk.equity, '$')}, z kosztami)`, ` (${fmtNum(p.risk.riskPct)}% of ${fmtCompact(p.risk.equity, '$')}, incl. costs)`)}
              {p.leverage ? ` · ${tr('depozyt', 'margin')} ${fmtCompact(p.sizeUsd / p.leverage, '$')}` : ''}
            </>
          }
        />
        <Stat
          label={tr('Koszty transakcji', 'Trading costs')}
          value={<span className="font-mono tabular-nums">{fmtPrice(costs.totalUsd, 2)} $</span>}
          hint={
            <>
              {tr('opłaty taker', 'taker fees')} 2×{fmtFixed(a.feeRateTaker * 100, 3)}%: {fmtPrice(costs.feeUsd, 2)} $ · {tr('poślizg stopu (oczek.)', 'stop slippage (exp.)')}:{' '}
              {fmtPrice(costs.stopSlipUsdExpected, 2)} $
            </>
          }
        />
        <Stat label={tr('Ćwierć-Kelly (z dziennika)', 'Quarter Kelly (from journal)')} value={<span className="font-mono tabular-nums">{kelly}</span>} hint={kellyHint} />
        <VolModelStat market={market} horizonLabel={horizonLabel} />
      </div>

      <Methodology timeframeSec={market.timeframeSec} sigma={market.sigma} hasModel={market.vol !== null} />
    </div>
  );
};

/** Karta modelu zmienności: σ horyzontu, trafność HAR poza próbą, skoki, liczność danych — albo jawny zapas. */
const VolModelStat: React.FC<{ market: PlanMarket; horizonLabel: string }> = ({ market, horizonLabel }) => {
  const m = market.volModel;
  const sigmaTxt = market.sigma > 0 ? `${fmtFixed(market.sigma * 100, 2)}%` : '—';
  if (!m || !market.vol) {
    return (
      <Stat
        label={tr('Model zmienności', 'Volatility model')}
        value={<span className="font-mono tabular-nums">σ {horizonLabel} {sigmaTxt}</span>}
        hint={
          market.volStatus === 'loading'
            ? tr('pobieram świece 1h/5m z Hyperliquid… do tego czasu σ Parkinsona (zapas)', 'loading 1h/5m candles from Hyperliquid… Parkinson σ until then (fallback)')
            : tr('niedostępny — σ Parkinsona z bieżących świec i rozkład normalny (zapas)', 'unavailable: Parkinson σ from current candles and a normal distribution (fallback)')
        }
      />
    );
  }
  const oos = m.har.oos;
  const gain = oos ? (1 - oos.qlikeHar / oos.qlikeNaive) * 100 : null;
  return (
    <Stat
      label={tr('Model zmienności', 'Volatility model')}
      source={{
        tone: 'model',
        label: 'MODEL',
        title: tr('Sezonowy log-HAR (świece 1h) + innowacje FHS (świece 5m) z publicznego API Hyperliquid', 'Seasonal log-HAR (1h candles) + FHS innovations (5m candles) from the public Hyperliquid API'),
      }}
      value={<span className="font-mono tabular-nums">σ {horizonLabel} {sigmaTxt}</span>}
      hint={
        <>
          {tr('sezonowy log-HAR · strata QLIKE poza próbą', 'seasonal log-HAR · out-of-sample QLIKE loss')}{' '}
          {gain !== null ? `${fmtSigned(-gain, 0, '%')} ${tr('vs średnia 24 h', 'vs 24 h mean')} (n = ${oos!.n})` : tr('b/d (za mało danych)', 'n/a (not enough data)')}
          <br />
          {tr('skoki', 'jumps')}:{' '}
          {m.jump ? tr(`${fmtFixed(m.jump.share * 100, 1)}% wariancji (${m.jump.days} dni, BV)`, `${fmtFixed(m.jump.share * 100, 1)}% of variance (${m.jump.days} days, BV)`) : tr('b/d', 'n/a')} ·
          Lee–Mykland: {tr(`${m.lmJumps.count} w ${Math.round(m.lmJumps.days)} dni`, `${m.lmJumps.count} in ${Math.round(m.lmJumps.days)} days`)}
          <br />
          {tr(`dane: ${m.hourlyBars} świec 1h · ${m.fiveMinBars} świec 5m`, `data: ${m.hourlyBars} 1h candles · ${m.fiveMinBars} 5m candles`)}
        </>
      }
    />
  );
};

/** Stop w strefie likwidacji po tej samej stronie (mapa z pozycji on-chain): ryzyko przestrzelenia stopu. */
const StopClusterWarning: React.FC<{ entry: number; stop: number }> = ({ entry, stop }) => {
  const { status, map } = useLiqMap();
  if (status !== 'ready' || !map || !(stop > 0) || !(entry > 0)) return null;
  const long = stop < entry;
  const hit = stopNearCluster(map, long ? 'LONG' : 'SHORT', stop);
  if (!hit) return null;
  return (
    <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-warn font-medium">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />{' '}
        {long ? tr('Stop w strefie likwidacji longów (pozycje on-chain)', 'Stop inside a long liquidation zone (on-chain positions)') : tr('Stop w strefie likwidacji shortów (pozycje on-chain)', 'Stop inside a short liquidation zone (on-chain positions)')}
      </div>
      <div className="mt-1 text-ink-2">
        {tr(
          `${fmtCompact(hit.ntlUsd, '$')} nominału (${hit.positions} poz.) w ±0,2% wokół stopu — ich zlecenia rynkowe mogą przepchnąć cenę przez stop i pogorszyć wykonanie. Rozważ stop poza klastrem.`,
          `${fmtCompact(hit.ntlUsd, '$')} of notional (${hit.positions} pos.) within ±0.2% of the stop; their market orders can push price through the stop and worsen the fill. Consider a stop outside the cluster.`
        )}
      </div>
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
      {justSaved ? tr('Zapisano', 'Saved') : tr('Zapisz do dziennika', 'Save to journal')}
    </button>
    {blocked && <span className="text-[11px] text-ink-3 max-w-[220px] text-right">{blocked}</span>}
  </div>
);

const MacroWindow: React.FC<{ events: MacroEvent[]; loaded: boolean; multiplier: number }> = ({ events, loaded, multiplier }) => {
  if (!loaded) {
    return (
      <div className="text-[11px] text-ink-3">
        {tr(
          'Kalendarz makro: b/d (tabela publikacji niedostępna) — brak korekty zmienności o zdarzenia.',
          'Macro calendar: n/a (release table unavailable), no event volatility adjustment.'
        )}
      </div>
    );
  }
  if (events.length === 0) return <div className="text-[11px] text-ink-3">{tr('Brak publikacji makro w oknie horyzontu.', 'No macro releases within the horizon.')}</div>;
  return (
    <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-warn font-medium">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />{' '}
        {tr(`Zdarzenie makro w oknie — wariancja ×${fmtFixed(multiplier, 2)} (założenie)`, `Macro event in the window: variance ×${fmtFixed(multiplier, 2)} (assumption)`)}
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

const Methodology: React.FC<{ timeframeSec: number; sigma: number; hasModel: boolean }> = ({ timeframeSec, sigma, hasModel }) => (
  <details className="group rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs text-ink-2">
    <summary className="cursor-pointer select-none text-ink-1 font-medium py-1">{tr('Uwagi metodologiczne i źródła', 'Methodology notes and sources')}</summary>
    <ul className="list-disc pl-4 mt-2 space-y-1.5 leading-relaxed">
      <li>
        {tr(
          'Model: log-cena z dryfem μ = 0 — desk nie zakłada przewagi. Przy μ = 0 oczekiwana wartość przed kosztami ≈ 0 R dla dowolnego R: wyższe R „kupuje się” niższym P(cel).',
          'Model: log-price with drift μ = 0, the desk assumes no edge. With μ = 0 the expected value before costs is ≈ 0 R for any R: a higher R is "bought" with a lower P(target).'
        )}
      </li>
      {hasModel ? (
        <>
          <li>
            {tr(
              `σ: sezonowy log-HAR (Corsi 2009) na godzinowych wariancjach Garman–Klass z ~5000 świec 1h (≈ 208 dni), z profilem godzin UTC (Andersen–Bollerslev 1997) i korektą Duana; prognoza iterowana godzina po godzinie, σ kroków 5 min${
                sigma > 0 ? ` (na horyzont teraz ${fmtFixed(sigma * 100, 2)}%)` : ''
              }. Trafność: strata QLIKE (Patton 2011) poza próbą względem naiwnej średniej z 24 h — w karcie „Model zmienności”.`,
              `σ: seasonal log-HAR (Corsi 2009) on hourly Garman–Klass variances from ~5000 1h candles (≈ 208 days), with a UTC hour-of-day profile (Andersen–Bollerslev 1997) and Duan's correction; the forecast is iterated hour by hour, σ in 5-min steps${
                sigma > 0 ? ` (for the horizon now ${fmtFixed(sigma * 100, 2)}%)` : ''
              }. Accuracy: out-of-sample QLIKE loss (Patton 2011) against a naive 24 h mean, in the "Volatility model" card.`
            )}
          </li>
          <li>
            {tr(
              'Innowacje: bootstrap standaryzowanych zwrotów 5m (FHS, Barone-Adesi i in. 1999) — grube ogony i skoki z danych, bez zakładanego rozkładu. Udział skoków w wariancji: wariancja dwupotęgowa (Barndorff-Nielsen–Shephard 2004); skoki: test Lee–Mykland (2008) — diagnostyka, nie parametr.',
              'Innovations: bootstrap of standardised 5m returns (FHS, Barone-Adesi et al. 1999), so fat tails and jumps come from the data with no assumed distribution. Jump share of variance: bipower variation (Barndorff-Nielsen–Shephard 2004); jumps: the Lee–Mykland (2008) test, a diagnostic, not a parameter.'
            )}
          </li>
        </>
      ) : (
        <li>
          {tr(
            `σ (zapas — model zmienności niedostępny): estymator Parkinsona z 60 ostatnich świec ${Math.round(timeframeSec / 60)}m, skalowany √(h/Δ)${
              sigma > 0 ? ` (teraz ${fmtFixed(sigma * 100, 2)}%)` : ''
            }, rozkład normalny. Ogony BTC są grubsze niż w tym zapasie, a luki cenowe mogą przeskoczyć stop.`,
            `σ (fallback, volatility model unavailable): Parkinson estimator from the last 60 ${Math.round(timeframeSec / 60)}m candles, scaled by √(h/Δ)${
              sigma > 0 ? ` (now ${fmtFixed(sigma * 100, 2)}%)` : ''
            }, normal distribution. BTC tails are fatter than in this fallback, and price gaps can jump over the stop.`
          )}
        </li>
      )}
      <li>
        {tr(
          'Wypełnienie: symulacja startuje od bieżącej ceny — gdy wejście jest od niej różne, ścieżka musi je najpierw dotknąć (z korektą mostu). P(cel / stop / żadne) jest warunkowe na wypełnienie, tak samo rozlicza dziennik; P(wypełnienia) oceniana osobno (Brier). Model nie uwzględnia selekcji negatywnej (zlecenie z limitem częściej wypełnia się, gdy cena idzie przeciw) — zmierzy ją dziennik. Poślizg wejścia dotyczy zlecenia rynkowego przy bieżącym arkuszu.',
          'Fill: the simulation starts from the current price; when the entry differs from it, a path must touch it first (with a bridge correction). P(target / stop / neither) is conditional on the fill, exactly as the journal settles it; P(fill) is scored separately (Brier). The model does not account for adverse selection (a limit order fills more often when price moves against it); the journal will measure it. Entry slippage applies to a market order against the current book.'
        )}
      </li>
      <li>
        {tr(
          'Zdarzenia makro w oknie: wariancja × mnożnik ≥ 1 z kalendarza — to założenie, nie estymata z danych desku.',
          'Macro events in the window: variance × a multiplier ≥ 1 from the calendar; this is an assumption, not an estimate from desk data.'
        )}
      </li>
      <li>
        {tr(
          `Monte Carlo: ≥ 2000 ścieżek, krok ${hasModel ? '5 min' : '1 min'}, korekta mostu Browna z lokalnym σ kroku na przekroczenie bariery między krokami; „żadne” = wyjście po cenie z końca horyzontu (średni wynik tych ścieżek w R wliczony do EV). Formuła zamknięta (bez limitu czasu) jako punkt odniesienia.`,
          `Monte Carlo: ≥ 2000 paths, ${hasModel ? '5-min' : '1-min'} step, Brownian-bridge correction with the local step σ for barrier crossings between steps; "neither" = exit at the price at the end of the horizon (the mean R of those paths is included in EV). The closed-form formula (no time limit) serves as a reference.`
        )}
      </li>
      <li>
        {tr(
          `Koszty: opłata taker ${fmtFixed(DEFAULT_TAKER_FEE * 100, 3)}% (Hyperliquid tier 0 — założenie; maker 0,015%) przy wejściu i wyjściu; poślizg wejścia z przejścia po bieżącym arkuszu L2; stop jako zlecenie rynkowe po przeciwnej stronie bieżącego arkusza (przybliżenie). Funding pominięty.`,
          `Costs: taker fee ${fmtFixed(DEFAULT_TAKER_FEE * 100, 3)}% (Hyperliquid tier 0, an assumption; maker 0.015%) on entry and exit; entry slippage from walking the current L2 book; the stop as a market order against the opposite side of the current book (approximation). Funding ignored.`
        )}
      </li>
      <li>
        {tr(
          'Likwidacja (isolated): liq = E − side·margin_available/size/(1 − l·side), l = 1/MAINTENANCE_LEVERAGE; maintenance margin = ½ initial margin przy max dźwigni (BTC 40× → 1,25%, do 150M USDC nominału). Bez opłat i fundingu.',
          'Liquidation (isolated): liq = E − side·margin_available/size/(1 − l·side), l = 1/MAINTENANCE_LEVERAGE; maintenance margin = ½ initial margin at max leverage (BTC 40× → 1.25%, up to 150M USDC notional). Fees and funding excluded.'
        )}
      </li>
      <li>
        {tr(
          'Wielkość ze stałego ryzyka %: size = kapitał·r / (|E−S|/E + koszty). Kelly dopiero po ≥ 50 rozstrzygniętych planach.',
          'Size from a fixed risk %: size = equity·r / (|E−S|/E + costs). Kelly only after ≥ 50 settled plans.'
        )}
      </li>
    </ul>
    <div className="mt-3 text-ink-3">{tr('Źródła:', 'Sources:')}</div>
    <ul className="pl-4 mt-1 space-y-1 text-ink-3">
      <li>Broadie, Glasserman, Kou (1997), „A continuity correction for discrete barrier options”, Mathematical Finance 7(4).</li>
      <li>Corsi (2009), „A simple approximate long-memory model of realized volatility”, Journal of Financial Econometrics 7(2).</li>
      <li>Garman, Klass (1980), „On the estimation of security price volatilities from historical data”, Journal of Business 53(1).</li>
      <li>Andersen, Bollerslev (1997), „Intraday periodicity and volatility persistence in financial markets”, Journal of Empirical Finance 4.</li>
      <li>Duan (1983), „Smearing estimate: a nonparametric retransformation method”, JASA 78(383).</li>
      <li>Patton (2011), „Volatility forecast comparison using imperfect volatility proxies”, Journal of Econometrics 160(1).</li>
      <li>Barone-Adesi, Giannopoulos, Vosper (1999), „VaR without correlations for portfolios of derivative securities”, Journal of Futures Markets 19(5).</li>
      <li>Barndorff-Nielsen, Shephard (2004), „Power and bipower variation with stochastic volatility and jumps”, Journal of Financial Econometrics 2(1).</li>
      <li>Lee, Mykland (2008), „Jumps in financial markets: a new nonparametric test and jump dynamics”, Review of Financial Studies 21(6).</li>
      <li>Parkinson (1980), „The extreme value method for estimating the variance of the rate of return”, Journal of Business 53(1) — {tr('zapas', 'fallback')}.</li>
      <li>
        {tr('Dokumentacja Hyperliquid:', 'Hyperliquid docs:')}{' '}
        {[
          [tr('likwidacje', 'liquidations'), 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations'],
          [tr('margines', 'margining'), 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining'],
          [tr('progi marginesu', 'margin tiers'), 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers'],
          [tr('opłaty', 'fees'), 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees'],
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

