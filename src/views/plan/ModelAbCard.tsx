import React from 'react';
import { DASH } from '../../ui';
import type { DeskLedgerSummary } from '../../utils/deskLedger';

/** Wniosek A/B od tylu par z podpróby rozłącznej (prognozy 1 h co 15 min nakładają się) */
const VERDICT_INDEP = 30;
const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });

/**
 * A/B wersji modelu w weryfikowalnym dzienniku: wersja A (HAR + FHS) i wersja B (σ z mieszaniny z reżimem zmienności
 * z BOCPD) zapisywane przed faktem w tych samych slotach; CRPS obu i różnica z niepewnością.
 */
export const ModelAbCard: React.FC<{ ab: NonNullable<DeskLedgerSummary['ab']> }> = ({ ab }) => {
  const l = ab.latest;
  const sd = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 1e4).toFixed(2)}`;
  const enough = ab.nIndep >= VERDICT_INDEP && ab.diff;
  const verdict = !enough
    ? null
    : ab.diff!.hi < 0
    ? 'wersja B (z reżimem) trafniejsza'
    : ab.diff!.lo > 0
    ? 'wersja A (bez reżimu) trafniejsza'
    : 'różnica nieudowodniona';
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">A/B wersji modelu · zwrot 1 h</div>
        {l && <span className="text-[11px] text-ink-3">ostatnie: {timeFmt.format(l.t)}</span>}
      </div>
      <p className="text-[11px] text-ink-2 leading-relaxed">
        W każdym slocie dziennik zapisuje przed faktem dwie wersje prognozy zwrotu na 1 h. Wersja A to model zmienności HAR + FHS. Wersja B miesza jego
        wariancję po połowie z wariancją bieżącego reżimu zmienności, wykrywanego bayesowsko w czasie rzeczywistym (BOCPD, Adams i MacKay 2007) na
        zwrotach 5-minutowych z 3 dni. Kształt rozkładu zostaje ten sam, zmienia się tylko szerokość. Wygrywa ta wersja, która ma niższy CRPS na tych
        samych slotach.
      </p>
      {l && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          <span title="Odchylenie zwrotu 5-minutowego w bieżącym reżimie (średnia a posteriori)">
            σ reżimu (5 min) <span className="font-mono tabular-nums text-ink-1">{(l.regime.sigma5 * 100).toFixed(3)}%</span>
          </span>
          <span title="Najbardziej prawdopodobna długość bieżącego reżimu">
            reżim trwa ~<span className="font-mono tabular-nums text-ink-1">{Math.round((l.regime.run * 5) / 60)} h</span>
          </span>
          <span title="Prawdopodobieństwo, że reżim zmienił się w ostatnich 5 świecach 5-minutowych">
            P(zmiana w 25 min) <span className="font-mono tabular-nums text-ink-1">{(l.regime.pChange * 100).toFixed(0)}%</span>
          </span>
          <span title="Kwantyle B = kwantyle A × skala">
            B {l.scale >= 1 ? 'szersze' : 'węższe'} o <span className="font-mono tabular-nums text-ink-1">{Math.abs((l.scale - 1) * 100).toFixed(0)}%</span>
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono tabular-nums text-[11px]">
          <caption className="sr-only">CRPS wersji A i B na tych samych slotach, różnica B − A z przedziałem bootstrap 90% w punktach bazowych</caption>
          <thead className="text-ink-3">
            <tr>
              <th className="py-1 pr-3 font-medium font-sans">Par slotów</th>
              <th className="py-1 pr-3 font-medium font-sans" title="Ciągły ranking prawdopodobieństwa — niżej = lepiej; w punktach bazowych log-zwrotu">
                CRPS A
              </th>
              <th className="py-1 pr-3 font-medium font-sans">CRPS B</th>
              <th className="py-1 font-medium font-sans" title="Ujemne = B trafniejsze; przedział bootstrap 90% z podpróby rozłącznej (sloty co 1 h)">
                B − A
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="py-1.5 pr-3">
                {ab.n} <span className="text-[10px] text-ink-3">(rozłącznych {ab.nIndep})</span>
              </td>
              <td className="py-1.5 pr-3">{ab.crpsA === null ? DASH : (ab.crpsA * 1e4).toFixed(2)}</td>
              <td className="py-1.5 pr-3">{ab.crpsB === null ? DASH : (ab.crpsB * 1e4).toFixed(2)}</td>
              <td className="py-1.5">
                {ab.diff ? (
                  <>
                    {sd(ab.diff.d)}{' '}
                    <span className="text-[10px] text-ink-3">
                      ({sd(ab.diff.lo)} … {sd(ab.diff.hi)})
                    </span>
                  </>
                ) : (
                  DASH
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-ink-3">
        CRPS w punktach bazowych log-zwrotu.{' '}
        {verdict ? <span className="text-ink-1">Wniosek na tej próbie: {verdict}.</span> : <span>Wniosek dopiero od {VERDICT_INDEP} rozłącznych par slotów.</span>}{' '}
        Weryfikator sprawdza, że wersja B ma te same chwile i benchmark co A, a jej kwantyle to kwantyle A × zapisana skala.
      </div>
    </div>
  );
};
