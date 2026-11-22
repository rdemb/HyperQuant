/* Strona startowa „Przekrój”: przekrój rynku na żywo, linia doby, on-chain, dowód, pochodzenie. */
(function () {
  'use strict';
  const HQ = window.HQ;
  const $ = (s, r = document) => r.querySelector(s);
  const S = { book: null, bookAt: 0, liq: null, ledger: null, trades: [], price: null, priceAt: 0, ctx: null, candles: null, candlesAt: 0, status: 'connecting', err: null };
  const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();
  const STEP = 100; const HALF = 2000; // kubełek i połowa zakresu przekroju (USD)

  window.HQ.ready(() => {
    const xs = new XSec($('#xsec'), $('#flow'));
    setupOrigin();
    setupTable(xs); setupExplore(xs); setupReturn();
    setupPhone();
    renderDay(); setInterval(renderDay, 30000);

    // Liczby rynku: cena znacznikowa do pierwszej transakcji
    HQ.marketCtx('BTC').then((c) => { S.ctx = c; if (!S.price) { S.price = c.mark; S.priceAt = c.at; } xs.dirty = true; renderAll(); }).catch((e) => { S.err = String(e.message || e); renderAll(); });
    // Księga (kubełki 100 USD) i transakcje
    const feed = new HQ.Feed('BTC', { nSigFigs: 3 });
    // Ten sam strumień zasila hero (krople na linii wody) i opcjonalny dźwięk taśmy
    HQ.liveFeed = feed;
    document.dispatchEvent(new CustomEvent('hq:feed', { detail: feed }));
    feed.on('status', (s) => { S.status = s; renderProvs(); });
    feed.on('book', (b) => { S.book = b; S.bookAt = Date.now(); xs.setBook(b); renderProvs(); });
    feed.on('trades', (ts) => {
      for (const t of ts) S.trades.push(t);
      const cut = Date.now() - 190000; while (S.trades.length && S.trades[0].t < cut) S.trades.shift();
      const last = ts[ts.length - 1]; if (last) { S.price = last.px; S.priceAt = last.t; xs.dirty = true; }
    });
    // Skaner HyperQuant: mapa likwidacji (co 5 min) i dziennik prognoz (co 10 min)
    const loadLiq = () => HQ.published('liq-map/BTC.json').then((d) => { S.liq = d; xs.setLiq(d); renderAll(); }).catch(() => renderAll());
    const loadLedger = () => HQ.published('ledger/BTC/summary.json').then((d) => { S.ledger = d; renderAll(); }).catch(() => renderAll());
    const loadCandles = () => HQ.info({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1d', startTime: Date.now() - 4 * 864e5, endTime: Date.now() } }).then((c) => { S.candles = c; S.candlesAt = Date.now(); renderAll(); }).catch(() => renderAll());
    loadLiq(); loadLedger(); loadCandles();
    setInterval(loadLiq, 300000); setInterval(loadLedger, 600000); setInterval(loadCandles, 3600000);
    setInterval(() => xs.updateAria(), 10000); setTimeout(() => xs.updateAria(), 3000);
    document.addEventListener('hq:lang', () => { renderAll(); renderDay(); xs.dirty = true; xs.updateAria(); setupOrigin(true); setupReturn(); });
    document.addEventListener('hq:theme', () => { xs.readColors(); xs.dirty = true; });
  });

  /* ---------- Pieczęcie przy przekroju ---------- */
  function renderProvs() {
    const box = $('#xsec-provs'); if (!box) return;
    box.innerHTML = '';
    if (S.book) box.append(HQ.prov('live', S.bookAt, 10000, 'L2'));
    else box.append(HQ.prov('none', null, 0, S.status === 'reconnecting' ? HQ.t('d.st.reconnecting') : HQ.t('xsec.wait')));
    if (S.liq) box.append(HQ.prov('live', S.liq.asOf, 20 * 60000, covPct(S.liq) + ' OI'));
  }
  const covPct = (l) => { const c = l.coverage || {}; const v = c.oiBtc ? (c.scannedBtc / (2 * c.oiBtc)) * 100 : null; return v == null ? HQ.DASH : HQ.fmt(v, 1) + (HQ.lang === 'pl' ? ' %' : '%'); };

  /* ---------- Wartości sekcji ---------- */
  function bucketsOf(arr) { const m = new Map(); (arr || []).forEach((x) => { const b = Math.round(x.px / STEP) * STEP; m.set(b, (m.get(b) || 0) + x.ntlUsd); }); return m; }
  function renderAll() {
    renderProvs();
    const src = $('#xsec-src'); if (src) src.textContent = HQ.fill(HQ.t('xsec.src'), { cov: S.liq ? covPct(S.liq) : HQ.DASH });
    // Przed sesją: PDH/PDL z dziennej świecy poprzedniego dnia UTC; paliwo ±1% ze skanera
    const d0 = Math.floor(Date.now() / 864e5) * 864e5;
    const prev = S.candles && S.candles.find((c) => c.t === d0 - 864e5);
    $('#v-pdh').textContent = prev ? HQ.fmt(+prev.h, 0) : HQ.DASH;
    $('#v-pdl').textContent = prev ? HQ.fmt(+prev.l, 0) : HQ.DASH;
    const sb = $('#src-before'); sb.innerHTML = '';
    if (prev) sb.append(HQ.prov('live', S.candlesAt, 6 * 3600000, '1d'));
    if (S.liq) {
      const m = S.liq.markPx; let below = 0, above = 0;
      S.liq.longs.forEach((x) => { if (x.px >= m * 0.99 && x.px <= m) below += x.ntlUsd; });
      S.liq.shorts.forEach((x) => { if (x.px <= m * 1.01 && x.px >= m) above += x.ntlUsd; });
      const pl = HQ.lang === 'pl';
      $('#v-fuel').innerHTML = `<span title="${pl ? 'poniżej ceny' : 'below price'}">${pl ? 'pon.' : 'below'} ${HQ.fmtUsdShort(below)}</span> · <span title="${pl ? 'powyżej ceny' : 'above price'}">${pl ? 'pow.' : 'above'} ${HQ.fmtUsdShort(above)}</span>`;
      sb.append(HQ.prov('live', S.liq.asOf, 20 * 60000, covPct(S.liq) + ' OI'));
    } else $('#v-fuel').textContent = HQ.DASH;
    // Po sesji: dziennik prognoz
    const L = S.ledger; const sa = $('#src-after'); sa.innerHTML = '';
    if (L && L.scores) {
      const r = L.scores.ret && L.scores.ret['60'];
      $('#v-n').textContent = r ? HQ.fmt(r.n, 0) : HQ.DASH;
      const tch = L.scores.touch;
      $('#v-brier').innerHTML = tch ? `${HQ.fmt(tch.brier, 3)} <span class="muted" style="font-weight:400">· ${HQ.t('after.base')} ${HQ.fmt(tch.brierBase, 3)}</span>` : HQ.DASH;
      sa.append(HQ.prov('live', L.asOf, 3600000, 'ledger'));
    } else { $('#v-n').textContent = HQ.DASH; $('#v-brier').textContent = HQ.DASH; }
    renderOnchain(); renderProof();
  }

  function renderOnchain() {
    const L = S.liq; const sp = $('#src-profile'); sp.innerHTML = '';
    if (!L) return;
    sp.append(HQ.prov('live', L.asOf, 20 * 60000, covPct(L) + ' OI'));
    const c = L.coverage || {};
    $('#b-cov').textContent = covPct(L);
    $('#b-pos').textContent = HQ.fmt(c.positions, 0);
    const m = L.markPx; const lb = bucketsOf(L.longs), sb = bucketsOf(L.shorts);
    const best = (map, lo, hi) => { let bp = null, bv = 0; map.forEach((v, p) => { if (p >= lo && p <= hi && v > bv) { bv = v; bp = p; } }); return [bp, bv]; };
    const [bp, bv] = best(lb, m * 0.94, m); const [ap, av] = best(sb, m, m * 1.06);
    $('#b-below').textContent = bp ? HQ.fmtUsdShort(bv) : HQ.DASH;
    $('#b-below-s').textContent = bp ? `${HQ.fmt(bp, 0)} USD · ${HQ.fmtPct((bp / m - 1) * 100, 1)}` : HQ.DASH;
    $('#b-above').textContent = ap ? HQ.fmtUsdShort(av) : HQ.DASH;
    $('#b-above-s').textContent = ap ? `${HQ.fmt(ap, 0)} USD · ${HQ.fmtPct((ap / m - 1) * 100, 1)}` : HQ.DASH;
    // Profil ±6%: jedna skala dla obu stron (ta sama miara: nominał likwidacji)
    const lo = m * 0.94, hi = m * 1.06; const Wv = 640, Hv = 230, base = 176;
    const all = []; lb.forEach((v, p) => { if (p >= lo && p < m) all.push([p, v, 'l']); }); sb.forEach((v, p) => { if (p > m && p <= hi) all.push([p, v, 's']); });
    const max = Math.max(1, ...all.map((x) => x[1]));
    const x = (p) => ((p - lo) / (hi - lo)) * Wv; const bw = Math.max(1.5, (STEP / (hi - lo)) * Wv - 1);
    const pl = HQ.lang === 'pl';
    const bars = all.map(([p, v, s]) => { const h = (v / max) * (base - 14); return `<rect x="${x(p).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${s === 'l' ? 'var(--sell)' : 'var(--buy)'}" opacity=".9"/>`; }).join('');
    const ticks = [-6, -3, 0, 3, 6].map((k) => { const p = m * (1 + k / 100); const lab = k === 0 ? HQ.fmt(m, 0) : HQ.fmtSigned(k, 0) + '%'; const anc = k === -6 ? 'start' : k === 6 ? 'end' : 'middle'; return `<text x="${x(p).toFixed(1)}" y="${base + 22}" text-anchor="${anc}" fill="var(--ink-3)" font-family="JetBrains Mono, monospace" font-size="11">${lab}</text><line x1="${x(p).toFixed(1)}" x2="${x(p).toFixed(1)}" y1="${base}" y2="${base + 6}" stroke="var(--line-strong)"/>`; }).join('');
    $('#liq-profile').innerHTML = `<svg viewBox="0 0 ${Wv} ${Hv}" aria-hidden="true"><line x1="0" x2="${Wv}" y1="${base}" y2="${base}" stroke="var(--line-strong)"/>${bars}<line x1="${x(m)}" x2="${x(m)}" y1="6" y2="${base}" stroke="var(--notch)" stroke-width="2"/>${ticks}<text x="4" y="14" fill="var(--sell-ink)" font-size="11.5" font-family="Plus Jakarta Sans, sans-serif">◀ ${HQ.t('onchain.longs')}</text><text x="${Wv - 4}" y="14" text-anchor="end" fill="var(--buy-ink)" font-size="11.5" font-family="Plus Jakarta Sans, sans-serif">${HQ.t('onchain.shortsl')} ▶</text><text x="${Wv - 4}" y="${Hv - 2}" text-anchor="end" fill="var(--ink-3)" font-size="11" font-family="JetBrains Mono, monospace">max ${HQ.fmtUsd(max)} / ${STEP} USD</text></svg>`;
    $('#liq-profile').setAttribute('aria-label', `${HQ.t('onchain.profile')}. ${HQ.t('onchain.below')}: ${bp ? HQ.fmt(bp, 0) + ' USD, ' + HQ.fmtUsd(bv) : HQ.DASH}. ${HQ.t('onchain.above')}: ${ap ? HQ.fmt(ap, 0) + ' USD, ' + HQ.fmtUsd(av) : HQ.DASH}. ${pl ? 'Pokrycie' : 'Coverage'} ${covPct(L)}.`);
  }

  function renderProof() {
    const L = S.ledger; if (!L) return;
    const ol = $('#chain'); ol.innerHTML = '';
    const days = (L.ots || []).slice(-6);
    days.forEach((d) => { const li = document.createElement('li'); li.className = 'blk'; li.innerHTML = `<b>${HQ.date(Date.parse(d.day + 'T12:00:00Z'))}</b>${HQ.fill(HQ.t('proof.cal'), { n: d.calendars })}<br><span class="seal">${HQ.t('proof.stamp')}</span>`; ol.append(li); });
    const h = document.createElement('li'); h.className = 'blk head';
    h.innerHTML = `<b>${HQ.t('proof.head')}</b>${L.head.hash.slice(0, 8)}…${L.head.hash.slice(-5)}<br><span class="seal">${HQ.time(L.asOf, false)}</span>`; ol.append(h);
    $('#p-lines').textContent = HQ.fmt(L.head.lines, 0);
    $('#p-head').textContent = `SHA-256 ${L.head.hash.slice(0, 16)}…`;
    const P = L.participation || {};
    $('#p-issued').textContent = HQ.fmt(P.issued, 0);
    const why = P.gaps && P.gaps[0] && P.gaps[0].reason === 'outage' ? HQ.t('proof.outage') : (P.gaps && P.gaps[0] ? P.gaps[0].reason : HQ.DASH);
    $('#p-skipped').textContent = HQ.fill(HQ.t('proof.skipped'), { n: HQ.fmt(P.skipped || 0, 0), why });
    const r = L.scores.ret && L.scores.ret['60'];
    $('#p-crpss').textContent = r ? HQ.fmtSigned(r.crpss, 3) : HQ.DASH;
    const t = L.scores.touch;
    $('#p-bss').textContent = t ? HQ.fmt(t.bss, 2) : HQ.DASH;
    $('#p-bss-s').textContent = t && t.bssCi ? HQ.fill(HQ.t('proof.bssSub'), { lo: HQ.fmt(t.bssCi.lo, 2), hi: HQ.fmt(t.bssCi.hi, 2), d: t.bssCi.days }) : '';
    const sp = $('#src-proof'); sp.innerHTML = '';
    sp.append(HQ.prov('live', L.asOf, 3600000, 'ledger'), HQ.prov('model', null, 0, HQ.t('proof.model')));
  }

  /* ---------- Linia doby ---------- */
  function renderDay() {
    const now = Date.now(); const s = HQ.sessions(now);
    const track = $('#dayline-track'); if (!track) return;
    track.innerHTML = '';
    s.list.forEach((x) => { const b = document.createElement('div'); b.className = 'band' + (x === s.cur ? ' now' : ''); b.dataset.s = x.id; b.style.left = ((x.from - s.d0) / 864e5) * 100 + '%'; b.style.width = ((x.to - x.from) / 864e5) * 100 + '%'; b.textContent = HQ.t('s.' + x.id); track.append(b); });
    const ticks = $('#dayline-ticks'); ticks.innerHTML = '';
    for (let h = 0; h <= 24; h += 3) { const sp = document.createElement('span'); sp.style.left = (h / 24) * 100 + '%'; sp.textContent = HQ.time(s.d0 + h * 3600000, false); if (h === 0) sp.style.transform = 'none'; if (h === 24) sp.style.transform = 'translateX(-100%)'; ticks.append(sp); }
    const nm = $('#dayline-now'); nm.style.left = s.frac * 100 + '%';
    const nl = nm.querySelector('.lbl'); nl.textContent = `${HQ.t('now')} ${HQ.time(now, false)}`;
    nl.style.transform = s.frac > 0.86 ? 'translateX(calc(-100% + 6px))' : s.frac < 0.14 ? 'translateX(-6px)' : 'translateX(-50%)';
    $('#dayline-sr').textContent = `${HQ.t('now')} ${HQ.time(now, false)} · ${HQ.t('s.' + s.cur.id)} · ${HQ.span(s.cur.to - now)}`;
    const ph = HQ.phase(now);
    document.querySelectorAll('.tense').forEach((el) => {
      const on = el.dataset.phase === ph; el.dataset.now = String(on);
      let tag = el.querySelector('.nowtag'); if (on && !tag) { tag = document.createElement('span'); tag.className = 'nowtag'; el.prepend(tag); } if (!on && tag) tag.remove(); if (tag) tag.textContent = HQ.t('now');
    });
  }

  /* ---------- Pochodzenie: pokaz pierścienia ---------- */
  let demoAt = Date.now();
  function setupOrigin(relabel) {
    const put = (id, el) => { const b = $(id); if (b) { b.innerHTML = ''; b.append(el); } };
    put('#o-live', HQ.prov('live', demoAt, 30000, 'BTC'));
    put('#o-model', HQ.prov('model', null, 0, 'HAR'));
    put('#o-sim', HQ.prov('sim', null, 0));
    put('#o-stale', HQ.prov('stale', null, 0, HQ.DASH));
    put('#o-rec', HQ.prov('rec', null, 0, '20.11 · 14:32:05'));
    if (!relabel) {
      $('#o-reset').addEventListener('click', () => { demoAt = Date.now(); put('#o-live', HQ.prov('live', demoAt, 30000, 'BTC')); });
      // Pokaz startuje, gdy sekcja wchodzi na ekran: czytelnik widzi pustoszejący pierścień, nie od razu STALE
      const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { demoAt = Date.now(); put('#o-live', HQ.prov('live', demoAt, 30000, 'BTC')); io.disconnect(); } }, { threshold: 0.4 });
      io.observe($('.legend4'));
    }
  }

  /* ---------- Tabela zamiast obrazu ---------- */
  function setupTable(xs) {
    const btn = $('#xsec-tbtn'), box = $('#xsec-table');
    let timer = null;
    const render = () => {
      const rows = xs.rows(); const pl = HQ.lang === 'pl';
      box.innerHTML = `<table class="mini-table"><caption class="vh">${HQ.t('xsec.title')}</caption><thead><tr><th scope="col">${HQ.t('xsec.th.level')}</th><th scope="col" class="r">${HQ.t('xsec.th.book')}</th><th scope="col">${HQ.t('xsec.th.side')}</th><th scope="col" class="r">${HQ.t('xsec.th.liq')}</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row" class="num" style="font-weight:500;text-align:left;padding:6px">${HQ.fmt(r.p, 0)}</th><td class="r">${r.book ? HQ.fmtUsd(r.book) : HQ.DASH}</td><td>${r.side === 'ask' ? 'ASK' : r.side === 'bid' ? 'BID' : HQ.DASH}</td><td class="r">${r.liq ? HQ.fmtUsd(r.liq) + (r.liqSide === 'l' ? (pl ? ' · longi' : ' · longs') : (pl ? ' · shorty' : ' · shorts')) : HQ.DASH}</td></tr>`).join('')}</tbody></table>`;
    };
    btn.addEventListener('click', () => {
      const open = box.dataset.open !== 'true'; box.dataset.open = String(open); btn.setAttribute('aria-expanded', String(open));
      btn.textContent = HQ.t(open ? 'xsec.tablehide' : 'xsec.table'); btn.dataset.i18n = open ? 'xsec.tablehide' : 'xsec.table';
      clearInterval(timer); if (open) { render(); timer = setInterval(render, 5000); }
    });
  }

  /* ---------- Telefon: podgląd terminala ładowany przy zbliżeniu ---------- */
  function setupPhone() {
    const f = $('#phone-frame'); if (!f || innerWidth <= 760) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { f.src = f.dataset.src; io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(f);
  }

  /* ---------- Odkrywanie: wybór poziomu, warstwy, odczyt, przejście do terminalu ---------- */
  function setupExplore(xs) {
    const sl = $('#xs-lvl'), card = $('#xs-card'), open = $('#xs-open'); let touched = false;
    const sync = () => {
      const p0 = xs.center(); if (p0 == null) return;
      sl.min = String(p0 - HALF); sl.max = String(p0 + HALF); sl.disabled = false;
      if (!touched) sl.value = String(Math.round(S.price / STEP) * STEP);
      if (xs.sel != null) renderCard(xs);
    };
    const pick = (px, announce) => {
      touched = true; xs.sel = px; sl.value = String(px); xs.dirty = true; xs.kick(); renderCard(xs);
      open.href = HQ.momentUrl({ coin: 'BTC', px, bucket: STEP, win: 120000 }); open.removeAttribute('aria-disabled');
      if (announce) { const st = $('#st-land'); if (st) { st.textContent = ''; setTimeout(() => (st.textContent = card.innerText.split('\n')[0]), 60); } }
    };
    sl.addEventListener('input', () => pick(+sl.value, false));
    sl.addEventListener('change', () => pick(+sl.value, true));
    const toPx = (e) => { const r = xs.cv.getBoundingClientRect(); return xs.pxAtY(e.clientY - r.top); };
    xs.cv.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const px = toPx(e); if (px != null) { xs.hover = px; xs.dirty = true; xs.kick(); } });
    xs.cv.addEventListener('pointerleave', () => { xs.hover = null; xs.dirty = true; xs.kick(); });
    xs.cv.addEventListener('pointerdown', (e) => { const px = toPx(e); if (px != null) pick(px, true); });
    document.querySelectorAll('.tour [data-layer]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tour [data-layer]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      xs.layer = b.dataset.layer; xs.dirty = true; xs.kick();
      document.querySelectorAll('.howto li').forEach((li, i) => li.classList.toggle('on', (b.dataset.layer === 'water' && i === 0) || (b.dataset.layer === 'book' && i === 1) || (b.dataset.layer === 'liq' && i === 2)));
    }));
    open.addEventListener('click', (e) => { if (open.getAttribute('aria-disabled') === 'true') { e.preventDefault(); sl.focus(); } });
    setInterval(sync, 1000); setTimeout(sync, 1500);
    document.addEventListener('hq:lang', () => { if (xs.sel != null) renderCard(xs); });
  }
  function renderCard(xs) {
    const px = xs.sel; if (px == null || !S.price) return;
    const book = xs.book.get(px) || 0, side = xs.bookSide.get(px), lq = xs.liqL.get(px) || 0, sq = xs.liqS.get(px) || 0;
    const dist = (px / S.price - 1) * 100; const pl = HQ.lang === 'pl';
    const where = Math.abs(dist) < 0.05 ? HQ.t('demo.atPrice') : HQ.fill(HQ.t(dist > 0 ? 'demo.above' : 'demo.below'), { d: HQ.fmt(Math.abs(dist), 2) + (pl ? '\u00a0%' : '%') });
    const bookTxt = book ? HQ.fill(HQ.t('demo.book1'), { v: HQ.fmtUsd(book), s: side === 'ask' ? 'ASK' : 'BID' }) : HQ.t('demo.book0');
    const liqTxt = S.liq ? (lq || sq ? HQ.fill(HQ.t('demo.liq1'), { v: HQ.fmtUsd(Math.max(lq, sq)), w: HQ.t(lq >= sq ? 'demo.longs' : 'demo.shorts'), c: covPct(S.liq) }) : HQ.fill(HQ.t('demo.liq0'), { c: covPct(S.liq) })) : HQ.t('demo.liqNone');
    const card = $('#xs-card');
    card.innerHTML = `<p class="xc-h"><b class="num">${HQ.fmt(px, 0)}–${HQ.fmt(px + STEP - 1, 0)} USD</b> · ${where}</p><p>${bookTxt}</p><p>${liqTxt}</p><p class="xc-src"></p>`;
    const src = card.querySelector('.xc-src'); if (S.book) src.append(HQ.prov('live', S.bookAt, 10000, 'L2')); if (S.liq) src.append(HQ.prov('live', S.liq.asOf, 20 * 60000, covPct(S.liq) + ' OI'));
    const sl = $('#xs-lvl'); sl.setAttribute('aria-valuetext', `${HQ.fmt(px, 0)} USD, ${where}`);
  }
  // Powrót do terminalu z zachowanym kontekstem tej karty
  function setupReturn() {
    const chip = $('#ctxchip'); const c = HQ.ctxStore.read(); if (!chip || !c) return;
    if (c.px == null && !c.t && c.coin === 'BTC') return;
    const parts = [HQ.marketName(c.coin)]; if (c.px != null) parts.push(HQ.fmt(c.px, 0) + ' USD'); if (c.t) parts.push(HQ.time(c.t));
    chip.hidden = false; chip.innerHTML = `<span aria-hidden="true">↩</span> <span>${HQ.t('ctx.backDesk')}</span> <b>${parts.join(' · ')}</b>`; chip.setAttribute('aria-label', `${HQ.t('ctx.backDesk')}: ${parts.join(' · ')}`); chip.title = chip.getAttribute('aria-label');
  }

  /* ---------- Przekrój (canvas) ---------- */
  class XSec {
    constructor(cv, flow) {
      this.cv = cv; this.flow = flow; this.ctx = cv.getContext('2d'); this.fctx = flow.getContext('2d');
      this.book = new Map(); this.bookSide = new Map(); this.liqL = new Map(); this.liqS = new Map();
      this.cur = new Map(); this.maxB = 1; this.maxL = 1; this.p0 = null; this.dirty = true; this.visible = true; this.last = performance.now();
      this.sel = null; this.hover = null; this.layer = 'all'; this.geo = null;
      this.readColors();
      const ro = new ResizeObserver(() => this.resize()); ro.observe(cv); ro.observe(flow);
      new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; if (this.visible) this.kick(); }).observe(cv);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
      this.resize();
      setInterval(() => { if (this.visible && !document.hidden) this.drawFlow(); }, 1000);
    }
    readColors() { const e = this.cv; this.c = { ink1: css(e, '--ink-1'), ink2: css(e, '--ink-2'), ink3: css(e, '--ink-3'), line: css(e, '--line'), lineS: css(e, '--line-strong'), lume: css(e, '--lume'), onLume: css(e, '--on-lume'), buy: css(e, '--buy'), sell: css(e, '--sell'), buyInk: css(e, '--buy-ink'), sellInk: css(e, '--sell-ink'), s1: css(e, '--s1'), s2: css(e, '--s2') }; }
    resize() {
      const dpr = Math.min(2, devicePixelRatio || 1);
      for (const [cv, ctx] of [[this.cv, this.ctx], [this.flow, this.fctx]]) { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
      this.W = this.cv.getBoundingClientRect().width; this.H = this.cv.getBoundingClientRect().height;
      this.dirty = true; this.kick(); this.drawFlow();
    }
    setBook(b) {
      this.book.clear(); this.bookSide.clear();
      b.bids.forEach((x) => { this.book.set(x.px, x.px * x.sz); this.bookSide.set(x.px, 'bid'); });
      b.asks.forEach((x) => { this.book.set(x.px, x.px * x.sz); this.bookSide.set(x.px, 'ask'); });
      this.dirty = true; this.kick();
    }
    setLiq(d) { this.liqL = bucketsOf(d.longs); this.liqS = bucketsOf(d.shorts); this.dirty = true; this.kick(); }
    center() {
      const p = S.price; if (!p) return null;
      // Środek przesuwa się dopiero, gdy cena odejdzie o 600 USD: przez większość czasu porusza się linia wody, nie cały obraz
      if (this.p0 == null || Math.abs(p - this.p0) > 600) this.p0 = Math.round(p / STEP) * STEP;
      return this.p0;
    }
    pxAtY(y) { const g = this.geo; if (!g) return null; const i = Math.round((y - g.padT) / g.rowH - 0.5); const p = g.p0 + HALF - i * STEP; return p < g.p0 - HALF || p > g.p0 + HALF ? null : p; }
    rows() {
      const p0 = this.center(); if (p0 == null) return [];
      const out = [];
      for (let b = p0 + HALF; b >= p0 - HALF; b -= STEP) {
        const liqL = this.liqL.get(b) || 0, liqS = this.liqS.get(b) || 0;
        out.push({ p: b, book: this.book.get(b) || 0, side: this.bookSide.get(b) || null, liq: liqL || liqS, liqSide: liqL >= liqS ? 'l' : 's' });
      }
      return out.filter((r) => r.book || r.liq).sort((a, b) => b.book + b.liq - (a.book + a.liq)).slice(0, 12).sort((a, b) => b.p - a.p);
    }
    kick() { if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t)); }
    frame(t) {
      this.raf = null; const dt = Math.min(64, t - this.last); this.last = t;
      if (!this.visible || document.hidden) return;
      const moving = this.draw(dt);
      if (moving || this.dirty) { this.dirty = false; this.kick(); }
    }
    draw(dt) {
      const { ctx, W, H, c } = this; if (!W) return false;
      ctx.clearRect(0, 0, W, H);
      const p0 = this.center();
      if (p0 == null) { ctx.fillStyle = c.ink3; ctx.font = '500 13px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(HQ.t('xsec.wait'), W / 2, H / 2); return false; }
      const padT = 30, padB = 44, N = (2 * HALF) / STEP + 1, rowH = (H - padT - padB) / N;
      const spine = W < 520 ? 64 : 82, cx = W / 2, gap = 6;
      const areaW = cx - spine / 2 - gap - 10;
      const yOf = (p) => padT + ((p0 + HALF - p) / STEP + 0.5) * rowH;
      this.geo = { padT, rowH, p0 };
      const aB = this.layer === 'all' || this.layer === 'book' ? 1 : 0.18, aL = this.layer === 'all' || this.layer === 'liq' ? 1 : 0.18;
      // Wybrany i wskazany poziom: pas na całej szerokości (rysowany pod słupkami)
      [[this.hover, 0.06], [this.sel, 0.14]].forEach(([p, a]) => { if (p == null || p < p0 - HALF || p > p0 + HALF) return; const y = yOf(p) - rowH / 2; ctx.fillStyle = c.lume; ctx.globalAlpha = a; ctx.fillRect(0, y, W, rowH); ctx.globalAlpha = 1; if (p === this.sel) { ctx.strokeStyle = c.ink1; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.strokeRect(0.5, Math.round(y) + 0.5, W - 1, Math.max(1, rowH - 1)); ctx.globalAlpha = 1; } });
      // Skale: każda strona osobno, z łagodnym zanikiem maksimum (bez skoków skali)
      let mb = 1, ml = 1;
      for (let b = p0 - HALF; b <= p0 + HALF; b += STEP) { mb = Math.max(mb, this.book.get(b) || 0); ml = Math.max(ml, this.liqL.get(b) || 0, this.liqS.get(b) || 0); }
      this.maxB = Math.max(mb, this.maxB * 0.995); this.maxL = Math.max(ml, this.maxL * 0.995);
      const k = HQ.reduced() ? 1 : 1 - Math.exp(-dt / 90);
      let moving = false;
      const ease = (key, target) => { const v = this.cur.has(key) ? this.cur.get(key) : 0; const nv = v + (target - v) * k; if (Math.abs(nv - target) > 0.4) moving = true; this.cur.set(key, Math.abs(nv - target) > 0.4 ? nv : target); return this.cur.get(key); };
      // Siatka co 500 USD
      ctx.font = '500 10.5px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let b = p0 - HALF; b <= p0 + HALF; b += STEP) {
        const y = yOf(b);
        if (b % 500 === 0) { ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, Math.round(y) + 0.5); ctx.lineTo(cx - spine / 2 - 2, Math.round(y) + 0.5); ctx.moveTo(cx + spine / 2 + 2, Math.round(y) + 0.5); ctx.lineTo(W - 8, Math.round(y) + 0.5); ctx.stroke(); ctx.fillStyle = c.ink3; ctx.fillText(HQ.fmt(b, 0), cx, y); }
      }
      const bh = Math.max(2, rowH - 3);
      for (let b = p0 - HALF; b <= p0 + HALF; b += STEP) {
        const y = yOf(b) - bh / 2;
        // Księga: w prawo od osi; strona z danych (BID / ASK), nie z położenia
        const bv = this.book.get(b) || 0; const side = this.bookSide.get(b);
        const lb = ease('b' + b, (bv / this.maxB) * areaW);
        if (lb > 0.5) { ctx.fillStyle = side === 'ask' ? c.sell : c.buy; ctx.globalAlpha = 0.88 * aB; ctx.fillRect(cx + spine / 2 + gap, y, lb, bh); ctx.globalAlpha = 1; }
        // Likwidacje: w lewo od osi; kontur + jasne wypełnienie (drugi kanał: kształt)
        const lv = this.liqL.get(b) || 0, sv = this.liqS.get(b) || 0;
        const ll = ease('l' + b, (Math.max(lv, sv) / this.maxL) * areaW);
        if (ll > 0.5) { const col = lv >= sv ? c.sellInk : c.buyInk; ctx.fillStyle = col; ctx.globalAlpha = 0.2 * aL; ctx.fillRect(cx - spine / 2 - gap - ll, y, ll, bh); ctx.globalAlpha = aL; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(cx - spine / 2 - gap - ll + 0.5, y + 0.5, Math.max(0, ll - 1), Math.max(0, bh - 1)); ctx.globalAlpha = 1; }
      }
      // Linia wody: bieżąca cena (ostatnia transakcja)
      const yp = yOf(S.price);
      ctx.strokeStyle = c.lume; ctx.lineWidth = this.layer === 'water' ? 3 : 1.5; ctx.beginPath(); ctx.moveTo(0, yp); ctx.lineTo(W, yp); ctx.stroke();
      const txt = HQ.fmt(S.price, 0); ctx.font = '700 11.5px "JetBrains Mono", monospace'; const tw = ctx.measureText(txt).width + 16;
      ctx.fillStyle = c.lume; roundRect(ctx, cx - tw / 2, yp - 10, tw, 20, 10); ctx.fill(); ctx.fillStyle = c.onLume; ctx.fillText(txt, cx, yp + 0.5);
      // Podpisy stron
      ctx.font = '700 10px "Plus Jakarta Sans", sans-serif'; ctx.fillStyle = c.ink2; ctx.textAlign = 'left';
      ctx.fillText(HQ.t('xsec.shorts').toUpperCase() + ' ▲', 10, padT - 14); ctx.fillText(HQ.t('xsec.longs').toUpperCase() + ' ▼', 10, H - padB + 16);
      ctx.textAlign = 'right'; ctx.fillText('▲ ' + HQ.t('xsec.ask'), W - 10, padT - 14); ctx.fillText('▼ ' + HQ.t('xsec.bid'), W - 10, H - padB + 16);
      // Skale
      ctx.font = '500 10px "JetBrains Mono", monospace'; ctx.fillStyle = c.ink3; ctx.textAlign = 'left';
      ctx.fillText(`${HQ.t('xsec.scale')} ${HQ.fmtUsdShort(this.maxL)} USD`, 10, H - 9);
      ctx.textAlign = 'right'; ctx.fillText(`${HQ.t('xsec.scale')} ${HQ.fmtUsdShort(this.maxB)} USD`, W - 10, H - 9);
      return moving;
    }
    drawFlow() {
      const ctx = this.fctx; const r = this.flow.getBoundingClientRect(); const W = r.width, H = r.height; if (!W) return;
      ctx.clearRect(0, 0, W, H);
      const now = Date.now(); const B = 36, span = 5000; const start = Math.floor(now / span) * span - (B - 1) * span;
      const buy = new Array(B).fill(0), sell = new Array(B).fill(0);
      S.trades.forEach((t) => { const i = Math.floor((t.t - start) / span); if (i >= 0 && i < B) (t.side === 'buy' ? buy : sell)[i] += t.px * t.sz; });
      const m = Math.max(1, ...buy, ...sell); this.maxF = Math.max(m, (this.maxF || 1) * 0.97);
      const mid = H / 2, bw = W / B; const c = this.c;
      ctx.strokeStyle = c.lineS; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(W, mid + 0.5); ctx.stroke();
      for (let i = 0; i < B; i++) {
        const a = i === B - 1 ? 0.55 : 0.9; const hb = (buy[i] / this.maxF) * (mid - 3), hs = (sell[i] / this.maxF) * (mid - 3);
        ctx.globalAlpha = a; ctx.fillStyle = c.buy; ctx.fillRect(i * bw + 1, mid - hb, bw - 2, hb); ctx.fillStyle = c.sell; ctx.fillRect(i * bw + 1, mid + 1, bw - 2, hs);
      }
      ctx.globalAlpha = 1;
    }
    updateAria() {
      const p0 = this.center(); if (p0 == null) return;
      const pick = (map, f) => { let bp = null, bv = 0; map.forEach((v, p) => { if (p >= p0 - HALF && p <= p0 + HALF && f(p) && v > bv) { bv = v; bp = p; } }); return [bp, bv]; };
      const [lb, lbv] = pick(this.liqL, (p) => p <= S.price); const [la, lav] = pick(this.liqS, (p) => p >= S.price);
      const bids = new Map(), asks = new Map(); this.book.forEach((v, p) => (this.bookSide.get(p) === 'bid' ? bids : asks).set(p, v));
      const [bb, bbv] = pick(bids, () => true); const [ba, bav] = pick(asks, () => true);
      const f = (p) => (p ? HQ.fmt(p, 0) + ' USD' : HQ.DASH); const u = (v) => (v ? HQ.fmtUsd(v) : HQ.DASH);
      this.cv.setAttribute('aria-label', HQ.fill(HQ.t('xsec.aria'), { px: HQ.fmt(S.price, 0), lb: f(lb), lbv: u(lbv), la: f(la), lav: u(lav), bb: f(bb), bbv: u(bbv), ba: f(ba), bav: u(bav) }));
    }
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
})();


window.HQ.ready(() => {
  const tour = document.querySelector('.event-tour');
  if (!tour) return;
  const steps = [...tour.querySelectorAll('[data-event-step]')];
  const select = (index) => steps.forEach((button, i) => {
    button.setAttribute('aria-pressed', String(i === index));
    document.getElementById(button.getAttribute('aria-controls')).hidden = i !== index;
  });
  steps.forEach((button, index) => {
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (e) => {
      const offset = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!offset) return;
      e.preventDefault();
      steps[(index + offset + steps.length) % steps.length].focus();
    });
  });
  const updateLink = () => {
    const link = document.getElementById('event-open');
    const url = new URL(link.href);
    url.searchParams.set('lang', window.HQ.lang);
    link.href = url.href;
  };
  updateLink();
  document.addEventListener('hq:lang', updateLink);
});
