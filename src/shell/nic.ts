import { tr } from '../i18n';
import { deskMarketOf } from '../config/deskMarkets';

/**
 * Nić kontekstu w aplikacji: ostatnie miejsce pracy w tej karcie (widok fazy dnia albo Order Flow z pełnym adresem:
 * rynek, interwał, rodzaj wykresu, chwila nagrania, obserwacja Order Flow). Dziś proponuje powrót dokładnie tam.
 * Pamięć karty (sessionStorage), bez danych rynku: sam adres i chwila zapisu.
 */
export const NIC_KLUCZ = 'hq.nic.v1';
/** Starszy wpis nie jest już „miejscem, w którym skończyłeś” */
export const NIC_WAZNOSC_MS = 12 * 3_600_000;
const WIDOKI_PRACY = ['before', 'charts', 'after', 'orderflow', 'stanowisko'] as const;
type WidokPracy = (typeof WIDOKI_PRACY)[number];

export interface Nic {
  hash: string;
  at: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const store = (): Store | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const widokZ = (hash: string): WidokPracy | null => {
  const id = hash.replace(/^#/, '').split('?')[0];
  return (WIDOKI_PRACY as readonly string[]).includes(id) ? (id as WidokPracy) : null;
};

/** Zapis adresu widoku pracy (inne widoki nie nadpisują nici). */
export function zapiszNic(hash: string, at: number, s: Store | null = store()): void {
  if (!s || !widokZ(hash)) return;
  try {
    s.setItem(NIC_KLUCZ, JSON.stringify({ hash, at } satisfies Nic));
  } catch {
    // Pamięć zablokowana: bez propozycji powrotu
  }
}

export function czytajNic(now: number, s: Store | null = store()): Nic | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s.getItem(NIC_KLUCZ) ?? 'null') as Partial<Nic> | null;
    if (!v || typeof v.hash !== 'string' || typeof v.at !== 'number' || !widokZ(v.hash)) return null;
    if (now - v.at > NIC_WAZNOSC_MS || v.at - now > 60_000) return null;
    return { hash: v.hash, at: v.at };
  } catch {
    return null;
  }
}

const WIDOK_NAZWA: Record<WidokPracy, () => string> = {
  before: () => tr('Przed sesją', 'Before the session'),
  charts: () => tr('W sesji', 'In session'),
  after: () => tr('Po sesji', 'After the session'),
  orderflow: () => 'Order Flow',
  stanowisko: () => tr('Stanowisko', 'Workbench'),
};

/**
 * Opis miejsca z adresu: widok, rynek, interwał i rodzaj wykresu, nagranie z chwilą kursora (UTC z adresu) albo
 * obserwacja Order Flow. Tylko to, co jest w adresie — bez liczb rynku.
 */
export function opisNici(hash: string, fmtChwila: (ms: number) => string): { widok: string; szczegoly: string[] } | null {
  const widok = widokZ(hash);
  if (!widok) return null;
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const out: string[] = [];
  const m = q.get('m');
  if (m) out.push(deskMarketOf(m)?.label ?? m.replace(/^[a-z]+:/, ''));
  const i = q.get('i');
  if (i) out.push(i);
  const v = q.get('v');
  if (v === 'footprint') out.push('footprint');
  else if (v === 'candles') out.push(tr('świece', 'candles'));
  const replay = q.get('replay');
  const t = Date.parse(q.get('t') ?? '');
  if (replay) out.push(Number.isFinite(t) ? `${tr('nagranie', 'recording')} · ${fmtChwila(t)}` : tr('nagranie', 'recording'));
  const w = q.get('w');
  if (widok === 'orderflow' && w === 'level') out.push(tr('obserwacja poziomu', 'level observation'));
  else if (widok === 'orderflow' && w === 'archive') out.push(tr('archiwum nagrań', 'recording archive'));
  return { widok: WIDOK_NAZWA[widok](), szczegoly: out };
}
