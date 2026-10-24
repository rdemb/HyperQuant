import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge, Panel } from '../../ui';
import type { SceneMeta } from './scenes';
import { tr } from '../../i18n';

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium font-sans">{children}</h3>
);

/** Panel opisu sceny: co widać, jak czytać, źródło danych, ograniczenia. Na telefonie zwijany (poza „Co widzisz”). */
export const SceneInfo: React.FC<{ scene: SceneMeta }> = ({ scene }) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <Panel
      eyebrow={tr('Opis sceny', 'Scene description')}
      title={scene.label}
      actions={
        <>
          {scene.sources.map((s) => (
            <Badge key={s.label} tone={s.tone} title={s.tone === 'live' ? tr('Realne dane Hyperliquid', 'Real Hyperliquid data') : tr('Wynik modelu — nie dane rynkowe', 'Model output, not market data')}>
              {s.label}
            </Badge>
          ))}
        </>
      }
      className="h-full"
      bodyClassName="p-4 flex flex-col gap-4"
    >
      <section className="flex flex-col gap-1">
        <Eyebrow>{tr('Co widzisz', 'What you see')}</Eyebrow>
        <p className="text-[13px] text-ink-2 leading-relaxed">{scene.what}</p>
      </section>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="lg:hidden inline-flex items-center justify-between gap-2 min-h-11 px-3 rounded-lg border border-line bg-surface-2 text-sm text-ink-1"
      >
        {open ? tr('Zwiń szczegóły', 'Hide details') : tr('Jak czytać, źródło i ograniczenia', 'How to read, source and limits')}
        <ChevronDown className={`w-4 h-4 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      <div id={bodyId} className={`${open ? 'flex' : 'hidden'} lg:flex flex-col gap-4`}>
        <section className="flex flex-col gap-1.5">
          <Eyebrow>{tr('Jak czytać', 'How to read')}</Eyebrow>
          <ol className="flex flex-col gap-1.5 text-[13px] text-ink-2 leading-relaxed">
            {scene.how.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-ink-3 shrink-0">{i + 1}.</span>
                <span>{h}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-1.5">
          <Eyebrow>{tr('Źródło danych', 'Data source')}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {scene.sources.map((s) => (
              <Badge key={s.label} tone={s.tone}>
                {s.label}
              </Badge>
            ))}
          </div>
          <p className="text-[13px] text-ink-2 leading-relaxed">{scene.method}</p>
        </section>

        <section className="flex flex-col gap-1.5">
          <Eyebrow>{tr('Ograniczenia', 'Limits')}</Eyebrow>
          <ul className="flex flex-col gap-1 text-[13px] text-ink-3 leading-relaxed list-disc pl-4 marker:text-ink-3">
            {scene.limits.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      </div>
    </Panel>
  );
};
