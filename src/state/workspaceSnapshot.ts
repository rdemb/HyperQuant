import { deskMarketOf } from '../config/deskMarkets';

export type WorkspacePanel = {
  id: string;
  market: string;
  marketGroup: string | null;
  clock: { kind: 'live' } | { kind: 'replay'; group: string; analysisId: string };
  weight?: number;
  settings?: { tapeMinimumUsd?: number; bookDepth?: 5 | 10 | 20 };
};
export type WorkspaceSnapshot = {
  v: 1;
  revision: number;
  id: string;
  panels: WorkspacePanel[];
  pinned: string[];
  preset?: string;
  leader?: string;
};
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
type Load = { kind: 'saved'; snapshot: WorkspaceSnapshot } | { kind: 'missing' | 'unreadable' };
type Save = { kind: 'saved'; snapshot: WorkspaceSnapshot } | { kind: 'conflict' | 'invalid' | 'storage-failed' };

const key = 'hq.workspace.snapshot.v1';
const maxJsonLength = 32_768;
const ids = /^[a-z0-9][a-z0-9-]{0,47}$/;
const id = (value: unknown): value is string => typeof value === 'string' && ids.test(value);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!object(value) || value.v !== 1 || !id(value.id) || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.panels) || !value.panels.length || value.panels.length > 24
    || !Array.isArray(value.pinned) || value.pinned.length > value.panels.length) return null;
  const seen = new Set<string>();
  const panels: WorkspacePanel[] = [];
  for (const panel of value.panels) {
    if (!object(panel) || !id(panel.id) || seen.has(panel.id) || typeof panel.market !== 'string' || !deskMarketOf(panel.market)
      || (panel.marketGroup !== null && !id(panel.marketGroup)) || !object(panel.clock)) return null;
    const { id: panelId, market, marketGroup, clock, weight, settings } = panel;
    if (weight !== undefined && (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 1000)) return null;
    const appearance: Pick<WorkspacePanel, 'weight' | 'settings'> = {};
    if (weight !== undefined) appearance.weight = weight;
    if (settings !== undefined) {
      if (!object(settings)) return null;
      const { tapeMinimumUsd, bookDepth } = settings;
      if (tapeMinimumUsd !== undefined && (typeof tapeMinimumUsd !== 'number' || !Number.isFinite(tapeMinimumUsd)
        || tapeMinimumUsd < 0 || tapeMinimumUsd > 1_000_000_000)) return null;
      if (bookDepth !== undefined && bookDepth !== 5 && bookDepth !== 10 && bookDepth !== 20) return null;
      appearance.settings = { ...(tapeMinimumUsd === undefined ? {} : { tapeMinimumUsd }), ...(bookDepth === undefined ? {} : { bookDepth }) };
    }
    if (clock.kind === 'live') {
      panels.push({ id: panelId, market, marketGroup, clock: { kind: 'live' }, ...appearance });
    } else if (clock.kind === 'replay' && id(clock.group) && id(clock.analysisId)) {
      panels.push({ id: panelId, market, marketGroup, clock: { kind: 'replay', group: clock.group, analysisId: clock.analysisId }, ...appearance });
    } else return null;
    seen.add(panelId);
  }
  const pinned: string[] = [];
  for (const pin of value.pinned) {
    if (!id(pin) || !seen.has(pin) || pinned.includes(pin)) return null;
    pinned.push(pin);
  }
  const { preset, leader } = value;
  if ((preset !== undefined && !id(preset)) || (leader !== undefined && (!id(leader) || !seen.has(leader)))) return null;
  return { v: 1, revision: value.revision, id: value.id, panels, pinned,
    ...(preset === undefined ? {} : { preset }), ...(leader === undefined ? {} : { leader }) };
}

export function importWorkspaceSnapshot(json: string): WorkspaceSnapshot | null {
  if (json.length > maxJsonLength) return null;
  try { return parseWorkspaceSnapshot(JSON.parse(json)); }
  catch { return null; }
}

export function exportWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string | null {
  const safe = parseWorkspaceSnapshot(snapshot);
  return safe ? JSON.stringify(safe) : null;
}

export function loadWorkspaceSnapshot(storage: StoragePort): Load {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { kind: 'missing' };
    const snapshot = importWorkspaceSnapshot(raw);
    return snapshot ? { kind: 'saved', snapshot } : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

const webLock = (operation: () => Save) => globalThis.navigator?.locks?.request(key, operation);

/** All participating tabs acquire the same origin lock before checking the expected revision. */
export async function saveWorkspaceSnapshotLocked(
  storage: StoragePort, draft: unknown, expectedRevision: number | null,
  lock: (operation: () => Save) => Promise<Save> | undefined = webLock,
): Promise<Save | { kind: 'lock-unavailable' }> {
  try {
    return await lock(() => saveWorkspaceSnapshot(storage, draft, expectedRevision)) ?? { kind: 'lock-unavailable' };
  } catch {
    return { kind: 'lock-unavailable' };
  }
}

/** Saves one browser workspace as a single record. Caller serializes writers across tabs. */
export function saveWorkspaceSnapshot(storage: StoragePort, draft: unknown, expectedRevision: number | null): Save {
  const valid = parseWorkspaceSnapshot(draft);
  if (!valid) return { kind: 'invalid' };
  const previous = loadWorkspaceSnapshot(storage);
  if (previous.kind === 'unreadable') return { kind: 'storage-failed' };
  const revision = previous.kind === 'saved' ? previous.snapshot.revision : null;
  if (revision !== expectedRevision) return { kind: 'conflict' };
  const snapshot = { ...valid, revision: (revision ?? 0) + 1 };
  if (!Number.isSafeInteger(snapshot.revision)) return { kind: 'invalid' };
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return { kind: 'saved', snapshot };
  } catch {
    return { kind: 'storage-failed' };
  }
}
