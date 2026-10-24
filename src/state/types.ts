/** Widoki aplikacji (hash w URL: #desk, #plan, …) */
export type ViewId = 'desk' | 'charts' | 'plan' | 'market' | 'lab' | 'micro' | 'lessons' | 'sources';

/** Szkic planu przekazywany do Analizatora planu (z dowolnego panelu lub ręcznie). */
export interface PlanDraft {
  direction: 'LONG' | 'SHORT';
  entry?: number;
  stop?: number;
  target?: number;
  /** Skąd przyszedł szkic (np. „OFI Tape”, „Liquidity Lab”) i krótka notatka */
  source?: string;
  note?: string;
}
