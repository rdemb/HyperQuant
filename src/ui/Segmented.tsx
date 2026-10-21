import React from 'react';

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}

/** Przełącznik segmentowy (radiogroup) — używany do interwałów, trybów i widoków. */
export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel, size = 'sm' }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 bg-page border border-line rounded-lg p-0.5"
      onKeyDown={(e) => {
        // Nawigacja strzałkami jak w natywnej grupie radio
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = options.findIndex((o) => o.value === value);
        const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
        onChange(next.value);
        const btns = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]');
        btns[options.indexOf(next)]?.focus();
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded-md font-medium whitespace-nowrap transition-colors duration-150 ${
              active ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-1'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
