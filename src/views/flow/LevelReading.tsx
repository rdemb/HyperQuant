import type { BookFrame } from '../../charts/pro/core/book';
import { readBookLevel } from '../../charts/pro/core/book';
import { tr } from '../../i18n';
import { fmtFixed } from '../../ui/format';
import { chronoTime } from './Chronograph';

/**
 * F3: odczyt jednego poziomu w rzeczywistej migawce arkusza (`readBookLevel` Kodera).
 * Trzy różne wyniki: zaobserwowana ilość, zmierzone zero (tylko przy kompletnej stronie) i brak odczytu z powodem.
 * Brak wiersza nigdy nie jest pokazywany jako zero bez potwierdzenia kompletności.
 */
const REASON: Record<'side' | 'invalid' | 'outside-range' | 'incomplete', string> = {
  side: tr('brak tej strony arkusza w migawce', 'this book side is missing from the snapshot'),
  invalid: tr('niepoprawne dane tej strony w migawce', 'invalid data on this side of the snapshot'),
  'outside-range': tr('cena poza zasięgiem migawki: nie wiadomo, co tam stoi', 'price outside the snapshot range: unknown what rests there'),
  incomplete: tr('strona niekompletna: brak wiersza nie oznacza zera', 'side incomplete: a missing row does not mean zero'),
};

export function LevelReading({ frame, side, price, unit, sizeDecimals, fresh, recorded = false, fmtPx }: {
  frame: BookFrame | null; side: 'bid' | 'ask'; price: number; unit: string; sizeDecimals: number; fresh?: boolean; recorded?: boolean;
  fmtPx: (px: number) => string;
}) {
  const label = <><span className="oc-sim-tag">{recorded ? tr('NAGRANIE', 'RECORDING') : fresh ? 'LIVE' : tr('LIVE · STARE', 'LIVE · STALE')}</span>{' '}</>;
  if (!frame) return <p className="of-level-reading" data-of-level-reading="no-frame">
    {tr('Odczyt poziomu', 'Level reading')}: — ({tr('brak dokładnej migawki arkusza', 'no exact book snapshot')})</p>;
  const r = readBookLevel(frame, side, price);
  const value = r.kind === 'observed' ? `${fmtFixed(r.size, sizeDecimals)} ${unit}`
    : r.kind === 'empty' ? `0 ${unit} · ${tr('zmierzone zero (strona kompletna)', 'measured zero (side complete)')}`
      : `— · ${REASON[r.reason]}`;
  return <p className="of-level-reading" data-of-level-reading={r.kind === 'missing' ? r.reason : r.kind}>
    {label}{tr('Odczyt poziomu w przypiętej migawce', 'Level reading in the pinned snapshot')} {chronoTime(frame.t)} UTC · {side.toUpperCase()} {fmtPx(price)}: <strong>{value}</strong>
  </p>;
}
