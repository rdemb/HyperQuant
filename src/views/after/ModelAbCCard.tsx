import React from 'react';
import { DASH, fmtFixed } from '../../ui';
import type { AbBlock, DeskLedgerSummary } from '../../utils/deskLedger';
import { locale, tr } from '../../i18n';
import { AbPeriods, span } from './ModelAbCard';

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const stampFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Stałe planu ab-v2 (do opisu skali poziomu w karcie) */
const KAPPA = 0.5;
const C0 = -0.05;

const pct = (v: number | null) => (v === null ? DASH : `${fmtFixed(v * 100, 1)}%`);

function verdictOf(b: AbBlock): string | null {
  if (!b.diff) return null;
  if (b.diff.hi < 0) return tr('wersja C trafniejsza', 'version C more accurate');
  if (b.diff.lo > 0) return tr('wersja A trafniejsza', 'version A more accurate');
  return tr('różnica nieudowodniona', 'difference not proven');
}

/**
 * A/B wariantu C (plan `ab-v2`): wersja A i wersja C (kwantyle A przesunięte świeżą zmiennością z 12 świec 5m sprzed
 * slotu i rozszerzone mieszaniną skali) w tych samych slotach i okresach co A/B wariantu B; oceniane okresy od pierwszej
 * granicy po rejestracji planu. W zakończonym okresie także kalibracja C na próbie rozłącznej.
 */
export const ModelAbCCard: React.FC<{ ab: NonNullable<DeskLedgerSummary['abC']> }> = ({ ab }) => {
  const l = ab.latest;
  const rows: { label: string; b: AbBlock; final: boolean }[] = [];
  if (ab.last) rows.push({ label: tr('zakończony', 'finished'), b: ab.last, final: true });
  if (ab.closing) rows.push({ label: tr('w rozliczaniu', 'settling'), b: ab.closing, final: false });
  if (ab.current) rows.push({ label: tr('w toku', 'in progress'), b: ab.current, final: false });
  const verdict = ab.last ? verdictOf(ab.last) : null;
  const cal = ab.last?.cal;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('A/B wariantu C · zwrot 1 h', 'Variant C A/B · 1 h return')}</div>
        {l && (
          <span className="text-[11px] text-ink-3">
            {tr('ostatnie', 'latest')}: {timeFmt.format(l.t)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-2 leading-relaxed">
        {tr(
          'Wersja C przekształca kwantyle wersji A w dwóch krokach. Poziom: zmienność zrealizowana z 12 zamkniętych świec 5-minutowych przed slotem przesuwa skalę A, bo model A odświeża stan raz na godzinę. Kształt: mieszanina skali (niepewność wariancji) poszerza ogony i zwęża środek rozkładu. Przekształcenie jest deterministyczne, więc weryfikator odtwarza C z samego rekordu. Wygrywa wersja z niższym CRPS na tych samych slotach.',
          'Version C transforms the quantiles of version A in two steps. Level: realised volatility from the 12 closed 5-minute candles before the slot shifts the scale of A, because model A refreshes its state once an hour. Shape: a scale mixture (variance uncertainty) widens the tails and narrows the middle of the distribution. The transform is deterministic, so the verifier rebuilds C from the record alone. The version with the lower CRPS on the same slots wins.'
        )}
      </p>
      {l && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          <span title={tr('Odchylenie log-zwrotu z ostatnich 60 min (pierwiastek sumy kwadratów 12 zwrotów 5-minutowych)', 'Log-return deviation over the last 60 min (square root of the sum of 12 squared 5-minute returns)')}>
            {tr('zmienność 60 min', '60 min volatility')} <span className="font-mono tabular-nums text-ink-1">{fmtFixed(Math.sqrt(l.rv60) * 100, 3)}%</span>
          </span>
          <span title={tr('x = ½·ln(zmienność 60 min² / σA²), przycięte do ±1,5', 'x = ½·ln(60 min volatility² / σA²), clipped to ±1.5')}>
            {tr('poziom wobec A', 'level vs A')} x <span className="font-mono tabular-nums text-ink-1">{fmtFixed(l.x, 2)}</span>
          </span>
          <span title={tr('Kwantyle po kroku poziomu = kwantyle A × exp(c + κ·x)', 'Quantiles after the level step = A quantiles × exp(c + κ·x)')}>
            {tr('skala poziomu', 'level scale')} <span className="font-mono tabular-nums text-ink-1">×{fmtFixed(Math.exp(C0 + KAPPA * l.x), 3)}</span>
          </span>
        </div>
      )}
      <AbPeriods rows={rows} letter="C" />
      {cal && (
        <div className="text-xs text-ink-2">
          {tr('Kalibracja C w okresie', 'Calibration of C in the period')} {span(ab.last!)} ({tr('próba rozłączna', 'disjoint sample')}, n = {cal.n}): {tr('pokrycie 60%', '60% coverage')}{' '}
          <span className="font-mono tabular-nums text-ink-1">{pct(cal.cov60)}</span>, {tr('pokrycie 90%', '90% coverage')} <span className="font-mono tabular-nums text-ink-1">{pct(cal.cov90)}</span>{' '}
          <span className="text-ink-3">{tr('(kryterium: 55–65% i co najmniej 87%)', '(criterion: 55–65% and at least 87%)')}</span>
        </div>
      )}
      <div className="text-[11px] text-ink-3">
        {ab.registeredAt ? (
          <span>
            {tr(
              `Plan ${ab.plan} prerejestrowany w dzienniku ${stampFmt.format(ab.registeredAt)} UTC (stałe przekształcenia i kryteria; weryfikator porównuje go z kodem). `,
              `Plan ${ab.plan} pre-registered in the ledger on ${stampFmt.format(ab.registeredAt)} UTC (transform constants and criteria; the verifier compares it with the code). `
            )}
          </span>
        ) : (
          <span>{tr('Plan oceny jeszcze nie w dzienniku: okresy nie są oceniane. ', 'The evaluation plan is not in the ledger yet: periods are not scored. ')}</span>
        )}
        {ab.firstBlock !== null && (
          <span>
            {tr(`Oceniane okresy od ${dateFmt.format(ab.firstBlock)} (pierwsza granica okresu po rejestracji). `, `Scored periods from ${dateFmt.format(ab.firstBlock)} (the first period boundary after registration). `)}
          </span>
        )}
        {verdict ? (
          <span className="text-ink-1">
            {tr('Wniosek za okres', 'Conclusion for')} {span(ab.last!)}: {verdict}.
          </span>
        ) : ab.last ? (
          <span>{tr('Zakończony okres miał za mało par slotów na wniosek.', 'The finished period had too few slot pairs for a conclusion.')}</span>
        ) : (
          <span>{tr('Pierwszy wniosek po zakończeniu pierwszego ocenianego okresu.', 'The first conclusion comes after the first scored period ends.')}</span>
        )}
      </div>
    </div>
  );
};
