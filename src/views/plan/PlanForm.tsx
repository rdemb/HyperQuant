import React from 'react';
import { X } from 'lucide-react';
import { Segmented, fmtPrice, fmtSigned, fmtFixed } from '../../ui';
import { PlanDirection } from '../../utils/planAnalyzer';
import { HORIZONS, parseNum } from './hooks';
import { tr } from '../../i18n';

export interface PlanFormState {
  direction: PlanDirection;
  entry: string;
  stop: string;
  target: string;
  sizeMode: 'usd' | 'risk';
  sizeUsd: string;
  riskPct: string;
  leverage: string;
  horizonMin: number;
  /** true = stop/cel to propozycja ±1.5σ/±3σ (użytkownik jeszcze ich nie edytował) */
  proposal: boolean;
  /** true = formularz nietknięty (wartości domyślne) — można go odświeżyć po nadejściu realnych danych */
  pristine: boolean;
  /** Źródło szkicu (np. „OFI Tape”) i notatka — pokazywane nad formularzem */
  draft: { source?: string; note?: string } | null;
}

interface PlanFormProps {
  form: PlanFormState;
  onChange: (patch: Partial<PlanFormState>) => void;
  equity: string;
  onEquity: (v: string) => void;
  marketPrice: number;
  sigma: number;
  /** Nominał wyliczony ze stałego ryzyka (tryb „ryzyko %”) */
  riskSizeUsd: number;
}

const inputCls =
  'w-full h-11 sm:h-9 bg-page border border-line rounded-md px-2.5 text-sm font-mono tabular-nums text-ink-1 placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

const Field: React.FC<{ id: string; label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }> = ({ id, label, hint, children }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1">
      {label}
    </label>
    {children}
    {hint && <div className="text-[11px] text-ink-3 mt-1 font-mono tabular-nums">{hint}</div>}
  </div>
);

/** Formularz planu: kierunek, wejście, stop, cel, wielkość ($ lub ryzyko % kapitału), dźwignia, horyzont. */
export const PlanForm: React.FC<PlanFormProps> = ({ form, onChange, equity, onEquity, marketPrice, sigma, riskSizeUsd }) => {
  const entry = parseNum(form.entry);
  const distHint = (raw: string) => {
    const v = parseNum(raw);
    if (!Number.isFinite(v) || !Number.isFinite(entry) || entry <= 0) return undefined;
    const pct = ((v - entry) / entry) * 100;
    const inSigma = sigma > 0 ? Math.abs(Math.log(v / entry)) / sigma : Number.NaN;
    return `${fmtSigned(pct, 2, '%')} · ${fmtSigned(v - entry, 0, ' $')}${Number.isFinite(inSigma) ? ` · ${fmtFixed(inSigma, 1)}σ` : ''}`;
  };
  const lev = parseNum(form.leverage);
  const notional = form.sizeMode === 'usd' ? parseNum(form.sizeUsd) : riskSizeUsd;

  return (
    <div className="flex flex-col gap-3.5">
      {form.draft && (
        <div className="flex items-start gap-2 rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <div className="text-ink-1">
              {form.draft.source ? (
                <>
                  {tr('Szkic z', 'Draft from')} <strong className="font-semibold">{form.draft.source}</strong>
                </>
              ) : (
                tr('Szkic ręczny', 'Manual draft')
              )}
            </div>
            {form.draft.note && <div className="text-ink-3 mt-0.5 leading-snug break-words">{form.draft.note}</div>}
            <div className="text-ink-3 mt-0.5">{tr('Kierunek pochodzi z panelu — oceń go, zanim go przyjmiesz.', 'The direction comes from a panel; assess it before you accept it.')}</div>
          </div>
          <button
            type="button"
            aria-label={tr('Ukryj informację o szkicu', 'Hide draft info')}
            onClick={() => onChange({ draft: null })}
            className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded text-ink-3 hover:text-ink-1 hover:bg-surface-3"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1">{tr('Kierunek', 'Direction')}</div>
          <Segmented<PlanDirection>
            ariaLabel={tr('Kierunek planu', 'Plan direction')}
            size="md"
            value={form.direction}
            onChange={(d) => onChange({ direction: d })}
            options={[
              { value: 'LONG', label: <span><span className="text-buy-ink" aria-hidden="true">▲</span> LONG</span> },
              { value: 'SHORT', label: <span><span className="text-sell-ink" aria-hidden="true">▼</span> SHORT</span> },
            ]}
          />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1">{tr('Horyzont', 'Horizon')}</div>
          <Segmented<number> ariaLabel={tr('Horyzont planu', 'Plan horizon')} value={form.horizonMin} onChange={(h) => onChange({ horizonMin: h })} options={HORIZONS} />
        </div>
      </div>

      <Field
        id="plan-entry"
        label={tr('Wejście', 'Entry')}
        hint={Number.isFinite(marketPrice) ? `${tr('rynek', 'market')} ${fmtPrice(marketPrice, 1)}` : tr('brak ceny rynkowej', 'no market price')}
      >
        <div className="flex gap-2">
          <input id="plan-entry" className={inputCls} inputMode="decimal" autoComplete="off" value={form.entry} onChange={(e) => onChange({ entry: e.target.value })} />
          <button
            type="button"
            disabled={!Number.isFinite(marketPrice)}
            onClick={() => onChange({ entry: marketPrice.toFixed(0) })}
            className="shrink-0 h-11 sm:h-9 px-3 rounded-md border border-line text-xs text-ink-2 hover:text-ink-1 hover:bg-surface-3 disabled:opacity-40 transition-colors"
          >
            {tr('cena rynkowa', 'market price')}
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field id="plan-stop" label={<><span className="text-sell-ink" aria-hidden="true">−</span> Stop</>} hint={distHint(form.stop)}>
          <input id="plan-stop" className={inputCls} inputMode="decimal" autoComplete="off" value={form.stop} onChange={(e) => onChange({ stop: e.target.value, proposal: false })} />
        </Field>
        <Field id="plan-target" label={<><span className="text-buy-ink" aria-hidden="true">+</span> {tr('Cel', 'Target')}</>} hint={distHint(form.target)}>
          <input id="plan-target" className={inputCls} inputMode="decimal" autoComplete="off" value={form.target} onChange={(e) => onChange({ target: e.target.value, proposal: false })} />
        </Field>
      </div>
      {form.proposal && (
        <div className="-mt-2 text-[11px] text-ink-3">
          {tr(
            <>
              Stop i cel to <span className="text-ink-2">propozycja startowa ±1,5σ / ±3σ horyzontu</span> — nie sygnał. Wpisz własne poziomy.
            </>,
            <>
              Stop and target are a <span className="text-ink-2">starting proposal of ±1.5σ / ±3σ of the horizon</span>, not a signal. Enter your own levels.
            </>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{tr('Wielkość', 'Size')}</span>
          <Segmented<'usd' | 'risk'>
            ariaLabel={tr('Sposób określenia wielkości', 'Sizing method')}
            value={form.sizeMode}
            onChange={(m) => onChange({ sizeMode: m })}
            options={[
              { value: 'usd', label: tr('Kwota $', 'Amount $') },
              { value: 'risk', label: tr('Ryzyko %', 'Risk %') },
            ]}
          />
        </div>
        {form.sizeMode === 'usd' ? (
          <Field id="plan-size" label={tr('Nominał pozycji (USD)', 'Position notional (USD)')}>
            <input id="plan-size" className={inputCls} inputMode="decimal" autoComplete="off" value={form.sizeUsd} onChange={(e) => onChange({ sizeUsd: e.target.value })} />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field id="plan-equity" label={tr('Kapitał (USD)', 'Equity (USD)')} hint={tr('zapamiętany w tej przeglądarce', 'remembered in this browser')}>
              <input id="plan-equity" className={inputCls} inputMode="decimal" autoComplete="off" value={equity} onChange={(e) => onEquity(e.target.value)} />
            </Field>
            <Field
              id="plan-risk"
              label={tr('Ryzyko na plan (%)', 'Risk per plan (%)')}
              hint={Number.isFinite(riskSizeUsd) ? `→ ${tr('nominał', 'notional')} ${fmtPrice(riskSizeUsd, 0)} $` : undefined}
            >
              <input id="plan-risk" className={inputCls} inputMode="decimal" autoComplete="off" value={form.riskPct} onChange={(e) => onChange({ riskPct: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      <Field
        id="plan-lev"
        label={tr('Dźwignia (isolated)', 'Leverage (isolated)')}
        hint={
          Number.isFinite(lev) && lev > 0 && Number.isFinite(notional)
            ? `${tr('depozyt', 'margin')} ≈ ${fmtPrice(notional / lev, 0)} $ · ${tr('puste pole = bez oceny likwidacji', 'empty = no liquidation check')}`
            : tr('puste pole = bez oceny likwidacji', 'empty = no liquidation check')
        }
      >
        <input id="plan-lev" className={inputCls} inputMode="decimal" autoComplete="off" placeholder={tr('np. 3', 'e.g. 3')} value={form.leverage} onChange={(e) => onChange({ leverage: e.target.value })} />
      </Field>
    </div>
  );
};
