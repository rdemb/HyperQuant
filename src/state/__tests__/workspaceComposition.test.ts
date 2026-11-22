import { expect, it } from 'vitest';
import { createWorkspaceFromPreset, exportWorkspaceComposition, importWorkspaceComposition, loadWorkspaceComposition,
  parseWorkspaceComposition, saveWorkspaceCompositionLocked } from '../workspaceComposition';
import { defaultWorkspacePreset as preset } from '../workspaceCompositionExample';
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot, type WorkspaceSnapshot } from '../workspaceSnapshot';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, raw: string) => { data.set(key, raw); } };
};
const lock = async <T>(_key: string, action: () => T) => action();
const legacy: WorkspaceSnapshot = {
  v: 1, id: 'legacy', revision: 0, leader: 'source-a', pinned: ['source-a'], panels: [
    { id: 'source-a', market: 'BTC', marketGroup: 'conflicting', clock: { kind: 'replay', group: 'time', analysisId: 'point-a' }, weight: 20, settings: { bookDepth: 5 } },
    { id: 'source-b', market: 'xyz:GOLD', marketGroup: 'conflicting', clock: { kind: 'replay', group: 'time', analysisId: 'point-b' } },
  ],
};

it('migrates saved V1 without overwriting the original, retaining IDs and settings and detaching ambiguous links', async () => {
  const storage = memory();
  const old = saveWorkspaceSnapshot(storage, legacy, null);
  const migrated = loadWorkspaceComposition(storage);
  expect(migrated).toMatchObject({ kind: 'saved', snapshot: {
    id: 'legacy', v: 2, revision: 1, pinned: ['source-a'], leader: 'source-a',
    cards: [{ id: 'source-a', panels: ['source-a'] }, { id: 'source-b', panels: ['source-b'] }],
    panels: [
      { market: 'BTC', marketGroup: null, clock: { group: null, analysisId: 'point-a', cursorMs: null }, weight: 20, settings: { bookDepth: 5 } },
      { market: 'xyz:GOLD', marketGroup: null, clock: { group: null, analysisId: 'point-b', cursorMs: null } },
    ],
  } });
  if (migrated.kind !== 'saved') throw new Error('migration missing');
  expect(importWorkspaceComposition(JSON.stringify({ ...legacy, revision: 1 }))).toEqual(migrated.snapshot);
  expect(await saveWorkspaceCompositionLocked(storage, migrated.snapshot, 1, { lock })).toMatchObject({ kind: 'saved', snapshot: { revision: 2 } });
  expect(loadWorkspaceSnapshot(storage)).toEqual(old);
});

it('round trips a customized preset in another profile, including an independent replay cursor', async () => {
  const draft = createWorkspaceFromPreset(preset, 'mine');
  if (!draft) throw new Error('preset invalid');
  draft.cards.reverse();
  draft.cards[0].panels = ['observation', 'archive'];
  draft.cards[0].weight = 85;
  draft.pinned = ['history'];
  draft.panels = draft.panels.filter(panel => panel.id !== 'delta');
  draft.panels.push({ id: 'second-flow', kind: 'flow', market: 'xyz:GOLD', marketGroup: null, clock: { kind: 'live' } });
  draft.cards.push({ id: 'secondary', kind: 'card', panels: ['second-flow'] });
  const exported = exportWorkspaceComposition(draft);
  if (!exported) throw new Error('export invalid');
  expect(importWorkspaceComposition(exported)).toEqual(draft);
  const fresh = memory();
  expect(await saveWorkspaceCompositionLocked(fresh, importWorkspaceComposition(exported), null, { slot: 'imported', lock }))
    .toEqual({ kind: 'saved', snapshot: { ...draft, revision: 1 } });
  expect(loadWorkspaceComposition(fresh)).toEqual({ kind: 'missing' });
  expect(loadWorkspaceComposition(fresh, 'imported')).toMatchObject({ snapshot: { panels: draft.panels, cards: draft.cards } });
});

it('rejects inconsistent groups, repeated assignments, orphan panels and pins', () => {
  const [flow, basket, archive, delta, observation] = preset.panels;
  expect(parseWorkspaceComposition({ ...preset, panels: [flow, { ...basket, market: 'xyz:GOLD' }, archive, delta, observation] })).toBeNull();
  expect(parseWorkspaceComposition({ ...preset, panels: [flow, basket, { ...archive, clock: { ...archive.clock, group: 'same' } },
    delta, { ...observation, clock: { ...observation.clock, group: 'same' } }] })).toBeNull();
  expect(parseWorkspaceComposition({ ...preset, cards: [...preset.cards, { id: 'reused', kind: 'card', panels: ['flow'] }] })).toBeNull();
  expect(parseWorkspaceComposition({ ...preset, cards: preset.cards.slice(1) })).toBeNull();
  expect(parseWorkspaceComposition({ ...preset, pinned: ['flow'] })).toBeNull();
  expect(parseWorkspaceComposition({ ...preset, cards: [], panels: [], pinned: [], leader: undefined })).toMatchObject({ cards: [], panels: [] });
});

it('keeps the successful revision on conflicts, denied locks and failing storage', async () => {
  const storage = memory();
  const edits = [preset, { ...preset, pinned: ['history'] }];
  const [winner, loser] = await Promise.all(edits.map(edit => saveWorkspaceCompositionLocked(storage, edit, null, { lock })));
  expect(winner).toMatchObject({ kind: 'saved', snapshot: { revision: 1, pinned: ['markets'] } });
  expect(loser).toEqual({ kind: 'conflict' });
  expect(await saveWorkspaceCompositionLocked(storage, preset, 1, { lock: () => undefined })).toEqual({ kind: 'lock-unavailable' });
  const full = { ...storage, setItem: () => { throw new Error('quota'); } };
  expect(await saveWorkspaceCompositionLocked(full, preset, 1, { lock })).toEqual({ kind: 'storage-failed' });
  expect(loadWorkspaceComposition(storage)).toEqual(winner);
});

it('keeps a panel pin independent of its group when the panel moves and the workspace is transferred', async () => {
  const storage = memory();
  expect(parseWorkspaceComposition(preset)).toEqual(preset);
  const original = await saveWorkspaceCompositionLocked(storage, { ...preset, pinnedPanels: ['basket'] }, null, { lock });
  if (original.kind !== 'saved') throw new Error('save failed');
  expect(original.snapshot.pinned).toEqual(['markets']);
  expect(original.snapshot.pinnedPanels).toEqual(['basket']);

  const moved = {
    ...original.snapshot,
    cards: [
      { ...original.snapshot.cards[0], panels: ['flow'] },
      { ...original.snapshot.cards[1], panels: ['basket', ...original.snapshot.cards[1].panels] },
    ],
  };
  const encoded = exportWorkspaceComposition(moved);
  if (!encoded) throw new Error('export failed');
  const fresh = memory();
  expect(await saveWorkspaceCompositionLocked(fresh, importWorkspaceComposition(encoded), null, { lock }))
    .toEqual({ kind: 'saved', snapshot: moved });
  expect(loadWorkspaceComposition(fresh)).toMatchObject({ snapshot: { pinned: ['markets'], pinnedPanels: ['basket'] } });
  expect(parseWorkspaceComposition({ ...moved, pinnedPanels: ['history'] })).toBeNull();
  expect(parseWorkspaceComposition({ ...moved, pinnedPanels: ['basket', 'basket'] })).toBeNull();
  expect(parseWorkspaceComposition({ ...moved, cards: [], panels: [], pinned: [], leader: undefined })).toBeNull();
});
