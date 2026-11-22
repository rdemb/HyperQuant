import { tr } from '../i18n';
import {
  createWorkspaceFromPreset, loadWorkspaceComposition,
  type WorkspaceCard, type WorkspaceComposition, type WorkspaceCompositionPanel, type WorkspacePanelKind,
} from '../state/workspaceComposition';

export type { WorkspaceComposition };
export const labels: Record<WorkspacePanelKind, string> = {
  flow: tr('Księga i taśma', 'Book & tape'),
  observation: tr('Obserwacja poziomu', 'Level observation'),
  archive: tr('Godzina z archiwum', 'Archive hour'),
  basket: tr('Koszyk giełd', 'Venue basket'),
  delta: tr('Delta mimo luki', 'Delta through a gap'),
};
export const kinds = Object.keys(labels) as WorkspacePanelKind[];
const storagePrefix = 'hq.workspace.composition.v2.';
const activeKey = 'hq.workbench.active';
export function readStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const makePanel = (kind: WorkspacePanelKind, id = makeId(kind)): WorkspaceCompositionPanel => ({
  id, kind, market: 'BTC', marketGroup: null,
  clock: kind === 'flow' ? { kind: 'live' } : {
    kind: 'replay', group: null,
    analysisId: { observation: 'level-978', archive: 'btc-08', basket: 'btc-venues', delta: 'btc-delta' }[kind],
    cursorMs: { observation: 1795159794010, archive: 1795163407089, basket: 1795159260000, delta: 1795159310000 }[kind],
  },
  ...(kind === 'flow' && { settings: { tapeMinimumUsd: 1000, bookDepth: 10 } }),
});

export type Preset = 'evidence' | 'session' | 'empty';
export const presets: Record<Preset, string> = {
  evidence: tr('Ślad zdarzenia', 'Event trail'),
  session: tr('Pulpit sesji', 'Session desk'),
  empty: tr('Puste stanowisko', 'Empty workbench'),
};
export const isPreset = (key: string | undefined): key is Preset =>
  key === 'evidence' || key === 'session' || key === 'empty';

export function fromPreset(preset: Preset, id: string): WorkspaceComposition {
  const kinds: WorkspacePanelKind[] = preset === 'evidence' ? ['observation', 'delta'] : preset === 'session' ? ['flow', 'basket'] : [];
  const panels = kinds.map(kind => makePanel(kind, kind));
  const cards: WorkspaceCard[] = panels.map((panel, index) => ({
    id: `card-${panel.id}`, kind: 'card', panels: [panel.id], weight: index === 0 ? 7 : 5,
  }));
  return createWorkspaceFromPreset({
    v: 2, id: preset, revision: 0, cards, panels,
    pinned: cards.slice(0, 1).map(c => c.id), leader: panels[0]?.id,
  }, id)!;
}

export type Entry = {
  draft: WorkspaceComposition;
  expected: number | null;
  dirty: boolean;
};
export function readEntries(): { slots: Record<string, Entry>; active: string } {
  const store = readStorage();
  const slots: Record<string, Entry> = {};
  let active = 'first';
  if (store) {
    try {
      // The adapter owns individual records. Enumerating their slots avoids a second index write.
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key?.startsWith(storagePrefix)) continue;
        const slot = key.slice(storagePrefix.length);
        if (!/^(first|desk-[0-9a-f]{8})$/.test(slot)) continue;
        const saved = loadWorkspaceComposition(store, slot);
        if (saved.kind === 'saved') slots[slot] = { draft: saved.snapshot, expected: saved.snapshot.revision, dirty: false };
      }
      const previous = store.getItem(activeKey);
      if (previous && Object.prototype.hasOwnProperty.call(slots, previous)) active = previous;
    } catch { /* a fresh draft also works when storage is blocked */ }
  }
  if (!Object.keys(slots).length) slots.first = { draft: fromPreset('evidence', 'first'), expected: null, dirty: true };
  return { slots, active: Object.prototype.hasOwnProperty.call(slots, active) ? active : Object.keys(slots)[0] };
}
export function rememberActive(slot: string) {
  try { readStorage()?.setItem(activeKey, slot); } catch { /* editing remains available */ }
}
export const spanOf = (card: WorkspaceCard) => Math.min(12, Math.max(4, Math.round(card.weight ?? 6)));

export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from === to || to >= items.length) return items;
  const next = [...items];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function assignPanel(draft: WorkspaceComposition, panelId: string, target: string | null): WorkspaceComposition {
  const source = draft.cards.find(card => card.panels.includes(panelId));
  if (!source || source.id === target) return draft;
  const cards = draft.cards.flatMap(card => {
    if (target === card.id) return [{ ...card, kind: 'group' as const, panels: [...card.panels, panelId] }];
    if (card.id !== source.id) return [card];
    const panels = card.panels.filter(id => id !== panelId);
    return panels.length ? [{ ...card, kind: panels.length === 1 ? 'card' as const : 'group' as const, panels }] : [];
  });
  if (target === null) cards.push({ id: makeId('card'), kind: 'card', panels: [panelId], weight: 6 });
  return { ...draft, cards, pinned: draft.pinned.filter(id => cards.some(card => card.id === id)) };
}

export function removePanels(draft: WorkspaceComposition, ids: string[]): WorkspaceComposition {
  const panels = draft.panels.filter(panel => !ids.includes(panel.id));
  const cards = draft.cards.flatMap(card => {
    const members = card.panels.filter(id => !ids.includes(id));
    return members.length ? [{ ...card, kind: members.length === 1 ? 'card' as const : 'group' as const, panels: members }] : [];
  });
  const leader = panels.some(panel => panel.id === draft.leader) ? draft.leader : panels[0]?.id;
  return {
    ...draft, cards, panels, leader,
    pinned: draft.pinned.filter(id => cards.some(card => card.id === id)),
    pinnedPanels: draft.pinnedPanels?.filter(id => !ids.includes(id)),
  };
}
