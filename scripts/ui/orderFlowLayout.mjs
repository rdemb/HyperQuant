import { fixtureInit } from './probe.mjs';

// Executed inside the built application. Count painted text lines, including the sign
// and suffix. Element widths alone missed clipped prices on the portrait tablet.
function inspectNumbers() {
  const board = document.querySelector('.dom-board');
  const inspector = document.querySelector('.dom-inspector');
  if (!board || !inspector) return { tested: 0 };
  let tested = 0;
  const broken = [];
  const selector = '.dom-measure > span:not(.dom-fill), .dom-price button, th[data-dom-snapshot] > span, ' +
    '.ml-price-totals strong > span, .ml-price-totals strong:not(:has(span))';
  for (const element of document.querySelectorAll(selector)) {
    const cell = element.closest('td, th, .ml-price-totals > div');
    const box = element.getBoundingClientRect();
    if (!cell || box.width < 2 || box.height < 2 || !/\d/.test(element.textContent)) continue;
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    if (!lines.length) continue;
    const bounds = cell.getBoundingClientRect();
    const split = lines.some(r => Math.abs(r.top - lines[0].top) > 2);
    const outside = lines.some(r => r.left < bounds.left - 1 || r.right > bounds.right + 1);
    tested++;
    if ((split || outside) && broken.length < 8) broken.push(element.textContent.trim());
  }
  const a = board.getBoundingClientRect(), b = inspector.getBoundingClientRect();
  return {
    tested, broken, sideBySide: b.left >= a.right - 1,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

export function orderFlowTestStream(fixtures, now) {
  const stream = fixtures.stream();
  const px = stream['l2Book|BTC|'].levels[0][0].px;
  const size = (200_000 / Number(px)).toFixed(5);
  const trade = (tid, time, sz) => ({ coin: 'BTC', side: 'B', time, tid, px, sz });
  // Two simultaneous fills in the 100–500k band and an earlier observation
  // to cover the 120-second window. Only this layout check uses these trades.
  stream['trades|BTC'] = [trade(1, now - 121_000, '0.01'), trade(2, now, size), trade(3, now, size)];
  return stream;
}

async function checkPriceAxis(checkColumnGroups) {
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const read = () => {
    const row = document.querySelector('.dom-grid tr.dom-selected');
    const price = row?.querySelector('.dom-price button');
    const clock = document.querySelector('[data-ml-cursor]');
    if (!price || !clock) return null;
    return { px: row.dataset.domPrice, time: clock.dataset.mlCursor, x: price.getBoundingClientRect().left };
  };
  const start = read();
  const toggle = document.querySelector('.dom-page button[aria-pressed]');
  if (!start || !toggle || toggle.getAttribute('aria-pressed') !== 'false') return false;
  const anchoredAfter = async (button, expectedState) => {
    if (!button || button.getBoundingClientRect().width === 0) return false;
    button.click();
    await paint();
    const point = read();
    return button.getAttribute('aria-pressed') === expectedState && point &&
      point.px === start.px && point.time === start.time && Math.abs(point.x - start.x) <= 1;
  };
  const group = () => document.querySelectorAll('.dom-column-controls button')[1];
  if (checkColumnGroups && !await anchoredAfter(group(), 'true')) return false;
  if (!await anchoredAfter(toggle, 'true')) return false;
  if (checkColumnGroups && !await anchoredAfter(group(), 'true')) return false;
  return anchoredAfter(toggle, 'false');
}

export async function checkOrderFlowLayout(page, base, fixtures, now) {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: fixtureInit(now, orderFlowTestStream(fixtures, now)),
  });
  try {
    await page.go(base + 'robots.txt', 200);
    await page.go(base + '#orderflow?m=BTC', 300);
    const ready = await page.waitFor('document.querySelector("[data-dom-best-bid]") && document.querySelectorAll("[data-ml-tid]").length >= 2', 10000);
    if (!ready) return { ok: false, reason: 'Expected a book snapshot and two tape entries' };
    await page.ev('document.fonts.ready.then(() => true)');
    const sizes = {};
    const frames = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))';
    for (const [width, height] of [[360, 800], [600, 900], [820, 1180], [1280, 800], [1440, 900]]) {
      await page.viewport(width, height, width < 1000);
      await page.ev(frames);
      sizes[width] = await page.ev('(' + inspectNumbers.toString() + ')()');
    }
    await page.viewport(360, 800, true);
    await page.ev(frames);
    const fixedAxis = await page.ev('(' + checkPriceAxis.toString() + ')(true)');
    await page.viewport(600, 900, true);
    await page.ev(frames);
    const tabletAxis = await page.ev('(' + checkPriceAxis.toString() + ')(false)');
    await page.ev(`document.querySelector('[data-dom-compact-band="4"]')?.click()`);
    const twoFills = await page.waitFor(`(() => {
      const rows = [...document.querySelectorAll('.ml-tape [data-ml-tid]')];
      const lowerEdge = [...document.querySelectorAll('nav')].filter(el => getComputedStyle(el).position === 'fixed')
        .map(el => el.getBoundingClientRect().top).filter(y => y > innerHeight / 2).reduce((a, b) => Math.min(a, b), innerHeight);
      return document.querySelector('[data-dom-compact-band="4"]')?.getAttribute('aria-pressed') === 'true' &&
        rows.map(row => row.dataset.mlTid).sort().join(',') === '2,3' &&
        rows.every(row => row.getBoundingClientRect().bottom <= lowerEdge + 1) && scrollY === 0;
    })()`, 5000);
    const fits = Object.values(sizes).every(s => s.tested > 10 && s.broken.length === 0 && s.pageOverflow <= 1);
    const ok = fits && !sizes[600].sideBySide && sizes[1440].sideBySide && fixedAxis && tabletAxis && !!twoFills;
    return { sizes, fixedAxis, tabletAxis, twoFills: !!twoFills, ok };
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}
