import { describe, expect, it } from 'vitest';
import { historyBaseOf } from '../tapeHistory';

describe('historyBaseOf: adres gałęzi history repo danych', () => {
  it('…/hyperquant-data/main → …/hyperquant-data/history; adres bez „/main” (podgląd lokalny) bez zmian', () => {
    expect(historyBaseOf('https://raw.githubusercontent.com/rdemb/hyperquant-data/main')).toBe('https://raw.githubusercontent.com/rdemb/hyperquant-data/history');
    expect(historyBaseOf('http://localhost:8080/data')).toBe('http://localhost:8080/data');
    expect(historyBaseOf('')).toBe('');
  });
});
