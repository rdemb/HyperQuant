/* HyperQuant · system ruchu portalu.
   Dock chowany przy przewijaniu w dół, płynny znacznik zakładek (linia wody), menu pełnoekranowe,
   odsłanianie sekcji, rozkład nagłówków na słowa, magnetyczne przyciski, światło kursora na kartach,
   zmienne przewijania dla przerywnika i opcjonalny dźwięk taśmy (WebAudio, domyślnie wyłączony).
   Każdy ruch respektuje HQ.reduced(). Bez bibliotek. */
(() => {
  'use strict';
  const HQ = window.HQ;
  const doc = document.documentElement;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  /* ---------- Płynny znacznik zakładek: linia wody pod aktywną albo wskazaną pozycją ---------- */
  HQ.fluid = (box) => {
    if (!box || box._fluid) return box && box._fluid;
    const ind = document.createElement('i');
    ind.className = 'fluid-ind';
    ind.setAttribute('aria-hidden', 'true');
    box.append(ind);
    let hover = null;
    const items = () => $$('a, button', box).filter((el) => !el.hidden && el.offsetParent !== null);
    const active = () => items().find((el) => el.getAttribute('aria-current') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true');
    const place = () => {
      const target = hover || active();
      if (!target) { box.style.setProperty('--fo', '0'); return; }
      // Skok na inną pozycję: krótki impuls rozciągnięcia (styl definiuje strona, np. terminal)
      if (box._last && box._last !== target && box.classList.contains('fluid-ready') && !HQ.reduced()) {
        box.classList.remove('fluid-jump'); void box.offsetWidth; box.classList.add('fluid-jump');
        clearTimeout(box._jt); box._jt = setTimeout(() => box.classList.remove('fluid-jump'), 480);
      }
      box._last = target;
      const b = box.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      box.style.setProperty('--fx', (r.left - b.left + box.scrollLeft).toFixed(1) + 'px');
      box.style.setProperty('--fw', r.width.toFixed(1) + 'px');
      box.style.setProperty('--fy', (r.top - b.top).toFixed(1) + 'px');
      box.style.setProperty('--fh', r.height.toFixed(1) + 'px');
      box.style.setProperty('--fo', '1');
      box.dataset.fluidHover = hover ? 'true' : 'false';
    };
    box.addEventListener('pointerover', (e) => { const el = e.target.closest('a, button'); if (el && box.contains(el) && fine.matches) { hover = el; place(); } });
    box.addEventListener('pointerleave', () => { hover = null; place(); });
    box.addEventListener('focusin', (e) => { const el = e.target.closest('a, button'); if (el && el.matches(':focus-visible')) { hover = el; place(); } });
    box.addEventListener('focusout', () => { hover = null; place(); });
    new ResizeObserver(place).observe(box);
    document.fonts?.ready.then(place);
    box._fluid = { place };
    requestAnimationFrame(() => { place(); requestAnimationFrame(() => box.classList.add('fluid-ready')); });
    return box._fluid;
  };

  /* ---------- Rozkład nagłówka na słowa (maska wznosząca); ponownie po zmianie języka ---------- */
  const split = (el) => {
    const targets = el.children.length ? [...el.children] : [el];
    let n = 0;
    targets.forEach((t) => {
      const text = t.textContent;
      t.textContent = '';
      text.split(/(\s+)/).forEach((w) => {
        if (!w) return;
        if (/^\s+$/.test(w)) { t.append(document.createTextNode(' ')); return; }
        const outer = document.createElement('span');
        outer.className = 'sw';
        const inner = document.createElement('span');
        inner.className = 'sw-i';
        inner.style.setProperty('--i', n++);
        inner.textContent = w;
        outer.append(inner);
        t.append(outer);
      });
    });
    el.style.setProperty('--words', n);
  };
  // i18n wpisuje świeży tekst do potomków z data-i18n; rozkładamy po każdej zmianie języka
  const resplit = () => $$('[data-words]').forEach(split);

  /* ---------- Odsłanianie sekcji ---------- */
  const reveal = () => {
    const els = $$('[data-reveal]');
    if (!('IntersectionObserver' in window)) { els.forEach((el) => (el.dataset.in = 'true')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.dataset.in = 'true'; io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    els.forEach((el) => io.observe(el));
  };

  /* ---------- Magnetyczne przyciski i światło kursora ---------- */
  const pointerFx = () => {
    document.addEventListener('pointermove', (e) => {
      if (!fine.matches || HQ.reduced()) return;
      const mag = e.target.closest && e.target.closest('[data-magnetic]');
      if (mag) {
        const r = mag.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        mag.style.setProperty('--mx', (dx * 10).toFixed(2) + 'px');
        mag.style.setProperty('--my', (dy * 8).toFixed(2) + 'px');
      }
      const spot = e.target.closest && e.target.closest('[data-spot]');
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty('--sx', (e.clientX - r.left).toFixed(0) + 'px');
        spot.style.setProperty('--sy', (e.clientY - r.top).toFixed(0) + 'px');
      }
    }, { passive: true });
    document.addEventListener('pointerout', (e) => {
      const mag = e.target.closest && e.target.closest('[data-magnetic]');
      if (mag && !mag.contains(e.relatedTarget)) { mag.style.setProperty('--mx', '0px'); mag.style.setProperty('--my', '0px'); }
    });
  };

  /* ---------- Dock: kompaktowy po hero, chowany przy przewijaniu w dół, wraca przy ruchu w górę ---------- */
  const dock = () => {
    const el = $('.dock');
    if (!el) return;
    const nav = $('.dock-nav', el);
    const fluid = HQ.fluid(nav);
    const links = $$('a[href^="#"]', nav);
    const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    let lastY = scrollY;
    let queued = false;
    let current = null;
    const update = () => {
      queued = false;
      const y = scrollY;
      const hero = $('.cinema-hero');
      const past = hero ? y > hero.offsetHeight * 0.6 : y > 80;
      el.dataset.compact = String(past);
      const menuOpen = $('.pmenu[open]');
      const down = y > lastY + 4;
      const up = y < lastY - 4;
      if (!menuOpen && past && down && !el.contains(document.activeElement)) el.dataset.hidden = 'true';
      if (up || !past) el.dataset.hidden = 'false';
      lastY = y;
      // Postęp strony: linia wody na dolnej krawędzi docka
      const max = document.documentElement.scrollHeight - innerHeight;
      el.style.setProperty('--page', clamp(max > 0 ? y / max : 0).toFixed(4));
      // Aktywna sekcja
      const mark = innerHeight * 0.35;
      let pick = null;
      sections.forEach((s) => { const r = s.getBoundingClientRect(); if (r.top <= mark && r.bottom > mark) pick = s; });
      if (pick !== current) {
        current = pick;
        links.forEach((a) => { if (pick && a.getAttribute('href') === '#' + pick.id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
        fluid && fluid.place();
      }
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    el.addEventListener('focusin', () => (el.dataset.hidden = 'false'));
    el.addEventListener('pointerenter', () => (el.dataset.hidden = 'false'));
    update();
  };

  /* ---------- Menu pełnoekranowe: otwiera się od linii wody ---------- */
  const menu = () => {
    const dlg = $('.pmenu');
    const openers = $$('[data-open-menu]');
    if (!dlg || !openers.length) return;
    let opener = null;
    const syncStatus = () => {
      const out = $('[data-menu-status]', dlg);
      if (!out) return;
      const s = HQ.liveStatus || 'connecting';
      out.textContent = HQ.t(s === 'live' ? 'p.live.live' : s === 'reconnecting' ? 'p.live.reconnecting' : 'p.live.connecting');
      out.dataset.state = s;
    };
    const open = (from) => {
      opener = from || document.activeElement;
      openers.forEach((b) => b.setAttribute('aria-expanded', 'true'));
      dlg.classList.remove('closing');
      dlg.showModal();
      doc.classList.add('menu-open');
      syncStatus();
      $$('[data-fluid]', dlg).forEach((b) => HQ.fluid(b)?.place());
      const first = $('.pmenu-list a', dlg);
      first && first.focus({ preventScroll: true });
    };
    const close = (then) => {
      if (!dlg.open) { then && then(); return; }
      const done = () => {
        dlg.classList.remove('closing');
        dlg.close();
        doc.classList.remove('menu-open');
        openers.forEach((b) => b.setAttribute('aria-expanded', 'false'));
        if (then) then(); else if (opener && opener.focus) opener.focus({ preventScroll: true });
      };
      if (HQ.reduced()) { done(); return; }
      dlg.classList.add('closing');
      setTimeout(done, 320);
    };
    openers.forEach((b) => b.addEventListener('click', () => (dlg.open ? close() : open(b))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-menu]')) { close(); return; }
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (href.startsWith('#')) {
        e.preventDefault();
        close(() => {
          const target = document.getElementById(href.slice(1));
          if (!target) return;
          target.scrollIntoView({ behavior: HQ.reduced() ? 'auto' : 'smooth', block: 'start' });
          const focusable = target.matches('[tabindex], a, button, h1, h2, h3') ? target : target.querySelector('h1, h2, h3');
          if (focusable) { if (!focusable.hasAttribute('tabindex')) focusable.setAttribute('tabindex', '-1'); focusable.focus({ preventScroll: true }); }
        });
      }
    });
    document.addEventListener('hq:livestatus', syncStatus);
    document.addEventListener('hq:lang', syncStatus);
  };

  /* ---------- Zmienne przewijania: przerywnik i elementy z data-scrollvar ---------- */
  const scrollVars = () => {
    const els = $$('[data-scrollvar]');
    if (!els.length) return;
    let queued = false;
    const update = () => {
      queued = false;
      const h = innerHeight;
      els.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -h || r.top > 2 * h) return;
        // 0 gdy element wchodzi od dołu, 1 gdy wychodzi górą
        const p = clamp((h - r.top) / (h + r.height));
        el.style.setProperty('--sp', HQ.reduced() ? '0.5' : p.toFixed(4));
      });
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    document.addEventListener('hq:motion', schedule);
    update();
  };

  /* ---------- Dźwięk taśmy (audiocn jako inspiracja kontrolek; dźwięk syntetyzowany lokalnie) ---------- */
  HQ.sound = (() => {
    let ctx = null;
    let on = false;
    let minUsd = 50000;
    try { minUsd = +localStorage.getItem('hqp.soundMin') || minUsd; } catch (e) { /* pamięć niedostępna */ }
    let budget = 0;
    let budgetAt = 0;
    const listeners = new Set();
    const emit = () => listeners.forEach((f) => f());
    const ensure = () => {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    };
    const blip = (side, usd) => {
      const c = ensure();
      if (!c) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      const filter = c.createBiquadFilter();
      const scale = clamp(Math.log10(usd / minUsd + 1) / 2, 0.15, 1);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(side === 'buy' ? 784 : 523.25, now);
      osc.frequency.exponentialRampToValueAtTime(side === 'buy' ? 740 : 493.88, now + 0.16);
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.03 + 0.09 * scale, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22 + 0.25 * scale);
      osc.connect(filter).connect(gain).connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.5 + 0.25 * scale);
    };
    return {
      get on() { return on; },
      get min() { return minUsd; },
      set(v) { on = !!v; if (on) ensure(); emit(); },
      setMin(v) { minUsd = v; try { localStorage.setItem('hqp.soundMin', String(v)); } catch (e) { /* nic */ } emit(); },
      sub(f) { listeners.add(f); return () => listeners.delete(f); },
      trade(t) {
        if (!on || document.hidden) return;
        const usd = t.px * t.sz;
        if (!(usd >= minUsd)) return;
        const now = performance.now();
        if (now - budgetAt > 1000) { budget = 0; budgetAt = now; }
        if (budget++ >= 10) return;
        blip(t.side, usd);
      },
    };
  })();
  const soundUi = () => {
    const sync = () => {
      $$('[data-sound-toggle]').forEach((b) => {
        b.setAttribute('aria-pressed', String(HQ.sound.on));
        const state = b.querySelector('[data-sound-state]');
        if (state) state.textContent = HQ.t(HQ.sound.on ? 'p.soundOn' : 'p.soundOff');
      });
      $$('[data-sound-min]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.soundMin === HQ.sound.min)));
      $$('[data-fluid]').forEach((b) => b._fluid && b._fluid.place());
    };
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-sound-toggle]');
      if (t) HQ.sound.set(!HQ.sound.on);
      const m = e.target.closest('[data-sound-min]');
      if (m) HQ.sound.setMin(+m.dataset.soundMin);
    });
    HQ.sound.sub(sync);
    document.addEventListener('hq:lang', sync);
    sync();
  };

  /* ---------- Wspólny strumień BTC (tworzy go landing.js); status dla docka i menu ---------- */
  const liveLink = () => {
    const attach = (feed) => {
      if (!feed || feed._portal) return;
      feed._portal = true;
      feed.on('status', (s) => { HQ.liveStatus = s; document.dispatchEvent(new CustomEvent('hq:livestatus')); });
      feed.on('trades', (ts) => ts.forEach((t) => HQ.sound.trade(t)));
    };
    attach(HQ.liveFeed);
    document.addEventListener('hq:feed', (e) => attach(e.detail));
  };

  /* ---------- Przejścia między stronami: typ przejścia zależy od kierunku (do terminala lub z powrotem) ---------- */
  const transitions = () => {
    addEventListener('pageswap', (e) => {
      if (!e.viewTransition) return;
      if (HQ.reduced()) { e.viewTransition.skipTransition(); return; }
      try { sessionStorage.setItem('hqp.vtFrom', location.pathname); } catch (er) { /* nic */ }
    });
    addEventListener('pagereveal', (e) => {
      if (!e.viewTransition) return;
      if (HQ.reduced()) { e.viewTransition.skipTransition(); }
    });
  };

  /* ---------- Scena przechodzi w narzędzie: kadr rozrasta się do pełnego ekranu, potem nawigacja ---------- */
  const zoomIntoTool = () => {
    let busy = false;
    const veil = () => {
      const v = document.createElement('div');
      v.className = 'zoom-veil';
      v.setAttribute('aria-hidden', 'true');
      v.innerHTML = '<i class="zoom-line"></i>';
      return v;
    };
    addEventListener('pageshow', (e) => { if (e.persisted) { $$('.zoom-veil').forEach((v) => v.remove()); busy = false; } });
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a.tour-link, a.bento-card');
      if (!a || busy || HQ.reduced() || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return;
      const src = a.classList.contains('tour-link') ? $('.tour-stage') : a;
      // Bez obsługi animacji: zwykły odsyłacz, bez przechwytywania kliknięcia
      if (!src || typeof Element.prototype.animate !== 'function') return;
      e.preventDefault();
      busy = true;
      let gone = false;
      let v = null;
      const go = () => { if (gone) return; gone = true; location.href = a.href; };
      try {
        const r = src.getBoundingClientRect();
        v = veil();
        const radius = getComputedStyle(src).borderRadius || '24px';
        v.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${radius}`;
        const canvas = src.querySelector && src.querySelector('#tour-canvas');
        if (canvas && canvas.width) {
          const copy = document.createElement('canvas');
          copy.width = canvas.width; copy.height = canvas.height;
          const cx = copy.getContext('2d');
          // Kopia sceny jest ozdobą: bez kontekstu 2D warstwa zostaje pusta, przejście działa dalej
          if (cx) { cx.drawImage(canvas, 0, 0); v.prepend(copy); }
        }
        document.body.append(v);
        const anim = v.animate([
          { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: radius },
          { left: '0px', top: '0px', width: innerWidth + 'px', height: innerHeight + 'px', borderRadius: '0px' },
        ], { duration: 620, easing: 'cubic-bezier(.83, 0, .17, 1)', fill: 'forwards' });
        v.classList.add('zooming');
        anim.onfinish = go;
        // Strażnik: gdy przeglądarka nie maluje klatek (karta w tle, brak GPU), animacja stoi na 0 —
        // wtedy przejście bez czekania, zamiast nieruchomej warstwy przez 0,9 s
        setTimeout(() => { if (!gone && !(anim.currentTime > 0)) { anim.cancel(); go(); } }, 160);
        setTimeout(go, 900); // zapas, gdy animacja ruszyła, ale nie zgłosiła końca
      } catch (err) {
        // Każdy błąd przygotowania animacji: warstwa znika, odsyłacz działa jak zwykły link
        if (v) v.remove();
        go();
      }
    });
  };

  /* ---------- Zmiana motywu: nowy motyw rozlewa się kołem od przełącznika ---------- */
  const themeReveal = () => {
    if (!HQ.setTheme || HQ._themeReveal) return;
    HQ._themeReveal = true;
    const orig = HQ.setTheme;
    let pt = null;
    addEventListener('pointerdown', (e) => { pt = { x: e.clientX, y: e.clientY, at: Date.now() }; }, { capture: true, passive: true });
    HQ.setTheme = (t) => {
      const before = HQ.theme;
      if (!document.startViewTransition || HQ.reduced()) return orig(t);
      let p = pt && Date.now() - pt.at < 1500 ? pt : null;
      if (!p) {
        const el = document.activeElement;
        const rr = el && el !== document.body ? el.getBoundingClientRect() : null;
        p = rr ? { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 } : { x: innerWidth - 40, y: 30 };
      }
      pt = null;
      doc.style.setProperty('--vt-x', Math.round(p.x) + 'px');
      doc.style.setProperty('--vt-y', Math.round(p.y) + 'px');
      doc.classList.add('vt-motyw');
      const vt = document.startViewTransition(() => { orig(t); });
      vt.finished.finally(() => doc.classList.remove('vt-motyw'));
      if (before === HQ.theme) { /* motyw bez zmiany: przejście i tak kończy się od razu */ }
    };
  };

  /* ---------- Finał: linia wody biegnie między „Zobacz, co jest” a „pod ceną.”, horyzont filmu za nią ---------- */
  const horizon = () => {
    const sec = $('.final2');
    const top = sec && $('.fh-top', sec);
    if (!top) return;
    const set = () => {
      const r = sec.getBoundingClientRect();
      const b = top.getBoundingClientRect();
      if (!r.height) return;
      sec.style.setProperty('--hz', (b.bottom - r.top + b.height * 0.06).toFixed(1) + 'px');
    };
    new ResizeObserver(set).observe(sec);
    document.fonts?.ready.then(set);
    document.addEventListener('hq:lang', () => requestAnimationFrame(set));
    set();
  };

  themeReveal();
  document.addEventListener('DOMContentLoaded', () => {
    horizon();
    zoomIntoTool();
    resplit();
    document.addEventListener('hq:lang', () => requestAnimationFrame(resplit));
    // Wybrany język trafia do adresu: odświeżenie i skopiowany odsyłacz otwierają ten sam język
    document.addEventListener('hq:lang', () => {
      try {
        const u = new URL(location.href);
        if (u.searchParams.get('lang') !== HQ.lang) { u.searchParams.set('lang', HQ.lang); history.replaceState(history.state, '', u); }
      } catch (e) { /* adres bez zmian */ }
    });
    reveal();
    pointerFx();
    dock();
    menu();
    scrollVars();
    soundUi();
    liveLink();
    transitions();
    $$('[data-fluid]').forEach((b) => HQ.fluid(b));
    document.addEventListener('hq:lang', () => $$('[data-fluid]').forEach((b) => b._fluid && b._fluid.place()));
    document.addEventListener('click', () => requestAnimationFrame(() => $$('[data-fluid]').forEach((b) => b._fluid && b._fluid.place())));
    requestAnimationFrame(() => doc.classList.add('portal-ready'));
  });
})();
