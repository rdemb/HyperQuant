import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { loadCandlesV } from '../utils/marketDataFeed';
import { dayStart } from '../utils/auction';
import { computeAuctionContext } from './useAuctionContext';
import { createJournalStore, JOURNAL_KEY, type StorageLike } from './journalStore';
import { excursions, parseJournal, serializeJournal, type Setup, type Trade, type TradeCtx } from '../utils/tradeJournal';
import { tr } from '../i18n';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Hyperliquid udostępnia ~5000 ostatnich świec 1m (≈ 3,5 doby) — starsze zagrania bez MAE/MFE i kontekstu */
const MINUTE_HISTORY = 3.4 * DAY;

/**
 * MAE/MFE i kontekst aukcji przy wejściu ze świec 1m (zagrania z ostatnich ~3,5 doby); inaczej null. Kontekst tylko gdy
 * świece obejmują całą sesję do wejścia (VWAP z części sesji byłby fałszywy) — wyłącznie z danych sprzed minuty wejścia.
 */
export async function enrichTrade(t: Trade, now = Date.now()): Promise<Pick<Trade, 'mae' | 'mfe' | 'ctx'>> {
  if (now - t.entryT > MINUTE_HISTORY) return { mae: null, mfe: null, ctx: null };
  const from = Math.max(dayStart(t.entryT) - DAY, now - MINUTE_HISTORY);
  const [minute, hourly] = await Promise.all([loadCandlesV('1m', from), loadCandlesV('1h', dayStart(t.entryT) - 2 * DAY)]);
  const ex = t.exitT !== null ? excursions(t, minute) : null;
  let ctx: TradeCtx | null = null;
  const entryMin = Math.floor(t.entryT / MIN) * MIN;
  const before = minute.filter((b) => b.time < entryMin);
  if (minute.length && minute[0].time <= dayStart(t.entryT) && before.length) {
    const c = computeAuctionContext(before, hourly, t.entryT);
    const ib = !c.ib ? null : !c.ib.done ? 'w trakcie' : c.today ? (c.today.ibBreak.up && c.today.ibBreak.down ? 'wybity ↑↓' : c.today.ibBreak.up ? 'wybity ↑' : c.today.ibBreak.down ? 'wybity ↓' : 'w zakresie') : null;
    ctx = {
      vwapZ: c.vwap && c.vwap.sd > 0 ? Math.round(((t.entryPx - c.vwap.vwap) / c.vwap.sd) * 100) / 100 : null,
      openLoc: c.today?.openLoc ?? null,
      ib,
    };
  }
  return { mae: ex?.mae ?? null, mfe: ex?.mfe ?? null, ctx };
}

/** localStorage, jeśli dostępny (tryb prywatny / zablokowana pamięć → null: dziennik tylko w tej karcie). */
function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Jeden magazyn na stronę — niezależny od montowania zakładki (wzbogacenie zagrania nie ginie po przełączeniu widoku). */
const store = createJournalStore(browserStorage());

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Dziennik zagrań i playbook w localStorage (`hq.journal.v1`), wspólny dla kart przeglądarki. */
export function useJournal() {
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  // Zmiany z innej karty (zdarzenie `storage`)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === JOURNAL_KEY) store.reload();
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);

  const addSetup = useCallback((s: Omit<Setup, 'id' | 'createdAt'>) => {
    // Identyfikator i czas poza funkcją aktualizującą (czystą)
    const setup: Setup = { ...s, id: uid(), createdAt: Date.now() };
    store.update((j) => ({ ...j, setups: [...j.setups, setup] }));
  }, []);
  const removeSetup = useCallback(
    (id: string) => store.update((j) => ({ ...j, setups: j.setups.filter((s) => s.id !== id), trades: j.trades.map((t) => (t.setupId === id ? { ...t, setupId: null } : t)) })),
    []
  );
  const addTrade = useCallback(async (t: Omit<Trade, 'id' | 'mae' | 'mfe' | 'ctx'>) => {
    const base: Trade = { ...t, id: uid(), mae: null, mfe: null, ctx: null };
    store.update((j) => ({ ...j, trades: [base, ...j.trades] }));
    try {
      const extra = await enrichTrade(base);
      store.update((j) => ({ ...j, trades: j.trades.map((x) => (x.id === base.id ? { ...x, ...extra } : x)) }));
    } catch {
      // brak danych rynku — zagranie zostaje bez MAE/MFE
    }
  }, []);
  const removeTrade = useCallback((id: string) => store.update((j) => ({ ...j, trades: j.trades.filter((t) => t.id !== id) })), []);
  /** Import: liczba faktycznie dodanych wpisów (duplikaty pomijane); niepoprawny plik → null. */
  const importJson = useCallback((text: string): number | null => {
    const p = parseJournal(text);
    if (!p) return null;
    let added = 0;
    store.update((j) => {
      const sIds = new Set(j.setups.map((s) => s.id));
      const tIds = new Set(j.trades.map((t) => t.id));
      const ns = p.setups.filter((s) => !sIds.has(s.id));
      const nt = p.trades.filter((t) => !tIds.has(t.id));
      added = ns.length + nt.length;
      return { v: 1, setups: [...j.setups, ...ns], trades: [...j.trades, ...nt] };
    });
    return added;
  }, []);
  const download = useCallback(() => {
    const blob = new Blob([serializeJournal(store.get().journal)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hyperquant-${tr('zagrania', 'trades')}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  return { journal: snap.journal, saveError: snap.saveError, recovered: snap.recovered, addSetup, removeSetup, addTrade, removeTrade, importJson, download };
}
