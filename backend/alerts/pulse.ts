import { chmodSync, renameSync, writeFileSync } from 'node:fs';

/** Puls serwera powiadomień dla strażnika (scripts/watchdog.mjs); null = brak skrzynki albo brak strumienia. */
export interface AlertsPulse {
  v: 1;
  at: number;
  syncAt: number | null;
  wsAt: number | null;
}

/**
 * Zapis atomowy (plik tymczasowy + rename) z prawami 0640 mimo UMask=0077 usługi: strażnik działa jako osobny
 * użytkownik w grupie usługi i czyta tylko ten plik; reszta stanu zostaje 0600.
 */
export function writePulse(path: string, pulse: AlertsPulse): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(pulse));
  chmodSync(tmp, 0o640);
  renameSync(tmp, path);
}
