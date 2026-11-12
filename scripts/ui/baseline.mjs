// Punkt odniesienia pomiaru układu (scripts/ui/baseline.json): liczby z raportu `layout-check.mjs` na danych stałych
// i porównanie z zapisanymi. Zapis jest osobny dla każdego systemu (krój zastępczy i wygładzanie tekstu różnią się
// między Windows i Linux, więc liczby podpisów i szerokości osi też).

const VIEWS = { desktop: 'live1440', desktopDom: 'live1440dom', phone: 'live390', replayDesktop: 'replay1440', replayPhone: 'replay390' };

/** Płaskie liczby raportu: `share.*` (udział panelu ceny), `objects.<widok>.*`, `dom.*`, `phone.indicatorRows`. */
export function metricsOf(r) {
  const m = {};
  const share = { desktop: r.desktop, desktopDom: r.desktopDom, phone: r.phone, focus: r.phoneFocus, landscape: r.phoneLandscape };
  for (const [k, v] of Object.entries(share)) if (typeof v?.share === 'number') m[`share.${k}`] = Number(v.share.toFixed(3));
  for (const [k, view] of Object.entries(VIEWS)) {
    const o = r[k]?.objects;
    if (o) for (const [f, n] of Object.entries(o)) if (typeof n === 'number') m[`objects.${view}.${f}`] = n;
  }
  if (r.domColumn) {
    if (typeof r.domColumn.ladderRows === 'number') m['dom.ladderRows'] = r.domColumn.ladderRows;
    if (typeof r.domColumn.tapeRowsFit === 'number') m['dom.tapeRowsFit'] = r.domColumn.tapeRowsFit;
  }
  if (typeof r.phoneIndicators === 'number') m['phone.indicatorRows'] = r.phoneIndicators;
  // Prostokąty wskaźnika Effort (wybór warstwy, nie piksele) w powtórce 24.10, BTC 5m
  if (typeof r.effort?.desktop === 'number') m['effort.rects1440'] = r.effort.desktop;
  if (typeof r.effort?.phone === 'number') m['effort.rects390'] = r.effort.phone;
  // Ściany i serie (wybór warstwy) w Kokpicie 1m na powtórce 24.10
  if (typeof r.clashes?.desktop === 'number') m['clashes.objects1440'] = r.clashes.desktop;
  // Zakres początkowy sesji (wybór warstwy) na danych stałych: „Aukcja i otwarcie” 5m i „Rozliczenie doby” 30m
  for (const [view, v] of [['auction', r.ib?.auction], ['review', r.ib?.review]]) {
    if (typeof v?.desktop === 'number') m[`ib.${view}1440`] = v.desktop;
    if (typeof v?.phone === 'number') m[`ib.${view}390`] = v.phone;
  }
  // Strefy nierównowagi i niedokończone aukcje (wybór warstwy) w układzie „Aukcja i otwarcie”, powtórka 24.10, 5m
  for (const [k, v] of [['1440', r.zones?.desktop], ['390', r.zones?.phone]]) {
    if (typeof v?.rects === 'number') m[`zones.rects${k}`] = v.rects;
    if (typeof v?.lines === 'number') m[`zones.lines${k}`] = v.lines;
  }
  return m;
}

const pl = (x, d) => x.toFixed(d).replace('.', ',');

/** Zapas nad progiem w punktach procentowych (np. „+0,6 pp”). */
export const margin = (share, limit) => {
  const d = (share - limit) * 100;
  return `${d >= 0 ? '+' : '−'}${pl(Math.abs(d), 1)} pp`;
};

/** Spadek udziału panelu ceny dopuszczalny bez zgłoszenia (0,5 pp); liczby: 15% i co najmniej 2. */
const SHARE_DROP = 0.005;
const COUNT_REL = 0.15;
const COUNT_ABS = 2;

/** Różnice wobec odniesienia `base` (tylko liczby, które w nim są); pusta lista — zgodne. */
export function compareBaseline(m, base) {
  const out = [];
  for (const [k, b] of Object.entries(base)) {
    const v = m[k];
    if (typeof v !== 'number' || typeof b !== 'number') continue;
    if (k.startsWith('share.')) {
      if (v < b - SHARE_DROP) out.push(`${k}: ${pl(v * 100, 1)}% (odniesienie ${pl(b * 100, 1)}%)`);
    } else if (Math.abs(v - b) > Math.max(COUNT_ABS, COUNT_REL * b)) out.push(`${k}: ${v} (odniesienie ${b})`);
  }
  return out;
}
