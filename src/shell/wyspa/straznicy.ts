import type { SessionId } from '../../charts/pro/core/sessions';
import type { OHLCVBar } from '../../types/trading';
import { tr } from '../../i18n';

/**
 * Strażnicy (wyspa botów, poziom 1): warunki na publicznych danych desku liczone w przeglądarce, gdy karta jest otwarta.
 * Bez kont, kluczy i danych na serwerze: reguły i dziennik zdarzeń tylko w pamięci tego urządzenia. Zdarzenie opisuje
 * stan rynku (przecięcie poziomu, otwarcie sesji, próg fundingu, wielkość ruchu, likwidacje), nigdy kierunek ani poradę.
 * Czyste funkcje: bez sieci i bez zegara (czas w migawce).
 */

export type RuleKind = 'poziom' | 'pdh' | 'pdl' | 'sesja' | 'funding' | 'ruch' | 'likwidacje';

export interface Rule {
  id: string;
  kind: RuleKind;
  on: boolean;
  /** Poziom ceny (poziom), próg fundingu rocznie w % (funding), próg ruchu w % (ruch), próg likwidacji w USD (likwidacje) */
  value?: number;
  /** Sesja, której otwarcie zgłosić (sesja) */
  session?: SessionId;
  /** Ostatnie zdarzenie reguły (ms), do przerwy między powiadomieniami */
  lastAt?: number;
}

/** Stan rynku w chwili oceny; brak liczby — null (warunek, który jej potrzebuje, milczy). */
export interface Snapshot {
  at: number;
  price: number | null;
  pdh: number | null;
  pdl: number | null;
  /** Funding roczny w % */
  fundingApr: number | null;
  /** Wielkość ruchu ceny w ostatnich 15 min, w % (bez znaku) */
  move15Pct: number | null;
  /** Likwidacje (longi i shorty) w ostatnich 5 min, USD */
  liq5Usd: number | null;
  session: SessionId;
}

export interface GuardEvent {
  ruleId: string;
  kind: RuleKind;
  at: number;
  text: string;
}

/** Przerwa między dwoma zdarzeniami tej samej reguły (bez zalewu powiadomień przy cenie skaczącej wokół poziomu). */
export const COOLDOWN_MS = 10 * 60_000;
export const MAX_RULES = 12;
export const MAX_LOG = 30;

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Cena przeszła przez poziom między dwiema migawkami (w którąkolwiek stronę). */
export function crossed(prev: number | null, cur: number | null, level: number | null | undefined): boolean {
  if (!num(prev) || !num(cur) || !num(level)) return false;
  return (prev < level && cur >= level) || (prev > level && cur <= level);
}

/** Próg przekroczony teraz, a wcześniej nie (zdarzenie raz na wejście ponad próg). */
const rose = (prev: number | null | undefined, cur: number | null | undefined, threshold: number | undefined) =>
  num(cur) && num(threshold) && cur >= threshold && (!num(prev) || prev < threshold);

export interface Labels {
  price: (v: number) => string;
  pct: (v: number) => string;
  usd: (v: number) => string;
  session: (s: SessionId) => string;
}

/** Zdarzenia reguł włączonych między poprzednią a bieżącą migawką (z przerwą `COOLDOWN_MS` na regułę). */
export function evaluate(rules: readonly Rule[], prev: Snapshot | null, cur: Snapshot, l: Labels): GuardEvent[] {
  if (!prev) return [];
  const out: GuardEvent[] = [];
  for (const r of rules) {
    if (!r.on || (r.lastAt !== undefined && cur.at - r.lastAt < COOLDOWN_MS)) continue;
    const ev = (text: string) => out.push({ ruleId: r.id, kind: r.kind, at: cur.at, text });
    const now = num(cur.price) ? tr(` (teraz ${l.price(cur.price)})`, ` (now ${l.price(cur.price)})`) : '';
    switch (r.kind) {
      case 'poziom':
        if (crossed(prev.price, cur.price, r.value)) ev(tr(`Cena przecięła poziom ${l.price(r.value!)}`, `Price crossed the level ${l.price(r.value!)}`) + now);
        break;
      case 'pdh':
        if (crossed(prev.price, cur.price, cur.pdh)) ev(tr(`Cena przecięła PDH ${l.price(cur.pdh!)}`, `Price crossed PDH ${l.price(cur.pdh!)}`) + now);
        break;
      case 'pdl':
        if (crossed(prev.price, cur.price, cur.pdl)) ev(tr(`Cena przecięła PDL ${l.price(cur.pdl!)}`, `Price crossed PDL ${l.price(cur.pdl!)}`) + now);
        break;
      case 'sesja':
        if (r.session && prev.session !== cur.session && cur.session === r.session) ev(tr(`Otwarcie sesji: ${l.session(r.session)}`, `Session open: ${l.session(r.session)}`));
        break;
      case 'funding': {
        const p = num(prev.fundingApr) ? Math.abs(prev.fundingApr) : null;
        const c = num(cur.fundingApr) ? Math.abs(cur.fundingApr) : null;
        if (rose(p, c, r.value)) ev(tr(`Funding ${l.pct(cur.fundingApr!)} rocznie, ponad próg ${l.pct(r.value!)}`, `Funding ${l.pct(cur.fundingApr!)} per year, above ${l.pct(r.value!)}`));
        break;
      }
      case 'ruch':
        if (rose(prev.move15Pct, cur.move15Pct, r.value)) ev(tr(`Ruch ceny ${l.pct(cur.move15Pct!)} w 15 min, ponad próg ${l.pct(r.value!)}`, `Price move of ${l.pct(cur.move15Pct!)} in 15 min, above ${l.pct(r.value!)}`));
        break;
      case 'likwidacje':
        if (rose(prev.liq5Usd, cur.liq5Usd, r.value)) ev(tr(`Likwidacje ${l.usd(cur.liq5Usd!)} w 5 min, ponad próg ${l.usd(r.value!)}`, `Liquidations of ${l.usd(cur.liq5Usd!)} in 5 min, above ${l.usd(r.value!)}`));
        break;
    }
  }
  return out;
}

/**
 * Wielkość ruchu w ostatnich 15 min (%, bez znaku) i likwidacje w ostatnich 5 min (USD) ze świec desku. Świece dłuższe niż
 * okno: liczy się ostatnia świeca. Za mało świec — null.
 */
export function marketWindows(bars: readonly OHLCVBar[], price: number | null, now: number, tfSec: number): { move15Pct: number | null; liq5Usd: number | null } {
  if (bars.length === 0) return { move15Pct: null, liq5Usd: null };
  const tf = tfSec * 1000;
  const from15 = now - 15 * 60_000;
  const ref = [...bars].reverse().find((b) => b.time <= from15) ?? (bars[0].time <= from15 + tf ? bars[0] : undefined);
  const move15Pct = ref && num(price) && ref.close > 0 ? (Math.abs(price - ref.close) / ref.close) * 100 : null;
  const from5 = now - 5 * 60_000 - (tf > 5 * 60_000 ? 0 : tf);
  const recent = bars.filter((b) => b.time >= from5);
  const last = bars[bars.length - 1];
  const liq = (recent.length > 0 ? recent : [last]).reduce((s, b) => s + (num(b.lbuy) ? b.lbuy : 0) + (num(b.lsell) ? b.lsell : 0), 0);
  return { move15Pct, liq5Usd: liq };
}

const KINDS: readonly RuleKind[] = ['poziom', 'pdh', 'pdl', 'sesja', 'funding', 'ruch', 'likwidacje'];
const SESSIONS: readonly SessionId[] = ['asia', 'london', 'ny'];

/** Reguły z pamięci urządzenia (zły zapis — pusta lista; złe pozycje pominięte, najwyżej `MAX_RULES`). */
export function parseRules(raw: string | null): Rule[] {
  if (!raw) return [];
  try {
    const x = JSON.parse(raw);
    if (!Array.isArray(x)) return [];
    return x
      .filter((r): r is Rule => !!r && typeof r === 'object' && typeof r.id === 'string' && KINDS.includes(r.kind) && typeof r.on === 'boolean')
      .map((r) => ({
        id: r.id.slice(0, 40),
        kind: r.kind,
        on: r.on,
        ...(num(r.value) && r.value > 0 ? { value: r.value } : {}),
        ...(r.session && SESSIONS.includes(r.session) ? { session: r.session } : {}),
        ...(num(r.lastAt) ? { lastAt: r.lastAt } : {}),
      }))
      .filter((r) => (r.kind === 'poziom' || r.kind === 'funding' || r.kind === 'ruch' || r.kind === 'likwidacje' ? r.value !== undefined : r.kind === 'sesja' ? r.session !== undefined : true))
      .slice(0, MAX_RULES);
  } catch {
    return [];
  }
}
