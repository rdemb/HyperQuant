import React, { useEffect, useState } from 'react';
import { en } from '../lessons/content/en';
import { pl } from '../lessons/content/pl';
import { tr } from '../i18n';
import { EXERCISES } from '../lessons/exercises';
import { loadProgress, saveResult, type Progress } from '../lessons/progress';
import { Segmented } from '../ui';
import { Atlas } from './lessons/Atlas';
import { Combine } from './lessons/Combine';
import { ExerciseList, ExercisePlayer } from './lessons/Exercises';
import { Myths } from './lessons/Myths';
import { RiskLab } from './lessons/RiskLab';

/** Treść w języku interfejsu (język jest stały przez cały czas życia strony). */
const CONTENT = tr(pl, en);

type Tab = 'exercises' | 'atlas' | 'combine' | 'myths' | 'risk';
const TABS: Tab[] = ['exercises', 'atlas', 'combine', 'myths', 'risk'];

interface Route {
  tab: Tab;
  /** Otwarte ćwiczenie albo hasło atlasu. */
  id: string | null;
}

/** Stan zakładki z adresu: #lessons?tab=atlas&id=vwap albo #lessons?ex=ny-breakout (linki z bloga i między lekcjami). */
function readRoute(): Route {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const ex = q.get('ex');
  if (ex && EXERCISES.some((e) => e.id === ex)) return { tab: 'exercises', id: ex };
  const tab = TABS.find((t) => t === q.get('tab')) ?? 'exercises';
  const id = q.get('id');
  return { tab, id: tab === 'atlas' && id && CONTENT.atlas.entries.some((e) => e.id === id) ? id : null };
}

function writeRoute(r: Route): void {
  const q = r.tab === 'exercises' ? (r.id ? `ex=${r.id}` : '') : `tab=${r.tab}${r.id ? `&id=${r.id}` : ''}`;
  const hash = `#lessons${q ? `?${q}` : ''}`;
  if (window.location.hash !== hash) history.replaceState(null, '', hash);
}

/**
 * Lekcje: ćwiczenia na prawdziwych wycinkach rynku, atlas wskaźników z Wykresów, zasady łączenia, mity zestawione
 * z danymi desku i symulator serii transakcji. Bez sygnałów i obietnic wyniku; postęp tylko w tej przeglądarce.
 */
const LessonsView: React.FC = () => {
  const c = CONTENT;
  const [route, setRoute] = useState<Route>(readRoute);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  useEffect(() => writeRoute(route), [route]);
  // Link do lekcji otwarty, gdy zakładka już jest na ekranie
  useEffect(() => {
    const onHash = () => window.location.hash.startsWith('#lessons') && setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (r: Route) => {
    setRoute(r);
    window.scrollTo({ top: 0 });
  };
  const spec = route.tab === 'exercises' && route.id ? EXERCISES.find((e) => e.id === route.id) : undefined;
  const done = EXERCISES.filter((e) => progress[e.id]).length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 p-4 sm:p-6 rounded-xl border border-line-strong bg-surface-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{c.ui.eyebrow}</div>
          <div className="text-xs text-ink-3 font-mono tabular-nums">{c.ui.progress(done, EXERCISES.length)}</div>
        </div>
        <h1 className="font-display text-[26px] sm:text-[28px] leading-tight font-bold tracking-tight">{c.ui.title}</h1>
        {!spec && <p className="text-sm sm:text-base text-ink-2 leading-relaxed max-w-3xl">{c.ui.lead}</p>}
        {/* Na telefonie pięć sekcji nie mieści się w jednym wierszu — zawijamy, żeby żadna nie chowała się za krawędzią */}
        <div className="pt-1">
          <Segmented<Tab>
            ariaLabel={c.ui.title}
            size="md"
            wrap
            value={route.tab}
            onChange={(tab) => go({ tab, id: null })}
            options={TABS.map((t) => ({ value: t, label: c.ui.tabs[t] }))}
          />
        </div>
      </header>

      {route.tab === 'exercises' &&
        (spec ? (
          <ExercisePlayer
            key={spec.id}
            spec={spec}
            c={c}
            onFinish={(score, max) => setProgress((p) => saveResult(p, spec.id, score, max))}
            onBack={() => go({ tab: 'exercises', id: null })}
            onAtlas={(id) => go({ tab: 'atlas', id })}
          />
        ) : (
          <ExerciseList c={c} progress={progress} onOpen={(id) => go({ tab: 'exercises', id })} />
        ))}
      {route.tab === 'atlas' && <Atlas c={c} open={route.id} onOpen={(id) => setRoute({ tab: 'atlas', id })} />}
      {route.tab === 'combine' && <Combine c={c} />}
      {route.tab === 'myths' && <Myths c={c} />}
      {route.tab === 'risk' && <RiskLab c={c} />}
    </div>
  );
};

export default LessonsView;
