// Kod wstrzykiwany do strony przez scripts/ui/layout-check.mjs. Funkcje działają w przeglądarce (bez importów).

/**
 * Przed skryptami strony: zapis tekstów rysowanych na płótnach i liczba kół (bąble) i prostokątów (świece, ściany, słupki)
 * każdego płótna z jego ostatniej klatki.
 */
export const INIT = `(() => {
  let frame = 0;
  const tick = () => { frame++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const texts = new Map();
  window.__hqTexts = texts;
  const entry = (c) => {
    let e = texts.get(c);
    if (!e || e.frame !== frame) { e = { frame, items: [], arcs: 0, rects: 0 }; texts.set(c, e); }
    return e;
  };
  const P = CanvasRenderingContext2D.prototype;
  const orig = P.fillText;
  P.fillText = function (text, x, y, maxWidth) {
    try {
      const s = String(text);
      if (s.trim() !== '') {
        const e = entry(this.canvas);
        const m = this.measureText(s);
        const w = m.width;
        const al = this.textAlign;
        const l = al === 'center' ? x - w / 2 : al === 'right' || al === 'end' ? x - w : x;
        const t = this.getTransform();
        const a = t.transformPoint({ x: l, y: y - m.actualBoundingBoxAscent });
        const b = t.transformPoint({ x: l + w, y: y + m.actualBoundingBoxDescent });
        e.items.push({ text: s, l: Math.min(a.x, b.x), t: Math.min(a.y, b.y), r: Math.max(a.x, b.x), b: Math.max(a.y, b.y) });
      }
    } catch {}
    return orig.call(this, text, x, y, maxWidth);
  };
  const arc = P.arc;
  P.arc = function (...a) {
    try { entry(this.canvas).arcs++; } catch {}
    return arc.apply(this, a);
  };
  const rect = P.fillRect;
  P.fillRect = function (...a) {
    try { entry(this.canvas).rects++; } catch {}
    return rect.apply(this, a);
  };
})();`;

/**
 * Tryb danych stałych (CI): zegar stoi w chwili `now`, Math.random z ziarnem, bez service workera, a WebSocket to atrapa
 * strumienia Hyperliquid — po subskrypcji odsyła raz wiadomość kanału z `stream` (arkusz, kontekst, kwotowania), innych
 * giełd nie łączy (błąd i zamknięcie, jak bez sieci). Wszystko przed skryptami strony.
 */
export function fixtureInit(now, stream) {
  return `(() => {
  const NOW = ${now};
  const STREAM = ${JSON.stringify(stream)};
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
    static now() { return NOW; }
  }
  FixedDate.UTC = RealDate.UTC;
  FixedDate.parse = RealDate.parse;
  window.Date = FixedDate;
  let seed = 20261024;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { delete Navigator.prototype.serviceWorker; } catch {}
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.binaryType = 'blob';
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      const hl = /hyperliquid\.xyz/.test(this.url);
      setTimeout(() => {
        if (!hl) {
          this.readyState = 3;
          this.fire('error', new Event('error'));
          this.fire('close', new CloseEvent('close', { code: 1006 }));
          return;
        }
        this.readyState = 1;
        this.fire('open', new Event('open'));
      }, 0);
    }
    fire(type, ev) {
      const h = this['on' + type];
      if (typeof h === 'function') h.call(this, ev);
      this.dispatchEvent(ev);
    }
    send(raw) {
      if (this.readyState !== 1) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      const s = m && m.subscription;
      if (!s || m.method !== 'subscribe') return;
      const key = s.type === 'l2Book' ? 'l2Book|' + s.coin + '|' + (s.nSigFigs ?? '') : s.type + '|' + s.coin;
      const data = STREAM[key];
      setTimeout(() => {
        if (this.readyState !== 1) return;
        this.fire('message', new MessageEvent('message', { data: JSON.stringify({ channel: 'subscriptionResponse', data: m }) }));
        if (data) this.fire('message', new MessageEvent('message', { data: JSON.stringify({ channel: s.type, data }) }));
      }, 20);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      setTimeout(() => this.fire('close', new CloseEvent('close', { code: 1000 })), 0);
    }
  }
  FakeSocket.CONNECTING = 0;
  FakeSocket.OPEN = 1;
  FakeSocket.CLOSING = 2;
  FakeSocket.CLOSED = 3;
  window.WebSocket = FakeSocket;
})();`;
}

/** Funkcje pomiaru: window.__hq.* (wstrzykiwane po wczytaniu strony). */
export const PROBE = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  /** Pierwszy widoczny wykres Lightweight Charts: komórka panelu ceny i komórka jego prawej osi. */
  function chart() {
    const root = [...document.querySelectorAll('.tv-lightweight-charts')].find((r) => vis(r));
    if (!root) return null;
    const rows = [...root.querySelectorAll('tr')].filter((tr) => tr.children.length >= 3 && vis(tr));
    const pane = rows[0];
    if (!pane) return null;
    const cells = [...pane.children];
    return { root, pane: cells[1], axis: cells[2], panes: rows.length };
  }
  /** Pasek przypięty do góry albo dołu ekranu (nagłówek, dolne menu) nad danym prostokątem. */
  function fixedBars() {
    const out = [];
    for (const el of document.querySelectorAll('header, nav, [data-fixed-bar]')) {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'sticky') && vis(el)) out.push(el.getBoundingClientRect());
    }
    return out;
  }
  /** Widoczna wysokość panelu ceny: w oknie i bez pasków przypiętych nad nim. */
  function paneShare() {
    const c = chart();
    if (!c) return null;
    const r = c.pane.getBoundingClientRect();
    let top = Math.max(0, r.top);
    let bottom = Math.min(innerHeight, r.bottom);
    for (const b of fixedBars()) {
      if (b.bottom <= r.top || b.top >= r.bottom || b.width < innerWidth * 0.5) continue;
      if (b.top <= top + 1 && b.bottom > top) top = Math.max(top, b.bottom);
      else if (b.bottom >= bottom - 1 && b.top < bottom) bottom = Math.min(bottom, b.top);
    }
    const h = Math.max(0, bottom - top);
    return { paneH: Math.round(r.height), visibleH: Math.round(h), share: +(h / innerHeight).toFixed(3), viewport: [innerWidth, innerHeight], panes: c.panes, paneW: Math.round(r.width), axisW: Math.round(c.axis.getBoundingClientRect().width), paneTop: Math.round(r.top) };
  }
  /** Element coś rysuje: tekst, tło, obramowanie, grafika. */
  function paints(el) {
    if (/^(CANVAS|IMG|SVG|svg|INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\\(.*,\\s*0\\)$/.test(bg)) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && !/rgba\\(.*,\\s*0\\)$/.test(cs.borderTopColor)) return true;
    return false;
  }
  const desc = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (t ? ' "' + t + '"' : '');
  };
  /**
   * Elementy DOM nad polem świec: rysujące coś i nachodzące na komórkę panelu ceny (bez samego wykresu, jego przodków,
   * legendy w jednej linii z data-chart-legend i krzyża na płótnie).
   */
  function overCandles() {
    const c = chart();
    if (!c) return null;
    const area = c.pane.getBoundingClientRect();
    const out = [];
    let legend = null;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.contains(c.pane) || c.root.contains(el)) continue;
      if (!vis(el) || !paints(el)) continue;
      const r = el.getBoundingClientRect();
      if (inter(r, area) < 4) continue;
      // Zasłonięty przez wykres (np. stopka pod kartą „fixed” w trybie skupienia): na środku części wspólnej leży coś innego
      if (getComputedStyle(el).pointerEvents !== 'none') {
        const cx = (Math.max(r.left, area.left) + Math.min(r.right, area.right)) / 2;
        const cy = (Math.max(r.top, area.top) + Math.min(r.bottom, area.bottom)) / 2;
        const top = document.elementFromPoint(cx, cy);
        if (top && !el.contains(top) && !top.contains(el)) continue;
      }
      const lg = el.closest('[data-chart-legend]');
      if (lg) {
        const lr = lg.getBoundingClientRect();
        legend = { h: Math.round(lr.height), w: Math.round(lr.width) };
        if (lr.height <= 26) continue;
      }
      out.push(desc(el));
    }
    return { count: out.length, sample: [...new Set(out)].slice(0, 12), legend };
  }
  const overlapPairs = (items) => {
    let n = 0;
    const pairs = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 1 && h > 1) {
          n++;
          if (pairs.length < 8) pairs.push(a.text + ' × ' + b.text);
        }
      }
    return { n, pairs };
  };
  /** Teksty na płótnach komórki (px CSS strony) z ostatniej klatki każdego płótna. */
  function cellTexts(cell) {
    const out = [];
    for (const cv of cell.querySelectorAll('canvas')) {
      const e = window.__hqTexts && window.__hqTexts.get(cv);
      if (!e) continue;
      const r = cv.getBoundingClientRect();
      const k = cv.width / Math.max(1, r.width);
      for (const it of e.items) out.push({ text: it.text, l: r.left + it.l / k, t: r.top + it.t / k, r: r.left + it.r / k, b: r.top + it.b / k });
    }
    return out;
  }
  /** Nachodzące etykiety w każdym panelu wykresu (cena i panele pod nią): pole panelu i jego oś, osobno. */
  function labels() {
    const c = chart();
    if (!c) return null;
    const rows = [...c.root.querySelectorAll('tr')].filter((tr) => tr.children.length >= 3 && vis(tr));
    const sum = { paneLabels: 0, axisLabels: 0, pane: { n: 0, pairs: [] }, axis: { n: 0, pairs: [] }, panes: rows.length };
    rows.forEach((tr, i) => {
      const cells = [...tr.children];
      const pane = cellTexts(cells[1]);
      const axis = cellTexts(cells[2]);
      sum.paneLabels += pane.length;
      sum.axisLabels += axis.length;
      for (const [k, list] of [['pane', pane], ['axis', axis]]) {
        const o = overlapPairs(list);
        sum[k].n += o.n;
        sum[k].pairs.push(...o.pairs.map((p) => 'panel ' + (i + 1) + ': ' + p));
      }
    });
    return sum;
  }
  /** Nazwa dostępna elementu sterującego. */
  const nameOf = (el) => ((el.getAttribute('aria-label') || '') + ' | ' + (el.getAttribute('title') || '') + ' | ' + (el.innerText || el.textContent || '')).replace(/\\s+/g, ' ');
  const CONTROLS = 'button, a[href], select, input, [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=radio], [role=tab], [role=switch]';
  /** Funkcje widoczne teraz: wzorzec → czy jest widoczny element sterujący (albo pozycja listy wyboru). */
  function findAll(patterns) {
    const ctrls = [...document.querySelectorAll(CONTROLS)].filter(vis);
    const opts = [...document.querySelectorAll('select')].filter(vis).flatMap((s) => [...s.options].map((o) => ({ sel: s, text: o.textContent || '' })));
    const out = {};
    for (const [k, src] of Object.entries(patterns)) {
      const re = new RegExp(src, 'i');
      if (ctrls.some((el) => re.test(nameOf(el)))) out[k] = 'direct';
      else if (opts.some((o) => re.test(o.text))) out[k] = 'select';
    }
    return out;
  }
  /** Przyciski otwierające menu (do sprawdzenia drugiego kliknięcia). */
  function togglers() {
    return [...document.querySelectorAll('[aria-haspopup], [aria-expanded], [data-menu-toggle]')]
      .filter((el) => vis(el) && el.getAttribute('aria-expanded') !== 'true')
      .map((el, i) => {
        el.setAttribute('data-hq-probe', String(i));
        return { i, name: nameOf(el).slice(0, 60) };
      });
  }
  function clickProbe(i) {
    const el = document.querySelector('[data-hq-probe="' + i + '"]');
    if (!el) return false;
    el.click();
    return true;
  }
  /** Najmniejszy element dotykowy w paskach (telefon, cel ≥ 44 px). */
  function smallTargets(root, min) {
    const scope = root ? document.querySelector(root) : document;
    if (!scope) return [];
    return [...scope.querySelectorAll('button, select, a[href], [role=tab]')]
      .filter(vis)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.top < innerHeight && r.bottom > 0 && (r.height < min - 0.5 || r.width < min - 0.5))
      .map(({ el, r }) => desc(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height))
      .slice(0, 20);
  }
  function storage() {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('hq.')) o[k] = localStorage.getItem(k);
    }
    return o;
  }
  /**
   * Listy rozwijane paska: każda otwarta po kolei; rogi panelu (10 px do środka, za zaokrągleniem) muszą być widoczne — element w tym punkcie
   * należy do panelu (nie przycina go karta, okno ani dolne menu). Zwraca nazwy list z uciętym rogiem.
   */
  async function menuCorners() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { checked: 0, cut: [] };
    const btns = [...document.querySelectorAll('[data-chart-bar] button[aria-haspopup]')].filter(vis);
    for (const b of btns) {
      b.click();
      await wait(250);
      const panel = document.getElementById(b.getAttribute('aria-controls') || '');
      if (panel) {
        out.checked++;
        const r = panel.getBoundingClientRect();
        const pts = [[r.left + 10, r.top + 10], [r.right - 10, r.top + 10], [r.left + 10, r.bottom - 10], [r.right - 10, r.bottom - 10]];
        const bad = pts.filter(([x, y]) => { const el = document.elementFromPoint(x, y); return !el || !panel.contains(el); });
        if (bad.length) out.cut.push((b.getAttribute('aria-label') || '').slice(0, 30) + ' (' + bad.length + ' rogi)');
      }
      if (b.getAttribute('aria-expanded') === 'true') b.click();
      await wait(150);
    }
    return out;
  }
  /** Obiekty na płótnach panelu ceny (ostatnia klatka): podpisy, koła (bąble), prostokąty (świece, ściany); oś — podpisy. */
  function objects() {
    const c = chart();
    if (!c) return null;
    const sum = (cell) => {
      const o = { labels: 0, arcs: 0, rects: 0 };
      for (const cv of cell.querySelectorAll('canvas')) {
        const e = window.__hqTexts && window.__hqTexts.get(cv);
        if (!e) continue;
        o.labels += e.items.length;
        o.arcs += e.arcs;
        o.rects += e.rects;
      }
      return o;
    };
    const pane = sum(c.pane);
    return { labels: pane.labels, bubbles: pane.arcs, rects: pane.rects, axisLabels: sum(c.axis).labels };
  }
  window.__hq = { objects, menuCorners, chart, paneShare, overCandles, labels, findAll, togglers, clickProbe, smallTargets, storage, vis };
  return true;
})()`;
