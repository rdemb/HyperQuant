import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import { Panel } from '../../ui';
import { downloadLegacyPlanData, legacyPlanSummary } from './legacyPlanData';
import { tr } from '../../i18n';

const BTN =
  'inline-flex items-center gap-1.5 min-h-11 lg:min-h-8 px-3 text-xs font-medium text-ink-1 bg-surface-3 hover:bg-line-strong border border-line-strong rounded-lg transition-colors duration-150';

/** Dane dawnego Analizatora planu (dziennik w tej przeglądarce): liczba planów i eksport do JSON. Bez planów karty nie ma. */
export const LegacyPlanDataCard: React.FC = () => {
  const summary = useMemo(() => {
    try {
      return legacyPlanSummary(window.localStorage);
    } catch {
      return { plans: 0, hasEquity: false };
    }
  }, []);
  if (summary.plans === 0) return null;
  return (
    <Panel eyebrow={tr('Dane lokalne', 'Local data')} title={tr('Dane dawnego Analizatora', 'Former Plan Analyzer data')}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2 leading-relaxed">
          {tr(
            `W tej przeglądarce leży ${summary.plans} zapisanych planów z dawnego Analizatora planu. Zostają nietknięte; możesz je pobrać jako plik.`,
            `This browser holds ${summary.plans} plans saved by the former Plan Analyzer. They stay untouched; you can download them as a file.`
          )}
        </p>
        <button type="button" onClick={() => downloadLegacyPlanData(window.localStorage)} className={`${BTN} self-start`}>
          <Download className="w-4 h-4" aria-hidden="true" />
          {tr('Pobierz dane dawnego Analizatora (JSON)', 'Download former Plan Analyzer data (JSON)')}
        </button>
      </div>
    </Panel>
  );
};
