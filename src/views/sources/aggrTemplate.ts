/** Zwięzłe podsumowanie workspace'u Aggr (`public/data/aggr_template.json`) do widoku „Źródła”. */
export interface AggrTemplateSummary {
  name: string;
  version: number | null;
  /** Liczba paneli wg typu (chart / trades / stats …) */
  panes: { total: number; byType: Record<string, number> };
  indicators: number;
  markets: number;
  exchanges: number;
  /** Progi taśm (nazwa panelu → kwoty USD) */
  tapes: { name: string; amounts: number[] }[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Zwraca null, gdy plik nie wygląda na workspace Aggr (brak `states.panes.panes`). */
export function summarizeAggrTemplate(raw: unknown): AggrTemplateSummary | null {
  if (!isRec(raw) || !isRec(raw.states)) return null;
  const states = raw.states;
  const panesState = states.panes;
  if (!isRec(panesState) || !isRec(panesState.panes)) return null;

  const byType: Record<string, number> = {};
  const markets = new Set<string>();
  let indicators = 0;
  const tapes: { name: string; amounts: number[] }[] = [];

  for (const [id, pane] of Object.entries(panesState.panes)) {
    if (!isRec(pane)) continue;
    const type = typeof pane.type === 'string' ? pane.type : 'inne';
    byType[type] = (byType[type] ?? 0) + 1;
    if (Array.isArray(pane.markets)) for (const m of pane.markets) if (typeof m === 'string') markets.add(m);
    const st = states[id];
    if (!isRec(st)) continue;
    if (isRec(st.indicators)) indicators += Object.keys(st.indicators).length;
    if (type === 'trades' && Array.isArray(st.thresholds)) {
      const amounts = st.thresholds.map((t) => (isRec(t) && typeof t.amount === 'number' ? t.amount : NaN)).filter(Number.isFinite);
      const name = typeof pane.name === 'string' && pane.name ? pane.name : id;
      tapes.push({ name, amounts });
    }
  }

  const exchanges = new Set([...markets].map((m) => m.split(':')[0]));
  return {
    name: typeof raw.name === 'string' ? raw.name : '—',
    version: typeof raw.version === 'number' ? raw.version : null,
    panes: { total: Object.values(byType).reduce((s, n) => s + n, 0), byType },
    indicators,
    markets: markets.size,
    exchanges: exchanges.size,
    tapes,
  };
}
