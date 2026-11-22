/* Terminal „Przekrój” · iteracja 2.
   Powłoka, księga z wyborem ceny i odczytem, taśma, oś czasu z nagraniem z tej karty, przerwy w danych,
   skoki po dużych transakcjach (kotwica chwili), pasek stanu sesji, pomoc, paleta, nić kontekstu. */
(function () {
  'use strict';
  const HQ = window.HQ;
  const $ = (s, r = document) => r.querySelector(s);
  const D = {
    coin: 'BTC', feed: null, ctx: null, ctxAt: 0, frames: [], raw: [], m4pick: null, tapeFrozen: false, tapeFrozenN: 0, tapePicked: null, trades: [], start: null, live: true, cursor: null,
    status: 'connecting', dec: 0, lastTradeAt: 0, tapeLostThrough: null, bookAt: 0, bookEpoch: 0, bookSampleEpoch: -1, paused: false, gaps: [], gapFrom: null, connSince: Date.now(),
    sel: null, // { px, bucket, pinned, pinAt, snap }
    win: (HQ.pref('win') || 120) * 1000, focusTrade: null, retryAt: null, focusPx: null, restoredMsg: null,
  };
  const MAX_FRAMES = 3600, MAX_TRADES = 20000, BIG = 100000, JUMP = 25000, BOOK_LIMIT = 10000;
  // Dodatki terminala (paleta, żywe liczby): odczyt stanu i zaznaczenie poziomu w księdze
  HQ.desk = {
    coin: () => D.coin,
    dec: () => D.dec,
    live: () => D.live && D.status === 'live',
    // Migawka pod kursorem: na żywo najnowsza, w powtórce ostatnia ≤ czasu kursora (jak drabinka)
    frame: () => frameAt(at()),
    bookAt: () => D.bookAt,
    select: (px) => { if (!isFinite(px)) return; D.sel = { px, bucket: (D.sel && D.sel.bucket) || 1, pinned: false }; HQ.go('sesja', false); buildLadder(true); renderAll(); renderRead(); },
  };
  const unit = () => D.coin.replace('xyz:', '');
  const isPhone = () => matchMedia('(max-width: 760px)').matches;
  const isTablet = () => matchMedia('(min-width: 761px) and (max-width: 1100px)').matches;
  const coarse = matchMedia('(pointer: coarse)');
  const touchMode = () => { const d = HQ.pref('density') || 'auto'; return d === 'touch' || (d === 'auto' && (coarse.matches || isPhone())); };

  document.addEventListener('DOMContentLoaded', () => {
    setupTabs(); setupScrub(); setupPalette(); setupLadderKeys(); setupRead(); setupBanner(); setupHelp(); setupTapePick();
    $('#theme-btn').addEventListener('click', () => HQ.setTheme(HQ.theme === 'deep' ? 'paper' : 'deep'));
    $('#mkt').addEventListener('change', (e) => switchMarket(e.target.value, true));
    restoreContext();
    setInterval(loadCtx, 30000);
    setInterval(tick, 1000);
    renderDay(); setInterval(renderDay, 30000);
    document.addEventListener('hq:lang', () => { buildLadder(true); renderAll(); renderDay(); });
    document.addEventListener('hq:density', () => { buildLadder(true); renderAll(); });
    document.addEventListener('hq:net', (e) => {
      if (D.paused || !D.feed) return;
      if (e.detail) reconnect();
      else setStatus('reconnecting');
    });
    window.addEventListener('resize', () => buildLadder());
  });

  /* ---------- Nić kontekstu: odtworzenie z kotwicy (#sesja?m=…&px=…) albo z pamięci tej karty ---------- */
  function restoreContext() {
    const hp = HQ.hashRoute() === 'sesja' ? HQ.hashParams() : {};
    const st = HQ.ctxStore.read();
    const src = hp.m ? { coin: hp.m, px: hp.px != null ? +hp.px : null, bucket: hp.b ? +hp.b : 1, win: hp.w ? +hp.w * 1000 : null, t: hp.t ? +hp.t : null, from: 'link' } : st ? { ...st, from: 'memory' } : null;
    const coin = src && ['BTC', 'xyz:GOLD', 'xyz:SP500'].includes(src.coin) ? src.coin : HQ.pref('coin') || 'BTC';
    switchMarket(coin, false);
    if (src) {
      if (src.win) D.win = src.win;
      if (src.px != null && isFinite(src.px)) D.sel = { px: src.px, bucket: [1, 10, 100].includes(src.bucket) ? src.bucket : 1, pinned: false };
      // Chwila spoza nagrania tej karty (np. link sprzed godziny): wracamy na żywo i mówimy dlaczego
      if (src.t) D.restoredMsg = HQ.fill(HQ.t(src.from === 'link' ? 'ctx.outside' : 'ctx.outsideMem'), { t: HQ.time(src.t) });
      if (src.tab) { const tb = document.getElementById(src.tab); if (tb && getComputedStyle(tb).display !== 'none') tb.click(); }
    }
    if (hp.m) history.replaceState(null, '', location.pathname + location.search + '#sesja');
    buildLadder(true); renderAll(); renderRead();
  }
  let ctxT = null;
  function saveCtx() {
    clearTimeout(ctxT);
    ctxT = setTimeout(() => {
      const tab = document.querySelector('#insp [role="tab"][aria-selected="true"]');
      HQ.ctxStore.write({ coin: D.coin, px: D.sel ? D.sel.px : null, bucket: D.sel ? D.sel.bucket : 1, pinned: !!(D.sel && D.sel.pinned), t: D.live ? null : D.cursor, win: D.win, tab: tab ? tab.id : null, at: Date.now() });
      document.dispatchEvent(new CustomEvent('hq:ctx'));
    }, 150);
  }
  HQ.sessionCtx = () => ({ coin: D.coin, px: D.sel ? D.sel.px : null, bucket: D.sel ? D.sel.bucket : 1, live: D.live, cursor: D.cursor, win: D.win });

  /* ---------- Dane ---------- */
  function switchMarket(coin, announce) {
    const changed = coin !== D.coin || !D.feed;
    D.coin = coin; $('#mkt').value = coin; HQ.pref('coin', coin);
    if (!changed) return;
    if (D.feed) D.feed.close();
    { const tb = document.getElementById('tape-ask'); if (tb) { tb.textContent = HQ.t('m4.ask'); tb.dataset.on = 'false'; } const fz = document.getElementById('tape-frz'); if (fz) fz.hidden = true; }
    Object.assign(D, { frames: [], raw: [], m4pick: null, tapeFrozen: false, tapeFrozenN: 0, tapePicked: null, trades: [], start: null, live: true, cursor: null, ctx: null, dec: 0, lastTradeAt: 0, tapeLostThrough: null, bookAt: 0, paused: false, gaps: [], gapFrom: null, focusTrade: null, connSince: Date.now() });
    if (D.sel && announce) { D.sel = null; say(HQ.t('sel.cleared')); }
    document.querySelectorAll('.unit').forEach((u) => (u.textContent = unit())); const uh = $('.unit-h'); if (uh) uh.textContent = unit();
    connect(coin);
    loadCtx(); buildLadder(true); renderAll(); renderMarks(); saveCtx();
    document.dispatchEvent(new CustomEvent('hq:market', { detail: coin }));
  }
  function setStatus(s) {
    if (s === D.status) return;
    const now = Date.now();
    // Przerwa w nagraniu: od utraty stanu „live” do jego powrotu (tylko po rozpoczęciu nagrania)
    if (D.status === 'live' && s !== 'live' && D.start) D.gapFrom = now;
    if (s === 'live' && D.gapFrom) { D.gaps.push({ from: D.gapFrom, to: now }); D.gapFrom = null; HQ.sweep($('.dtime'), 'surface'); }
    if (s !== 'live') { D.connSince = now; D.bookEpoch++; }
    D.status = s; say(HQ.t('d.st.' + s)); renderAll(); renderMarks();
  }
  function pause() { if (D.paused) return; if (D.feed) D.feed.close(); clearInterval(D.fallback); D.paused = true; setStatus('paused'); renderAll(); document.dispatchEvent(new CustomEvent('hq:stream')); }
  function resume() { if (!D.paused) return; D.paused = false; connect(D.coin); renderAll(); document.dispatchEvent(new CustomEvent('hq:stream')); }
  function reconnect() { if (D.feed) D.feed.close(); D.paused = false; connect(D.coin); loadCtx(); document.dispatchEvent(new CustomEvent('hq:stream')); }
  function connect(coin) {
    setStatus('connecting');
    const f = (D.feed = new HQ.Feed(coin));
    HQ.liveFeed = f; document.dispatchEvent(new CustomEvent('hq:feed', { detail: f }));
    f.on('status', (s) => { if (f !== D.feed || D.paused) return; setStatus(s); });
    f.on('retry', (t) => { if (f === D.feed) { D.retryAt = t; renderBanner(); } });
    const onBook = (b) => {
      if (f !== D.feed || D.paused || D.status !== 'live' || navigator.onLine === false) return;
      const now = Date.now();
      // Migawki grupowane po stałym numerze sekundy czasu giełdy (b.t): w tej samej sekundzie zostaje ostatnia, nowa sekunda = nowa migawka.
      // (Wcześniej zastępowanie „gdy < 1 s od ostatniej” przesuwało punkt odniesienia i przy aktualizacjach co 200 ms zostawała jedna migawka; uwaga Astry.)
      const tx = isFinite(b.t) ? b.t : now;
      const last = D.frames[D.frames.length - 1];
      // Bez numeru wersji zachowujemy pierwszą migawkę o danym czasie giełdy, także przy rozbieżnych danych z REST i WS.
      if (last && tx <= last.tx) return;
      if (b.bids[0]) D.dec = Math.max(D.dec, decimalsOf(b.bids[0].px));
      // Kompletność strony: każdy wiersz z poprawną ceną i ilością, ceny ściśle monotoniczne. Tylko kompletna strona pozwala czytać brak wiersza jako zero.
      const okSide = (arr, dir) => arr.every((l, i) => isFinite(l.px) && l.px > 0 && isFinite(l.sz) && l.sz > 0 && (i === 0 || (dir < 0 ? l.px < arr[i - 1].px : l.px > arr[i - 1].px)));
      const complete = okSide(b.bids, -1) && okSide(b.asks, 1);
      const fr = { t: now, tx, bids: b.bids.slice(0, 24), asks: b.asks.slice(0, 24), complete };
      // M4 potrzebuje oryginalnych sąsiednich pomiarów: surowa migawka po czasie giełdy (całkowite ms), dokładna, gdy bez agregacji nSigFigs
      if (Number.isInteger(b.t)) HQ.m4.pushRaw(D.raw, { t: b.t, exact: !(f.opts && f.opts.nSigFigs), complete, bids: fr.bids, asks: fr.asks }, 3000);
      HQ.m4.pushThumb(D.frames, fr, MAX_FRAMES);
      D.bookAt = now;
      D.bookSampleEpoch = D.bookEpoch;
      if (!D.start) D.start = now;
      schedule();
    };
    f.on('book', onBook);
    // Zapas: gdy strumień księgi milczy ponad 6 s przy otwartym połączeniu, jedno zapytanie REST (waga 2)
    clearInterval(D.fallback);
    D.fallback = setInterval(() => {
      if (f !== D.feed || D.paused || D.status !== 'live' || document.hidden || Date.now() - D.bookAt < 6000) return;
      const epoch = D.bookEpoch;
      HQ.info({ type: 'l2Book', coin }).then((r) => {
        if (epoch !== D.bookEpoch || f !== D.feed) return;
        const [b, a] = r.levels;
        onBook({ t: r.time, bids: b.map((x) => ({ px: +x.px, sz: +x.sz, n: x.n })), asks: a.map((x) => ({ px: +x.px, sz: +x.sz, n: x.n })) });
      }).catch(() => {});
    }, 3000);
    f.on('trades', (ts) => {
      if (f !== D.feed) return;
      for (const t of ts) D.trades.push(t);
      if (D.trades.length > MAX_TRADES) {
        const overflow = D.trades.length - MAX_TRADES;
        for (const { t } of D.trades.splice(0, overflow)) D.tapeLostThrough = Math.max(D.tapeLostThrough ?? -Infinity, t);
        const frozenN = D.tapeFrozenN;
        D.tapeFrozenN = Math.max(0, frozenN - overflow);
        D.tapeSig = '';
        if (D.tapeFrozen && frozenN > 0 && overflow > Math.max(0, frozenN - 80)) renderTapePick();
      }
      D.lastTradeAt = Date.now(); schedule();
    });
  }
  function loadCtx() { const coin = D.coin; HQ.marketCtx(coin).then((c) => { if (coin !== D.coin) return; D.ctx = c; D.ctxAt = c.at; schedule(); }).catch(() => { schedule(); }); }
  const decimalsOf = (px) => { const s = String(px); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(4, s.length - i - 1); };

  /* ---------- Wybrana chwila: na żywo albo kursor nagrania ---------- */
  const at = () => (D.live ? Date.now() : D.cursor);
  function frameAt(t) { const F = D.frames; if (!F.length) return null; if (D.live) return F[F.length - 1]; let lo = 0, hi = F.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (F[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans < 0 ? null : F[ans]; }
  function tradesUpTo(t) { const T = D.trades; if (D.live) return T.length; let lo = 0, hi = T.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; } return ans + 1; }
  const allGaps = () => (D.gapFrom ? D.gaps.concat([{ from: D.gapFrom, to: Date.now(), open: true }]) : D.gaps);
  const gapAt = (t) => allGaps().find((g) => t >= g.from && t <= g.to);
  const tapeEvictedAt = (t) => D.tapeLostThrough != null && (D.start == null || t >= D.start) && t <= D.tapeLostThrough;
  const tapeStart = () => D.start == null ? null : Math.max(D.start, (D.tapeLostThrough ?? -Infinity) + 1);
  function bookKind(frame) {
    if (!frame) return 'none';
    if (!D.live) return 'rec';
    return D.status === 'live' && !D.paused && navigator.onLine !== false && D.bookSampleEpoch === D.bookEpoch
      && Date.now() - frame.t <= BOOK_LIMIT ? 'live' : 'stale';
  }

  let refreshLevel = () => {};

  let pending = false;
  function schedule() { if (pending) return; pending = true; setTimeout(() => { pending = false; renderAll(); }, 220); }
  function tick() {
    const sc = $('#scrub'); const st = D.start || Date.now();
    sc.min = String(st); sc.max = String(st + Math.max(1, Math.ceil((Date.now() - st) / 1000)) * 1000);
    if (D.live) sc.value = sc.max;
    renderTime(); renderBanner();
    if (D.live && bookKind(frameAt(Date.now())) === 'stale') renderAll();
  }

  function renderAll() {
    const t = at(); const fr = frameAt(t); const n = tradesUpTo(t);
    const lastTrade = n ? D.trades[n - 1] : null;
    // W powtórce cena pochodzi wyłącznie z faktycznej próbki ≤ T (ostatnia transakcja); bieżący mark nie udaje nagrania.
    const price = lastTrade ? lastTrade.px : D.live && D.ctx ? D.ctx.mark : null;
    const dec = D.dec;
    $('#h-px').textContent = price != null ? HQ.fmt(price, dec) : HQ.DASH;
    const chg = price != null && D.ctx && D.ctx.prev ? (price / D.ctx.prev - 1) * 100 : null;
    const hc = $('#h-chg'); hc.textContent = chg != null ? `${HQ.fmtPct(chg, 2)} · ${HQ.t('d.chg')}` : HQ.DASH;
    hc.className = 'd ' + (chg > 0 ? 'buy' : chg < 0 ? 'sell' : 'muted');
    hc.title = D.ctx ? `${HQ.t('d.n.prev')}: ${HQ.fmt(D.ctx.prev, dec)}` : '';
    const hp = $('#h-prov'); hp.innerHTML = '';
    if (!D.live) hp.append(lastTrade ? HQ.prov('rec', lastTrade.t, 0) : HQ.prov('none', null, 0, HQ.t('prov.noSample')));
    else if (lastTrade) hp.append(HQ.prov('live', D.lastTradeAt, 15000));
    else hp.append(HQ.prov('none', null, 0, HQ.t('d.st.short.' + (D.status === 'live' ? 'connecting' : D.status))));
    $('#h-fund').textContent = D.ctx ? HQ.fmtPct(D.ctx.fundingApr, 2) : HQ.DASH;
    $('#h-oi').textContent = D.ctx ? HQ.fmtUsdShort(D.ctx.oiUsd) : HQ.DASH;
    $('#h-vol').textContent = D.ctx ? HQ.fmtUsdShort(D.ctx.vlm) : HQ.DASH;
    const cp = $('#h-ctxprov'); cp.innerHTML = ''; if (D.ctx) cp.append(HQ.prov('live', D.ctxAt, 90000));
    // Stały wskaźnik strumienia: wszystkie etykiety leżą w jednej komórce siatki, widać tylko bieżącą,
    // więc szerokość nie zmienia się przy zmianie stanu (brak przesunięcia nagłówka).
    const conn = $('#conn'); if (conn) {
      const ks = ['live', 'connecting', 'reconnecting', 'paused', 'offline'];
      const shown = D.status !== 'paused' && (navigator.onLine === false || HQ.simState === 'offline') ? 'offline' : D.status;
      if (conn.dataset.lang !== HQ.lang) { conn.innerHTML = ks.map((k) => `<span data-s="${k}">${HQ.t('d.st.chip.' + k)}</span>`).join(''); conn.dataset.lang = HQ.lang; }
      conn.dataset.state = shown; conn.hidden = false;
      conn.querySelectorAll('span').forEach((x) => x.classList.toggle('on', x.dataset.s === shown));
    }
    renderBanner(); refreshLevel();
    const sv = $('#v-sesja'); if (sv && sv.dataset.on !== 'true') return;
    renderLadder(fr, dec); renderTape(n, dec); renderNums(D.frames[D.frames.length - 1] || null, dec); renderTime(); renderRead();
  }
  // W powtórce pieczęć NAGRANIE niesie czas faktycznej próbki ≤ T (recAt); bez próbki: „brak próbki”.
  function provFor(el, liveAt, limit, recAt) { el.innerHTML = ''; if (!D.live) el.append(recAt ? HQ.prov('rec', recAt, 0) : HQ.prov('none', null, 0, HQ.t('prov.noSample'))); else if (liveAt) el.append(HQ.prov('live', liveAt, limit)); else el.append(HQ.prov('none', null, 0, HQ.t('d.st.short.' + (D.status === 'live' ? 'connecting' : D.status)))); }

  /* ---------- Księga: wiersze z kluczem ceny (sloty budowane raz, treść aktualizowana) ---------- */
  let slotsN = 0, slotsTouch = null;
  const rowsPerSide = () => (touchMode() ? (isPhone() ? 6 : isTablet() ? 9 : 10) : isPhone() ? 9 : 13);
  function buildLadder(force) {
    const N = rowsPerSide(); const touch = touchMode();
    if (!force && N === slotsN && touch === slotsTouch) return;
    slotsN = N; slotsTouch = touch;
    const tb = $('#ladder tbody'); const lad = $('#ladder'); lad.dataset.touch = String(touch);
    const tbtn = $('#touch-btn'); if (tbtn) tbtn.setAttribute('aria-pressed', String(touch));
    const row = (i) => `<tr data-slot="${i}"><td class="bid"><i class="bar"></i><span class="sz"></span></td><th scope="row" class="price"><button type="button" class="pbtn" tabindex="-1" aria-pressed="false"></button></th><td class="ask"><i class="bar"></i><span class="sz"></span></td></tr>`;
    let h = ''; for (let i = 0; i < N; i++) h += row(i);
    h += `<tr class="mid"><td colspan="3"></td></tr>`;
    for (let i = N; i < 2 * N; i++) h += row(i);
    tb.innerHTML = h;
    renderAll();
  }
  const inSel = (px) => D.sel && px >= D.sel.px && px < D.sel.px + D.sel.bucket;
  function renderLadder(fr, dec) {
    const kind = bookKind(fr);
    const badge = HQ.prov(kind, fr ? fr.t : null, BOOK_LIMIT, fr ? '' : HQ.t(!D.live ? 'prov.noSample' :
      'd.st.short.' + (D.status === 'live' ? 'connecting' : D.status)));
    badge.dataset.deskBook = '';
    $('#book-prov').replaceChildren(badge);
    const tb = $('#ladder tbody'); const N = slotsN; const stale = kind === 'stale';
    const rows = tb.querySelectorAll('tr[data-slot]'); const mid = tb.querySelector('tr.mid td');
    if (!D.live || D.status !== 'live' || !fr) {
      tb.querySelectorAll('tr[data-drop]').forEach((row) => { delete row.dataset.drop; });
    }
    if (!mid) { if (!slotsN) { buildLadder(true); } return; } // wiersze jeszcze nie zbudowane (np. karta przywrócona przed startem)
    const lad = $('#ladder');
    if (!fr) { lad.dataset.empty = 'true'; mid.textContent = !D.live && D.frames.length ? `${HQ.DASH} ${HQ.fill(HQ.t('book.empty.before'), { t: HQ.time(D.frames[0].t) })}` : `${HQ.DASH} ${HQ.t('book.empty.' + (D.status === 'live' ? 'connecting' : D.status))}`; rows.forEach((r) => (r.hidden = true)); updateOff(null); return; }
    lad.dataset.empty = 'false'; rows.forEach((r) => (r.hidden = false));
    const asks = fr.asks.slice(0, N), bids = fr.bids.slice(0, N);
    const max = Math.max(1e-9, ...asks.map((x) => x.sz), ...bids.map((x) => x.sz));
    const szd = D.coin === 'BTC' ? 4 : 2;
    const slots = asks.slice().reverse().map((x) => ['ask', x]).concat(bids.map((x) => ['bid', x]));
    while (slots.length < 2 * N) slots.push(null);
    const active = document.activeElement && document.activeElement.classList.contains('pbtn') ? +document.activeElement.dataset.px : null;
    let tabPx = null;
    rows.forEach((r, i) => {
      const it = slots[i]; const btn = r.querySelector('.pbtn');
      // Wiersz może dostać inną cenę. Kropla należy do ceny wydruku.
      if (r.dataset.drop !== undefined && (!it || r.dataset.drop !== String(it[1].px))) delete r.dataset.drop;
      if (!it) { r.className = 'empty-row'; btn.textContent = HQ.DASH; btn.dataset.px = ''; btn.disabled = true; r.querySelectorAll('.sz').forEach((s) => (s.textContent = '')); r.querySelectorAll('.bar').forEach((b) => (b.style.width = '0')); return; }
      const [side, x] = it; btn.disabled = false;
      const sel = inSel(x.px); const pinned = sel && D.sel.pinned; const isTrade = D.focusTrade && !D.live && D.focusTrade.px === x.px;
      r.className = `${side}-row${sel ? ' sel' : ''}${pinned ? ' pinned' : ''}${isTrade ? ' moment' : ''}`;
      btn.dataset.px = x.px; btn.textContent = HQ.fmt(x.px, dec); btn.setAttribute('aria-pressed', String(!!sel));
      const szTxt = stale ? HQ.DASH : HQ.fmt(x.sz, szd);
      btn.setAttribute('aria-label', `${HQ.fmt(x.px, dec)} USD, ${side === 'bid' ? 'BID' : 'ASK'} ${szTxt} ${unit()}${sel ? ', ' + HQ.t('sel.selected') : ''}`);
      const bid = r.querySelector('td.bid'), ask = r.querySelector('td.ask');
      const on = side === 'bid' ? bid : ask, off = side === 'bid' ? ask : bid;
      on.querySelector('.sz').textContent = szTxt; on.querySelector('.bar').style.width = stale ? '0' : ((x.sz / max) * 100).toFixed(1) + '%';
      off.querySelector('.sz').textContent = ''; off.querySelector('.bar').style.width = '0';
      if (sel && tabPx == null) tabPx = x.px;
    });
    // Jedno wejście Tab: wybrana cena, inaczej najlepszy BID
    const best = bids[0] ? bids[0].px : asks[0] ? asks[0].px : null;
    const want = tabPx != null ? tabPx : best;
    rows.forEach((r) => { const b = r.querySelector('.pbtn'); b.tabIndex = b.dataset.px !== '' && +b.dataset.px === want ? 0 : -1; });
    // Fokus zostaje na tej samej cenie, gdy wiersze przesuwają się z rynkiem
    if (active != null) { const b = tb.querySelector(`.pbtn[data-px="${active}"]`); if (b && document.activeElement !== b) b.focus({ preventScroll: true }); }
    const spread = asks[0] && bids[0] ? asks[0].px - bids[0].px : null; const midPx = asks[0] && bids[0] ? (asks[0].px + bids[0].px) / 2 : null;
    mid.textContent = stale ? HQ.fill(HQ.t('book.staleRow'), { s: Math.round((Date.now() - D.bookAt) / 1000) }) : `${HQ.fill(HQ.t('d.spread'), { s: HQ.fmt(spread, dec) })} · ${HQ.t('d.n.mid').toLowerCase()} ${HQ.fmt(midPx, dec + 1)}`;
    updateOff(fr);
  }
  // Wybrana cena poza widocznymi wierszami: wskazówka z kierunkiem
  function updateOff(fr) {
    const el = $('#sel-off'); if (!el) return;
    if (!D.sel || !fr) { el.hidden = true; return; }
    const vis = [...document.querySelectorAll('#ladder .pbtn')].map((b) => +b.dataset.px).filter((x) => x);
    el.hidden = false; el.dataset.state = 'off';
    // Stały wiersz przez cały czas zaznaczenia: zmiana ceny przełącza tylko tekst (bez przesunięcia księgi)
    if (!vis.length || vis.some((p) => inSel(p))) { el.dataset.state = 'in'; el.textContent = HQ.fill(HQ.t('sel.inView'), { px: HQ.fmt(D.sel.px, D.dec) }); return; }
    const hi = Math.max(...vis), lo = Math.min(...vis);
    // Wewnątrz widocznego zakresu, ale bez wiersza: na tym poziomie nie ma zleceń (to zero z pomiaru, nie „poza widokiem”)
    if (D.sel.px > lo && D.sel.px < hi) { el.textContent = HQ.fill(HQ.t('sel.empty'), { px: HQ.fmt(D.sel.px, D.dec) }); return; }
    el.textContent = HQ.fill(HQ.t(D.sel.px > hi ? 'sel.offUp' : 'sel.offDown'), { px: HQ.fmt(D.sel.px, D.dec) });
  }

  function setupLadderKeys() {
    const tb = $('#ladder tbody');
    tb.addEventListener('focusin', (e) => { const b = e.target.closest('.pbtn'); if (b && b.dataset.px) D.lastFocusPx = +b.dataset.px; });
    tb.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-slot]'); const b = tr && tr.querySelector('.pbtn'); if (!b || b.disabled) return; selectPx(+b.dataset.px, false); b.focus({ preventScroll: true }); });
    tb.addEventListener('keydown', (e) => {
      const b = e.target.closest('.pbtn'); if (!b) return;
      const btns = [...tb.querySelectorAll('.pbtn:not([disabled])')]; const i = btns.indexOf(b); let j = null;
      if (e.key === 'ArrowUp') j = Math.max(0, i - 1); else if (e.key === 'ArrowDown') j = Math.min(btns.length - 1, i + 1);
      else if (e.key === 'PageUp') j = Math.max(0, i - 5); else if (e.key === 'PageDown') j = Math.min(btns.length - 1, i + 5);
      else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = btns.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (inSel(+b.dataset.px)) togglePin(); else selectPx(+b.dataset.px, true); return; }
      else if (e.key === 'Escape' && D.sel) { e.preventDefault(); e.stopPropagation(); clearSel(); return; }
      if (j != null) { e.preventDefault(); const t = btns[j]; selectPx(+t.dataset.px, true); t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest' }); }
    });
    const tbtn = $('#touch-btn');
    if (tbtn) tbtn.addEventListener('click', () => { const now = touchMode(); HQ.pref('density', now ? 'compact' : 'touch'); document.dispatchEvent(new CustomEvent('hq:density')); say(HQ.t(now ? 'dens.compactOn' : 'dens.touchOn')); });
    coarse.addEventListener && coarse.addEventListener('change', () => buildLadder());
  }
  function selectPx(px, fromKeys) {
    const bucket = D.sel ? D.sel.bucket : 1;
    const base = bucket > 1 ? Math.floor(px / bucket) * bucket : px;
    const same = D.sel && D.sel.px === base;
    D.sel = { px: base, bucket, pinned: same ? D.sel.pinned : false, pinAt: same ? D.sel.pinAt : null, snap: same ? D.sel.snap : null };
    renderAll(); saveCtx();
    const tr = document.querySelector(`#ladder .pbtn[data-px="${px}"]`); if (tr) HQ.sweep(tr.closest('tr'), 'flash');
    if (!same) announceRead();
  }
  function clearSel() { D.sel = null; renderAll(); saveCtx(); say(HQ.t('sel.cleared2')); }
  function togglePin() {
    if (!D.sel) return;
    if (D.sel.pinned) { D.sel.pinned = false; D.sel.snap = null; say(HQ.t('read.unpinned')); }
    else { const T = at(); D.sel.pinned = true; D.sel.pinAt = T; D.sel.snap = readAt(D.sel.px, D.sel.bucket, T); say(HQ.fill(HQ.t('read.pinnedSay'), { t: HQ.time(T) })); }
    renderAll(); saveCtx();
  }

  /* ---------- Odczyt wybranej ceny: Δ, obrót, L2, wiek, pokrycie taśmy w oknie ---------- */
  function readAt(px, bucket, T) {
    const W = D.win; const from = T - W, to = T; const rs = D.start || T;
    // Okno (from, to] pomija wykonania dokładnie w from. Ta sama ms może zawierać zachowane i wyparte wykonania.
    const tapeEvicted = D.tapeLostThrough != null && from < D.tapeLostThrough && to >= rs;
    const covFrom = Math.max(from, rs, D.tapeLostThrough ?? -Infinity); let covered = Math.max(0, to - covFrom); const gaps = [];
    allGaps().forEach((g) => { const a = Math.max(g.from, covFrom), b = Math.min(g.to, to); if (b > a) { covered -= b - a; gaps.push({ from: a, to: b }); } });
    // Pełne pokrycie wyłącznie dokładnie: każda milisekunda okna nagrana (tolerancja tylko w zaokrągleniu napisu).
    const full = covered >= W;
    let buy = 0, sell = 0, turn = 0, n = 0;
    for (let i = D.trades.length - 1; i >= 0; i--) { const t = D.trades[i]; if (t.t > to) continue; if (t.t <= from) break; if (t.px >= px && t.px < px + bucket) { n++; turn += t.px * t.sz; if (t.side === 'buy') buy += t.sz; else sell += t.sz; } }
    const fr = frameAt(T); let l2 = { has: false };
    if (fr) {
      const age = T - fr.t; const lvls = fr.bids.map((x) => ['bid', x]).concat(fr.asks.map((x) => ['ask', x]));
      const inB = lvls.filter(([, x]) => x.px >= px && x.px < px + bucket);
      const lo = fr.bids.length ? fr.bids[fr.bids.length - 1].px : null, hi = fr.asks.length ? fr.asks[fr.asks.length - 1].px : null;
      const inRange = lo != null && hi != null && px >= lo && px + bucket - 1 <= hi;
      const sz = inB.reduce((s, [, x]) => s + x.sz, 0);
      const side = fr.asks[0] && px >= fr.asks[0].px ? 'ask' : 'bid';
      l2 = { has: true, t: fr.t, age, stale: age > BOOK_LIMIT, sz, inRange, side, depth: Math.min(fr.bids.length, fr.asks.length), complete: fr.complete !== false, rows: inB.length };
    }
    return { px, bucket, T, from, to, W, covered, full, gaps, recLate: from < rs, rs, tapeEvicted, lostThrough: D.tapeLostThrough, n, delta: buy - sell, turn, l2 };
  }
  function setupRead() {
    const box = $('#readbar');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
      if (a === 'pin') togglePin();
      else if (a === 'refresh') { D.sel.pinned = false; togglePin(); }
      else if (a === 'clear') { clearSel(); const t = document.querySelector('#ladder .pbtn[tabindex="0"]'); if (t) t.focus(); }
      else if (a === 'link') copyMoment();
    });
    box.addEventListener('change', (e) => {
      if (e.target.id === 'rd-win') { D.win = +e.target.value * 1000; HQ.pref('win', +e.target.value); if (D.sel && D.sel.pinned) D.sel.snap = readAt(D.sel.px, D.sel.bucket, D.sel.pinAt); renderAll(); saveCtx(); }
      if (e.target.id === 'rd-bucket') { const b = +e.target.value; if (D.sel) { D.sel.bucket = b; D.sel.px = b > 1 ? Math.floor(D.sel.px / b) * b : D.sel.px; if (D.sel.pinned) D.sel.snap = readAt(D.sel.px, b, D.sel.pinAt); } renderAll(); saveCtx(); }
    });
  }
  function copyMoment() {
    const url = HQ.momentUrl({ coin: D.coin, px: D.sel ? D.sel.px : null, bucket: D.sel ? D.sel.bucket : 1, win: D.win, t: D.live ? null : D.cursor });
    const done = () => say(HQ.t('read.copied'));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { prompt(HQ.t('read.copyPrompt'), url); });
    else prompt(HQ.t('read.copyPrompt'), url);
    D.lastLink = url;
  }
  function tagHTML(kind, text) { return `<span class="tagx ${kind}">${text}</span>`; }
  function renderRead() {
    const box = $('#readbar'); if (!box) return;
    if (!D.sel) {
      box.hidden = true;
      const hint = $('#sel-hint'); if (hint) hint.hidden = HQ.pref('hint1') === true;
      return;
    }
    box.hidden = false; const hint = $('#sel-hint'); if (hint) hint.hidden = true;
    const s = D.sel; const r = s.pinned && s.snap ? s.snap : readAt(s.px, s.bucket, at());
    const dec = D.dec; const szd = D.coin === 'BTC' ? 4 : 2; const pl = HQ.lang === 'pl';
    const pxTxt = s.bucket > 1 ? `${HQ.fmt(s.px, dec)}–${HQ.fmt(s.px + s.bucket - 1, dec)}` : HQ.fmt(s.px, dec);
    const sec = (ms) => Math.round(ms / 1000);
    const cov = r.full ? tagHTML('full', HQ.fill(HQ.t('read.cov'), { c: sec(r.covered), w: sec(r.W) })) : tagHTML('part', HQ.fill(HQ.t('read.covPart'), { c: Math.floor(r.covered / 1000), w: sec(r.W) }));
    const dTxt = r.n === 0 ? (r.full ? `0 ${unit()}` : HQ.DASH) : `${HQ.fmtSigned(r.delta, szd)} ${unit()}`;
    const tTxt = r.n === 0 ? (r.full ? '0 USD' : HQ.DASH) : HQ.fmtUsd(r.turn);
    const whyParts = [];
    if (r.recLate) whyParts.push(HQ.fill(HQ.t('read.recFrom'), { t: HQ.time(r.rs) }));
    if (r.tapeEvicted) whyParts.push(HQ.fill(HQ.t('read.tapeEvicted'), { t: HQ.time(r.lostThrough) }));
    r.gaps.forEach((g) => whyParts.push(HQ.fill(HQ.t('read.gap'), { a: HQ.time(g.from), b: HQ.time(g.to) })));
    const whole = r.full ? '' : `<p class="whole">${HQ.t('read.whole')} ${HQ.DASH} (${whyParts.join('; ')})</p>`;
    let l2v, l2tag;
    if (!r.l2.has) { l2v = HQ.DASH; l2tag = tagHTML('none', HQ.t('read.l2none')); }
    else if (r.l2.stale) { l2v = HQ.DASH; l2tag = tagHTML('part', HQ.fill(HQ.t('read.l2stale'), { t: HQ.time(r.l2.t), s: sec(r.l2.age) })); }
    else if (!r.l2.inRange && r.l2.sz === 0) { l2v = HQ.DASH; l2tag = tagHTML('none', HQ.fill(HQ.t('read.l2range'), { n: r.l2.depth })); }
    else if (!r.l2.complete && (r.l2.rows === 0 || !isFinite(r.l2.sz))) { l2v = HQ.DASH; l2tag = tagHTML('part', HQ.t('read.l2incomplete')); }
    else { l2v = `${HQ.fmt(r.l2.sz, szd)} ${unit()}`; l2tag = tagHTML('full', HQ.fill(HQ.t('read.l2at'), { t: HQ.time(r.l2.t), a: (r.l2.age / 1000).toLocaleString(pl ? 'pl-PL' : 'en-GB', { maximumFractionDigits: 1 }) })); }
    // Szkielet budowany raz: przyciski i listy nie są przerysowywane, więc fokus w pasku odczytu nie ginie
    if (!box.querySelector('.rhead')) {
      const winOpts = [60, 120, 300, 900].map((w) => `<option value="${w}">${w / 60} min</option>`).join('');
      const bOpts = [1, 10, 100].map((b) => `<option value="${b}">${b} USD</option>`).join('');
      box.innerHTML = `
      <div class="rhead"><span class="t"></span><b class="rpx num"></b><span class="rprov"></span>
        <span class="ract"><button type="button" class="iconbtn sm" data-act="pin" aria-pressed="false"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/></svg></button><button type="button" class="iconbtn sm" data-act="link"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/></svg></button><button type="button" class="iconbtn sm" data-act="clear"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span></div>
      <p class="moment-line" hidden><i aria-hidden="true"></i><span></span></p>
      <div class="pinned-note" hidden><span></span><button type="button" class="btn btn-line btn-s" data-act="refresh"></button></div>
      <div class="rcells"></div><p class="whole" hidden></p>
      <figure class="trace" aria-labelledby="trace-cap"><svg viewBox="0 0 320 64" preserveAspectRatio="none" aria-hidden="true"></svg><figcaption id="trace-cap"></figcaption></figure>
      <div class="ropts"><label><span class="lw"></span> <select id="rd-win">${winOpts}</select></label><label><span class="lb"></span> <select id="rd-bucket">${bOpts}</select></label><span class="muted rspan"></span></div>
      <section class="m4wrap"></section>`;
      setupM4(box.querySelector('.m4wrap'));
    }
    const q = (sel) => box.querySelector(sel);
    q('.rhead .t').textContent = HQ.t('read.title'); q('.rpx').textContent = `${pxTxt} USD`;
    const pinB = q('[data-act="pin"]'); pinB.setAttribute('aria-pressed', String(!!s.pinned)); const pinL = HQ.t(s.pinned ? 'read.unpin' : 'read.pin'); pinB.setAttribute('aria-label', pinL); pinB.title = pinL; pinB.querySelector('svg').setAttribute('fill', s.pinned ? 'currentColor' : 'none');
    const linkB = q('[data-act="link"]'); linkB.setAttribute('aria-label', HQ.t('read.link')); linkB.title = HQ.t('read.link');
    const clrB = q('[data-act="clear"]'); clrB.setAttribute('aria-label', HQ.t('read.clear')); clrB.title = HQ.t('read.clear');
    const ml = q('.moment-line'); const ft = D.focusTrade && !D.live ? D.focusTrade : null; ml.hidden = !ft;
    if (ft) ml.querySelector('span').textContent = HQ.fill(HQ.t('read.moment'), { t: HQ.time(ft.t), side: HQ.t(ft.side === 'buy' ? 'side.buy' : 'side.sell'), sz: HQ.fmt(ft.sz, D.coin === 'BTC' ? 5 : 2), u: unit(), px: HQ.fmt(ft.px, dec), usd: HQ.fmtUsdShort(ft.px * ft.sz) });
    const pn = q('.pinned-note'); pn.hidden = !s.pinned; if (s.pinned) { pn.querySelector('span').textContent = HQ.fill(HQ.t('read.pinnedAt'), { t: HQ.time(s.pinAt) }); pn.querySelector('button').textContent = HQ.t('read.refresh'); }
    q('.rcells').innerHTML = `
        <div class="rc"><span class="k">${HQ.t('read.delta')}</span><span class="v num ${r.n && r.delta > 0 ? 'buy' : r.n && r.delta < 0 ? 'sell' : ''}">${dTxt}</span>${cov}</div>
        <div class="rc"><span class="k">${HQ.t('read.turn')}</span><span class="v num">${tTxt}</span>${r.full ? tagHTML('full', HQ.fill(HQ.t('read.trades'), { n: r.n })) : tagHTML('part', HQ.t('read.known'))}</div>
        <div class="rc"><span class="k">${HQ.t(r.l2.has && r.l2.side === 'ask' ? 'read.l2ask' : 'read.l2bid')}</span><span class="v num">${l2v}</span>${l2tag}</div>`;
    const wh = q('.whole'); wh.hidden = !!r.full; if (!r.full) wh.textContent = `${HQ.t('read.whole')} ${HQ.DASH} (${whyParts.join('; ')})`;
    if (!D.m4pick || D.m4pick.drop.px !== s.px) D.m4pick = null;
    renderTrace(q('.trace'), s, r);
    updateM4();
    q('.lw').textContent = HQ.t('read.win'); q('.lb').textContent = HQ.t('read.bucket');
    const sw = q('#rd-win'), sb = q('#rd-bucket');
    if (document.activeElement !== sw && sw.value !== String(D.win / 1000)) { if (![...sw.options].some((o) => o.value === String(D.win / 1000))) sw.add(new Option(`${D.win / 60000} min`, String(D.win / 1000))); sw.value = String(D.win / 1000); }
    if (document.activeElement !== sb && sb.value !== String(s.bucket)) sb.value = String(s.bucket);
    q('.rspan').textContent = HQ.fill(HQ.t('read.span'), { a: HQ.time(r.from), b: HQ.time(r.to) });
    const rp = q('.rprov');
    const noSample = () => HQ.prov('none', null, 0, HQ.t('prov.noSample'));
    const provenance = s.pinned ? HQ.prov('rec', s.pinAt, 0, HQ.t('read.pinShort'))
      : D.live ? (D.lastTradeAt ? HQ.prov('live', D.lastTradeAt, 15000) : noSample())
      : (frameAt(r.T) || r.covered > 0 ? HQ.prov('rec', r.T, 0) : noSample());
    rp.replaceChildren(provenance);
  }
  /* Historia poziomu: L2 przy wybranej cenie w każdej migawce nagrania, transakcje przy tej cenie (kupno w górę, sprzedaż w dół),
     przerwy w danych i kursor chwili. Odpowiada na pytanie: czy płynność na poziomie zjedzono, czy wycofano. Rysowane bez animacji. */
  function renderTrace(fig, s, r) {
    const svg = fig.querySelector('svg'); const W = 320, H = 64, mid = 40;
    // Oś zaczyna się od pierwszej migawki albo od kursora, jeśli kursor stoi wcześniej (np. skok do transakcji sprzed nagrania księgi).
    // W powtórce oś kończy się na kursorze: żadnych próbek z „przyszłości” względem chwili T.
    const a = D.frames.length ? Math.min(D.frames[0].t, r.T) : (D.start || r.T), b = D.live ? Date.now() : r.T;
    if (!D.frames.length || b - a < 2000) { svg.innerHTML = ''; fig.querySelector('figcaption').textContent = HQ.t('trace.wait'); return; }
    const x = (t) => ((t - a) / (b - a)) * W;
    const pts = []; let maxSz = 0;
    // Cena poza zakresem danej migawki (faktycznie otrzymane poziomy; publiczne l2Book daje do 20 na stronę) to brak danych, nie zero: linia ma wtedy przerwę.
    for (const fr of D.frames) {
      if (fr.t > b) break;
      const lo = fr.bids.length ? fr.bids[fr.bids.length - 1].px : null, hi = fr.asks.length ? fr.asks[fr.asks.length - 1].px : null;
      if (lo == null || hi == null || s.px < lo || s.px > hi) { pts.push([fr.t, null]); continue; }
      let sz = 0, rows = 0; for (const l of fr.bids) if (l.px >= s.px && l.px < s.px + s.bucket) { sz += l.sz; rows++; } for (const l of fr.asks) if (l.px >= s.px && l.px < s.px + s.bucket) { sz += l.sz; rows++; }
      if (fr.complete === false && (!rows || !isFinite(sz))) { pts.push([fr.t, null]); continue; }
      pts.push([fr.t, sz]); if (sz > maxSz) maxSz = sz;
    }
    const y = (v) => mid - 4 - (maxSz ? (v / maxSz) * (mid - 8) : 0);
    // Odcinki ciągłe: linia plus wypełnienie do osi. Zero = linia na osi z wypełnieniem zerowej wysokości; brak danych = brak linii i wypełnienia.
    const segs = []; let cur0 = null; pts.forEach(([t, v]) => { if (v == null) { cur0 = null; return; } if (!cur0) segs.push((cur0 = [])); cur0.push([x(t), y(v)]); });
    let path = '', area = ''; const base = mid - 4;
    segs.forEach((sg) => { const d = sg.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(''); path += d; area += d + `L${sg[sg.length - 1][0].toFixed(1)},${base}L${sg[0][0].toFixed(1)},${base}Z`; });
    const tr = []; let maxT = 0; const bars = [];
    for (let i = D.trades.length - 1; i >= 0; i--) { const t = D.trades[i]; if (t.t > b) continue; if (t.t < a) break; if (t.px >= s.px && t.px < s.px + s.bucket) { bars.push(t); if (t.sz > maxT) maxT = t.sz; } }
    bars.forEach((t) => { const h = Math.max(2, (t.sz / maxT) * 20); tr.push(`<rect x="${(x(t.t) - 1).toFixed(1)}" y="${mid + 2}" width="2" height="${h.toFixed(1)}" fill="var(${t.side === 'buy' ? '--buy' : '--sell'})"/>`); });
    const gaps = allGaps().map((g) => `<rect x="${x(Math.max(g.from, a)).toFixed(1)}" y="0" width="${Math.max(1, x(g.to) - x(Math.max(g.from, a))).toFixed(1)}" height="${H}" fill="url(#hq-hatch)"/>`).join('');
    const cur = D.live ? '' : `<line x1="${x(r.T).toFixed(1)}" x2="${x(r.T).toFixed(1)}" y1="0" y2="${H}" stroke="var(--notch)" stroke-width="2"/>`;
    const win = `<rect x="${x(Math.max(r.from, a)).toFixed(1)}" y="0" width="${Math.max(0, x(r.to) - x(Math.max(r.from, a))).toFixed(1)}" height="${H}" fill="var(--lume)" opacity=".07"/>`;
    let pick = '';
    const pk = D.m4pick; if (pk && pk.drop && pk.drop.px === s.px) {
      // Oś historii liczona w czasie odbioru; uskok i wydruk w czasie giełdy (przybliżenie makiety: zegary zsynchronizowane NTP)
      const xa = Math.max(0, x(pk.drop.A.t)), xb = Math.min(W, x(pk.drop.B.t));
      if (xb > 0 && xa < W) pick += `<rect x="${xa.toFixed(1)}" y="0" width="${Math.max(2, xb - xa).toFixed(1)}" height="${H}" fill="none" stroke="var(--notch)" stroke-width="1.5" stroke-dasharray="3 2"/>`;
      if (pk.trade) { const xt = x(pk.trade.t); if (xt >= 0 && xt <= W) pick += `<circle cx="${xt.toFixed(1)}" cy="${mid + 10}" r="3.5" fill="var(${pk.trade.side === 'buy' ? '--buy' : '--sell'})" stroke="var(--ink-1)"/>`; }
    }
    svg.innerHTML = `<defs><pattern id="hq-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--warn)" opacity=".45"/></pattern></defs>${win}<line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--line-strong)"/>${gaps}${area ? `<path d="${area}" fill="var(--lume)" opacity=".14"/>` : ''}${path ? `<path d="${path}" fill="none" stroke="var(--ink-2)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` : ''}${tr.join('')}${cur}${pick}`;
    const known = pts.filter((p) => p[1] != null); const first = known.length ? known[0][1] : null, last = known.length ? known[known.length - 1][1] : null;
    const szd = D.coin === 'BTC' ? 3 : 1;
    fig.querySelector('figcaption').textContent = HQ.fill(HQ.t('trace.cap'), { a: HQ.time(a), first: first == null ? HQ.DASH : HQ.fmt(first, szd), last: last == null ? HQ.DASH : HQ.fmt(last, szd), u: unit(), n: bars.length, g: allGaps().length });
  }
  /* ---------- M4 „Co było pierwsze?” w pasku odczytu ---------- */
  const spansFrom = (from) => {
    if (from == null) return []; const out = []; let cur = from;
    for (const g of allGaps().slice().sort((a, b) => a.from - b.from)) { if (g.to <= cur) continue; if (g.from > cur) out.push([cur, g.from]); cur = Math.max(cur, g.to); }
    if (cur <= Date.now()) out.push([cur, Date.now() + 1]); return out;
  };
  /* Wejście z taśmy: zatrzymaj taśmę, wybierz transakcję, pytanie z gotowym wydrukiem, powrót do tej samej transakcji */
  const tradeId = (t) => String(t.id || t.t);
  function renderTapePick(focusId, hint = true) {
    const n = D.tapeFrozenN, tb = $('#tape tbody'); const pl = HQ.lang === 'pl'; const szd = D.coin === 'BTC' ? 5 : 2; const out = [];
    const ft = D.focusTrade && !D.live ? D.focusTrade : null;
    const firstId = n ? tradeId(D.trades[n - 1]) : null; const tabId = focusId || D.tapePicked || firstId;
    for (let i = n - 1; i >= Math.max(0, n - 80); i--) {
      const t = D.trades[i]; const id = tradeId(t); const b = t.side === 'buy'; const usd = t.px * t.sz;
      const lab = `${HQ.t('m4.pickAria')}: ${HQ.time(t.t)} · ${b ? (pl ? 'kupno' : 'buy') : (pl ? 'sprzedaż' : 'sell')} ${HQ.fmt(t.sz, szd)} ${unit()} · ${HQ.fmt(t.px, D.dec)} USD`;
      const isM = ft && t.id === ft.id && t.t === ft.t;
      out.push(`<tr class="pick${usd >= BIG ? ' big' : ''}${D.tapePicked === id ? ' picked' : ''}${isM ? ' moment' : ''}${inSel(t.px) ? ' selpx' : ''}"${isM ? ' id="tape-moment"' : ''}><td><button type="button" class="tpick" data-tid="${id}" tabindex="${id === tabId ? 0 : -1}" aria-label="${lab}">${HQ.time(t.t)}</button></td><td><span class="side ${b ? 'buy' : 'sell'}" aria-hidden="true">${b ? '▲' : '▼'}</span></td><td class="num ${b ? 'buy' : 'sell'}">${HQ.fmt(t.px, D.dec)}</td><td class="num">${HQ.fmt(t.sz, szd)}</td><td class="num">${HQ.fmtUsdShort(usd)}</td></tr>`);
    }
    tb.innerHTML = out.join('') || `<tr><td colspan="5" class="muted">${HQ.t(D.tapeLostThrough != null ? 'd.tapeEvicted' : 'd.noTrades')}</td></tr>`;
    const fz = $('#tape-frz'); fz.hidden = !hint; if (hint) fz.textContent = HQ.fill(HQ.t('m4.frozen'), { n: Math.max(0, tradesUpTo(at()) - n) });
    if (focusId) { const f = tb.querySelector(`.tpick[data-tid="${focusId}"]`); if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'center' }); } } // środek: wiersz nie chowa się pod przyklejonym nagłówkiem panelu ani strony
  }
  function enterPick() { D.tapeFrozen = true; D.tapeFrozenN = tradesUpTo(at()); const b = $('#tape-ask'); b.textContent = HQ.t('m4.resume'); b.dataset.on = 'true'; renderTapePick(); const f = $('#tape .tpick[tabindex="0"]'); if (f) f.focus(); say(HQ.fill(HQ.t('m4.frozen'), { n: 0 })); }
  function exitPick() { D.tapeFrozen = false; D.tapePicked = null; const b = $('#tape-ask'); b.textContent = HQ.t('m4.ask'); b.dataset.on = 'false'; $('#tape-frz').hidden = true; renderAll(); b.focus(); }
  function pickTrade(id) {
    let tr = null; for (let i = D.tapeFrozenN - 1; i >= 0; i--) if (tradeId(D.trades[i]) === id) { tr = D.trades[i]; break; }
    if (!tr) return;
    D.tapePicked = id; D.sel = { px: tr.px, bucket: 1, pinned: false }; saveCtx();
    if ($('#insp').dataset.split !== 'true') $('#t-book').click(); else renderAll();
    renderRead(); if (D.m4view) D.m4view.open(tr);
  }
  function setupTapePick() {
    const b = $('#tape-ask'); if (!b) return;
    b.addEventListener('click', () => (D.tapeFrozen ? exitPick() : enterPick()));
    const tape = $('#tape');
    tape.addEventListener('click', (e) => { if (!D.tapeFrozen && D.live) return; const btn = e.target.closest('.tpick') || (e.target.closest('tr.pick') && e.target.closest('tr.pick').querySelector('.tpick')); if (btn) pickTrade(btn.dataset.tid); });
    tape.addEventListener('keydown', (e) => {
      if (!D.tapeFrozen && D.live) return; const btns = [...tape.querySelectorAll('.tpick')]; const i = btns.indexOf(document.activeElement); if (i < 0) return;
      let j = null; if (e.key === 'ArrowDown') j = Math.min(btns.length - 1, i + 1); else if (e.key === 'ArrowUp') j = Math.max(0, i - 1); else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = btns.length - 1;
      else if (e.key === 'Escape' && D.tapeFrozen) { e.preventDefault(); e.stopPropagation(); exitPick(); return; }
      if (j != null) { e.preventDefault(); e.stopPropagation(); btns[i].tabIndex = -1; btns[j].tabIndex = 0; btns[j].focus(); }
    });
  }
  let m4LastAt = 0;
  function setupM4(el) {
    D.m4view = HQ.m4.view(el, {
      px: () => (D.sel ? D.sel.px : null), bucket: () => (D.sel ? D.sel.bucket : 1),
      get unit() { return D.coin === 'BTC' ? 0.00001 : 0.0001; }, get szd() { return D.coin === 'BTC' ? 5 : 4; }, get u() { return unit(); },
      frames: () => D.raw, trades: () => D.trades, cursor: () => at(),
      // Limit taśmy nie usuwa niezależnego pokrycia księgi.
      bookSpans: () => spansFrom(D.raw.length ? D.raw[0].t : null), tapeSpans: () => spansFrom(tapeStart()),
      bookClock: 'exchange', tapeClock: 'exchange', utc: false,
      onPick: (cur) => { D.m4pick = cur; m4LastAt = 0; renderRead(); },
      onBack: (tr) => { if (D.live && !D.tapeFrozen) enterPick(); if ($('#insp').dataset.split !== 'true') $('#t-tape').click(); if (!D.live) D.tapeFrozenN = tradesUpTo(at()); renderTapePick(tradeId(tr), D.tapeFrozen); },
      sourceLine: () => HQ.fill(HQ.t('m4.src'), { n: D.raw.filter((f) => f.exact === true).length, t: D.raw.length ? HQ.time(D.raw[0].t) : HQ.DASH, g: allGaps().length, ts: tapeStart() == null ? HQ.DASH : HQ.time(tapeStart()) }),
    });
  }
  function updateM4(force) { if (!D.m4view) return; const now = Date.now(); if (!force && now - m4LastAt < 1000) return; m4LastAt = now; D.m4view.update(); }
  let annRT = null;
  function announceRead() {
    clearTimeout(annRT);
    annRT = setTimeout(() => { if (!D.sel) return; const r = readAt(D.sel.px, D.sel.bucket, at()); const szd = D.coin === 'BTC' ? 4 : 2; say(HQ.fill(HQ.t('read.say'), { px: HQ.fmt(D.sel.px, D.dec), d: r.n === 0 ? (r.full ? '0' : HQ.t('read.unknown')) : HQ.fmtSigned(r.delta, szd), u: unit(), c: Math.round(r.covered / 1000), w: Math.round(r.W / 1000) })); }, 450);
  }

  function renderTape(n, dec) {
    provFor($('#tape-prov'), D.lastTradeAt, 15000, n ? D.trades[n - 1].t : null);
    // Taśma zatrzymana do wyboru wydruku: wiersze się nie przebudowują (fokus i cel wyboru stoją), licznik nowych transakcji rośnie
    if (D.tapeFrozen) { const fz = $('#tape-frz'); if (fz) fz.textContent = HQ.fill(HQ.t('m4.frozen'), { n: Math.max(0, n - D.tapeFrozenN) }); return; }
    // Powtórka: taśma stoi sama z siebie, więc czas transakcji jest od razu przyciskiem pytania (bez trybu zatrzymania); przebudowa tylko przy zmianie kursora
    if (!D.live && n) { const sig = [n, D.sel ? D.sel.px : '', D.tapePicked, HQ.lang, D.focusTrade ? D.focusTrade.t : ''].join('|'); if (sig !== D.tapeSig) { D.tapeSig = sig; D.tapeFrozenN = n; renderTapePick(null, false); } return; }
    D.tapeSig = '';
    const tb = $('#tape tbody');
    if (!n) { tb.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:left;height:48px;white-space:normal">${D.live ? HQ.DASH + ' ' + HQ.t('book.empty.' + (D.status === 'live' ? 'connecting' : D.status)) : HQ.t(tapeEvictedAt(D.cursor) ? 'd.tapeEvicted' : 'd.noTrades')}</td></tr>`; return; }
    const pl = HQ.lang === 'pl'; const szd = D.coin === 'BTC' ? 5 : 2; const out = [];
    const ft = D.focusTrade && !D.live ? D.focusTrade : null;
    for (let i = n - 1; i >= Math.max(0, n - 80); i--) {
      const t = D.trades[i]; const usd = t.px * t.sz; const b = t.side === 'buy';
      const isM = ft && t.id === ft.id && t.t === ft.t; const sel = inSel(t.px);
      out.push(`<tr class="${usd >= BIG ? 'big' : ''}${isM ? ' moment' : ''}${sel ? ' selpx' : ''}"${isM ? ' id="tape-moment"' : ''}><td>${HQ.time(t.t)}</td><td><span class="side ${b ? 'buy' : 'sell'}" aria-hidden="true">${b ? '▲' : '▼'}</span><span class="vh">${b ? (pl ? 'kupno' : 'buy') : (pl ? 'sprzedaż' : 'sell')}</span></td><td class="${b ? 'buy' : 'sell'}">${HQ.fmt(t.px, dec)}</td><td>${HQ.fmt(t.sz, szd)}</td><td>${HQ.fmtUsdShort(usd)}</td></tr>`);
    }
    tb.innerHTML = out.join('');
  }
  function renderNums(fr, dec) {
    const c = D.ctx; const g = $('#numgrid'); provFor($('#num-prov'), c ? D.ctxAt : null, 90000);
    if (!D.live) { $('#num-prov').innerHTML = ''; if (c) $('#num-prov').append(HQ.prov('live', D.ctxAt, 90000)); }
    const mid = fr && fr.asks[0] && fr.bids[0] ? (fr.asks[0].px + fr.bids[0].px) / 2 : null;
    const items = [['d.n.mark', c ? HQ.fmt(c.mark, dec) : HQ.DASH], ['d.n.mid', HQ.fmt(mid, dec + 1)], ['d.n.prev', c ? HQ.fmt(c.prev, dec) : HQ.DASH], ['d.n.fund', c ? HQ.fmtPct(c.funding * 100, 4) : HQ.DASH], ['d.funding', c ? HQ.fmtPct(c.fundingApr, 2) : HQ.DASH], ['d.oi', c ? HQ.fmtUsd(c.oiUsd) : HQ.DASH], ['d.vol', c ? HQ.fmtUsd(c.vlm) : HQ.DASH]];
    g.innerHTML = items.map(([k, v]) => `<div><dt class="k">${HQ.t(k)}</dt><dd class="v" style="margin:0">${v}</dd></div>`).join('') + (c ? '' : `<p class="muted" style="grid-column:1/-1;padding:10px 12px;margin:0;background:var(--s1)">${HQ.t('nums.none')}</p>`);
  }

  /* ---------- Pasek stanu sesji: opóźnienie, utrata, pauza, przerwa pod kursorem — z działaniem ---------- */
  function setupBanner() {
    $('#sbanner').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'now') { if (D.paused) resume(); else if (D.feed) D.feed.now(); }
      if (b.dataset.act === 'live') goLive();
    });
  }
  function renderBanner() {
    const el = $('#sbanner'); if (!el) return;
    const now = Date.now(); let kind = null, msg = '', act = '';
    const offline = navigator.onLine === false || HQ.simState === 'offline';
    if (D.paused) { kind = 'warn'; msg = HQ.fill(HQ.t('ban.paused'), { t: HQ.time(D.connSince) }); act = `<button type="button" class="btn btn-line btn-s" data-act="now">${HQ.t('v.ust.resume')}</button>`; }
    else if (offline) { kind = 'warn'; msg = HQ.t('ban.offline'); act = `<button type="button" class="btn btn-line btn-s" data-act="now">${HQ.t('ban.retry')}</button>`; }
    else if (D.status === 'reconnecting') { const s = D.retryAt ? Math.max(0, Math.ceil((D.retryAt - now) / 1000)) : null; kind = 'warn'; msg = HQ.fill(HQ.t('ban.lost'), { t: HQ.time(D.gapFrom || D.connSince), s: s == null ? '…' : s }); act = `<button type="button" class="btn btn-line btn-s" data-act="now">${HQ.t('ban.now')}</button>`; }
    else if (D.status === 'connecting' && now - D.connSince > 5000) { kind = 'info'; msg = HQ.fill(HQ.t('ban.slow'), { s: Math.round((now - D.connSince) / 1000) }); act = `<button type="button" class="btn btn-line btn-s" data-act="now">${HQ.t('ban.now')}</button>`; }
    else if (D.live && bookKind(frameAt(now)) === 'stale') { kind = 'warn'; msg = HQ.fill(HQ.t('ban.stale'), { s: Math.round((now - D.bookAt) / 1000) }); act = `<button type="button" class="btn btn-line btn-s" data-act="now">${HQ.t('ban.now')}</button>`; }
    else if (!D.live && tapeEvictedAt(D.cursor)) { kind = 'info'; msg = HQ.fill(HQ.t('read.tapeEvicted'), { t: HQ.time(D.tapeLostThrough) }); act = `<button type="button" class="btn btn-line btn-s" data-act="live">${HQ.t('d.back')}</button>`; }
    else if (!D.live && gapAt(D.cursor)) { const g = gapAt(D.cursor); kind = 'info'; msg = HQ.fill(HQ.t('ban.inGap'), { a: HQ.time(g.from), b: HQ.time(g.to) }); act = `<button type="button" class="btn btn-line btn-s" data-act="live">${HQ.t('d.back')}</button>`; }
    else if (D.restoredMsg) { kind = 'info'; msg = D.restoredMsg; }
    const key = kind ? kind + msg.replace(/\d+ s/g, '') : '';
    if (!kind) { el.hidden = true; el.dataset.key = ''; return; }
    el.hidden = false; el.dataset.kind = kind;
    if (el.dataset.key !== key || el.querySelector('.msg').textContent !== msg) { el.querySelector('.msg').textContent = msg; if (el.dataset.key !== key) el.querySelector('.act').innerHTML = act; el.dataset.key = key; }
  }

  /* ---------- Oś czasu: nagranie z tej karty, przerwy, skoki po dużych transakcjach ---------- */
  function setupScrub() {
    const sc = $('#scrub');
    sc.addEventListener('input', () => { D.live = false; D.cursor = +sc.value; D.focusTrade = null; D.restoredMsg = null; if (D.cursor >= +sc.max) { goLive(); return; } $('#live-btn').setAttribute('aria-pressed', 'false'); renderAll(); announceCursor(); saveCtx(); });
    sc.addEventListener('keydown', (e) => {
      if (e.key === 'End') { e.preventDefault(); goLive(); return; }
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); const v = Math.min(+sc.max, Math.max(+sc.min, (D.live ? +sc.max : D.cursor) + (e.key === 'ArrowLeft' ? -10000 : 10000))); sc.value = String(v); sc.dispatchEvent(new Event('input')); }
    });
    $('#live-btn').addEventListener('click', goLive);
    $('#jump-prev').addEventListener('click', () => jump(-1));
    $('#jump-next').addEventListener('click', () => jump(1));
    document.addEventListener('keydown', (e) => {
      if (isTyping(e) || $('#v-sesja').dataset.on !== 'true' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'l' || e.key === 'L') goLive();
      else if (e.key === '[') { e.preventDefault(); jump(-1); }
      else if (e.key === ']') { e.preventDefault(); jump(1); }
    });
    setInterval(renderMarks, 2000);
  }
  // Kotwica chwili: kursor na czasie transakcji ≥ 25 tys. USD; ta sama chwila w osi, taśmie, księdze i odczycie
  function jump(dir) {
    const ref = D.live ? Date.now() : D.cursor; const T = D.trades;
    let hit = null;
    if (dir < 0) { for (let i = T.length - 1; i >= 0; i--) { const t = T[i]; if (t.t < ref - 1 && t.px * t.sz >= JUMP) { hit = t; break; } } }
    else { for (let i = 0; i < T.length; i++) { const t = T[i]; if (t.t > ref + 1 && t.px * t.sz >= JUMP) { hit = t; break; } } }
    if (!hit) { say(HQ.t(dir < 0 ? 'jump.noneBack' : 'jump.noneFwd')); flashJump(dir); return; }
    D.live = false; D.cursor = hit.t; D.focusTrade = hit; D.restoredMsg = null;
    if (!(D.sel && D.sel.pinned)) { const b = D.sel ? D.sel.bucket : 1; D.sel = { px: b > 1 ? Math.floor(hit.px / b) * b : hit.px, bucket: b, pinned: false }; }
    const sc = $('#scrub'); sc.value = String(hit.t); $('#live-btn').setAttribute('aria-pressed', 'false');
    // Na tablecie i telefonie panel z taśmą musi być widoczny, żeby było widać powiązanie
    const tapeTab = document.querySelector('#t-tape'); const split = document.querySelector('#t-split');
    if (!isTablet() && tapeTab && document.querySelector('#t-book').getAttribute('aria-selected') !== 'true' && tapeTab.getAttribute('aria-selected') !== 'true') document.querySelector('#t-book').click();
    renderAll(); saveCtx();
    const m = document.getElementById('tape-moment'); if (m) m.scrollIntoView({ block: 'nearest', behavior: HQ.reduced() ? 'auto' : 'smooth' });
    say(HQ.fill(HQ.t('jump.say'), { t: HQ.time(hit.t), side: HQ.t(hit.side === 'buy' ? 'side.buy' : 'side.sell'), sz: HQ.fmt(hit.sz, D.coin === 'BTC' ? 5 : 2), u: unit(), px: HQ.fmt(hit.px, D.dec), usd: HQ.fmtUsdShort(hit.px * hit.sz) }));
    void split;
  }
  function flashJump(dir) { const b = $(dir < 0 ? '#jump-prev' : '#jump-next'); b.classList.remove('nope'); void b.offsetWidth; if (!HQ.reduced()) b.classList.add('nope'); }
  function goLive() { if (D.live) return; D.live = true; D.cursor = null; D.focusTrade = null; const sc = $('#scrub'); sc.value = sc.max; $('#live-btn').setAttribute('aria-pressed', 'true'); renderAll(); say(HQ.t('d.live')); saveCtx(); HQ.sweep($('.dtime'), 'surface'); }
  let annT = null;
  function announceCursor() { clearTimeout(annT); annT = setTimeout(() => { const g = gapAt(D.cursor); say(`${HQ.t('prov.rec')} · ${HQ.time(D.cursor)}${g ? ' · ' + HQ.t('ban.inGapShort') : ''}`); }, 700); }
  function renderTime() {
    const sc = $('#scrub'); const lab = $('#tlabel');
    if (!D.start) { lab.textContent = HQ.t('d.recWait'); sc.disabled = true; return; }
    sc.disabled = false;
    if (D.live) { lab.innerHTML = HQ.fill(HQ.t('d.rec'), { t: `<b>${HQ.time(D.start)}</b>` }); sc.setAttribute('aria-valuetext', `${HQ.t('d.live')} · ${HQ.fill(HQ.t('d.rec'), { t: HQ.time(D.start) })}`); }
    else { const g = gapAt(D.cursor); lab.innerHTML = HQ.fill(HQ.t('d.atCursor'), { t: `<b>${HQ.time(D.cursor)}</b>`, ago: HQ.ago(D.cursor) }) + (g ? ` · <span class="gaptxt">${HQ.t('ban.inGapShort')}</span>` : ''); sc.setAttribute('aria-valuetext', `${HQ.time(D.cursor)}, ${HQ.ago(D.cursor)}${g ? ', ' + HQ.t('ban.inGapShort') : ''}`); }
    const n = D.gaps.length + (D.gapFrom ? 1 : 0); const gl = $('#gaps-lbl'); if (gl) { gl.hidden = n === 0; gl.textContent = HQ.fill(HQ.t('d.gaps'), { n }); }
  }
  function renderMarks() {
    const box = $('#marks'); const a = D.start || Date.now(), b = Math.max(a + 1000, Date.now()); const out = []; const pos = (t) => (((t - a) / (b - a)) * 100).toFixed(2);
    allGaps().forEach((g) => out.push(`<i class="gap" style="left:${pos(g.from)}%;width:${Math.max(0.4, ((g.to - g.from) / (b - a)) * 100).toFixed(2)}%" title="${HQ.fill(HQ.t('read.gap'), { a: HQ.time(g.from), b: HQ.time(g.to) })}"></i>`));
    if (D.start != null && tapeEvictedAt(a)) out.push(`<i class="gap" style="left:0;width:${Math.max(0.4, pos(Math.min(b, D.tapeLostThrough)))}%" title="${HQ.fill(HQ.t('read.tapeEvicted'), { t: HQ.time(D.tapeLostThrough) })}"></i>`);
    let k = 0;
    for (let i = D.trades.length - 1; i >= 0 && k < 160; i--) { const t = D.trades[i]; if (t.t < a) break; if (t.px * t.sz >= JUMP) { k++; out.push(`<i class="${t.px * t.sz >= BIG ? 'big' : ''}" style="left:${pos(t.t)}%;background:var(${t.side === 'buy' ? '--buy' : '--sell'})"></i>`); } }
    if (D.focusTrade && !D.live) out.push(`<i class="momentmark" style="left:${pos(D.focusTrade.t)}%"></i>`);
    box.innerHTML = out.join('');
  }

  /* ---------- Doba ---------- */
  function renderDay() {
    const now = Date.now(); const s = HQ.sessions(now); const el = $('#dday'); el.innerHTML = '';
    s.list.forEach((x) => { const d = document.createElement('div'); d.className = 'seg2'; d.dataset.s = x.id; d.style.left = ((x.from - s.d0) / 864e5) * 100 + '%'; d.style.width = ((x.to - x.from) / 864e5) * 100 + '%'; el.append(d); });
    const n = document.createElement('div'); n.className = 'nowx'; n.style.left = s.frac * 100 + '%'; el.append(n);
    el.setAttribute('aria-label', `${HQ.t('now')} ${HQ.time(now, false)} · ${HQ.t('s.' + s.cur.id)} · ${HQ.span(s.cur.to - now)}`);
    el.title = el.getAttribute('aria-label');
  }

  /* ---------- Karty panelu ---------- */
  function setupTabs() {
    const all = [...document.querySelectorAll('#insp [role="tab"]')];
    const insp = $('#insp');
    const tabletQ = matchMedia('(min-width: 761px) and (max-width: 1100px)');
    const visible = () => all.filter((t) => getComputedStyle(t).display !== 'none');
    const sel = (t, focus) => {
      const ids = t.getAttribute('aria-controls').split(' ');
      all.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
      document.querySelectorAll('#insp [role="tabpanel"]').forEach((p) => (p.dataset.on = String(ids.includes(p.id))));
      insp.dataset.split = String(t.id === 't-split');
      if (focus) t.focus();
      HQ.pref('tab', t.id); renderAll(); saveCtx();
    };
    all.forEach((t) => {
      t.addEventListener('click', () => sel(t));
      t.addEventListener('keydown', (e) => {
        const v = visible(); const i = v.indexOf(t); const k = e.key; let j = null;
        if (k === 'ArrowRight') j = (i + 1) % v.length; else if (k === 'ArrowLeft') j = (i - 1 + v.length) % v.length; else if (k === 'Home') j = 0; else if (k === 'End') j = v.length - 1;
        if (j != null) { e.preventDefault(); sel(v[j], true); }
      });
    });
    const fit = () => { const cur = all.find((x) => x.getAttribute('aria-selected') === 'true'); if (tabletQ.matches && (cur.id === 't-book' || cur.id === 't-tape')) sel($('#t-split')); else if (!tabletQ.matches && cur.id === 't-split') sel($('#t-book')); };
    const pref = HQ.pref('tab'); const pt = pref && document.getElementById(pref); if (pt && pt.id !== 't-split') sel(pt);
    tabletQ.addEventListener && tabletQ.addEventListener('change', fit); fit();
  }

  /* ---------- Pomoc „?” i podpowiedź pierwszej wizyty ---------- */
  function setupHelp() {
    const btn = $('#help-btn'), pop = $('#help');
    const open = () => { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); pop.querySelector('h2').focus(); };
    const close = (refocus = true) => { if (pop.hidden) return; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); };
    btn.addEventListener('click', () => (pop.hidden ? open() : close()));
    pop.querySelector('[data-close]').addEventListener('click', () => close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); close(); return; }
      if (e.key === '?' && !isTyping(e) && $('#v-sesja').dataset.on === 'true') { e.preventDefault(); pop.hidden ? open() : close(); }
    });
    const hint = $('#sel-hint');
    if (hint) hint.querySelector('button').addEventListener('click', () => { HQ.pref('hint1', true); hint.hidden = true; const t = document.querySelector('#ladder .pbtn[tabindex="0"]'); if (t) t.focus(); });
  }

  /* ---------- Paleta poleceń ---------- */
  function setupPalette() {
    const pal = $('#pal'), back = $('#pal-back'), input = $('#pal-input'), list = $('#pal-list');
    let items = [], act = 0, opener = null;
    const all = () => [
      { g: 'views', l: HQ.t('d.today'), run: () => HQ.go('dzis', true) },
      { g: 'views', l: HQ.t('v.przed.h'), run: () => HQ.go('przed', true) },
      { g: 'views', l: HQ.t('d.in'), run: () => HQ.go('sesja', true) },
      { g: 'views', l: HQ.t('v.po.h'), run: () => HQ.go('po', true) },
      { g: 'views', l: HQ.t('d.proof'), run: () => HQ.go('po', true) },
      { g: 'views', l: HQ.t('d.settings'), run: () => HQ.go('ustawienia', true) },
      { g: 'views', l: HQ.t('d.home'), run: () => (location.href = 'index.html') },
      { g: 'markets', l: 'BTC-PERP', run: () => switchMarket('BTC', true) },
      { g: 'markets', l: 'GOLD', run: () => switchMarket('xyz:GOLD', true) },
      { g: 'markets', l: 'S&P 500', run: () => switchMarket('xyz:SP500', true) },
      { g: 'actions', l: HQ.t('d.pal.live'), run: () => { HQ.go('sesja', false); goLive(); } },
      { g: 'actions', l: HQ.t('pal.prev'), run: () => { HQ.go('sesja', false); jump(-1); } },
      { g: 'actions', l: HQ.t('pal.next'), run: () => { HQ.go('sesja', false); jump(1); } },
      { g: 'actions', l: HQ.t('pal.clearSel'), run: () => clearSel() },
      { g: 'actions', l: HQ.t('pal.help'), run: () => { HQ.go('sesja', false); $('#help-btn').click(); } },
      { g: 'actions', l: HQ.t('d.pal.motion'), run: () => HQ.setMotion(HQ.motionPref === 'reduced' ? 'system' : 'reduced') },
      { g: 'actions', l: HQ.t('d.pal.theme'), run: () => HQ.setTheme(HQ.theme === 'deep' ? 'paper' : 'deep') },
      { g: 'actions', l: HQ.t('d.pal.lang'), run: () => HQ.setLang(HQ.lang === 'pl' ? 'en' : 'pl') },
    ];
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Wpisana cena (np. 60000, 60 000, 60k) staje się podglądem poziomu: odległość od środka księgi i ilość, jeśli poziom jest widoczny
    const levelItem = (raw) => {
      const m = raw.replace(/\s/g, '').replace(',', '.').match(/^(\d+(?:\.\d+)?)(k)?$/i);
      const fr = HQ.desk.frame();
      if (!m || !fr || !fr.bids[0] || !fr.asks[0]) return null;
      const v = parseFloat(m[1]) * (m[2] ? 1000 : 1);
      const mid = (fr.bids[0].px + fr.asks[0].px) / 2;
      if (!isFinite(v) || v < mid * 0.5 || v > mid * 1.5) return null;
      const pct = (v / mid - 1) * 100;
      // Zakres zmierzony: od najgłębszego do najlepszego poziomu każdej strony. W pełnej migawce cena wewnątrz zakresu
      // bez zlecenia ma 0 (jak odczyt po Enter); między najlepszym BID i ASK jest spread; poza zakresem nie wiemy.
      const bidLo = fr.bids[fr.bids.length - 1].px, bidHi = fr.bids[0].px, askLo = fr.asks[0].px, askHi = fr.asks[fr.asks.length - 1].px;
      const full = fr.complete !== false;
      const exact = fr.bids.concat(fr.asks).find((l) => Math.abs(l.px - v) < 1e-9);
      const side = v <= bidHi && v >= bidLo ? 'BID' : v >= askLo && v <= askHi ? 'ASK' : '';
      const inSpread = v > bidHi && v < askLo;
      const key = exact || (side && full) ? 'd.pal.levelIn' : inSpread && full ? 'd.pal.levelSpread' : 'd.pal.levelOut';
      const kind = bookKind(fr);
      const sub = kind === 'stale' ? `${HQ.DASH} · ${HQ.time(fr.t)}` : HQ.fill(HQ.t(key), {
        pct: HQ.fmtPct(pct, 2), sz: HQ.fmt(exact ? exact.sz : 0, 4),
        side: exact ? (fr.bids.includes(exact) ? 'BID' : 'ASK') : side, unit: unit(), t: HQ.time(fr.t),
      });
      // Świeżość jak w drabince: na żywo po limicie księgi STALE, w powtórce REC
      return { g: 'level', l: `${HQ.fmt(v, D.dec)} USD`, sub, kind, run: () => HQ.desk.select(v) };
    };
    const draw = () => {
      const q = norm(input.value.trim()); items = all().filter((x) => !q || norm(x.l).includes(q));
      const li = levelItem(input.value.trim()); if (li) items.unshift(li);
      act = Math.min(act, Math.max(0, items.length - 1));
      const gl = { views: HQ.t('d.pal.views'), markets: HQ.t('d.pal.markets'), actions: HQ.t('d.pal.actions'), level: HQ.t('d.pal.level') };
      list.innerHTML = items.length ? items.map((x, i) => `<li role="option" id="po-${i}" aria-selected="${i === act}"${x.sub ? ' data-level="true"' : ''}><span class="pl"><b>${x.l}</b>${x.sub ? `<small>${x.sub} <span class="prov" data-kind="${x.kind}"><b>${{ live: 'LIVE', stale: 'STALE', rec: 'REC' }[x.kind]}</b></span></small>` : ''}</span><span class="g">${gl[x.g]}</span></li>`).join('') : `<li role="option" aria-disabled="true" aria-selected="false">${HQ.t('d.pal.empty')}</li>`;
      input.setAttribute('aria-activedescendant', items.length ? 'po-' + act : '');
      const a = $('#po-' + act); if (a) a.scrollIntoView({ block: 'nearest' });
    };
    refreshLevel = () => {
      if (pal.dataset.open !== 'true') return;
      const cur = items[0] && items[0].g === 'level' ? items[0] : null;
      const next = levelItem(input.value.trim());
      if ((cur || next) && (!cur || !next || cur.kind !== next.kind || cur.sub !== next.sub)) draw();
    };
    const open = (from) => { opener = from || document.activeElement; act = 0; input.value = ''; pal.dataset.open = back.dataset.open = 'true'; draw(); input.focus(); };
    // Powrót fokusu: element, z którego otwarto paletę; gdy to było body (skrót / lub ⌘K), widoczny przycisk wyszukiwania
    const close = (refocus = true) => { pal.dataset.open = back.dataset.open = 'false'; if (!refocus) return;
      const ok = (el) => el && el !== document.body && el.focus && document.contains(el) && el.offsetParent !== null;
      const target = ok(opener) ? opener : [...document.querySelectorAll('[data-open-pal]')].find(ok);
      if (target) target.focus(); };
    const run = (i) => { const x = items[i]; if (!x) return; close(); x.run(); };
    document.querySelectorAll('[data-open-pal]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); open(b); }));
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pal.dataset.open === 'true' ? close() : open(); }
      else if (e.key === '/' && !isTyping(e) && pal.dataset.open !== 'true') { e.preventDefault(); open(); }
    });
    input.addEventListener('input', () => { act = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); act = items.length ? (act + 1) % items.length : 0; draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = items.length ? (act - 1 + items.length) % items.length : 0; draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(act); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); close(); }
    });
    list.addEventListener('click', (e) => { const li = e.target.closest('li[id]'); if (li) run(+li.id.slice(3)); });
    back.addEventListener('click', () => close());
    document.addEventListener('hq:lang', () => { if (pal.dataset.open === 'true') draw(); });
  }

  HQ.session = { D, switchMarket, pause, resume, reconnect, goLive, renderAll, jump, clearSel, focusSelection: () => { const b = (D.lastFocusPx != null && document.querySelector(`#ladder .pbtn[data-px="${D.lastFocusPx}"]`)) || document.querySelector('#ladder .pbtn[tabindex="0"]'); if (b) b.focus({ preventScroll: false }); return !!b; }, say: (m) => say(m) };
  const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  let sayT = null;
  function say(msg) { const st = $('#st'); if (!st) return; clearTimeout(sayT); st.textContent = ''; sayT = setTimeout(() => (st.textContent = msg), 60); }
})();
