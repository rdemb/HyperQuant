import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { tr } from '../../i18n';
import { useDesk } from '../../state/DeskContext';
import { usePaused, useRules } from './magazyn';
import { PERSONY, type Persona, type PersonaId, type PersonaState, STRAZNICY, personaOf, personaState } from './persony';
import { Postac } from './Postac';
import type { GuardEvent } from './straznicy';
import './dok.css';

/**
 * Dok załogi: pływająca wyspa z twarzami strażników (te z regułami, a bez reguł trzech polecanych, uśpionych) i Suflerem.
 * Przeciągany w dowolne miejsce ekranu (pozycja na tym urządzeniu), zwijany do jednej twarzy. Zdarzenie strażnika:
 * postać podskakuje, a nad dokiem (pod nim, gdy dok stoi u góry) wyskakuje dymek z opisem. Klik w postać otwiera jej kartę.
 */

const POS_KEY = 'hq.wyspa.dok.v1';
type Pos = { x: number; y: number; zwiniety: boolean };
const DEFAULT: Pos = { x: 0.5, y: 1, zwiniety: false };

function readPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as Partial<Pos> | null;
    if (p && typeof p.x === 'number' && typeof p.y === 'number' && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) return { x: p.x, y: p.y, zwiniety: !!p.zwiniety };
  } catch {
    // zły zapis — domyślna pozycja
  }
  // Telefon: na start zwinięty do jednej twarzy w prawym dolnym rogu (cztery postacie zasłoniłyby tekst)
  return window.innerWidth < 640 ? { x: 1, y: 1, zwiniety: true } : DEFAULT;
}
const savePos = (p: Pos) => {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    // bez zapisu pozycja wraca po przeładowaniu
  }
};

/** Polecani na start, gdy nikt nie pracuje (śpią, klik otwiera ich kartę). */
const POLECANI: PersonaId[] = ['latarnik', 'dzwonnik', 'sejsmograf'];

export interface DokStan {
  crew: { p: Persona; state: PersonaState }[];
  lead: { p: Persona; state: PersonaState };
  aktywni: number;
}

/** Skład doku i stany postaci (wspólne dla doku, przycisku nagłówka i panelu). */
export function useZaloga(flash: GuardEvent | null): DokStan {
  const rules = useRules();
  const paused = usePaused();
  const { feed, cexEnabled } = useDesk();
  const alarmIds = new Set(flash ? [flash.ruleId] : []);
  const opts = { paused, live: feed.dataStatus === 'LIVE', alarmIds, cex: cexEnabled };
  const withRules = STRAZNICY.filter((p) => rules.some((r) => p.kinds.includes(r.kind)));
  const base = withRules.length > 0 ? withRules : STRAZNICY.filter((p) => POLECANI.includes(p.id));
  const sufler = PERSONY.find((p) => p.id === 'sufler')!;
  const crew = [...base.map((p) => ({ p, state: withRules.length > 0 ? personaState(p, rules, opts) : ('spi' as const) })), { p: sufler, state: 'czuwa' as const }];
  const lead = crew.find((c) => c.state === 'alarm') ?? crew.find((c) => c.state === 'czuwa' && c.p.id !== 'sufler') ?? crew[0];
  const aktywni = paused ? 0 : rules.filter((r) => r.on).length;
  return { crew, lead, aktywni };
}

export const Dok: React.FC<{
  flash: GuardEvent | null;
  onDismissFlash: () => void;
  onOpen: (p?: PersonaId) => void;
  open: boolean;
}> = ({ flash, onDismissFlash, onOpen, open }) => {
  const { crew, lead, aktywni } = useZaloga(flash);
  const [pos, setPos] = useState<Pos>(readPos);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean; id: number } | null>(null);
  const reduce = useReducedMotion() || document.documentElement.dataset.motion === 'reduced';
  const flashPersona = flash ? personaOf(flash.kind) : null;

  // Przeciąganie za tło doku (nie za przyciski); zapis pozycji jako ułamek ekranu, żeby przetrwał zmianę rozmiaru okna
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = ref.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, id: e.pointerId };
    ref.current!.setPointerCapture(e.pointerId);
  };
  const place = useCallback((left: number, top: number, zwiniety: boolean): Pos => {
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxX = Math.max(1, window.innerWidth - w - 16);
    const maxY = Math.max(1, window.innerHeight - h - 16);
    return { x: Math.min(1, Math.max(0, (left - 8) / maxX)), y: Math.min(1, Math.max(0, (top - 8) / maxY)), zwiniety };
  }, []);
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    setPos((p) => place(e.clientX - d.dx, e.clientY - d.dy, p.zwiniety));
  };
  const onPointerUp = () => {
    if (drag.current?.moved) setPos((p) => (savePos(p), p));
    drag.current = null;
  };
  // Powiększenie jak w doku: każda postać rośnie (do 1,4×) zależnie od odległości kursora od jej środka
  const lupa = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== 'mouse' || drag.current?.moved) return;
    e.currentTarget.querySelectorAll<HTMLElement>('.hq-dok-postac').forEach((b) => {
      const r = b.getBoundingClientRect();
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      b.style.setProperty('--lupa', (1 + 0.4 * Math.max(0, 1 - d / 110)).toFixed(3));
    });
  };
  const zgasLupe = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.querySelectorAll<HTMLElement>('.hq-dok-postac').forEach((b) => b.style.removeProperty('--lupa'));
  };
  const toggle = () =>
    setPos((p) => {
      const n = { ...p, zwiniety: !p.zwiniety };
      savePos(n);
      return n;
    });

  // Pozycja w pikselach z ułamka (z miejscem na dolny pasek telefonu i nagłówek)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const phone = vp.w < 1024;
  const top0 = 120; // pod nagłówkiem i paskiem dnia
  const bottomGap = phone ? 56 + 16 : 16; // nad dolnym paskiem telefonu
  const left = 8 + pos.x * Math.max(0, vp.w - size.w - 16);
  const top = top0 + pos.y * Math.max(0, vp.h - size.h - top0 - bottomGap);
  const nearTop = pos.y < 0.4;

  return (
    <div
      ref={ref}
      data-dok
      role="toolbar"
      aria-label={tr('Załoga: strażnicy i Sufler', 'Crew: guards and the Prompter')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ left, top, touchAction: 'none' }}
      className={`fixed z-40 select-none ${open ? 'opacity-0 pointer-events-none' : ''} transition-opacity duration-150`}
    >
      <AnimatePresence>
        {flash && flashPersona && (
          <motion.div
            key={`${flash.ruleId}-${flash.at}`}
            data-wyspa-flash
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: nearTop ? -8 : 8, scale: 0.96 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={`absolute left-1/2 -translate-x-1/2 w-[min(340px,calc(100vw-24px))] ${nearTop ? 'top-full mt-3' : 'bottom-full mb-3'}`}
          >
            <div className="relative flex items-start gap-3 rounded-2xl border border-line-strong bg-surface-2/95 backdrop-blur-xl p-3 pr-10 shadow-2xl">
              <Postac id={flashPersona.id} state="alarm" size={44} />
              <button type="button" onClick={() => onOpen(flashPersona.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-lume">{flashPersona.name}</span>
                <span className="block text-[13px] leading-snug text-ink-1">{flash.text}</span>
              </button>
              <button type="button" aria-label={tr('Zamknij dymek', 'Close bubble')} onClick={onDismissFlash} className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink-1">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wyspa: szkło z linią „lume”, zwinięta do kuli z pierścieniem stanu, rozwinięta wysuwa postacie po kolei.
          Postacie rosną pod kursorem jak w doku (powiększenie liczone w onMove, tylko precyzyjny wskaźnik). */}
      <motion.div
        data-dok-launcher
        data-zwiniety={pos.zwiniety || undefined}
        layout={!reduce}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        initial={reduce ? false : { opacity: 0, y: 40, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 24, delay: reduce ? 0 : 1.2 } }}
        onPointerMove={lupa}
        onPointerLeave={zgasLupe}
        className="hq-dok flex items-end gap-1 p-1.5 cursor-grab active:cursor-grabbing"
      >
        {pos.zwiniety ? (
          <button
            type="button"
            data-dok-postac={lead.p.id}
            data-stan={lead.state}
            onClick={() => onOpen()}
            aria-label={tr(`Otwórz załogę (${lead.p.name})`, `Open the crew (${lead.p.name})`)}
            className="hq-dok-kula relative rounded-full p-1 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true" className="hq-dok-pierscien" />
            <Postac id={lead.p.id} state={lead.state} size={44} />
            {aktywni > 0 && <span aria-hidden="true" className="hq-dok-licznik">{aktywni}</span>}
          </button>
        ) : (
          <>
            <AnimatePresence initial={false}>
              {crew.map(({ p, state }, i) => (
                <motion.button
                  key={p.id}
                  type="button"
                  data-dok-postac={p.id}
                  data-stan={state}
                  onClick={() => onOpen(p.id)}
                  aria-label={tr(`${p.name}: ${state === 'spi' ? 'śpi' : state === 'alarm' ? 'zdarzenie' : 'czuwa'}`, `${p.name}: ${state === 'spi' ? 'asleep' : state === 'alarm' ? 'event' : 'watching'}`)}
                  initial={reduce ? false : { opacity: 0, x: -18, scale: 0.6 }}
                  animate={{ opacity: 1, x: 0, scale: 1, transition: { type: 'spring', stiffness: 520, damping: 26, delay: reduce ? 0 : i * 0.05 } }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
                  className="hq-dok-postac group relative rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="hq-dok-lupa block">
                    <Postac id={p.id} state={state} size={44} />
                  </span>
                  <span aria-hidden="true" className="hq-dok-stan" />
                  <span aria-hidden="true" className="hq-dok-podpis">
                    <b>{p.name}</b>
                    <i>{state === 'spi' ? tr('śpi', 'asleep') : state === 'alarm' ? tr('zdarzenie', 'event') : tr('czuwa', 'watching')}</i>
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
            <span aria-hidden="true" className="mx-0.5 mb-2 h-8 w-px bg-line" />
            <button type="button" onClick={() => onOpen()} aria-label={tr('Dodaj strażnika', 'Add a guard')} className="hq-dok-plus mb-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:text-ink-1">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
        <button type="button" onClick={toggle} aria-label={pos.zwiniety ? tr('Rozwiń dok', 'Expand the dock') : tr('Zwiń dok', 'Collapse the dock')} className="mb-2 inline-flex h-8 w-6 items-center justify-center rounded-full text-ink-3 hover:text-ink-1">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${pos.zwiniety ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </motion.div>
    </div>
  );
};
