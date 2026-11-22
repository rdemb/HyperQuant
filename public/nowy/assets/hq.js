/* HyperQuant · Przekrój · rdzeń: język, motyw, formatowanie, pieczęcie pochodzenia, dane publiczne.
   Dane: Hyperliquid (publiczne API info i WebSocket) oraz publiczne pliki skanera HyperQuant (repo hyperquant-data).
   Brak kluczy, kont i danych prywatnych. */
(function () {
  'use strict';
  const HQ = (window.HQ = window.HQ || {});
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

  /* ---------- Język ---------- */
  const qsLang = new URLSearchParams(location.search).get('lang');
  const savedLang = LS('hq.lang') || LS('hqp.lang');
  HQ.lang = qsLang === 'en' || qsLang === 'pl' ? qsLang : savedLang === 'pl' ? 'pl' : 'en';
  if (qsLang === 'en' || qsLang === 'pl') LS('hq.lang', qsLang);
  HQ.t = (key) => { const d = (HQ.dict && HQ.dict[HQ.lang]) || {}; return d[key] != null ? d[key] : (HQ.dict && HQ.dict.pl && HQ.dict.pl[key]) || key; };
  HQ.applyI18n = (root = document) => {
    document.documentElement.lang = HQ.lang;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = HQ.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = HQ.t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => { const [attr, key] = pair.split(':'); if (attr && key) el.setAttribute(attr.trim(), HQ.t(key.trim())); });
    });
    document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === HQ.lang)));
  };
  HQ.setLang = (l) => { HQ.lang = l; LS('hq.lang', l); HQ.applyI18n(); document.dispatchEvent(new CustomEvent('hq:lang')); };

  /* ---------- Motyw: zapisany wybór, inaczej ustawienie systemu ---------- */
  // Motyw: wybór zapisany na urządzeniu (Głębia, Papier albo „jak w systemie”); bez wyboru — system
  const sysQ = matchMedia('(prefers-color-scheme: light)');
  const sysTheme = () => (sysQ.matches ? 'paper' : 'deep');
  HQ.themePref = LS('hqp.theme') || 'system';
  const resolve = (p) => (p === 'deep' || p === 'paper' ? p : sysTheme());
  HQ.theme = resolve(HQ.themePref);
  document.documentElement.dataset.theme = HQ.theme;
  const markTheme = () => document.querySelectorAll('[data-set-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setTheme === HQ.themePref || (b.dataset.setTheme === HQ.theme && !document.querySelector('[data-set-theme="system"]') && HQ.themePref === 'system'))));
  HQ.setTheme = (t) => { HQ.themePref = t; LS('hqp.theme', t); HQ.theme = resolve(t); document.documentElement.dataset.theme = HQ.theme; markTheme(); document.dispatchEvent(new CustomEvent('hq:theme')); };
  sysQ.addEventListener && sysQ.addEventListener('change', () => { if (HQ.themePref === 'system') HQ.setTheme('system'); });

  /* ---------- Ruch ---------- */
  // Ruch: ustawienie systemu albo wybór „ograniczony” w aplikacji (html[data-motion=reduced])
  const rmq = matchMedia('(prefers-reduced-motion: reduce)');
  HQ.motionPref = LS('hqp.motion') || 'system';
  HQ.reduced = () => rmq.matches || document.documentElement.dataset.motion === 'reduced';
  const applyMotion = () => {
    const d = document.documentElement;
    if (HQ.motionPref === 'reduced') d.dataset.motion = 'reduced'; else delete d.dataset.motion;
    d.classList.toggle('js-motion', !HQ.reduced());
    document.querySelectorAll('[data-set-motion]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setMotion === HQ.motionPref)));
  };
  HQ.setMotion = (m) => { HQ.motionPref = m; LS('hqp.motion', m); applyMotion(); document.dispatchEvent(new CustomEvent('hq:motion')); };
  applyMotion();
  rmq.addEventListener && rmq.addEventListener('change', () => { applyMotion(); document.dispatchEvent(new CustomEvent('hq:motion')); });

  /* ---------- Formatowanie (pl: 60 449 · 22,6 mln · −0,04%; en: 60,449 · 22.6M · −0.04%) ---------- */
  const loc = () => (HQ.lang === 'pl' ? 'pl-PL' : 'en-GB');
  const minus = (s) => s.replace(/-/g, '−');
  HQ.DASH = '—';
  // Zero po zaokrągleniu zawsze bez znaku (nigdy „−0,00”)
  const z = (v, d) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v);
  HQ.fmt = (v, d = 0) => (v == null || !isFinite(v) ? HQ.DASH : minus(new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(z(v, d))));
  HQ.fmtSigned = (v, d = 2) => (v == null || !isFinite(v) ? HQ.DASH : (z(v, d) > 0 ? '+' : '') + HQ.fmt(v, d));
  HQ.fmtPct = (v, d = 2) => (v == null || !isFinite(v) ? HQ.DASH : HQ.fmtSigned(v, d) + (HQ.lang === 'pl' ? ' %' : '%'));
  HQ.fmtUsd = (v) => {
    if (v == null || !isFinite(v)) return HQ.DASH;
    const a = Math.abs(v); const pl = HQ.lang === 'pl';
    if (a >= 1e9) return HQ.fmt(v / 1e9, 2) + (pl ? ' mld USD' : 'B USD');
    if (a >= 1e6) return HQ.fmt(v / 1e6, 1) + (pl ? ' mln USD' : 'M USD');
    if (a >= 1e3) return HQ.fmt(v / 1e3, 1) + (pl ? ' tys. USD' : 'K USD');
    return HQ.fmt(v, 0) + ' USD';
  };
  HQ.fmtUsdShort = (v) => {
    if (v == null || !isFinite(v)) return HQ.DASH;
    const a = Math.abs(v); const pl = HQ.lang === 'pl';
    if (a >= 1e9) return HQ.fmt(v / 1e9, 1) + (pl ? ' mld' : 'B');
    if (a >= 1e6) return HQ.fmt(v / 1e6, 1) + (pl ? ' mln' : 'M');
    if (a >= 1e3) return HQ.fmt(v / 1e3, 0) + (pl ? ' tys.' : 'K');
    return HQ.fmt(v, 0);
  };
  HQ.time = (ms, sec = true) => (ms == null ? HQ.DASH : new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit', second: sec ? '2-digit' : undefined, hourCycle: 'h23' }).format(ms));
  HQ.date = (ms) => new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short' }).format(ms);
  HQ.ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); const pl = HQ.lang === 'pl';
    if (s < 60) return pl ? `${s} s temu` : `${s}s ago`;
    const m = Math.round(s / 60); if (m < 60) return pl ? `${m} min temu` : `${m} min ago`;
    const h = Math.round(m / 60); return pl ? `${h} h temu` : `${h}h ago`;
  };
  HQ.tzName = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

  /* ---------- Pieczęć pochodzenia z pierścieniem świeżości ----------
     kind: live | model | sim | stale | rec | none; at: czas odczytu (ms); limit: wiek, po którym odczyt jest stary (ms). */
  HQ.ensureDefs = () => {
    if (document.getElementById('hq-defs')) return;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('id', 'hq-defs'); s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.setAttribute('aria-hidden', 'true'); s.style.position = 'absolute';
    s.innerHTML = '<defs><linearGradient id="hq-half" x1="0" x2="1" y1="0" y2="0"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs>';
    document.body.prepend(s);
  };
  const LABEL = { live: 'LIVE', model: 'MODEL', sim: 'SIM', stale: 'STALE', rec: 'REC', none: '' };
  HQ.prov = (kind, at, limit, extra) => {
    const span = document.createElement('span');
    span.className = 'prov';
    HQ.setProv(span, kind, at, limit, extra);
    return span;
  };
  HQ.setProv = (span, kind, at, limit = 60000, extra = '') => {
    let k = kind;
    if (k === 'live' && at && Date.now() - at > limit) k = 'stale';
    span.dataset.kind = k; span.dataset.at = at || ''; span.dataset.limit = limit;
    const age = at ? Math.max(0, (Date.now() - at) / 1000) : 0;
    span.style.setProperty('--age', age.toFixed(2) + 's');
    span.style.setProperty('--limit', (limit / 1000).toFixed(2) + 's');
    const lab = k === 'rec' ? HQ.t('prov.rec') : LABEL[k];
    const tm = at ? `<time datetime="${new Date(at).toISOString()}">${HQ.time(at)}</time>` : '';
    const ring = '<svg viewBox="0 0 14 14" aria-hidden="true"><circle class="track" cx="7" cy="7" r="5"/><circle class="age" cx="7" cy="7" r="5"/><circle class="core" cx="7" cy="7" r="2.4"/></svg>';
    const sr = k === 'live' ? HQ.t('prov.sr.live') : k === 'model' ? HQ.t('prov.sr.model') : k === 'sim' ? HQ.t('prov.sr.sim') : k === 'stale' ? HQ.t('prov.sr.stale') : k === 'rec' ? HQ.t('prov.sr.rec') : '';
    span.innerHTML = `${ring}<b>${lab}</b>${extra ? `<span>${extra}</span>` : ''}${tm}`;
    span.setAttribute('title', `${sr}${at ? ' · ' + HQ.time(at) : ''}${limit && k === 'live' ? ' · ' + HQ.t('prov.limit') + ' ' + Math.round(limit / 1000) + ' s' : ''}`);
    // Ograniczony ruch: pierścień skokowo (bez animacji)
    if (HQ.reduced() && k === 'live') { const frac = Math.min(1, age / (limit / 1000)); const a = span.querySelector('.age'); if (a) a.style.strokeDashoffset = (31.4 * frac).toFixed(2); }
    return span;
  };
  // Co sekundę: zmiana LIVE → STALE po przekroczeniu limitu; w ograniczonym ruchu aktualizacja pierścienia
  setInterval(() => {
    document.querySelectorAll('.prov[data-kind="live"]').forEach((p) => {
      const at = +p.dataset.at; const lim = +p.dataset.limit;
      if (!at) return;
      if (Date.now() - at > lim) HQ.setProv(p, 'live', at, lim);
      else if (HQ.reduced()) { const a = p.querySelector('.age'); if (a) a.style.strokeDashoffset = (31.4 * Math.min(1, (Date.now() - at) / lim)).toFixed(2); }
    });
  }, 1000);

  /* ---------- Sesje doby (UTC): Azja 00:00 UTC → Londyn 08:00 (Europe/London) → Nowy Jork 09:30 (America/New_York) → 24:00 UTC ---------- */
  function tzOffsetMin(utcMs, tz) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
    const g = (t) => +p.find((x) => x.type === t).value;
    return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs) / 60000;
  }
  function wallToUtc(dayUtc, h, m, tz) { const guess = dayUtc + (h * 60 + m) * 60000; return guess - tzOffsetMin(guess, tz) * 60000; }
  HQ.sessions = (now = Date.now()) => {
    const d0 = Math.floor(now / 86400000) * 86400000;
    const london = wallToUtc(d0, 8, 0, 'Europe/London');
    const ny = wallToUtc(d0, 9, 30, 'America/New_York');
    const end = d0 + 86400000;
    const list = [
      { id: 'asia', from: d0, to: london },
      { id: 'london', from: london, to: ny },
      { id: 'ny', from: ny, to: end },
    ];
    const cur = list.find((s) => now >= s.from && now < s.to) || list[0];
    return { d0, end, list, cur, frac: (now - d0) / 86400000 };
  };
  // Faza dnia tradera (uproszczona jak w aplikacji): przed sesją do otwarcia Londynu, w sesji do 22:00 UTC, potem po sesji
  HQ.phase = (now = Date.now()) => { const s = HQ.sessions(now); if (now < s.list[1].from) return 'before'; if (now < s.d0 + 22 * 3600000) return 'in'; return 'after'; };
  HQ.span = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };

  /* ---------- Dane publiczne ---------- */
  const INFO = 'https://api.hyperliquid.xyz/info';
  const DATA = 'https://raw.githubusercontent.com/rdemb/hyperquant-data/main';
  // Symulator stanów do testów makiety (?stan=offline|wolno|zerwanie|pusto); zawsze widoczny jako SIM
  const qsState = new URLSearchParams(location.search).get('stan');
  HQ.simState = ['offline', 'wolno', 'zerwanie', 'pusto'].includes(qsState) ? qsState : null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const simGate = async () => {
    if (HQ.simState === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false)) { await wait(300); throw new Error(HQ.t('err.offline')); }
    if (HQ.simState === 'wolno') await wait(4000);
  };
  HQ.info = async (body, timeout = 8000) => {
    await simGate();
    const c = new AbortController(); const id = setTimeout(() => c.abort(), timeout);
    try {
      const r = await fetch(INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: c.signal });
      if (!r.ok) throw new Error(r.status === 429 ? HQ.t('err.limit') : 'HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (e.name === 'AbortError') throw new Error(HQ.t('err.timeout')); if (e instanceof TypeError) throw new Error(HQ.t('err.network')); throw e; }
    finally { clearTimeout(id); }
  };
  HQ.published = async (path, timeout = 10000) => {
    await simGate();
    if (HQ.simState === 'pusto') { await wait(200); throw new Error(HQ.t('err.nofile')); }
    const c = new AbortController(); const id = setTimeout(() => c.abort(), timeout);
    try { const r = await fetch(`${DATA}/${path}`, { cache: 'no-cache', signal: c.signal }); if (!r.ok) throw new Error(r.status === 404 ? HQ.t('err.nofile') : 'HTTP ' + r.status); return await r.json(); }
    catch (e) { if (e.name === 'AbortError') throw new Error(HQ.t('err.timeout')); throw e; }
    finally { clearTimeout(id); }
  };

  // Liczby rynku: metaAndAssetCtxs (Hyperliquid główna giełda i HIP-3 xyz)
  HQ.marketCtx = async (coin) => {
    const dex = coin.includes(':') ? coin.split(':')[0] : '';
    const res = await HQ.info(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' });
    const [meta, ctxs] = res;
    const i = meta.universe.findIndex((u) => u.name === coin);
    if (i < 0) throw new Error('no market');
    const c = ctxs[i];
    const mark = +c.markPx, prev = +c.prevDayPx;
    return { at: Date.now(), coin, mark, mid: c.midPx != null ? +c.midPx : null, prev, chg: prev ? (mark / prev - 1) * 100 : null, funding: +c.funding, fundingApr: +c.funding * 24 * 365 * 100, oiUsd: +c.openInterest * mark, vlm: +c.dayNtlVlm };
  };

  /* WebSocket Hyperliquid: transakcje i księga; ponowne łączenie z narastającą przerwą */
  HQ.Feed = class {
    constructor(coin, opts = {}) { this.coin = coin; this.opts = opts; this.handlers = {}; this.retry = 0; this.closed = false; this.connect(); }
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
    emit(ev, d) { (this.handlers[ev] || []).forEach((f) => f(d)); }
    connect() {
      this.emit('status', 'connecting');
      clearTimeout(this.simT);
      if (HQ.simState === 'offline' || navigator.onLine === false) { this.simT = setTimeout(() => { if (!this.closed) { this.emit('status', 'reconnecting'); this.connect(); } }, 4000); return; }
      if (HQ.simState === 'wolno' && !this.slowDone) { this.slowDone = true; this.simT = setTimeout(() => !this.closed && this.connect(), 6000); return; }
      let ws;
      try { ws = new WebSocket('wss://api.hyperliquid.xyz/ws'); } catch (e) { this.schedule(); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0; this.emit('status', 'live');
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: this.coin } }));
        const l2 = { type: 'l2Book', coin: this.coin }; if (this.opts.nSigFigs) l2.nSigFigs = this.opts.nSigFigs;
        ws.send(JSON.stringify({ method: 'subscribe', subscription: l2 }));
        this.ping = setInterval(() => { try { ws.send(JSON.stringify({ method: 'ping' })); } catch (e) { /* zamknięte */ } }, 30000);
        // SIM „zerwanie”: co 25 s połączenie pada na 8 s (ślad przerwy w nagraniu)
        if (HQ.simState === 'zerwanie') { clearTimeout(this.dropT); this.dropT = setTimeout(() => { this.simDropUntil = Date.now() + 8000; try { ws.close(); } catch (e) { /* nic */ } }, 25000); }
      };
      ws.onmessage = (m) => {
        let d; try { d = JSON.parse(m.data); } catch (e) { return; }
        if (d.channel === 'trades') this.emit('trades', d.data.map((t) => ({ t: t.time, px: +t.px, sz: +t.sz, side: t.side === 'B' ? 'buy' : 'sell', id: t.tid })));
        else if (d.channel === 'l2Book') { const [b, a] = d.data.levels; this.emit('book', { t: d.data.time, bids: b.map((x) => ({ px: +x.px, sz: +x.sz, n: x.n })), asks: a.map((x) => ({ px: +x.px, sz: +x.sz, n: x.n })) }); }
      };
      ws.onclose = () => { clearInterval(this.ping); if (!this.closed) { this.emit('status', 'reconnecting'); this.schedule(); } };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* nic */ } };
    }
    schedule() { const w = this.simDropUntil && Date.now() < this.simDropUntil ? this.simDropUntil - Date.now() : Math.min(15000, 800 * 2 ** this.retry++); this.retryAt = Date.now() + w; this.emit('retry', this.retryAt); clearTimeout(this.reT); this.reT = setTimeout(() => !this.closed && this.connect(), w); }
    now() { if (this.closed) return; clearTimeout(this.reT); clearTimeout(this.simT); this.retry = 0; try { this.ws && this.ws.readyState === 1 ? null : this.connect(); } catch (e) { this.connect(); } }
    close() { this.closed = true; clearInterval(this.ping); clearTimeout(this.reT); clearTimeout(this.simT); clearTimeout(this.dropT); try { this.ws && this.ws.close(); } catch (e) { /* nic */ } }
  };

  /* ---------- Kolorystyka: Zorza (domyślna) albo Toń; wybór na tym urządzeniu ---------- */
  HQ.palette = document.documentElement.dataset.palette === 'ton' ? 'ton' : 'zorza';
  HQ.setPalette = (p) => { HQ.palette = p === 'ton' ? 'ton' : 'zorza'; try { localStorage.setItem('hqp.palette', HQ.palette); } catch (e) { /* nic */ } document.documentElement.dataset.palette = HQ.palette; markPrefs(); document.dispatchEvent(new CustomEvent('hq:theme')); };
  function markPrefs() {
    document.querySelectorAll('[data-set-palette]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setPalette === HQ.palette)));
    const light = document.querySelector('.setrow [data-set-theme="paper"]');
    if (light) light.textContent = HQ.t(HQ.palette === 'zorza' ? 'theme.opal' : 'theme.paper');
    const d = HQ.pref ? HQ.pref('density') || 'auto' : 'auto'; document.querySelectorAll('[data-set-density]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setDensity === d)));
    const w = HQ.pref ? HQ.pref('win') || 120 : 120; document.querySelectorAll('[data-set-win]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.setWin === w)));
  }
  HQ.markPrefs = () => markPrefs();

  /* ---------- Znak ruchu marki: linia wody. Szybkie ponowienie restartuje, nigdy nie kolejkuje ---------- */
  HQ.sweep = (el, cls = 'sweep-on') => { if (!el || HQ.reduced()) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); clearTimeout(el._sw); el._sw = setTimeout(() => el.classList.remove(cls), 900); };

  /* ---------- Co nowego: raz na wersję, ponownie z menu; natywny <dialog>, powrót fokusu ---------- */
  HQ.VERSION = '2.0';
  const whatsNewArt = () => `assets/grok-a-${HQ.theme === 'paper' ? 'opal' : 'zorza'}-v2`;
  document.addEventListener('hq:theme', () => {
    const picture = document.querySelector('#wn[open] .wn-art');
    if (!picture) return;
    const art = whatsNewArt();
    picture.querySelector('source').srcset = art + '.avif';
    picture.querySelector('img').src = art + '.webp';
  });
  HQ.openWhatsNew = (opener) => {
    let dlg = document.getElementById('wn');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'wn'; dlg.className = 'wn'; dlg.setAttribute('aria-labelledby', 'wn-h');
      document.body.append(dlg);
      dlg.addEventListener('close', () => {
        try { localStorage.setItem('hqp.seen', HQ.VERSION); } catch (e) { /* nic */ }
        const back = dlg._opener && document.contains(dlg._opener) && dlg._opener.offsetParent !== null && dlg._opener !== document.body ? dlg._opener : (document.querySelector('.view[data-on="true"] h1') || document.querySelector('main h1') || document.getElementById('main'));
        if (back && back.focus) back.focus({ preventScroll: true });
        document.dispatchEvent(new CustomEvent('hq:wnclosed'));
      });
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('backdrop'); const go = e.target.closest('[data-wn-go]'); if (go) { dlg.close('go'); } });
    }
    const items = [1, 2, 3, 4, 5, 6].map((i) => `<li><span class="n num">${String(i).padStart(2, '0')}</span><div><b>${HQ.t('wn.i' + i + 't')}</b><p>${HQ.t('wn.i' + i + 'd')}</p></div></li>`).join('');
    const art = whatsNewArt();
    dlg.innerHTML = `<picture class="wn-art" aria-hidden="true">
      <source type="image/avif" srcset="${art}.avif">
      <img src="${art}.webp" width="1120" height="320" alt="">
      </picture><div class="wn-in"><p class="eyebrow">${HQ.fill(HQ.t('wn.eyebrow'), { v: HQ.VERSION })}</p><h2 id="wn-h" tabindex="-1">${HQ.t('wn.h')}</h2><i class="wn-line" aria-hidden="true"></i><ol>${items}</ol>
      <p class="muted wn-foot">${HQ.t('wn.again')}</p>
      <div class="wn-act"><a class="btn btn-lume btn-s" href="${location.pathname.endsWith('desk.html') ? '#sesja' : 'desk.html#sesja'}" data-wn-go>${HQ.t('wn.try')}</a><button type="button" class="btn btn-line btn-s" value="close" formmethod="dialog" data-wn-close>${HQ.t('wn.close')}</button></div></div>`;
    dlg.querySelector('[data-wn-close]').addEventListener('click', () => dlg.close('button'));
    dlg._opener = opener || document.activeElement;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    dlg.querySelector('h2').focus({ preventScroll: true });
    HQ.sweep(dlg.querySelector('.wn-line'));
  };
  HQ.maybeWhatsNew = () => {
    let seen = null; try { seen = localStorage.getItem('hqp.seen'); } catch (e) { /* nic */ }
    const force = new URLSearchParams(location.search).get('conowego') === '1';
    if (force || seen !== HQ.VERSION) setTimeout(() => { if (!document.getElementById('wn') || !document.getElementById('wn').open) HQ.openWhatsNew(null); }, force ? 300 : 1100);
  };

  /* ---------- Nić kontekstu: rynek, cena, krok, okno, chwila, karta — w tej karcie (sessionStorage) ---------- */
  HQ.ctxStore = {
    read() { try { return JSON.parse(sessionStorage.getItem('hqp.ctx') || 'null'); } catch (e) { return null; } },
    write(c) { try { sessionStorage.setItem('hqp.ctx', JSON.stringify(c)); } catch (e) { /* pamięć zablokowana */ } },
    clear() { try { sessionStorage.removeItem('hqp.ctx'); } catch (e) { /* nic */ } },
  };
  // Personalizacja na tym urządzeniu (localStorage): gęstość księgi, domyślne okno odczytu, ostatni rynek, karta panelu
  HQ.pref = (k, v) => { const key = 'hqp.pref.' + k; if (v === undefined) { try { const x = localStorage.getItem(key); return x == null ? null : JSON.parse(x); } catch (e) { return null; } } try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* nic */ } };
  // Parametry po znaku ? w kotwicy: #sesja?m=BTC&px=59140&b=1&w=120&t=1795…
  HQ.hashRoute = () => location.hash.replace('#', '').split('?')[0];
  HQ.hashParams = () => { const q = location.hash.split('?')[1] || ''; const o = {}; new URLSearchParams(q).forEach((v, k) => (o[k] = v)); return o; };
  HQ.momentUrl = (c) => { const u = new URL('desk.html', location.href); const q = new URLSearchParams(); q.set('m', c.coin); if (c.px != null) q.set('px', c.px); if (c.bucket && c.bucket !== 1) q.set('b', c.bucket); if (c.win) q.set('w', Math.round(c.win / 1000)); if (c.t) q.set('t', c.t); u.hash = 'sesja?' + q.toString(); return u.toString(); };
  HQ.marketName = (coin) => ({ BTC: 'BTC', 'xyz:GOLD': 'GOLD', 'xyz:SP500': 'S&P 500' }[coin] || coin);

  /* ---------- Logo „Chronograf H”: pierścień doby, H z dwóch świec, punkt „teraz” ---------- */
  HQ.logoSVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13.2" fill="none" stroke="currentColor" stroke-width="2" opacity=".35"/><path class="lg-arc" d="M16 2.8a13.2 13.2 0 0 1 12.7 9.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><g class="lg-h"><rect x="9.6" y="9" width="3.4" height="14" rx="1.2" fill="currentColor"/><rect x="19" y="9" width="3.4" height="14" rx="1.2" fill="currentColor"/><rect x="11" y="14.6" width="10" height="2.8" rx="1" fill="currentColor"/></g><circle class="lg-now" cx="28.7" cy="12.4" r="2.6" fill="var(--lume)"/></svg>';

  /* ---------- Wspólne przełączniki ---------- */
  document.addEventListener('click', (e) => {
    const l = e.target.closest('[data-set-lang]'); if (l) HQ.setLang(l.dataset.setLang);
    const t = e.target.closest('[data-set-theme]'); if (t) HQ.setTheme(t.dataset.setTheme);
    if (e.target.closest('[data-toggle-theme]')) HQ.setTheme(HQ.theme === 'deep' ? 'paper' : 'deep');
    const mo = e.target.closest('[data-set-motion]'); if (mo) HQ.setMotion(mo.dataset.setMotion);
    const pa = e.target.closest('[data-set-palette]'); if (pa) HQ.setPalette(pa.dataset.setPalette);
    const de = e.target.closest('[data-set-density]'); if (de) { HQ.pref('density', de.dataset.setDensity); markPrefs(); document.dispatchEvent(new CustomEvent('hq:density')); }
    const wi = e.target.closest('[data-set-win]'); if (wi) { HQ.pref('win', +wi.dataset.setWin); markPrefs(); document.dispatchEvent(new CustomEvent('hq:win', { detail: +wi.dataset.setWin })); }
    const wn = e.target.closest('[data-open-wn]'); if (wn) { e.preventDefault(); HQ.openWhatsNew(wn); }
  });
  window.addEventListener('offline', () => document.dispatchEvent(new CustomEvent('hq:net', { detail: false })));
  window.addEventListener('online', () => document.dispatchEvent(new CustomEvent('hq:net', { detail: true })));
  document.addEventListener('DOMContentLoaded', () => {
    HQ.ensureDefs();
    if (HQ.simState) {
      const r = document.createElement('div'); r.className = 'simribbon'; r.setAttribute('role', 'note');
      r.innerHTML = `<span class="prov" data-kind="sim"><b>SIM</b></span><span>${HQ.t('sim.ribbon')} <b>${HQ.simState}</b></span><a href="${location.pathname}${location.hash}">${HQ.t('sim.exit')}</a>`;
      document.body.append(r); document.title = `[SIM: ${HQ.simState}] ` + document.title;
    }
    document.querySelectorAll('[data-logo]').forEach((el) => { el.insertAdjacentHTML('afterbegin', HQ.logoSVG); });
    HQ.applyI18n();
    markTheme(); applyMotion(); markPrefs();
    let entered = false; try { entered = sessionStorage.getItem('hqp.entered') === '1'; sessionStorage.setItem('hqp.entered', '1'); } catch (e) { /* nic */ }
    if ((!entered || new URLSearchParams(location.search).get('wejscie') === '1') && !HQ.reduced()) {
      const d = document.documentElement; d.classList.add('entering'); setTimeout(() => d.classList.remove('entering'), 1400);
    }
  });
})();
