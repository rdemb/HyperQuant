import React from 'react';
import type { WallStreetCellModel } from '../../utils/wallStreet';

/**
 * Etykieta „Wall Street” w wierszu: „otwarta” / „zamknięta” z dopiskiem albo „—” z powodem w podpowiedzi. Bez kolorów
 * (stan giełdy bazowej, nie ocena rynku). Tylko prezentacja: model komórki z `utils/wallStreet.wallStreetCell`.
 */
export const WallStreetLabel: React.FC<{ cell: WallStreetCellModel }> = ({ cell }) =>
  cell.why === null ? (
    <span data-wall-street={cell.label}>
      {cell.label}
      {cell.note && <span className="block text-[10.5px] text-ink-3">{cell.note}</span>}
    </span>
  ) : (
    <span data-wall-street="" title={cell.why} className="text-ink-3">
      {cell.label}
    </span>
  );
