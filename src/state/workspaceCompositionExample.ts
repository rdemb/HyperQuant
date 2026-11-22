import type { WorkspaceComposition } from './workspaceComposition';

export const defaultWorkspacePreset: WorkspaceComposition = {
  v: 2, id: 'market-workbench', revision: 0, leader: 'flow', pinned: ['markets'],
  cards: [
    { id: 'markets', kind: 'group', panels: ['flow', 'basket'], weight: 60 },
    { id: 'history', kind: 'group', panels: ['archive', 'delta', 'observation'], weight: 40 },
  ],
  panels: [
    { id: 'flow', kind: 'flow', market: 'BTC', marketGroup: 'btc-perp', clock: { kind: 'live' }, settings: { bookDepth: 10, tapeMinimumUsd: 1000 } },
    { id: 'basket', kind: 'basket', market: 'BTC', marketGroup: 'btc-perp', clock: { kind: 'live' } },
    { id: 'archive', kind: 'archive', market: 'BTC', marketGroup: null, clock: { kind: 'replay', group: null, analysisId: 'btc-08', cursorMs: 1795163416997 } },
    { id: 'delta', kind: 'delta', market: 'BTC', marketGroup: 'btc-perp', clock: { kind: 'live' } },
    { id: 'observation', kind: 'observation', market: 'BTC', marketGroup: null, clock: { kind: 'replay', group: null, analysisId: 'level-978', cursorMs: 1795159794010 } },
  ],
};
