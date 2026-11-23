import React from 'react';
import { ArrowRight, ArrowUpRight, BookOpenCheck, History, PanelsTopLeft, Rows3 } from 'lucide-react';
import { SESSION_LABEL, zonedToUtc } from '../charts/pro/core/sessions';
import { DAY } from '../charts/pro/core/time';
import { DESK_MARKETS } from '../config/deskMarkets';
import { lang, tr } from '../i18n';
import { daySessions, dayPhase, fmtSpan, sessionClock, useNow, type DayPhase } from '../shell/dzien';
import { useMarketsPage } from '../state/useMarketsTable';
import { Badge } from '../ui';
import type { MarketRowModel } from '../utils/marketsTable';
import { ORDER_FLOW_MARKETS } from './flow/orderFlowDesk';
import { ZegarDoby } from './dzis/ZegarDoby';
import { Liczydlo } from '../ui/Liczydlo';
import { Litery } from '../ui/Litery';
import { Deszyfr } from '../ui/Deszyfr';
import { ZBliska } from './dzis/ZBliska';
import { czytajNic, opisNici } from '../shell/nic';

/**
 * Widok „Dziś” (`#dzis`): pierwszy ekran aplikacji. Doba tradera (bieżąca sesja i odliczanie, zegar bez znaku pochodzenia),
 * rynki desku z liczbami LIVE i godziną odczytu (te same dane i reguły braków co Rynki: `useMarketsPage`), trzy czasy
 * dnia z oknami w czasie lokalnym i skróty do narzędzi. Opis rynku, bez kierunku ceny.
 */

const LOCALE = lang === 'pl' ? 'pl-PL' : 'en-GB';
const godzina = (ms: number) => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const dzien = (ms: number) => new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(ms);
const STREFA = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Okna faz dnia (te same granice co `dayPhase`): Azja, od Londynu do 16:00 w Nowym Jorku, potem do końca doby UTC. */
function oknaFaz(now: number): Record<DayPhase, { from: number; to: number }> {
  const [azja, londyn, ny] = daySessions(now);
  const d = new Date(ny.start);
  const zamkniecie = zonedToUtc('America/New_York', d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 16, 0);
  return {
    before: { from: azja.start, to: londyn.start },
    charts: { from: londyn.start, to: zamkniecie },
    after: { from: zamkniecie, to: azja.start + DAY },
  };
}

const FAZY: { id: DayPhase; nr: string; tytul: string; opis: string; akcja: string }[] = [
  {
    id: 'before',
    nr: '01',
    tytul: tr('Przed sesją', 'Before the session'),
    opis: tr('Zakres wczorajszej sesji, paliwo likwidacji i poziomy wokół ceny.', 'Yesterday’s range, liquidation fuel and levels around price.'),
    akcja: tr('Przygotuj sesję', 'Prepare the session'),
  },
  {
    id: 'charts',
    nr: '02',
    tytul: tr('W sesji', 'In session'),
    opis: tr('Świece, footprint i heatmapa obok księgi i taśmy. Powtórka wraca do chwili.', 'Candles, footprint and heatmap next to the book and tape. Replay returns to the moment.'),
    akcja: tr('Otwórz sesję', 'Open the session'),
  },
  {
    id: 'after',
    nr: '03',
    tytul: tr('Po sesji', 'After the session'),
    opis: tr('Rozliczenie dnia: co się wydarzyło i co zapisaliśmy przed faktem.', 'The day’s review: what happened and what we recorded beforehand.'),
    akcja: tr('Rozlicz dzień', 'Review the day'),
  },
];

const FLOW = new Set(ORDER_FLOW_MARKETS.map((m) => m.coin));
const PELNA: Record<string, string> = Object.fromEntries(DESK_MARKETS.map((m) => [m.coin, tr(m.full.pl, m.full.en)]));
const TICKER: Record<string, string> = { BTC: 'BTC-PERP' };
const KLASA: Record<string, string> = {
  crypto: tr('Krypto · 24/7', 'Crypto · 24/7'),
  commodity: tr('Surowiec · HIP-3', 'Commodity · HIP-3'),
  index: tr('Indeks · HIP-3', 'Index · HIP-3'),
  equity: tr('Akcje · HIP-3', 'Stocks · HIP-3'),
};

const Liczba: React.FC<{ etykieta: string; wartosc: string; dopisek?: string | null }> = ({ etykieta, wartosc, dopisek }) => (
  <div className="min-w-0">
    <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{etykieta}</dt>
    <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink-1 truncate">{wartosc}</dd>
    {dopisek && <dd className="text-[11px] leading-snug text-ink-3">{dopisek}</dd>}
  </div>
);

const KartaRynku: React.FC<{ row: MarketRowModel }> = ({ row }) => {
  const sesja = `#charts?m=${encodeURIComponent(row.coin)}`;
  const brak = row.why !== null;
  return (
    <article data-dzis-rynek={row.coin} data-tilt aria-labelledby={`dzis-${row.coin}`} className="hq-spot hq-karta-dzis relative flex h-full flex-col gap-5 rounded-[22px] p-5 sm:p-6">
      {/* Obieg światła po krawędzi przy każdym nowym odczycie (klucz = godzina odczytu): widoczny znak świeżych danych */}
      {row.readAt !== null && <span key={row.readAt} aria-hidden="true" className="hq-swiezo" />}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`dzis-${row.coin}`} className="font-display text-[24px] font-bold leading-none tracking-tight [font-stretch:88%] text-ink-1">
            {PELNA[row.coin] ?? row.name}
          </h3>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
            <span>{TICKER[row.coin] ?? row.coin.replace(/^[a-z]+:/, '')}</span>
            {row.cls && KLASA[row.cls] && <span aria-hidden="true">·</span>}
            {row.cls && KLASA[row.cls] && <span>{KLASA[row.cls]}</span>}
          </p>
        </div>
        {/* Stała szerokość w obu stanach (LIVE z godziną albo powód braku): karta nie skacze po pierwszym odczycie */}
        <span className="flex w-[132px] shrink-0 items-center justify-end gap-1.5 text-[11px] text-ink-3">
          {row.readAt !== null ? (
            <>
              <Badge tone="live" size="sm" title={tr('Realne dane Hyperliquid; godzina odczytu w czasie lokalnym', 'Real Hyperliquid data; reading time in local time')}>
                LIVE
              </Badge>
              <span className="font-mono tabular-nums">{row.readAt}</span>
            </>
          ) : (
            <span className="line-clamp-2 text-right" title={row.why ?? undefined}>
              {row.why}
            </span>
          )}
        </span>
      </header>
      <p className={`font-mono text-[clamp(30px,3vw,40px)] leading-none tabular-nums tracking-tight ${brak ? 'text-ink-3' : 'text-ink-1'}`} aria-label={tr(`Cena: ${row.price}`, `Price: ${row.price}`)}>
        <Liczydlo text={row.price} />
      </p>
      <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4">
        <Liczba etykieta={tr('Funding · rok', 'Funding · year')} wartosc={row.fundingYear ?? '—'} dopisek={row.fieldWhy.funding} />
        <Liczba etykieta={tr('Otwarte poz.', 'Open int.')} wartosc={row.openInterest} dopisek={row.fieldWhy.openInterest} />
        <Liczba etykieta={tr('Obrót 24 h', '24h volume')} wartosc={row.volume} dopisek={row.fieldWhy.volume} />
      </dl>
      {row.wallStreet.why === null && (
        <p className="-mt-2 text-xs text-ink-3">
          Wall Street: <span className="text-ink-2">{row.wallStreet.label}</span>
          {row.wallStreet.note ? ` · ${row.wallStreet.note}` : ''}
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <a href={sesja} className="hq-przycisk-lume inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold">
          {tr('W sesji', 'In session')}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </a>
        {FLOW.has(row.coin) && (
          <a href={`#orderflow?m=${encodeURIComponent(row.coin)}`} className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-2">
            Order Flow
          </a>
        )}
      </div>
    </article>
  );
};

const SKROTY: { href: string; tytul: string; opis: string; ikona: React.ReactNode; zewnetrzny?: boolean }[] = [
  {
    href: '#orderflow?m=BTC',
    tytul: tr('Księga i taśma', 'Book and tape'),
    opis: tr('Stojące zlecenia obok wykonań na jednej osi ceny.', 'Resting orders next to executions on one price axis.'),
    ikona: <Rows3 className="h-5 w-5" aria-hidden="true" />,
  },
  {
    href: '#orderflow?m=BTC&w=archive',
    tytul: tr('Powtórka BTC', 'BTC replay'),
    opis: tr('Wróć do nagranej godziny i sprawdź chwilę co do milisekundy.', 'Return to a recorded hour and check the moment to the millisecond.'),
    ikona: <History className="h-5 w-5" aria-hidden="true" />,
  },
  {
    href: '#stanowisko',
    tytul: tr('Stanowisko', 'Workbench'),
    opis: tr('Wykresy, księga i nagrania w Twoim układzie, zapisanym w tej przeglądarce.', 'Charts, book and recordings in your own layout, saved in this browser.'),
    ikona: <PanelsTopLeft className="h-5 w-5" aria-hidden="true" />,
  },
  {
    href: '#lessons',
    tytul: tr('Lekcje', 'Lessons'),
    opis: tr('Prawdziwe sytuacje z rynku, zatrzymane w ważnym momencie.', 'Real market situations, paused at the key moment.'),
    ikona: <BookOpenCheck className="h-5 w-5" aria-hidden="true" />,
  },
];

const chwila = (ms: number) => new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

/** Nić kontekstu: powrót do ostatniego miejsca pracy w tej karcie (adres z rynkiem, interwałem, nagraniem, obserwacją). */
const Powrot: React.FC<{ now: number }> = ({ now }) => {
  const nic = czytajNic(now);
  const opis = nic ? opisNici(nic.hash, chwila) : null;
  if (!nic || !opis) return null;
  return (
    <a href={nic.hash} data-dzis-powrot data-tilt className="hq-spot hq-karta-dzis group relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-5 py-4">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lume text-[#14160a]">↩</span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">
          {tr('Wróć do ostatniego miejsca pracy', 'Back to where you were')} · {godzina(nic.at)}
        </span>
        <span className="mt-1 block truncate font-semibold text-ink-1">
          {opis.widok}
          {opis.szczegoly.length > 0 && <span className="font-normal text-ink-2"> · {opis.szczegoly.join(' · ')}</span>}
        </span>
      </span>
      <ArrowRight aria-hidden="true" className="h-4 w-4 text-ink-2 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" />
    </a>
  );
};

const DzisView: React.FC = () => {
  const now = useNow(30_000);
  const { phase } = dayPhase(now);
  const zegar = sessionClock(now);
  const okna = oknaFaz(now);
  const page = useMarketsPage();

  return (
    <div data-dzis-view className="flex flex-col gap-10 pb-6">
      <section aria-labelledby="dzis-tytul" data-latarka className="hq-dzis-hero relative overflow-hidden rounded-[28px] px-5 py-8 sm:px-10 sm:py-12">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
          <span aria-hidden="true" className="h-px w-8 bg-lume" />
          <span className="first-letter:uppercase">{dzien(now)}</span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">{STREFA}</span>
        </p>
        <h1 id="dzis-tytul" className="mt-4 font-display text-[clamp(44px,7vw,96px)] font-extrabold leading-[0.92] tracking-[-0.03em] [font-stretch:82%] text-ink-1">
          <Litery text={tr('Dziś', 'Today')} />
          <br />
          <Litery text={tr('na rynku.', 'in the market.')} start={4} className="text-lume-ink" />
        </h1>
        <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-2 text-pretty">
          {tr(
            `Trwa ${SESSION_LABEL[zegar.current.id]} (${fmtSpan(zegar.elapsed)}). ${SESSION_LABEL[zegar.next.id]} za ${fmtSpan(zegar.untilNext)}, o ${godzina(zegar.next.start)}.`,
            `${SESSION_LABEL[zegar.current.id]} is on (${fmtSpan(zegar.elapsed)}). ${SESSION_LABEL[zegar.next.id]} in ${fmtSpan(zegar.untilNext)}, at ${godzina(zegar.next.start)}.`
          )}{' '}
          {tr('Liczby poniżej pobiera Twoja przeglądarka prosto z Hyperliquid.', 'Your browser fetches the numbers below straight from Hyperliquid.')}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={`#${phase}`} className="hq-przycisk-lume inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold">
            {FAZY.find((f) => f.id === phase)?.akcja}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
          <a href="#markets" className="inline-flex h-12 items-center gap-2 rounded-full border border-line-strong px-6 text-[15px] font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-2">
            {tr('Wszystkie rynki', 'All markets')}
          </a>
        </div>
        </div>
        {/* Chronograf doby: sesje BTC w czasie lokalnym, „teraz”, odliczanie (zegar, nie dane rynku); na telefonie pod tekstem */}
        <div data-tilt className="hq-zegar-uchwyt relative mx-auto rounded-full w-[min(82vw,340px)] lg:mx-0 lg:-my-6 lg:mr-2 lg:w-[400px]">
          <ZegarDoby />
        </div>
        </div>
        <span aria-hidden="true" className="hq-latarka" />
        <span aria-hidden="true" className="hq-dzis-woda pointer-events-none absolute inset-x-0 bottom-5 h-px lg:bottom-auto lg:top-[49%]" />
      </section>

      <Powrot now={now} />

      <section aria-labelledby="dzis-rynki" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="dzis-rynki" className="font-display text-[clamp(22px,2.2vw,30px)] font-bold leading-tight tracking-tight [font-stretch:90%] text-ink-1">
            <Deszyfr text={tr('Rynki teraz', 'Markets now')} />
          </h2>
          <p className="text-xs text-ink-3">
            {tr(`Hyperliquid · odświeżanie co ${page.refreshSec} s przy widocznej karcie · brak odczytu to „—”`, `Hyperliquid · refreshed every ${page.refreshSec} s while the tab is visible · no reading is “—”`)}
          </p>
        </div>
        <div role="list" aria-label={tr('Rynki teraz', 'Markets now')} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {page.rows.map((r) => (
            <div role="listitem" key={r.coin} className="min-w-0 h-full">
              <KartaRynku row={r} />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="dzis-fazy" className="flex flex-col gap-4">
        <h2 id="dzis-fazy" className="font-display text-[clamp(22px,2.2vw,30px)] font-bold leading-tight tracking-tight [font-stretch:90%] text-ink-1">
          <Deszyfr text={tr('Trzy czasy dnia', 'Three times of the day')} />
        </h2>
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {FAZY.map((f) => {
            const teraz = f.id === phase;
            const okno = okna[f.id];
            return (
              <li key={f.id} className="min-w-0">
                <a
                  href={`#${f.id}`}
                  aria-current={teraz ? 'time' : undefined}
                  data-dzis-faza={f.id}
                  data-tilt
                  className={`hq-spot group relative flex h-full flex-col gap-3 rounded-[22px] border p-5 sm:p-6 transition-colors duration-150 ${
                    teraz ? 'hq-faza-teraz border-line-strong' : 'border-line bg-surface-1 hover:bg-surface-2'
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-ink-3">{f.nr}</span>
                    {teraz && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-lume px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#14160a]">
                        {tr('teraz', 'now')}
                      </span>
                    )}
                  </span>
                  <span className="font-display text-[26px] font-bold leading-none tracking-tight [font-stretch:88%] text-ink-1">{f.tytul}</span>
                  <span className="font-mono text-sm tabular-nums text-ink-2">
                    {godzina(okno.from)} – {godzina(okno.to)}
                  </span>
                  <span className="text-sm leading-relaxed text-ink-3 text-pretty">{f.opis}</span>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-ink-1">
                    {f.akcja}
                    <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" />
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-ink-3">
          {tr(
            'Granice jak na wykresie: Azja od 00:00 UTC, Londyn od 08:00 czasu Londynu, Nowy Jork od 09:30 do 16:00 czasu Nowego Jorku. Godziny w Twojej strefie czasowej.',
            'Same boundaries as on the chart: Asia from 00:00 UTC, London from 08:00 London time, New York from 09:30 to 16:00 New York time. Times in your time zone.'
          )}
        </p>
      </section>

      <ZBliska />

      <section aria-labelledby="dzis-skroty" className="flex flex-col gap-4">
        <h2 id="dzis-skroty" className="font-display text-[clamp(22px,2.2vw,30px)] font-bold leading-tight tracking-tight [font-stretch:90%] text-ink-1">
          <Deszyfr text={tr('Na skróty', 'Shortcuts')} />
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SKROTY.map((s) => (
            <li key={s.href} className="min-w-0">
              <a href={s.href} data-tilt className="hq-spot group relative flex h-full items-start gap-4 rounded-2xl border border-line bg-surface-1 p-4 transition-colors duration-150 hover:bg-surface-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line-strong text-ink-1">{s.ikona}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 font-semibold text-ink-1">
                    {s.tytul}
                    {s.zewnetrzny && <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-3" />}
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-ink-3">{s.opis}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default DzisView;
