import * as HyperQuantReplay from './engine.js';
const $ = (id) => document.getElementById(id);
const num = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 6, useGrouping: 'always' });
const shortNum = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1, useGrouping: 'always' });
const labels = ['<1k', '1–10k', '10–50k', '50–100k', '100–500k', '500k–1M', '≥1M'];
const titles = { book: 'Drabinka zleceń', memory: 'Pamięć arkusza', foot: 'Ślad transakcji' };
const examples = { book: 0, memory: 1, foot: 2 };
const subtitles = {
  book: 'Otwarte zlecenia i wykonania',
  memory: 'Cztery ostatnie pomiary L2',
  foot: 'Kolejne okna po 5 s i siedem klas USD',
};
const descriptions = {
  book: 'BID i ASK: zlecenia oczekujące. ↑ i ↓: wykonania. Ślad gaśnie po 2 s.',
  memory: 'Od starszej do nowszej migawki. ↑ BID, ↓ ASK. — poza zasięgiem pomiaru.',
  foot: 'Cztery kolejne okna po 5 s. Klasy i Δ ceny dotyczą wybranej milisekundy.',
};
const small = () => innerWidth <= 500,
  compact = () => innerWidth <= 1100;
let engine, meta;
const empty = HyperQuantReplay.emptyLevel();
const options = new URLSearchParams(location.search);
let market = 'BTC',
  mode = 'memory',
  time,
  price,
  band = -1,
  bank = false,
  half = false,
  follow = false;
let F,
  gridCenter = null,
  columns = [],
  signature = '',
  tapePage = 0;
let playing = false,
  raf = 0,
  wallStart = 0,
  replayStart = 0,
  speed = 1,
  busy = false,
  wanted = null;
let motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const signText = (v, sgn = false) => (v < 0 ? '−' : sgn && v > 0 ? '+' : '');
function amount(u, sgn = false, full = false) {
  const v = Math.abs(u) / 1e6;
  if (full) return signText(u, sgn) + num.format(v);
  if (v && v < 1) return signText(u, sgn) + num.format(v);
  const scale = v >= 1000000 ? 1e6 : v >= 1000 ? 1000 : 1;
  return signText(u, sgn) + shortNum.format(v / scale) + (scale === 1e6 ? 'M' : scale === 1000 ? 'k' : '');
}
const pstr = (p) => num.format(p / meta[market].scale);
const clock = (t) => new Date(t).toISOString().slice(11, 23);
const signedClass = (v) => (v > 0 ? 'tradePos' : v < 0 ? 'tradeNeg' : '');
const tp = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'no');
function colorValue(el, v, text) {
  el.className = tp(v);
  el.textContent = text;
}
function position(events, t) {
  let a = 0,
    b = events.length;
  while (a < b) {
    const mid = (a + b) >>> 1;
    if (events[mid] <= t) a = mid + 1;
    else b = mid;
  }
  return Math.max(0, a - 1);
}
function rowCount() {
  if (small()) return 13;
  if (innerWidth <= 850) return Math.max(11, Math.min(20, Math.floor((innerHeight - 492) / 23)));
  return Math.max(14, Math.min(40, Math.floor((innerHeight - 294) / (innerWidth >= 1530 ? 25 : 22))));
}
const def = (id, label, unit, style, w = 1) => ({ id, label, unit, style, w });
function chooseColumns() {
  const h = F.history;
  const hist = (j) =>
    def(
      'h' + j,
      h.at(j - 4) ? clock(h.at(j - 4)[0]).slice(compact() ? 3 : 0, 8) : '—',
      j === 3 ? 'L2 teraz' : compact() ? 'L2 · min:s' : 'L2 · UTC',
      'hist',
      1.1,
    );
  const slice = (j) => def('s' + j, ['20–15 s', '15–10 s', '10–5 s', '5–0 s'][j], 'Δ USD', 'hist', 1);
  const cls = (j) => def('c' + j, labels[j], 'Δ · 1 ms', 'size', 1);
  const p = def('p', 'Cena', 'USD', 'axis', 1.02),
    delta = def('d', 'Δ ceny', '1 ms', 'delta', 1);
  const bid = def('bid', 'BID', 'USD · L2', 'bids', 1.18),
    ask = def('ask', 'ASK', 'USD · L2', 'asks', 1.18);
  const nb = def('nb', 'n BID', 'zlecenia', 'nCol', 0.62),
    na = def('na', 'n ASK', 'zlecenia', 'nCol', 0.62);
  const sell = def('sell', '↓ Sprz.', '1 ms', 'sellCol', 1.05),
    buy = def('buy', '↑ Kup.', '1 ms', 'buyCol', 1.05);
  const prof = def('prof', 'Profil', 'obrót 120 s', 'profile', 1.25),
    trail = def('trail', 'Ślad', 'ostatnie 2 s', 'hist', 1.05);
  const chg = def('chg', 'Δ L2', 'netto USD', 'delta', 1.02);
  if (bank) {
    if (small()) return half ? [cls(4), cls(5), p, cls(6), buy, sell] : [cls(0), cls(1), p, cls(2), cls(3), delta];
    return compact()
      ? [cls(0), cls(1), cls(2), p, cls(3), cls(4), cls(5), cls(6)]
      : [prof, bid, sell, p, buy, ask, delta, ...labels.map((_, i) => cls(i))];
  }
  if (small()) {
    if (mode === 'book') return [bid, sell, p, buy, ask, delta];
    if (mode === 'memory') return [hist(1), hist(2), p, hist(3), chg, delta];
    return [slice(0), slice(1), p, slice(2), slice(3), delta];
  }
  if (compact()) {
    if (mode === 'book') return [nb, bid, sell, p, buy, ask, na, delta];
    if (mode === 'memory') return [hist(0), hist(1), hist(2), p, hist(3), chg, trail, delta];
    return [slice(0), slice(1), slice(2), p, slice(3), delta, sell, buy];
  }
  if (mode === 'book') return [prof, nb, bid, sell, p, buy, ask, na, trail, delta, ...[3, 4, 5].map(cls)];
  if (mode === 'memory') return [prof, hist(0), hist(1), hist(2), p, hist(3), chg, bid, ask, trail, delta];
  return [slice(0), slice(1), slice(2), slice(3), p, delta, ...labels.map((_, j) => cls(j))];
}
function makeGrid() {
  const n = rowCount();
  columns = chooseColumns();
  const key = columns.map((c) => c.id).join('|') + '#' + n;
  const ladder = $('ladder');
  ladder.style.setProperty(
    '--tracks',
    (compact() ? columns.map((_, i) => (i === (small() ? 2 : 3) ? 1.12 : 1)) : columns.map((c) => c.w))
      .map((w) => 'minmax(0,' + w + 'fr)')
      .join(' '),
  );
  if (signature !== key) {
    signature = key;
    $('headers').replaceChildren(
      ...columns.map((c) => {
        const span = document.createElement('div');
        span.setAttribute('role', 'columnheader');
        span.className = 'chead ' + c.style;
        span.append(document.createTextNode(c.label), document.createElement('small'));
        return span;
      }),
    );
    const rows = Array.from({ length: n }, (_, j) => {
      const row = document.createElement('div');
      row.className = 'price-row';
      row.setAttribute('role', 'row');
      columns.forEach((c, i) => {
        const el = document.createElement('div');
        el.setAttribute('role', 'gridcell');
        el.dataset.col = c.id;
        el.id = 'pxcell-' + j + '-' + i;
        const bar = document.createElement('i'),
          v = document.createElement('span');
        bar.setAttribute('aria-hidden', 'true');
        v.className = 'value';
        el.append(bar, v);
        row.append(el);
      });
      return row;
    });
    $('rows').replaceChildren(...rows);
  }
  columns.forEach((c, i) => {
    let k = $('headers').children[i];
    k.firstChild.nodeValue = c.label;
    k.lastChild.textContent = c.unit;
    if (c.id[0] === 'h')
      k.title = F.history.at(Number(c.id[1]) - 4) ? clock(F.history.at(Number(c.id[1]) - 4)[0]) + ' UTC' : '';
  });
  return n;
}
function maximums() {
  let book = 0,
    change = 0,
    profile = 0,
    instant = 0,
    slices = 0,
    classes = 0,
    trail = 0;
  const prev = F.history.at(-2),
    now = F.history.at(-1);
  for (const shot of F.history)
    for (const side of shot.slice(1))
      for (const [p, u] of side) {
        book = Math.max(book, u);
        if (now && prev) {
          const a = HyperQuantReplay.quote(now, p),
            b = HyperQuantReplay.quote(prev, p);
          if (a && b) change = Math.max(change, Math.abs(a.bid - a.ask - b.bid + b.ask));
        }
      }
  for (const d of Object.values(F.levels)) {
    profile = Math.max(profile, d.flow[0] + d.flow[1]);
    instant = Math.max(instant, ...d.now, Math.abs(d.now[0] - d.now[1]));
    slices = Math.max(slices, ...d.slices.map(Math.abs));
    classes = Math.max(classes, ...d.bands.map(Math.abs));
    if (d.recent) trail = Math.max(trail, Math.abs(d.recent[1] - d.recent[2]));
  }
  return { book, change, profile, instant, slices, classes, trail };
}
function cellData(id, p, level, q, hist, max) {
  let raw = null,
    label = '',
    color = '',
    maxi = 0,
    hot = 0,
    dir = false,
    present = false,
    missing = false,
    tip = '';
  if (id === 'p') return { label: pstr(p), raw: null, dir: false, color: '', maxi: 0, tip: pstr(p) + ' USD' };
  if (id === 'bid' || id === 'ask' || id === 'nb' || id === 'na') {
    if (q === null || q[id] === null) {
      missing = true;
    } else {
      raw = q[id];
      present = raw !== 0;
      dir = id === 'ask';
      if (id === 'nb' || id === 'na') {
        label = String(raw);
        tip = raw + ' zleceń';
      } else {
        label = amount(raw);
        maxi = max.book;
      }
    }
  } else if (id === 'prof') {
    raw = level.flow[0] + level.flow[1];
    maxi = max.profile;
    present = raw > 0;
    dir = false;
    missing = F.coverage < 120000;
  } else if (/^h\d$/.test(id)) {
    const j = Number(id[1]),
      v = hist[j];
    missing = v === null;
    if (v) {
      raw = v.bid - v.ask;
      present = raw !== 0;
      maxi = max.book;
      dir = raw < 0;
      color = signedClass(raw);
      label = (raw > 0 ? '↑' : raw < 0 ? '↓' : '') + amount(Math.abs(raw));
    }
  } else if (id === 'chg') {
    missing = !hist[2] || !hist[3];
    if (!missing) {
      raw = hist[3].bid - hist[3].ask - hist[2].bid + hist[2].ask;
      present = true;
      maxi = max.change;
      color = signedClass(raw);
      label = amount(raw, true);
    }
  } else if (id === 'trail') {
    missing = F.recentCoverage < 2000;
    if (level.recent) {
      const [stamp, buy, sell] = level.recent;
      raw = buy - sell;
      present = true;
      maxi = max.trail;
      color = signedClass(raw);
      hot = 0.48 * (1 - (F.time - stamp) / 2000);
      label = amount(raw, true);
      tip = clock(stamp) + ' UTC · ' + amount(raw, true, true) + ' USD';
    }
  } else if (id.startsWith('s') && id !== 'sell') {
    const j = Number(id[1]);
    raw = level.slices[j];
    present = level.sliceN[j] > 0;
    maxi = max.slices;
    color = signedClass(raw);
    label = amount(raw, true);
    missing = F.sliceCoverage[j] < 5000;
  } else if (id.startsWith('c')) {
    const j = Number(id[1]);
    raw = level.bands[j];
    present = level.hits[j] > 0;
    maxi = max.classes;
    color = signedClass(raw);
    label = amount(raw, true);
    if (present) hot = 0.24;
    missing = !F.instantCoverage;
  } else {
    const [b, s] = level.now;
    raw = id === 'buy' ? b : id === 'sell' ? s : b - s;
    present = id === 'd' ? level.count > 0 : raw > 0;
    maxi = max.instant;
    color = id === 'sell' ? 'tradeNeg' : id === 'buy' ? 'tradePos' : signedClass(raw);
    dir = id === 'buy';
    label = amount(raw, id === 'd');
    if (present) hot = 0.35;
    missing = !F.instantCoverage;
  }
  if (missing) return { label: '—', color: 'missing', tip: 'Poza pokryciem', dir: false, maxi: 0, raw: null };
  if (!present)
    return { label: '·', color: 'quiet', tip: 'Brak zarejestrowanej aktywności', dir: false, maxi: 0, raw: null };
  return { label: label || amount(raw), color, raw, maxi, dir, hot, tip: tip || amount(raw, true, true) + ' USD' };
}
function grid() {
  const n = makeGrid(),
    above = Math.floor((n - 1) / 2);
  if (gridCenter === null) gridCenter = price;
  if (follow && Math.abs(gridCenter - price) > Math.max(2, above - 2)) gridCenter = price;
  const mx = maximums(),
    h = Array.from({ length: 4 }, (_, j) => F.history.at(j - 4)),
    last = h[3],
    b = last?.[1][0]?.[0],
    a = last?.[2][0]?.[0];
  let active = '';
  [...$('rows').children].forEach((row, i) => {
    const p = gridCenter + above - i,
      rowData = F.levels[p] || empty;
    row.dataset.p = p;
    row.className = 'price-row' + (price === p ? ' selected' : '');
    row.setAttribute('aria-selected', String(price === p));
    const history = h.map((m) => HyperQuantReplay.quote(m, p)),
      q = history[3];
    columns.forEach((c, j) => {
      const el = row.children[j],
        v = cellData(c.id, p, rowData, q, history, mx);
      el.className = [
        'cell',
        c.style,
        v.color,
        v.dir ? 'fromLeft' : '',
        v.hot ? 'hit' : '',
        c.id === 'c' + band && price === p ? 'picked' : '',
        c.id === 'p' && p === b ? 'bestB' : '',
        c.id === 'p' && p === a ? 'bestA' : '',
      ]
        .filter(Boolean)
        .join(' ');
      el.lastChild.textContent = v.label;
      el.title = pstr(p) + ' USD · ' + c.label + ' · ' + v.tip;
      el.style.setProperty('--w', (v.maxi ? Math.min(100, (100 * Math.abs(v.raw)) / v.maxi) : 0) + '%');
      el.style.setProperty('--hot', String(v.hot || 0));
      if (c.id === 'p' && p === price) active = el.id;
    });
  });
  if (active) $('ladder').setAttribute('aria-activedescendant', active);
  else $('ladder').removeAttribute('aria-activedescendant');
  $('bookstamp').textContent =
    (small() ? 'Archiwum · ' : '') +
    (last
      ? 'L2 ' + clock(last[0]) + ' · wiek ' + num.format((F.time - last[0]) / 1000) + ' s'
      : 'L2 · brak pokrycia');
  $('bestBid').textContent = b ? pstr(b) : '—';
  $('bestAsk').textContent = a ? pstr(a) : '—';
  if (last) $('bookstamp').title = 'BID ' + pstr(b) + ' / ASK ' + pstr(a) + ' USD';
}
function meter(id, buy, sell) {
  const el = $(id),
    sum = buy + sell,
    bp = sum ? Math.round((buy * 100) / sum) : 0,
    sp = sum ? 100 - bp : 0;
  el.querySelector('.top').textContent = sum ? sp + '%' : '—';
  el.querySelector('.bottom').textContent = sum ? bp + '%' : '—';
  el.querySelector('.tower').style.setProperty('--ask', (sum ? (100 * sell) / sum : 50) + '%');
  el.querySelector('.tower').style.opacity = sum ? '1' : '.25';
  el.title =
    'Strona kupna ' + amount(buy, false, true) + ' USD · strona sprzedaży ' + amount(sell, false, true) + ' USD';
}
function spark() {
  const canvas = $('spark'),
    width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const values = F.timeline;
  const scale = Math.max(1, ...values.flat()),
    y = height * 0.5,
    step = width / values.length;
  ctx.fillStyle = '#3e4d55';
  ctx.fillRect(0, y, width, 1);
  values.forEach(([b, s], i) => {
    ctx.fillStyle = '#83ceff';
    ctx.fillRect(i * step, y - ((y - 1) * b) / scale, Math.max(1, step - 1), (y * b) / scale);
    ctx.fillStyle = '#f2958a';
    ctx.fillRect(i * step, y + 1, Math.max(1, step - 1), ((y - 1) * s) / scale);
  });
}
function tr(row, marketTape = false) {
  const [t, p, qty, sgn, u] = row,
    cl = tp(sgn),
    dir = sgn > 0 ? '↑' : '↓';
  return (
    '<div class="trow"><time>' +
    clock(t) +
    '</time><i class="' +
    cl +
    '">' +
    (marketTape ? pstr(p) : dir) +
    '</i><b class="' +
    cl +
    '">' +
    (marketTape ? dir + ' ' + amount(u) : amount(u, false, true)) +
    '</b>' +
    (marketTape
      ? ''
      : '<small>' +
        pstr(p) +
        ' USD × ' +
        num.format(Number(qty)) +
        ' · ' +
        (sgn > 0 ? 'kupno' : 'sprzedaż') +
        '</small>') +
    '</div>'
  );
}
function inspect() {
  const level = F.levels[price] || empty;
  const op = F.atPrice.filter((r) => r[0] === F.time && (band < 0 || r[5] === band));
  const buys = op.filter((r) => r[3] > 0),
    sells = op.filter((r) => r[3] < 0);
  const bu = buys.reduce((s, r) => s + r[4], 0),
    se = sells.reduce((s, r) => s + r[4], 0);
  $('lenslabel').textContent = (band >= 0 ? 'Δ klasy ' + labels[band] : 'Δ wszystkich klas') + ' · 1 ms · USD';
  colorValue($('lensamount'), bu - se, F.instantCoverage ? amount(bu - se, true, true) : '—');
  $('lensbuy').textContent = F.instantCoverage ? '↑ ' + amount(bu) + ' · ' + buys.length + ' wyk.' : '↑ —';
  $('lenssell').textContent = F.instantCoverage ? '↓ ' + amount(se) + ' · ' + sells.length + ' wyk.' : '↓ —';
  $('lensclock').textContent = clock(F.time) + ' UTC';
  $('lenspx').textContent = pstr(price) + ' USD';
  [...$('bands').children].forEach((button, i) => {
    const k = i - 1;
    button.setAttribute('aria-pressed', String(k === band));
    button.lastChild.textContent = k < 0 ? F.count : F.bandCount[k];
  });
  const chosen = F.atPrice.filter(
    (r) =>
      (band < 0 || r[5] === band) &&
      ($('scope').value === '120' || r[0] === F.time) &&
      ($('side').value === '0' || r[3] === Number($('side').value)),
  );
  const pageSize = innerWidth <= 850 ? 2 : 4,
    pages = Math.max(1, Math.ceil(chosen.length / pageSize));
  tapePage = Math.min(tapePage, pages - 1);
  $('matched').textContent = chosen.length + ' wyk.';
  $('paging').hidden = pages < 2;
  $('paging').textContent = tapePage + 1 + '/' + pages + ' ›';
  $('tape').innerHTML =
    chosen
      .slice(tapePage * pageSize, (tapePage + 1) * pageSize)
      .map((row) => tr(row))
      .join('') || '<div class="muted">Brak wykonań dla tego wyboru.</div>';
  $('last').innerHTML = F.recent
    .slice(0, 5)
    .map((r) => tr(r, true))
    .join('');
  $('coverage').textContent =
    'Pokrycie taśmy ' +
    num.format(F.coverage / 1000) +
    '/120 s · ' +
    F.count +
    ' wyk. · ' +
    (F.instantCoverage ? '1/1 ms' : '0/1 ms');
  $('r-price').textContent = pstr(price);
  colorValue(
    $('r-delta'),
    level.now[0] - level.now[1],
    F.instantCoverage ? amount(level.now[0] - level.now[1], true) : '—',
  );
  $('r-delta').title = F.instantCoverage ? amount(level.now[0] - level.now[1], true, true) + ' USD' : 'Brak pokrycia';
  const d = F.total[0] - F.total[1];
  colorValue($('r-market'), d, F.coverage === 120000 ? amount(d, true) : '—');
  $('r-market').title =
    F.coverage === 120000
      ? amount(d, true, true) + ' USD'
      : 'Pokrycie ' + num.format(F.coverage / 1000) + '/120 s';
}
let lastBookStamp = null,
  selectedDot = null;
const plotTargets = new WeakMap();
function drawTrail(canvas) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const points = F.trail20,
    prices = points.map((p) => p[1]);
  prices.push(price);
  let lo = Math.min(...prices),
    hi = Math.max(...prices);
  if (hi === lo) {
    hi++;
    lo--;
  }
  const x0 = 4,
    x1 = w - 48,
    y0 = 9,
    y1 = h - 18;
  const x = (t) => x0 + (x1 - x0) * (1 - (F.time - t) / 20000),
    y = (p) => y1 - ((y1 - y0) * (p - lo)) / (hi - lo);
  const maxima = Math.max(1, ...points.map((p) => p[2] + p[3]));
  g.font = '10px Consolas, monospace';
  g.textBaseline = 'middle';
  for (const p of [lo, hi]) {
    const yy = y(p);
    g.fillStyle = '#34424c';
    g.fillRect(x0, yy, x1 - x0, 0.8);
    g.fillStyle = '#aebcc7';
    g.fillText(pstr(p), x1 + 4, yy);
  }
  for (let i = 0; i < 5; i++) {
    const xx = x0 + ((x1 - x0) * i) / 4;
    g.fillStyle = '#2d3742';
    g.fillRect(xx, y0, 1, y1 - y0);
  }
  g.strokeStyle = '#8fa95f';
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(x0, y(price));
  g.lineTo(x1, y(price));
  g.stroke();
  g.setLineDash([]);
  const mapped = points.map((p, i) => ({
    x: x(p[0]),
    y: y(p[1]),
    r: 1.6 + Math.sqrt((p[2] + p[3]) / maxima) * (w > 400 ? 8 : 4.5),
    i,
  }));
  for (const v of [...mapped].sort((a, b) => b.r - a.r)) {
    const p = points[v.i],
      frac = p[2] / (p[2] + p[3]);
    let start = -Math.PI / 2;
    for (const [part, ink] of [
      [frac, '#62bbef'],
      [1 - frac, '#f49386'],
    ]) {
      if (part <= 0) continue;
      const end = start + 2 * Math.PI * part;
      g.fillStyle = ink;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.moveTo(v.x, v.y);
      g.arc(v.x, v.y, v.r, start, end);
      g.closePath();
      g.fill();
      start = end;
    }
    g.globalAlpha = 1;
  }
  if (canvas.id === 'bigplot' && mapped[selectedDot]) {
    const v = mapped[selectedDot];
    g.strokeStyle = '#dfff91';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(v.x, v.y, v.r + 3, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#b8c5cc';
  g.fillText('−20 s', x0, h - 6);
  g.fillText('teraz', x1 - 25, h - 6);
  plotTargets.set(canvas, mapped);
}
function describeDot() {
  const p = F.trail20[selectedDot];
  $('pointinfo').textContent = p
    ? clock(p[0]) +
      ' UTC · ' +
      pstr(p[1]) +
      ' USD · ↑ ' +
      amount(p[2], false, true) +
      ' / ↓ ' +
      amount(p[3], false, true) +
      ' USD'
    : 'Brak wykonań w ostatnich 20 s.';
}
function pinDot(index) {
  const p = F.trail20[index];
  if (!p) return;
  if ($('plotdialog').open) $('plotdialog').close();
  if (p[0] < meta[market].start) {
    // Warm-up prints belong to the 120 s totals but precede the playable recording.
    return;
  }
  follow = false;
  price = p[1];
  gridCenter = price;
  band = -1;
  $('side').value = '0';
  $('scope').value = '1';
  void seek(p[0]);
}
function plotClick(event) {
  const canvas = event.currentTarget,
    b = canvas.getBoundingClientRect();
  const xx = event.clientX - b.left,
    yy = event.clientY - b.top;
  const nearest = (plotTargets.get(canvas) || [])
    .map((v) => [Math.hypot(v.x - xx, v.y - yy), v])
    .sort((a, b) => a[0] - b[0])[0];
  if (nearest && nearest[0] <= nearest[1].r + 7) pinDot(nearest[1].i);
}
function draw() {
  grid();
  inspect();
  spark();
  drawTrail($('trailplot'));
  if ($('plotdialog').open) {
    drawTrail($('bigplot'));
    describeDot();
  }
  const shot = F.history.at(-1),
    sum = (rows) => rows?.reduce((s, r) => s + r[1], 0) || 0;
  meter('meter-depth', sum(shot?.[1]), sum(shot?.[2]));
  meter('meter-flow', ...F.total);
  $('clock').textContent = clock(F.time);
  $('clock').title = 'Czas zdarzenia · UTC';
  $('scrub').value = F.time - meta[market].start;
  $('scrub').setAttribute('aria-valuetext', clock(F.time) + ' UTC');
  $('board-title').textContent = bank ? 'Klasy nominału' : titles[mode];
  $('subtitle').textContent = bank ? 'Siedem klas · USD' : subtitles[mode];
  $('legend').textContent = bank ? 'Klasy w 1 ms · dotknij kwoty, aby otworzyć wykonania.' : descriptions[mode];
  $('bank').textContent = bank ? 'Wróć do układu' : '7 klas';
  $('bank').setAttribute('aria-pressed', String(bank));
  $('half').hidden = !(small() && bank);
  $('half').textContent = half ? 'Klasy 1–4' : 'Klasy 5–7';
  $('follow').setAttribute('aria-pressed', String(follow));
  $('prev').disabled = F.time <= meta[market].start;
  $('next').disabled = F.time >= meta[market].end;
  document.body.dataset.motion = motion ? 'on' : 'off';
  $('motion').setAttribute('aria-pressed', String(motion));
  $('motion').textContent = motion ? 'Animacje wł.' : 'Animacje wył.';
  const stamp = shot?.[0];
  if (playing && motion && stamp !== lastBookStamp) {
    for (const el of $('headers').children) {
      if (/bids|asks|hist/.test(el.className))
        el.animate([{ boxShadow: 'inset 0 -3px #def88a' }, { boxShadow: 'inset 0 0 transparent' }], {
          duration: 420,
        });
    }
  }
  lastBookStamp = stamp;
}
function activeButtons() {
  document
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document
    .querySelectorAll('[data-market]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.market === market)));
}

async function refresh() {
  F = engine.frame(market, time, follow ? null : price);
  price = F.price;
  draw();
}
function stop() {
  playing = false;
  cancelAnimationFrame(raf);
  wanted = null;
  $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Odtwórz');
  if (F && document.querySelector('.expired')) grid();
}
async function playFrame(t) {
  if (busy) {
    wanted = t;
    return;
  }
  busy = true;
  try {
    time = t;
    tapePage = 0;
    await refresh();
  } finally {
    busy = false;
    if (wanted !== null && playing) {
      const next = wanted;
      wanted = null;
      void playFrame(next);
    }
  }
}
function tick(now) {
  if (!playing) return;
  const m = meta[market],
    v = Math.min(m.end, replayStart + (now - wallStart) * speed);
  const t = m.events[position(m.events, v)];
  if (t !== time) void playFrame(t);
  if (F && F.time === t) {
    for (const cell of document.querySelectorAll('[data-col=trail].hit')) {
      const obs = F.levels[cell.parentElement.dataset.p]?.recent;
      if (!obs) continue;
      const fraction = Math.max(0, 1 - (v - obs[0]) / 2000);
      cell.style.setProperty('--hot', String(fraction * 0.48));
      if (!fraction) {
        cell.classList.add('expired');
        cell.lastChild.textContent = '·';
        cell.style.setProperty('--w', '0%');
      }
    }
  }
  if (v >= m.end) {
    stop();
    time = m.end;
    void refresh();
    return;
  }
  raf = requestAnimationFrame(tick);
}
function togglePlay() {
  if (playing) {
    stop();
    return;
  }
  if (time >= meta[market].end) {
    time = meta[market].start;
    follow = true;
    gridCenter = null;
    void refresh();
  }
  playing = true;
  wallStart = performance.now();
  replayStart = time;
  $('play').textContent = 'Ⅱ';
  $('play').setAttribute('aria-label', 'Pauza');
  raf = requestAnimationFrame(tick);
}
function seek(t) {
  stop();
  time = t;
  tapePage = 0;
  return refresh();
}
function example() {
  const [t, p, b] = meta[market].marks[examples[mode]];
  price = p;
  band = b;
  follow = false;
  gridCenter = null;
  bank = false;
  half = false;
  tapePage = 0;
  $('side').value = '0';
  $('scope').value = '1';
  return seek(t);
}
function changeMarket(k) {
  market = k;
  const coin = k === 'BTC' ? 'BTC' : 'xyz:' + k;
  $('live-link').href = '../../#orderflow?m=' + encodeURIComponent(coin);
  const m = meta[k];
  $('scrub').min = 0;
  $('scrub').max = m.end - m.start;
  activeButtons();
  return example();
}
function step(dir) {
  const ev = meta[market].events,
    idx = position(ev, time);
  return seek(ev[Math.max(0, Math.min(ev.length - 1, idx + dir))]);
}
function selectPrice(p, k = null) {
  stop();
  follow = false;
  price = p;
  if (k !== null) band = k;
  tapePage = 0;
  return refresh();
}
function bind() {
  $('bands').replaceChildren(
    ...['Wszystkie', ...labels].map((label, i) => {
      const button = document.createElement('button');
      button.title = label + ' · wybierz klasę';
      button.append(document.createTextNode(label), document.createElement('small'));
      button.onclick = () => {
        stop();
        band = i - 1;
        tapePage = 0;
        draw();
      };
      return button;
    }),
  );
  document.querySelectorAll('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        mode = b.dataset.mode;
        bank = false;
        half = false;
        activeButtons();
        draw();
      }),
  );
  document
    .querySelectorAll('[data-market]')
    .forEach((b) => (b.onclick = () => void changeMarket(b.dataset.market)));
  $('play').onclick = togglePlay;
  $('prev').onclick = () => void step(-1);
  $('next').onclick = () => void step(1);
  $('example').onclick = () => void example();
  $('speed').onchange = () => {
    if (playing) {
      replayStart = time;
      wallStart = performance.now();
    }
    speed = Number($('speed').value);
  };
  $('scrub').oninput = () => {
    const m = meta[market];
    void seek(m.events[position(m.events, m.start + Number($('scrub').value))]);
  };
  $('bank').onclick = () => {
    bank = !bank;
    half = false;
    draw();
  };
  $('half').onclick = () => {
    half = !half;
    draw();
  };
  $('follow').onclick = () => {
    follow = !follow;
    if (follow) gridCenter = null;
    void refresh();
  };
  $('scope').onchange = $('side').onchange = () => {
    tapePage = 0;
    inspect();
  };
  $('paging').onclick = () => {
    const s = $('paging').textContent.split('/');
    tapePage = (tapePage + 1) % parseInt(s[1]);
    inspect();
  };
  $('center').onclick = () => {
    gridCenter = price;
    grid();
  };
  function offset(d) {
    gridCenter = Math.max(Math.ceil(rowCount() / 2), gridCenter + d * Math.max(1, Math.floor(rowCount() / 2)));
    grid();
  }
  $('up').onclick = () => offset(1);
  $('down').onclick = () => offset(-1);
  $('rows').onclick = (e) => {
    const el = e.target.closest('[data-col]');
    if (!el) return;
    const p = Number(el.parentElement.dataset.p),
      k = el.dataset.col;
    void selectPrice(p, /^c\d$/.test(k) ? Number(k[1]) : null);
    $('ladder').focus({ preventScroll: true });
  };
  $('ladder').onkeydown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const p = price + (e.key === 'ArrowUp' ? 1 : -1);
      if (p <= 0) return;
      if (Math.abs(gridCenter - p) >= Math.floor(rowCount() / 2)) gridCenter = p;
      void selectPrice(p);
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      void step(e.key === 'ArrowRight' ? 1 : -1);
    }
    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    }
    if (e.key === 'Escape') {
      band = -1;
      tapePage = 0;
      draw();
    }
  };
  $('help').onclick = $('info').onclick = () => {
    stop();
    $('manual').showModal();
  };
  $('motion').onclick = () => {
    motion = !motion;
    draw();
  };
  $('expandtrail').onclick = $('openplot').onclick = () => {
    stop();
    selectedDot = F.trail20.length - 1;
    $('plotdialog').showModal();
    drawTrail($('bigplot'));
    describeDot();
    $('bigplot').focus();
  };
  $('trailplot').onclick = $('bigplot').onclick = plotClick;
  $('bigplot').onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pinDot(selectedDot);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    selectedDot = Math.max(0, Math.min(F.trail20.length - 1, selectedDot + (e.key === 'ArrowRight' ? 1 : -1)));
    drawTrail($('bigplot'));
    describeDot();
  };
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    motion = !e.matches;
    draw();
  });
  let scheduled = false;
  addEventListener('resize', () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (F) draw();
      });
    }
  });
}
async function init() {
  const response = await fetch('./sample-2026-11-20.json');
  if (!response.ok) throw new Error('sample unavailable');
  engine = HyperQuantReplay.create(await response.json());
  meta = engine.markets();
  bind();
  if (Object.hasOwn(titles, options.get('widok'))) mode = options.get('widok');
  await changeMarket(Object.hasOwn(meta, options.get('m')) ? options.get('m') : 'BTC');
}
init().catch(() => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'Nie udało się wczytać nagrania. ';
  const retry = document.createElement('a');
  retry.href = location.href;
  retry.textContent = 'Wczytaj ponownie';
  message.append(retry);
  document.querySelector('.controls').replaceChildren(message);
});
