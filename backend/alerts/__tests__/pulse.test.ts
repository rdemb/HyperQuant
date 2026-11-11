import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writePulse } from '../pulse.ts';

describe('puls serwera powiadomień dla strażnika', () => {
  it('zapis atomowy: pełny JSON, bez pliku tymczasowego', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hq-pulse-')), 'alerts-pulse.json');
    writePulse(file, { v: 1, at: 1000, syncAt: null, wsAt: 900 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ v: 1, at: 1000, syncAt: null, wsAt: 900 });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  // Prawa plików nie mają znaczenia na Windows (chmod zmienia tam tylko „tylko do odczytu”)
  it.skipIf(process.platform === 'win32')('plik 0640 mimo UMask=0077 usługi: strażnik w grupie usługi go czyta', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hq-pulse-')), 'alerts-pulse.json');
    writePulse(file, { v: 1, at: 1, syncAt: 1, wsAt: null });
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });
});
