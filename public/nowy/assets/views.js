/* Widoki aplikacji „Przekrój”: trasy, Dziś, Przed sesją, Po sesji, Ustawienia, arkusz „Więcej”.
   Dane: Hyperliquid (publiczne API) i publiczne pliki skanera HyperQuant. Każda liczba z pieczęcią, brak = „—” z przyczyną. */
(function () {
  'use strict';
  const HQ = window.HQ;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ROUTES = ['dzis', 'przed', 'sesja', 'po', 'ustawienia', 'flow', 'rynki'];
  const LABEL = { dzis: 'd.today', przed: 'v.przed.h', sesja: 'd.in', po: 'v.po.h', ustawienia: 'd.settings', flow: 'd.flow', rynki: 'd.markets' };
  const MARKETS = [
    { coin: 'BTC', name: { pl: 'Bitcoin', en: 'Bitcoin' }, cls: 'v.mc.crypto', dec: 0 },
    { coin: 'xyz:GOLD', name: { pl: 'Złoto', en: 'Gold' }, cls: 'v.mc.commodity', dec: 1 },
    { coin: 'xyz:SP500', name: { pl: 'S&P 500', en: 'S&P 500' }, cls: 'v.mc.index', dec: 1 },
  ];
  const C = {}; // pamięć odczytów: { klucz: { v, at } }
  let route = null;
  let prevVisit = null; let visitSaved = false;
  try { prevVisit = JSON.parse(localStorage.getItem('hqp.visit') || 'null'); } catch (e) { prevVisit = null; }

  /* ---------- Trasy ---------- */
  const fromHash = () => { const h = HQ.hashRoute(); return ROUTES.includes(h) ? h : 'sesja'; };
  let sessionSeen = false;
  HQ.go = (r, focusMain) => { if (!ROUTES.includes(r)) r = 'sesja'; if (HQ.hashRoute() !== r) history.pushState(null, '', '#' + r); show(r, focusMain, true); };

  function show(r, focusMain, user) {
    const prev = route; route = r;
    $('.desk').dataset.view = r;
    const DAY = ['przed', 'sesja', 'po'];
    const dir = prev && DAY.includes(prev) && DAY.includes(r) && prev !== r ? (DAY.indexOf(r) > DAY.indexOf(prev) ? 'r' : 'l') : '';
    $$('.view').forEach((v) => {
      const on = v.dataset.view === r; v.dataset.on = String(on);
      // Wejście widoku: między fazami dnia z kierunku osi dnia (Przed ← W sesji → Po), poza nimi krycie + 6 px; ograniczony ruch: bez przejścia
      v.classList.remove('view-enter', 'view-enter-l', 'view-enter-r');
      if (on && user && prev && prev !== r && !HQ.reduced()) { void v.offsetWidth; v.classList.add(dir ? 'view-enter-' + dir : 'view-enter'); }
      if (on && user && prev !== r) { const vh = v.querySelector('.vhead'); if (vh) { let sw = vh.querySelector('.vsweep'); if (!sw) { sw = document.createElement('i'); sw.className = 'vsweep'; sw.setAttribute('aria-hidden', 'true'); vh.prepend(sw); } HQ.sweep(sw); } }
    });
    if (r === 'sesja') sessionSeen = true;
    $$('.rail a[data-route]').forEach((a) => { if (a.dataset.route === r && !a.dataset.alias) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('.bnav a[data-route]').forEach((a) => {
      const on = a.hasAttribute('data-more') ? r === 'ustawienia' : (a.dataset.group || a.dataset.route).split(' ').includes(r);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderPhaseSegs();
    document.title = `${HQ.simState ? `[SIM: ${HQ.simState}] ` : ''}HyperQuant · ${HQ.t(LABEL[r])}`;
    const v = $('#v-' + r);
    if (v && v.classList.contains('page')) v.scrollTop = 0;
    if (user && window.scrollY > 0) window.scrollTo(0, 0);
    if (user) {
      // Trwała nawigacja (szyna, dolny pasek) zatrzymuje fokus i ogłasza widok; element, który znika, oddaje fokus nagłówkowi widoku
      if (focusMain) { const h = v && v.querySelector('h1'); if (h) h.focus({ preventScroll: true }); }
      else if (HQ.session) HQ.session.say(`${HQ.t('v.now')}: ${HQ.t(LABEL[r])}`);
    }
    load(r);
    if (r === 'sesja' && HQ.session) HQ.session.renderAll();
    renderCtxChip();
  }

  /* ---------- Nić kontekstu: chip „Wróć do sesji” w nagłówku i karta „Kontynuuj” na Dziś ---------- */
  function ctxLabel() {
    const c = HQ.sessionCtx ? HQ.sessionCtx() : null; if (!c) return null;
    const parts = [HQ.marketName(c.coin)];
    if (c.px != null) parts.push((c.bucket > 1 ? `${HQ.fmt(c.px, 0)}–${HQ.fmt(c.px + c.bucket - 1, 0)}` : HQ.fmt(c.px, HQ.session ? HQ.session.D.dec : 0)) + ' USD');
    parts.push(c.live ? HQ.t('ctx.live') : `${HQ.t('prov.rec')} ${HQ.time(c.cursor)}`);
    return { text: parts.join(' · '), meaningful: c.px != null || !c.live || c.coin !== 'BTC' };
  }
  function renderCtxChip() {
    const chip = $('#ctxchip'); if (!chip) return; const l = ctxLabel();
    // Kontekst zapisany w tej karcie (np. po przeładowaniu) liczy się jak odwiedzona sesja: powrót działa też po odświeżeniu strony
    const seen = sessionSeen || !!(HQ.ctxStore && HQ.ctxStore.read());
    const show = route !== 'sesja' && seen && l;
    chip.hidden = !show;
    // Telefon: zamiast plakietki w nagłówku znak kontekstu na zakładce „Sesja” (dolny pasek)
    document.querySelectorAll('.bnav a[href="#sesja"]').forEach((a) => { a.toggleAttribute('data-ctx', !!show); if (show) a.setAttribute('aria-label', `${a.textContent.trim()}: ${HQ.t('ctx.back')} · ${l.text}`); else a.removeAttribute('aria-label'); });
    if (show) { chip.innerHTML = `<span aria-hidden="true">↩</span> <span>${HQ.t('ctx.back')}</span> <b>${l.text}</b>`; chip.setAttribute('aria-label', `${HQ.t('ctx.back')}: ${l.text}`); }
    const res = $('#dz-resume');
    if (res) { const m = l && l.meaningful && seen; res.hidden = !m; if (m) res.innerHTML = `<div><p class="eyebrow">${HQ.t('ctx.resumeEyebrow')}</p><b>${l.text}</b></div><a class="btn btn-lume btn-s" href="#sesja" data-ctx-back>${HQ.t('ctx.resume')} <span aria-hidden="true">→</span></a>`; }
  }
  function backToSession() { HQ.go('sesja', false); setTimeout(() => { if (!(HQ.session && HQ.session.focusSelection())) { const h = $('#h-sesja'); if (h) h.focus(); } }, 30); }
  document.addEventListener('hq:ctx', renderCtxChip);

  function renderPhaseSegs() {
    const names = { przed: 'd.before', sesja: 'd.in', po: 'd.after' };
    $$('[data-phase-seg]').forEach((el) => {
      el.setAttribute('aria-label', HQ.t('v.phaseLabel'));
      el.innerHTML = Object.keys(names).map((x) => `<a href="#${x}" data-route="${x}"${x === route ? ' aria-current="page"' : ''}>${HQ.t(names[x])}</a>`).join('');
    });
  }

  document.addEventListener('click', (e) => {
    const cb = e.target.closest('#ctxchip, [data-ctx-back]');
    if (cb && e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); backToSession(); return; }
    const rt = e.target.closest('[data-retry]');
    if (rt) { e.preventDefault(); (rt.dataset.retry || '').split(' ').forEach((k) => delete C[k]); HQ.session && HQ.session.say(HQ.t('retry.say')); load(route); return; }
    if (e.target.closest('.sheet [data-open-wn]')) { closeSheet(false); return; }
    const om = e.target.closest('[data-open-market]');
    if (om) { e.preventDefault(); const coin = om.dataset.openMarket; if (HQ.session && HQ.session.D.coin !== coin) HQ.session.switchMarket(coin); HQ.go('sesja', true); return; }
    const a = e.target.closest('a[data-route]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (a.hasAttribute('data-more')) { openSheet(a); return; }
    const persistent = !!a.closest('.rail, .bnav');
    if (a.closest('.sheet')) closeSheet(false);
    HQ.go(a.dataset.route, !persistent);
  });
  window.addEventListener('popstate', () => { const r = fromHash(); if (r !== route) show(r, false, false); });
  window.addEventListener('hashchange', () => { const r = fromHash(); if (r !== route) show(r, false, false); });

  /* ---------- Arkusz „Więcej” (telefon) ---------- */
  let sheetOpener = null;
  function openSheet(from) {
    sheetOpener = from; const sh = $('#more-sheet');
    sh.hidden = false; $('#sheet-back').dataset.open = 'true';
    sh.classList.remove('enter'); if (!HQ.reduced()) { void sh.offsetWidth; sh.classList.add('enter'); }
    from.setAttribute('aria-expanded', 'true');
    sh.querySelector('a, button').focus();
  }
  function closeSheet(refocus = true) {
    const sh = $('#more-sheet'); if (sh.hidden) return;
    sh.hidden = true; $('#sheet-back').dataset.open = 'false';
    if (sheetOpener) { sheetOpener.setAttribute('aria-expanded', 'false'); if (refocus) sheetOpener.focus(); }
  }
  document.addEventListener('keydown', (e) => {
    const sh = $('#more-sheet'); if (!sh || sh.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key === 'Tab') {
      const f = $$('a, button', sh); const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  /* ---------- Odczyty z pamięcią ---------- */
  async function get(k, ms, fn) {
    if (C[k] && Date.now() - C[k].at < ms) return C[k].v;
    try { const v = await fn(); C[k] = { v, at: Date.now() }; return v; } catch (e) { if (C[k]) return C[k].v; throw e; }
  }
  const d0 = () => Math.floor(Date.now() / 864e5) * 864e5;
  const ctxMain = () => get('ctxMain', 55000, () => HQ.info({ type: 'metaAndAssetCtxs' }));
  const ctxXyz = () => get('ctxXyz', 55000, () => HQ.info({ type: 'metaAndAssetCtxs', dex: 'xyz' }));
  const c1d = () => get('c1d', 300000, () => HQ.info({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1d', startTime: Date.now() - 4 * 864e5, endTime: Date.now() } }));
  const c1m = () => get('c1m', 60000, () => HQ.info({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: d0(), endTime: Date.now() } }));
  const liq = () => get('liq', 300000, () => HQ.published('liq-map/BTC.json'));
  const entry = () => get('entry', 300000, () => HQ.published('entry-map/BTC.json'));
  const ledger = () => get('ledger', 600000, () => HQ.published('ledger/BTC/summary.json'));
  const at = (k) => (C[k] ? C[k].at : null);
  function ctxOf(res, coin) {
    if (!res) return null; const [meta, ctxs] = res; const short = coin.includes(':') ? coin.split(':')[1] : coin;
    const i = meta.universe.findIndex((u) => u.name === coin || u.name === short);
    if (i < 0) return null; const c = ctxs[i]; const mark = +c.markPx, prev = +c.prevDayPx;
    return { mark, prev, chg: prev ? (mark / prev - 1) * 100 : null, fundingApr: +c.funding * 24 * 365 * 100, oiUsd: +c.openInterest * mark, vlm: +c.dayNtlVlm };
  }
  function lastPx() {
    const D = HQ.session && HQ.session.D;
    if (D && D.coin === 'BTC' && D.trades.length) return { px: D.trades[D.trades.length - 1].px, at: D.lastTradeAt, src: 'trade' };
    const c = C.ctxMain && ctxOf(C.ctxMain.v, 'BTC'); return c ? { px: c.mark, at: C.ctxMain.at, src: 'mark' } : null;
  }
  const settled = (r) => (r.status === 'fulfilled' ? r.value : null);
  const why = (r) => (r.status === 'rejected' ? String((r.reason && r.reason.message) || r.reason) : '');

  function load(r) {
    if (r === 'dzis') loadDzis(); else if (r === 'przed') loadPrzed(); else if (r === 'po') loadPo(); else if (r === 'ustawienia') renderSettings();
  }

  /* ---------- Linia doby ---------- */
  function dayline(track, ticks, nowEl) {
    const now = Date.now(); const s = HQ.sessions(now);
    track.innerHTML = '';
    s.list.forEach((x) => { const b = document.createElement('div'); b.className = 'band' + (x === s.cur ? ' now' : ''); b.dataset.s = x.id; b.style.left = ((x.from - s.d0) / 864e5) * 100 + '%'; b.style.width = ((x.to - x.from) / 864e5) * 100 + '%'; b.textContent = HQ.t('s.' + x.id); track.append(b); });
    ticks.innerHTML = ''; const step = innerWidth < 700 ? 6 : 3;
    for (let h = 0; h <= 24; h += step) { const sp = document.createElement('span'); sp.style.left = (h / 24) * 100 + '%'; sp.textContent = HQ.time(s.d0 + h * 36e5, false); if (h === 0) sp.style.transform = 'none'; if (h === 24) sp.style.transform = 'translateX(-100%)'; ticks.append(sp); }
    nowEl.style.left = s.frac * 100 + '%';
    const l = nowEl.querySelector('.lbl'); l.textContent = `${HQ.t('now')} ${HQ.time(now, false)}`;
    l.style.transform = s.frac > 0.86 ? 'translateX(calc(-100% + 6px))' : s.frac < 0.14 ? 'translateX(-6px)' : 'translateX(-50%)';
    return s;
  }
  const phaseName = () => HQ.t({ before: 'v.phase.before', in: 'v.phase.in', after: 'v.phase.after' }[HQ.phase()]);

  /* ---------- Dziś ---------- */
  async function loadDzis() {
    const now = Date.now();
    $('#dzis-date').textContent = new Intl.DateTimeFormat(HQ.lang === 'pl' ? 'pl-PL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    const s = dayline($('#dz-track'), $('#dz-ticks'), $('#dz-now'));
    $('#dzis-now').textContent = HQ.fill(HQ.t('v.dzis.now'), { phase: phaseName(), s: HQ.t('s.' + s.cur.id), left: HQ.span(s.cur.to - now) });
    const ph = HQ.phase(); const map = { przed: 'before', sesja: 'in', po: 'after' };
    $('#tiles').innerHTML = ['przed', 'sesja', 'po'].map((x) => `<a class="tile" href="#${x}" data-route="${x}" data-now="${map[x] === ph}">${map[x] === ph ? `<span class="nowtag">${HQ.t('now')}</span>` : ''}<b>${HQ.t({ przed: 'v.phase.before', sesja: 'v.phase.in', po: 'v.phase.after' }[x])}</b><span>${HQ.t('v.tile.' + x)}</span></a>`).join('');
    if (!$('#mcards').children.length) $('#mcards').innerHTML = MARKETS.map((m) => cardHTML(m, null, HQ.t('d.st.short.connecting'))).join('');
    const [m, x] = await Promise.allSettled([ctxMain(), ctxXyz()]);
    const res = { BTC: [settled(m), at('ctxMain'), why(m)], 'xyz:GOLD': [settled(x), at('ctxXyz'), why(x)], 'xyz:SP500': [settled(x), at('ctxXyz'), why(x)] };
    $('#mcards').innerHTML = MARKETS.map((mk) => { const [r, t, w] = res[mk.coin]; const c = ctxOf(r, mk.coin); return cardHTML(mk, c ? { ...c, at: t } : null, w || HQ.t('d.st.short.connecting')); }).join('');
    $$('#mcards [data-prov]').forEach((el) => { const [k, t] = el.dataset.prov.split('|'); el.replaceWith(HQ.prov(k, +t || null, 90000)); });
    // Zapis cen tej wizyty (raz na wejście), do porównania przy następnej
    if (!visitSaved && MARKETS.every((mk) => ctxOf(res[mk.coin][0], mk.coin))) {
      const v = {}; MARKETS.forEach((mk) => { v[mk.coin] = { px: ctxOf(res[mk.coin][0], mk.coin).mark, at: Date.now() }; });
      try { localStorage.setItem('hqp.visit', JSON.stringify(v)); visitSaved = true; } catch (e) { /* pamięć zablokowana */ }
    }
  }
  function cardHTML(mk, c, reason) {
    const nm = mk.name[HQ.lang] || mk.name.pl; const id = 'mc-' + mk.coin.replace(/\W/g, '');
    if (!c) return `<article class="mcard" aria-labelledby="${id}"><div class="top"><span class="nm" id="${id}">${nm}</span><span class="cls">${HQ.t(mk.cls)}</span></div><span class="pxv num">${HQ.DASH}</span><p class="since">${HQ.fill(HQ.t('v.mc.nodata'), { why: reason })}</p>${reason && reason !== HQ.t('d.st.short.connecting') ? `<button type="button" class="btn btn-line btn-s" data-retry="ctxMain ctxXyz">${HQ.t('retry')}</button>` : ''}</article>`;
    const pv = prevVisit && prevVisit[mk.coin];
    const since = pv && pv.px ? HQ.fill(HQ.t('v.mc.since'), { t: `${HQ.date(pv.at)} ${HQ.time(pv.at, false)}`, chg: HQ.fmtPct((c.mark / pv.px - 1) * 100, 2) }) : HQ.t('v.mc.first');
    const cl = c.chg > 0 ? 'buy' : c.chg < 0 ? 'sell' : 'muted';
    return `<article class="mcard" aria-labelledby="${id}">
      <div class="top"><span class="nm" id="${id}">${nm}</span><span class="cls">${HQ.t(mk.cls)}</span><span style="margin-left:auto"><span data-prov="live|${c.at}"></span></span></div>
      <div><span class="pxv num">${HQ.fmt(c.mark, mk.dec)}</span> <span class="num ${cl}" style="font-size:13px">${HQ.fmtPct(c.chg, 2)} · 24 h</span></div>
      <p class="since" title="${HQ.t('v.mc.local')}">${since}</p>
      <dl><div><dt>${HQ.t('d.funding')}</dt><dd>${HQ.fmtPct(c.fundingApr, 1)}</dd></div><div><dt>${HQ.t('d.oi')}</dt><dd>${HQ.fmtUsdShort(c.oiUsd)}</dd></div><div><dt>${HQ.t('d.vol')}</dt><dd>${HQ.fmtUsdShort(c.vlm)}</dd></div></dl>
      <a class="btn btn-line btn-s" href="#sesja" data-open-market="${mk.coin}">${HQ.t('v.mc.open')} <span aria-hidden="true">→</span></a>
    </article>`;
  }

  /* ---------- Przed sesją ---------- */
  const STEP = 100;
  function buckets(arr, step = STEP) { const m = new Map(); (arr || []).forEach((x) => { const b = Math.round(x.px / step) * step; m.set(b, (m.get(b) || 0) + x.ntlUsd); }); return m; }
  function wMedian(arr, lo, hi) { const xs = (arr || []).filter((x) => x.px >= lo && x.px <= hi).sort((a, b) => a.px - b.px); const tot = xs.reduce((s, x) => s + x.ntlUsd, 0); if (!tot) return null; let acc = 0; for (const x of xs) { acc += x.ntlUsd; if (acc >= tot / 2) return x.px; } return null; }
  async function loadPrzed() {
    const [rd, rm, rl, re, rg] = await Promise.allSettled([c1d(), c1m(), liq(), entry(), ledger()]);
    if (!C.ctxMain) { try { await ctxMain(); } catch (e) { /* bez ceny znacznikowej */ } }
    const D1 = settled(rd), M1 = settled(rm), L = settled(rl), E = settled(re), G = settled(rg);
    const P = lastPx();
    const rows = [];
    const day = d0();
    const prev = D1 && D1.find((c) => c.t === day - 864e5); const today = D1 && D1.find((c) => c.t === day);
    const ld = (k, px, kind, t, lim, extra, touch) => { if (px != null && isFinite(px)) rows.push({ k, px: +px, kind, t, lim, extra, touch }); };
    const tp = G && G.latest && G.latest.touch ? G.latest.touch.p : null;
    if (prev) { ld('lv.pdh', prev.h, 'live', at('c1d'), 6 * 36e5, '1d', tp && tp.pdh); ld('lv.pdl', prev.l, 'live', at('c1d'), 6 * 36e5, '1d', tp && tp.pdl); }
    if (today) { ld('lv.open', today.o, 'live', at('c1d'), 6 * 36e5, '1d'); ld('lv.hi', today.h, 'live', at('c1d'), 6 * 36e5, '1d'); ld('lv.lo', today.l, 'live', at('c1d'), 6 * 36e5, '1d'); }
    if (M1 && M1.length) { let pv = 0, vv = 0; M1.forEach((c) => { const v = +c.v; pv += ((+c.h + +c.l + +c.c) / 3) * v; vv += v; }); if (vv) ld('lv.vwap', pv / vv, 'live', at('c1m'), 5 * 6e4, '1m'); }
    if (G && G.latest && G.latest.touch && G.latest.touch.lv) ld('lv.deq', G.latest.touch.lv.deq, 'model', G.asOf, 36e5, 'HAR', tp && tp.deq);
    if (L && P) {
      const lb = buckets(L.longs), sb = buckets(L.shorts); let bp = null, bv = 0, ap = null, av = 0;
      lb.forEach((v, p) => { if (p < P.px && p > P.px * 0.94 && v > bv) { bv = v; bp = p; } });
      sb.forEach((v, p) => { if (p > P.px && p < P.px * 1.06 && v > av) { av = v; ap = p; } });
      ld('lv.liqB', bp, 'live', L.asOf, 20 * 6e4, HQ.fmtUsdShort(bv)); ld('lv.liqA', ap, 'live', L.asOf, 20 * 6e4, HQ.fmtUsdShort(av));
    }
    if (E) { const m = E.markPx; ld('lv.entL', wMedian(E.longs, m * 0.85, m * 1.15), 'model', E.asOf, 20 * 6e4, 'med.'); ld('lv.entS', wMedian(E.shorts, m * 0.85, m * 1.15), 'model', E.asOf, 20 * 6e4, 'med.'); }
    const tb = $('#lvtable tbody');
    if (!P) { const w = why(rd) || why(rl) || HQ.t('d.st.short.connecting'); tb.innerHTML = `<tr><td colspan="4" class="muted" style="white-space:normal">${HQ.DASH} ${w} <button type="button" class="btn btn-line btn-s" data-retry="ctxMain c1d c1m liq entry ledger">${HQ.t('retry')}</button></td></tr>`; }
    else {
      rows.push({ k: 'lv.price', px: P.px, kind: 'live', t: P.at, lim: 15000, extra: P.src === 'trade' ? HQ.t('d.tape').toLowerCase() : 'mark', wl: true });
      rows.sort((a, b) => b.px - a.px);
      tb.innerHTML = rows.map((r, i) => `<tr${r.wl ? ' class="wlrow"' : ''}><th scope="row" class="name">${HQ.t(r.k)}<span class="psrc"><span data-row="${i}"></span></span></th><td class="r">${HQ.fmt(r.px, 0)}</td><td class="r">${r.wl ? HQ.DASH : HQ.fmtPct((r.px / P.px - 1) * 100, 2)}</td><td class="r">${r.touch != null ? HQ.fmt(r.touch * 100, 1) + (HQ.lang === 'pl' ? ' %' : '%') : HQ.DASH}</td></tr>`).join('');
      rows.forEach((r, i) => { const el = tb.querySelector(`[data-row="${i}"]`); if (el) el.replaceWith(HQ.prov(r.kind, r.t, r.lim, r.extra)); });
    }
    const lp = $('#lv-provs'); lp.innerHTML = ''; if (tp) lp.append(HQ.prov('model', null, 0, HQ.t('v.przed.th.touch')));
    // Paliwo
    const fp = $('#fuel-prov'); fp.innerHTML = '';
    if (L) {
      fp.append(HQ.prov('live', L.asOf, 20 * 6e4, (L.coverage && L.coverage.oiBtc ? HQ.fmt((L.coverage.scannedBtc / (2 * L.coverage.oiBtc)) * 100, 1) + '% OI' : '')));
      const m = L.markPx; const sum = (arr, lo, hi) => (arr || []).reduce((s, x) => (x.px >= lo && x.px <= hi ? s + x.ntlUsd : s), 0);
      const kv = [['fuel.b1', sum(L.longs, m * 0.99, m), 'fuel.longs'], ['fuel.a1', sum(L.shorts, m, m * 1.01), 'fuel.shorts'], ['fuel.b3', sum(L.longs, m * 0.97, m), 'fuel.longs'], ['fuel.a3', sum(L.shorts, m, m * 1.03), 'fuel.shorts']];
      $('#fuel').innerHTML = kv.map(([k, v, s]) => `<dt>${HQ.t(k)}</dt><dd>${HQ.fmtUsd(v)}<small>${HQ.t(s)}</small></dd>`).join('');
      $('#fuel-profile').innerHTML = profileSVG(L, 3);
      $('#fuel-profile').setAttribute('aria-label', `${HQ.t('v.przed.fuel')} ±3%: ${kv.map(([k, v]) => `${HQ.t(k)} ${HQ.fmtUsd(v)}`).join('; ')}`);
    } else { $('#fuel').innerHTML = `<dt>${HQ.t('v.przed.fuel')}</dt><dd>${HQ.DASH}<small>${why(rl)}</small></dd>`; $('#fuel-profile').innerHTML = `<button type="button" class="btn btn-line btn-s" data-retry="liq">${HQ.t('retry')}</button>`; }
    // Pod wodą
    const trp = $('#trap-prov'); trp.innerHTML = '';
    if (E && E.long && E.short) {
      trp.append(HQ.prov('model', E.asOf, 0, HQ.fmt((E.coverage.share || 0) * 100, 1) + '% OI'));
      const row = (lab, o, col) => `<div class="row"><span>${HQ.t(lab)}</span><span class="bar" role="img" aria-label="${HQ.t(lab)} ${HQ.fmt(o.underwaterShare * 100, 0)}%"><i style="width:${(o.underwaterShare * 100).toFixed(1)}%;background:var(${col})"></i></span><span class="v">${HQ.fmt(o.underwaterShare * 100, 0)}${HQ.lang === 'pl' ? ' %' : '%'}</span></div><div class="muted" style="font-size:12px;margin-top:-8px;padding-left:84px">${HQ.fill(HQ.t('trap.of'), { u: HQ.fmtUsd(o.underwaterUsd), t: HQ.fmtUsd(o.ntlUsd) })}</div>`;
      $('#trap').innerHTML = row('trap.longs', E.long, '--buy') + row('trap.shorts', E.short, '--sell') + `<p class="muted" style="margin:0;font-size:12.5px">${HQ.fill(HQ.t('trap.dist'), { l: HQ.fmt(E.long.liqDistPct.p50, 1) + '%', s: HQ.fmt(E.short.liqDistPct.p50, 1) + '%' })}</p>`;
    } else $('#trap').innerHTML = `<p class="muted">${HQ.DASH} ${why(re)}</p><button type="button" class="btn btn-line btn-s" data-retry="entry">${HQ.t('retry')}</button>`;
  }
  function profileSVG(L, pct) {
    const m = L.markPx, lo = m * (1 - pct / 100), hi = m * (1 + pct / 100), W = 520, H = 150, base = 116;
    const lb = buckets(L.longs), sb = buckets(L.shorts); const all = [];
    lb.forEach((v, p) => { if (p >= lo && p < m) all.push([p, v, 'l']); }); sb.forEach((v, p) => { if (p > m && p <= hi) all.push([p, v, 's']); });
    const max = Math.max(1, ...all.map((x) => x[1])); const x = (p) => ((p - lo) / (hi - lo)) * W; const bw = Math.max(1.5, (STEP / (hi - lo)) * W - 1.2);
    const bars = all.map(([p, v, s]) => { const h = (v / max) * (base - 10); return `<rect x="${x(p).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="var(${s === 'l' ? '--sell' : '--buy'})"/>`; }).join('');
    const ticks = [-pct, 0, pct].map((k) => { const p = m * (1 + k / 100); const anc = k < 0 ? 'start' : k > 0 ? 'end' : 'middle'; return `<text x="${x(p).toFixed(1)}" y="${base + 20}" text-anchor="${anc}" fill="var(--ink-3)" font-size="11" font-family="JetBrains Mono, monospace">${k === 0 ? HQ.fmt(m, 0) : HQ.fmtSigned(k, 0) + '%'}</text>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--line-strong)"/>${bars}<line x1="${x(m)}" x2="${x(m)}" y1="4" y2="${base}" stroke="var(--water)" stroke-width="2"/>${ticks}<text x="${W}" y="${H - 2}" text-anchor="end" fill="var(--ink-3)" font-size="10.5" font-family="JetBrains Mono, monospace">max ${HQ.fmtUsd(max)} / ${STEP} USD</text></svg>`;
  }

  /* ---------- Po sesji ---------- */
  async function loadPo() {
    const [rd, rg] = await Promise.allSettled([c1d(), ledger()]);
    const D1 = settled(rd), G = settled(rg); const P = lastPx();
    const today = D1 && D1.find((c) => c.t === d0());
    const pctU = HQ.lang === 'pl' ? ' %' : '%';
    const nums = today ? [['dn.open', HQ.fmt(+today.o, 0)], ['dn.hi', HQ.fmt(+today.h, 0)], ['dn.lo', HQ.fmt(+today.l, 0)], ['dn.last', P ? HQ.fmt(P.px, 0) : HQ.DASH], ['dn.range', HQ.fmt(((+today.h - +today.l) / +today.o) * 100, 2) + pctU]] : [['dn.open', HQ.DASH], ['dn.hi', HQ.DASH], ['dn.lo', HQ.DASH], ['dn.last', HQ.DASH], ['dn.range', HQ.DASH]];
    $('#daynums').innerHTML = nums.map(([k, v]) => `<div><span class="k">${HQ.t(k)}</span><span class="v">${v}</span></div>`).join('') + '<div class="src" id="dn-src" style="background:transparent;border:0;padding:0"></div>';
    if (today) $('#dn-src').append(HQ.prov('live', at('c1d'), 6 * 36e5, 'BTC · 1d UTC'));
    else $('#dn-src').textContent = `${HQ.DASH} ${why(rd)}`;
    if (!G) { $('#calib').innerHTML = `<p class="muted">${HQ.DASH} ${why(rg)}</p><button type="button" class="btn btn-line btn-s" data-retry="ledger c1d">${HQ.t('retry')}</button>`; $('#ledger-kv').innerHTML = `<dt>${HQ.t('v.po.ledger')}</dt><dd>${HQ.DASH}<small>${why(rg)}</small></dd>`; $('#po-chain').innerHTML = ''; $('#cal-prov').innerHTML = ''; $('#led-prov').innerHTML = ''; return; }
    const cp = $('#cal-prov'); cp.innerHTML = ''; cp.append(HQ.prov('model', null, 0, 'ledger-har-fhs-v1'), HQ.prov('live', G.asOf, 36e5));
    const rel = (G.scores && G.scores.touch && G.scores.touch.reliability || []).filter((b) => b.n > 0 && b.meanP != null);
    $('#calib').innerHTML = calibSVG(rel);
    let worst = null; rel.forEach((b) => { const g = Math.abs(b.meanP - b.freq); if (!worst || g > worst.g) worst = { ...b, g }; });
    const pc = (v) => HQ.fmt(v * 100, 1) + pctU;
    if (worst) $('#calib').setAttribute('aria-label', HQ.fill(HQ.t('cal.aria'), { k: rel.length, b: `${pc(worst.lo).replace(',0', '')}–${pc(worst.hi).replace(',0', '')}`, p: pc(worst.meanP), o: pc(worst.freq) }));
    $('#calib-table').innerHTML = `<table class="lvtable"><thead><tr><th scope="col">${HQ.t('cal.bin')}</th><th scope="col" class="r">${HQ.t('cal.n')}</th><th scope="col" class="r">${HQ.t('cal.pred')}</th><th scope="col" class="r">${HQ.t('cal.obs')}</th></tr></thead><tbody>${rel.map((b) => `<tr><td>${HQ.fmt(b.lo * 100, 0)}–${HQ.fmt(b.hi * 100, 0)}${pctU}</td><td class="r">${HQ.fmt(b.n, 0)}</td><td class="r">${pc(b.meanP)}</td><td class="r">${pc(b.freq)}</td></tr>`).join('')}</tbody></table>`;
    const r60 = G.scores.ret && G.scores.ret['60']; const t = G.scores.touch; const part = G.participation || {};
    const gap = part.gaps && part.gaps[0]; const whyGap = gap ? (gap.reason === 'outage' ? HQ.t('proof.outage') : gap.reason) : HQ.DASH;
    const kv = [
      ['led.lines', HQ.fmt(G.head.lines, 0), `SHA-256 ${G.head.hash.slice(0, 12)}…`],
      ['led.issued', HQ.fmt(part.issued, 0), HQ.fill(HQ.t('led.skipped'), { n: HQ.fmt(part.skipped || 0, 0), why: whyGap })],
      ['led.crpss', r60 ? HQ.fmtSigned(r60.crpss, 3) : HQ.DASH, r60 ? HQ.fill(HQ.t('led.crpssSub'), { n: HQ.fmt(r60.n, 0) }) : ''],
      ['led.cov', r60 && r60.cov90 ? pc(r60.cov90.rate) : HQ.DASH, r60 && r60.cov90 ? HQ.fill(HQ.t('led.covSub'), { n: HQ.fmt(r60.cov90.n, 0) }) : ''],
      ['led.bss', t ? HQ.fmt(t.bss, 2) : HQ.DASH, t && t.bssCi ? HQ.fill(HQ.t('led.bssSub'), { lo: HQ.fmt(t.bssCi.lo, 2), hi: HQ.fmt(t.bssCi.hi, 2), d: t.bssCi.days }) : ''],
    ];
    $('#ledger-kv').innerHTML = kv.map(([k, v, sub]) => `<dt>${HQ.t(k)}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ''}</dd>`).join('');
    const lp = $('#led-prov'); lp.innerHTML = ''; lp.append(HQ.prov('live', G.asOf, 36e5, 'ledger'));
    const ol = $('#po-chain'); ol.innerHTML = '';
    (G.ots || []).slice(-3).forEach((d) => { const li = document.createElement('li'); li.className = 'blk'; li.innerHTML = `<b>${HQ.date(Date.parse(d.day + 'T12:00:00Z'))}</b>${HQ.fill(HQ.t('proof.cal'), { n: d.calendars })}<br><span class="seal">${HQ.t('proof.stamp')}</span>`; ol.append(li); });
    const h = document.createElement('li'); h.className = 'blk head'; h.innerHTML = `<b>${HQ.t('proof.head')}</b>${G.head.hash.slice(0, 8)}…<br><span class="seal">${HQ.time(G.asOf, false)}</span>`; ol.append(h);
  }
  function calibSVG(rel) {
    const W = 380, H = 320, x0 = 52, y0 = 14, w = 304, h = 252; const X = (p) => x0 + p * w; const Y = (p) => y0 + (1 - p) * h;
    const maxN = Math.max(1, ...rel.map((b) => b.n)); const pctU = HQ.lang === 'pl' ? ' %' : '%';
    let g = '';
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => { g += `<line x1="${X(0)}" x2="${X(1)}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><line x1="${X(v)}" x2="${X(v)}" y1="${Y(0)}" y2="${Y(1)}" stroke="var(--line)"/>`; if (v % 0.5 === 0) g += `<text x="${X(v)}" y="${Y(0) + 18}" text-anchor="middle" fill="var(--ink-3)" font-size="11" font-family="JetBrains Mono, monospace">${v * 100}${pctU}</text><text x="${X(0) - 8}" y="${Y(v) + 4}" text-anchor="end" fill="var(--ink-3)" font-size="11" font-family="JetBrains Mono, monospace">${v * 100}${pctU}</text>`; });
    const diag = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--ink-3)" stroke-width="1"/>`;
    const path = rel.map((b, i) => `${i ? 'L' : 'M'}${X(b.meanP).toFixed(1)},${Y(b.freq).toFixed(1)}`).join(' ');
    const dots = rel.map((b) => `<circle cx="${X(b.meanP).toFixed(1)}" cy="${Y(b.freq).toFixed(1)}" r="${(3 + 8 * Math.sqrt(b.n / maxN)).toFixed(1)}" fill="var(--s1)" stroke="var(--water)" stroke-width="2"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${g}${diag}<path d="${path}" fill="none" stroke="var(--water)" stroke-width="2"/>${dots}<text x="${X(0.5)}" y="${H - 2}" text-anchor="middle" fill="var(--ink-2)" font-size="12" font-family="Plus Jakarta Sans, sans-serif">${HQ.t('cal.x')}</text><text transform="translate(12 ${Y(0.5)}) rotate(-90)" text-anchor="middle" fill="var(--ink-2)" font-size="12" font-family="Plus Jakarta Sans, sans-serif">${HQ.t('cal.y')}</text></svg>`;
  }

  /* ---------- Ustawienia ---------- */
  function renderSettings() {
    const v = $('#wn-ver'); if (v) v.textContent = HQ.fill(HQ.t('wn.ver'), { v: HQ.VERSION }); HQ.markPrefs();
    const D = HQ.session && HQ.session.D; const paused = D && D.paused;
    $('#stream-btn').textContent = HQ.t(paused ? 'v.ust.resume' : 'v.ust.pause');
    $('#stream-btn').setAttribute('aria-pressed', String(!!paused));
    $('#stream-state').textContent = HQ.t(paused ? 'v.ust.streamOff' : 'v.ust.streamOn');
  }

  /* ---------- Start ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const more = $('.bnav [data-more]'); more.setAttribute('aria-haspopup', 'dialog'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', 'more-sheet');
    $('#sheet-back').addEventListener('click', () => closeSheet());
    $('#sheet-close').addEventListener('click', () => closeSheet());
    $('#stream-btn').addEventListener('click', () => { const D = HQ.session.D; if (D.paused) HQ.session.resume(); else HQ.session.pause(); renderSettings(); });
    $('#sync-btn').addEventListener('click', () => { HQ.session.reconnect(); HQ.session.say(HQ.t('v.ust.synced')); renderSettings(); });
    $('#forget-btn').addEventListener('click', () => { try { localStorage.removeItem('hqp.visit'); } catch (e) { /* nic */ } prevVisit = null; visitSaved = true; HQ.session.say(HQ.t('v.ust.forgot')); });
    document.addEventListener('hq:stream', renderSettings);
    document.addEventListener('hq:win', (e) => { if (HQ.session) { HQ.session.D.win = e.detail * 1000; HQ.session.renderAll(); } });
    document.addEventListener('hq:market', renderCtxChip);
    document.addEventListener('hq:lang', () => { renderPhaseSegs(); renderCtxChip(); document.title = `HyperQuant · ${HQ.t(LABEL[route])}`; $('#mcards').innerHTML = ''; load(route); });
    show(fromHash(), false, false);
    HQ.maybeWhatsNew();
    setInterval(() => { if (!document.hidden && ['dzis', 'przed', 'po'].includes(route)) load(route); }, 30000);
  });
})();
