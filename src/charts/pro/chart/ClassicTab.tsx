import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { INDICATORS, IndicatorInstance, MAX_INDICATORS, ParamDef, addIndicator, indicatorDef, paramOk } from '../indicators/registry';
import { tr } from '../../../i18n';

/**
 * Zakładka „Klasyczne” menu Wskaźniki: wskaźniki z rejestru (EMA, Bollinger, RSI, ATR) do dodania, a pod nimi te na
 * wykresie z parametrami, widocznością i usunięciem. Jeden wskaźnik można dodać kilka razy (np. EMA 21 i EMA 55).
 */

const ROW_BTN = 'w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md hover:text-ink-1 hover:bg-surface-3';

/** Pole parametru: tekst w trakcie pisania, wartość trafia do wykresu, gdy jest liczbą z zakresu. */
const ParamInput: React.FC<{ p: ParamDef; value: number; onChange: (v: number) => void }> = ({ p, value, onChange }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      inputMode={p.step < 1 ? 'decimal' : 'numeric'}
      min={p.min}
      max={p.max}
      step={p.step}
      value={text}
      aria-label={p.label}
      title={`${p.label} (${p.min}–${p.max})`}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && paramOk(v, p)) onChange(v);
      }}
      onBlur={() => setText(String(value))}
      className="w-16 h-8 rounded-md border border-line bg-surface-1 px-1.5 font-mono text-xs text-ink-1"
    />
  );
};

export const ClassicTab: React.FC<{ list: IndicatorInstance[]; narrow: boolean; onChange: (list: IndicatorInstance[]) => void }> = ({ list, narrow, onChange }) => {
  const full = list.length >= MAX_INDICATORS;
  const patch = (iid: string, p: Partial<IndicatorInstance>) => onChange(list.map((x) => (x.iid === iid ? { ...x, ...p } : x)));
  const ownShown = list.filter((x) => x.visible && indicatorDef(x.id).pane === 'own').length;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {INDICATORS.map((d) => (
          <li key={d.id} className="flex items-start gap-2.5 py-1">
            <span className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-ink-1">{d.name}</span>
              <span className="text-[11px] leading-snug text-ink-3">{d.hint}</span>
            </span>
            <button
              type="button"
              disabled={full}
              onClick={() => onChange(addIndicator(list, d.id))}
              aria-label={tr(`Dodaj: ${d.short}`, `Add: ${d.short}`)}
              className="shrink-0 inline-flex items-center gap-1 min-h-8 px-2 rounded-md border border-line-strong text-ink-2 hover:text-ink-1 hover:bg-surface-3 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Plus className="w-3.5 h-3.5" />
              {tr('Dodaj', 'Add')}
            </button>
          </li>
        ))}
      </ul>
      {list.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <span className="text-ink-2">{tr('Na wykresie', 'On the chart')}</span>
          <ul className="flex flex-col">
            {list.map((x) => {
              const d = indicatorDef(x.id);
              return (
                <li key={x.iid} className={`flex items-center gap-1.5 min-h-10 ${x.visible ? '' : 'opacity-55'}`}>
                  <span className="inline-block w-3.5 h-[3px] rounded-full shrink-0" style={{ background: x.color }} aria-hidden="true" />
                  <span className="w-9 shrink-0 font-mono text-ink-1">{d.short}</span>
                  <span className="flex flex-1 min-w-0 gap-1.5">
                    {d.params.map((p) => (
                      <ParamInput key={p.key} p={p} value={x.params[p.key]} onChange={(v) => patch(x.iid, { params: { ...x.params, [p.key]: v } })} />
                    ))}
                  </span>
                  <button
                    type="button"
                    aria-pressed={!x.visible}
                    aria-label={x.visible ? tr(`Ukryj: ${d.short}`, `Hide: ${d.short}`) : tr(`Pokaż: ${d.short}`, `Show: ${d.short}`)}
                    title={x.visible ? tr('Ukryj', 'Hide') : tr('Pokaż', 'Show')}
                    onClick={() => patch(x.iid, { visible: !x.visible })}
                    className={`${ROW_BTN} ${x.visible ? 'text-ink-3' : 'text-ink-1'}`}
                  >
                    {x.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    aria-label={tr(`Usuń: ${d.short}`, `Remove: ${d.short}`)}
                    title={tr('Usuń', 'Remove')}
                    onClick={() => onChange(list.filter((y) => y.iid !== x.iid))}
                    className={`${ROW_BTN} text-ink-3 hover:text-critical`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {narrow && ownShown > 1 && (
        <p className="text-[11px] leading-snug text-ink-3">
          {tr(
            'Na telefonie pod wykresem widać jeden panel wskaźnika: pierwszy widoczny na liście. Pozostałe wracają na szerszym ekranie.',
            'On a phone one indicator pane shows below the chart: the first visible one in the list. The others return on a wider screen.'
          )}
        </p>
      )}
      <p className="text-[11px] leading-snug text-ink-3">
        {tr(
          'Wzory i wartości domyślne jak we wbudowanych wskaźnikach TradingView, liczone ze świec Hyperliquid. Wskaźnik opisuje ostatnie świece, nie przewiduje następnych.',
          "Formulas and defaults as in TradingView's built-in indicators, computed from Hyperliquid candles. An indicator describes recent candles; it does not predict the next ones."
        )}
      </p>
    </div>
  );
};
