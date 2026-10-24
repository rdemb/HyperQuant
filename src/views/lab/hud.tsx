import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { tr } from '../../i18n';

// Wspólne elementy HUD scen 3D — tokeny ink/surface, bez backdrop-filter nad WebGL (koszt na GPU).

/** Ramka sceny: tło strony, hairline, zaokrąglenie panelu. */
export const SCENE_FRAME = 'relative w-full h-full min-h-[320px] bg-page overflow-hidden select-none border border-line rounded-xl';

/** Nagłówek sceny (lewy górny róg). Na telefonie ukryty — opis jest w panelu obok płótna. */
export const HudHeader: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="absolute top-3 left-3 z-10 pointer-events-none hidden sm:flex flex-col gap-0.5 bg-surface-1/90 border border-line px-3 py-2 rounded-lg max-w-[min(560px,62%)]">
    <div className="text-xs font-semibold text-ink-1">{title}</div>
    {children && <div className="text-[11px] text-ink-2 font-mono tabular-nums leading-relaxed">{children}</div>}
  </div>
);

/** Przycisk w prawym górnym rogu; na telefonie tylko ikona (etykieta w aria-label). */
export const HudButton: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
  emphasis?: boolean;
}> = ({ onClick, icon, label, title, emphasis }) => (
  <button
    type="button"
    onClick={onClick}
    title={title ?? label}
    aria-label={label}
    className={`inline-flex items-center gap-1.5 px-2.5 min-h-9 text-xs font-medium rounded-lg border transition-colors duration-150 whitespace-nowrap ${
      emphasis
        ? 'bg-surface-2 text-ink-1 border-line-strong hover:bg-surface-3'
        : 'bg-surface-1/90 text-ink-2 border-line hover:bg-surface-2 hover:text-ink-1'
    }`}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </button>
);

/** Karta podpowiedzi po najechaniu na obiekt sceny (raycasting). Kolor tylko w znaczniku obok tytułu. */
export const HoverCard: React.FC<{
  swatch: string;
  title: string;
  subtitle?: string;
  rows: { k: string; v: string }[];
}> = ({ swatch, title, subtitle, rows }) => (
  <div className="absolute top-3 sm:top-24 left-3 z-20 pointer-events-none bg-surface-2 border border-line-strong px-3 py-2 rounded-lg shadow-xl max-w-[min(300px,calc(100%-24px))]">
    <div className="text-xs font-semibold text-ink-1 flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: swatch }} aria-hidden="true" />
      <span>{title}</span>
    </div>
    {subtitle && <div className="text-[11px] text-ink-3 mt-0.5 font-mono tabular-nums">{subtitle}</div>}
    {rows.length > 0 && (
      <dl className="mt-1.5 pt-1.5 border-t border-line grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        {rows.map((r) => (
          <React.Fragment key={r.k}>
            <dt className="text-ink-3">{r.k}</dt>
            <dd className="text-right font-mono tabular-nums text-ink-1">{r.v}</dd>
          </React.Fragment>
        ))}
      </dl>
    )}
  </div>
);

/** Zwijany panel sterowania sceny (dół płótna). */
export const SceneDock: React.FC<{ collapsed: boolean; onToggle: () => void; children: React.ReactNode }> = ({
  collapsed,
  onToggle,
  children,
}) => (
  <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 w-max max-w-[calc(100%-24px)] flex flex-col items-center">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={`inline-flex items-center gap-1.5 px-3 min-h-8 text-[11px] font-medium text-ink-2 hover:text-ink-1 bg-surface-1 border border-line ${
        collapsed ? 'rounded-lg' : 'rounded-t-lg border-b-0'
      }`}
    >
      {collapsed ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
      {collapsed ? tr('Sterowanie sceny', 'Scene controls') : tr('Ukryj sterowanie', 'Hide controls')}
    </button>
    {!collapsed && (
      <div className="bg-surface-1/95 border border-line rounded-lg px-3 py-2 shadow-2xl flex flex-wrap items-center justify-center gap-2 max-w-full">
        {children}
      </div>
    )}
  </div>
);

/** Presety kamery w stylu przełącznika segmentowego. */
export function DockPresets<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-0.5 bg-page border border-line rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`px-2 min-h-7 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors duration-150 ${
            value === o.id ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-1'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Przełącznik warstwy / efektu. */
export const DockToggle: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={`inline-flex items-center gap-1 px-2 min-h-7 rounded-md text-[11px] font-medium border transition-colors duration-150 whitespace-nowrap ${
      on ? 'bg-surface-3 text-ink-1 border-line-strong' : 'text-ink-3 border-line hover:text-ink-1'
    }`}
  >
    {children}
  </button>
);

/** Suwak parametru sceny z wartością w mono. */
export const DockSlider: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}> = ({ label, min, max, step, value, onChange, format }) => (
  <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-3 whitespace-nowrap">
    {label}
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-16 accent-accent cursor-pointer"
    />
    <span className="font-mono tabular-nums text-ink-1 w-9">{format(value)}</span>
  </label>
);
