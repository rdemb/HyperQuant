import React from 'react';
import { Badge, DASH, fmtFixed } from '../../ui';
import { LEDGER_MIN_N } from '../../utils/deskLedger';
import { HREL_DESIGN, HREL_MODEL, type HrelBlock, type HrelSummary } from '../../utils/hourRel';
import { locale, tr } from '../../i18n';

const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Procent bez „−0%” */
const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : `${fmtFixed(Math.round(v * 100) || 0, 0)}%`);
const num = (v: number | null | undefined, d: number) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : fmtFixed(v, d));

/** Wynik bloku (wyprzedzenie 1 h): statystyka t z planu, średnie p wobec częstości, największe odchylenie kwintyla */
function BlockRow({ b, label }: { b: HrelBlock; label: string }) {
  const tWhy = b.t === null ? tr(`od ${HREL_DESIGN.minN} godzin (jest ${b.n})`, `from ${HREL_DESIGN.minN} hours (now ${b.n})`) : null;
  return (
    <tr className="border-t border-line">
      <td className="py-1 pr-3 text-ink-2">
        {label} <span className="text-ink-3">({dateFmt.format(b.start)}–{dateFmt.format(b.end - 1)})</span>
      </td>
      <td className="py-1 pr-3 font-mono tabular-nums">{b.n}</td>
      <td className="py-1 pr-3 font-mono tabular-nums">{tWhy ? <span title={tWhy}>{DASH} <span className="font-sans text-ink-3">{tWhy}</span></span> : num(b.t, 2)}</td>
      <td className="py-1 pr-3 font-mono tabular-nums">
        {pct(b.meanP)} / {pct(b.freq)}
      </td>
      <td className="py-1 font-mono tabular-nums">{b.maxQDev === null ? DASH : `${fmtFixed(Math.round(b.maxQDev * 100), 0)} pp`}</td>
    </tr>
  );
}

/**
 * `hrel-v1` w karcie dziennika „Po sesji”: przed awansem jedyne miejsce na stronie z wynikiem tej prognozy — pomiar
 * (Brier, BSS wobec 50%, AUC, średnie p i częstość dla czterech wyprzedzeń, bloki z planu), bez szans bieżącej godziny.
 */
export const HrelLedgerCard: React.FC<{ h: HrelSummary }> = ({ h }) => {
  const blocks = [...h.blocks.map((b, i) => [b, tr(`Blok ${i + 1}`, `Block ${i + 1}`)] as const), ...(h.pooled ? [[h.pooled, tr('Bloki 1–2 łącznie', 'Blocks 1–2 pooled')] as const] : [])];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">
          {tr('Duży ruch jak na tę godzinę: test w dzienniku', 'Big move for this hour: test in the ledger')} ({HREL_DESIGN.id})
        </div>
        <span className="flex items-center gap-2 text-[11px] text-ink-3">
          <Badge tone="model" size="sm" title={tr('Wynik modelu z publicznych świec 1h Hyperliquid', 'Model output from public Hyperliquid 1h candles')}>
            MODEL
          </Badge>
          {HREL_MODEL}
          {h.latest && (
            <>
              {' · '}
              {tr('ostatni zapis', 'latest record')} {timeFmt.format(h.latest.t)}
            </>
          )}
        </span>
      </div>
      <p className="text-[10px] text-ink-3 leading-snug">
        {tr(
          `Raz na godzinę dziennik zapisuje szanse dużego ruchu dla tej i trzech kolejnych godzin UTC. Duży = zakres godziny powyżej mediany tej godziny z 20 dni tego samego typu (robocze albo weekend), więc baza to stałe 50%. Cechy ze świec 1h zamkniętych przed godziną, wagi zapisane w planie przed pierwszym rekordem. Do awansu wynik jest tylko tutaj i w MCP, bez szans na stronie i w odprawie. Plan od ${dateFmt.format(h.plan.at)}, ocena w blokach po ${HREL_DESIGN.blockDays} dni (wyprzedzenie 1 h, t poniżej −2,24).`,
          `Once an hour the ledger records the chances of a big move for this and the next three UTC hours. Big = hourly range above the median of the same hour over 20 days of the same type (weekday or weekend), so the base is a constant 50%. Features come from 1h candles closed before the hour, weights recorded in the plan before the first record. Until promotion the result is only here and in MCP, with no chances on the site or in the briefing. Plan since ${dateFmt.format(h.plan.at)}, scored in ${HREL_DESIGN.blockDays}-day blocks (1 h lead, t below −2.24).`
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-ink-3">
            <tr>
              <th className="pb-1 pr-3 text-left font-medium">{tr('Wyprzedzenie', 'Lead')}</th>
              <th className="pb-1 pr-3 text-left font-medium">{tr('Godziny', 'Hours')}</th>
              <th className="pb-1 pr-3 text-left font-medium">Brier</th>
              <th className="pb-1 pr-3 text-left font-medium">{tr('BSS wobec 50% [95%]', 'BSS vs 50% [95%]')}</th>
              <th className="pb-1 pr-3 text-left font-medium">AUC</th>
              <th className="pb-1 text-left font-medium">{tr('średnie p / częstość', 'mean p / frequency')}</th>
            </tr>
          </thead>
          <tbody>
            {h.leads.map((l) => {
              const ok = l.n >= LEDGER_MIN_N;
              const why = tr(`od ${LEDGER_MIN_N} rozstrzygnięć (jest ${l.n})`, `from ${LEDGER_MIN_N} settlements (now ${l.n})`);
              const bss = l.bss.value === null ? DASH : l.bss.lo !== null && l.bss.hi !== null ? `${pct(l.bss.value)} [${pct(l.bss.lo)}; ${pct(l.bss.hi)}]` : pct(l.bss.value);
              return (
                <tr key={l.j} className="border-t border-line">
                  <td className="py-1 pr-3 text-ink-2">{l.j} h</td>
                  <td className="py-1 pr-3 font-mono tabular-nums">{l.n}</td>
                  {ok ? (
                    <>
                      <td className="py-1 pr-3 font-mono tabular-nums">{num(l.brier, 3)}</td>
                      <td className="py-1 pr-3 font-mono tabular-nums">{bss}</td>
                      <td className="py-1 pr-3 font-mono tabular-nums">{num(l.auc, 2)}</td>
                      <td className="py-1 font-mono tabular-nums">
                        {pct(l.meanP)} / {pct(l.freq)}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-1 text-ink-3">
                      {DASH} {why}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-ink-3">{tr(`Ostatnie ${h.days} dni; przedział z losowania dób UTC.`, `Last ${h.days} days; interval from resampling UTC days.`)}</div>
      {blocks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-ink-3">
              <tr>
                <th className="pb-1 pr-3 text-left font-medium">{tr('Blok (wyprzedzenie 1 h)', 'Block (1 h lead)')}</th>
                <th className="pb-1 pr-3 text-left font-medium">{tr('Godziny', 'Hours')}</th>
                <th className="pb-1 pr-3 text-left font-medium">t</th>
                <th className="pb-1 pr-3 text-left font-medium">{tr('średnie p / częstość', 'mean p / frequency')}</th>
                <th className="pb-1 text-left font-medium">{tr('maks. odchylenie kwintyla', 'max quintile gap')}</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map(([b, label]) => (
                <BlockRow key={label} b={b} label={label} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
