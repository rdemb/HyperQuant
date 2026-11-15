import { useEffect, useState } from 'react';
import { ENABLED_MARKETS } from '../config/deskMarkets';
import { postInfo } from '../utils/marketDataFeed';
import { type SessionAnchor, sessionAnchor } from '../utils/sessionAnchor';

/**
 * Cena otwarcia sesji bazowej każdego rynku desku (punkt odniesienia ruchu na Starcie): otwarcie pierwszej świecy 5m od
 * chwili `sessionAnchor`. Jedno zapytanie `candleSnapshot` na rynek przy zmianie punktu odniesienia (pamięć na czas
 * sesji strony), punkt liczony raz na minutę. Błąd albo brak świecy → null (ruch „—” z powodem).
 */
export interface OpenPrice {
  anchor: SessionAnchor | null;
  px: number | null;
}

const cache = new Map<string, number | null>();
const key = (coin: string, a: SessionAnchor) => `${coin}@${a.t}`;

async function openAt(coin: string, a: SessionAnchor): Promise<number | null> {
  const k = key(coin, a);
  if (cache.has(k)) return cache.get(k) ?? null;
  const raw = await postInfo({ type: 'candleSnapshot', req: { coin, interval: '5m', startTime: a.t, endTime: a.t + 10 * 60_000 } });
  const first = Array.isArray(raw) ? raw.find((c) => c && typeof c === 'object' && Number((c as { t?: unknown }).t) >= a.t) : null;
  const px = first ? Number((first as { o?: unknown }).o) : Number.NaN;
  const v = Number.isFinite(px) && px > 0 ? px : null;
  // Nieudane zapytanie (raw === null) nie trafia do pamięci: następna minuta spróbuje znowu
  if (raw !== null) cache.set(k, v);
  return v;
}

export function useSessionOpen(now: number): Record<string, OpenPrice> {
  const minute = Math.floor(now / 60_000);
  const [out, setOut] = useState<Record<string, OpenPrice>>({});
  useEffect(() => {
    let live = true;
    const t = minute * 60_000;
    for (const m of ENABLED_MARKETS) {
      const anchor = sessionAnchor(m, t);
      if (!anchor) {
        setOut((o) => ({ ...o, [m.coin]: { anchor: null, px: null } }));
        continue;
      }
      void openAt(m.coin, anchor).then((px) => {
        if (live) setOut((o) => (o[m.coin]?.anchor?.t === anchor.t && o[m.coin]?.px === px ? o : { ...o, [m.coin]: { anchor, px } }));
      });
    }
    return () => {
      live = false;
    };
  }, [minute]);
  return out;
}
