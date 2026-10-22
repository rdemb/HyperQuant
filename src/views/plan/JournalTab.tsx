import React, { useMemo, useRef, useState } from 'react';
import { useJournal } from '../../state/useJournal';
import { Badge, EmptyState, Panel, Segmented, DASH, fmtPrice } from '../../ui';
import { rMultiple, setupStats, type Setup, type Trade } from '../../utils/tradeJournal';
import { parseNum } from './hooks';

const inputCls =
  'w-full h-11 sm:h-9 bg-page border border-line rounded-md px-2.5 text-sm font-mono tabular-nums text-ink-1 placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const textCls =
  'w-full min-h-[3.5rem] bg-page border border-line rounded-md px-2.5 py-1.5 text-sm text-ink-1 placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const btnCls = 'h-9 px-3 rounded-md border border-line-strong bg-surface-2 text-xs text-ink-1 hover:bg-surface-3 disabled:opacity-50';
const dtFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Statystyki per setup dopiero od 20 zamkniętych zagrań — mniej to anegdota */
const MIN_N = 20;
/** Przedział bootstrap od 5 zagrań (przy 1–4 losowanie ze zwracaniem daje przedział zdegenerowany) */
const MIN_CI_N = 5;

const fmtR = (r: number | null, d = 2) => (r === null || !Number.isFinite(r) ? DASH : `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(d)}R`);
const pct = (p: number) => `${Math.round(p * 100)}%`;
/** Wartość pola datetime-local (czas lokalny przeglądarki) → ms; puste/niepoprawne → null. */
const parseLocal = (s: string): number | null => {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
};
const nowLocal = () => {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

/** Zakładka „Dziennik zagrań”: playbook (setupy), zapis zagrań, wyniki per setup z niepewnością. Dane tylko w tej przeglądarce. */
export const JournalTab: React.FC = () => {
  const j = useJournal();
  const names = useMemo(() => new Map(j.journal.setups.map((s) => [s.id, s.name])), [j.journal.setups]);
  return (
    <div className="flex flex-col gap-4">
      {j.saveError && (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Nie udało się zapisać dziennika w pamięci przeglądarki (pełna albo zablokowana). Zmiany są tylko w tej karcie — wyeksportuj JSON, żeby ich
          nie stracić.
        </div>
      )}
      {j.recovered && (
        <div role="status" className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs text-ink-2">
          Zapisany dziennik był nieczytelny — jego kopia została zachowana w pamięci przeglądarki pod kluczem <code>{j.recovered}</code>, a dziennik
          zaczyna się od nowa.
        </div>
      )}
      <Panel
        eyebrow="Twoje zagrania · dane tylko w tej przeglądarce"
        title="Wyniki per setup"
        actions={<ImportExport onDownload={j.download} onImport={j.importJson} />}
      >
        <StatsTable setups={j.journal.setups} trades={j.journal.trades} />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel eyebrow="Kontekst → lokalizacja → wyzwalacz → wykonanie" title="Playbook">
          <Playbook setups={j.journal.setups} onAdd={j.addSetup} onRemove={j.removeSetup} />
        </Panel>
        <Panel eyebrow="R od stopu początkowego · MAE/MFE ze świec 1m Hyperliquid" title="Nowe zagranie">
          <TradeForm setups={j.journal.setups} onAdd={j.addTrade} />
        </Panel>
      </div>
      <Panel eyebrow={`${j.journal.trades.length} zapisanych`} title="Zagrania">
        <TradeList trades={j.journal.trades} names={names} onRemove={j.removeTrade} />
      </Panel>
    </div>
  );
};

const ImportExport: React.FC<{ onDownload: () => void; onImport: (text: string) => number | null }> = ({ onDownload, onImport }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[11px] text-ink-3">{msg}</span>}
      <button type="button" className={btnCls} onClick={onDownload}>
        Eksport JSON
      </button>
      <button type="button" className={btnCls} onClick={() => ref.current?.click()}>
        Import
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const n = onImport(await f.text());
          setMsg(n === null ? 'To nie jest plik dziennika HyperQuant' : n === 0 ? 'Nic nowego — wszystkie wpisy już są w dzienniku' : `Dodano ${n} nowych wpisów`);
          e.target.value = '';
        }}
      />
    </span>
  );
};

const StatsTable: React.FC<{ setups: Setup[]; trades: Trade[] }> = ({ setups, trades: raw }) => {
  // Zagranie z setupem, którego już nie ma, liczy się jako „bez setupu” (nie znika ze statystyk)
  const known = new Set(setups.map((s) => s.id));
  const trades = raw.map((t) => (t.setupId !== null && !known.has(t.setupId) ? { ...t, setupId: null } : t));
  const rows = [...setups.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: 'Bez setupu' }]
    .map((r) => ({ ...r, s: setupStats(trades, r.id) }))
    .filter((r) => r.s.n + r.s.open > 0);
  if (rows.length === 0)
    return (
      <EmptyState
        title="Brak zapisanych zagrań"
        detail="Dodaj setup do playbooka i zapisuj zagrania — tu pojawi się trafność z przedziałem ufności, średni wynik w R, profit factor i to, jak głęboko szły przeciw Tobie zwycięskie zagrania."
      />
    );
  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Wyniki zagrań per setup z przedziałami ufności</caption>
        <thead className="text-ink-3 text-[10px] uppercase tracking-wide">
          <tr>
            <th className="py-1 pr-3 font-medium">Setup</th>
            <th className="py-1 pr-3 font-medium">n</th>
            <th className="py-1 pr-3 font-medium" title="Przedział Wilsona 95%">Trafność (95%)</th>
            <th className="py-1 pr-3 font-medium" title="Przedział bootstrap 90% (2000 losowań)">Średnio (90%)</th>
            <th className="py-1 pr-3 font-medium" title="Σ zysków R / |Σ strat R|">PF</th>
            <th className="py-1 pr-3 font-medium" title="Mediana MAE zagrań wygranych — jak głęboko szły przeciw, zanim wygrały">MAE wygr.</th>
            <th className="py-1 font-medium" title="Mediana MFE zagrań przegranych — ile dały zarobić, zanim przegrały">MFE przegr.</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map(({ id, name, s }) => (
            <tr key={id ?? 'none'} className="border-t border-line align-baseline">
              <td className="py-1.5 pr-3 font-sans text-ink-1">
                {name}
                {s.n < MIN_N && <span className="ml-1.5 text-[10px] text-warn font-sans">mała próba</span>}
              </td>
              <td className="py-1.5 pr-3">
                {s.n}
                {s.open > 0 && <span className="text-ink-3"> +{s.open} otw.</span>}
              </td>
              <td className="py-1.5 pr-3">
                {s.winRate ? (
                  <>
                    {pct(s.winRate.p)} <span className="text-[10px] text-ink-3">({pct(s.winRate.lo)}–{pct(s.winRate.hi)})</span>
                  </>
                ) : (
                  DASH
                )}
              </td>
              <td className="py-1.5 pr-3">
                {fmtR(s.meanR)}{' '}
                {s.meanCi && s.n >= MIN_CI_N && (
                  <span className="text-[10px] text-ink-3">
                    ({fmtR(s.meanCi.lo, 1)} … {fmtR(s.meanCi.hi, 1)})
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3">{s.profitFactor !== null ? s.profitFactor.toFixed(2) : s.wins > 0 ? <span className="font-sans text-ink-3">brak strat</span> : DASH}</td>
              <td className="py-1.5 pr-3">{fmtR(s.medMaeWinners)}</td>
              <td className="py-1.5">{fmtR(s.medMfeLosers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-ink-3 leading-relaxed">
        Poniżej {MIN_N} zamkniętych zagrań to anegdota, nie statystyka — przedziały pokazują, jak szeroka jest niepewność. Przedział średniego R obejmujący
        zero znaczy: przewaga nieudowodniona. Trafność = udział zagrań z wynikiem powyżej 0R (wynik 0R nie jest ani wygraną, ani stratą).
      </p>
    </div>
  );
};

const FIELDS: { key: keyof Omit<Setup, 'id' | 'createdAt' | 'name'>; label: string; ph: string }[] = [
  { key: 'context', label: 'Kontekst', ph: 'np. otwarcie nad VA wczoraj, cena nad VWAP' },
  { key: 'location', label: 'Lokalizacja', ph: 'np. powrót do VAH / IB high' },
  { key: 'trigger', label: 'Wyzwalacz', ph: 'np. absorpcja sprzedaży, OFI odwraca się' },
  { key: 'execution', label: 'Wykonanie', ph: 'np. wejście limit, stop za poziomem, cel POC' },
  { key: 'invalidation', label: 'Unieważnienie', ph: 'np. akceptacja poniżej VAL (2 zamknięcia)' },
];

const Playbook: React.FC<{ setups: Setup[]; onAdd: (s: Omit<Setup, 'id' | 'createdAt'>) => void; onRemove: (id: string) => void }> = ({ setups, onAdd, onRemove }) => {
  const blank = { name: '', context: '', location: '', trigger: '', execution: '', invalidation: '' };
  const [f, setF] = useState(blank);
  return (
    <div className="flex flex-col gap-4 p-4">
      {setups.length > 0 && (
        <ul className="flex flex-col gap-2">
          {setups.map((s) => (
            <li key={s.id} className="rounded-lg border border-line p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-1 font-medium">{s.name}</span>
                <button
                  type="button"
                  className="text-[11px] text-ink-3 hover:text-sell-ink"
                  onClick={() => {
                    if (window.confirm(`Usunąć setup „${s.name}”? Jego zagrania przejdą do „bez setupu”.`)) onRemove(s.id);
                  }}
                  aria-label={`Usuń setup ${s.name}`}
                >
                  usuń
                </button>
              </div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-ink-2">
                {FIELDS.filter((x) => s[x.key]).map((x) => (
                  <React.Fragment key={x.key}>
                    <dt className="text-ink-3">{x.label}</dt>
                    <dd>{s[x.key]}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.name.trim()) return;
          onAdd({ ...f, name: f.name.trim() });
          setF(blank);
        }}
      >
        <label className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium" htmlFor="pb-name">
          Nowy setup
        </label>
        <input id="pb-name" className={inputCls + ' font-sans'} placeholder="Nazwa, np. „Odrzucenie VAH”" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        {FIELDS.map((x) => (
          <textarea key={x.key} aria-label={x.label} className={textCls} placeholder={`${x.label}: ${x.ph}`} value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />
        ))}
        <button type="submit" className={btnCls} disabled={!f.name.trim()}>
          Dodaj do playbooka
        </button>
      </form>
    </div>
  );
};

const TradeForm: React.FC<{ setups: Setup[]; onAdd: (t: Omit<Trade, 'id' | 'mae' | 'mfe' | 'ctx'>) => Promise<void> }> = ({ setups, onAdd }) => {
  const [dir, setDir] = useState<'LONG' | 'SHORT'>('LONG');
  const [setupId, setSetupId] = useState<string>('');
  const [f, setF] = useState({ entryT: nowLocal(), entry: '', stop: '', exitT: '', exit: '', size: '', note: '' });
  const [busy, setBusy] = useState(false);
  // Setup usunięty w playbooku w trakcie wypełniania — formularz wraca do „bez setupu”
  const chosen = setups.some((s) => s.id === setupId) ? setupId : '';
  const entryPx = parseNum(f.entry);
  const stopPx = parseNum(f.stop);
  const exitPx = f.exit ? parseNum(f.exit) : null;
  const entryT = parseLocal(f.entryT);
  const exitT = parseLocal(f.exitT);
  const now = Date.now() + 60_000; // minuta zapasu na zaokrąglenie pola czasu
  const entryOk = entryPx > 0 && entryT !== null && entryT <= now;
  const stopOk = entryOk && stopPx > 0 && (dir === 'LONG' ? stopPx < entryPx : stopPx > entryPx);
  const exitOk =
    (exitPx === null && exitT === null) || (exitPx !== null && exitPx > 0 && exitT !== null && entryT !== null && exitT >= entryT && exitT <= now);
  const valid = entryOk && stopOk && exitOk;
  const preview = valid && exitPx !== null ? rMultiple({ dir, entryPx, stopPx, exitPx } as Trade) : null;
  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        const size = parseNum(f.size);
        // Pola czyszczone od razu (nie po wzbogaceniu — wpisywanie w trakcie nie jest nadpisywane), czas wejścia odświeżony
        setF((cur) => ({ ...cur, entryT: nowLocal(), entry: '', stop: '', exitT: '', exit: '', size: '', note: '' }));
        await onAdd({
          setupId: chosen || null,
          dir,
          entryT: entryT!,
          entryPx,
          stopPx,
          exitT,
          exitPx,
          sizeBtc: Number.isFinite(size) && size > 0 ? size : null,
          note: f.note.trim(),
        });
        setBusy(false);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Segmented<'LONG' | 'SHORT'>
          ariaLabel="Kierunek zagrania"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'LONG', label: <span><span className="text-buy-ink" aria-hidden="true">▲</span> LONG</span> },
            { value: 'SHORT', label: <span><span className="text-sell-ink" aria-hidden="true">▼</span> SHORT</span> },
          ]}
        />
        <select aria-label="Setup" className={inputCls + ' font-sans w-auto min-w-[10rem]'} value={chosen} onChange={(e) => setSetupId(e.target.value)}>
          <option value="">Bez setupu</option>
          {setups.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <L label="Wejście — czas (lokalny)" hint={entryT !== null && entryT > now ? 'czas w przyszłości' : undefined}>
          <input type="datetime-local" className={inputCls} value={f.entryT} aria-invalid={entryT !== null && entryT > now} onChange={(e) => setF({ ...f, entryT: e.target.value })} />
        </L>
        <L label="Wejście — cena">
          <input className={inputCls} inputMode="decimal" value={f.entry} aria-invalid={f.entry !== '' && !(entryPx > 0)} onChange={(e) => setF({ ...f, entry: e.target.value })} />
        </L>
        <L label="Stop początkowy (1R)" hint={f.stop && !stopOk ? `stop musi być ${dir === 'LONG' ? 'poniżej' : 'powyżej'} wejścia` : undefined}>
          <input className={inputCls} inputMode="decimal" value={f.stop} aria-invalid={f.stop !== '' && !stopOk} onChange={(e) => setF({ ...f, stop: e.target.value })} />
        </L>
        <L label="Wielkość (BTC, opcjonalnie)">
          <input className={inputCls} inputMode="decimal" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} />
        </L>
        <L label="Wyjście — czas (lokalny)" hint="puste = zagranie otwarte">
          <input type="datetime-local" className={inputCls} value={f.exitT} aria-invalid={!exitOk} onChange={(e) => setF({ ...f, exitT: e.target.value })} />
        </L>
        <L label="Wyjście — cena" hint={!exitOk ? 'podaj czas (po wejściu, nie w przyszłości) i cenę wyjścia' : undefined}>
          <input className={inputCls} inputMode="decimal" value={f.exit} aria-invalid={!exitOk} onChange={(e) => setF({ ...f, exit: e.target.value })} />
        </L>
      </div>
      <textarea aria-label="Notatka" className={textCls} placeholder="Notatka: co widziałeś, co zrobiłeś, czego się nauczyłeś" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-2">
          Wynik: <span className="font-mono tabular-nums text-ink-1">{fmtR(preview)}</span>
          <span className="ml-2 text-[11px] text-ink-3">MAE/MFE i kontekst aukcji z danych rynku (ostatnie ~3,5 doby)</span>
        </span>
        <button type="submit" className={btnCls} disabled={!valid || busy}>
          {busy ? 'Zapisuję…' : 'Zapisz zagranie'}
        </button>
      </div>
    </form>
  );
};

const L: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1 min-w-0">
    <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{label}</span>
    {children}
    {hint && <span className="text-[10px] text-ink-3">{hint}</span>}
  </label>
);

const TradeList: React.FC<{ trades: Trade[]; names: Map<string, string>; onRemove: (id: string) => void }> = ({ trades, names, onRemove }) => {
  if (trades.length === 0) return <div className="p-4 text-xs text-ink-3">Dziennik jest pusty.</div>;
  return (
    <>
    {trades.length > 100 && <div className="px-4 pt-3 text-[11px] text-ink-3">Pokazano 100 najnowszych z {trades.length} — pełna lista w eksporcie JSON.</div>}
    <ul className="flex flex-col divide-y divide-line">
      {trades.slice(0, 100).map((t) => {
        const r = rMultiple(t);
        return (
          <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-xs">
            <span className="text-ink-3">{dtFmt.format(t.entryT)}</span>
            <span className={t.dir === 'LONG' ? 'text-buy-ink' : 'text-sell-ink'}>{t.dir === 'LONG' ? '▲ LONG' : '▼ SHORT'}</span>
            <span className="text-ink-1">{t.setupId ? names.get(t.setupId) ?? 'usunięty setup' : 'bez setupu'}</span>
            <span className="font-mono tabular-nums text-ink-2">
              {fmtPrice(t.entryPx, 0)} → {t.exitPx === null ? 'otwarte' : fmtPrice(t.exitPx, 0)}
            </span>
            <span className={`font-mono tabular-nums ${r === null || r === 0 ? 'text-ink-3' : r > 0 ? 'text-buy-ink' : 'text-sell-ink'}`}>{fmtR(r)}</span>
            {(t.mae !== null || t.mfe !== null) && (
              <span className="font-mono tabular-nums text-ink-3" title="Najgorszy / najlepszy ruch w trakcie, w R">
                MAE {fmtR(t.mae, 1)} · MFE {fmtR(t.mfe, 1)}
              </span>
            )}
            {t.ctx && (
              <span className="flex gap-1">
                {t.ctx.vwapZ !== null && <Badge tone="neutral">VWAP {t.ctx.vwapZ >= 0 ? '+' : '−'}{Math.abs(t.ctx.vwapZ).toFixed(1)}σ</Badge>}
                {t.ctx.openLoc && <Badge tone="neutral">otw. {t.ctx.openLoc === 'above' ? 'nad VA' : t.ctx.openLoc === 'below' ? 'pod VA' : 'w VA'}</Badge>}
                {t.ctx.ib && <Badge tone="neutral">IB {t.ctx.ib}</Badge>}
              </span>
            )}
            {t.note && <span className="w-full text-ink-3">{t.note}</span>}
            <button
              type="button"
              className="ml-auto text-[11px] text-ink-3 hover:text-sell-ink"
              onClick={() => {
                if (window.confirm(`Usunąć zagranie z ${dtFmt.format(t.entryT)}?`)) onRemove(t.id);
              }}
              aria-label={`Usuń zagranie z ${dtFmt.format(t.entryT)}`}
            >
              usuń
            </button>
          </li>
        );
      })}
    </ul>
    </>
  );
};
