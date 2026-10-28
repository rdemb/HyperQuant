import React, { useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { KIND_LABEL, MACRO_EVENTS, type MacroEvent, fmtEventLocal } from '../../data/macroCalendar';
import { locale, tr } from '../../i18n';
import { useDeskLedger } from '../../state/useDeskLedger';
import { Badge } from '../../ui';
import { isCat } from '../../utils/deskLedger';
import { fmtCountdown, fmtPrice, fmtSigned } from '../../ui/format';
import { type Forecast, type Group, type Levels, type SchrodiModel, TOUCH_MAX_R, touchCone, touchProb } from '../../utils/schrodi';
import { type Mood, SchrodiCat } from './SchrodiCat';
import { useTouchModel } from './useSchrodi';

/**
 * Dymek Schrödiego: najpierw wielkość ruchu w najbliższej godzinie, poziomy i makro, potem kierunek z uczciwym %.
 * Przy poziomach szansa dotknięcia w godzinę i stożek zasięgu (model dotknięć, wczytywany po otwarciu dymka).
 * Rozwijane: „Dlaczego?” (wkład grup cech), „Jak trafiam” (walidacja krocząca i wynik na żywo z dziennika), „O mnie”.
 */

const MIN = 60_000;
const DOC_URL = 'https://github.com/rdemb/HyperQuant/blob/main/docs/SCHRODI.md';
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Najbliższe zdarzenie o wysokiej wadze w ciągu doby (albo trwające do 15 min po publikacji). */
export function nextMacro(now: number): MacroEvent | null {
  return MACRO_EVENTS.find((e) => e.importance === 'high' && e.timeUtcMs > now - 15 * MIN && e.timeUtcMs - now <= 24 * 60 * MIN) ?? null;
}

export function moodOf(f: Forecast | null, now: number, stale: boolean): Mood {
  if (!f || stale) return 'hiding';
  const ev = nextMacro(now);
  if (ev && Math.abs(ev.timeUtcMs - now) <= 60 * MIN) return 'nervous';
  if (f.pBig >= 0.7) return 'alert';
  if (f.pBig <= 0.25) return 'sleep';
  return 'calm';
}

/** Jedno zdanie kota: ruch, potem kierunek. */
export function catLine(f: Forecast, mood: Mood, now: number): string {
  const ev = nextMacro(now);
  const move =
    mood === 'nervous' && ev
      ? tr(`${KIND_LABEL[ev.kind]} ${fmtCountdown(ev.timeUtcMs, now)}. Gryzę pazury, ruch może być gwałtowny.`, `${KIND_LABEL[ev.kind]} ${fmtCountdown(ev.timeUtcMs, now)}. Biting my claws, the move can be sharp.`)
      : f.pBig >= 0.7
        ? tr(`Szykuje się ruch: duży z szansą ${pct(f.pBig)}.`, `A move is coming: a big one with ${pct(f.pBig)} odds.`)
        : f.pBig <= 0.25
          ? tr(`Spokojnie, drzemię. Duży ruch tylko z szansą ${pct(f.pBig)}.`, `Quiet, I'm napping. A big move only has ${pct(f.pBig)} odds.`)
          : tr(`Zwykła godzina, duży ruch z szansą ${pct(f.pBig)}.`, `An ordinary hour, a big move with ${pct(f.pBig)} odds.`);
  const dir =
    f.stance === 'long'
      ? tr(`Kierunek lekko w górę: Long ${pct(f.pUp)}.`, `Direction slightly up: Long ${pct(f.pUp)}.`)
      : f.stance === 'short'
        ? tr(`Kierunek lekko w dół: Short ${pct(1 - f.pUp)}.`, `Direction slightly down: Short ${pct(1 - f.pUp)}.`)
        : tr('Kierunku nie wiem.', "I don't know the direction.");
  return `${move} ${dir}`;
}

const LEVEL_NAMES: Record<keyof Levels, () => string> = {
  pdh: () => tr('Wczorajsze max', "Yesterday's high"),
  pdl: () => tr('Wczorajsze min', "Yesterday's low"),
  poc: () => tr('POC wczoraj', "Yesterday's POC"),
  vah: () => tr('VAH wczoraj', "Yesterday's VAH"),
  val: () => tr('VAL wczoraj', "Yesterday's VAL"),
  vwap: () => tr('VWAP dnia', 'Daily VWAP'),
};

const GROUP_NAMES: Record<Group, () => string> = {
  move: () => tr('Ruch ceny', 'Price move'),
  vol: () => tr('Zmienność', 'Volatility'),
  auction: () => tr('Aukcja i poziomy', 'Auction and levels'),
  clock: () => tr('Zegar i kalendarz', 'Clock and calendar'),
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-ink-2 hover:text-ink-1"
      >
        {title}
        <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 text-xs text-ink-2 leading-relaxed">{children}</div>}
    </div>
  );
};

/** Pasek szansy: od 0 do 100%, znacznik w punkcie p */
const ProbBar: React.FC<{ p: number; tone: 'move' | 'dir' }> = ({ p, tone }) => (
  <div className="relative h-1.5 rounded-full bg-surface-3 overflow-hidden" aria-hidden="true">
    {tone === 'move' ? (
      <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${p * 100}%` }} />
    ) : (
      <>
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <div
          className={`absolute inset-y-0 ${p >= 0.5 ? 'left-1/2 bg-buy-ink' : 'right-1/2 bg-sell-ink'}`}
          style={{ width: `${Math.abs(p - 0.5) * 100}%` }}
        />
      </>
    )}
  </div>
);

type Card = {
  ruch: Record<'2023_2025' | '2026', { auc: number; trafnosc: number; gorne20: number; dolne20: number }>;
  kierunek: Record<'2023_2025' | '2026', { auc: number; trafnosc: number; long: [number, number]; short: [number, number] }>;
};
/** Karta modelu dotknięć: pasma szans [średnia prognoza, częstość dotknięć, liczba] i Brier wobec ruchu Browna */
type TouchCard = {
  B: Record<'2023_2025' | '2026', { auc_B: number; bss_vs_BM: number; 'pasmo_0.7_0.9': number[]; 'pasmo_0.4_0.6': number[]; 'pasmo_0.1_0.3': number[] }>;
};

/** Odległość w dolarach ze znakiem: „+87 $” po polsku, „+$87” po angielsku */
const usd = (v: number) => tr(fmtSigned(v, 0, ' $'), `${v > 0 ? '+' : v < 0 ? '−' : ''}$${fmtPrice(Math.abs(v), 0)}`);

type Live = NonNullable<NonNullable<ReturnType<typeof useDeskLedger>['summary']>['cat']>;
const pctOr = (v: number | null) => (v === null ? '—' : pct(v));

/** Wynik na żywo z weryfikowalnego dziennika: każda prognoza zapisana z hashem, zanim znany jest wynik. */
const LiveRecord: React.FC<{ live: Live }> = ({ live }) => {
  const s = live.scores;
  const since = new Date(live.since!).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const t = s.touch;
  const cone50 = t?.cone.find((c) => c.q === 0.5);
  const num3 = (v: number | null) => (v === null ? '—' : tr(v.toFixed(3).replace('.', ','), v.toFixed(3)));
  return (
    <p className="mt-2">
      <span className="text-ink-1">{tr('Na żywo', 'Live')}</span>{' '}
      {s.n === 0
        ? tr(
            `od ${since}: każdą prognozę co 15 minut zapisuję w dzienniku z hashem, zanim znam wynik. Pierwsze rozliczenie po godzinie.`,
            `since ${since}: every forecast is written to the ledger with a hash every 15 minutes, before the outcome is known. First results after an hour.`
          )
        : tr(
            `(30 dni, od ${since}): ${s.n} rozliczonych prognoz, ${s.nEff} rozłącznych godzin. Duży ruch: AUC ${s.big.auc === null ? '—' : s.big.auc.toFixed(2).replace('.', ',')}, trafność ${pctOr(s.big.hit)}. Kierunek: Long trafiał w ${pctOr(s.dir.long.hit)} z ${s.dir.long.n}, Short w ${pctOr(s.dir.short.hit)} z ${s.dir.short.n}.${s.nEff < 50 ? ' To jeszcze za mało, żeby oceniać.' : ''}`,
            `(30 days, since ${since}): ${s.n} resolved forecasts, ${s.nEff} non-overlapping hours. Big move: AUC ${s.big.auc === null ? '—' : s.big.auc.toFixed(2)}, accuracy ${pctOr(s.big.hit)}. Direction: Long right ${pctOr(s.dir.long.hit)} of ${s.dir.long.n}, Short ${pctOr(s.dir.short.hit)} of ${s.dir.short.n}.${s.nEff < 50 ? ' Too little data to judge yet.' : ''}`
          )}
      {t && t.hours > 0 && cone50 && (
        <>
          {' '}
          {tr(
            `Dotknięcia: Brier ${num3(t.brier)} wobec ${num3(t.brierBm)} dla ruchu Browna; granicę 50% cena dotykała w ${pctOr(cone50.up)} godzin w górę i ${pctOr(cone50.dn)} w dół.`,
            `Touches: Brier ${num3(t.brier)} against ${num3(t.brierBm)} for Brownian motion; price touched the 50% edge in ${pctOr(cone50.up)} of hours up and ${pctOr(cone50.dn)} down.`
          )}
        </>
      )}{' '}
      <a href="#plan" className="underline decoration-line-strong hover:text-ink-1">
        {tr('Dziennik', 'Ledger')}
      </a>
    </p>
  );
};

export const SchrodiPanel: React.FC<{
  f: Forecast;
  model: SchrodiModel;
  at: number;
  now: number;
  stale: boolean;
  /** Bieżąca cena BTC (poziomy liczone od niej); brak → cena z chwili prognozy */
  livePx?: number | null;
  onClose: () => void;
}> = ({ f, model, at, now, stale, livePx, onClose }) => {
  const mood = moodOf(f, now, stale);
  const ev = nextMacro(now);
  const levels = f.levels
    ? (Object.keys(LEVEL_NAMES) as (keyof Levels)[])
        .map((k) => ({ k, px: f.levels![k] }))
        .filter((l) => Number.isFinite(l.px))
        .sort((a, b) => b.px - a.px)
    : [];
  const px = livePx && livePx > 0 ? livePx : f.price;
  const { summary } = useDeskLedger();
  const live = summary && isCat(summary.cat) && summary.cat.since !== null ? summary.cat : null;
  const above = levels.filter((l) => l.px > px).slice(-2);
  const below = levels.filter((l) => l.px <= px).slice(0, 2);
  const card = model.card as unknown as Card;
  const tm = useTouchModel();
  // Szanse dotknięcia od bieżącej ceny z cechami ostatniej świecy 5m (dziennik zapisuje je od ceny zamknięcia tej świecy)
  const touch = useMemo(() => {
    if (!tm || !Number.isFinite(f.med1h)) return null;
    // Dalej niż zakres uczenia: szansa nie rośnie z odległością, więc wartość na granicy jest górnym ograniczeniem
    const at = (lvl: number): string => {
      const d = Math.log(lvl / px) * 1e4;
      const far = Math.abs(d) > TOUCH_MAX_R * f.med1h;
      const p = touchProb(tm, f.x, f.med1h, far ? Math.sign(d) * TOUCH_MAX_R * f.med1h : d);
      if (!Number.isFinite(p)) return '—';
      if (p < 0.005) return '<1%';
      return far ? `≤${pct(p)}` : pct(p);
    };
    return { at, cone: touchCone(tm, f.x, f.med1h) };
  }, [tm, f, px]);
  const tcard = tm ? (tm.card as unknown as TouchCard).B : null;
  const dirTitle =
    f.stance === 'long' ? `LONG ${pct(f.pUp)}` : f.stance === 'short' ? `SHORT ${pct(1 - f.pUp)}` : tr('NIE WIEM', "DON'T KNOW");
  const dirTone = f.stance === 'long' ? 'text-buy-ink' : f.stance === 'short' ? 'text-sell-ink' : 'text-ink-2';
  const time = new Date(f.t + 5 * MIN).toLocaleTimeString(tr('pl-PL', 'en-GB'), { hour: '2-digit', minute: '2-digit' });
  return (
    <div role="dialog" aria-label="Schrödi" className="rounded-xl border border-line-strong bg-surface-2/95 backdrop-blur shadow-2xl text-ink-1 overflow-hidden">
      <div className="flex items-start gap-3 px-3 pt-3 pb-2">
        <SchrodiCat pUp={f.pUp} mood={mood} size={56} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Schrödi</span>
            <span className="text-[10px] uppercase tracking-wide text-ink-3">BTC · {tr('najbliższa godzina', 'next hour')}</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-ink-2">
            {stale ? tr('Nie mam świeżych danych z Hyperliquid, chowam się pod stołem.', 'No fresh Hyperliquid data, hiding under the table.') : catLine(f, mood, now)}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={tr('Zamknij', 'Close')} className="shrink-0 grid place-items-center w-7 h-7 rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 pb-3 flex flex-col gap-3">
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-ink-2">🌊 {tr('Duży ruch w ciągu godziny', 'Big move within the hour')}</span>
            <span className="font-mono text-sm font-semibold text-accent">{pct(f.pBig)}</span>
          </div>
          <ProbBar p={f.pBig} tone="move" />
          <p className="mt-1 text-[11px] text-ink-3">
            {tr(
              `Duży, czyli zakres godziny ponad ${fmtPrice(f.bigUsd, 0)} $ (mediana z 30 dni).`,
              `Big means an hourly range above $${fmtPrice(f.bigUsd, 0)} (30-day median).`
            )}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-ink-2">🎯 {tr('Kierunek', 'Direction')}</span>
            <span className={`font-mono text-sm font-semibold ${dirTone}`}>{dirTitle}</span>
          </div>
          <ProbBar p={f.pUp} tone="dir" />
          <p className="mt-1 text-[11px] text-ink-3">
            {tr(
              `Szansa wzrostu ${pct(f.pUp)}. Kierunek przewiduję tylko trochę lepiej niż rzut monetą.`,
              `Odds of a rise ${pct(f.pUp)}. I predict direction only slightly better than a coin flip.`
            )}
          </p>
        </div>

        {levels.length > 0 && (
          <div className="text-xs">
            <div className="flex items-baseline justify-between text-ink-2 mb-1">
              <span>
                🧲 {tr('Poziomy od ceny', 'Levels from price')} <span className="font-mono text-ink-1">{fmtPrice(px, 0)}</span>
              </span>
              {touch && <span className="text-[10px] text-ink-3">{tr('dotknie w 1 h', 'touch in 1 h')}</span>}
            </div>
            <div className={`grid ${touch ? 'grid-cols-[1fr_auto_auto_2.5rem]' : 'grid-cols-[1fr_auto_auto]'} gap-x-3 gap-y-0.5 font-mono text-[11px]`}>
              {[...above, ...below].map((l) => {
                return (
                  <React.Fragment key={l.k}>
                    <span className="font-sans text-ink-2">{LEVEL_NAMES[l.k]()}</span>
                    <span className="text-right">{fmtPrice(l.px, 0)}</span>
                    <span className={`text-right ${l.px > px ? 'text-buy-ink' : 'text-sell-ink'}`}>{usd(l.px - px)}</span>
                    {touch && <span className="text-right font-semibold text-ink-1">{touch.at(l.px)}</span>}
                  </React.Fragment>
                );
              })}
            </div>
            {touch && (
              <p className="mt-1 text-[11px] text-ink-3">
                {tr(
                  'Poziomy nie przyciągają ceny: w testach 2022 do 2026 dotykała ich tak samo często jak każdej innej ceny w tej odległości, więc szansa liczona jest jak dla zwykłej ceny.',
                  'Levels do not attract price: in 2022 to 2026 tests they were touched as often as any other price at the same distance, so the odds are those of a plain price.'
                )}
              </p>
            )}
          </div>
        )}

        {touch && touch.cone.some((s) => s.up !== null || s.dn !== null) && (
          <div className="text-xs">
            <div className="text-ink-2 mb-1">📏 {tr('Zasięg godziny', "The hour's reach")}</div>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span className="font-sans text-[10px] text-ink-3">{tr('szansa', 'odds')}</span>
              <span className="font-sans text-[10px] text-ink-3 text-right">{tr('w dół', 'down')}</span>
              <span className="font-sans text-[10px] text-ink-3 text-right">{tr('w górę', 'up')}</span>
              {touch.cone.map((s) => {
                const dn = s.dn === null ? null : px * Math.exp(-s.dn / 1e4);
                const up = s.up === null ? null : px * Math.exp(s.up / 1e4);
                return (
                  <React.Fragment key={s.q}>
                    <span className="font-semibold">{pct(s.q)}</span>
                    <span className="text-right">
                      {dn === null ? '—' : fmtPrice(dn, 0)} <span className="text-sell-ink">{dn === null ? '' : usd(dn - px)}</span>
                    </span>
                    <span className="text-right">
                      {up === null ? '—' : fmtPrice(up, 0)} <span className="text-buy-ink">{up === null ? '' : usd(up - px)}</span>
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              {tr(
                'Każdą z tych cen godzina dotknie z podaną szansą, osobno w górę i w dół.',
                'Within the hour, each of these prices gets touched with the stated odds, up and down separately.'
              )}
            </p>
          </div>
        )}

        {ev && (
          <div className="text-xs text-ink-2">
            ⏰ {KIND_LABEL[ev.kind]} <span className="text-ink-1">{fmtCountdown(ev.timeUtcMs, now)}</span>{' '}
            <span className="text-ink-3">({fmtEventLocal(ev.timeUtcMs)})</span>
          </div>
        )}
      </div>

      <Section title={tr('Dlaczego?', 'Why?')}>
        <p className="mb-2">{tr('Wkład grup cech w szansę wzrostu, w punktach procentowych (w przybliżeniu):', 'Contribution of feature groups to the odds of a rise, in percentage points (approximate):')}</p>
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          {(Object.keys(GROUP_NAMES) as Group[]).map((g) => (
            <React.Fragment key={g}>
              <span>{GROUP_NAMES[g]()}</span>
              <span className={`font-mono text-right ${f.why[g] > 0.05 ? 'text-buy-ink' : f.why[g] < -0.05 ? 'text-sell-ink' : 'text-ink-3'}`}>
                {fmtSigned(f.why[g], 1, ' pp')}
              </span>
            </React.Fragment>
          ))}
        </div>
      </Section>

      <Section title={tr('Jak trafiam', 'My track record')}>
        <p>
          {tr(
            `Test kroczący 2023 do 10.2026 na danych, których model nie widział. Duży ruch: gdy byłem najpewniejszy, że przyjdzie (górne 20% prognoz), przyszedł w ${pct(card.ruch['2023_2025'].gorne20)} przypadków w latach 2023 do 2025 i w ${pct(card.ruch['2026'].gorne20)} w 2026. Gdy mówiłem, że będzie spokojnie, duży ruch był w ${pct(card.ruch['2026'].dolne20)}.`,
            `Walk-forward test 2023 to 10.2026 on data the model had not seen. Big move: when I was most sure it would come (top 20% of forecasts), it came in ${pct(card.ruch['2023_2025'].gorne20)} of cases in 2023 to 2025 and ${pct(card.ruch['2026'].gorne20)} in 2026. When I said it would be quiet, a big move came in ${pct(card.ruch['2026'].dolne20)}.`
          )}
        </p>
        <p className="mt-2">
          {tr(
            `Kierunek: Long trafiał w ${pct(card.kierunek['2023_2025'].long[1])} i ${pct(card.kierunek['2026'].long[1])}, Short w ${pct(card.kierunek['2023_2025'].short[1])} i ${pct(card.kierunek['2026'].short[1])}. Wygrane są małe, więc po kosztach sam kierunek nie wystarcza na zysk.`,
            `Direction: Long was right ${pct(card.kierunek['2023_2025'].long[1])} and ${pct(card.kierunek['2026'].long[1])} of the time, Short ${pct(card.kierunek['2023_2025'].short[1])} and ${pct(card.kierunek['2026'].short[1])}. Wins are small, so direction alone does not pay after costs.`
          )}
        </p>
        {tcard && (
          <p className="mt-2">
            {tr(
              `Dotknięcia: gdy mówiłem ok. ${pct(tcard['2026']['pasmo_0.7_0.9'][0])}, cena dotykała w ${pct(tcard['2026']['pasmo_0.7_0.9'][1])} przypadków (2026), ok. ${pct(tcard['2026']['pasmo_0.4_0.6'][0])} w ${pct(tcard['2026']['pasmo_0.4_0.6'][1])}, ok. ${pct(tcard['2026']['pasmo_0.1_0.3'][0])} w ${pct(tcard['2026']['pasmo_0.1_0.3'][1])}. Wynik Briera o ${pct(tcard['2026'].bss_vs_BM)} lepszy niż dla ruchu Browna.`,
              `Touches: when I said about ${pct(tcard['2026']['pasmo_0.7_0.9'][0])}, price touched in ${pct(tcard['2026']['pasmo_0.7_0.9'][1])} of cases (2026), about ${pct(tcard['2026']['pasmo_0.4_0.6'][0])} in ${pct(tcard['2026']['pasmo_0.4_0.6'][1])}, about ${pct(tcard['2026']['pasmo_0.1_0.3'][0])} in ${pct(tcard['2026']['pasmo_0.1_0.3'][1])}. Brier score ${pct(tcard['2026'].bss_vs_BM)} better than for Brownian motion.`
            )}
          </p>
        )}
        {live && <LiveRecord live={live} />}
      </Section>

      <Section title={tr('O mnie', 'About me')}>
        <p>
          {tr(
            'Jestem kotem Schrödingera: dopóki rynek nie zdecyduje, jestem trochę Long i trochę Short. Im bardziej się rozmywam, tym mniej wiem. Liczę 22 cechy ze świec Hyperliquid (ruch, zmienność, aukcja, zegar sesji, kalendarz makro) i łączę regresję logistyczną z 300 drzewami decyzyjnymi.',
            "I'm Schrödinger's cat: until the market decides, I'm a bit Long and a bit Short. The blurrier I am, the less I know. I compute 22 features from Hyperliquid candles (move, volatility, auction, session clock, macro calendar) and combine a logistic regression with 300 decision trees."
          )}{' '}
          <a href={DOC_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong hover:text-ink-1">
            {tr('Metoda i wyniki', 'Method and results')}
          </a>
        </p>
      </Section>

      <div className="border-t border-line px-3 py-2 text-[10px] text-ink-3 leading-snug">
        <Badge tone="model" title={tr('Wynik modelu liczony z realnych danych', 'Model output computed from real data')}>
          MODEL
        </Badge>{' '}
        {tr(
          `Prognoza z ${time}, liczona w przeglądarce ze świec Hyperliquid (${model.version}${tm ? `, ${tm.version}` : ''}). To nie jest porada inwestycyjna.`,
          `Forecast from ${time}, computed in your browser from Hyperliquid candles (${model.version}${tm ? `, ${tm.version}` : ''}). Not investment advice.`
        )}
        {now - at > 15 * MIN && <span className="text-warn"> {tr('Dane nieświeże.', 'Data not fresh.')}</span>}
      </div>
    </div>
  );
};
