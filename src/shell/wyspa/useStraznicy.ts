import { useCallback, useEffect, useRef, useState } from 'react';
import { SESSION_LABEL, sessionAt } from '../../charts/pro/core/sessions';
import { tr } from '../../i18n';
import { useDesk } from '../../state/DeskContext';
import { fmtCompact, fmtPct, fmtPrice } from '../../ui';
import { pauseStore, recordEvents, rulesStore } from './magazyn';
import { type GuardEvent, type Labels, type Snapshot, evaluate, marketWindows } from './straznicy';

/** Zapis liczb w tekstach zdarzeń (język strony). */
export const LABELS: Labels = {
  price: (v) => `$${fmtPrice(v, 0)}`,
  pct: (v) => fmtPct(v, 1, false),
  usd: (v) => fmtCompact(v, '$'),
  session: (s) => SESSION_LABEL[s],
};

const fin = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Najczęściej raz na sekundę (cena zmienia się z każdą transakcją). */
const MIN_STEP_MS = 1000;

/**
 * Pilnowanie strażników w powłoce: migawka z danych desku (cena, PDH i PDL, funding, ruch 15 min, likwidacje 5 min,
 * sesja) przy każdej zmianie ceny i co 5 s; zdarzenia idą do dziennika i jako powiadomienie przeglądarki. Bez reguł,
 * przy pauzie albo danych innych niż na żywo nie liczy nic. Zwraca ostatnie zdarzenie do krótkiej wyspy w rogu.
 */
export function useStraznicy(): { flash: GuardEvent | null; dismiss: () => void } {
  const { feed, shaakuni, cexEnabled } = useDesk();
  const prev = useRef<Snapshot | null>(null);
  const [flash, setFlash] = useState<GuardEvent | null>(null);

  const live = feed.dataStatus === 'LIVE';
  useEffect(() => {
    const now = Date.now();
    const rules = rulesStore.get();
    if (!live || pauseStore.get() || rules.every((r) => !r.on)) {
      prev.current = null;
      return;
    }
    if (prev.current && now - prev.current.at < MIN_STEP_MS) return;
    const price = fin(feed.currentPrice);
    const w = marketWindows(feed.bars, price, now, feed.timeframeSec);
    const cur: Snapshot = {
      at: now,
      price,
      pdh: fin(shaakuni.pdh),
      pdl: fin(shaakuni.pdl),
      fundingApr: fin(feed.backendTelemetry?.fundingAnnualizedPct),
      move15Pct: w.move15Pct,
      // Likwidacje tylko ze strumieni giełd CEX (Hyperliquid ich nie publikuje); bez strumieni brak liczby, nie zero
      liq5Usd: cexEnabled ? w.liq5Usd : null,
      session: sessionAt(now).id,
    };
    const events = evaluate(rules, prev.current, cur, LABELS);
    prev.current = cur;
    if (events.length === 0) return;
    recordEvents(events);
    setFlash(events[events.length - 1]);
    // Moduł powiadomień wykresu (zgoda, service worker, dźwięk) ładowany dopiero przy pierwszym zdarzeniu
    void import('../../charts/pro/chart/alerts').then(({ notifyAlert }) => {
      for (const e of events) notifyAlert(tr('Strażnik BTC', 'BTC guard'), e.text, `wyspa-${e.ruleId}`);
    });
  }, [live, cexEnabled, feed.currentPrice, feed.nowTick, feed.bars, feed.timeframeSec, feed.backendTelemetry, shaakuni.pdh, shaakuni.pdl]);

  // Krótka wyspa znika sama po 8 s
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 8000);
    return () => window.clearTimeout(id);
  }, [flash]);

  const dismiss = useCallback(() => setFlash(null), []);
  return { flash, dismiss };
}
