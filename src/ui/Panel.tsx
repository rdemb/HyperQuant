import React from 'react';

interface PanelProps {
  title?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Wariant bohatera widoku — mocniejsza ramka, większy tytuł */
  hero?: boolean;
  id?: string;
}

/** Bazowy panel: nagłówek (eyebrow + tytuł + akcje) i treść. Zastępuje ręczne karty. */
export const Panel: React.FC<PanelProps> = ({ title, eyebrow, actions, children, className = '', bodyClassName = '', hero, id }) => (
  <section
    id={id}
    className={`bg-surface-1 border ${hero ? 'border-line-strong' : 'border-line'} rounded-xl min-w-0 flex flex-col ${className}`}
  >
    {(title || eyebrow || actions) && (
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-line">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{eyebrow}</div>
          )}
          {title && (
            <h2 className={`font-display text-ink-1 ${hero ? 'text-lg' : 'text-[15px]'} font-semibold leading-tight`}>
              {title}
            </h2>
          )}
        </div>
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </header>
    )}
    <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
  </section>
);
