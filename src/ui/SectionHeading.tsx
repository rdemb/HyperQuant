import React from 'react';

/**
 * Nagłówek sekcji albo strony (rytm jak rozdziały Startu): numer i nadtytuł drobnym krojem, tytuł krojem wyświetlanym
 * (Bricolage Grotesque), opcjonalny wstęp (`lead`), dopisek (`note`) i treść z prawej (`aside`). `level` 1 — nagłówek
 * strony (<h1>, większy; Lekcje, Badania, Źródła, Agenci AI), 2 — sekcja (<h2>). `id` trafia na nagłówek
 * (aria-labelledby sekcji).
 */
export const SectionHeading: React.FC<{
  id: string;
  nr?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  note?: React.ReactNode;
  aside?: React.ReactNode;
  level?: 1 | 2;
}> = ({ id, nr, eyebrow, title, lead, note, aside, level = 2 }) => {
  const H = level === 1 ? 'h1' : 'h2';
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-2 ${level === 1 ? 'pt-2 pb-2' : 'pt-6 pb-1'}`}>
      <div className="min-w-0 max-w-3xl">
        {(nr || eyebrow) && (
          <p className="mb-2 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
            {nr && <span className="font-mono tracking-normal text-ink-2">Nº {nr}</span>}
            {nr && eyebrow && <span aria-hidden="true" className="h-px w-8 bg-line-strong" />}
            {eyebrow}
          </p>
        )}
        <H
          id={id}
          className={`font-display font-bold leading-[1.05] tracking-tight [font-stretch:90%] text-ink-1 text-balance ${
            level === 1 ? 'text-[clamp(30px,3.4vw,46px)]' : 'text-[clamp(22px,2.2vw,30px)]'
          }`}
        >
          {title}
        </H>
        {lead && <div className="mt-3 text-[15px] leading-relaxed text-ink-2 text-pretty">{lead}</div>}
        {note && <p className="mt-2 text-xs leading-snug text-ink-3 text-pretty">{note}</p>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
};
