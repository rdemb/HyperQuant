/* Rozdziały zmieniają scenę przy naturalnym przewijaniu. Film zatrzymuje się poza ekranem. */
document.addEventListener('DOMContentLoaded', () => {
  const HQ = window.HQ;
  const hero = document.querySelector('.cinema-hero');
  const film = document.getElementById('cinema-film');
  const control = document.getElementById('cinema-film-control');
  const tour = document.querySelector('.cinema-story');
  const stage = tour.querySelector('.cinema-stage');
  const chapters = [...tour.querySelectorAll('[data-scene]')];
  const index = [...document.querySelectorAll('[data-scene-link]')];
  const stageName = stage.querySelector('.cinema-stage-name');
  const stageCode = stage.querySelector('.cinema-stage-code');
  const links = [...document.querySelectorAll('[data-cinema-link]')];
  const drawing = document.getElementById('cinema-stage');
  const previous = stage.querySelector('.cinema-stage-previous');
  const previousContext = previous.getContext('2d');
  const renderScene = window.HQCinemaScene.create(drawing);
  let dissolve = null;
  let active = -1;
  let queued = false;
  let heroVisible = false;
  let wantsPlayback = !HQ.reduced();
  let requested = false;

  const updateSceneLabel = () => {
    if (active < 0) return;
    const chapter = chapters[active];
    stageName.textContent = HQ.t(chapter.dataset.sceneLabel);
    stageCode.textContent = chapter.dataset.code;
  };
  const updatePlaybackControl = () => {
    const playing = !film.paused && !film.ended;
    document.getElementById('cinema-film-icon').textContent = playing ? 'Ⅱ' : '▷';
    document.getElementById('cinema-film-label').textContent = HQ.t(playing ? 'cinema.pause' : 'cinema.play');
  };
  const localize = () => {
    document.title = HQ.t('cinema.pageTitle');
    links.forEach(link => {
      if (link.getAttribute('href').startsWith('#')) return;
      const url = new URL(link.href);
      url.searchParams.set('lang', HQ.lang);
      link.href = url.href;
    });
    updateSceneLabel();
    updatePlaybackControl();
  };
  const play = () => {
    if (!requested) {
      requested = true;
      const webm = document.createElement('source');
      webm.type = 'video/webm';
      webm.src = film.dataset.webm;
      const mp4 = document.createElement('source');
      mp4.type = 'video/mp4';
      mp4.src = film.dataset.mp4;
      film.append(webm, mp4);
    }
    if (film.ended) film.currentTime = 0;
    film.play().catch((error) => {
      if (error.name !== 'AbortError') delete hero.dataset.frame;
      updatePlaybackControl();
    });
  };
  const syncPlayback = () => {
    if (heroVisible && !document.hidden && wantsPlayback && !film.ended) play();
    else if (!film.paused) film.pause();
  };
  control.hidden = false;
  control.addEventListener('click', () => {
    wantsPlayback = film.paused || film.ended;
    if (wantsPlayback) play();
    else film.pause();
  });
  film.addEventListener('playing', () => { hero.dataset.frame = 'video'; updatePlaybackControl(); });
  film.addEventListener('pause', updatePlaybackControl);
  film.addEventListener('error', () => {
    delete hero.dataset.frame;
    updatePlaybackControl();
  });
  film.addEventListener('ended', () => { wantsPlayback = false; updatePlaybackControl(); });
  new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    syncPlayback();
  }, { threshold: .25 }).observe(hero);
  document.addEventListener('visibilitychange', syncPlayback);
  document.addEventListener('hq:motion', () => {
    if (!HQ.reduced()) return;
    wantsPlayback = false;
    film.pause();
    delete hero.dataset.frame;
    dissolve?.cancel();
    previous.hidden = true;
    schedule();
  });
  document.addEventListener('hq:lang', localize);
  localize();

  function updateScene() {
    queued = false;
    const mobile = matchMedia('(max-width: 640px)').matches;
    const frame = stage.getBoundingClientRect();
    const marker = mobile ? frame.bottom + 26 : Math.min(innerHeight * .49, frame.top + frame.height * .44);
    const positions = chapters.map(chapter => chapter.getBoundingClientRect());
    const current = positions.reduce((selected, rect, i) => rect.top <= marker ? i : selected, 0);
    const rect = positions[current];
    const progress = Math.max(0, Math.min(1, (marker - rect.top) / rect.height));
    const visible = frame.bottom > 0 && frame.top < innerHeight;
    if (active !== current) {
      if (active >= 0 && visible && !HQ.reduced() && previousContext && previous.animate) {
        dissolve?.cancel();
        previous.width = drawing.width;
        previous.height = drawing.height;
        previousContext.drawImage(drawing, 0, 0);
        previous.hidden = false;
        dissolve = previous.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out' });
        dissolve.onfinish = () => { previous.hidden = true; };
      }
      active = current;
      stage.dataset.scene = chapters[active].dataset.scene;
      index.forEach((link, i) => {
        if (i === current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      updateSceneLabel();
    }
    stage.style.setProperty('--cinema-progress', (current + progress) / chapters.length);
    if (visible) renderScene(active, HQ.reduced() ? 1 : progress);
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(updateScene);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  document.fonts?.ready.then(schedule);
  schedule();
});
