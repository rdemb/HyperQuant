import { describe, expect, it } from 'vitest';
import * as layoutNumbers from '../../charts/pro/chart/layoutNumbers';
import { rvolOf } from '../rvolOf';

describe('rvolOf poza modułami wykresu', () => {
  it('import ze starego miejsca (nagłówek układu) daje tę samą funkcję', () => {
    expect(layoutNumbers.rvolOf).toBe(rvolOf);
  });
});
