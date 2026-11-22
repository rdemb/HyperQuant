/* M4 · „Co było pierwsze?” — kolejność wydruku względem obserwowanego uskoku w księdze.
   Reguła:
   - uskok: spadek ilości o ≥ 1 minimalną jednostkę między dwiema KOLEJNYMI dokładnymi migawkami A < B,
     na tej samej cenie i stronie, obie mierzalne, w jednym pokrytym odcinku księgi;
   - czas giełdy w całkowitych ms; wydruk wybierany niezależnie;
   - t < A → wydruk wcześniej; t > B → wydruk później (zmiana księgi wcześniej); A ≤ t ≤ B → nieustalone;
   - nieporównywalne zegary → nieustalone; pokazujemy rzeczywistą szerokość B − A;
   - sama różnica ilości nie mówi, czy zlecenia anulowano, czy wykonano, ani kto to zrobił. */
(function () {
  const HQ = window.HQ; const M4 = (HQ.m4 = {});
  const P = (l) => (Array.isArray(l) ? l[0] : l.px), S = (l) => (Array.isArray(l) ? l[1] : l.sz);

  /* Ilość na cenie po stronie: { v } albo { v: null, why }.
     Strona musi być poprawna (ceny i ilości skończone, > 0, ściśle monotoniczne, bez powtórzeń), a cena w jej faktycznym zakresie.
     Brak wiersza w zakresie = 0 wyłącznie przy stronie oznaczonej jako kompletna (complete === true); inaczej brak pomiaru. */
  M4.depth = (fr, side, px) => {
    const lv = side === 'bid' ? fr.bids : fr.asks;
    if (!lv || !lv.length) return { v: null, why: 'empty' };
    for (let i = 0; i < lv.length; i++) {
      const p = P(lv[i]), s = S(lv[i]);
      if (!(isFinite(p) && p > 0 && isFinite(s) && s > 0)) return { v: null, why: 'invalid' };
      if (i && (side === 'bid' ? !(p < P(lv[i - 1])) : !(p > P(lv[i - 1])))) return { v: null, why: 'invalid' };
    }
    const lo = Math.min(P(lv[0]), P(lv[lv.length - 1])), hi = Math.max(P(lv[0]), P(lv[lv.length - 1]));
    if (px < lo || px > hi) return { v: null, why: 'range' };
    const hit = lv.find((l) => P(l) === px);
    if (hit) return { v: S(hit) };
    return fr.complete === true ? { v: 0 } : { v: null, why: 'nomeas' };
  };

  /* Czy suma półotwartych odcinków [l, r) obejmuje [a, b)? */
  M4.covered = (spans, a, b) => {
    if (!(b > a)) return false; let reached = a;
    for (const [l, r] of [...(spans || [])].sort((x, y) => x[0] - y[0])) { if (l > reached) break; reached = Math.max(reached, r); if (reached >= b) return true; }
    return false;
  };
  const units = (sz, unit) => Math.round(sz / unit);

  /* Wszystkie pary kolejnych dokładnych migawek dla ceny i strony: { A, B, width, kind: 'drop' | 'none', why } */
  M4.pairs = (frames, side, px, o) => {
    // Tylko migawki z jawnym potwierdzeniem dokładności (exact === true); stary zapis bez tego pola nie tworzy pary (uwaga Astry)
    const ex = frames.filter((f) => f.exact === true && Number.isInteger(f.t)).sort((a, b) => a.t - b.t);
    const other = side === 'bid' ? 'ask' : 'bid'; const out = [];
    for (let i = 1; i < ex.length; i++) {
      const A = ex[i - 1], B = ex[i]; if (!(A.t < B.t)) continue;
      const base = { side, px, A: { t: A.t, sz: null }, B: { t: B.t, sz: null }, width: B.t - A.t };
      if (o.cursor != null && B.t > o.cursor) { out.push({ ...base, kind: 'none', why: 'future' }); continue; }
      const dA = M4.depth(A, side, px), dB = M4.depth(B, side, px);
      if (dA.v == null || dB.v == null) {
        const oA = M4.depth(A, other, px), oB = M4.depth(B, other, px);
        const why = (dA.v == null && oA.v > 0) || (dB.v == null && oB.v > 0) ? 'side' : dA.why === 'invalid' || dB.why === 'invalid' ? 'invalid' : 'nomeas';
        out.push({ ...base, kind: 'none', why }); continue;
      }
      base.A.sz = dA.v; base.B.sz = dB.v;
      if (!M4.covered(o.bookSpans, A.t, B.t + 1)) { out.push({ ...base, kind: 'none', why: 'gap' }); continue; }
      if (units(dA.v, o.unit) - units(dB.v, o.unit) < 1) { out.push({ ...base, kind: 'none', why: 'nodrop' }); continue; }
      out.push({ ...base, kind: 'drop', why: null });
    }
    return out;
  };
  M4.drops = (frames, px, o) => ['bid', 'ask'].flatMap((side) => M4.pairs(frames, side, px, o).filter((p) => p.kind === 'drop')).sort((a, b) => a.A.t - b.A.t);

  /* Kolejność wydruku względem uskoku */
  M4.order = (drop, tr, o) => {
    const res = (kind, why) => ({ kind, why, width: drop.width, dA: tr.t - drop.A.t, dB: tr.t - drop.B.t });
    if (tr.px !== drop.px) return res('none', 'price');
    if (o.cursor != null && tr.t > o.cursor) return res('none', 'future');
    if (!M4.covered(o.tapeSpans, tr.t, tr.t + 1)) return res('none', 'tapegap');
    // Zegary muszą być jawnie podane i zgodne; brak opisu zegara = nieporównywalne (uwaga Astry)
    if (!o.bookClock || !o.tapeClock || o.bookClock !== o.tapeClock || !Number.isInteger(tr.t) || !Number.isInteger(drop.A.t) || !Number.isInteger(drop.B.t)) return res('undetermined', 'clock');
    if (tr.t < drop.A.t) return res('earlier', null);
    if (tr.t > drop.B.t) return res('later', null);
    return res('undetermined', 'between');
  };

  /* Zapis migawek: surowe (do wnioskowania M4, po czasie giełdy, bez cofania) i miniatura (stała sekunda czasu giełdy) */
  M4.pushRaw = (raw, fr, cap = 3000) => { const last = raw[raw.length - 1]; if (last && fr.t <= last.t) return false; raw.push(fr); if (raw.length > cap) raw.shift(); return true; };
  M4.pushThumb = (frames, fr, cap = 900) => {
    const sec = Math.floor(fr.tx / 1000); const last = frames[frames.length - 1];
    // Najnowszy czas giełdy wygrywa także w obrębie jednej sekundy: spóźniona .150 po .850 nie zastępuje .850 (uwaga Astry)
    if (last && (sec < last.sec || fr.tx < last.tx)) return false;
    fr.sec = sec; if (last && last.sec === sec) frames[frames.length - 1] = fr; else { frames.push(fr); if (frames.length > cap) frames.shift(); }
    return true;
  };

  /* ---------- Teksty ---------- */
  const TXT = {
    pl: {
      h: 'Co było pierwsze?', lead: 'Wybierz uskok w księdze, potem wydruk. Wynik mówi tylko o kolejności.', open: 'Zapytaj', close: 'Zwiń',
      step1: 'Krok 1/2 · uskok w księdze', step2: 'Krok 2/2 · wydruk przy tej cenie', reset: 'Wyczyść wybór',
      dropLbl: '{side} {a} → {b} · {sa} → {sb} {u} · szerokość {w}', tradeLbl: '{t} · {side} {sz} {u}',
      none: 'Brak uskoku przy tej cenie w nagraniu.', noneWhy: 'Pary migawek bez uskoku: {list}.', bucket: 'Działa przy kroku ceny 1. Zmień krok w pasku odczytu.',
      noTrades: 'Brak wydruków przy tej cenie do chwili kursora.', pick1: 'Najpierw wybierz uskok.', pick2: 'Teraz wybierz wydruk.',
      earlier: 'Wydruk był wcześniej', later: 'Wydruk był później', undetermined: 'Kolejność nieustalona', nonev: 'Brak porównania',
      eD: 'Wydruk {t} był {d} przed migawką A ({a}); spadek ilości zaobserwowano dopiero między A i B.',
      lD: 'Wydruk {t} był {d} po migawce B ({b}); spadek ilości był już widoczny w B.',
      uD: 'Wydruk {t} leży w przedziale A–B szerokim na {w}: spadek mógł nastąpić przed nim albo po nim.',
      clock: 'Zegary migawek i taśmy są nieporównywalne, więc kolejności nie rozstrzygamy.',
      not: 'Różnica ilości nie mówi, czy zlecenia anulowano, czy wykonano, ani kto to zrobił.',
      src: 'Migawki dokładne · czas giełdy w ms · taśma z pokryciem', bid: 'BID', ask: 'ASK', buy: 'kupno', sell: 'sprzedaż',
      why: { side: 'zmiana strony', invalid: 'niepoprawna strona księgi', nomeas: 'brak pomiaru', range: 'poza zakresem', gap: 'luka w księdze', nodrop: 'bez spadku ≥ 1 jednostki', future: 'migawka B po kursorze', price: 'inna cena', tapegap: 'wydruk poza pokryciem taśmy' },
      cnt: '{n} uskok(i)', ariaA: 'Migawka A', ariaB: 'Migawka B', ariaT: 'Wydruk', back: '← Wróć do taśmy', fromTape: 'Wydruk z taśmy: {t} · {side} {sz} {u}. Teraz wybierz uskok.',
    },
    en: {
      h: 'What came first?', lead: 'Pick a book step, then a print. The answer is about order only.', open: 'Ask', close: 'Collapse',
      step1: 'Step 1/2 · book step', step2: 'Step 2/2 · print at this price', reset: 'Clear selection',
      dropLbl: '{side} {a} → {b} · {sa} → {sb} {u} · width {w}', tradeLbl: '{t} · {side} {sz} {u}',
      none: 'No book step at this price in the recording.', noneWhy: 'Snapshot pairs without a step: {list}.', bucket: 'Works with price step 1. Change the step in the reading bar.',
      noTrades: 'No prints at this price up to the cursor.', pick1: 'Pick a book step first.', pick2: 'Now pick a print.',
      earlier: 'The print came first', later: 'The print came later', undetermined: 'Order undetermined', nonev: 'No comparison',
      eD: 'Print {t} was {d} before snapshot A ({a}); the size drop was only observed between A and B.',
      lD: 'Print {t} was {d} after snapshot B ({b}); the drop was already visible in B.',
      uD: 'Print {t} lies inside A–B, {w} wide: the drop may have happened before or after it.',
      clock: 'Snapshot and tape clocks are not comparable, so the order is not resolved.',
      not: 'A size difference does not tell whether orders were cancelled or filled, or by whom.',
      src: 'Exact snapshots · exchange time in ms · covered tape', bid: 'BID', ask: 'ASK', buy: 'buy', sell: 'sell',
      why: { side: 'side change', invalid: 'invalid book side', nomeas: 'not measured', range: 'out of range', gap: 'book gap', nodrop: 'no drop ≥ 1 unit', future: 'snapshot B after cursor', price: 'different price', tapegap: 'print outside tape coverage' },
      cnt: '{n} step(s)', ariaA: 'Snapshot A', ariaB: 'Snapshot B', ariaT: 'Print', back: '← Back to tape', fromTape: 'Print from the tape: {t} · {side} {sz} {u}. Now pick a book step.',
    },
  };
  const t = (k) => (TXT[HQ.lang] || TXT.pl)[k];
  M4.t = t;
  const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] == null ? '' : o[k]));
  const loc = () => (HQ.lang === 'en' ? 'en-GB' : 'pl-PL');
  M4.time = (ms, utc) => new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23', timeZone: utc ? 'UTC' : undefined }).format(ms) + (utc ? ' UTC' : '');
  const secs = (ms) => (Math.abs(ms) / 1000).toLocaleString(loc(), { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' s';
  const num = (v, d) => (v == null ? HQ.DASH : HQ.fmt(v, d));

  /* ---------- Widok (pasek odczytu w sesji i scena) ----------
     src: { px(), bucket(), unit, szd, u, frames(), trades(), cursor(), bookSpans(), tapeSpans(), bookClock, tapeClock, utc, startOpen, onPick(state) } */
  M4.view = function (root, src) {
    const st = { open: !!src.startOpen, drop: null, trade: null, sig: '', px: null };
    const id = 'm4-' + Math.random().toString(36).slice(2, 7);
    root.classList.add('m4');
    root.innerHTML = `<div class="m4-head"><h4 id="${id}-h">${t('h')}</h4><span class="m4-cnt muted"></span><button type="button" class="btn btn-line btn-s m4-tg" aria-expanded="${st.open}" aria-controls="${id}-b">${st.open ? t('close') : t('open')}</button></div>
      <div class="m4-body" id="${id}-b" ${st.open ? '' : 'hidden'}><p class="m4-lead muted">${t('lead')}</p><p class="m4-srcline muted"></p><div class="m4-lists"></div><div class="m4-res" aria-live="polite"></div></div>`;
    root.setAttribute('aria-labelledby', id + '-h');
    const $ = (s) => root.querySelector(s);
    const ctx = () => ({ cursor: src.cursor(), unit: src.unit, bookSpans: src.bookSpans(), tapeSpans: src.tapeSpans(), bookClock: src.bookClock, tapeClock: src.tapeClock });

    $('.m4-tg').addEventListener('click', () => { st.open = !st.open; $('.m4-tg').setAttribute('aria-expanded', String(st.open)); $('.m4-tg').textContent = st.open ? t('close') : t('open'); $('.m4-body').hidden = !st.open; st.sig = ''; update(); });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') return;
      e.stopPropagation(); // skróty sesji ([ ] L ? Esc) nie działają wewnątrz pytania
      if (e.key === 'Escape') { e.preventDefault(); if (st.drop) st.drop = null; else if (st.from && src.onBack) { back(); return; } else if (st.trade) st.trade = null; else { st.open = false; $('.m4-tg').setAttribute('aria-expanded', 'false'); $('.m4-tg').textContent = t('open'); $('.m4-body').hidden = true; $('.m4-tg').focus(); } st.sig = ''; update(); }
    });
    root.addEventListener('change', (e) => {
      // Uskok i wydruk wybierane niezależnie: zmiana uskoku nie kasuje wydruku (także przyniesionego z taśmy)
      const r = e.target; if (r.name === id + '-d') st.drop = r.value; else if (r.name === id + '-t') st.trade = r.value;
      st.sig = ''; update(r.name === id + '-d' ? 'drop' : 'trade');
      if (src.onPick) src.onPick(M4.current(st, lastDrops, lastTrades));
    });
    root.addEventListener('click', (e) => { if (e.target.closest('.m4-back')) { back(); return; } if (e.target.closest('.m4-reset')) { st.drop = st.trade = null; st.sig = ''; update(); if (src.onPick) src.onPick(null); const f = root.querySelector('input'); if (f) f.focus(); } });

    let lastDrops = [], lastTrades = [];
    // Powrót do taśmy: do aktualnie wybranego wydruku (albo tego, z którego przyszliśmy)
    function back() { const cur = lastTrades.find((x) => String(x.id || x.t) === st.trade) || st.from; st.from = null; st.sig = ''; if (src.onBack) src.onBack(cur); }
    // Wejście z taśmy: wydruk już wybrany, fokus na kroku „uskok”
    function open(tr) {
      st.open = true; $('.m4-tg').setAttribute('aria-expanded', 'true'); $('.m4-tg').textContent = t('close'); $('.m4-body').hidden = false;
      st.px = src.px(); st.drop = null; st.trade = String(tr.id || tr.t); st.from = tr; st.sig = ''; update();
      const f = root.querySelector(`input[name="${id}-d"]`) || root.querySelector('.m4-back'); if (f) f.focus({ preventScroll: true });
      root.scrollIntoView({ block: 'nearest' });
      if (src.onPick) src.onPick(M4.current(st, lastDrops, lastTrades));
    }
    function update(changed) {
      const px = src.px(); if (px !== st.px) { st.px = px; st.drop = st.trade = null; st.sig = ''; }
      const c = ctx(); const lists = $('.m4-lists'), resEl = $('.m4-res');
      if (px == null) { root.hidden = true; return; } root.hidden = false;
      if (src.bucket() !== 1) { $('.m4-cnt').textContent = ''; if (st.sig !== 'bucket') { lists.innerHTML = `<p class="muted">${t('bucket')}</p>`; resEl.innerHTML = ''; st.sig = 'bucket'; } return; }
      const frames = src.frames(); const all = ['bid', 'ask'].flatMap((side) => M4.pairs(frames, side, px, c));
      const drops = all.filter((p) => p.kind === 'drop').sort((a, b) => a.A.t - b.A.t);
      let trades = src.trades().filter((x) => x.px === px && (c.cursor == null || x.t <= c.cursor)).slice(-12);
      if (st.from && st.from.px === px && !trades.some((x) => String(x.id || x.t) === String(st.from.id || st.from.t))) trades = [...trades, st.from].sort((a, b) => a.t - b.t);
      if (src.sourceLine) { const sl = src.sourceLine(); const el = $('.m4-srcline'); if (el.textContent !== sl) el.textContent = sl; }
      lastDrops = drops; lastTrades = trades;
      $('.m4-cnt').textContent = drops.length ? M4.count(drops.length) : '';
      if (!st.open) return;
      const key = (d) => `${d.side}:${d.A.t}:${d.B.t}`;
      if (st.drop && !drops.some((d) => key(d) === st.drop)) st.drop = null;
      if (st.trade && !trades.some((x) => String(x.id || x.t) === st.trade)) st.trade = null;
      const sig = [px, drops.map(key).join(','), trades.map((x) => x.id || x.t).join(','), st.drop, st.trade, !!st.from, HQ.lang].join('|');
      if (sig === st.sig) return; st.sig = sig;
      // zachowanie fokusu na wybranym polu przy przebudowie
      // Fokus zostaje na tym samym elemencie także przy przebudowie z nowymi wydrukami na żywo (pola wyboru po nazwie i wartości, przyciski po klasie)
      const ae = document.activeElement; const fa = ae && root.contains(ae) ? (ae.name ? ['n', ae.name, ae.value] : ae.classList.contains('m4-back') ? ['c', '.m4-back'] : ae.classList.contains('m4-reset') ? ['c', '.m4-reset'] : null) : null;
      let html = st.from && src.onBack ? `<p class="m4-from">${fill(t('fromTape'), { t: M4.time(st.from.t, src.utc), side: t(st.from.side), sz: num(st.from.sz, src.szd), u: src.u })}</p><button type="button" class="btn btn-line btn-s m4-back">${t('back')}</button>` : '';
      if (!drops.length) {
        const why = {}; all.forEach((p) => { if (p.kind === 'none') why[p.why] = (why[p.why] || 0) + 1; });
        const list = Object.entries(why).map(([k, n]) => `${t('why')[k] || k} × ${n}`).join(', ');
        html += `<p>${t('none')}</p>${list ? `<p class="muted">${fill(t('noneWhy'), { list })}</p>` : ''}`;
      } else {
        html += `<fieldset class="m4-fs"><legend>${t('step1')}</legend>` + drops.map((d) => `<label class="m4-opt${st.drop === key(d) ? ' on' : ''}"><input type="radio" name="${id}-d" value="${key(d)}" ${st.drop === key(d) ? 'checked' : ''}><span>${fill(t('dropLbl'), { side: t(d.side), a: M4.time(d.A.t, src.utc), b: M4.time(d.B.t, src.utc), sa: num(d.A.sz, src.szd), sb: num(d.B.sz, src.szd), u: src.u, w: secs(d.width) })}</span></label>`).join('') + '</fieldset>';
        html += `<fieldset class="m4-fs" ${st.drop ? '' : 'disabled'}><legend>${t('step2')}</legend>` + (trades.length ? trades.map((x) => { const v = String(x.id || x.t); return `<label class="m4-opt${st.trade === v ? ' on' : ''}"><input type="radio" name="${id}-t" value="${v}" ${st.trade === v ? 'checked' : ''}><span>${fill(t('tradeLbl'), { t: M4.time(x.t, src.utc), side: t(x.side), sz: num(x.sz, src.szd), u: src.u })}</span></label>`; }).join('') : `<p class="muted">${t('noTrades')}</p>`) + '</fieldset>';
        if (st.drop || st.trade) html += `<button type="button" class="linkbtn m4-reset">${t('reset')}</button>`;
      }
      lists.innerHTML = html;
      if (fa) { const el = fa[0] === 'n' ? root.querySelector(`input[name="${fa[1]}"][value="${fa[2]}"]`) : root.querySelector(fa[1]); if (el) el.focus({ preventScroll: true }); }
      else if (changed === 'drop') { const el = root.querySelector(`input[name="${id}-t"]`); if (el) el.focus(); }
      renderResult(drops.find((d) => key(d) === st.drop), trades.find((x) => String(x.id || x.t) === st.trade), c);
      // Po wyborze użytkownika karta wyniku ma być widoczna (telefon: lista bywa dłuższa niż ekran); bez płynnego przewijania
      if (changed) { const card = root.querySelector('.m4-card'); if (card) card.scrollIntoView({ block: 'nearest' }); }
    }
    function renderResult(d, x, c) {
      const el = $('.m4-res');
      if (!d) { el.innerHTML = lastDrops.length ? `<p class="muted m4-hint">${t('pick1')}</p>` : ''; return; }
      if (!x) { el.innerHTML = `<p class="muted m4-hint">${t('pick2')}</p>` + strip(d, null); return; }
      const r = M4.order(d, x, c);
      const T = { t: M4.time(x.t, src.utc), a: M4.time(d.A.t, src.utc), b: M4.time(d.B.t, src.utc), w: secs(d.width), d: secs(r.kind === 'earlier' ? r.dA : r.dB) };
      const desc = r.kind === 'earlier' ? fill(t('eD'), T) : r.kind === 'later' ? fill(t('lD'), T) : r.kind === 'undetermined' ? (r.why === 'clock' ? t('clock') : fill(t('uD'), T)) : (t('why')[r.why] || r.why);
      el.innerHTML = `<div class="m4-card" data-kind="${r.kind}"><p class="m4-verdict">${t(r.kind === 'none' ? 'nonev' : r.kind)}</p>${strip(d, x)}<p>${desc}</p><p class="muted m4-not">${t('not')}</p><p class="muted m4-src">${t('src')} · B − A = ${secs(d.width)}</p></div>`;
    }
    // Pasek osi A |———| B z kropką wydruku (rysunek statyczny, bez animacji)
    function strip(d, x) {
      const lo = Math.min(d.A.t, x ? x.t : d.A.t), hi = Math.max(d.B.t, x ? x.t : d.B.t); const pad = Math.max(400, (hi - lo) * 0.12);
      const a = lo - pad, b = hi + pad, X = (v) => (((v - a) / (b - a)) * 300 + 10).toFixed(1);
      const tr = x ? `<circle cx="${X(x.t)}" cy="22" r="5" fill="var(${x.side === 'buy' ? '--buy' : '--sell'})" stroke="var(--ink-1)" stroke-width="1.5"><title>${t('ariaT')} ${M4.time(x.t, src.utc)}</title></circle>` : '';
      return `<svg class="m4-strip" viewBox="0 0 320 44" role="img" aria-label="${t('ariaA')} ${M4.time(d.A.t, src.utc)}, ${t('ariaB')} ${M4.time(d.B.t, src.utc)}${x ? `, ${t('ariaT')} ${M4.time(x.t, src.utc)}` : ''}">
        <line x1="10" x2="310" y1="22" y2="22" stroke="var(--line-strong)"/>
        <rect x="${X(d.A.t)}" y="12" width="${(X(d.B.t) - X(d.A.t)).toFixed(1)}" height="20" fill="var(--lume)" opacity=".16"/>
        <line x1="${X(d.A.t)}" x2="${X(d.A.t)}" y1="8" y2="36" stroke="var(--ink-1)" stroke-width="2"/><line x1="${X(d.B.t)}" x2="${X(d.B.t)}" y1="8" y2="36" stroke="var(--ink-1)" stroke-width="2"/>
        <text x="${X(d.A.t)}" y="7" text-anchor="middle" font-size="8" fill="var(--ink-2)">A</text><text x="${X(d.B.t)}" y="7" text-anchor="middle" font-size="8" fill="var(--ink-2)">B</text>${tr}</svg>`;
    }
    update();
    return { update, open, back, state: st, get drops() { return lastDrops; }, get trades() { return lastTrades; } };
  };
  // Liczebnik: 1 uskok, 2–4 uskoki, 5+ uskoków (PL); 1 step, n steps (EN)
  M4.count = (n) => {
    if (HQ.lang === 'en') return `${n} book step${n === 1 ? '' : 's'}`;
    const m10 = n % 10, m100 = n % 100; const w = n === 1 ? 'uskok' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'uskoki' : 'uskoków';
    return `${n} ${w}`;
  };
  M4.current = (st, drops, trades) => {
    const d = drops.find((x) => `${x.side}:${x.A.t}:${x.B.t}` === st.drop) || null; const x = trades.find((y) => String(y.id || y.t) === st.trade) || null;
    return d ? { drop: d, trade: x } : null;
  };
})();
