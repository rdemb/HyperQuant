import React from 'react';
import type { LessonsContent } from '../../lessons/content/types';

/** Jak łączyć wskaźniki: trzy pytania w ustalonej kolejności, zasady i zestawy pytań do typowych sytuacji. */
export const Combine: React.FC<{ c: LessonsContent }> = ({ c }) => {
  const k = c.combine;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-2 max-w-prose leading-relaxed">{k.intro}</p>
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {k.questions.map((q, i) => (
          <li key={q.q} className="flex flex-col gap-2 p-4 rounded-xl border border-line-strong bg-surface-1">
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-accent text-sm">{i + 1}</span>
              <span className="font-display text-base font-semibold text-ink-1">{q.q}</span>
            </span>
            <p className="text-[13px] text-ink-1 leading-relaxed">{q.answer}</p>
            <p className="text-xs text-ink-3 leading-relaxed">{q.tools}</p>
          </li>
        ))}
      </ol>
      <ul className="flex flex-col gap-2 p-4 rounded-xl border border-line bg-surface-1">
        {k.rules.map((r) => (
          <li key={r} className="flex gap-2 text-[13px] text-ink-2 leading-relaxed">
            <span className="shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-2.5" aria-labelledby="recipes-title">
        <h2 id="recipes-title" className="font-display text-base font-semibold text-ink-1">
          {k.recipesTitle}
        </h2>
        <p className="text-sm text-ink-2 max-w-prose leading-relaxed">{k.recipesIntro}</p>
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {k.recipes.map((r) => (
            <li key={r.name} className="flex flex-col gap-2.5 p-4 rounded-xl border border-line bg-surface-1">
              <h3 className="text-sm font-semibold text-ink-1">{r.name}</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px] leading-relaxed">
                {(['context', 'flow', 'risk', 'against'] as const).map((f) => (
                  <React.Fragment key={f}>
                    <dt className={`text-[11px] uppercase tracking-[0.08em] font-medium pt-0.5 ${f === 'against' ? 'text-warn' : 'text-ink-3'}`}>{k.recipeLabels[f]}</dt>
                    <dd className="text-ink-2">{r[f]}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
