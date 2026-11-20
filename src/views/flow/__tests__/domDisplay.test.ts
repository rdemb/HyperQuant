import { expect, it } from 'vitest';
import { compactDomUsd } from '../domDisplay';

it('preserves the sign, distinguishes zero, and keeps signed depth compact', () => {
  expect(compactDomUsd(385_150_000_000n, true)).toBe('+385k');
  expect(compactDomUsd(-999_550_000n, true)).toBe('−1k');
  expect(compactDomUsd(0n, true)).toBe('0');
  expect(compactDomUsd(-1n, true)).toBe('−1µ');
});
