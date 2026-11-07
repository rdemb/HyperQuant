import React from 'react';
import { Badge, BadgeTone } from './Badge';
import { DASH } from './format';

interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Zmiana: liczba ze znakiem; kolor wg kierunku, zawsze ze znakiem ▲▼ */
  delta?: { value: number | null; text: string } | null;
  hint?: React.ReactNode;
  source?: { tone: BadgeTone; label: string; title?: string };
  /**
   * Brak liczby: bez plakietki źródła (LIVE, MODEL, SIM — obok „—” udawałaby dane). Domyślnie, gdy wartość to „—”;
   * „—” owinięte w JSX trzeba podać jawnie. Stan danych (BRAK, STALE, „< 24 h”) zostaje, bo to powód braku.
   */
  missing?: boolean;
  trend?: React.ReactNode;
  className?: string;
}

/** Tony plakietek źródła liczby; pozostałe (stale, warn, neutral) opisują stan danych. */
const SOURCE_TONES: ReadonlySet<BadgeTone> = new Set(['live', 'model', 'sim']);

/** Kafel liczby: etykieta, wartość (cyfry proporcjonalne), delta ze strzałką, opcjonalne źródło i sparkline. */
export const Stat: React.FC<StatProps> = ({ label, value, delta, hint, source, missing = value === DASH, trend, className = '' }) => (
  <div className={`min-w-0 flex flex-col gap-1 ${className}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium leading-snug">{label}</span>
      {source && !(missing && SOURCE_TONES.has(source.tone)) && (
        <Badge tone={source.tone} title={source.title}>
          {source.label}
        </Badge>
      )}
    </div>
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xl font-semibold text-ink-1 leading-tight truncate">{value}</div>
        {delta && delta.value !== null && Number.isFinite(delta.value) && (
          <div className={`text-xs font-medium ${delta.value >= 0 ? 'text-buy-ink' : 'text-sell-ink'}`}>
            <span aria-hidden="true">{delta.value >= 0 ? '▲' : '▼'}</span> {delta.text}
          </div>
        )}
        {hint && <div className="text-[11px] text-ink-3 leading-snug mt-0.5">{hint}</div>}
      </div>
      {trend && <div className="shrink-0">{trend}</div>}
    </div>
  </div>
);
