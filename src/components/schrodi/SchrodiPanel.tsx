import React, { useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { KIND_LABEL, MACRO_EVENTS, type MacroEvent, fmtEventLocal } from '../../data/macroCalendar';
import { locale, tr } from '../../i18n';
import { useDeskLedger } from '../../state/useDeskLedger';
import { Badge } from '../../ui';
import { isCat } from '../../utils/deskLedger';
import { fmtCountdown, fmtE, fmtPrice, fmtSigned } from '../../ui/format';
import {
  type Forecast,
  type Group,
  type Levels,
  MIND_MIN,
  type MindChange,
  type SchrodiModel,
  type Snap,
  TOUCH_MAX_R,
  mindChange,
  touchCone,
  touchProb,
} from '../../utils/schrodi';
import { type HourModel, type HourPoint, hourPath } from '../../utils/schrodiHour';
import { type CatTrust, type HourTrust, type OodFeature, TRUST_DESIGN, TRUST_HEADS, type TrustHeadKey, driftAlarms, oodKeys, proofState } from '../../utils/schrodiTrust';
import { type Mood, SchrodiCat } from './SchrodiCat';
import { HIST_MIN, type HourLive, useHourModel, useTouchModel } from './useSchrodi';

/**
 * Dymek Schrödiego: najpierw wielkość ruchu w najbliższej godzinie, poziomy i makro, potem kierunek z uczciwym %.
 * Przy poziomach szansa dotknięcia w godzinę i stożek zasięgu (model dotknięć, wczytywany po otwarciu dymka).
 * Rozwijane: „Dlaczego?” (wkład grup cech), „Jak trafiam” (walidacja krocząca, dowód i wynik na żywo z dziennika), „O mnie”.
 * Zaufanie: szary tryb przy alarmie dryfu z dziennika, znacznik rzadkiego rynku (cechy poza zakresem z nauki).
 * Na żywo: zmiana zdania w 10 min z grupami cech, które ją niosą, i wykres zdania z ostatniej godziny.
 * „Ta godzina”: szanse w bieżącej pełnej godzinie po każdej minucie (model godziny, wczytywany po otwarciu dymka).
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

const OOD_NAMES: Record<OodFeature, () => string> = {
  ret_15m: () => tr('ruch 15 min', '15 min move'),
  ret_1h: () => tr('ruch godziny', '1 h move'),
  ret_4h: () => tr('ruch 4 h', '4 h move'),
  ret_1d: () => tr('ruch doby', '1 day move'),
  rv_1h: () => tr('zmienność godziny', '1 h volatility'),
  rv_1d: () => tr('zmienność doby', '1 day volatility'),
  rng4h_rel: () => tr('zakres 4 h', '4 h range'),
  vol_z: () => tr('wolumen', 'volume'),
};

const HEAD_NAMES: Record<TrustHeadKey, () => string> = {
  big: () => tr('duży ruch', 'big move'),
  dir: () => tr('kierunek', 'direction'),
  touch: () => tr('dotknięcia', 'touches'),
};

/** Szansa jako częstość: „w 10 takich godzinach około N razy” (łatwiej ocenić niż procent) */
function inTen(p: number): string {
  const n = Math.round(p * 10);
  if (n === 0) return tr('W 10 takich godzinach prawie nigdy.', 'In 10 such hours almost never.');
  if (n === 10) return tr('W 10 takich godzinach prawie zawsze.', 'In 10 such hours almost always.');
  return tr(`W 10 takich godzinach średnio ${n} ${n === 1 ? 'raz' : 'razy'}.`, `In 10 such hours about ${n} ${n === 1 ? 'time' : 'times'}.`);
}

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

/** Dowód na żywo: kapitał zakładu wobec prostej reguły od zapisania planu w dzienniku (próg 20 = dowód przewagi). */
const LiveProof: React.FC<{ t: CatTrust }> = ({ t }) => {
  if (!t.plan || t.big.n === 0) return null;
  const proven = TRUST_HEADS.filter((k) => proofState(t[k]) === 'holding');
  const faded = TRUST_HEADS.filter((k) => proofState(t[k]) === 'faded');
  return (
    <p className="mt-2">
      <span className="text-ink-1">{tr('Dowód na żywo', 'Live proof')}</span>{' '}
      {tr(
        `(od ${new Date(t.plan.at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}): co godzinę stawiam wirtualny zakład, że trafię lepiej niż prosta reguła. Start 1, dowód przy ${TRUST_DESIGN.proof.threshold}, bo bez przewagi tyle zdarza się najwyżej w 5%. Po ${t.big.n} godz.: duży ruch ${fmtE(t.big.lg)}, kierunek ${fmtE(t.dir.lg)}, dotknięcia ${fmtE(t.touch.lg)}.`,
        `(since ${new Date(t.plan.at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}): every hour I place a virtual bet that I beat a simple rule. Start 1, proof at ${TRUST_DESIGN.proof.threshold}, because without an edge that happens at most 5% of the time. After ${t.big.n} h: big move ${fmtE(t.big.lg)}, direction ${fmtE(t.dir.lg)}, touches ${fmtE(t.touch.lg)}.`
      )}
      {proven.length > 0 && (
        <span className="text-buy-ink">
          {' '}
          {tr(`Przewaga dowiedziona: ${proven.map((k) => HEAD_NAMES[k]()).join(', ')}.`, `Edge proven: ${proven.map((k) => HEAD_NAMES[k]()).join(', ')}.`)}
        </span>
      )}
      {faded.length > 0 &&
        ` ${tr(
          `Dowód był, ale od tego czasu kapitał spadł poniżej ${TRUST_DESIGN.proof.threshold}: ${faded.map((k) => HEAD_NAMES[k]()).join(', ')}.`,
          `Proven earlier, but capital has since fallen below ${TRUST_DESIGN.proof.threshold}: ${faded.map((k) => HEAD_NAMES[k]()).join(', ')}.`
        )}`}
    </p>
  );
};

/** Godzina na żywo: wynik testów i dowód w dzienniku (zapisy o :15 i :30 wobec tej samej metody z samej drogi ceny). */
const HourProof: React.FC<{ h: HourTrust | undefined }> = ({ h }) => (
  <p className="mt-2">
    <span className="text-ink-1">{tr('Godzina na żywo', 'Live hour')}</span>{' '}
    {tr(
      'w testach 2024 do 2026: o :15 i :30 duży ruch w tej godzinie trafiałem o 4% lepiej (Brier) niż z samej drogi ceny, a dowód w dzienniku przychodził po ok. 34 dniach (mediana).',
      'in 2024 to 2026 tests: at :15 and :30 I called a big move this hour 4% better (Brier) than from the price path alone, and the ledger proof came after about 34 days (median).'
    )}
    {h?.plan &&
      h.big.n > 0 &&
      ` ${tr(
        `Na żywo od ${new Date(h.plan.at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}: po ${h.big.n} godz. kapitał zakładu ${fmtE(h.big.lg)} (start 1, dowód od ${TRUST_DESIGN.proof.threshold})${proofState(h.big) === 'holding' ? ', przewaga dowiedziona' : ''}.`,
        `Live since ${new Date(h.plan.at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}: after ${h.big.n} h betting capital ${fmtE(h.big.lg)} (start 1, proof at ${TRUST_DESIGN.proof.threshold})${proofState(h.big) === 'holding' ? ', edge proven' : ''}.`
      )}`}
  </p>
);

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

/** Zmiana zdania w ostatnich 10 min i grupy cech, które ją niosą (wkład w przybliżeniu). */
const MindLine: React.FC<{ m: MindChange }> = ({ m }) => {
  const what = m.head === 'big' ? tr('duży ruch', 'big move') : tr('szansa wzrostu', 'odds of a rise');
  const by = m.drivers.map((d) => `${GROUP_NAMES[d.g]().toLowerCase()} ${fmtSigned(d.pp, 0, ' pp')}`).join(', ');
  return (
    <div role="status" className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px] leading-snug text-ink-1">
      🔄{' '}
      {tr(
        `Zmiana zdania w ostatnich ${MIND_MIN} min: ${what} z ${pct(m.from)} na ${pct(m.to)}.`,
        `Change of mind in the last ${MIND_MIN} min: ${what} from ${pct(m.from)} to ${pct(m.to)}.`
      )}
      {by && ` ${tr(`Najwięcej zmieniły (w przybliżeniu): ${by}.`, `Moved most by (approximately): ${by}.`)}`}
    </div>
  );
};

/** Zdanie kota w ostatniej godzinie: szansa dużego ruchu i szansa wzrostu na koniec każdej minuty. */
const MindChart: React.FC<{ hist: Snap[] }> = ({ hist }) => {
  const end = hist[hist.length - 1]?.s ?? 0;
  const pts = hist.filter((h) => h.s >= end - HIST_MIN * MIN);
  if (pts.length < 2) return null;
  const W = 300;
  const H = 48;
  const x = (t: number) => ((t - (end - HIST_MIN * MIN)) / (HIST_MIN * MIN)) * W;
  const path = (k: 'pBig' | 'pUp') => pts.map((h, i) => `${i ? 'L' : 'M'}${x(h.s).toFixed(1)},${((1 - h[k]) * H).toFixed(1)}`).join('');
  const a = pts[0];
  const b = pts[pts.length - 1];
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between text-ink-2 mb-1">
        <span>📈 {tr('Moje zdanie w ostatniej godzinie', 'My view over the last hour')}</span>
        <span className="text-[10px] text-ink-3">
          <span className="text-accent">━</span> {tr('ruch', 'move')} <span className="text-ink-2">━</span> {tr('wzrost', 'rise')}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-12 rounded bg-surface-3/40"
        role="img"
        aria-label={tr(
          `Duży ruch od ${pct(a.pBig)} do ${pct(b.pBig)}, szansa wzrostu od ${pct(a.pUp)} do ${pct(b.pUp)}`,
          `Big move from ${pct(a.pBig)} to ${pct(b.pBig)}, odds of a rise from ${pct(a.pUp)} to ${pct(b.pUp)}`
        )}
      >
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-line-strong" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={path('pUp')} fill="none" className="stroke-ink-2" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        <path d={path('pBig')} fill="none" className="stroke-accent" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-ink-3">
        <span>−{HIST_MIN} min</span>
        <span>{tr('linia przerywana: 50%', 'dashed line: 50%')}</span>
        <span>{tr('teraz', 'now')}</span>
      </div>
    </div>
  );
};

/** Czas lokalny HH:MM */
const hhmm = (t: number) => new Date(t).toLocaleTimeString(tr('pl-PL', 'en-GB'), { hour: '2-digit', minute: '2-digit' });

/** Wykres szans w tej godzinie: minuty 0 do 60, znaczniki chwil zapisu do dziennika (15 i 30 min). */
const HourChart: React.FC<{ pts: HourPoint[]; hs: number }> = ({ pts, hs }) => {
  const W = 300;
  const H = 40;
  const x = (m: number) => (m / 60) * W;
  const path = (k: 'pBig' | 'pUp') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)},${((1 - p[k]) * H).toFixed(1)}`).join('');
  return (
    <div>
      <div className="text-right text-[10px] text-ink-3 mb-0.5">
        <span className="text-accent">━</span> {tr('ruch', 'move')} <span className="text-ink-2">━</span> {tr('wzrost', 'rise')}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-10 rounded bg-surface-3/40" aria-hidden="true">
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-line-strong" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {[15, 30].map((m) => (
          <line key={m} x1={x(m)} x2={x(m)} y1={0} y2={H} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {pts.length > 1 && <path d={path('pUp')} fill="none" className="stroke-ink-2" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />}
        {pts.length > 1 && <path d={path('pBig')} fill="none" className="stroke-accent" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="relative h-3.5 text-[10px] text-ink-3">
        <span className="absolute left-0">{hhmm(hs)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: '25%' }}>
          :15
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: '50%' }}>
          :30
        </span>
        <span className="absolute right-0">{hhmm(hs + 60 * MIN)}</span>
      </div>
    </div>
  );
};

/**
 * Ta godzina: szansa dużego ruchu i wzrostu w bieżącej pełnej godzinie, po każdej minucie z drogi ceny od jej początku
 * i prognozy kota z tej chwili. Kierunek tylko z drogi ceny (prognoza z początku godziny nic tu nie dodaje).
 */
const HourBlock: React.FC<{ hm: HourModel; hour: HourLive; end: number }> = ({ hm, hour, end }) => {
  const pts = useMemo(() => hourPath(hm, hour.m1, hour.start, end), [hm, hour, end]);
  if (!pts) return null;
  const { hs, c0, thr } = hour.start;
  const last = pts[pts.length - 1];
  const mins = hour.m1.filter((b) => b.t >= hs && b.t + MIN <= end);
  const range = mins.length ? Math.max(...mins.map((b) => b.h)) - Math.min(...mins.map((b) => b.l)) : 0;
  const thrUsd = c0 * (Math.exp(thr / 1e4) - 1);
  const done = last.m > 0 && last.pBig === 1;
  return (
    <div className="text-xs rounded-md border border-line px-2 py-2 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-ink-2">
        <span>
          ⏱️ {tr('Ta godzina', 'This hour')} <span className="font-mono text-ink-1">{hhmm(hs)}</span>
          {tr(' do ', ' to ')}
          <span className="font-mono text-ink-1">{hhmm(hs + 60 * MIN)}</span>
        </span>
        <span className="text-[10px] text-ink-3">{tr(`zostało ${60 - last.m} min`, `${60 - last.m} min left`)}</span>
      </div>
      <div>
        <div className="flex items-baseline justify-between text-[11px] text-ink-3">
          <span>{tr('Zakres do teraz', 'Range so far')}</span>
          <span className="font-mono">
            <span className="text-ink-1">{fmtPrice(range, 0)} $</span> {tr('z', 'of')} {fmtPrice(thrUsd, 0)} $
          </span>
        </div>
        <ProbBar p={Math.min(1, range / thrUsd)} tone="move" />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-ink-2">🌊 {tr('Duży ruch w tej godzinie', 'Big move this hour')}</span>
        <span className="font-mono text-sm font-semibold text-accent">{pct(last.pBig)}</span>
      </div>
      {last.m > 0 && !done && (
        <p className="-mt-1 text-[10px] text-ink-3 text-right">
          {tr(`z samej drogi ceny ${pct(last.pBigRule)}`, `from the price path alone ${pct(last.pBigRule)}`)}
        </p>
      )}
      <div className="flex items-baseline justify-between">
        <span className="text-ink-2">
          🎯 {tr('Zamknie wyżej niż o', 'Closes above')} {hhmm(hs)} <span className="font-mono text-ink-3">({fmtPrice(c0, 0)})</span>
        </span>
        <span className={`font-mono text-sm font-semibold ${last.pUp >= 0.5 ? 'text-buy-ink' : 'text-sell-ink'}`}>{pct(last.pUp)}</span>
      </div>
      <HourChart pts={pts} hs={hs} />
      <p className="text-[11px] leading-snug text-ink-3">
        {done
          ? tr('Duży ruch w tej godzinie już jest: zakres przekroczył próg.', 'The big move this hour has happened: the range crossed the threshold.')
          : tr(
              `Liczę po każdej minucie z drogi ceny od ${hhmm(hs)} i mojej prognozy z tej chwili. W testach 2024 do 2026 duży ruch trafiałem tak o 6% lepiej (Brier) niż z samej drogi ceny, najwięcej na początku godziny. Kierunek tylko z drogi ceny. Do dziennika trafia o :15 i :30.`,
              `I update after every minute from the price path since ${hhmm(hs)} and my forecast from that moment. In 2024 to 2026 tests that way I called big moves 6% better (Brier) than from the price path alone, most at the start of the hour. Direction from the price path only. Recorded in the ledger at :15 and :30.`
            )}
      </p>
    </div>
  );
};

export const SchrodiPanel: React.FC<{
  f: Forecast;
  model: SchrodiModel;
  at: number;
  now: number;
  stale: boolean;
  /** Zdanie na koniec każdej minuty z ostatniej godziny (ostatni wpis = bieżąca prognoza) */
  hist: Snap[];
  /** Bieżąca pełna godzina (start z prognozy kota i minuty do teraz) */
  hour: HourLive | null;
  onClose: () => void;
}> = ({ f, model, at, now, stale, hist, hour, onClose }) => {
  const mood = moodOf(f, now, stale);
  const ev = nextMacro(now);
  const levels = f.levels
    ? (Object.keys(LEVEL_NAMES) as (keyof Levels)[])
        .map((k) => ({ k, px: f.levels![k] }))
        .filter((l) => Number.isFinite(l.px))
        .sort((a, b) => b.px - a.px)
    : [];
  const px = f.price;
  const mind = hist.length ? mindChange(hist, hist[hist.length - 1]) : null;
  const { summary } = useDeskLedger();
  const live = summary && isCat(summary.cat) && summary.cat.since !== null ? summary.cat : null;
  const trust = live?.trust ?? null;
  const alarms = driftAlarms(trust);
  const ood = oodKeys((k) => f.x[k]);
  const above = levels.filter((l) => l.px > px).slice(-2);
  const below = levels.filter((l) => l.px <= px).slice(0, 2);
  const card = model.card as unknown as Card;
  const tm = useTouchModel();
  const hm = useHourModel();
  // Szanse dotknięcia od bieżącej ceny z cechami tej samej chwili (dziennik zapisuje je co 15 min od ceny zamknięcia świecy 5m)
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
  const time = new Date(at).toLocaleTimeString(tr('pl-PL', 'en-GB'), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div role="dialog" aria-label="Schrödi" className="rounded-xl border border-line-strong bg-surface-2/95 backdrop-blur shadow-2xl text-ink-1 overflow-hidden">
      <div className="flex items-start gap-3 px-3 pt-3 pb-2">
        <SchrodiCat pUp={f.pUp} mood={mood} size={56} className={`shrink-0 ${alarms.length ? 'grayscale opacity-70' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold">Schrödi</span>
            <span className="text-[10px] uppercase tracking-wide text-ink-3 whitespace-nowrap">BTC · {tr('najbliższa godzina', 'next hour')}</span>
            {!stale && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-buy-ink whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-buy animate-pulse" aria-hidden="true" />
                {tr('na żywo', 'live')}
              </span>
            )}
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
        {alarms.length > 0 && (
          <div role="status" className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] leading-snug text-ink-1">
            ⚠️{' '}
            {tr(
              `Szary tryb: ostatnio trafiam gorzej niż prosta reguła (${alarms.map((k) => HEAD_NAMES[k]()).join(', ')}). Traktuj moje procenty ostrożnie, dopóki alarm nie zgaśnie.`,
              `Grey mode: lately I do worse than a simple rule (${alarms.map((k) => HEAD_NAMES[k]()).join(', ')}). Treat my odds with care until the alarm clears.`
            )}
          </div>
        )}
        {mind && !stale && <MindLine m={mind} />}
        {ood.length > 0 && (
          <div className="rounded-md border border-line px-2 py-1.5 text-[11px] leading-snug text-ink-2">
            🧭 <span className="font-medium text-ink-1">{tr('Rzadki rynek', 'Rare market')}</span>:{' '}
            {tr(
              `${ood.map((k) => OOD_NAMES[k]()).join(', ')} poza zakresem 99% godzin z nauki. W 2026 takich godzin było 275 z 7124 i duży ruch trafiałem w nich lepiej niż zwykle (w burzy jest prawie pewny). Kierunek nadal zgaduję tylko trochę lepiej niż rzut monetą.`,
              `${ood.map((k) => OOD_NAMES[k]()).join(', ')} outside the range of 99% of training hours. In 2026 there were 275 such hours out of 7124 and I called big moves better than usual in them (in a storm one is almost certain). Direction is still only slightly better than a coin flip.`
            )}
          </div>
        )}
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
            )}{' '}
            {inTen(f.pBig)}
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

        {hm && hour && !stale && <HourBlock hm={hm} hour={hour} end={f.t + 5 * MIN} />}

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

        {!stale && <MindChart hist={hist} />}

        {ev && (
          <div className="text-xs text-ink-2">
            ⏰ {KIND_LABEL[ev.kind]} <span className="text-ink-1">{fmtCountdown(ev.timeUtcMs, now)}</span>{' '}
            <span className="text-ink-3">({fmtEventLocal(ev.timeUtcMs)})</span>
          </div>
        )}
      </div>

      <Section title={tr('Dlaczego?', 'Why?')}>
        <p className="mb-2">
          {tr(
            'Wkład grup cech w szansę dużego ruchu i w szansę wzrostu, w punktach procentowych (w przybliżeniu):',
            'Contribution of feature groups to the odds of a big move and of a rise, in percentage points (approximate):'
          )}
        </p>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1">
          <span />
          <span className="text-[10px] text-ink-3 text-right">{tr('ruch', 'move')}</span>
          <span className="text-[10px] text-ink-3 text-right">{tr('wzrost', 'rise')}</span>
          {(Object.keys(GROUP_NAMES) as Group[]).map((g) => (
            <React.Fragment key={g}>
              <span>{GROUP_NAMES[g]()}</span>
              <span className={`font-mono text-right ${Math.abs(f.whyBig[g]) > 0.05 ? 'text-accent' : 'text-ink-3'}`}>{fmtSigned(f.whyBig[g], 1, ' pp')}</span>
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
        {trust && <LiveProof t={trust} />}
        <HourProof h={live?.hour} />
        {live && <LiveRecord live={live} />}
      </Section>

      <Section title={tr('O mnie', 'About me')}>
        <p>
          {tr(
            'Jestem kotem Schrödingera: dopóki rynek nie zdecyduje, jestem trochę Long i trochę Short. Im bardziej się rozmywam, tym mniej wiem. Liczę 22 cechy ze świec Hyperliquid (ruch, zmienność, aukcja, zegar sesji, kalendarz makro) i łączę regresję logistyczną z 300 drzewami decyzyjnymi.',
            "I'm Schrödinger's cat: until the market decides, I'm a bit Long and a bit Short. The blurrier I am, the less I know. I compute 22 features from Hyperliquid candles (move, volatility, auction, session clock, macro calendar) and combine a logistic regression with 300 decision trees."
          )}{' '}
          {tr(
            'Liczę się na żywo, na świecach kończących się w tej chwili: w testach 2023 do 2026 świeża prognoza przy nagłym ruchu trafiała duże ruchy do 52% lepiej (Brier) niż prognoza sprzed kilku minut.',
            'I update live, on candles ending right now: in 2023 to 2026 tests a fresh forecast during a sudden move called big moves up to 52% better (Brier) than one a few minutes old.'
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
          `Na żywo, dane z ${time}: przeliczam w przeglądarce przy każdej zmianie świecy minutowej Hyperliquid, najwyżej raz na sekundę (${model.version}${tm ? `, ${tm.version}` : ''}${hm ? `, ${hm.version}` : ''}). Do dziennika trafia prognoza co 15 minut. To nie jest porada inwestycyjna.`,
          `Live, data from ${time}: recomputed in your browser on every change of the Hyperliquid minute candle, at most once a second (${model.version}${tm ? `, ${tm.version}` : ''}${hm ? `, ${hm.version}` : ''}). The ledger records a forecast every 15 minutes. Not investment advice.`
        )}
        {stale && <span className="text-warn"> {tr('Dane nieświeże.', 'Data not fresh.')}</span>}
      </div>
    </div>
  );
};
