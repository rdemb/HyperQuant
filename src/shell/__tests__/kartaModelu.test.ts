import { describe, expect, it } from 'vitest';
import { GROUPS } from '../../views/sources/LineageTable';
import { MODEL_CARD_IDS } from '../../ui/modelCard';
import { LEDGER_PART, rowFor } from '../KartaModelu';

describe('karta modelu', () => {
  it('każda karta ma dokładnie jeden wiersz w tabeli pochodzenia, z typem MODEL, metodą, danymi i odświeżaniem', () => {
    for (const id of MODEL_CARD_IDS) {
      const rows = GROUPS.flatMap((g) => g.rows).filter((r) => r.card === id);
      expect(rows, id).toHaveLength(1);
      const r = rowFor(id)!;
      expect(r.kinds, id).toContain('MODEL');
      expect(r.method.length, id).toBeGreaterThan(20);
      expect(r.source.length, id).toBeGreaterThan(5);
      expect(r.refresh.length, id).toBeGreaterThan(3);
    }
  });

  it('wynik z rejestru tylko dla modeli zapisywanych przed faktem', () => {
    expect(Object.keys(LEDGER_PART).sort()).toEqual(['ledger', 'mc2h', 'modelVsMarket', 'vol']);
  });
});
