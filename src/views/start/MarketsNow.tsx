import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ENABLED_MARKETS, type DeskMarket } from '../../config/deskMarkets';
import { lang, tr } from '../../i18n';
import { useMarketsPage } from '../../state/useMarketsTable';
import { useSessionOpen } from '../../state/useSessionOpen';
import { Badge, DASH, fmtFixed } from '../../ui';
import { QualityChip } from '../../ui/QualityChip';
import { marketQuality } from '../../utils/marketQuality';
import type { AnchorKind } from '../../utils/sessionAnchor';
import { type Underlying, underlyingAt } from '../../utils/underlying';

/**
 * „Rynki teraz” na Starcie (projekt 60, §8 S1): po wierszu na rynek desku z konfiguracji — nazwa i klasa, cena LIVE,
 * ruch od otwarcia sesji bazowej (znak i liczba w neutralnym kolorze, bez strzałek kierunku), stan rynku bazowego
 * i plakietka jakości danych. Wiersz wybiera rynek Czwórki na Starcie; strzałka otwiera wykres w W sesji.
 */
const LOCALE = lang === 'pl' ? 'pl-PL' : 'en-GB';
const hm = (ms: number) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const when = (ms: number, now: number) => {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return sameDay ? hm(ms) : `${new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(ms)} ${hm(ms)}`;
};

const CLASS: Record<DeskMarket['class'], string> = { crypto: tr('krypto', 'crypto'), commodity: tr('surowiec', 'commodity'), index: tr('indeks', 'index') };
const SINCE: Record<AnchorKind, string> = {
  'utc-day': tr('od 00:00 UTC', 'since 00:00 UTC'),
  'cme-open': tr('od otwarcia sesji CME', 'since the CME session open'),
  'nyse-open': tr('od otwarcia NYSE', 'since the NYSE open'),
  'nyse-close': tr('od zamknięcia NYSE', 'since the NYSE close'),
};

/** Stan rynku bazowego słowami, z godziną najbliższej zmiany w czasie lokalnym. */
export function underlyingText(m: DeskMarket, u: Underlying, now: number): string {
  if (u.state === 'always') return tr('24/7, bez przerw', '24/7, no breaks');
  const venue = m.underlying.rth ? 'NYSE' : 'CME';
  if (m.underlying.rth && u.rth && u.rthNext) return tr(`NYSE otwarta do ${when(u.rthNext, now)}`, `NYSE open until ${when(u.rthNext, now)}`);
  if (u.state === 'holiday') return tr('NYSE: święto, cena platformy', 'NYSE holiday, platform price');
  if (u.state === 'open')
    return m.underlying.rth
      ? tr(`poza sesją NYSE, futures do ${u.next ? when(u.next, now) : DASH}`, `outside NYSE hours, futures until ${u.next ? when(u.next, now) : DASH}`)
      : tr(`${venue} otwarta do ${u.next ? when(u.next, now) : DASH}`, `${venue} open until ${u.next ? when(u.next, now) : DASH}`);
  const next = u.next ? when(u.next, now) : DASH;
  // Rynek z sesją regularną NYSE poza nią: NYSE wraca o 9:30 ET (rthNext), futures wcześniej (next) — dwie różne godziny
  if (m.underlying.rth) {
    const nyse = u.rthNext ? when(u.rthNext, now) : DASH;
    return u.state === 'break'
      ? tr(`NYSE zamknięta do ${nyse}; futures: przerwa do ${next}`, `NYSE closed until ${nyse}; futures on break until ${next}`)
      : tr(`NYSE zamknięta do ${nyse}; futures od ${next}`, `NYSE closed until ${nyse}; futures from ${next}`);
  }
  if (u.state === 'break') return tr(`${venue}: przerwa do ${next}`, `${venue}: break until ${next}`);
  return tr(`${venue} zamknięta do ${next}`, `${venue} closed until ${next}`);
}

export const MarketsNow: React.FC<{ selected: string; onSelect: (coin: string) => void }> = ({ selected, onSelect }) => {
  const page = useMarketsPage();
  const opens = useSessionOpen(page.now);
  const byCoin = new Map(page.rows.map((r) => [r.coin, r]));
  return (
    <div role="group" aria-labelledby="start-rynki" className="mt-10 max-w-[760px]" data-rynki-teraz>
      <p id="start-rynki" className="mb-3 flex items-center gap-3 text-[11px] font-bold tracking-[0.14em] text-ink-3 uppercase">
        {tr('Rynki teraz', 'Markets now')}
        <Badge tone="live" title={tr('Ceny i jakość z odczytu Hyperliquid w Twojej przeglądarce', 'Prices and quality from a Hyperliquid reading in your browser')}>
          LIVE
        </Badge>
      </p>
      <ul className="flex flex-col gap-2">
        {ENABLED_MARKETS.map((m) => {
          const r = byCoin.get(m.coin);
          const u = underlyingAt(m, page.now);
          const q = marketQuality(m, r?.ctx ?? null, u);
          const o = opens[m.coin];
          const px = r?.ctx?.markPx ?? null;
          const move = px !== null && o?.px ? ((px - o.px) / o.px) * 100 : null;
          const on = selected === m.coin;
          return (
            <li key={m.coin} data-rynek={m.coin} className={`group relative flex items-stretch rounded-2xl border bg-surface-1/85 backdrop-blur transition-colors duration-150 ${on ? 'border-ink-2' : 'border-line-strong hover:border-ink-3'}`}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(m.coin)}
                title={tr(`Pokaż Czwórkę dla: ${m.label}`, `Show the Four numbers for ${m.label}`)}
                className="grid min-h-16 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left min-[520px]:grid-cols-[150px_minmax(0,1fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    {on && <span aria-hidden="true" className="size-1.5 rounded-full bg-lume" />}
                    <span className="font-display text-lg font-bold leading-tight tracking-tight [font-stretch:90%] text-ink-1">{m.label}</span>
                  </span>
                  <span className="block text-[11px] text-ink-3">{CLASS[m.class]}</span>
                </span>
                <span className="order-3 col-span-2 min-w-0 text-[12px] text-ink-2 min-[520px]:order-none min-[520px]:col-span-1">
                  <span className="block">{underlyingText(m, u, page.now)}</span>
                  <span className="mt-1 inline-block">
                    <QualityChip q={q} />
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-[17px] tabular-nums text-ink-1">{r?.price ?? DASH}</span>
                  <span className="block font-mono text-[12px] tabular-nums text-ink-2" title={o?.anchor ? SINCE[o.anchor.kind] : tr('brak punktu odniesienia', 'no reference point')}>
                    {move === null ? DASH : `${move >= 0 ? '+' : '−'}${fmtFixed(Math.abs(move), 2)}%`}
                    <span className="ml-1 font-sans text-[10.5px] text-ink-3">{o?.anchor ? SINCE[o.anchor.kind] : ''}</span>
                  </span>
                </span>
              </button>
              <a
                href={`#charts?m=${m.coin}`}
                aria-label={tr(`Wykres ${m.label} w W sesji`, `${m.label} chart In session`)}
                className="flex w-11 shrink-0 items-center justify-center border-l border-line text-ink-3 transition-colors duration-150 hover:text-ink-1"
              >
                <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        {tr(
          'Rynki HIP-3 (trade.xyz): cena z wyroczni rynku bazowego; poza jego godzinami cenę wyznacza arkusz platformy. Ruch bez oceny kierunku.',
          'HIP-3 markets (trade.xyz): the price comes from the underlying market oracle; outside its hours the platform order book sets the price. Moves without a view on direction.'
        )}
      </p>
    </div>
  );
};
