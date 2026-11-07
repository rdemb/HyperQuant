import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import { Panel } from '../../ui';
import { type LegacyPlanSummary, downloadLegacyPlanData, downloadLegacyRaw, legacyPlanSummary, plansLabel } from './legacyPlanData';
import { tr } from '../../i18n';

const BTN =
  'inline-flex items-center gap-1.5 min-h-11 lg:min-h-8 px-3 text-xs font-medium text-ink-1 bg-surface-3 hover:bg-line-strong border border-line-strong rounded-lg transition-colors duration-150';

/**
 * Dane dawnego Analizatora planu (w tej przeglądarce): liczba planów, kapitał i eksport do JSON; zapis nie do odczytu
 * można pobrać w surowej postaci. Bez planów i bez uszkodzonego zapisu karty nie ma. Nic w pamięci nie jest zmieniane.
 */
export const LegacyPlanDataCard: React.FC = () => {
  const summary = useMemo<LegacyPlanSummary>(() => {
    try {
      return legacyPlanSummary(window.localStorage);
    } catch {
      return { plans: 0, hasEquity: false, unreadable: false };
    }
  }, []);
  const { plans, hasEquity, unreadable } = summary;
  if (plans === 0 && !unreadable) return null;
  const what = plans > 0 ? `${plansLabel(plans)}${hasEquity ? tr(' i zapisany kapitał', ' and the saved equity') : ''}` : null;
  return (
    <Panel eyebrow={tr('Dane lokalne', 'Local data')} title={tr('Dane dawnego Analizatora', 'Former Plan Analyzer data')}>
      <div className="flex flex-col gap-3">
        {what && (
          <p className="text-[13px] text-ink-2 leading-relaxed">
            {tr(
              `Dane dawnego Analizatora planu w tej przeglądarce: ${what}. Zostają nietknięte; możesz je pobrać jako plik.`,
              `Former Plan Analyzer data in this browser: ${what}. They stay untouched; you can download them as a file.`
            )}
          </p>
        )}
        {unreadable && (
          <p className="text-[13px] text-ink-2 leading-relaxed">
            {tr(
              'Części zapisu planów nie da się odczytać. Zapis zostaje nietknięty; możesz pobrać go w surowej postaci.',
              'Part of the saved plans cannot be read. The record stays untouched; you can download it in raw form.'
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {plans > 0 && (
            <button type="button" onClick={() => downloadLegacyPlanData(window.localStorage)} className={BTN}>
              <Download className="w-4 h-4" aria-hidden="true" />
              {tr('Pobierz dane dawnego Analizatora (JSON)', 'Download former Plan Analyzer data (JSON)')}
            </button>
          )}
          {unreadable && (
            <button type="button" onClick={() => downloadLegacyRaw(window.localStorage)} className={BTN}>
              <Download className="w-4 h-4" aria-hidden="true" />
              {tr('Pobierz surowe dane', 'Download raw data')}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
};
