/* Teksty dodatków terminala (paleta: podgląd poziomu; duża transakcja) */
(() => {
  const d = (window.HQ = window.HQ || {}).dict;
  if (!d) return;
  Object.assign(d.pl, {
    'd.pal.level': 'Poziom',
    'd.pal.levelIn': '{pct} od środka księgi · {sz} {unit} po stronie {side} · {t}',
    'd.pal.levelOut': '{pct} od środka księgi · poza widocznymi poziomami księgi · {t}',
    'd.pal.levelSpread': '{pct} od środka księgi · w spreadzie, brak zleceń · {t}',
    'd.big': 'Duża transakcja',
  });
  Object.assign(d.en, {
    'd.pal.level': 'Level',
    'd.pal.levelIn': '{pct} from book mid · {sz} {unit} on the {side} · {t}',
    'd.pal.levelOut': '{pct} from book mid · outside the visible book · {t}',
    'd.pal.levelSpread': '{pct} from book mid · inside the spread, no orders · {t}',
    'd.big': 'Large trade',
  });
})();

/* HyperQuant · terminal: chowany pasek boczny (klawisz \), wysuwane skróty, płynne znaczniki zakładek.
   Wymaga HQ.fluid z portal.js. Stan na tym urządzeniu (localStorage). */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const HQ = window.HQ;
  const desk = document.querySelector('.desk');
  if (!desk || !HQ.fluid) return;
  const T = {
    pl: { hide: 'Ukryj menu boczne', show: 'Pokaż menu boczne', quick: 'Skróty', quickHide: 'Zwiń skróty', quickShow: 'Rozwiń skróty' },
    en: { hide: 'Hide side menu', show: 'Show side menu', quick: 'Shortcuts', quickHide: 'Collapse shortcuts', quickShow: 'Expand shortcuts' },
  };
  const t = (k) => (T[HQ.lang] || T.pl)[k];
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; };

  /* ---------- Płynne znaczniki ---------- */
  const rail = desk.querySelector('.rail');
  const tabs = document.querySelector('.insp .tabs');
  const bnav = document.querySelector('.bnav');
  [rail, tabs, bnav].forEach((el) => { if (el) { el.setAttribute('data-fluid', ''); HQ.fluid(el); } });
  const replace = () => [rail, tabs, bnav].forEach((el) => el && el._fluid && el._fluid.place());
  addEventListener('hashchange', () => requestAnimationFrame(replace));
  new MutationObserver(() => requestAnimationFrame(replace)).observe(desk, { attributes: true, subtree: true, attributeFilter: ['aria-current', 'aria-selected'] });

  /* ---------- Chowany pasek boczny ---------- */
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'rail-toggle';
  toggle.setAttribute('aria-keyshortcuts', '\\');
  toggle.innerHTML = icon('M15 6l-6 6 6 6M20 4v16');
  const settings = rail && rail.querySelector('.sp');
  if (rail && settings) settings.after(toggle);
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'rail-handle';
  handle.setAttribute('aria-keyshortcuts', '\\');
  handle.innerHTML = icon('M9 6l6 6-6 6');
  desk.after(handle);
  const label = () => {
    toggle.setAttribute('aria-label', t('hide')); toggle.title = t('hide') + ' (\\)';
    handle.setAttribute('aria-label', t('show')); handle.title = t('show') + ' (\\)';
  };
  const setRail = (hidden, focus) => {
    desk.dataset.rail = hidden ? 'hidden' : 'shown';
    delete desk.dataset.peek;
    handle.inert = !hidden;
    toggle.setAttribute('aria-expanded', String(!hidden));
    store('hqp.rail', hidden ? 'hidden' : 'shown');
    if (focus) (hidden ? handle : toggle).focus({ preventScroll: true });
    setTimeout(replace, 480);
    document.dispatchEvent(new CustomEvent('hq:layout'));
    dispatchEvent(new Event('resize'));
  };
  toggle.addEventListener('click', () => setRail(true, true));
  handle.addEventListener('click', () => setRail(false, true));
  document.addEventListener('keydown', (e) => {
    if (e.key !== '\\' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    // Fokus z wnętrza paska lub z uchwytu przechodzi na widoczny odpowiednik, nie na body
    const a = document.activeElement;
    const inside = (rail && rail.contains(a)) || a === handle;
    setRail(desk.dataset.rail !== 'hidden', inside);
  });
  // Podgląd: wskaźnik przy lewej krawędzi wysuwa pasek nad treść, zjazd z paska go chowa
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let peekT = 0;
  document.addEventListener('pointermove', (e) => {
    if (!fine.matches || desk.dataset.rail !== 'hidden') return;
    if (e.clientX <= 6 && !desk.dataset.peek) { clearTimeout(peekT); peekT = setTimeout(() => { desk.dataset.peek = 'true'; replace(); }, 140); }
    else if (e.clientX > 8) clearTimeout(peekT);
  }, { passive: true });
  rail && rail.addEventListener('pointerleave', () => { if (desk.dataset.peek) delete desk.dataset.peek; });
  setRail(store('hqp.rail') === 'hidden', false);

  /* ---------- Wysuwane skróty nad wykresem ---------- */
  const quick = document.querySelector('.stage > .react-links');
  if (quick) {
    const links = [...quick.querySelectorAll('a')];
    links.forEach((a, i) => a.style.setProperty('--k', i));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-toggle';
    btn.innerHTML = `${icon('M6 9l6 6 6-6')}<span data-quick-l></span><span class="n">${links.length}</span>`;
    quick.prepend(btn);
    const sync = () => {
      const collapsed = quick.dataset.collapsed === 'true';
      btn.querySelector('[data-quick-l]').textContent = t('quick');
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.setAttribute('aria-label', `${t(collapsed ? 'quickShow' : 'quickHide')} (${links.length})`);
      links.forEach((a) => (collapsed ? a.setAttribute('tabindex', '-1') : a.removeAttribute('tabindex')));
    };
    btn.addEventListener('click', () => {
      quick.dataset.collapsed = String(quick.dataset.collapsed !== 'true');
      store('hqp.quick', quick.dataset.collapsed);
      sync();
      dispatchEvent(new Event('resize'));
    });
    quick.dataset.collapsed = store('hqp.quick') === 'true' ? 'true' : 'false';
    sync();
    document.addEventListener('hq:lang', sync);
  }
  /* ---------- Żywe liczby: cena i statystyki nagłówka przewijają cyfry (tekst dla czytnika bez zmian) ---------- */
  const strip = '<span class="odo-s">' + '0123456789'.split('').map((n) => `<i>${n}</i>`).join('') + '</span>';
  const odometer = (src) => {
    if (!src || src._odo) return;
    src._odo = true;
    const odo = document.createElement('span');
    odo.className = (src.className || '') + ' odo';
    odo.setAttribute('aria-hidden', 'true');
    src.classList.add('odo-src');
    src.after(odo);
    const paint = () => {
      const chars = [...(src.textContent || '')];
      const sig = chars.map((c) => (/\d/.test(c) ? 'd' : c)).join('');
      if (sig !== odo._sig) {
        odo._sig = sig;
        odo.innerHTML = chars.map((c) => (/\d/.test(c) ? `<span class="odo-d">${strip}</span>` : `<span class="odo-c">${c === ' ' || c === '\u00a0' || c === '\u202f' ? '&nbsp;' : c.replace(/[<>&]/g, '')}</span>`)).join('');
      }
      const cols = odo.querySelectorAll('.odo-s');
      let k = 0;
      chars.forEach((c) => { if (/\d/.test(c)) cols[k++].style.transform = `translateY(${-(+c) * 10}%)`; });
    };
    new MutationObserver(paint).observe(src, { childList: true, characterData: true, subtree: true });
    paint();
  };
  ['h-px', 'h-fund', 'h-oi', 'h-vol'].forEach((id) => odometer(document.getElementById(id)));

  /* ---------- Kropla w księdze: transakcja od 25 000 USD wywołuje falę na swoim poziomie drabinki ---------- */
  let dropBudget = 0;
  let dropAt = 0;
  const bookDrop = (t) => {
    if (HQ.reduced() || document.hidden) return;
    if (HQ.desk && HQ.desk.live && !HQ.desk.live()) return; // powtórka: drabinka pokazuje migawkę z przeszłości
    const now = performance.now();
    if (now - dropAt > 1000) { dropAt = now; dropBudget = 0; }
    if (dropBudget >= 6) return;
    // Tylko dokładny poziom widoczny w drabince (wiersze to poziomy migawki); cena poza drabinką albo w luce: bez kropli
    const tol = Math.max(1e-9, Math.abs(t.px) * 1e-12);
    const best = [...document.querySelectorAll('#ladder .pbtn')].find((b) => b.dataset.px !== '' && Math.abs(+b.dataset.px - t.px) <= tol);
    if (!best) return;
    dropBudget++;
    const row = best.closest('tr');
    // atrybut, nie klasa: desk.js przy każdym odświeżeniu nadpisuje className wiersza;
    // wartość to cena wydruku, żeby oznaczenie nie przeszło na inną cenę w ponownie użytym wierszu
    delete row.dataset.drop; void row.offsetWidth; row.dataset.drop = best.dataset.px;
    clearTimeout(row._dt); row._dt = setTimeout(() => { delete row.dataset.drop; }, 900);
  };

  /* ---------- Znak marki żyje: kropka „teraz” w logo pulsuje przy transakcjach (najwyżej 2 razy na sekundę) ---------- */
  const logo = document.querySelector('.rail .logo');
  let logoAt = 0;
  const logoPulse = () => {
    if (!logo || HQ.reduced() || document.hidden) return;
    const now = performance.now();
    if (now - logoAt < 500) return;
    logoAt = now;
    logo.classList.remove('hq-tick'); void logo.offsetWidth; logo.classList.add('hq-tick');
  };
  const tape = (feed) => {
    if (!feed || feed._tape) return;
    feed._tape = true;
    feed.on('trades', (ts) => { if (ts.length) logoPulse(); ts.forEach((t) => { if (t.px * t.sz >= 25000) bookDrop(t); }); });
  };
  tape(HQ.liveFeed);
  document.addEventListener('hq:feed', (e) => tape(e.detail));

  /* ---------- Duża transakcja: linia wody przebiega nad wykresem (próg jak skoki [ ]: 100 000 USD) ---------- */
  const stage = document.getElementById('stage');
  let flashAt = 0;
  const flash = (t) => {
    if (!stage || HQ.reduced() || document.hidden) return;
    if (HQ.desk && HQ.desk.live && !HQ.desk.live()) return; // powtórka: wykres i księga pokazują przeszłość
    const now = performance.now();
    if (now - flashAt < 1200) return;
    flashAt = now;
    let el = stage.querySelector('.bigflash');
    if (!el) { el = document.createElement('div'); el.className = 'bigflash'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = '<i></i><span></span>'; stage.append(el); }
    const unit = (HQ.desk && HQ.desk.coin ? HQ.desk.coin() : 'BTC').replace('xyz:', '');
    el.querySelector('span').innerHTML = `${HQ.t('d.big')} · ${HQ.fmt(t.sz, t.sz < 1 ? 4 : 2)} ${unit} · ${HQ.fmtUsdShort ? HQ.fmtUsdShort(t.px * t.sz) : HQ.fmt(t.px * t.sz, 0)} USD · <time>${HQ.time(t.t)}</time> <b class="bf-live">LIVE</b>`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  };
  const hook = (feed) => {
    if (!feed || feed._big) return;
    feed._big = true;
    feed.on('trades', (ts) => { const big = ts.filter((t) => t.px * t.sz >= 100000).sort((a, b) => b.px * b.sz - a.px * a.sz)[0]; if (big) flash(big); });
  };
  hook(HQ.liveFeed);
  document.addEventListener('hq:feed', (e) => hook(e.detail));

  /* ---------- Szkło łapie światło: panele z data-spot (pozycję kursora ustawia portal.js) ---------- */
  ['.rail', '.insp', '.pal', '.stage > .react-links'].forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.setAttribute('data-spot', '')));

  /* ---------- Poświata oddycha z rynkiem: obrót USD na sekundę (EMA) steruje jasnością za paskiem ---------- */
  let usd = 0;
  let act = 0;
  const pulse = (feed) => {
    if (!feed || feed._act) return;
    feed._act = true;
    feed.on('trades', (ts) => ts.forEach((t) => { usd += t.px * t.sz; }));
  };
  pulse(HQ.liveFeed);
  document.addEventListener('hq:feed', (e) => pulse(e.detail));
  setInterval(() => {
    const live = HQ.desk && HQ.desk.live ? HQ.desk.live() : false;
    // 10 tys. USD/s ≈ 0, 10 mln USD/s ≈ 1 (skala logarytmiczna), wygładzone
    const target = live && usd > 0 ? Math.max(0, Math.min(1, (Math.log10(usd) - 4) / 3)) : 0;
    usd = 0;
    act = act * 0.6 + target * 0.4;
    desk.style.setProperty('--act', HQ.reduced() ? '0' : act.toFixed(3));
  }, 1000);

  document.addEventListener('hq:lang', () => { label(); replace(); });
  label();
});
