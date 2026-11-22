/* HyperQuant · pokaz rozdziałów (wzorzec Scrolltide, własna kompozycja i kod).
   Rozdziały przewijają się naturalnie, scena i tło są przypięte. Zmiana rozdziału odsłania nową scenę
   od linii wody, tło przechodzi płynnie, a szklane zakładki przesuwają znacznik.
   Film przerywnika gra tylko na ekranie. Ograniczony ruch: bez pętli scen, bez przejść, film jako plakat. */
window.HQ.ready(() => {
  'use strict';
  const HQ = window.HQ;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- Odsyłacze z jawnym językiem ---------- */
  const links = $$('[data-cinema-link]');
  const localize = () => {
    document.title = HQ.t('cinema.pageTitle');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const url = new URL(link.href);
      url.searchParams.set('lang', HQ.lang);
      link.href = url.href;
    });
  };
  document.addEventListener('hq:lang', localize);
  localize();

  /* ---------- Filmy: grają tylko na ekranie, w ograniczonym ruchu zostaje plakat ---------- */
  $$('video[data-film]').forEach((film) => {
    const box = film.closest('[data-film-box]');
    const control = box && $('[data-film-control]', box);
    let requested = false;
    let visible = false;
    let wants = !HQ.reduced();
    const sync = () => {
      if (!control) return;
      const playing = !film.paused && !film.ended;
      $('[data-film-icon]', control).textContent = playing ? 'Ⅱ' : '▷';
      $('[data-film-label]', control).textContent = HQ.t(playing ? 'p.filmPause' : 'p.filmPlay');
      control.setAttribute('aria-pressed', String(playing));
    };
    const play = () => {
      if (!requested) {
        requested = true;
        // Pionowy telefon dostaje pionowy wariant filmu, jeśli istnieje
        const portrait = matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
        [['webm', 'video/webm'], ['mp4', 'video/mp4']].forEach(([k, type]) => {
          const src = (portrait && film.dataset[k + 'Portrait']) || film.dataset[k];
          if (!src) return;
          const s = document.createElement('source');
          s.type = type; s.src = src;
          film.append(s);
        });
      }
      if (film.ended && !film.loop) film.currentTime = 0;
      film.play().catch(() => sync());
    };
    const update = () => {
      if (visible && !document.hidden && wants && !HQ.reduced()) play();
      else if (!film.paused) film.pause();
    };
    film.addEventListener('playing', () => { box && (box.dataset.frame = 'video'); sync(); });
    film.addEventListener('pause', sync);
    film.addEventListener('ended', () => { wants = false; sync(); });
    if (control) {
      control.hidden = false;
      control.addEventListener('click', () => { wants = film.paused || film.ended; if (wants) play(); else film.pause(); });
    }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); }, { threshold: 0.2 }).observe(box || film);
    document.addEventListener('visibilitychange', update);
    document.addEventListener('hq:motion', () => { if (HQ.reduced()) { wants = false; film.pause(); box && delete box.dataset.frame; } update(); });
    document.addEventListener('hq:lang', sync);
    sync();
  });

  /* ---------- Zanurzenie: przewijanie prowadzi kamerę przez linię wody (30 klatek Grok T1) ---------- */
  const dive = $('[data-dive]');
  if (dive) {
    const cv = $('.dive-canvas', dive);
    const dctx = cv.getContext('2d');
    const N = 30;
    const frames = [];
    let loaded = false;
    let shown = -1;
    let dq = false;
    const load = () => {
      if (loaded) return;
      loaded = true;
      for (let i = 0; i < N; i++) {
        const img = new Image();
        img.decoding = 'async';
        img.src = HQ.url(`assets/media/t1/${String(i + 1).padStart(2, '0')}.webp`);
        img.onload = () => { if (i === Math.round(dive._p * (N - 1))) draw(dive._p, true); };
        frames[i] = img;
      }
    };
    const draw = (p, force) => {
      const i = Math.max(0, Math.min(N - 1, Math.round(p * (N - 1))));
      // najbliższa wczytana klatka, gdy docelowa jeszcze się pobiera
      let k = i; while (k > 0 && !(frames[k] && frames[k].complete && frames[k].naturalWidth)) k--;
      const img = frames[k];
      if (!img || !img.complete || !img.naturalWidth) return;
      if (k === shown && !force) return;
      shown = k;
      const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const sc = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
      const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
      dctx.drawImage(img, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
      dive.dataset.frames = 'true';
    };
    const upd = () => {
      dq = false;
      const r = dive.getBoundingClientRect();
      if (r.top < innerHeight * 2.5 && r.bottom > -innerHeight) load();
      const p = Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - innerHeight)));
      dive._p = p;
      dive.style.setProperty('--dp', HQ.reduced() ? '1' : p.toFixed(4));
      if (!HQ.reduced() && r.bottom > 0 && r.top < innerHeight) draw(p);
    };
    dive._p = 0;
    const dsched = () => { if (!dq) { dq = true; requestAnimationFrame(upd); } };
    addEventListener('scroll', dsched, { passive: true });
    addEventListener('resize', () => { shown = -1; dsched(); });
    document.addEventListener('hq:motion', () => { shown = -1; dsched(); });
    upd();
  }

  /* ---------- Pokaz ---------- */
  const story = $('.tour-story');
  if (!story) return;
  const stage = $('.tour-stage', story);
  const canvas = $('#tour-canvas');
  const previous = $('.tour-prev', stage);
  const pctx = previous.getContext('2d');
  const chapters = $$('[data-scene]', story);
  const tabs = $$('[data-scene-link]');
  const tabBox = $('.tour-tabs [data-fluid]');
  const layers = $$('.tour-backdrop [data-bg]');
  const nameEl = $('.tour-stage-name', stage);
  const codeEl = $('.tour-stage-code', stage);
  const countEl = $('.tour-count-now');
  const simEl = $('.tour-sim-prov');
  const render = window.HQStage.create(canvas);
  let active = -1;
  let progress = 0;
  let visible = false;
  let raf = 0;
  let t0 = performance.now();
  let queued = false;

  if (simEl) HQ.setProv(simEl, 'sim', Date.now(), 864e5);

  // Zmiana podpisu: stary tekst odjeżdża w górę, nowy wjeżdża od dołu. Tekst zmienia się zawsze, także bez animacji.
  const roll = (el, text) => {
    if (!el || el._want === text || (el._want == null && el.textContent === text)) return;
    el._want = text;
    if (HQ.reduced() || !el.animate) { el.textContent = text; return; }
    let done = false;
    const swap = () => {
      if (done || el._want !== text) return;
      done = true;
      el.textContent = text;
      el.animate([{ transform: 'translateY(70%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' });
    };
    el.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-70%)', opacity: 0 }], { duration: 160, easing: 'cubic-bezier(.64,0,.78,0)' }).onfinish = swap;
    setTimeout(swap, 240);
  };
  const label = () => {
    if (active < 0) return;
    const ch = chapters[active];
    roll(nameEl, HQ.t(ch.dataset.sceneLabel));
    roll(codeEl, ch.dataset.code);
    roll(countEl, String(active + 1).padStart(2, '0'));
  };
  const wipe = () => {
    if (HQ.reduced() || !canvas.animate || !visible) return;
    previous.width = canvas.width; previous.height = canvas.height;
    pctx.drawImage(canvas, 0, 0);
    previous.hidden = false;
    previous.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)' }], { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' }).onfinish = () => { previous.hidden = true; };
    canvas.animate([{ clipPath: 'inset(49.5% 0 49.5% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 640, easing: 'cubic-bezier(.83,0,.17,1)' });
    stage.classList.remove('wiping'); void stage.offsetWidth; stage.classList.add('wiping');
  };
  const setActive = (i) => {
    if (i === active) return;
    const first = active < 0;
    active = i;
    stage.dataset.scene = chapters[i].dataset.scene;
    story.dataset.scene = chapters[i].dataset.scene;
    chapters.forEach((c, k) => (c.dataset.active = String(k === i)));
    layers.forEach((l) => (l.dataset.on = String(l.dataset.bg === chapters[i].dataset.scene)));
    tabs.forEach((a, k) => { if (k === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
    if (tabBox) {
      tabBox._fluid && tabBox._fluid.place();
      const a = tabs[i];
      const want = a.offsetLeft - (tabBox.clientWidth - a.offsetWidth) / 2;
      if (tabBox.scrollWidth > tabBox.clientWidth) tabBox.scrollTo({ left: want, behavior: HQ.reduced() ? 'auto' : 'smooth' });
    }
    if (!first) wipe();
    label();
  };
  const update = () => {
    queued = false;
    const mobile = matchMedia('(max-width: 860px)').matches;
    const marker = mobile ? innerHeight * 0.8 : innerHeight * 0.56;
    const rects = chapters.map((c) => c.getBoundingClientRect());
    let cur = 0;
    rects.forEach((r, i) => { if (r.top <= marker) cur = i; });
    const r = rects[cur];
    progress = Math.max(0, Math.min(1, (marker - r.top) / r.height));
    setActive(cur);
    story.style.setProperty('--tour-progress', ((cur + progress) / chapters.length).toFixed(4));
    const sr = stage.getBoundingClientRect();
    visible = sr.bottom > 0 && sr.top < innerHeight;
    if (HQ.reduced()) render(active, progress, 0);
    else if (visible && !raf) raf = requestAnimationFrame(loop);
  };
  function loop(ts) {
    raf = 0;
    if (!visible || document.hidden || HQ.reduced()) return;
    render(active, progress, (ts - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('hq:motion', () => { cancelAnimationFrame(raf); raf = 0; previous.hidden = true; schedule(); });
  document.addEventListener('hq:lang', () => { nameEl._want = null; nameEl.textContent = HQ.t(chapters[active].dataset.sceneLabel); label(); render(active, progress, HQ.reduced() ? 0 : (performance.now() - t0) / 1000); });
  document.fonts?.ready.then(schedule);

  // Zakładki rozdziałów: przewinięcie do rozdziału i fokus na jego nagłówku
  tabs.forEach((a, i) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const ch = chapters[i];
    const top = ch.getBoundingClientRect().top + scrollY - (matchMedia('(max-width: 860px)').matches ? innerHeight * 0.55 : innerHeight * 0.27);
    scrollTo({ top, behavior: HQ.reduced() ? 'auto' : 'smooth' });
    ch.focus({ preventScroll: true });
    history.replaceState(null, '', '#' + ch.id);
  }));
  schedule();
});
