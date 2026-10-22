import React from 'react';
import { DASH } from '../../ui';
import type { AbBlock, DeskLedgerSummary } from '../../utils/deskLedger';

const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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
  if (b.diff.hi < 0) return 'wersja B (z reżimem) trafniejsza';
  if (b.diff.lo > 0) return 'wersja A (bez reżimu) trafniejsza';
  return 'różnica nieudowodniona';
}

/**
 * A/B wersji modelu w weryfikowalnym dzienniku: wersja A (HAR + FHS) i wersja B (σ z mieszaniny z reżimem zmienności
 * z BOCPD) zapisywane przed faktem w tych samych slotach. Ocena w z góry ustalonych okresach 14 dni: w toku tylko
 * liczności i CRPS, wniosek z przedziałem Neweya–Westa dopiero po zakończeniu okresu.
 */
export const ModelAbCard: React.FC<{ ab: NonNullable<DeskLedgerSummary['ab']> }> = ({ ab }) => {
  const l = ab.latest;
  const verdict = ab.last ? verdictOf(ab.last) : null;
  const rows: { label: string; b: AbBlock; final: boolean }[] = [];
  if (ab.last) rows.push({ label: 'zakończony', b: ab.last, final: true });
  if (ab.current) rows.push({ label: 'w toku', b: ab.current, final: false });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">A/B wersji modelu · zwrot 1 h</div>
        {l && <span className="text-[11px] text-ink-3">ostatnie: {timeFmt.format(l.t)}</span>}
      </div>
      <p className="text-[11px] text-ink-2 leading-relaxed">
        W slotach ze świeżym reżimem dziennik zapisuje przed faktem dwie wersje prognozy zwrotu na 1 h. Wersja A to model zmienności HAR + FHS. Wersja B
        miesza jego wariancję po połowie z wariancją bieżącego reżimu zmienności, wykrywanego bayesowsko w czasie rzeczywistym (BOCPD, Adams i MacKay
        2007) na zwrotach 5-minutowych z 3 dni, oczyszczonych z rytmu doby. Kształt rozkładu zostaje ten sam, zmienia się tylko szerokość. Wygrywa wersja z
        niższym CRPS na tych samych slotach.
      </p>
      {l && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          <span title="Odchylenie zwrotu 5-minutowego w bieżącym reżimie, po usunięciu rytmu doby (predykcyjna wariancja uśredniona po długości reżimu)">
            σ reżimu (5 min) <span className="font-mono tabular-nums text-ink-1">{(l.regime.sigma5 * 100).toFixed(3)}%</span>
          </span>
          <span title="Najbardziej prawdopodobna długość bieżącego reżimu (śledzone do 50 h)">
            reżim trwa <span className="font-mono tabular-nums text-ink-1">{runLabel(l.regime.run)}</span>
          </span>
          <span title="Prawdopodobieństwo, że reżim zmienił się w ostatnich 5 świecach 5-minutowych">
            P(zmiana w 25 min) <span className="font-mono tabular-nums text-ink-1">{(l.regime.pChange * 100).toFixed(0)}%</span>
          </span>
          <span title="Kwantyle B = kwantyle A × skala">
            B {l.scale >= 1 ? 'szersze' : 'węższe'} o <span className="font-mono tabular-nums text-ink-1">{Math.abs((l.scale - 1) * 100).toFixed(0)}%</span>
          </span>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-[11px]">
            <caption className="sr-only">CRPS wersji A i B w okresach oceny; różnica B − A z 95% przedziałem Neweya–Westa w punktach bazowych</caption>
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-medium font-sans">Okres oceny</th>
                <th className="py-1 pr-3 font-medium font-sans">Par slotów</th>
                <th className="py-1 pr-3 font-medium font-sans" title="Ciągły ranking prawdopodobieństwa — niżej = lepiej; w punktach bazowych log-zwrotu">
                  CRPS A
                </th>
                <th className="py-1 pr-3 font-medium font-sans">CRPS B</th>
                <th className="py-1 font-medium font-sans" title="Ujemne = B trafniejsze; 95% przedział Neweya–Westa (opóźnienie 24 h) tylko dla zakończonego okresu">
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
                      <span className="text-ink-3" title="Bez przedziału, dopóki okres trwa — wniosek dopiero po jego końcu">
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
        CRPS w punktach bazowych log-zwrotu. Okresy oceny po {ab.blockDays} dni ustalono z góry (od 23 października 2026). Wniosek pojawia się dopiero po
        zakończeniu okresu, więc nie da się przerwać testu w dogodnej chwili.{' '}
        {verdict ? (
          <span className="text-ink-1">Wniosek za okres {span(ab.last!)}: {verdict}.</span>
        ) : ab.last ? (
          <span>Zakończony okres miał za mało par slotów na wniosek.</span>
        ) : (
          <span>Pierwszy wniosek po zakończeniu pierwszego okresu.</span>
        )}{' '}
        Weryfikator sprawdza, że wersja B ma te same chwile i benchmark co A, a jej skala wynika z zapisanych σ.
      </div>
    </div>
  );
};
