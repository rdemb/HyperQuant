import React from 'react';

/**
 * Nagłówek sekcji widoku (rytm jak rozdziały Startu): numer i nadtytuł drobnym krojem, tytuł krojem wyświetlanym
 * (Bricolage Grotesque), opcjonalny opis i treść z prawej (np. zakres danych). `id` trafia na <h2> (aria-labelledby sekcji).
 */
export const SectionHeading: React.FC<{
  id: string;
  nr?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  note?: React.ReactNode;
  aside?: React.ReactNode;
}> = ({ id, nr, eyebrow, title, note, aside }) => (
  <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pt-6 pb-1">
    <div className="min-w-0 max-w-3xl">
      {(nr || eyebrow) && (
        <p className="mb-2 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
          {nr && <span className="font-mono tracking-normal text-ink-2">Nº {nr}</span>}
          {nr && eyebrow && <span aria-hidden="true" className="h-px w-8 bg-line-strong" />}
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="font-display text-[clamp(22px,2.2vw,30px)] font-bold leading-[1.05] tracking-tight [font-stretch:90%] text-ink-1 text-balance">
        {title}
      </h2>
      {note && <p className="mt-2 text-xs leading-snug text-ink-3 text-pretty">{note}</p>}
    </div>
    {aside && <div className="shrink-0">{aside}</div>}
  </div>
);
