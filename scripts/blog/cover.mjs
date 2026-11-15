// Okładka wpisu (cover.svg, 1200×600) z danych samego wpisu: „krajobraz poziomów”. Linia ceny (lume), poziomy struktury
// (bursztyn, przerywane), skupiska likwidacji jako paski od prawej krawędzi proporcjonalne do kwoty (longi: kolor sprzedaży,
// shorty: kupna — strona wymuszonego zlecenia), kolumna rozkładu scenariuszy (bez kierunku: wyróżniony najbardziej
// prawdopodobny) i tarcza doby z sesjami i godziną publikacji. Bez fontów strony (SVG w <img>), tekst minimalny.

const W = 1200;
const H = 600;
const C = { page: '#0c0d0f', surface: '#131518', line: '#24282e', lineStrong: '#343a42', ink1: '#edeef0', ink2: '#a9aeb6', ink3: '#8c929a', accent: '#cfea5b', level: '#e0a045', buy: '#3280dd', sell: '#ca3829' };
// Prawa kolumna (od 1010 px) należy do tarczy doby: poziomy i paski kończą się przed nią
const PLOT = { x0: 120, x1: 1010, y0: 72, y1: 548 };
const SANS = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const x = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (v) => Math.round(v).toLocaleString('pl-PL').replace(/ /g, ' ');

/** Kwota skupiska likwidacji z notatki poziomu („8,1 mln USD, …”) w mln USD; null, gdy jej nie ma. */
export function liqUsd(note) {
  const m = /([\d\s]+(?:,\d+)?)\s*mln USD/.exec(note ?? '');
  return m ? Number(m[1].replace(/\s/g, '').replace(',', '.')) : null;
}

/** Strona skupiska: 'long' (likwidacje longów), 'short' albo null (poziom struktury). */
export function liqSide(label) {
  if (/likwidacj\w* long/i.test(label)) return 'long';
  if (/likwidacj\w* short/i.test(label)) return 'short';
  return null;
}

/** Przesunięcie strefy czasowej w minutach w chwili `ms` (lokalny − UTC). */
function tzOffsetMin(ms, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(ms)
      .map((q) => [q.type, q.value])
  );
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((local - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/** Otwarcia sesji w godzinach UTC dnia `ms`: Azja 0, Londyn 08:00 czasu londyńskiego, Nowy Jork 09:30 czasu nowojorskiego. */
export function sessionHoursUtc(ms) {
  const london = 8 - tzOffsetMin(ms, 'Europe/London') / 60;
  const ny = 9.5 - tzOffsetMin(ms, 'America/New_York') / 60;
  return { asia: 0, london, ny };
}

function arc(cx, cy, r, h0, h1) {
  const a = (h) => (h / 24) * 2 * Math.PI - Math.PI / 2;
  const p = (h) => [r1(cx + r * Math.cos(a(h))), r1(cy + r * Math.sin(a(h)))];
  const [sx, sy] = p(h0);
  const [ex, ey] = p(h1);
  return `M${sx} ${sy}A${r} ${r} 0 ${h1 - h0 > 12 ? 1 : 0} 1 ${ex} ${ey}`;
}

/** Tarcza doby: trzy łuki sesji (odcienie szarości, bez kolorów kierunku) i wskazówka godziny publikacji. */
function dial(ms, cx, cy, r) {
  const { london, ny } = sessionHoursUtc(ms);
  const d = new Date(ms);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const ang = (h / 24) * 2 * Math.PI - Math.PI / 2;
  const hx = r1(cx + (r - 2) * Math.cos(ang));
  const hy = r1(cy + (r - 2) * Math.sin(ang));
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI - Math.PI / 2;
    const r0 = i % 6 === 0 ? r + 8 : r + 4;
    return `<line x1="${r1(cx + (r + 1) * Math.cos(a))}" y1="${r1(cy + (r + 1) * Math.sin(a))}" x2="${r1(cx + r0 * Math.cos(a))}" y2="${r1(cy + r0 * Math.sin(a))}"/>`;
  }).join('');
  return `<g fill="none" stroke-linecap="round">
<g stroke="${C.lineStrong}" stroke-width="2">${ticks}</g>
<path d="${arc(cx, cy, r - 6, 0.15, london - 0.15)}" stroke="${C.lineStrong}" stroke-width="7"/>
<path d="${arc(cx, cy, r - 6, london + 0.15, ny - 0.15)}" stroke="${C.ink3}" stroke-width="7"/>
<path d="${arc(cx, cy, r - 6, ny + 0.15, 23.85)}" stroke="${C.ink2}" stroke-width="7"/>
<line x1="${cx}" y1="${cy}" x2="${hx}" y2="${hy}" stroke="${C.accent}" stroke-width="3"/>
<circle cx="${cx}" cy="${cy}" r="5" fill="${C.accent}" stroke="none"/>
</g>`;
}

/** Scenariusze od najwyższej ceny: „powyżej” na górze, „poniżej” na dole, reszta w środku. */
function orderScenarios(list) {
  const rank = (s) => (/powyżej|above/i.test(s.label) ? 0 : /poniżej|below/i.test(s.label) ? 2 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

function spine(scenarios) {
  const list = orderScenarios(scenarios.filter((s) => Number.isFinite(s.probability) && s.probability > 0));
  if (!list.length) return '';
  const total = list.reduce((a, s) => a + s.probability, 0);
  const top = Math.max(...list.map((s) => s.probability));
  const x0 = 44;
  const h = PLOT.y1 - PLOT.y0;
  let y = PLOT.y0;
  const out = [];
  for (const s of list) {
    const sh = (s.probability / total) * h;
    const best = s.probability === top;
    out.push(`<rect x="${x0}" y="${r1(y + 2)}" width="14" height="${r1(Math.max(2, sh - 4))}" rx="7" fill="${best ? C.accent : C.lineStrong}"${best ? '' : ' fill-opacity="0.9"'}/>`);
    if (sh > 30) out.push(`<text x="${x0 + 26}" y="${r1(y + sh / 2 + 7)}" font-family="${MONO}" font-size="20" fill="${best ? C.accent : C.ink3}">${Math.round(s.probability)}%</text>`);
    y += sh;
  }
  return out.join('');
}

/** SVG okładki. `post` = { price, levels, scenarios, ms, section }. */
export function coverSvg(post) {
  const levels = (post.price ? (post.levels ?? []) : []).filter((l) => Number.isFinite(l.price) && l.price > 0);
  const prices = [...levels.map((l) => l.price), ...(post.price ? [post.price] : [])];
  const out = [];
  out.push(`<defs><radialGradient id="g" cx="0.72" cy="0.5" r="0.6"><stop offset="0" stop-color="${C.accent}" stop-opacity="0.10"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
<linearGradient id="f" x1="0" x2="1"><stop offset="0" stop-color="${C.page}" stop-opacity="1"/><stop offset="0.12" stop-color="${C.page}" stop-opacity="0"/></linearGradient></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="${C.page}"/>`);
  for (let i = 1; i < 12; i++) out.push(`<line x1="${(W / 12) * i}" y1="0" x2="${(W / 12) * i}" y2="${H}" stroke="${C.line}" stroke-width="1"/>`);
  if (prices.length) {
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const pad = Math.max((hi - lo) * 0.12, hi * 0.002);
    const y = (p) => r1(PLOT.y1 - ((p - (lo - pad)) / (hi + pad - (lo - pad))) * (PLOT.y1 - PLOT.y0));
    out.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`);
    const maxUsd = Math.max(1, ...levels.map((l) => liqUsd(l.note) ?? 0));
    // Etykieta poziomu tylko, gdy nie wchodzi na poprzednią (od góry) ani na cenę
    const labelled = [];
    const priceY = post.price ? y(post.price) : null;
    for (const l of [...levels].sort((a, b) => b.price - a.price)) {
      const ly = y(l.price);
      if (!liqSide(l.label) && labelled.every((v) => Math.abs(v - ly) >= 30) && (priceY === null || Math.abs(priceY - ly) >= 26)) labelled.push(ly);
    }
    for (const l of levels) {
      const side = liqSide(l.label);
      const ly = y(l.price);
      if (side) {
        const usd = liqUsd(l.note) ?? maxUsd * 0.25;
        const w = r1(60 + (usd / maxUsd) * 420);
        out.push(`<rect x="${r1(PLOT.x1 - w)}" y="${r1(ly - 6)}" width="${w}" height="12" rx="6" fill="${side === 'long' ? C.sell : C.buy}" fill-opacity="0.7"/>`);
      } else {
        out.push(`<line x1="${PLOT.x0}" y1="${ly}" x2="${PLOT.x1}" y2="${ly}" stroke="${C.level}" stroke-width="2" stroke-dasharray="10 8" stroke-opacity="0.75"/>`);
        if (labelled.includes(ly)) out.push(`<text x="${PLOT.x0}" y="${r1(ly - 10)}" font-family="${SANS}" font-size="20" font-weight="600" fill="${C.level}" fill-opacity="0.9">${x(l.label.length > 22 ? `${l.label.slice(0, 21)}…` : l.label)}</text>`);
      }
    }
    if (post.price) {
      const py = y(post.price);
      out.push(`<line x1="${PLOT.x0}" y1="${py}" x2="${PLOT.x1}" y2="${py}" stroke="${C.accent}" stroke-width="3"/>`);
      out.push(`<circle cx="860" cy="${py}" r="22" fill="${C.accent}" fill-opacity="0.18"/><circle cx="860" cy="${py}" r="9" fill="${C.accent}"/>`);
      const ty = py < 130 ? py + 44 : py - 18;
      const label = fmt(post.price);
      out.push(`<rect x="882" y="${r1(ty - 30)}" width="${label.length * 18 + 16}" height="40" rx="8" fill="${C.page}" fill-opacity="0.85"/>`);
      out.push(`<text x="890" y="${r1(ty)}" font-family="${MONO}" font-size="30" font-weight="600" fill="${C.accent}">${x(label)}</text>`);
    }
    out.push(`<rect width="${W}" height="${H}" fill="url(#f)"/>`);
    out.push(spine(post.scenarios ?? []));
    out.push(dial(post.ms, 1104, 104, 52));
  } else {
    // Bez poziomów i ceny (wpisy o serwisie, rozliczenia): sama duża tarcza doby na koncentrycznych pierścieniach
    for (const r of [250, 200, 150]) out.push(`<circle cx="${W / 2}" cy="${H / 2}" r="${r}" fill="none" stroke="${C.line}" stroke-width="2"/>`);
    out.push(dial(post.ms, W / 2, H / 2, 110));
  }
  out.push(`<rect x="0" y="0" width="${W}" height="4" fill="${C.accent}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${out.join('')}</svg>`;
}

/** Tekst alternatywny okładki (opis tego, co pokazuje, bez interpretacji). */
export function coverAlt(post) {
  const n = (post.levels ?? []).length;
  if (!post.price) return `Okładka: tarcza doby z godziną publikacji (${post.section})`;
  return `Okładka: cena ${fmt(post.price)} USD na tle ${n} ${n === 1 ? 'poziomu' : 'poziomów'} z wpisu i tarczy doby z godziną publikacji`;
}
