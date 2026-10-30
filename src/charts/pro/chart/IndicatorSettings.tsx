import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ColorPicker } from '../draw/DrawToolbar';
import { INDICATOR_WIDTHS, IndicatorInstance, ParamDef, defaultWidth, indicatorDef, indicatorLabel, memoryCandles, paramOk, parseParams } from '../indicators/registry';
import { tr } from '../../../i18n';

/**
 * Okno ustawień wskaźnika, jak w TradingView: zakładki Parametry, Styl i Opis, „Domyślne”, Anuluj i OK.
 * Zmiany widać na wykresie od razu; „Anuluj” i Esc przywracają stan sprzed otwarcia okna.
 */

type Tab = 'params' | 'style' | 'info';

const TABS: { id: Tab; label: string }[] = [
  { id: 'params', label: tr('Parametry', 'Inputs') },
  { id: 'style', label: tr('Styl', 'Style') },
  { id: 'info', label: tr('Opis', 'About') },
];

const FIELD = 'h-8 min-w-0 px-2 rounded-md bg-page border border-line font-mono text-xs text-ink-1 outline-none focus:border-accent [color-scheme:dark]';

/** „1 świeca”, „3 świece”, „12 świec” (po angielsku candle / candles). */
function candles(n: number): string {
  const d = n % 10;
  const h = n % 100;
  const pl = n === 1 ? 'świeca' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'świece' : 'świec';
  return tr(`${n} ${pl}`, `${n} ${n === 1 ? 'candle' : 'candles'}`);
}

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
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && paramOk(v, p)) onChange(v);
      }}
      onBlur={() => setText(String(value))}
      className={`${FIELD} w-24`}
    />
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-3 min-h-10">
    <span className="w-28 shrink-0 text-ink-2">{label}</span>
    <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5">{children}</div>
  </div>
);

/** `loaded` — liczba świec na wykresie (przy krótszej historii średnia rekurencyjna zależy jeszcze od jej początku). */
export const IndicatorSettings: React.FC<{ x: IndicatorInstance; loaded: number; onChange: (x: IndicatorInstance) => void; onClose: () => void }> = ({
  x,
  loaded,
  onChange,
  onClose,
}) => {
  const [start] = useState(x);
  const [tab, setTab] = useState<Tab>('params');
  const [pick, setPick] = useState(false);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const grab = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const def = indicatorDef(x.id);
  const set = (p: Partial<IndicatorInstance>) => onChange({ ...x, ...p });
  const cancel = () => {
    onChange(start);
    onClose();
  };
  const warmup = def.warmup(x.params);
  const memory = memoryCandles(def, x.params);
  const span = warmup + 1;

  // Fokus w oknie: Esc i Enter działają od razu, bez klikania w pole
  useEffect(() => ref.current?.focus(), []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={tr(`Ustawienia: ${indicatorLabel(x)}`, `Settings: ${indicatorLabel(x)}`)}
      style={{ transform: `translate(calc(-50% + ${off.x}px), ${off.y}px)` }}
      className="absolute left-1/2 top-2 z-40 w-[min(380px,calc(100%-16px))] max-h-[calc(100%-16px)] flex flex-col rounded-xl border border-line-strong bg-surface-2 text-xs shadow-2xl outline-none"
      onKeyDown={(e) => {
        // Klawisze okna nie trafiają do skrótów wykresu
        e.stopPropagation();
        if (e.key === 'Escape') cancel();
        else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) onClose();
      }}
    >
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          grab.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
        }}
        onPointerMove={(e) => {
          const g = grab.current;
          if (g) setOff({ x: g.ox + e.clientX - g.x, y: Math.max(0, g.oy + e.clientY - g.y) });
        }}
        onPointerUp={() => (grab.current = null)}
        onPointerCancel={() => (grab.current = null)}
        className="flex items-center gap-2 pl-3 pr-1 pt-1 cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <span className="inline-block w-3.5 h-[3px] rounded-full shrink-0" style={{ background: x.color }} aria-hidden="true" />
        <span className="flex-1 truncate text-sm font-medium text-ink-1">{indicatorLabel(x)}</span>
        <button type="button" aria-label={tr('Zamknij', 'Close')} title={tr('Zamknij', 'Close')} onClick={onClose} className="w-8 h-8 inline-flex items-center justify-center rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div role="tablist" className="flex gap-3 px-3 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => setTab(t.id)}
            className={`h-9 -mb-px border-b-2 whitespace-nowrap ${t.id === tab ? 'border-accent text-ink-1 font-medium' : 'border-transparent text-ink-3 hover:text-ink-1'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5">
        {tab === 'params' &&
          def.params.map((p) => (
            <Row key={p.key} label={p.label}>
              <ParamInput p={p} value={x.params[p.key]} onChange={(v) => set({ params: { ...x.params, [p.key]: v } })} />
              <span className="text-ink-3 font-mono">
                {p.min}–{p.max}
              </span>
            </Row>
          ))}
        {tab === 'style' && (
          <div className="flex flex-col gap-1">
            <Row label={tr('Linia', 'Line')}>
              <button
                type="button"
                title={tr('Kolor', 'Colour')}
                aria-label={tr('Kolor', 'Colour')}
                aria-expanded={pick}
                onClick={() => setPick((v) => !v)}
                className={`h-8 px-1.5 rounded-md border inline-flex items-center gap-1.5 ${pick ? 'border-accent' : 'border-line hover:border-line-strong'}`}
              >
                <span className="w-5 h-5 rounded" style={{ background: x.color, opacity: Math.max(x.alpha, 0.15) }} />
                <ChevronDown className="w-3.5 h-3.5 text-ink-3" />
              </button>
              <select aria-label={tr('Grubość linii', 'Line width')} value={x.width} onChange={(e) => set({ width: Number(e.target.value) })} className={`${FIELD} w-[4.5rem]`}>
                {INDICATOR_WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {w}px
                  </option>
                ))}
              </select>
            </Row>
            {pick && (
              <div className="rounded-lg border border-line bg-surface-1 p-1.5">
                <ColorPicker color={x.color} alpha={x.alpha} onColor={(color) => set({ color })} onAlpha={(alpha) => set({ alpha })} />
              </div>
            )}
            <label className="flex items-center gap-2.5 min-h-10 cursor-pointer text-ink-1">
              <input type="checkbox" checked={x.labels} onChange={(e) => set({ labels: e.target.checked })} className="w-4 h-4 shrink-0 accent-accent" />
              {tr('Wartość na osi ceny', 'Value on the price scale')}
            </label>
          </div>
        )}
        {tab === 'info' && (
          <div className="flex flex-col gap-2 leading-snug">
            <p className="text-ink-1 font-medium">{def.name}</p>
            <p className="text-ink-2">{def.hint}.</p>
            <p className="text-ink-2">
              {tr(
                'Wzór i wartości domyślne jak we wbudowanym wskaźniku TradingView, liczone ze świec Hyperliquid tego wykresu.',
                "Formula and defaults as in TradingView's built-in indicator, computed from this chart's Hyperliquid candles."
              )}
            </p>
            <p className="text-ink-2">
              {warmup > 0
                ? tr(`Rozbieg: na początku historii ${candles(warmup)} bez wartości.`, `Warm-up: ${candles(warmup)} without a value at the start of history.`)
                : tr('Wartość od pierwszej świecy historii.', 'A value from the first candle of history.')}{' '}
              {memory !== null
                ? tr(
                    `Średnie rekurencyjne: liczy się cała wczytana historia, ale poza ostatnimi ${memory} świecami jej waga to łącznie mniej niż 0,1%.`,
                    `Recursive averages: the whole loaded history counts, but beyond the last ${memory} candles its total weight is below 0.1%.`
                  )
                : span === 1
                  ? tr('Wartość zależy tylko od bieżącej świecy.', 'The value depends only on the current candle.')
                  : tr(`Wartość zależy tylko od ostatnich ${span} świec.`, `The value depends only on the last ${span} candles.`)}
            </p>
            {memory !== null && loaded > 0 && loaded < memory && (
              <p className="text-warn">
                {tr(
                  `Wykres ma teraz ${candles(loaded)}, mniej niż ${memory}: początek wczytanej historii wciąż wpływa na wartość.`,
                  `The chart now has ${candles(loaded)}, fewer than ${memory}: the start of the loaded history still affects the value.`
                )}
              </p>
            )}
            <p className="text-ink-3">{tr('Wskaźnik opisuje ostatnie świece, nie przewiduje następnych.', 'An indicator describes recent candles; it does not predict the next ones.')}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-line">
        <button
          type="button"
          title={tr('Parametry i styl domyślne (kolor zostaje)', 'Default inputs and style (the colour stays)')}
          onClick={() => set({ params: parseParams(def, null), alpha: 1, width: defaultWidth(def), labels: true })}
          className="h-8 px-2.5 rounded-md border border-line text-ink-2 hover:text-ink-1 hover:bg-surface-3"
        >
          {tr('Domyślne', 'Defaults')}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={cancel} className="h-8 px-3 rounded-md text-ink-2 hover:text-ink-1 hover:bg-surface-3">
          {tr('Anuluj', 'Cancel')}
        </button>
        <button type="button" onClick={onClose} className="h-8 px-4 rounded-md bg-accent text-page font-medium hover:opacity-90">
          OK
        </button>
      </div>
    </div>
  );
};
