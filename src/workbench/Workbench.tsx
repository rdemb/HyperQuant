import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowDown, ArrowUp, GripVertical, Maximize2, Pin, Plus, Settings2, X } from 'lucide-react';
import { motion, MotionConfig } from 'motion/react';
import { lang, tr } from '../i18n';
import { setTheme, useTheme } from '../theme';
import { LocalBoundary } from '../ui/LocalBoundary';
import {
  exportWorkspaceComposition, importWorkspaceComposition, loadWorkspaceComposition, saveWorkspaceCompositionLocked,
  type WorkspaceCard, type WorkspacePanelKind,
} from '../state/workspaceComposition';
import { ORDER_FLOW_MARKETS } from '../views/flow/orderFlowDesk';
import {
  assignPanel, fromPreset, isPreset, kinds, labels, makeId, makePanel, presets,
  readEntries, readStorage, rememberActive, removePanels, reorder, spanOf,
  type Entry, type Preset, type WorkspaceComposition,
} from './composition';
import { AFTER_B, BEFORE_B, consumeReturn, PanelContent, type Panel } from './Panels';

const initial = readEntries();
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const reducedSnapshot = () => motionPreference.matches || document.documentElement.dataset.motion === 'reduced';
function subscribeMotionPreference(notify: () => void) {
  motionPreference.addEventListener('change', notify);
  return () => motionPreference.removeEventListener('change', notify);
}
const cardAnchor = (id: string) => `wb-card-${id}`;
const panelAnchor = (id: string) => `wb-panel-${id}`;
const iconSize = 17;
const media = (name: string) => `../workbench-media/${name}`;
const presetsList = Object.keys(presets) as Preset[];
const lab = tr('Stanowisko', 'Workbench');

/**
 * Moment „zapisano”: linia wody przebiega po górnej krawędzi tablicy, a szklany znacznik z rysowanym ptaszkiem podaje
 * rewizję. Czysto dekoracyjny (aria-hidden); komunikat dla czytnika podaje już say(). Ograniczony ruch: bez efektu.
 */
function celebrateSave(root: HTMLElement | null, revision: number) {
  if (!root || ruchOgraniczony()) return;
  root.querySelector('.wb-zapis')?.remove();
  const el = document.createElement('div');
  el.className = 'wb-zapis';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<i class="wb-zapis-linia"></i><span class="wb-zapis-chip"><svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5"/></svg>${tr('Zapisano', 'Saved')} · r${revision}</span>`;
  root.append(el);
  window.setTimeout(() => el.remove(), 2600);
}

/** Element pod wskaźnikiem z pominięciem uniesionej karty, która podąża za kursorem. */
function hitBelow(x: number, y: number, lifted: HTMLElement | null): Element | null {
  return document.elementsFromPoint(x, y).find(el => !lifted || !lifted.contains(el)) ?? null;
}

/** Ograniczony ruch: ustawienie systemu albo wybór „ograniczony” w HyperQuant. */
function ruchOgraniczony(): boolean {
  return document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Pozycje kart i paneli przed zmianą układu (klucz: trwałe ID). */
function snapshotBoard(root: HTMLElement | null): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  root?.querySelectorAll<HTMLElement>('[data-wb-card],[data-wb-panel]').forEach(el => out.set(el.dataset.wbPanel ?? el.dataset.wbCard ?? '', el.getBoundingClientRect()));
  return out;
}

/** Po zmianie układu każdy przesunięty element dojeżdża na nowe miejsce ze sprężystym dociągnięciem. */
function settleBoard(root: HTMLElement | null, before: Map<string, DOMRect>) {
  root?.querySelectorAll<HTMLElement>('[data-wb-card],[data-wb-panel]').forEach(el => {
    const prev = before.get(el.dataset.wbPanel ?? el.dataset.wbCard ?? '');
    if (!prev || !el.animate) return;
    const now = el.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.34, 1.4, .64, 1)' });
  });
}

export default function Workbench() {
  const [slots, setSlots] = useState<Record<string, Entry>>(initial.slots);
  const [active, setActive] = useState(initial.active);
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, say] = useState('');
  const [busy, setBusy] = useState(false);
  const [io, setIo] = useState('');
  const [film, setFilm] = useState(false);
  const light = useTheme() === 'light';
  const reduced = useSyncExternalStore(subscribeMotionPreference, reducedSnapshot);
  const board = useRef<HTMLDivElement>(null);
  const transfer = useRef<HTMLDetailsElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const filmBox = useRef<HTMLElement>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [panelDrop, setPanelDrop] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [size, setSize] = useState<{ id: string; span: number } | null>(null);
  const [undo, setUndo] = useState<{ slot: string; draft: WorkspaceComposition } | null>(null);
  const entry = slots[active];
  const draft = entry.draft;
  const activeCard = draft.cards.find(card => selectedPanel && card.panels.includes(selectedPanel))?.id ?? selected;
  const panels = new Map(draft.panels.map(panel => [panel.id, panel]));
  const chartMarket = selectedPanel ? panels.get(selectedPanel)?.market : undefined;
  const focus = (id: string | null) => requestAnimationFrame(() => {
    if (!id) return;
    const el = document.getElementById(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });

  useEffect(() => {
    const returning = consumeReturn();
    if (!returning || !initial.slots[returning.slot]?.draft.panels.some(panel => panel.id === returning.panelId)) return;
    setActive(returning.slot);
    setSelectedPanel(returning.panelId);
    focus(panelAnchor(returning.panelId));
  }, []);
  useEffect(() => { rememberActive(active); }, [active]);
  useEffect(() => {
    if (reduced && film) {
      setFilm(false);
      filmBox.current?.focus({ preventScroll: true });
    }
  }, [reduced, film]);
  useEffect(() => { if (film) video.current?.focus({ preventScroll: true }); }, [film]);

  function change(apply: (previous: WorkspaceComposition) => WorkspaceComposition) {
    setUndo(null);
    setSlots(old => ({ ...old, [active]: { ...old[active], draft: apply(old[active].draft), dirty: true } }));
  }
  const cardName = (card: WorkspaceCard) => card.panels.map(id => labels[panels.get(id)!.kind]).join(' / ');
  const groupMarket = (panel: Panel, targetId: string) => {
    if (!targetId) { changePanel(panel.id, { marketGroup: null }); return; }
    const target = panels.get(targetId);
    if (!target || target.kind !== 'flow') return;
    const group = target.marketGroup ?? makeId('market');
    change(old => ({ ...old, panels: old.panels.map(p => p.id === panel.id
      ? { ...p, marketGroup: group, market: target.market }
      : p.id === target.id ? { ...p, marketGroup: group } : p) }));
  };
  const groupClock = (panel: Panel, targetId: string) => {
    if (panel.clock.kind !== 'replay') return;
    if (!targetId) { changePanel(panel.id, { clock: { ...panel.clock, group: null } }); return; }
    const target = panels.get(targetId);
    if (!target || target.clock.kind !== 'replay' || target.clock.analysisId !== panel.clock.analysisId) return;
    const clock = { ...target.clock, group: target.clock.group ?? makeId('clock') };
    change(old => ({ ...old, panels: old.panels.map(p => p.id === panel.id || p.id === target.id ? { ...p, clock } : p) }));
  };
  const dismiss = () => { say(''); setIo(''); setSelected(null); setSelectedPanel(null); };
  const openSlot = (slot: string) => { dismiss(); setActive(slot); };
  const insertSlot = (snapshot: WorkspaceComposition, slot: string) => {
    setSlots(old => ({ ...old, [slot]: { draft: { ...snapshot, id: slot, revision: 0 }, expected: null, dirty: true } }));
    openSlot(slot);
  };
  const template = (key: Preset) => {
    const slot = makeId('desk');
    insertSlot(fromPreset(key, slot), slot);
    say(tr('Utworzono kopię szablonu.', 'Template copied.'));
  };
  const add = (kind: WorkspacePanelKind) => {
    if (draft.panels.length >= 24) return;
    const panel = makePanel(kind);
    const card: WorkspaceCard = { id: makeId('card'), kind: 'card', panels: [panel.id], weight: kind === 'flow' || kind === 'archive' ? 12 : 6 };
    change(old => ({ ...old, cards: [...old.cards, card], panels: [...old.panels, panel], leader: old.leader ?? panel.id }));
    say(tr(`Dodano: ${labels[kind]}.`, `Added: ${labels[kind]}.`));
    setSelectedPanel(null);
    setSelected(card.id);
    focus(cardAnchor(card.id));
  };
  const move = (id: string, to: number, focusCard = false) => {
    if (to < 0 || to >= draft.cards.length) return;
    change(old => ({ ...old, cards: reorder(old.cards, old.cards.findIndex(card => card.id === id), to) }));
    setSelectedPanel(null);
    setSelected(id);
    say(tr(`Przeniesiono kartę na pozycję ${to + 1}.`, `Moved card to position ${to + 1}.`));
    if (focusCard) focus(cardAnchor(id));
  };
  const remove = (ids: string[]) => {
    const card = draft.cards.find(c => c.panels.includes(ids[0]));
    const next = draft.cards.find(c => c.id !== card?.id);
    change(old => removePanels(old, ids));
    setUndo({ slot: active, draft });
    say(tr('Usunięto z kompozycji.', 'Removed from composition.'));
    focus(next ? cardAnchor(next.id) : 'wb-add');
  };
  const changePanel = (id: string, values: Partial<Panel>) => change(old => ({
    ...old, panels: old.panels.map(p => p.id === id ? { ...p, ...values } : p),
  }));
  function changeMarket(panel: Panel, market: string) {
    change(old => ({
      ...old, panels: old.panels.map(p => p.id === panel.id || (panel.marketGroup && p.marketGroup === panel.marketGroup)
        ? { ...p, market } : p),
    }));
  }
  function changeCursor(panel: Panel, cursorMs: number) {
    const { clock } = panel;
    if (clock.kind !== 'replay') return;
    change(old => ({
      ...old, panels: old.panels.map(p => p.clock.kind === 'replay' && (
        p.id === panel.id || (clock.group && p.clock.group === clock.group)
      ) ? { ...p, clock: { ...p.clock, cursorMs } } : p),
    }));
  }
  function weight(id: string, span: number) {
    change(old => ({ ...old, cards: old.cards.map(card => card.id === id ? { ...card, weight: span } : card) }));
    say(tr(`Rozmiar karty: ${span} z 12.`, `Card size: ${span} of 12.`));
  }
  async function save() {
    if (busy) return;
    const store = readStorage();
    if (!store) { say(tr('Pamięć przeglądarki jest niedostępna.', 'Browser storage is unavailable.')); return; }
    setBusy(true);
    const result = await saveWorkspaceCompositionLocked(store, draft, entry.expected, { slot: active });
    setBusy(false);
    if (result.kind !== 'saved') {
      say(result.kind === 'conflict'
        ? tr('Inna karta zapisała nową rewizję. Wyeksportuj swój szkic albo wczytaj zapis.', 'Another tab saved a new revision. Export your draft or reload the saved one.')
        : tr('Zapis się nie udał. Szkic jest dostępny do eksportu.', 'Saving failed. The draft remains available for export.'));
      return;
    }
    setSlots(old => {
      const current = old[active];
      return { ...old, [active]: {
        draft: current.draft === draft ? result.snapshot : current.draft,
        expected: result.snapshot.revision, dirty: current.draft !== draft,
      } };
    });
    say(tr(`Zapisano rewizję ${result.snapshot.revision}.`, `Saved revision ${result.snapshot.revision}.`));
    celebrateSave(board.current, result.snapshot.revision);
  }
  function restore() {
    const store = readStorage();
    const saved = store && loadWorkspaceComposition(store, active);
    if (saved?.kind !== 'saved') { say(tr('Brak zapisanego stanowiska do odtworzenia.', 'There is no saved workbench to restore.')); return; }
    setUndo({ slot: active, draft });
    setSlots(old => ({ ...old, [active]: { draft: saved.snapshot, expected: saved.snapshot.revision, dirty: false } }));
    setSelected(null);
    say(tr('Odtworzono zapisany układ.', 'Saved layout restored.'));
  }
  function showExport() {
    const json = exportWorkspaceComposition(draft);
    if (!json) { say(tr('Tego układu nie można wyeksportować.', 'This layout could not be exported.')); return; }
    setIo(json);
    if (transfer.current) transfer.current.open = true;
    focus('wb-json');
    say(tr('Układ gotowy do skopiowania.', 'Layout ready to copy.'));
  }
  function importCopy() {
    const snapshot = importWorkspaceComposition(io);
    if (!snapshot) { say(tr('JSON jest nieprawidłowy.', 'The JSON is invalid.')); return; }
    insertSlot(snapshot, makeId('desk'));
    say(tr('Import utworzył osobny szkic.', 'Import created a separate draft.'));
    focus('wb-save');
  }

  function movePanelInCard(cardId: string, panelId: string, to: number) {
    change(old => ({ ...old, cards: old.cards.map(card => card.id === cardId
      ? { ...card, panels: reorder(card.panels, card.panels.indexOf(panelId), to) } : card) }));
  }

  function beginDrag(e: ReactPointerEvent<HTMLButtonElement>, card: WorkspaceCard, kind: 'move' | 'size' | 'panel', panelId?: string) {
    if (e.button !== 0) return;
    const grip = e.currentTarget;
    const x = e.clientX;
    const y = e.clientY;
    const bounds = board.current?.getBoundingClientRect();
    if (!bounds) return;
    const compact = matchMedia('(max-width: 650px)').matches;
    let target: string | null = null;
    let panelTarget: string | null = null;
    let nextSpan = spanOf(card);
    let moved = false;
    // Fizyka przeciągania: uniesiony element podąża za wskaźnikiem z przechyłem, cel przyciąga go jak magnes
    const still = ruchOgraniczony();
    const lifted = kind === 'size' ? null
      : board.current?.querySelector<HTMLElement>(kind === 'panel' ? `[data-wb-panel="${panelId}"]` : `[data-wb-card="${card.id}"]`) ?? null;
    const home = lifted?.getBoundingClientRect() ?? null;
    let tilt = 0;
    let lastX = x;
    grip.setPointerCapture(e.pointerId);
    const update = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - x;
      const dy = ev.clientY - y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      if (lifted && home && !still) {
        const goal = (kind === 'panel' ? hitBelow(ev.clientX, ev.clientY, lifted)?.closest<HTMLElement>('[data-wb-panel],[data-wb-card]') : hitBelow(ev.clientX, ev.clientY, lifted)?.closest<HTMLElement>('[data-wb-card]')) ?? null;
        let tx = dx;
        let ty = dy;
        if (goal && goal !== lifted && !lifted.contains(goal)) {
          const g = goal.getBoundingClientRect();
          tx += (g.left + g.width / 2 - (home.left + home.width / 2 + dx)) * 0.16;
          ty += (g.top + g.height / 2 - (home.top + home.height / 2 + dy)) * 0.16;
        }
        tilt = tilt * 0.7 + Math.max(-4, Math.min(4, (ev.clientX - lastX) * 0.35)) * 0.3;
        lastX = ev.clientX;
        lifted.dataset.lift = 'true';
        lifted.style.transform = `translate(${tx}px, ${ty}px) rotate(${tilt.toFixed(2)}deg) scale(1.025)`;
      }
      if (kind === 'size') {
        nextSpan = Math.min(12, Math.max(4, spanOf(card) + Math.round(compact ? dy / 38 : dx / (bounds.width / 12))));
        setSize({ id: card.id, span: nextSpan });
      } else {
        const hit = hitBelow(ev.clientX, ev.clientY, lifted);
        target = hit?.closest<HTMLElement>('[data-wb-card]')?.dataset.wbCard ?? null;
        if (kind === 'panel') {
          panelTarget = hit?.closest<HTMLElement>('[data-wb-panel]')?.dataset.wbPanel ?? null;
          setPanelDrop(panelTarget === panelId ? null : panelTarget);
        } else {
          setDrag(card.id);
          if (target === card.id) target = null;
        }
        setDrop(target === card.id ? null : target);
      }
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const before = still ? null : snapshotBoard(board.current);
      if (lifted) {
        if (before) before.set(lifted.dataset.wbPanel ?? lifted.dataset.wbCard ?? '', lifted.getBoundingClientRect());
        lifted.style.transform = '';
        delete lifted.dataset.lift;
      }
      if (before) requestAnimationFrame(() => settleBoard(board.current, before));
      grip.removeEventListener('pointermove', update);
      grip.removeEventListener('pointerup', finish);
      grip.removeEventListener('lostpointercapture', finish);
      grip.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', cancel);
      setSize(null);
      setDrag(null);
      setDrop(null);
      setPanelDrop(null);
      if (ev.type !== 'pointerup' || !moved) return;
      if (kind === 'size' && nextSpan !== spanOf(card)) weight(card.id, nextSpan);
      if (kind === 'move' && target) move(card.id, draft.cards.findIndex(c => c.id === target));
      if (kind === 'panel' && panelId && target) {
        if (target !== card.id) change(old => assignPanel(old, panelId, target));
        else if (panelTarget && panelTarget !== panelId) movePanelInCard(card.id, panelId, card.panels.indexOf(panelTarget));
        setSelectedPanel(panelId);
        focus(panelAnchor(panelId));
        say(tr('Przeniesiono panel.', 'Panel moved.'));
      }
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && grip.hasPointerCapture(e.pointerId)) {
        event.preventDefault();
        grip.releasePointerCapture(e.pointerId);
      }
    };
    window.addEventListener('keydown', cancel);
    grip.addEventListener('pointermove', update);
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
    grip.addEventListener('lostpointercapture', finish);
  }

  const selectCard = (id: string) => { setSelectedPanel(null); setSelected(id); focus(cardAnchor(id)); };
  const activeIndex = Object.keys(slots).indexOf(active);
  return <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
    <div className="wb-shell" data-light={light}>
      <a className="wb-skip" href="#wb-workspace">{tr('Przejdź do kompozycji', 'Skip to composition')}</a>
      <header className="wb-bar">
        <a href={`../?lang=${lang}#dzis`} className="wb-back"><ArrowLeft aria-hidden size={16} /> {tr('Aplikacja · Dziś', 'App · Today')}</a>
        <a href={`../?lang=${lang}#charts${chartMarket ? `?m=${encodeURIComponent(chartMarket)}` : ''}`} className="wb-back">{tr('W sesji', 'In session')} ↗</a>
        <div className="wb-bar-end">
          <a className="wb-back" href={`?lang=${lang === 'pl' ? 'en' : 'pl'}`}>{lang === 'pl' ? 'EN' : 'PL'}</a>
          <button className="wb-button" type="button" aria-pressed={light} onClick={() => setTheme(light ? 'dark' : 'light')}>{light ? 'Opal' : 'Zorza'}</button>
        </div>
      </header>
      <main>
        <section className="wb-intro" aria-labelledby="wb-title">
          <div className="wb-intro-copy">
            <p className="mono wb-brand">HYPERQUANT <span aria-hidden>╱</span> {tr('PRACOWNIA', 'STUDIO')}</p>
            <h1 id="wb-title">{lab}</h1>
            <p>{tr('Ułóż księgę, nagrania i własne obserwacje w jednej kompozycji.', 'Arrange your book, recordings and observations in one composition.')}</p>
          </div>
          <figure ref={filmBox} tabIndex={-1} className="wb-film">
            {film && !reduced ? <video ref={video} controls autoPlay muted playsInline preload="metadata" poster={media('grok-c-v2-plakat.webp')} aria-label={tr('Film: odsłonięcie warstw', 'Film: reveal the layers')}>
              <source src={media('grok-c-v2.webm')} type="video/webm" /><source src={media('grok-c-v2.mp4')} type="video/mp4" />
            </video> : <img src={media('grok-c-v2-plakat.webp')} width="1280" height="720" alt="" />}
            {!reduced && !film && <button className="wb-button wb-play" type="button" onClick={() => setFilm(true)}>
              <span aria-hidden>▷</span> {tr('Film: warstwy', 'Film: layers')}
            </button>}
          </figure>
        </section>
        <section id="wb-workspace" tabIndex={-1} className="wb-room" aria-label={tr('Kompozycja stanowiska', 'Workbench composition')}>
          <div className="wb-canvas">
            <nav className="wb-tabs" aria-label={tr('Stanowiska', 'Workbenches')}>
              {Object.entries(slots).map(([slot, state], index) => <button type="button" key={slot} aria-pressed={active === slot} onClick={() => openSlot(slot)}>
                {isPreset(state.draft.preset) ? presets[state.draft.preset] : lab} <span className="mono">{index + 1}</span>
                {state.dirty && <span className="wb-dirty" aria-label={tr('Niezapisane', 'Unsaved')} />}
              </button>)}
            </nav>
            <div className="wb-toolbar">
              <div>
                <h2>{isPreset(draft.preset) ? presets[draft.preset] : lab} <span className="mono wb-set-index">/ {activeIndex + 1}</span></h2>
                <p className="wb-muted">{entry.dirty ? tr('Szkic lokalny', 'Local draft') : tr('Zapis lokalny', 'Saved locally')}</p>
              </div>
              <div className="wb-actions">
                <a href="#wb-library" className="wb-button wb-library-jump">{tr('Biblioteka', 'Library')}</a>
                <button className="wb-button" id="wb-restore" type="button" onClick={restore}>{tr('Odtwórz', 'Restore')}</button>
                <button className="wb-button" type="button" onClick={showExport}>{tr('Eksportuj', 'Export')}</button>
                <button className="wb-button wb-primary" id="wb-save" type="button" disabled={busy || !entry.dirty} onClick={() => void save()}>{tr('Zapisz', 'Save')}</button>
              </div>
            </div>
            <details ref={transfer} className="wb-transfer">
              <summary>{tr('Importuj lub skopiuj układ JSON', 'Import or copy layout JSON')}</summary>
              <label htmlFor="wb-json" className="wb-muted">{tr('Import otwiera osobny szkic.', 'Import opens a separate draft.')}</label>
              <textarea id="wb-json" rows={4} value={io} onChange={event => setIo(event.target.value)} />
              <button className="wb-button" type="button" disabled={!io.trim()} onClick={importCopy}>{tr('Importuj jako kopię', 'Import as a copy')}</button>
            </details>
            <div className="wb-status">
              <p role="status">{status}</p>
              {undo?.slot === active && <button className="wb-button" type="button" onClick={() => {
                change(() => undo.draft); setUndo(null); say(tr('Cofnięto zmianę.', 'Change undone.'));
              }}>{tr('Cofnij', 'Undo')}</button>}
            </div>
            <div className="wb-rail" aria-label={tr('Mapa kompozycji', 'Composition map')}>
              {draft.cards.map(card => <button key={card.id}
                aria-pressed={activeCard === card.id} data-rail-drop={drop === card.id}
                onClick={() => selectCard(card.id)}
                onKeyDown={e => {
                  const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!delta) return;
                  e.preventDefault();
                  const buttons = [...e.currentTarget.parentElement!.querySelectorAll('button')];
                  buttons[(buttons.indexOf(e.currentTarget) + delta + buttons.length) % buttons.length]?.focus();
                }} type="button"
                style={{ '--rail-weight': spanOf(card) } as CSSProperties}>
                {activeCard === card.id && <motion.i className="wb-rail-marker" aria-hidden="true"
                  layoutId={reduced ? undefined : 'wb-rail-marker'} transition={{ duration: reduced ? 0 : .18 }} />}
                {draft.pinned.includes(card.id) && <Pin size={14} aria-hidden />}<span>{cardName(card)}</span>
              </button>)}
            </div>
            {!!draft.pinnedPanels?.length && <div className="wb-actions wb-pinned" aria-label={tr('Przypięte panele', 'Pinned panels')}>
              {draft.pinnedPanels.map(id => <button key={id} className="wb-button" type="button" onClick={() => focus(panelAnchor(id))}>
                <Pin size={14} aria-hidden />{labels[panels.get(id)!.kind]}
              </button>)}
            </div>}
            <div className="wb-grid" ref={board}>
              {!draft.cards.length && <p className="wb-empty">{tr('Wybierz pierwszy panel z biblioteki.', 'Choose your first panel from the library.')}</p>}
              {draft.cards.map((card, index) => <motion.article key={card.id} layout={reduced || size ? false : 'position'}
                transition={{ layout: { type: 'spring', stiffness: 440, damping: 38 } }}
                data-wb-card={card.id} data-selected={activeCard === card.id} data-drag={drag === card.id} data-drop={drop === card.id}
                style={{ '--span': size?.id === card.id ? size.span : spanOf(card) } as CSSProperties} className="wb-card hq-spot">
                <header className="wb-card-head">
                  <button className="wb-icon wb-grip" type="button" aria-label={tr('Przeciągnij kartę. Strzałki przesuwają.', 'Drag card. Arrow keys move it.')}
                    onPointerDown={e => beginDrag(e, card, 'move')}
                    onKeyDown={e => {
                      if (!['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) return;
                      e.preventDefault();
                      move(card.id, index + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1));
                    }}><GripVertical size={iconSize} aria-hidden /></button>
                  <h3 tabIndex={-1} id={cardAnchor(card.id)}>{cardName(card)}
                    {card.panels.length === 1 && draft.leader === card.panels[0] && <span className="wb-leader">{tr('Prowadzący', 'Lead panel')}</span>}
                  </h3>
                  <button className="wb-icon" type="button" aria-pressed={draft.pinned.includes(card.id)}
                    aria-label={tr('Przypnij kartę na mapie kompozycji', 'Pin card on the composition map')}
                    onClick={() => change(old => ({ ...old, pinned: old.pinned.includes(card.id)
                      ? old.pinned.filter(id => id !== card.id) : [...old.pinned, card.id] }))}><Pin size={iconSize} aria-hidden /></button>
                  <button className="wb-icon" type="button" aria-label={tr('Usuń kartę', 'Remove card')} onClick={() => remove(card.panels)}><X size={iconSize} aria-hidden /></button>
                </header>
                <details className="wb-card-settings">
                  <summary><Settings2 size={iconSize} aria-hidden />{tr('Układ karty', 'Card layout')}</summary>
                  <div className="wb-actions">
                    <button className="wb-icon" type="button" disabled={index === 0} aria-label={tr('Przesuń kartę wcześniej', 'Move card earlier')} onClick={() => move(card.id, index - 1, true)}><ArrowLeft size={iconSize} aria-hidden /></button>
                    <button className="wb-icon" type="button" disabled={index === draft.cards.length - 1} aria-label={tr('Przesuń kartę później', 'Move card later')} onClick={() => move(card.id, index + 1, true)}><ArrowRight size={iconSize} aria-hidden /></button>
                    <label>{tr('Rozmiar', 'Size')} <input type="range" min="4" max="12" value={spanOf(card)} onChange={e => weight(card.id, Number(e.target.value))} /></label>
                  </div>
                </details>
                <div className="wb-card-body">
                  {card.panels.map((id, panelIndex) => {
                    const panel = panels.get(id)!;
                    const marketPeers = draft.panels.filter(p => p.kind === 'flow' && p.id !== id);
                    const replay = panel.clock.kind === 'replay' ? panel.clock : null;
                    const clockPeers = replay ? draft.panels.filter(p => p.id !== id && p.kind === panel.kind
                      && p.clock.kind === 'replay' && p.clock.analysisId === replay.analysisId) : [];
                    return <section className="wb-panel" key={id} aria-label={labels[panel.kind]} tabIndex={-1} id={panelAnchor(id)}
                      data-wb-panel={id} data-panel-drop={panelDrop === id}>
                      {card.panels.length > 1 && <h4>{labels[panel.kind]} {draft.leader === id && <span className="wb-leader">{tr('Prowadzący', 'Lead panel')}</span>}</h4>}
                      <details className="wb-panel-settings">
                        <summary>{tr('Ustawienia panelu', 'Panel settings')}</summary>
                        <div className="wb-actions">
                          <button className="wb-icon wb-grip wb-panel-grip" type="button"
                            aria-label={tr('Przeciągnij panel. Strzałki zmieniają kolejność w karcie.', 'Drag panel. Arrow keys reorder it within the card.')}
                            onPointerDown={e => beginDrag(e, card, 'panel', id)}
                            onKeyDown={e => {
                              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                              e.preventDefault();
                              movePanelInCard(card.id, id, panelIndex + (e.key === 'ArrowDown' ? 1 : -1));
                            }}><GripVertical size={iconSize} aria-hidden /></button>
                          <button className="wb-button" type="button" aria-pressed={draft.pinnedPanels?.includes(id) ?? false}
                            onClick={() => change(old => {
                              const pins = old.pinnedPanels ?? [];
                              return { ...old, pinnedPanels: pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id] };
                            })}><Pin size={iconSize} aria-hidden />{tr('Przypnij panel', 'Pin panel')}</button>
                          <button className="wb-button" type="button" aria-pressed={draft.leader === id} onClick={() => change(old => ({ ...old, leader: id }))}>{tr('Panel prowadzący', 'Lead panel')}</button>
                          {panel.kind === 'flow' && <label>{tr('Rynek', 'Market')} <select value={panel.market} onChange={e => changeMarket(panel, e.target.value)}>
                            {ORDER_FLOW_MARKETS.map(m => <option value={m.coin} key={m.coin}>{m.label}</option>)}
                          </select></label>}
                          {panel.kind === 'flow' && marketPeers.length > 0 && <label>{tr('Rynek połączony z', 'Market linked to')}
                            <select value={marketPeers.find(p => p.marketGroup && p.marketGroup === panel.marketGroup)?.id ?? ''} onChange={e => groupMarket(panel, e.target.value)}>
                              <option value="">{tr('Osobny', 'Independent')}</option>
                              {marketPeers.map(p => <option key={p.id} value={p.id}>{p.market} · {draft.panels.indexOf(p) + 1}</option>)}
                            </select></label>}
                          {replay && clockPeers.length > 0 && <label>{tr('Czas połączony z', 'Time linked to')}
                            <select value={clockPeers.find(p => p.clock.kind === 'replay' && p.clock.group && p.clock.group === replay.group)?.id ?? ''} onChange={e => groupClock(panel, e.target.value)}>
                              <option value="">{tr('Osobny', 'Independent')}</option>
                              {clockPeers.map(p => <option key={p.id} value={p.id}>{labels[p.kind]} · {draft.panels.indexOf(p) + 1}</option>)}
                            </select></label>}
                          <label>{tr('Wysokość panelu', 'Panel height')} <select value={panel.weight ?? 100} onChange={e => changePanel(id, { weight: Number(e.target.value) })}>
                            {panel.weight !== undefined && ![4, 6, 8, 100].includes(panel.weight) && <option value={panel.weight}>{tr('Z importu', 'Imported')}</option>}
                            <option value={100}>{tr('Automatyczna', 'Automatic')}</option>
                            <option value={4}>{tr('Niska', 'Short')}</option>
                            <option value={6}>{tr('Średnia', 'Medium')}</option>
                            <option value={8}>{tr('Wysoka', 'Tall')}</option>
                          </select></label>
                          {panel.kind === 'observation' && panel.clock.kind === 'replay' && <label>{tr('Kursor', 'Cursor')} <select value={panel.clock.cursorMs ?? ''} onChange={e => changeCursor(panel, Number(e.target.value))}>
                            <option value={BEFORE_B}>{tr('Przed odsłonięciem B', 'Before revealing B')}</option>
                            <option value={AFTER_B}>{tr('Po odsłonięciu B', 'After revealing B')}</option>
                          </select></label>}
                          <label>{tr('Przenieś panel', 'Move panel')} <select value={card.id} onChange={e => {
                            change(old => assignPanel(old, id, e.target.value || null));
                            setSelectedPanel(id);
                            focus(panelAnchor(id));
                          }}>
                            <option value={card.id}>{tr('W tej karcie', 'In this card')}</option>
                            {card.panels.length > 1 && <option value="">{tr('Do nowej karty', 'To a new card')}</option>}
                            {draft.cards.filter(c => c.id !== card.id).map(c => <option value={c.id} key={c.id}>{cardName(c)}</option>)}
                          </select></label>
                          {card.panels.length > 1 && <>
                            <button className="wb-icon" type="button" disabled={panelIndex === 0} aria-label={tr('Przesuń panel w górę', 'Move panel up')} onClick={() => change(old => ({
                              ...old, cards: old.cards.map(c => c.id === card.id ? { ...c, panels: reorder(c.panels, panelIndex, panelIndex - 1) } : c),
                            }))}><ArrowUp size={iconSize} aria-hidden /></button>
                            <button className="wb-icon" type="button" disabled={panelIndex === card.panels.length - 1} aria-label={tr('Przesuń panel w dół', 'Move panel down')} onClick={() => change(old => ({
                              ...old, cards: old.cards.map(c => c.id === card.id ? { ...c, panels: reorder(c.panels, panelIndex, panelIndex + 1) } : c),
                            }))}><ArrowDown size={iconSize} aria-hidden /></button>
                          </>}
                          <button className="wb-button" type="button" onClick={() => remove([id])}>{tr('Usuń panel', 'Remove panel')}</button>
                        </div>
                      </details>
                      <div className="wb-panel-content" style={panel.weight && panel.weight < 100
                        ? { maxHeight: `${Math.min(800, Math.max(160, panel.weight * 65))}px` } : undefined}>
                        <LocalBoundary key={`${active}:${panel.kind}`} what={labels[panel.kind]} fallback={
                          <div role="alert" className="wb-panel-error">
                            <p>{tr('Nie udało się wczytać tego panelu.', 'This panel could not load.')}</p>
                            <p className="wb-muted">{tr('Możesz dalej edytować stanowisko. Zapisz zmiany lub wyeksportuj układ przed odświeżeniem.',
                              'You can keep editing the workbench. Save changes or export the layout before reloading.')}</p>
                            <button type="button" className="wb-button" onClick={() => window.location.reload()}>
                              {tr('Odśwież stronę', 'Reload page')}
                            </button>
                          </div>
                        }>
                          <PanelContent panel={panel} slot={active} change={values => changePanel(panel.id, values)} changeCursor={value => changeCursor(panel, value)} />
                        </LocalBoundary>
                      </div>
                    </section>;
                  })}
                </div>
                <button className="wb-icon wb-resize" type="button" aria-label={tr('Zmień rozmiar karty. Strzałki zmieniają rozmiar.', 'Resize card. Arrow keys change size.')}
                  onPointerDown={e => beginDrag(e, card, 'size')}
                  onKeyDown={e => {
                    if (!['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) return;
                    e.preventDefault();
                    weight(card.id, Math.min(12, Math.max(4, spanOf(card) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1))));
                  }}><Maximize2 size={iconSize} aria-hidden /></button>
              </motion.article>)}
            </div>
          </div>
          <aside className="wb-library" id="wb-library" tabIndex={-1}>
            <h2>{tr('Biblioteka', 'Library')}</h2>
            <div className="wb-library-body">
              <p className="wb-label">{tr('Nowe z szablonu', 'New from template')}</p>
              {presetsList.map(key => <button type="button" className="wb-library-item" key={key} onClick={() => template(key)}>
                <span>{presets[key]}</span><Plus size={iconSize} aria-hidden />
              </button>)}
              <p className="wb-label" id="wb-add" tabIndex={-1}>{tr('Dodaj panel', 'Add a panel')}</p>
              {kinds.map(kind => <button type="button" className="wb-library-item" key={kind} disabled={draft.panels.length >= 24} onClick={() => add(kind)}>
                <span>{labels[kind]}</span><Plus size={iconSize} aria-hidden />
              </button>)}
            </div>
          </aside>
        </section>
      </main>
    </div>
  </MotionConfig>;
}
