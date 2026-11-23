import { useId, useState } from 'react';
import { deskMarketOf } from '../../config/deskMarkets';
import { locale, tr } from '../../i18n';
import {
  exportWorkspaceSnapshot, importWorkspaceSnapshot, loadWorkspaceSnapshot, saveWorkspaceSnapshotLocked,
  type WorkspacePanel, type WorkspaceSnapshot,
} from '../../state/workspaceSnapshot';
import './tradeOrderQuestion.css';

const SNAPSHOT_ID = 'orderflow';
const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const panelIdFor = (coin: string) => `of-${(deskMarketOf(coin)?.slug ?? coin).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 48);

type LadderSettings = Required<Omit<NonNullable<WorkspacePanel['settings']>, 'interval'>>;
const defaultSettings: LadderSettings = { tapeMinimumUsd: 0, bookDepth: 10 };
const settingsFor = (snapshot: WorkspaceSnapshot, coin: string) => snapshot.panels.find(
  p => p.id === panelIdFor(coin) && p.market === coin && p.clock.kind === 'live',
)?.settings;

export function savedLadderSettings(coin: string): LadderSettings {
  const s = storage();
  const loaded = s && loadWorkspaceSnapshot(s);
  return { ...defaultSettings, ...(loaded?.kind === 'saved' ? settingsFor(loaded.snapshot, coin) : undefined) };
}

const usd = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });

export function WorkspaceSave({ coin, settings, apply }: { coin: string; settings: LadderSettings; apply: (settings: LadderSettings) => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const importId = useId();
  const panelId = panelIdFor(coin);
  const current = () => { const s = storage(); return s ? loadWorkspaceSnapshot(s) : { kind: 'unreadable' as const }; };

  const write = async (snapshot: Omit<WorkspaceSnapshot, 'revision'>, expected: number | null, done: (s: WorkspaceSnapshot) => string) => {
    const s = storage();
    if (!s) { setStatus(tr('Pamięć przeglądarki jest niedostępna. Nic nie zapisano.', 'Browser storage is unavailable. Nothing was saved.')); return; }
    const res = await saveWorkspaceSnapshotLocked(s, { ...snapshot, revision: expected ?? 0 }, expected);
    setStatus(res.kind === 'saved' ? done(res.snapshot)
      : res.kind === 'conflict' ? tr('Inna karta zapisała stanowisko w międzyczasie. Nic nie nadpisano: wczytaj zapisane i spróbuj ponownie.', 'Another tab saved the workspace meanwhile. Nothing was overwritten: load the saved one and try again.')
        : res.kind === 'invalid' ? tr('Dane stanowiska są nieprawidłowe. Nic nie zapisano.', 'The workspace data is invalid. Nothing was saved.')
          : res.kind === 'lock-unavailable' ? tr('Przeglądarka nie daje blokady zapisu między kartami. Nic nie zapisano.', 'The browser offers no cross-tab write lock. Nothing was saved.')
            : tr('Zapis w pamięci przeglądarki się nie udał. Nic nie zmieniono.', 'Writing to browser storage failed. Nothing changed.'));
  };

  const save = () => {
    const loaded = current();
    if (loaded.kind === 'unreadable') { setStatus(tr('Zapisane stanowisko jest nieczytelne. Nic nie nadpisano.', 'The saved workspace is unreadable. Nothing was overwritten.')); return; }
    const base = loaded.kind === 'saved' ? loaded.snapshot : null;
    const existing = base?.panels.find(p => p.id === panelId);
    if (existing && (existing.market !== coin || existing.clock.kind !== 'live')) {
      setStatus(tr('Zapisany panel ma inny rynek lub zegar.', 'The saved panel has a different market or clock.'));
      return;
    }
    const panel: WorkspacePanel = { id: panelId, market: coin, marketGroup: null, clock: { kind: 'live' }, ...existing, settings };
    const panels = existing ? base!.panels.map(p => p.id === panelId ? panel : p) : [...(base?.panels ?? []), panel];
    void write({ v: 1, id: base?.id ?? SNAPSHOT_ID, panels, pinned: base?.pinned ?? [], preset: base?.preset, leader: base?.leader ?? panelId },
      base?.revision ?? null,
      s => tr(`Zapisano ustawienia drabinki ${coin} · rewizja ${s.revision}.`, `Saved the ${coin} ladder settings · revision ${s.revision}.`));
  };
  const load = () => {
    const loaded = current();
    if (loaded.kind !== 'saved') { setStatus(loaded.kind === 'missing' ? tr('Brak zapisanego stanowiska.', 'No saved workspace.') : tr('Zapisane stanowisko jest nieczytelne.', 'The saved workspace is unreadable.')); return; }
    const saved = settingsFor(loaded.snapshot, coin);
    if (!saved) { setStatus(tr(`Brak ustawień dla ${coin}.`, `No settings for ${coin}.`)); return; }
    apply({ ...defaultSettings, ...saved });
    setStatus(tr(`Wczytano ustawienia drabinki · rewizja ${loaded.snapshot.revision}.`, `Loaded the ladder settings · revision ${loaded.snapshot.revision}.`));
  };
  const doExport = () => {
    const loaded = current();
    const json = loaded.kind === 'saved' ? exportWorkspaceSnapshot(loaded.snapshot) : null;
    setExported(json);
    setStatus(json ? null : tr('Najpierw zapisz stanowisko.', 'Save the workspace first.'));
  };
  const doImport = () => {
    const snapshot = importWorkspaceSnapshot(draft.trim());
    if (!snapshot) { setStatus(tr('Plik stanowiska jest nieprawidłowy. Nic nie zmieniono.', 'The workspace file is invalid. Nothing changed.')); return; }
    const loaded = current();
    if (loaded.kind === 'unreadable') { setStatus(tr('Zapisane stanowisko jest nieczytelne. Nic nie nadpisano.', 'The saved workspace is unreadable. Nothing was overwritten.')); return; }
    const { revision: _r, ...rest } = snapshot;
    void write(rest, loaded.kind === 'saved' ? loaded.snapshot.revision : null, s => {
      const saved = settingsFor(s, coin);
      apply({ ...defaultSettings, ...saved });
      return saved ? tr(`Zaimportowano stanowisko · rewizja ${s.revision}.`, `Imported the workspace · revision ${s.revision}.`)
        : tr(`Zaimportowano stanowisko · rewizja ${s.revision} · ${coin} używa ustawień domyślnych.`,
          `Imported the workspace · revision ${s.revision} · ${coin} is using defaults.`);
    });
  };

  return <details className="oc-workspace-save">
    <summary>{tr('Stanowisko: zapis, eksport i import', 'Workspace: save, export and import')}</summary>
    <p className="oc-order-source">{tr(
      `Ustawienia ${coin} · próg taśmy ${usd.format(settings.tapeMinimumUsd)} USD · głębokość ${settings.bookDepth} na stronę. Zapis w tej przeglądarce.`,
      `${coin} settings · tape threshold ${usd.format(settings.tapeMinimumUsd)} USD · depth ${settings.bookDepth} per side. Saved in this browser.`)}
    </p>
    <div className="oc-workspace-actions">
      <button type="button" onClick={save}>{tr('Zapisz', 'Save')}</button>
      <button type="button" onClick={load}>{tr('Wczytaj zapisane', 'Load saved')}</button>
      <button type="button" onClick={doExport}>{tr('Eksportuj', 'Export')}</button>
    </div>
    {exported && <textarea readOnly aria-label={tr('Eksport stanowiska (JSON)', 'Workspace export (JSON)')} value={exported} rows={3} onFocus={e => e.currentTarget.select()} />}
    <label htmlFor={importId}>{tr('Import: wklej JSON stanowiska', 'Import: paste workspace JSON')}</label>
    <textarea id={importId} rows={3} value={draft} onChange={e => setDraft(e.currentTarget.value)} />
    <div className="oc-workspace-actions"><button type="button" onClick={doImport} disabled={!draft.trim()}>{tr('Importuj', 'Import')}</button></div>
    <p role="status" aria-live="polite" className="oc-workspace-status">{status}</p>
  </details>;
}
