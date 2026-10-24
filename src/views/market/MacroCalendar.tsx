import React, { useMemo } from 'react';
import { ChevronUp, ChevronsUp, ExternalLink } from 'lucide-react';
import { Badge, EmptyState, Panel, fmtCountdown } from '../../ui';
import {
  MACRO_EVENTS,
  MacroEvent,
  eventVolMultiplier,
  fmtEventEt,
  fmtEventLocal,
  mergeEvents,
  sourceShort,
} from '../../data/macroCalendar';
import { useNow, usePublicFeed } from '../../utils/publicFeeds';
import { tr } from '../../i18n';

const HOUR = 3600000;
const HORIZON_MS = 14 * 24 * HOUR;
// Zdarzenie zostaje na liście jeszcze 30 min po publikacji (etykieta „teraz”)
const KEEP_AFTER_MS = 30 * 60000;
/** Nazwy zdarzeń BEA z potoku danych są po polsku (format danych) → wersja angielska do wyświetlenia */
const BEA_EN: Record<string, string> = {
  'PKB + PCE (dochody i wydatki) — BEA': 'GDP + PCE (personal income and outlays) — BEA',
  'PKB — BEA': 'GDP — BEA',
  'PCE (dochody i wydatki osobiste) — BEA': 'PCE (personal income and outlays) — BEA',
};

// Daty z potoku (BEA release_dates.json) przyjmujemy tylko w poprawnym kształcie
function isValidEvent(e: MacroEvent): boolean {
  return (
    !!e &&
    e.kind === 'GDP_PCE' &&
    typeof e.name === 'string' &&
    Number.isFinite(e.timeUtcMs) &&
    typeof e.sourceUrl === 'string' &&
    e.sourceUrl.startsWith('https://')
  );
}

/** Ważność: ikona + etykieta (kolor nie jest jedynym nośnikiem znaczenia). */
const Importance: React.FC<{ level: MacroEvent['importance'] }> = ({ level }) =>
  level === 'high' ? (
    <span className="inline-flex items-center gap-1 text-ink-1">
      <ChevronsUp size={14} aria-hidden="true" />
      {tr('Wysoka', 'High')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-ink-3">
      <ChevronUp size={14} aria-hidden="true" />
      {tr('Średnia', 'Medium')}
    </span>
  );

/** Kalendarz makro USA: najbliższe 14 dni z odliczaniem, czasem lokalnym i ET, ważnością i źródłem. */
export const MacroCalendar: React.FC = () => {
  const now = useNow(30000);
  const { feed } = usePublicFeed('calendar');

  const all = useMemo(
    () => mergeEvents(MACRO_EVENTS, (feed?.data.bea ?? []).filter(isValidEvent).map((e) => ({ ...e, name: tr(e.name, BEA_EN[e.name] ?? e.name) }))),
    [feed]
  );
  const events = all.filter((e) => e.timeUtcMs >= now - KEEP_AFTER_MS && e.timeUtcMs <= now + HORIZON_MS);
  const later = all.find((e) => e.timeUtcMs > now + HORIZON_MS) ?? null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Panel
      title={tr('Kalendarz makro', 'Macro calendar')}
      eyebrow={tr('USA · najbliższe 14 dni', 'US · next 14 days')}
      actions={
        <Badge
          tone="neutral"
          title={tr(
            'Daty z federalreserve.gov, bls.gov i bea.gov (stan 2026-10-21), uzupełniane z BEA release_dates.json',
            'Dates from federalreserve.gov, bls.gov and bea.gov (as of 2026-10-21), supplemented from BEA release_dates.json'
          )}
        >
          {tr('Oficjalne', 'Official')}
        </Badge>
      }
    >
      {events.length === 0 ? (
        <EmptyState
          title={tr('Brak publikacji w najbliższych 14 dniach', 'No releases in the next 14 days')}
          detail={
            later
              ? `${tr('Następne', 'Next')}: ${later.name} — ${fmtEventLocal(later.timeUtcMs)} (${fmtCountdown(later.timeUtcMs, now)}).`
              : tr(
                  'Tabela dat się skończyła — wymaga aktualizacji z oficjalnych harmonogramów Fed, BLS i BEA.',
                  'The date table has run out; it needs an update from the official Fed, BLS and BEA schedules.'
                )
          }
        />
      ) : (
        <ol className="divide-y divide-line">
          {events.map((e) => {
            const dt = e.timeUtcMs - now;
            const soon = dt < 24 * HOUR;
            return (
              <li key={e.id} className={`flex gap-3 px-4 py-2.5 ${soon ? 'bg-surface-2' : ''}`}>
                <div className="w-[68px] shrink-0 pt-0.5 text-[11px] font-medium">
                  <Importance level={e.importance} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-1 leading-snug">{e.name}</span>
                    <span className={`shrink-0 text-xs font-mono tabular-nums ${soon ? 'text-warn' : 'text-ink-2'}`}>
                      {fmtCountdown(e.timeUtcMs, now)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
                    <time dateTime={new Date(e.timeUtcMs).toISOString()}>{fmtEventLocal(e.timeUtcMs)}</time>
                    <span aria-hidden="true">·</span>
                    <span>{fmtEventEt(e.timeUtcMs)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums" title={tr('Mnożnik wariancji okna z publikacją (prior do kalibracji)', 'Variance multiplier of a window with a release (prior to be calibrated)')}>
                      σ² ×{eventVolMultiplier(e).toFixed(2)}
                    </span>
                    {soon && dt > 0 && <Badge tone="warn">&lt; 24 h</Badge>}
                    <a
                      href={e.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 rounded hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {sourceShort(e)}
                      <ExternalLink size={11} aria-hidden="true" />
                      <span className="sr-only">{tr('(otwiera oficjalny harmonogram w nowej karcie)', '(opens the official schedule in a new tab)')}</span>
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="px-4 py-2.5 border-t border-line text-[11px] text-ink-3 leading-relaxed">
        {tr(
          'σ² × m — założony mnożnik wariancji okna zawierającego publikację (prior do kalibracji; Kroner 2025, Benigno & Rosa 2023, Corbet i in. 2020). Analizator planu poszerza nim zakres zmienności, gdy horyzont planu obejmuje zdarzenie. Czas lokalny: ',
          'σ² × m: the assumed variance multiplier of a window containing a release (prior to be calibrated; Kroner 2025, Benigno & Rosa 2023, Corbet et al. 2020). The Plan Analyzer widens the volatility range with it when the plan horizon covers the event. Local time: '
        )}
        {tz}.
      </p>
    </Panel>
  );
};
export default MacroCalendar;
