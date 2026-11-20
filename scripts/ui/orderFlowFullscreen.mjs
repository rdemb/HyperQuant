// Wywoływane w przeglądarce. Zapis użytkownika obejmuje chwilę, cenę, klasę i widoczne wykonania.
function readSelection() {
  const selected = document.querySelector('[data-dom-compact-band][aria-pressed="true"]');
  return JSON.stringify({
    price: document.querySelector('.dom-selected')?.dataset.domPrice,
    time: document.querySelector('[data-ml-cursor]')?.dataset.mlCursor,
    band: selected?.dataset.domCompactBand,
    fills: [...document.querySelectorAll('.ml-tape [data-ml-tid]')].map(row => row.dataset.mlTid),
  });
}

// Sprawdzamy, co jest faktycznie na wierzchu. W natywnym trybie paski strony nadal mają wymiary pod panelem.
function fillsViewport() {
  const desk = document.querySelector('[data-order-flow][data-of-maximized]');
  if (!desk) return false;
  const rect = desk.getBoundingClientRect();
  const rightEdge = Math.min(innerWidth, document.documentElement.getBoundingClientRect().right);
  return rect.top <= 1 && rect.left <= 1 && rect.bottom >= innerHeight - 1 && rect.right >= rightEdge - 1 &&
    [2, innerHeight - 3].every(y => desk.contains(document.elementFromPoint(innerWidth / 2, y)));
}

async function tapToggle(page) {
  const point = await page.ev(`(() => {
    const button = document.querySelector('[data-of-fullscreen-toggle]');
    if (!button) return null;
    const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    return button.contains(document.elementFromPoint(x, y)) ? [x, y] : null;
  })()`);
  if (!point) return false;
  await page.tap(...point);
  return true;
}

export async function checkOrderFlowFullscreen(page) {
  await page.viewport(960, 600, true);
  await page.ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  const selection = '(' + readSelection.toString() + ')()';
  const expanded = '(' + fillsViewport.toString() + ')()';
  const normal = '!document.fullscreenElement && !!document.querySelector("[data-order-flow]:not([data-of-maximized])")';
  const before = await page.ev(selection);
  if (!await tapToggle(page) || !await page.waitFor(expanded, 3500)) return { ok: false, reason: 'enter' };
  await page.waitFor('document.fullscreenElement === document.querySelector("[data-order-flow]")', 1000);
  const initialMode = await page.ev('document.querySelector("[data-order-flow]").dataset.ofMaximized');
  const pinned = await page.ev(selection) === before;
  await page.ev('document.querySelector("[data-order-flow]").scrollTop = 400');
  if (!await tapToggle(page) || !await page.waitFor(normal, 3500)) return { ok: false, reason: 'exit after scrolling' };
  const restored = await page.ev(selection) === before;

  // Niektóre osadzone przeglądarki przyjmują żądanie, ale nie rozstrzygają obietnicy.
  // Ograniczamy atrapę do jednej sekcji w tej stronie z danymi kontrolnymi.
  await page.ev(`Object.defineProperty(document.querySelector('[data-order-flow]'), 'requestFullscreen', {
    configurable: true, value: () => new Promise(() => {}),
  })`);
  try {
    await page.key('f');
    const fallback = !!await page.waitFor(expanded + ' && !document.fullscreenElement', 3500);
    await page.ev('document.querySelector(".ml-range input")?.focus({preventScroll:true})');
    await page.key('Escape');
    const escaped = !!await page.waitFor(normal, 3500);
    const retained = await page.ev(selection) === before;
    return { ok: pinned && restored && fallback && escaped && retained, initialMode, pinned, restored, fallback, escaped, retained };
  } finally {
    await page.ev('delete document.querySelector("[data-order-flow]").requestFullscreen');
  }
}
