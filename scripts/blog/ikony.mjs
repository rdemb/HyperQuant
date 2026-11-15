/**
 * Ikony nawigacji stron statycznych jako SVG w HTML: dane tych samych ikon lucide co w aplikacji (dolny pasek, menu
 * „Więcej”; „History” aplikacji to w lucide alias `rotate-ccw-clock`), więc pasek na blogu i stronach serwisu wygląda jak w desku. Czytane przy budowie, bez skryptu na stronie.
 */
const NAMES = ['sunrise', 'chart-candlestick', 'sunset', 'table-2', 'ellipsis', 'graduation-cap', 'flask-conical', 'database', 'bot', 'newspaper', 'list-checks', 'rotate-ccw-clock'];

const attr = (k, v) => `${k}="${String(v).replace(/"/g, '&quot;')}"`;

async function load(name) {
  const { __iconData } = await import(`lucide-react/dist/esm/icons/${name}.mjs`);
  const body = __iconData.node.map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => attr(k, v)).join(' ')}/>`).join('');
  return `<svg class="ikona" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Nazwa ikony lucide → znacznik SVG. */
export const IKONY = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await load(n)])));
