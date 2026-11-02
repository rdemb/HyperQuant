import { runningPlans, type TwapPlan } from '../core/twapPlans';
import { postInfo } from '../../../utils/marketDataFeed';

/**
 * Plany TWAP kont widocznych na taśmie, pobierane z `info twapHistory` po jednym zapytaniu naraz (odstęp `gapMs`),
 * żeby strona nie zasypała API przy kilkunastu kontach TWAP. Adres konta jest kluczem tylko w pamięci strony.
 */

export interface PlanEntry {
  /** Chwila ostatniej odpowiedzi (0 = jeszcze żadnej). */
  at: number;
  /** Plany w toku z ostatniej odpowiedzi; null = błąd albo brak odpowiedzi. */
  plans: TwapPlan[] | null;
  pending: boolean;
}

export class TwapPlanCache {
  private readonly entries = new Map<string, PlanEntry>();
  private readonly queue: string[] = [];
  private busy = false;

  constructor(
    private readonly coin: string,
    private readonly fetcher: (user: string) => Promise<unknown>,
    private readonly now: () => number,
    private readonly gapMs = 2000
  ) {}

  get(user: string): PlanEntry | undefined {
    return this.entries.get(user);
  }

  /** Zamawia plan konta, chyba że jest w kolejce albo odpowiedź jest młodsza niż `maxAgeMs`. Pseudonimy z zapisu serwera (~) nie mają adresu. */
  want(user: string, maxAgeMs: number): void {
    if (!user || user.startsWith('~')) return;
    const e = this.entries.get(user);
    if (e?.pending || (e && e.at > 0 && this.now() - e.at < maxAgeMs)) return;
    this.entries.set(user, { at: e?.at ?? 0, plans: e?.plans ?? null, pending: true });
    this.queue.push(user);
    this.pump();
  }

  private pump(): void {
    if (this.busy) return;
    const user = this.queue.shift();
    if (user === undefined) return;
    this.busy = true;
    void this.fetcher(user)
      .catch(() => null)
      .then((raw) => {
        const t = this.now();
        this.entries.set(user, { at: t, plans: runningPlans(raw, this.coin, t), pending: false });
        setTimeout(() => {
          this.busy = false;
          this.pump();
        }, this.gapMs);
      });
  }
}

const caches = new Map<string, TwapPlanCache>();

/** Wspólny magazyn planów dla rynku (jeden na stronę). */
export function twapPlansFor(coin: string, now: () => number): TwapPlanCache {
  let c = caches.get(coin);
  if (!c) {
    c = new TwapPlanCache(coin, (user) => postInfo({ type: 'twapHistory', user }), now);
    caches.set(coin, c);
  }
  return c;
}
