import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { EmptyState, Panel, fmtCompact } from '../../ui';
import { AggrTemplateSummary, summarizeAggrTemplate } from './aggrTemplate';
import { tr } from '../../i18n';

const URL_TEMPLATE = './data/aggr_template.json';
const PANE_LABEL: Record<string, string> = { chart: tr('wykresy', 'charts'), trades: tr('taśmy', 'tapes'), stats: tr('statystyki', 'stats') };

/** Szablon workspace'u Aggr (aggrBTCv5) — skąd pochodzą progi taśmy i układ wskaźników desku. */
export const AggrTemplateCard: React.FC = () => {
  const [summary, setSummary] = useState<AggrTemplateSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    let alive = true;
    fetch(URL_TEMPLATE)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: unknown) => {
        if (!alive) return;
        const s = summarizeAggrTemplate(raw);
        setSummary(s);
        setStatus(s ? 'ready' : 'missing');
      })
      .catch(() => alive && setStatus('missing'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Panel
      eyebrow={tr('Szablon Aggr', 'Aggr template')}
      title={summary ? `${summary.name}${summary.version !== null ? ` · v${summary.version}` : ''}` : 'aggrBTCv5'}
      actions={
        <a
          href={URL_TEMPLATE}
          download="aggr_template.json"
          aria-label={tr('Pobierz szablon Aggr (JSON)', 'Download the Aggr template (JSON)')}
          title={tr('Pobierz szablon Aggr (JSON)', 'Download the Aggr template (JSON)')}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-2 hover:text-ink-1 hover:bg-surface-2 border border-transparent hover:border-line transition-colors duration-150"
        >
          <Download className="w-4 h-4" />
        </a>
      }
      bodyClassName="px-4 py-3"
    >
      {status === 'loading' && <p className="text-xs text-ink-3">{tr('Wczytuję szablon…', 'Loading the template…')}</p>}
      {status === 'missing' && (
        <div className="-mx-4 -my-3">
          <EmptyState title={tr('Brak pliku szablonu', 'Template file missing')} detail={tr('Nie udało się wczytać public/data/aggr_template.json.', 'Could not load public/data/aggr_template.json.')} />
        </div>
      )}
      {summary && (
        <div className="flex flex-col gap-2 text-xs text-ink-2 leading-relaxed">
          <p>
            {tr(
              'Workspace aggr.trade, z którego desk przejął progi taśmy i zestaw wskaźników (CVD spot/perp, delta per giełda, likwidacje). Plik można zaimportować w aggr.trade.',
              'The aggr.trade workspace the desk took its tape thresholds and indicator set from (spot/perp CVD, delta per exchange, liquidations). The file can be imported into aggr.trade.'
            )}
          </p>
          <dl className="grid grid-cols-3 gap-2">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{tr('Panele', 'Panes')}</dt>
              <dd className="font-mono tabular-nums text-ink-1 text-sm">{summary.panes.total}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{tr('Wskaźniki', 'Indicators')}</dt>
              <dd className="font-mono tabular-nums text-ink-1 text-sm">{summary.indicators}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{tr('Rynki', 'Markets')}</dt>
              <dd className="font-mono tabular-nums text-ink-1 text-sm">
                {summary.markets} <span className="text-ink-3 text-xs">
                  / {summary.exchanges} {tr('giełd', 'exchanges')}
                </span>
              </dd>
            </div>
          </dl>
          <p className="text-ink-3">
            {Object.entries(summary.panes.byType)
              .map(([t, n]) => `${n} ${PANE_LABEL[t] ?? t}`)
              .join(' · ')}
          </p>
          {summary.tapes
            .filter((t) => t.amounts.length > 0)
            .slice(0, 2)
            .map((t) => (
              <p key={t.name} className="font-mono tabular-nums">
                <span className="text-ink-3">{t.name}:</span> {t.amounts.map((a) => fmtCompact(a, '$')).join(' / ')}
              </p>
            ))}
        </div>
      )}
    </Panel>
  );
};
