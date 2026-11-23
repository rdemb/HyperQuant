import { tr } from '../i18n';
import type { WorkspaceChartInterval } from '../state/workspaceSnapshot';
import {
  createWorkspaceFromPreset, loadWorkspaceComposition,
  type WorkspaceCard, type WorkspaceComposition, type WorkspaceCompositionPanel, type WorkspacePanelKind,
} from '../state/workspaceComposition';

export type { WorkspaceComposition };
export const labels: Record<WorkspacePanelKind, string> = {
  chart: tr('Wykres', 'Chart'),
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
export const makePanel = (kind: WorkspacePanelKind, id = makeId(kind), market = 'BTC', interval: WorkspaceChartInterval = '5m'): WorkspaceCompositionPanel => kind === 'chart'
  ? { id, kind, market, marketGroup: null, clock: { kind: 'live' }, settings: { interval } }
  : ({
  id, kind, market: 'BTC', marketGroup: null,
  clock: kind === 'flow' ? { kind: 'live' } : {
    kind: 'replay', group: null,
    analysisId: ({ observation: 'level-978', archive: 'btc-08', basket: 'btc-venues', delta: 'btc-delta' } as Record<string, string>)[kind],
    cursorMs: ({ observation: 1795159794010, archive: 1795163407089, basket: 1795159260000, delta: 1795159310000 } as Record<string, number>)[kind],
  },
  ...(kind === 'flow' && { settings: { tapeMinimumUsd: 1000, bookDepth: 10 } }),
});

export type Preset = 'charts' | 'chartflow' | 'evidence' | 'session' | 'empty';
export const presets: Record<Preset, string> = {
  charts: tr('Siatka wykresów', 'Chart grid'),
  chartflow: tr('Wykres i księga', 'Chart & book'),
  evidence: tr('Ślad zdarzenia', 'Event trail'),
  session: tr('Pulpit sesji', 'Session desk'),
  empty: tr('Puste stanowisko', 'Empty workbench'),
};
/** Opis szablonu w bibliotece (co dostajesz po kliknięciu). */
export const presetNotes: Record<Preset, string> = {
  charts: tr('4 wykresy: BTC 1m i 15m, złoto, S&P 500', '4 charts: BTC 1m and 15m, gold, S&P 500'),
  chartflow: tr('Wykres BTC obok księgi i taśmy', 'BTC chart next to the book and tape'),
  evidence: tr('Obserwacja poziomu i delta mimo luki', 'Level observation and delta through a gap'),
  session: tr('Księga, taśma i koszyk giełd', 'Book, tape and venue basket'),
  empty: tr('Zacznij od zera', 'Start from scratch'),
};
export const isPreset = (key: string | undefined): key is Preset =>
  key === 'charts' || key === 'chartflow' || key === 'evidence' || key === 'session' || key === 'empty';

type Seed = { kind: WorkspacePanelKind; weight: number; market?: string; interval?: WorkspaceChartInterval };
const SEEDS: Record<Preset, Seed[]> = {
  charts: [
    { kind: 'chart', weight: 6, market: 'BTC', interval: '1m' },
    { kind: 'chart', weight: 6, market: 'BTC', interval: '15m' },
    { kind: 'chart', weight: 6, market: 'xyz:GOLD', interval: '5m' },
    { kind: 'chart', weight: 6, market: 'xyz:SP500', interval: '5m' },
  ],
  chartflow: [
    { kind: 'chart', weight: 8, market: 'BTC', interval: '1m' },
    { kind: 'flow', weight: 4 },
  ],
  evidence: [{ kind: 'observation', weight: 7 }, { kind: 'delta', weight: 5 }],
  session: [{ kind: 'flow', weight: 7 }, { kind: 'basket', weight: 5 }],
  empty: [],
};

export function fromPreset(preset: Preset, id: string): WorkspaceComposition {
  const seeds = SEEDS[preset];
  // Stałe ID w szablonie (te same po każdym utworzeniu); kolejny wykres tego samego rodzaju dostaje numer
  const panels = seeds.map((s, i) => makePanel(s.kind, seeds.findIndex(x => x.kind === s.kind) === i ? s.kind : `${s.kind}-${i + 1}`, s.market, s.interval));
  const cards: WorkspaceCard[] = panels.map((panel, index) => ({
    id: `card-${panel.id}`, kind: 'card', panels: [panel.id], weight: seeds[index].weight,
  }));
  return createWorkspaceFromPreset({
    v: 2, id: preset, revision: 0, cards, panels,
    pinned: cards.slice(0, 1).map(c => c.id), leader: panels[0]?.id,
  }, id)!;
}

/**
 * Gotowe układy siatki (12 kolumn): szerokości kart po kolei, wzór powtarza się dla dalszych kart. Kolejność kart i ich
 * zawartość zostają, zmieniają się tylko szerokości.
 */
export type GridLayout = 'one' | 'two' | 'three' | 'grid' | 'hero' | 'focus';
export const gridLayouts: { id: GridLayout; label: string; spans: number[] }[] = [
  { id: 'one', label: tr('Jedna kolumna', 'One column'), spans: [12] },
  { id: 'two', label: tr('Dwie kolumny', 'Two columns'), spans: [6, 6] },
  { id: 'three', label: tr('Trzy kolumny', 'Three columns'), spans: [4, 4, 4] },
  { id: 'grid', label: tr('Siatka 2 × 2', '2 × 2 grid'), spans: [6, 6, 6, 6] },
  { id: 'hero', label: tr('Duży i dwa pod nim', 'Large with two below'), spans: [12, 6, 6] },
  { id: 'focus', label: tr('Główny i boczny', 'Main and side'), spans: [8, 4] },
];
export function applyGridLayout(draft: WorkspaceComposition, layout: GridLayout): WorkspaceComposition {
  const spans = gridLayouts.find(l => l.id === layout)?.spans ?? [12];
  // „Duży i dwa”: pierwszy na całą szerokość, dalsze parami
  const spanAt = (i: number) => layout === 'hero' ? (i === 0 ? 12 : 6) : spans[i % spans.length];
  return { ...draft, cards: draft.cards.map((card, i) => ({ ...card, weight: spanAt(i) })) };
}
/** Układ, który pasuje do obecnych szerokości kart (podświetlenie w przełączniku), albo null. */
export function currentGridLayout(draft: WorkspaceComposition): GridLayout | null {
  if (!draft.cards.length) return null;
  const now = draft.cards.map(spanOf);
  // Cztery karty po 6 kolumn to „Siatka 2 × 2”, nie „Dwie kolumny”
  const order = draft.cards.length === 4 ? [...gridLayouts].sort((a, b) => Number(b.id === 'grid') - Number(a.id === 'grid')) : gridLayouts;
  const match = order.find(l => applyGridLayout(draft, l.id).cards.every((c, i) => spanOf(c) === now[i]));
  return match?.id ?? null;
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
  if (!Object.keys(slots).length) slots.first = { draft: fromPreset('charts', 'first'), expected: null, dirty: true };
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
