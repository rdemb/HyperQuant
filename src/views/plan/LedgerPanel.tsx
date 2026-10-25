import React, { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Badge, EmptyState, Panel, Stat, fmtPrice, fmtFixed } from '../../ui';
import { LedgerEntry, LedgerStatus, ReliabilityBin } from '../../utils/forecastLedger';
import { PlanLedger } from './usePlanLedger';
import { fmtMinutes } from './hooks';
import { locale, tr } from '../../i18n';

const STATUS: Record<LedgerStatus, { icon: string; label: string; cls: string }> = {
  target: { icon: '✓', label: tr('cel', 'target'), cls: 'text-buy-ink' },
  stop: { icon: '✕', label: 'stop', cls: 'text-sell-ink' },
  none: { icon: '○', label: tr('żadne', 'neither'), cls: 'text-ink-2' },
  pending: { icon: '…', label: tr('oczekuje', 'pending'), cls: 'text-ink-3' },
  nodata: { icon: '—', label: tr('brak danych', 'no data'), cls: 'text-ink-3' },
  nofill: { icon: '∅', label: tr('niewykonany', 'not filled'), cls: 'text-ink-3' },
};

const fmt3 = (v: number | null) => (v === null ? '—' : fmtFixed(v, 3));
const timeFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Panel dziennika trafności: Brier, log score, liczność, wykres niezawodności, ostatnie wpisy; eksport i czyszczenie. */
export const LedgerPanel: React.FC<{ ledger: PlanLedger }> = ({ ledger }) => {
  const { entries, metrics, persisted } = ledger;
  const [confirmClear, setConfirmClear] = useState(false);
  const recent = [...entries].reverse().slice(0, 8);

  return (
    <Panel
      title={tr('Dziennik trafności', 'Accuracy journal')}
      eyebrow={tr('Kalibracja prognoz Analizatora', 'Calibration of Plan Analyzer forecasts')}
      actions={
        <>
          <button
            type="button"
            onClick={ledger.download}
            disabled={entries.length === 0}
            aria-label={tr('Eksport dziennika do pliku JSON', 'Export the journal to a JSON file')}
            className="inline-flex items-center justify-center gap-1.5 h-11 w-11 sm:h-9 sm:w-auto sm:px-2.5 rounded-md border border-line text-xs text-ink-2 hover:text-ink-1 hover:bg-surface-3 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> <span className="hidden sm:inline">{tr('Eksport JSON', 'Export JSON')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmClear) {
                ledger.clear();
                setConfirmClear(false);
              } else setConfirmClear(true);
            }}
            onBlur={() => setConfirmClear(false)}
            disabled={entries.length === 0}
            aria-label={confirmClear ? tr('Potwierdź wyczyszczenie dziennika', 'Confirm clearing the journal') : tr('Wyczyść dziennik', 'Clear journal')}
            className={`inline-flex items-center justify-center gap-1.5 h-11 min-w-11 px-2.5 sm:h-9 rounded-md border text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none ${
              confirmClear ? 'border-critical/60 text-critical bg-critical/10' : 'border-line text-ink-2 hover:text-ink-1 hover:bg-surface-3'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {confirmClear ? <span>{tr('Na pewno?', 'Sure?')}</span> : <span className="hidden sm:inline">{tr('Wyczyść', 'Clear')}</span>}
          </button>
        </>
      }
    >
      <div className="px-4 py-3 text-[11px] text-ink-3 leading-relaxed border-b border-line">
        {tr('Dane tylko w tej przeglądarce', 'Data stays in this browser only')}
        {persisted ? '' : tr(' — zapis zablokowany (tryb prywatny?), dziennik zniknie po zamknięciu karty', ': saving is blocked (private mode?), the journal disappears when the tab closes')}.{' '}
        {tr(
          'Rozstrzygane na realnych świecach 1m z API Hyperliquid (niezależnie od interwału wykresu): wejście w granicy 1 bp od ceny przy zapisie liczy się jako zlecenie rynkowe, inne najpierw muszą zostać dotknięte; potem cel lub stop; minuta w toku przy zapisie jest pomijana, a świeca dotykająca celu i stopu liczy się ostrożnie jako „stop”.',
          'Settled on real 1m candles from the Hyperliquid API (regardless of the chart timeframe): an entry within 1 bp of the price at save time counts as a market order, others must be touched first; then target or stop; the minute in progress at save time is skipped, and a candle touching both target and stop conservatively counts as "stop".'
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        <div className="lg:col-span-3 grid grid-cols-2 lg:grid-cols-1 gap-3 content-start">
          <Stat
            label={tr('Brier (3 klasy)', 'Brier (3 classes)')}
            value={<span className="font-mono tabular-nums">{fmt3(metrics.brier)}</span>}
            hint={tr('0 = idealnie · 2 = najgorzej · niżej lepiej', '0 = perfect · 2 = worst · lower is better')}
          />
          <Stat
            label={tr('Brier P(cel)', 'Brier P(target)')}
            value={<span className="font-mono tabular-nums">{fmt3(metrics.brierTarget)}</span>}
            hint={tr('binarny, 0–1', 'binary, 0–1')}
          />
          <Stat
            label="Log score"
            value={<span className="font-mono tabular-nums">{fmt3(metrics.logScore)}</span>}
            hint={tr('−ln p(wyniku), naty · niżej lepiej', '−ln p(outcome), nats · lower is better')}
          />
          <Stat
            label={tr('Brier P(wypełnienia)', 'Brier P(fill)')}
            value={<span className="font-mono tabular-nums">{fmt3(metrics.brierFill)}</span>}
            hint={
              metrics.fillScored > 0
                ? tr(`0–1 · n = ${metrics.fillScored} (plany z modelem v2)`, `0–1 · n = ${metrics.fillScored} (plans with model v2)`)
                : tr('brak planów z P(wypełnienia)', 'no plans with P(fill)')
            }
          />
          <Stat
            label={tr('Liczność', 'Count')}
            value={<span className="font-mono tabular-nums">{metrics.resolved}</span>}
            hint={tr(
              `rozstrzygnięte · ${metrics.pending} oczekuje${metrics.nodata ? ` · ${metrics.nodata} bez danych` : ''}`,
              `settled · ${metrics.pending} pending${metrics.nodata ? ` · ${metrics.nodata} without data` : ''}`
            )}
          />
        </div>
        <div className="lg:col-span-4 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-2">{tr('Niezawodność P(cel przed stopem)', 'Reliability of P(target before stop)')}</div>
          {metrics.resolved === 0 ? (
            <EmptyState
              className="px-0"
              title={tr('Brak rozstrzygniętych planów', 'No settled plans')}
              detail={tr(
                'Zapisz plan do dziennika — po dotknięciu celu lub stopu albo upływie horyzontu pojawi się tutaj.',
                'Save a plan to the journal; it shows up here once target or stop is touched or the horizon runs out.'
              )}
            />
          ) : (
            <ReliabilityChart bins={metrics.reliability} />
          )}
        </div>
        <div className="lg:col-span-5 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-2">{tr('Ostatnie wpisy', 'Latest entries')}</div>
          {recent.length === 0 ? (
            <div className="text-xs text-ink-3">{tr('Dziennik jest pusty.', 'The journal is empty.')}</div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[11px] font-mono tabular-nums min-w-[420px]">
                <thead>
                  <tr className="text-ink-3 text-left">
                    <th className="font-medium px-1 py-1">{tr('Czas', 'Time')}</th>
                    <th className="font-medium px-1 py-1">Plan</th>
                    <th className="font-medium px-1 py-1 text-right">{tr('Wejście', 'Entry')}</th>
                    <th className="font-medium px-1 py-1 text-right">{tr('P(cel)', 'P(target)')}</th>
                    <th className="font-medium px-1 py-1 text-right">{tr('Wynik', 'Outcome')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <LedgerRow key={e.id} e={e} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
};

const LedgerRow: React.FC<{ e: LedgerEntry }> = ({ e }) => {
  const st = STATUS[e.status];
  return (
    <tr className="border-t border-line text-ink-2" title={`Stop ${fmtPrice(e.stop, 0)} · ${tr('Cel', 'Target')} ${fmtPrice(e.target, 0)}${e.source ? ` · ${tr('źródło', 'source')}: ${e.source}` : ''}`}>
      <td className="px-1 py-1.5 whitespace-nowrap">{timeFmt.format(e.createdAt)}</td>
      <td className="px-1 py-1.5 whitespace-nowrap">
        <span className={e.direction === 'LONG' ? 'text-buy-ink' : 'text-sell-ink'} aria-hidden="true">
          {e.direction === 'LONG' ? '▲' : '▼'}
        </span>{' '}
        {e.direction} · {fmtMinutes(e.horizonMin)}
      </td>
      <td className="px-1 py-1.5 text-right">{fmtPrice(e.entry, 0)}</td>
      <td className="px-1 py-1.5 text-right">{fmtFixed(e.pTarget * 100, 0)}%</td>
      <td className={`px-1 py-1.5 text-right whitespace-nowrap ${st.cls}`}>
        <span aria-hidden="true">{st.icon}</span> {st.label}
      </td>
    </tr>
  );
};

/** Wykres niezawodności: średnia prognoza (x) vs częstość celu (y) w 10 koszykach; przekątna = idealna kalibracja. */
const ReliabilityChart: React.FC<{ bins: ReliabilityBin[] }> = ({ bins }) => {
  const [hover, setHover] = useState<number | null>(null);
  const S = 220;
  const pad = { l: 34, r: 16, t: 8, b: 28 };
  const inner = S - pad.l - pad.r;
  const innerH = S - pad.t - pad.b;
  const x = (v: number) => pad.l + v * inner;
  const y = (v: number) => pad.t + (1 - v) * innerH;
  const pts = bins
    .map((b, i) => ({ ...b, i }))
    .filter((b): b is typeof b & { meanForecast: number; observed: number } => b.n > 0 && b.meanForecast !== null && b.observed !== null);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.meanForecast).toFixed(1)},${y(p.observed).toFixed(1)}`).join('');
  const h = hover !== null ? pts.find((p) => p.i === hover) : undefined;

  return (
    <div style={{ maxWidth: S }}>
      <div className="relative">
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" className="block" role="img" aria-label={tr('Wykres niezawodności prognoz P(cel przed stopem)', 'Reliability diagram of P(target before stop) forecasts')}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={S - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <line x1={x(v)} x2={x(v)} y1={pad.t} y2={S - pad.b} stroke="var(--color-line)" strokeWidth={1} />
            <text x={pad.l - 5} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} className="fill-ink-3 font-mono">
              {v * 100}%
            </text>
            <text x={x(v)} y={S - pad.b + 13} textAnchor="middle" fontSize={10} className="fill-ink-3 font-mono">
              {v * 100}%
            </text>
          </g>
        ))}
        <text x={pad.l + inner / 2} y={S - 2} textAnchor="middle" fontSize={10} className="fill-ink-3">
          {tr('prognoza', 'forecast')}
        </text>
        {/* Przekątna odniesienia — idealna kalibracja */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--color-ink-3)" strokeWidth={1} />
        <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p) => (
          <g key={p.i} onPointerEnter={() => setHover(p.i)} onPointerLeave={() => setHover(null)} onPointerDown={() => setHover(p.i)}>
            <circle cx={x(p.meanForecast)} cy={y(p.observed)} r={12} fill="transparent" />
            <circle cx={x(p.meanForecast)} cy={y(p.observed)} r={4} fill="var(--color-accent)" stroke="var(--color-surface-1)" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {h && (
        <div
          className="absolute pointer-events-none whitespace-nowrap bg-surface-2 border border-line-strong rounded-md px-2 py-1 text-[11px] font-mono tabular-nums text-ink-2"
          style={{
            // Podpowiedź obok punktu, po stronie z większą ilością miejsca
            left: `${(x(h.meanForecast) / S) * 100}%`,
            top: `${(y(h.observed) / S) * 100}%`,
            transform: x(h.meanForecast) > S / 2 ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)',
          }}
        >
          <div className="text-ink-1">
            {tr('Koszyk', 'Bucket')} {Math.round(h.lo * 100)}–{Math.round(h.hi * 100)}%
          </div>
          <div>
            {tr('prognoza', 'forecast')} {fmtFixed(h.meanForecast * 100, 1)}%
          </div>
          <div>
            {tr('częstość', 'frequency')} {fmtFixed(h.observed * 100, 1)}%
          </div>
          <div>n = {h.n}</div>
        </div>
      )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-accent" aria-hidden="true" /> {tr('koszyk', 'bucket')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-px bg-ink-3" aria-hidden="true" /> {tr('przekątna = kalibracja', 'diagonal = calibration')}
        </span>
        {pts.some((p) => p.n < 10) && <Badge tone="neutral">{tr('mała próba', 'small sample')}</Badge>}
      </div>
    </div>
  );
};
