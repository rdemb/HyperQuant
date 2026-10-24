import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, ChartCandlestick, Check, Eye, RotateCcw } from 'lucide-react';
import { saveStation, stationById } from '../../charts/pro/chart/stations';
import type { ChartZone } from '../../lessons/chart/LessonChart';
import { MIN } from '../../lessons/chart/model';
import type { ExerciseText, LessonsContent, QuestionText } from '../../lessons/content/types';
import type { LessonSlice } from '../../lessons/data';
import { EXERCISES, maxScore, pickSide, scoreAnswer, type ExerciseSpec, type QuestionSpec } from '../../lessons/exercises';
import type { Progress } from '../../lessons/progress';
import { useDesk } from '../../state/DeskContext';
import { useFolkloreLab } from '../../state/useFolkloreLab';
import { Badge, Panel } from '../../ui';
import { LAB_TEXT } from '../../utils/folkloreLab';
import { Figure, FigureStatus, useSlice } from './Figure';
import { BTN_LINK, BTN_PRIMARY, BTN_SECONDARY, fmtPct, fmtPp, fmtUsd } from './format';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const VERDICT_CLS: Record<0 | 1 | 2, string> = { 0: 'text-sell-ink', 1: 'text-warn', 2: 'text-buy-ink' };
const key = (cp: number, q: number) => `${cp}.${q}`;

/** Lista ćwiczeń z poziomem i najlepszą oceną. */
export const ExerciseList: React.FC<{ c: LessonsContent; progress: Progress; onOpen: (id: string) => void }> = ({ c, progress, onOpen }) => (
  <div className="flex flex-col gap-3">
    <p className="text-sm text-ink-2 max-w-prose">{c.ui.exercisesIntro}</p>
    <ul className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
      {EXERCISES.map((e, i) => {
        const t = c.exercises[e.id];
        const best = progress[e.id];
        return (
          <li key={e.id} className="flex">
            <button
              type="button"
              onClick={() => onOpen(e.id)}
              className="group flex-1 flex flex-col gap-2 p-4 rounded-xl border border-line bg-surface-1 text-left hover:bg-surface-2 hover:border-line-strong transition-colors duration-150"
            >
              <span className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
                <span className="font-mono">
                  {String(i + 1).padStart(2, '0')} · {t.when}
                </span>
                <Badge tone={e.level === 3 ? 'warn' : e.level === 2 ? 'model' : 'neutral'}>{c.ui.level(e.level)}</Badge>
              </span>
              <span className="font-display text-[15px] font-semibold text-ink-1 leading-snug">{t.title}</span>
              <span className="text-[13px] text-ink-2 leading-relaxed flex-1">{t.tagline}</span>
              <span className="flex items-center justify-between gap-2 pt-1 text-xs">
                {best ? (
                  <span className="inline-flex items-center gap-1 text-buy-ink">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    {c.ui.score(best.score, best.max)}
                  </span>
                ) : (
                  <span className="text-ink-3">{c.ui.start}</span>
                )}
                <ArrowRight className="w-4 h-4 text-ink-3 group-hover:text-ink-1 transition-colors" aria-hidden="true" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  </div>
);

type Phase = 'ask' | 'reveal' | 'done';

/** Ostatnie zamknięcie świecy przed chwilą `at` (cena odniesienia przy ocenie wskazanego poziomu). */
function closeAt(slice: LessonSlice, at: number): number {
  const tf = slice.tf * MIN;
  let px = slice.candles[0][4];
  for (const c of slice.candles) {
    if (c[0] + tf > at) break;
    px = c[4];
  }
  return px;
}

/**
 * Odtwarzacz ćwiczenia: rycina zatrzymana w punkcie kontrolnym, pytania po kolei, ocena z omówieniem, potem
 * odsłonięcie dalszego ciągu (kursor przesuwa się świeca po świecy) i na końcu omówienie z danymi desku.
 */
export const ExercisePlayer: React.FC<{
  spec: ExerciseSpec;
  c: LessonsContent;
  onFinish: (score: number, max: number) => void;
  onBack: () => void;
  onAtlas: (id: string) => void;
}> = ({ spec, c, onFinish, onBack, onAtlas }) => {
  const t = c.exercises[spec.id];
  const { slice, failed } = useSlice(spec.slice);
  const reduce = useReducedMotion();
  const start = Date.parse(spec.checkpoints[0].at);
  const [cp, setCp] = useState(0);
  const [phase, setPhase] = useState<Phase>('ask');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState(start);
  const [animating, setAnimating] = useState(false);
  const raf = useRef(0);
  const side = useRef<HTMLDivElement>(null);
  const chart = useRef<HTMLDivElement>(null);
  const told = useRef<HTMLElement>(null);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const n = spec.checkpoints.length;
  const ck = spec.checkpoints[cp];
  const ckText = t.checkpoints[cp];
  const current = ck.questions.findIndex((_, qi) => !checked[key(cp, qi)]);
  const allChecked = current === -1;
  const score = Object.keys(checked).reduce((s, k) => {
    const [ci, qi] = k.split('.').map(Number);
    return s + scoreAnswer(spec.checkpoints[ci].questions[qi], answers[k]);
  }, 0);
  const max = maxScore(spec);
  const end = slice?.to ?? start;
  const atEnd = phase === 'done' || (cp === n - 1 && phase === 'reveal' && !animating);

  const marks = useMemo(() => [...spec.checkpoints.flatMap((x) => x.marks ?? []), ...(spec.endMarks ?? [])], [spec]);
  const zones = useMemo(() => {
    const out: ChartZone[] = [];
    let li = 0;
    spec.checkpoints.forEach((x, ci) => {
      const shown = phase === 'done' || ci < cp || (ci === cp && allChecked);
      for (const z of x.answerZones ?? []) {
        const label = t.zoneLabels?.[li++];
        if (shown) out.push({ ...z, label });
      }
    });
    for (const z of spec.endZones ?? []) {
      const label = t.zoneLabels?.[li++];
      if (atEnd) out.push({ ...z, label });
    }
    return out;
  }, [spec, t, phase, cp, allChecked, atEnd]);

  // Wskazanie ceny: pytanie bieżącego punktu (aktywne do sprawdzenia, potem pokazuje odpowiedź)
  const pq = ck.questions.findIndex((q) => q.kind === 'pick');
  const pqSpec = pq >= 0 ? (ck.questions[pq] as Extract<QuestionSpec, { kind: 'pick' }>) : null;
  const pickKey = key(cp, pq);
  const pick =
    pqSpec && phase !== 'done' && (allChecked || pq <= current)
      ? {
          value: answers[pickKey] ?? null,
          step: pqSpec.step,
          onPick: checked[pickKey] || phase !== 'ask' ? undefined : (px: number) => setAnswers((a) => ({ ...a, [pickKey]: px })),
        }
      : null;

  // Po odsłonięciu opis dalszego ciągu wjeżdża w widok
  const revealed = phase === 'reveal' && !animating;
  useEffect(() => {
    if (revealed) told.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [revealed, reduce]);

  const reveal = () => {
    const to = cp + 1 < n ? Date.parse(spec.checkpoints[cp + 1].at) : end;
    setPhase('reveal');
    // Bez przyklejonej ryciny (telefon, tablet) przewijamy do niej, żeby było widać odsłanianie
    if (!window.matchMedia('(min-width: 1280px)').matches) chart.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    if (reduce || !slice) {
      setCursor(to);
      return;
    }
    const from = cursor;
    const dur = Math.min(4000, Math.max(1200, ((to - from) / (slice.tf * MIN)) * 45));
    const t0 = performance.now();
    setAnimating(true);
    const tick = (now: number) => {
      const f = Math.min(1, (now - t0) / dur);
      setCursor(from + (to - from) * f);
      if (f < 1) raf.current = requestAnimationFrame(tick);
      else setAnimating(false);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const next = () => {
    if (cp + 1 < n) {
      setCp(cp + 1);
      setPhase('ask');
      setCursor(Date.parse(spec.checkpoints[cp + 1].at));
    } else {
      setPhase('done');
      setCursor(end);
      onFinish(score, max);
    }
    side.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };

  const restart = () => {
    cancelAnimationFrame(raf.current);
    setAnimating(false);
    setCp(0);
    setPhase('ask');
    setAnswers({});
    setChecked({});
    setCursor(start);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} className={BTN_LINK}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {c.ui.back}
        </button>
        <span className="text-xs text-ink-3 font-mono tabular-nums">{c.ui.score(score, max)}</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div ref={chart} className="xl:col-span-8 xl:sticky xl:top-24 scroll-mt-32 min-w-0">
        <Panel
          eyebrow={`${t.when} · ${c.tzLabel}`}
          title={<span className="whitespace-normal">{t.title}</span>}
          actions={<Badge tone={spec.level === 3 ? 'warn' : spec.level === 2 ? 'model' : 'neutral'}>{c.ui.level(spec.level)}</Badge>}
          bodyClassName="p-3 sm:p-4"
        >
          {slice ? (
            <Figure slice={slice} view={spec.view} layers={spec.layers} cursor={cursor} marks={marks} zones={zones} pick={pick} c={c} label={t.title} />
          ) : (
            <FigureStatus failed={failed} c={c} />
          )}
        </Panel>
        </div>

        <div ref={side} className="xl:col-span-4 flex flex-col gap-3 min-w-0 scroll-mt-32">
          {phase === 'done' ? (
            <Debrief spec={spec} t={t} c={c} score={score} max={max} onAgain={restart} onBack={onBack} onAtlas={onAtlas} />
          ) : (
            <>
              {cp === 0 && <p className="text-sm text-ink-2 leading-relaxed">{t.intro}</p>}
              <section className="flex flex-col gap-3 p-4 rounded-xl border border-line-strong bg-surface-1">
                <div className="text-[11px] uppercase tracking-[0.08em] text-accent font-medium">{c.ui.checkpoint(cp + 1, n)}</div>
                <p className="text-sm text-ink-1 leading-relaxed">{ckText.context}</p>
              </section>
              {ck.questions.map((q, qi) =>
                allChecked || qi <= current ? (
                  <QuestionCard
                    key={key(cp, qi)}
                    q={q}
                    qt={ckText.questions[qi]}
                    c={c}
                    label={ck.questions.length > 1 ? c.ui.question(qi + 1, ck.questions.length) : null}
                    answer={answers[key(cp, qi)] ?? null}
                    checked={!!checked[key(cp, qi)]}
                    price={slice ? closeAt(slice, Date.parse(ck.at)) : 0}
                    onAnswer={(v) => setAnswers((a) => ({ ...a, [key(cp, qi)]: v }))}
                    onCheck={() => setChecked((x) => ({ ...x, [key(cp, qi)]: true }))}
                  />
                ) : null
              )}
              {allChecked && phase === 'ask' && (
                <button type="button" onClick={reveal} disabled={!slice} className={`${BTN_PRIMARY} self-start`}>
                  <Eye className="w-4 h-4" aria-hidden="true" />
                  {cp + 1 < n ? c.ui.reveal : c.ui.revealEnd}
                </button>
              )}
              {revealed && (
                <>
                  <section ref={told} className="flex flex-col gap-2 p-4 rounded-xl border border-accent/40 bg-accent/5 scroll-mb-24" aria-live="polite">
                    <p className="text-sm text-ink-1 leading-relaxed">{ckText.reveal}</p>
                  </section>
                  <button type="button" onClick={next} className={`${BTN_PRIMARY} self-start`}>
                    {cp + 1 < n ? c.ui.next : c.ui.finish}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed max-w-prose">{c.ui.dataNote}</p>
    </div>
  );
};

/** Pytanie: wybór odpowiedzi albo wskazanie ceny; po sprawdzeniu ocena i omówienie. */
const QuestionCard: React.FC<{
  q: QuestionSpec;
  qt: QuestionText;
  c: LessonsContent;
  label: string | null;
  answer: number | null;
  checked: boolean;
  price: number;
  onAnswer: (v: number) => void;
  onCheck: () => void;
}> = ({ q, qt, c, label, answer, checked, price, onAnswer, onCheck }) => {
  const s = checked && answer !== null ? scoreAnswer(q, answer) : null;
  return (
    <section className="flex flex-col gap-3 p-4 rounded-xl border border-line bg-surface-1">
      {label && <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{label}</div>}
      <h3 className="text-sm font-semibold text-ink-1 leading-snug">{qt.prompt}</h3>

      {q.kind === 'choice' && qt.options && (
        <div role="radiogroup" aria-label={qt.prompt} className="flex flex-col gap-1.5">
          {qt.options.map((o, i) => {
            const chosen = answer === i;
            const good = checked && i === q.correct;
            const cls = good
              ? 'border-buy/60 bg-buy/10'
              : checked && chosen
                ? 'border-sell/50 bg-sell/10'
                : chosen
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-line hover:border-line-strong hover:bg-surface-2';
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={checked}
                onClick={() => onAnswer(i)}
                className={`flex gap-2.5 items-start text-left px-3 py-2.5 rounded-lg border text-[13px] leading-relaxed text-ink-1 transition-colors duration-150 disabled:cursor-default ${cls}`}
              >
                <span className="shrink-0 font-mono text-[11px] text-ink-3 pt-0.5">{LETTERS[i]}</span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {q.kind === 'pick' && qt.pick && (
        <PickInput q={q} c={c} hint={qt.pick.hint} answer={answer} disabled={checked} onAnswer={onAnswer} />
      )}

      {!checked && (
        <button type="button" onClick={onCheck} disabled={answer === null} className={`${BTN_SECONDARY} self-start`}>
          <Check className="w-4 h-4" aria-hidden="true" />
          {c.ui.check}
        </button>
      )}

      {s !== null && answer !== null && (
        <div className="flex flex-col gap-2 pt-1 border-t border-line" aria-live="polite">
          <div className={`pt-2 text-xs font-semibold ${VERDICT_CLS[s]}`}>{c.ui.verdict[s]}</div>
          {q.kind === 'choice' && qt.options && (
            <>
              <p className="text-[13px] text-ink-2 leading-relaxed">{qt.options[answer].feedback}</p>
              {answer !== q.correct && (
                <p className="text-[13px] text-ink-2 leading-relaxed">
                  <span className="font-semibold text-ink-1">
                    {c.ui.best} ({LETTERS[q.correct]}):{' '}
                  </span>
                  {qt.options[q.correct].feedback}
                </p>
              )}
            </>
          )}
          {q.kind === 'pick' && qt.pick && <p className="text-[13px] text-ink-2 leading-relaxed">{qt.pick[pickSide(q, answer, price)]}</p>}
        </div>
      )}
    </section>
  );
};

/** Wskazanie ceny: z ryciny albo z klawiatury (pole i przyciski kroku). */
const PickInput: React.FC<{
  q: Extract<QuestionSpec, { kind: 'pick' }>;
  c: LessonsContent;
  hint: string;
  answer: number | null;
  disabled: boolean;
  onAnswer: (v: number) => void;
}> = ({ q, c, hint, answer, disabled, onAnswer }) => {
  const [draft, setDraft] = useState<string>(answer === null ? '' : String(answer));
  useEffect(() => setDraft(answer === null ? '' : String(answer)), [answer]);
  const nudge = (d: number) => answer !== null && onAnswer(answer + d);
  const stepBtn = `${BTN_SECONDARY} !px-2.5 font-mono`;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-ink-2 leading-relaxed">
        {hint} <span className="text-ink-3">{c.ui.pickPrompt}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" className={stepBtn} disabled={disabled || answer === null} onClick={() => nudge(-q.step)} aria-label={`${c.ui.pickInput} −${q.step}`}>
          −
        </button>
        <label className="flex-1 min-w-0">
          <span className="sr-only">{c.ui.pickInput}</span>
          <input
            type="number"
            inputMode="numeric"
            step={q.step}
            value={draft}
            disabled={disabled}
            placeholder={c.ui.pickNone}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const v = Number(draft);
              if (draft !== '' && Number.isFinite(v) && v > 0) onAnswer(Math.round(v / q.step) * q.step);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full h-11 sm:h-9 px-3 rounded-md bg-page border border-line-strong text-sm font-mono tabular-nums text-ink-1 placeholder:text-ink-3 placeholder:font-sans disabled:opacity-70"
          />
        </label>
        <button type="button" className={stepBtn} disabled={disabled || answer === null} onClick={() => nudge(q.step)} aria-label={`${c.ui.pickInput} +${q.step}`}>
          +
        </button>
      </div>
      {answer !== null && (
        <div className="text-xs text-ink-3">
          {c.ui.yourAnswer}: <span className="font-mono text-accent">{fmtUsd(answer, c.locale)} USD</span>
        </div>
      )}
    </div>
  );
};

/** Omówienie: ocena, wnioski, uczciwa uwaga, wynik reguły w danych desku, ćwiczenie na żywo i hasła atlasu. */
const Debrief: React.FC<{
  spec: ExerciseSpec;
  t: ExerciseText;
  c: LessonsContent;
  score: number;
  max: number;
  onAgain: () => void;
  onBack: () => void;
  onAtlas: (id: string) => void;
}> = ({ spec, t, c, score, max, onAgain, onBack, onAtlas }) => {
  const { setView } = useDesk();
  const station = stationById(spec.station);
  const names = new Map(c.atlas.entries.map((e) => [e.id, e.name]));
  return (
    <>
      <section className="flex flex-col gap-2 p-4 rounded-xl border border-line-strong bg-surface-1" aria-live="polite">
        <div className="font-display text-lg font-semibold text-ink-1">{c.ui.score(score, max)}</div>
        <p className="text-xs text-ink-3 leading-relaxed">{c.ui.scoreNote}</p>
      </section>
      <section className="flex flex-col gap-2.5 p-4 rounded-xl border border-line bg-surface-1">
        <h3 className="text-sm font-semibold text-ink-1">{c.ui.debrief}</h3>
        <ul className="flex flex-col gap-2">
          {t.debrief.points.map((p) => (
            <li key={p} className="flex gap-2 text-[13px] text-ink-2 leading-relaxed">
              <span className="shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2 p-4 rounded-xl border border-warn/30 bg-warn/5">
        <h3 className="text-sm font-semibold text-warn">{c.ui.honest}</h3>
        <p className="text-[13px] text-ink-2 leading-relaxed">{t.debrief.honest}</p>
        {spec.lab && <LabResult id={spec.lab} c={c} />}
      </section>
      <section className="flex flex-col gap-3 p-4 rounded-xl border border-line bg-surface-1">
        <h3 className="text-sm font-semibold text-ink-1">{c.ui.practice}</h3>
        <button
          type="button"
          className={`${BTN_PRIMARY} self-start`}
          onClick={() => {
            saveStation(station.id);
            setView('charts');
            window.scrollTo({ top: 0 });
          }}
        >
          <ChartCandlestick className="w-4 h-4" aria-hidden="true" />
          {c.ui.openStation(station.name)}
        </button>
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-ink-3">{c.ui.atlasLinks}</div>
          <div className="flex flex-wrap gap-1.5">
            {spec.atlas.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onAtlas(id)}
                className="px-2.5 py-1 rounded-md border border-line bg-page text-xs text-ink-1 hover:border-line-strong hover:bg-surface-2"
              >
                {names.get(id) ?? id}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAgain} className={BTN_SECONDARY}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          {c.ui.again}
        </button>
        <button type="button" onClick={onBack} className={BTN_SECONDARY}>
          {c.ui.back}
        </button>
      </div>
    </>
  );
};

/** Wynik reguły z Laboratorium folkloru desku (historia BTC): sukces wobec ceny błądzącej losowo. */
export const LabResult: React.FC<{ id: string; c: LessonsContent }> = ({ id, c }) => {
  const { setView } = useDesk();
  const { status, report } = useFolkloreLab();
  const h = report?.hypotheses.find((x) => x.id === id);
  const name = LAB_TEXT[id]?.name ?? id;
  return (
    <div className="flex flex-col gap-1.5 mt-1 pt-3 border-t border-line">
      <div className="text-xs font-semibold text-ink-1">
        {c.ui.labTitle}: <span className="text-ink-2 font-normal">„{name}”</span>
      </div>
      {status === 'loading' ? (
        <p className="text-xs text-ink-3">{c.ui.labLoading}</p>
      ) : !h ? (
        <p className="text-xs text-ink-3">{c.ui.labUnavailable}</p>
      ) : (
        <>
          <p className="text-[13px] text-ink-2 leading-relaxed">
            {c.ui.labLine(fmtPct(h.hist.rate, c.locale), fmtPct(h.hist.p0, c.locale), h.hist.n)} {c.ui.labEffect(fmtPp(h.hist.effect, c.locale))}
          </p>
          <p className="text-[13px] text-ink-1 leading-relaxed">{c.ui.labVerdict[h.hist.verdict]}</p>
        </>
      )}
      <button
        type="button"
        onClick={() => {
          setView('plan');
          window.scrollTo({ top: 0 });
        }}
        className={`${BTN_LINK} self-start text-xs`}
      >
        {c.ui.labOpen}
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
