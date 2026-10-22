import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildLiqMap } from '../../src/utils/liqMap.ts';
import type { AddressBook } from './addressBook.ts';
import type { R2Config } from './config.ts';
import type { HlCtx, HlRest } from './hl.ts';
import { parseCoinPosition } from './positions.ts';
import { putObject } from './r2.ts';

/** Zapis atomowy: plik tymczasowy + rename (czytelnik nigdy nie widzi połowy JSON-a). */
function writeAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

/** Kontekst rynku (mark, OI) starszy niż to blokuje publikację. */
const CTX_MAX_AGE_MS = 5 * 60_000;

export interface ScannerDeps {
  coin: string;
  book: AddressBook;
  rest: HlRest;
  outDir: string;
  r2: R2Config | null;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/**
 * Cykl skanera: odpytanie pozycji adresów, których termin minął, i publikacja agregatów (mapa likwidacji + status).
 * Publikowane pliki nie zawierają adresów.
 */
export class Scanner {
  private readonly d: ScannerDeps;
  private ctx: HlCtx | null = null;
  private ctxAt = 0;
  private scanTimes: number[] = [];
  lastPublishOk: number | null = null;

  constructor(d: ScannerDeps) {
    this.d = d;
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  setCtx(c: HlCtx): void {
    this.ctx = c;
    this.ctxAt = this.now();
  }

  /** Odpytuje do `limit` adresów z minionym terminem; zwraca liczbę udanych odczytów. */
  async scanDue(limit: number): Promise<number> {
    const due = this.d.book.due(this.now(), limit);
    let ok = 0;
    for (const addr of due) {
      const st = await this.d.rest.info({ type: 'clearinghouseState', user: addr }, 2);
      if (st === null) {
        this.d.book.markFailed(addr, this.now());
        continue;
      }
      const t = this.now();
      this.d.book.updatePosition(addr, parseCoinPosition(st, this.d.coin, t), t);
      this.scanTimes.push(t);
      ok++;
    }
    const cutoff = this.now() - 60_000;
    this.scanTimes = this.scanTimes.filter((t) => t >= cutoff);
    return ok;
  }

  /**
   * Buduje i zapisuje mapę oraz status (lokalnie i — gdy skonfigurowane — w R2).
   * Bez ceny mark i OI albo z kontekstem starszym niż 5 min: nic (stara cena nie może udawać aktualnej).
   */
  async publish(): Promise<boolean> {
    const c = this.ctx;
    const asOf = this.now();
    if (!c || !(c.markPx > 0) || !(c.oiBtc >= 0) || asOf - this.ctxAt > CTX_MAX_AGE_MS) return false;
    const positions = this.d.book.positions();
    const map = buildLiqMap(positions, { coin: this.d.coin, markPx: c.markPx, oiBtc: c.oiBtc, asOf, addresses: this.d.book.size, ctxAt: this.ctxAt });
    const status = {
      v: 1,
      coin: this.d.coin,
      asOf,
      addresses: this.d.book.size,
      positions: positions.length,
      seeded: this.d.book.seededCount,
      scansLastMin: this.scanTimes.length,
      coverage: map.coverage.share,
      ageNtlP50Min: map.ageMin.ntlP50,
      ctxAt: this.ctxAt,
      dayNtlVlm: Number.isFinite(c.dayNtlVlm) ? c.dayNtlVlm : null,
      apiErrors: this.d.rest.errors,
    };
    const files: [string, string][] = [
      [`liq-map/${this.d.coin}.json`, JSON.stringify(map)],
      ['status.json', JSON.stringify(status)],
    ];
    for (const [key, body] of files) writeAtomic(join(this.d.outDir, key), body);
    let ok = true;
    if (this.d.r2) {
      for (const [key, body] of files) ok = (await putObject(this.d.r2, key, body, { fetchFn: this.d.fetchFn })) && ok;
    }
    if (ok) this.lastPublishOk = asOf;
    return ok;
  }
}
