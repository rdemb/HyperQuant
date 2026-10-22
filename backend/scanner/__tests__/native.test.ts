import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Strażnik zgodności z uruchamianiem TypeScriptu bez kompilacji (Node ≥ 24, tak jak na serwerze):
 * import bez rozszerzenia `.ts` albo składnia nieusuwalna (enum, parameter properties) we wspólnym kodzie przeszłaby
 * tsc, testy i build, a wywróciła skaner przy starcie.
 */
const MODULES = ['scanner.ts', 'addressBook.ts', 'hl.ts', 'config.ts', 'rateLimiter.ts', 'seed.ts', 'r2.ts', 'sigv4.ts', 'positions.ts', 'gitPublish.ts', 'liqDetect.ts', 'cohortEngine.ts', 'ots.ts', 'ledger.ts', 'ledgerStore.ts', 'forecaster.ts', 'ledgerRunner.ts'];

describe('backend uruchamiany natywnie przez Node', () => {
  it('wszystkie moduły skanera (z kodem współdzielonym) ładują się bez kompilacji', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    const urls = MODULES.map((m) => pathToFileURL(`${dir}${m}`).href);
    const code = `for (const u of ${JSON.stringify(urls)}) await import(u); console.log('ok');`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    expect(r.stderr.replace(/.*ExperimentalWarning.*\n?|.*--trace-warnings.*\n?/g, '')).toBe('');
    expect(r.stdout.trim()).toBe('ok');
  });
});
