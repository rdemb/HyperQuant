import { createHash } from 'node:crypto';
import { LAB_CATALOG, LAB_VERSION, evaluateLab, type LabReport } from '../../src/utils/folkloreLab.ts';
import type { CandleArchive } from './candleArchive.ts';
import { canonicalJson } from './ledger.ts';
import { commitLedger, prepareLedgerRepo, type LedgerRepo } from './ledgerStore.ts';

const H = 3_600_000;

/** SHA-256 kanonicznego JSON katalogu laboratorium — identyfikator prerejestracji w dzienniku */
export const LAB_HASH = createHash('sha256').update(canonicalJson(LAB_CATALOG)).digest('hex');

/** Treść rekordu prerejestracji (dziennik dopisuje `k`, `t`) */
export const LAB_PREREG = { id: LAB_VERSION, catalogHash: LAB_HASH, catalog: LAB_CATALOG };

export interface LabRunnerDeps {
  coin: string;
  archive: CandleArchive;
  /** Gałąź `archive` repo danych; null = archiwum tylko lokalnie */
  repo: LedgerRepo | null;
  /** Prerejestracja katalogu w dzienniku → czas i hash linii rekordu; null = dziennik niegotowy (albo w trakcie przebiegu) */
  register: () => { at: number; hash: string; added?: boolean } | null;
  publish: (r: LabReport) => void;
}

/**
 * Archiwum świec i laboratorium folkloru: co przebieg dopisuje nowe świece i finansowanie, commit gałęzi `archive`
 * zaraz po zasiewie i potem najwyżej co godzinę; ocena laboratorium co godzinę (i od razu po pierwszej rejestracji).
 */
export class LabRunner {
  private readonly d: LabRunnerDeps;
  private prepared = false;
  private running = false;
  private uncommitted = 0;
  private lastCommitAt = Number.NEGATIVE_INFINITY;
  private lastLabAt = Number.NEGATIVE_INFINITY;
  private registration: { at: number; hash: string } | null = null;

  constructor(d: LabRunnerDeps) {
    this.d = d;
  }

  async tick(now: number): Promise<{ added: number; committed: boolean; evaluated: boolean; error?: string }> {
    const none = { added: 0, committed: false, evaluated: false };
    if (this.running) return none;
    this.running = true;
    try {
      const { repo } = this.d;
      // Bez klonu gałęzi nie zapisujemy archiwum (katalog roboczy to klon — inaczej klonowanie później by się nie udało)
      if (repo && !this.prepared) {
        this.prepared = await prepareLedgerRepo(repo, now);
        if (!this.prepared) return { ...none, error: 'repo archiwum niedostępne albo klon w tyle za origin' };
      }
      const added = await this.d.archive.tick(now);
      this.uncommitted += added;
      let committed = false;
      let error: string | undefined;
      if (repo && this.uncommitted > 0 && now - this.lastCommitAt >= H) {
        const c = await commitLedger(repo, `archiwum: ${new Date(now).toISOString()}`, now);
        if (c.ok) {
          this.uncommitted = 0;
          this.lastCommitAt = now;
          committed = c.pushed;
        }
        if (!c.ok || !c.pushed) error = c.error ?? 'commit/push archiwum nieudany';
      }
      // Bez znanej rejestracji nie publikujemy — raport „niezarejestrowany” skasowałby wyniki do przodu po restarcie
      const reg = this.d.register();
      const newlyRegistered = reg !== null && reg.hash !== this.registration?.hash;
      if (reg) this.registration = { at: reg.at, hash: reg.hash };
      let evaluated = false;
      if (this.registration && (newlyRegistered || now - this.lastLabAt >= H)) {
        const { archive } = this.d;
        const report = evaluateLab(
          {
            hourly: archive.read('1h'),
            daily: archive.read('1d'),
            funding: archive.readFunding().map((f) => ({ t: f.t, rate: f.rate })),
          },
          { coin: this.d.coin, asOf: now, registeredAt: this.registration.at, registrationHash: this.registration.hash, catalogHash: LAB_HASH }
        );
        this.d.publish(report);
        this.lastLabAt = now;
        evaluated = true;
      }
      return { added, committed, evaluated, ...(error ? { error } : {}) };
    } finally {
      this.running = false;
    }
  }
}
