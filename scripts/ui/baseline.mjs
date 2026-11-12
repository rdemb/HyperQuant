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
  // Bąble zleceń (wybór warstwy, bez serii) w Kokpicie 1m na powtórce 24.10
  if (typeof r.bubbles?.desktop === 'number') m['bubbles.count1440'] = r.bubbles.desktop;
  if (typeof r.bubbles?.phone === 'number') m['bubbles.count390'] = r.bubbles.phone;
  // Zakresy P/b (wybór warstwy) na danych stałych: Kokpit 5m ze wskaźnikiem
  for (const [w, d] of [['1440', r.pb?.desktop], ['390', r.pb?.phone]]) {
    for (const k of ['boxes', 'lines', 'marks']) if (typeof d?.[k] === 'number') m[`pb.${k}${w}`] = d[k];
  }
  // Zakres początkowy sesji (wybór warstwy) na danych stałych: „Aukcja i otwarcie” 5m i „Rozliczenie doby” 30m
  for (const [view, v] of [['auction', r.ib?.auction], ['review', r.ib?.review]]) {
    if (typeof v?.desktop === 'number') m[`ib.${view}1440`] = v.desktop;
    if (typeof v?.phone === 'number') m[`ib.${view}390`] = v.phone;
  }
  // Poziomy dnia i linie otwarć sesji (wybór warstwy) na danych stałych: „Mapa dnia” (4h) i „Rozliczenie doby” (30m)
  for (const [view, v] of Object.entries(r.levels ?? {})) {
    for (const [w, d] of [['1440', v?.desktop], ['390', v?.phone]]) {
      if (typeof d?.levels === 'number') m[`levels.${view}.lines${w}`] = d.levels;
      if (typeof d?.sessions === 'number') m[`sessions.${view}.lines${w}`] = d.sessions;
      if (typeof d?.levels4h === 'number') m[`levels.${view}.lines4h${w}`] = d.levels4h;
    }
  }
  // Profile dób (TPO i profile okresów, wybór warstwy): obiekty i pole pod słupkami (%) w „Mapie dnia” i „Rozliczeniu doby”
  for (const [view, v] of Object.entries(r.profiles ?? {})) {
    for (const [w, d] of [['1440', v?.desktop], ['390', v?.phone]]) {
      for (const layer of ['tpo', 'periods']) {
        const c = d?.[layer];
        if (typeof c?.objects === 'number') m[`${layer}.${view}.objects${w}`] = c.objects;
        if (typeof c?.area === 'number') m[`${layer}.${view}.area${w}`] = c.area;
      }
    }
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
