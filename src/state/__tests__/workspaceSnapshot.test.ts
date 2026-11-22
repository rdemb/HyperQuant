import { expect, it } from 'vitest';
import { exportWorkspaceSnapshot, importWorkspaceSnapshot, loadWorkspaceSnapshot, parseWorkspaceSnapshot,
  saveWorkspaceSnapshot, saveWorkspaceSnapshotLocked, type WorkspaceSnapshot } from '../workspaceSnapshot';

const draft: WorkspaceSnapshot = { v: 1, revision: 0, id: 'session', pinned: ['tape'], panels: [
  { id: 'book', market: 'BTC', marketGroup: 'instrument', clock: { kind: 'live' } },
  { id: 'tape', market: 'BTC', marketGroup: 'instrument', clock: { kind: 'replay', group: 'separate-clock', analysisId: 'anchor-1' } },
] };

it('reads the same panel IDs after reordering, without merging the replay clock into the market group', () => {
  const imported = parseWorkspaceSnapshot(JSON.parse(JSON.stringify({ ...draft, panels: [...draft.panels].reverse() })));
  expect(imported).toEqual({ ...draft, panels: [...draft.panels].reverse() });
  expect(parseWorkspaceSnapshot({ ...draft, pinned: ['unknown'] })).toBeNull();
  expect(parseWorkspaceSnapshot({ ...draft, panels: [...draft.panels, draft.panels[0]] })).toBeNull();
  expect(parseWorkspaceSnapshot({ ...draft, panels: [{ ...draft.panels[0], market: 'incorrect' }] })).toBeNull();
});

it('exports bounded panel settings, proportions and leader across fresh local profiles', () => {
  const configured: WorkspaceSnapshot = { ...draft, preset: 'auction', leader: 'tape', panels: [
    { ...draft.panels[0], weight: 40, settings: { bookDepth: 20 } },
    { ...draft.panels[1], weight: 60, settings: { tapeMinimumUsd: 1000 } },
  ] };
  const encoded = exportWorkspaceSnapshot(configured);
  expect(importWorkspaceSnapshot(encoded!)).toEqual(configured);
  expect(importWorkspaceSnapshot(JSON.stringify({ ...configured, leader: 'missing' }))).toBeNull();
  expect(importWorkspaceSnapshot(JSON.stringify({ ...configured, panels: [{ ...configured.panels[0], weight: -1 }] }))).toBeNull();
});

it('serializes cooperating writers and rejects the second writer from the same revision', async () => {
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_: string, raw: string) => { value = raw; } };
  const lock = async (operation: () => ReturnType<typeof saveWorkspaceSnapshot>) => operation();
  const [a, b] = await Promise.all([saveWorkspaceSnapshotLocked(storage, draft, null, lock),
    saveWorkspaceSnapshotLocked(storage, draft, null, lock)]);
  expect(a).toMatchObject({ kind: 'saved', snapshot: { revision: 1 } });
  expect(b).toEqual({ kind: 'conflict' });
  expect(await saveWorkspaceSnapshotLocked(storage, draft, 1, () => undefined)).toEqual({ kind: 'lock-unavailable' });
});

it('preserves the last complete revision after stale writes, invalid imports, and storage failure', () => {
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_: string, raw: string) => { value = raw; } };
  expect(saveWorkspaceSnapshot(storage, draft, null)).toMatchObject({ kind: 'saved', snapshot: { revision: 1 } });
  expect(saveWorkspaceSnapshot(storage, draft, null)).toEqual({ kind: 'conflict' });
  expect(saveWorkspaceSnapshot(storage, { ...draft, v: 2 }, 1)).toEqual({ kind: 'invalid' });
  const failed = { ...storage, setItem: () => { throw Error('quota'); } };
  expect(saveWorkspaceSnapshot(failed, draft, 1)).toEqual({ kind: 'storage-failed' });
  expect(loadWorkspaceSnapshot(storage)).toEqual({ kind: 'saved', snapshot: { ...draft, revision: 1 } });
  expect(saveWorkspaceSnapshot(storage, draft, 1)).toMatchObject({ kind: 'saved', snapshot: { revision: 2 } });
});
