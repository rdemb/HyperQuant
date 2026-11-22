import { useId, useMemo, useState } from 'react';
import { tr } from '../../i18n';
import { fmtFixed } from '../../ui/format';
import { reconcileVenueBasket } from '../../utils/venueMinute';
import { chronoTime } from './Chronograph';
import { VENUE_BASKET_SAMPLE as S } from './venueBasketSample';
import './tradeOrderQuestion.css';

/**
 * „Która giełda zmieniła znak koszyka?” (pakiet 6; frontend Designera, rozliczenie `reconcileVenueBasket` Kodera,
 * definicje i próbka publiczna Astry). Delta minuty = 2·kupno biorcy − wolumen, w BTC. Suma istnieje tylko dla pełnego
 * koszyka z deklarowanej wersji; brak giełdy blokuje sumę, ale wkład dostępnej giełdy zostaje czytelny.
 */
type Venue = 'hyperliquid' | 'binance';
const VENUES: readonly Venue[] = ['hyperliquid', 'binance'];
const NAME: Record<Venue, string> = { hyperliquid: 'Hyperliquid', binance: 'Binance USD-M' };
const btc = (v: bigint | null) => v === null ? '—'
  : `${v > 0n ? '+' : v < 0n ? '−' : ''}${fmtFixed(Number(v < 0n ? -v : v) / 10 ** S.scale, S.scale)} BTC`;
const qty = (v: bigint) => `${fmtFixed(Number(v) / 10 ** S.scale, S.scale)} BTC`;
const signText = (v: bigint) => v > 0n ? tr('przewaga kupna biorców', 'taker buying dominates')
  : v < 0n ? tr('przewaga sprzedaży biorców', 'taker selling dominates') : tr('zero: równowaga', 'zero: balanced');
const sgn = (v: bigint) => (v > 0n ? 1 : v < 0n ? -1 : 0);
const REASON: Record<string, string> = {
  missing: tr('brak minuty tej giełdy', 'this venue’s minute is missing'),
  duplicate: tr('dwa zapisy tej samej minuty', 'two records for the same minute'),
  'wrong-scope': tr('inny rynek, jednostka lub minuta', 'different market, unit or minute'),
  provisional: tr('minuta jeszcze niezamknięta', 'minute not final yet'),
  gap: tr('luka w minucie', 'gap within the minute'),
  'invalid-volume': tr('niepoprawny wolumen', 'invalid volume'),
};

type Sim = 'none' | 'drop-binance';

export default function VenueBasket({ cursorMs, onCursorChange }: { cursorMs?: number; onCursorChange?: (value: number) => void } = {}) {
  const heading = useId();
  const minuteName = useId();
  const simulationName = useId();
  const [localMinute, setMinute] = useState<number>(S.minutes[S.minutes.length - 1].from);
  const [sim, setSim] = useState<Sim>('none');
  const row = S.minutes.find(m => m.from === (cursorMs ?? localMinute)) ?? S.minutes[S.minutes.length - 1];
  const res = useMemo(() => {
    const shared = { market: S.scope, unit: S.unit, scale: S.scale, from: row.from, to: row.from + 60_000, final: true, complete: true };
    const samples = VENUES.filter(v => !(sim === 'drop-binance' && v === 'binance'))
      .map(v => ({ ...shared, venue: v, volume: BigInt(row[v].volume), buy: BigInt(row[v].buy) }));
    return reconcileVenueBasket({ revision: S.revision, venues: VENUES, market: S.scope, unit: S.unit, scale: S.scale, from: row.from, samples });
  }, [row, sim]);
  const flips = res.kind === 'complete' && res.total !== null
    ? res.without.filter(w => sgn(w.total) !== sgn(res.total!)).map(w => NAME[w.venue as Venue]) : [];
  const label = `20.11.2026 · ${chronoTime(row.from).slice(0, 5)}–${chronoTime(row.from + 60_000).slice(0, 5)} UTC`;

  return <section className="oc-archive oc-basket" aria-labelledby={heading}>
    <h3 id={heading}>{tr('Która giełda zmieniła znak koszyka?', 'Which venue changed the basket sign?')}</h3>
    <p className="oc-order-source">{tr('Przykład publiczny', 'Public example')} · <span className="oc-sim-tag">{tr('NAGRANIE', 'RECORDING')}</span> {label} ·{' '}
      {tr('koszyk', 'basket')} {S.revision}: Hyperliquid BTC + Binance USD-M BTCUSDT · {tr('minuty zamknięte', 'closed minutes')}</p>
    <div role="radiogroup" aria-label={tr('Minuta', 'Minute')} className="oc-archive-q">
      {S.minutes.map(m => <label key={m.from}><input type="radio" name={minuteName} checked={m.from === row.from} onChange={() => (onCursorChange ?? setMinute)(m.from)} />
        {chronoTime(m.from).slice(0, 5)} UTC</label>)}
    </div>
    <fieldset className="oc-archive-sim"><legend>{tr('Symulacja (SIM) do odbioru odmowy', 'Simulation (SIM) for the refusal check')}</legend>
      {(['none', 'drop-binance'] as Sim[]).map(s => <label key={s}><input type="radio" name={simulationName} checked={sim === s} onChange={() => setSim(s)} />
        {s === 'none' ? tr('Bez symulacji', 'No simulation') : tr('SIM · brak minuty Binance', 'SIM · Binance minute missing')}</label>)}
    </fieldset>
    <table className="oc-archive-tape oc-basket-table">
      <caption>{tr('Delta minuty = 2 × kupno biorcy − wolumen', 'Minute delta = 2 × taker buy − volume')}</caption>
      <thead><tr><th scope="col">{tr('Giełda', 'Venue')}</th><th scope="col">{tr('Wolumen', 'Volume')}</th><th scope="col">{tr('Kupno biorcy', 'Taker buy')}</th><th scope="col">{tr('Delta', 'Delta')}</th></tr></thead>
      <tbody>{res.byVenue.map(v => {
        const raw = row[v.venue as Venue];
        return <tr key={v.venue}><th scope="row">{NAME[v.venue as Venue]}</th>
          {v.kind === 'observed' ? <>
            <td>{qty(BigInt(raw.volume))}</td><td>{qty(BigInt(raw.buy))}</td><td>{btc(v.delta)}</td>
          </> : <td colSpan={3}>— ({REASON[v.reason] ?? v.reason}{sim === 'drop-binance' ? ', SIM' : ''})</td>}
        </tr>;
      })}</tbody>
    </table>
    <div className="oc-archive-obs" aria-live="polite">
      {res.kind === 'complete' && res.total !== null ? <>
        <p><strong>{tr('Pełny koszyk', 'Full basket')}: {btc(res.total)}</strong> · {signText(res.total)}</p>
        <ul className="oc-order-reasons">{res.without.map(w => <li key={w.venue}>
          {tr('Bez', 'Without')} {NAME[w.venue as Venue]}: {btc(w.total)} · {sgn(w.total) !== sgn(res.total!) ? tr('znak się zmienia', 'the sign changes') : tr('znak bez zmiany', 'the sign stays')}
        </li>)}</ul>
        <p>{flips.length ? tr(`Znak pełnego koszyka zależy od: ${flips.join(', ')}.`, `The full basket’s sign depends on: ${flips.join(', ')}.`)
          : tr('Pominięcie żadnej giełdy nie zmienia znaku.', 'Omitting any single venue does not change the sign.')}</p>
      </> : <p>{tr('Suma pełnego koszyka niedostępna: brakuje wymaganej giełdy. Wkład dostępnej giełdy jest w tabeli; niczego nie podstawiono.',
        'Full basket total unavailable: a required venue is missing. The available venue’s contribution is in the table; nothing was substituted.')}</p>}
      <p className="oc-order-note">{tr('Hyperliquid podaje pojedyncze wykonania, Binance zagregowane wiersze minutowe, więc liczby zdarzeń to różne miary. Porównujemy tylko wolumen w BTC i stronę biorcy. Delta opisuje przewagę strony biorców w tej minucie; nie mówi, kto handlował ani dokąd pójdzie cena.',
        'Hyperliquid reports single fills, Binance aggregated minute rows, so event counts are different measures. Only BTC volume and taker side are compared. The delta describes which taker side dominated this minute; it does not say who traded or where the price will go.')}</p>
      <p className="oc-order-source">{tr('Źródła', 'Sources')}:{' '}
        {(Object.entries(S.sources) as [string, { url: string; sha256: string }][]).map(([k, s], i) => <span key={k}>{i ? ' · ' : ''}
          <a href={s.url} target="_blank" rel="noreferrer">{k}</a> sha256 {s.sha256.slice(0, 10)}…</span>)}
        {' · '}{tr('czas odbioru nieznany', 'receipt time unknown')}</p>
    </div>
  </section>;
}
