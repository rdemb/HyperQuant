import { useCallback, useState } from 'react';
import { loadCandlesV } from '../utils/marketDataFeed';
import { dayStart } from '../utils/auction';
import { computeAuctionContext } from './useAuctionContext';
import { excursions, parseJournal, serializeJournal, type Journal, type Setup, type Trade, type TradeCtx } from '../utils/tradeJournal';

const KEY = 'hq.journal.v1';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Hyperliquid udostępnia ~5000 ostatnich świec 1m (≈ 3,5 doby) — starsze zagrania bez MAE/MFE i kontekstu */
const MINUTE_HISTORY = 3.4 * DAY;

const EMPTY: Journal = { v: 1, setups: [], trades: [] };

function load(): Journal {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? parseJournal(raw) ?? EMPTY : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(j: Journal): void {
  try {
    window.localStorage.setItem(KEY, serializeJournal(j));
  } catch {
    // tryb prywatny / pełny storage — dziennik tylko w tej sesji
  }
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** MAE/MFE i kontekst aukcji przy wejściu ze świec 1m (zagrania z ostatnich ~3,5 doby); inaczej null. */
export async function enrichTrade(t: Trade, now = Date.now()): Promise<Pick<Trade, 'mae' | 'mfe' | 'ctx'>> {
  if (now - t.entryT > MINUTE_HISTORY) return { mae: null, mfe: null, ctx: null };
  const from = Math.max(dayStart(t.entryT) - DAY, now - MINUTE_HISTORY);
  const [minute, hourly] = await Promise.all([loadCandlesV('1m', from), loadCandlesV('1h', dayStart(t.entryT) - 2 * DAY)]);
  const ex = t.exitT !== null ? excursions(t, minute) : null;
  let ctx: TradeCtx | null = null;
  const before = minute.filter((b) => b.time < Math.floor(t.entryT / MIN) * MIN);
  if (before.length) {
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

/** Dziennik zagrań i playbook w localStorage (`hq.journal.v1`). */
export function useJournal() {
  const [journal, setJournal] = useState<Journal>(load);
  const update = useCallback((f: (j: Journal) => Journal) => {
    setJournal((j) => {
      const next = f(j);
      save(next);
      return next;
    });
  }, []);

  const addSetup = useCallback((s: Omit<Setup, 'id' | 'createdAt'>) => update((j) => ({ ...j, setups: [...j.setups, { ...s, id: uid(), createdAt: Date.now() }] })), [update]);
  const removeSetup = useCallback(
    (id: string) => update((j) => ({ ...j, setups: j.setups.filter((s) => s.id !== id), trades: j.trades.map((t) => (t.setupId === id ? { ...t, setupId: null } : t)) })),
    [update]
  );
  const addTrade = useCallback(
    async (t: Omit<Trade, 'id' | 'mae' | 'mfe' | 'ctx'>) => {
      const id = uid();
      const base: Trade = { ...t, id, mae: null, mfe: null, ctx: null };
      update((j) => ({ ...j, trades: [base, ...j.trades] }));
      try {
        const extra = await enrichTrade(base);
        update((j) => ({ ...j, trades: j.trades.map((x) => (x.id === id ? { ...x, ...extra } : x)) }));
      } catch {
        // brak danych rynku — zagranie zostaje bez MAE/MFE
      }
    },
    [update]
  );
  const removeTrade = useCallback((id: string) => update((j) => ({ ...j, trades: j.trades.filter((t) => t.id !== id) })), [update]);
  const importJson = useCallback(
    (text: string): number | null => {
      const p = parseJournal(text);
      if (!p) return null;
      update((j) => {
        const sIds = new Set(j.setups.map((s) => s.id));
        const tIds = new Set(j.trades.map((t) => t.id));
        return { v: 1, setups: [...j.setups, ...p.setups.filter((s) => !sIds.has(s.id))], trades: [...j.trades, ...p.trades.filter((t) => !tIds.has(t.id))] };
      });
      return p.setups.length + p.trades.length;
    },
    [update]
  );
  const download = useCallback(() => {
    const blob = new Blob([serializeJournal(journal)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hyperquant-zagrania-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [journal]);

  return { journal, addSetup, removeSetup, addTrade, removeTrade, importJson, download };
}
