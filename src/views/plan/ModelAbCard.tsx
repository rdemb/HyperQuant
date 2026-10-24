import React from 'react';
import { DASH } from '../../ui';
import type { AbBlock, DeskLedgerSummary } from '../../utils/deskLedger';
import { locale, tr } from '../../i18n';

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const stampFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Najdłuższy śledzony reżim BOCPD: 600 świec 5m = 50 h */
const RUN_MAX_H = 50;

const bp = (v: number | null) => (v === null ? DASH : (v * 1e4).toFixed(2));
const sd = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 1e4).toFixed(2)}`;
/** Okres [start, end) — koniec pokazany jako ostatni dzień okresu */
const span = (b: AbBlock) => `${dateFmt.format(b.start)} – ${dateFmt.format(b.end - 1)}`;

function runLabel(run: number): string {
  const h = (run * 5) / 60;
  if (h < 1) return '<1 h';
  if (h >= RUN_MAX_H) return `≥${RUN_MAX_H} h`;
  return `~${Math.round(h)} h`;
}

function verdictOf(b: AbBlock): string | null {
  if (!b.diff) return null;
  if (b.diff.hi < 0) return tr('wersja B (z reżimem) trafniejsza', 'version B (with regime) more accurate');
  if (b.diff.lo > 0) return tr('wersja A (bez reżimu) trafniejsza', 'version A (without regime) more accurate');
  return tr('różnica nieudowodniona', 'difference not proven');
}

/**
 * A/B wersji modelu w weryfikowalnym dzienniku: wersja A (HAR + FHS) i wersja B (σ z mieszaniny z reżimem zmienności
 * z BOCPD) zapisywane przed faktem w tych samych slotach. Plan oceny prerejestrowany w dzienniku; okresy 14 dni ustalone
 * z góry: w toku i w rozliczaniu tylko liczności i CRPS, wniosek z przedziałem Neweya–Westa (fixed-b) po zakończeniu.
 */
export const ModelAbCard: React.FC<{ ab: NonNullable<DeskLedgerSummary['ab']> }> = ({ ab }) => {
  const l = ab.latest;
  const verdict = ab.last ? verdictOf(ab.last) : null;
  const rows: { label: string; b: AbBlock; final: boolean }[] = [];
  if (ab.last) rows.push({ label: tr('zakończony', 'finished'), b: ab.last, final: true });
  if (ab.closing) rows.push({ label: tr('w rozliczaniu', 'settling'), b: ab.closing, final: false });
  if (ab.current) rows.push({ label: tr('w toku', 'in progress'), b: ab.current, final: false });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('A/B wersji modelu · zwrot 1 h', 'Model versions A/B · 1 h return')}</div>
        {l && (
          <span className="text-[11px] text-ink-3">
            {tr('ostatnie', 'latest')}: {timeFmt.format(l.t)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-2 leading-relaxed">
        {tr(
          'W slotach ze świeżym reżimem dziennik zapisuje przed faktem dwie wersje prognozy zwrotu na 1 h. Wersja A to model zmienności HAR + FHS. Wersja B miesza jego wariancję po połowie z wariancją bieżącego reżimu zmienności, wykrywanego bayesowsko w czasie rzeczywistym (BOCPD, Adams i MacKay 2007) na zwrotach 5-minutowych z 3 dni, oczyszczonych z rytmu doby. Kształt rozkładu zostaje ten sam, zmienia się tylko szerokość. Wygrywa wersja z niższym CRPS na tych samych slotach.',
          'In slots with a fresh regime the ledger records two versions of the 1 h return forecast before the fact. Version A is the HAR + FHS volatility model. Version B blends its variance half and half with the variance of the current volatility regime, detected with a Bayesian method in real time (BOCPD, Adams and MacKay 2007) on 5-minute returns from 3 days, cleaned of the daily rhythm. The shape of the distribution stays the same; only its width changes. The version with the lower CRPS on the same slots wins.'
        )}
      </p>
      {l && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          <span
            title={tr(
              'Odchylenie zwrotu 5-minutowego w bieżącym reżimie, po usunięciu rytmu doby (predykcyjna wariancja uśredniona po długości reżimu)',
              'Standard deviation of the 5-minute return in the current regime, after removing the daily rhythm (predictive variance averaged over the regime length)'
            )}
          >
            {tr('σ reżimu (5 min)', 'regime σ (5 min)')} <span className="font-mono tabular-nums text-ink-1">{(l.regime.sigma5 * 100).toFixed(3)}%</span>
          </span>
          <span title={tr('Najbardziej prawdopodobna długość bieżącego reżimu (śledzone do 50 h)', 'Most likely length of the current regime (tracked up to 50 h)')}>
            {tr('reżim trwa', 'regime age')} <span className="font-mono tabular-nums text-ink-1">{runLabel(l.regime.run)}</span>
          </span>
          <span title={tr('Prawdopodobieństwo, że reżim zmienił się w ostatnich 5 świecach 5-minutowych', 'Probability that the regime changed within the last five 5-minute candles')}>
            {tr('P(zmiana w 25 min)', 'P(change in 25 min)')} <span className="font-mono tabular-nums text-ink-1">{(l.regime.pChange * 100).toFixed(0)}%</span>
          </span>
          <span title={tr('Kwantyle B = kwantyle A × skala', 'B quantiles = A quantiles × scale')}>
            B {l.scale >= 1 ? tr('szersze o', 'wider by') : tr('węższe o', 'narrower by')} <span className="font-mono tabular-nums text-ink-1">{Math.abs((l.scale - 1) * 100).toFixed(0)}%</span>
          </span>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-[11px]">
            <caption className="sr-only">
              {tr(
                'CRPS wersji A i B w okresach oceny; różnica B − A z 95% przedziałem Neweya–Westa (fixed-b) w punktach bazowych',
                'CRPS of versions A and B per evaluation period; difference B − A with a 95% Newey–West (fixed-b) interval in basis points'
              )}
            </caption>
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-medium font-sans">{tr('Okres oceny', 'Evaluation period')}</th>
                <th className="py-1 pr-3 font-medium font-sans">{tr('Par slotów', 'Slot pairs')}</th>
                <th
                  className="py-1 pr-3 font-medium font-sans"
                  title={tr('Ciągły ranking prawdopodobieństwa — niżej = lepiej; w punktach bazowych log-zwrotu', 'Continuous ranked probability score; lower is better; in basis points of log return')}
                >
                  CRPS A
                </th>
                <th className="py-1 pr-3 font-medium font-sans">CRPS B</th>
                <th
                  className="py-1 font-medium font-sans"
                  title={tr(
                    'Ujemne = B trafniejsze; 95% przedział Neweya–Westa (opóźnienie 24 h, wartość krytyczna fixed-b) tylko dla zakończonego okresu',
                    'Negative = B more accurate; 95% Newey–West interval (24 h lag, fixed-b critical value) only for a finished period'
                  )}
                >
                  B − A
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, b, final }) => (
                <tr key={label} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-sans">
                    {span(b)} <span className="text-[10px] text-ink-3">({label})</span>
                  </td>
                  <td className="py-1.5 pr-3">{b.n}</td>
                  <td className="py-1.5 pr-3">{bp(b.crpsA)}</td>
                  <td className="py-1.5 pr-3">{bp(b.crpsB)}</td>
                  <td className="py-1.5">
                    {b.diff ? (
                      <>
                        {sd(b.diff.d)}{' '}
                        <span className="text-[10px] text-ink-3">
                          ({sd(b.diff.lo)} … {sd(b.diff.hi)})
                        </span>
                      </>
                    ) : !final && b.crpsA !== null && b.crpsB !== null ? (
                      <span className="text-ink-3" title={tr('Bez przedziału, dopóki okres trwa — wniosek dopiero po jego końcu', 'No interval while the period runs; the conclusion comes only after it ends')}>
                        {sd(b.crpsB - b.crpsA)}
                      </span>
                    ) : (
                      DASH
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[11px] text-ink-3">
        {tr('CRPS w punktach bazowych log-zwrotu.', 'CRPS in basis points of log return.')}{' '}
        {ab.registeredAt ? (
          <span>
            {tr(
              `Plan oceny prerejestrowany w dzienniku ${stampFmt.format(ab.registeredAt)} UTC (hash w łańcuchu, weryfikator porównuje go z kodem). `,
              `Evaluation plan pre-registered in the ledger on ${stampFmt.format(ab.registeredAt)} UTC (hash in the chain; the verifier compares it with the code). `
            )}
          </span>
        ) : null}
        {tr(
          `Okresy oceny po ${ab.blockDays} dni ustalono z góry (od 23 października 2026). Wniosek pojawia się dopiero po zakończeniu okresu i rozliczeniu jego prognoz, więc nie da się przerwać testu w dogodnej chwili; przedział wymaga co najmniej 7 dób par.`,
          `Evaluation periods of ${ab.blockDays} days were fixed in advance (from 23 October 2026). The conclusion appears only after a period ends and its forecasts settle, so the test cannot be stopped at a convenient moment; the interval needs at least 7 days of pairs.`
        )}{' '}
        {verdict ? (
          <span className="text-ink-1">
            {tr('Wniosek za okres', 'Conclusion for')} {span(ab.last!)}: {verdict}.
          </span>
        ) : ab.last ? (
          <span>{tr('Zakończony okres miał za mało par slotów na wniosek.', 'The finished period had too few slot pairs for a conclusion.')}</span>
        ) : (
          <span>{tr('Pierwszy wniosek po zakończeniu pierwszego okresu.', 'The first conclusion comes after the first period ends.')}</span>
        )}{' '}
        {tr(
          'Weryfikator sprawdza, że wersja B ma te same chwile i benchmark co A, a jej skala wynika z zapisanych σ.',
          'The verifier checks that version B has the same moments and benchmark as A and that its scale follows from the recorded σ.'
        )}
      </div>
    </div>
  );
};
