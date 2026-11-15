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

describe('karta modelu: co twierdzi i status sprawdzenia', () => {
  it('każda karta ma zdanie „co twierdzi” bez słów kierunku i porady oraz jeden z czterech statusów', async () => {
    const { CLAIM, STATUS } = await import('../KartaModelu');
    const { MODEL_CARD_IDS } = await import('../../ui/modelCard');
    for (const id of MODEL_CARD_IDS) {
      expect(CLAIM[id].length, id).toBeGreaterThan(30);
      expect(CLAIM[id], id).not.toMatch(/sygna|signal|kup |sprzedaj|buy |sell /i);
      expect(['zapis', 'test', 'bezMocy', 'opis'], id).toContain(STATUS[id]);
    }
  });

  it('status „zapisywany przed faktem” tylko dla modeli z rozliczeniami (rejestr desku albo dziennik kota)', async () => {
    const { STATUS, LEDGER_PART } = await import('../KartaModelu');
    const zapis = Object.entries(STATUS).filter(([, s]) => s === 'zapis').map(([id]) => id).sort();
    expect(zapis).toEqual([...Object.keys(LEDGER_PART), 'schrodi'].sort());
  });
});
