import { loadWorkspaceSnapshot, parseWorkspaceSnapshot, type WorkspacePanel, type WorkspaceSnapshot } from './workspaceSnapshot';

export type WorkspacePanelKind = 'flow' | 'archive' | 'basket' | 'delta' | 'observation';
export type WorkspaceClock = { kind: 'live' } | {
  kind: 'replay';
  group: string | null;
  analysisId: string;
  cursorMs: number | null;
};
export type WorkspaceCompositionPanel = Omit<WorkspacePanel, 'clock'> & {
  kind: WorkspacePanelKind;
  clock: WorkspaceClock;
};
export type WorkspaceCard = { id: string; kind: 'card' | 'group'; panels: string[]; weight?: number };
export type WorkspaceComposition = Omit<WorkspaceSnapshot, 'v' | 'panels'> & {
  v: 2;
  cards: WorkspaceCard[];
  pinnedPanels?: string[];
  panels: WorkspaceCompositionPanel[];
};

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
type Loaded = { kind: 'saved'; snapshot: WorkspaceComposition } | { kind: 'missing' | 'unreadable' };
type Saved = { kind: 'saved'; snapshot: WorkspaceComposition }
  | { kind: 'invalid' | 'conflict' | 'storage-failed' | 'lock-unavailable' };
type Lock = (name: string, operation: () => Saved) => Promise<Saved> | undefined;
type SaveOptions = { slot?: string; lock?: Lock };

const maxJsonLength = 32_768;
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPanelKind = (value: unknown): value is WorkspacePanelKind =>
  value === 'flow' || value === 'archive' || value === 'basket' || value === 'delta' || value === 'observation';
const isWeight = (weight: unknown): weight is number =>
  typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && weight <= 1000;

function parseClock(clock: unknown): WorkspaceClock | null {
  if (!isObject(clock)) return null;
  if (clock.kind === 'live') return { kind: 'live' };
  const { kind, group, analysisId, cursorMs } = clock;
  if (kind !== 'replay' || (group !== null && !isId(group)) || !isId(analysisId)
    || (cursorMs !== null && (typeof cursorMs !== 'number' || !Number.isSafeInteger(cursorMs) || cursorMs < 0))) return null;
  return { kind, group, analysisId, cursorMs };
}

function migrate(snapshot: WorkspaceSnapshot): WorkspaceComposition {
  const panels = snapshot.panels.map(({ clock, ...panel }, _, legacy): WorkspaceCompositionPanel => {
    const linkedMarket = panel.marketGroup === null || legacy.every(other =>
      other.marketGroup !== panel.marketGroup || other.market === panel.market);
    const linkedClock = clock.kind === 'live' || legacy.every(other => other.clock.kind === 'live'
      || other.clock.group !== clock.group || other.clock.analysisId === clock.analysisId);
    return {
      ...panel, kind: 'flow', marketGroup: linkedMarket ? panel.marketGroup : null,
      clock: clock.kind === 'live' ? clock : { ...clock, group: linkedClock ? clock.group : null, cursorMs: null },
    };
  });
  return { ...snapshot, v: 2, panels, cards: panels.map(({ id }) => ({ id, kind: 'card', panels: [id] })) };
}

function parsePins(value: unknown, known: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value) || value.length > known.size) return null;
  const pins = new Set<string>();
  for (const pin of value) {
    if (!isId(pin) || !known.has(pin) || pins.has(pin)) return null;
    pins.add(pin);
  }
  return [...pins];
}

export function parseWorkspaceComposition(value: unknown): WorkspaceComposition | null {
  if (!isObject(value)) return null;
  if (value.v === 1) {
    const legacy = parseWorkspaceSnapshot(value);
    return legacy && migrate(legacy);
  }
  if (value.v !== 2 || !Array.isArray(value.panels) || value.panels.length > 24
    || !Array.isArray(value.cards) || value.cards.length > 24) return null;

  if (value.panels.length === 0) {
    const { id, revision, preset } = value;
    if (!isId(id) || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
      || (preset !== undefined && !isId(preset)) || value.leader !== undefined || value.cards.length !== 0) return null;
    const pinned = parsePins(value.pinned, new Set());
    const pinnedPanels = value.pinnedPanels === undefined ? undefined : parsePins(value.pinnedPanels, new Set());
    if (!pinned || pinnedPanels === null) return null;
    return { v: 2, id, revision, panels: [], cards: [], pinned,
      ...(pinnedPanels === undefined ? {} : { pinnedPanels }), ...(preset === undefined ? {} : { preset }) };
  }
  const extras: Pick<WorkspaceCompositionPanel, 'kind' | 'clock'>[] = [];
  const legacyPanels: Record<string, unknown>[] = [];
  for (const panel of value.panels) {
    if (!isObject(panel) || !isPanelKind(panel.kind)) return null;
    const clock = parseClock(panel.clock);
    if (!clock) return null;
    extras.push({ kind: panel.kind, clock });
    legacyPanels.push({ ...panel, clock: clock.kind === 'live' ? clock : { ...clock, group: clock.group ?? panel.id } });
  }
  const legacy = parseWorkspaceSnapshot({ ...value, v: 1, panels: legacyPanels, pinned: [] });
  if (!legacy) return null;
  const panels = legacy.panels.map((panel, i) => ({ ...panel, ...extras[i] }));
  const marketGroups = new Map<string, string>();
  const replayGroups = new Map<string, Extract<WorkspaceClock, { kind: 'replay' }>>();
  for (const { market, marketGroup, clock } of panels) {
    if (marketGroup !== null) {
      const current = marketGroups.get(marketGroup);
      if (current !== undefined && current !== market) return null;
      marketGroups.set(marketGroup, market);
    }
    if (clock.kind === 'replay' && clock.group !== null) {
      const current = replayGroups.get(clock.group);
      if (current && (current.analysisId !== clock.analysisId || current.cursorMs !== clock.cursorMs)) return null;
      replayGroups.set(clock.group, clock);
    }
  }

  const panelIds = new Set(panels.map(panel => panel.id));
  const unassigned = new Set(panelIds);
  const cardIds = new Set<string>();
  const cards: WorkspaceCard[] = [];
  for (const card of value.cards) {
    if (!isObject(card)) return null;
    const { id, kind, panels: members, weight } = card;
    if (!isId(id) || cardIds.has(id) || (kind !== 'card' && kind !== 'group')
      || !Array.isArray(members) || members.length < 1 || members.length > unassigned.size
      || (kind === 'card' && members.length !== 1) || (weight !== undefined && !isWeight(weight))) return null;
    const assigned: string[] = [];
    for (const member of members) {
      if (!isId(member) || !unassigned.delete(member)) return null;
      assigned.push(member);
    }
    cardIds.add(id);
    cards.push({ id, kind, panels: assigned, ...(weight === undefined ? {} : { weight }) });
  }
  if (unassigned.size) return null;
  const pinned = parsePins(value.pinned, cardIds);
  const pinnedPanels = value.pinnedPanels === undefined ? undefined : parsePins(value.pinnedPanels, panelIds);
  if (!pinned || pinnedPanels === null) return null;
  return { ...legacy, v: 2, cards, panels, pinned, ...(pinnedPanels === undefined ? {} : { pinnedPanels }) };
}

export function createWorkspaceFromPreset(preset: WorkspaceComposition, id: string): WorkspaceComposition | null {
  return parseWorkspaceComposition({ ...preset, id, preset: preset.id, revision: 0 });
}

export function importWorkspaceComposition(json: string): WorkspaceComposition | null {
  if (json.length > maxJsonLength) return null;
  try { return parseWorkspaceComposition(JSON.parse(json)); }
  catch { return null; }
}

export function exportWorkspaceComposition(snapshot: WorkspaceComposition): string | null {
  const parsed = parseWorkspaceComposition(snapshot);
  if (!parsed) return null;
  const json = JSON.stringify(parsed);
  return json.length <= maxJsonLength ? json : null;
}

const defaultKey = 'hq.workspace.composition.v2';
const keyFor = (slot: string | undefined) => slot === undefined ? defaultKey : `${defaultKey}.${slot}`;

export function loadWorkspaceComposition(storage: StoragePort, slot?: string): Loaded {
  if (slot !== undefined && !isId(slot)) return { kind: 'unreadable' };
  try {
    const json = storage.getItem(keyFor(slot));
    if (json !== null) {
      const snapshot = importWorkspaceComposition(json);
      return snapshot ? { kind: 'saved', snapshot } : { kind: 'unreadable' };
    }
    if (slot !== undefined) return { kind: 'missing' };
    const legacy = loadWorkspaceSnapshot(storage);
    return legacy.kind === 'saved' ? { kind: 'saved', snapshot: migrate(legacy.snapshot) } : legacy;
  } catch {
    return { kind: 'unreadable' };
  }
}

const webLock: Lock = (name, operation) => globalThis.navigator?.locks?.request(name, operation);

export async function saveWorkspaceCompositionLocked(
  storage: StoragePort, draft: unknown, expectedRevision: number | null, { slot, lock = webLock }: SaveOptions = {},
): Promise<Saved> {
  if (slot !== undefined && !isId(slot)) return { kind: 'invalid' };
  const parsed = parseWorkspaceComposition(draft);
  if (!parsed) return { kind: 'invalid' };
  const key = keyFor(slot);
  try {
    return await lock(key, () => {
      const previous = loadWorkspaceComposition(storage, slot);
      if (previous.kind === 'unreadable') return { kind: 'storage-failed' };
      const revision = previous.kind === 'saved' ? previous.snapshot.revision : null;
      if (revision !== expectedRevision) return { kind: 'conflict' };
      const snapshot = { ...parsed, revision: (revision ?? 0) + 1 };
      if (!Number.isSafeInteger(snapshot.revision)) return { kind: 'invalid' };
      const json = exportWorkspaceComposition(snapshot);
      if (json === null) return { kind: 'invalid' };
      try {
        storage.setItem(key, json);
        return { kind: 'saved', snapshot };
      } catch {
        return { kind: 'storage-failed' };
      }
    }) ?? { kind: 'lock-unavailable' };
  } catch {
    return { kind: 'lock-unavailable' };
  }
}
