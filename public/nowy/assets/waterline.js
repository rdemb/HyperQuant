/* HyperQuant · hero „Linia wody” w WebGL.
   Warstwy matowego szkła nad i pod limonkową linią, zorza w tle, ziarno.
   Każda rzeczywista transakcja BTC z Hyperliquid (wspólny strumień landing.js) wpada w linię jako kropla:
   powstaje fala, której wysokość zależy od wielkości transakcji. Kursor zostawia lekki ślad.
   Ograniczony ruch: jedna nieruchoma klatka, bez fal. Brak WebGL: zostaje plakat. */
(() => {
  'use strict';
  const HQ = window.HQ;
  const MAX = 32;

  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLine;      // wysokość linii (0 dół, 1 góra)
uniform vec2 uMouse;      // kursor w uv, -1 gdy brak
uniform float uMouseOn;
uniform vec4 uDrops[${MAX}]; // x, czas startu, siła, strona (+1 kupno, -1 sprzedaż)
uniform float uPaper;     // 0 Głębia, 1 Opal
uniform float uLeft;      // przyciemnienie lewej części pod tekst

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

float wave(float x, float t){
  float y = 0.0;
  for (int i = 0; i < ${MAX}; i++){
    vec4 d = uDrops[i];
    if (d.z <= 0.0) continue;
    float age = t - d.y;
    if (age < 0.0 || age > 6.0) continue;
    float dx = abs(x - d.x) * uRes.x / uRes.y;
    float front = age * 0.30;
    float env = exp(-age * 1.15) * exp(-max(0.0, dx - front) * 7.0) * smoothstep(0.0, 0.06, age) * exp(-dx * 1.6);
    y += d.z * env * sin(dx * 28.0 - age * 6.5) * 0.011;
  }
  // miękkie nasycenie: wiele transakcji naraz nie zamienia linii w oscylogram
  return y / (1.0 + abs(y) * 45.0);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2(uv.x * aspect, uv.y);
  float t = uTime;

  float w = wave(uv.x, t);
  // ślad kursora: łagodne ugięcie linii
  float md = uMouseOn * exp(-pow((uv.x - uMouse.x) * aspect * 3.2, 2.0)) * smoothstep(0.32, 0.0, abs(uMouse.y - uLine));
  float lineY = uLine + w + md * 0.012 * sin(t * 2.2);
  float dy = uv.y - lineY;

  // kolory palet
  vec3 deep0 = vec3(0.035, 0.028, 0.065);
  vec3 deep1 = vec3(0.105, 0.075, 0.19);
  vec3 lav   = vec3(0.64, 0.565, 0.83);
  vec3 rose  = vec3(1.0, 0.61, 0.71);
  vec3 lime  = vec3(0.863, 1.0, 0.447);
  vec3 pap0  = vec3(0.95, 0.94, 0.97);
  vec3 pap1  = vec3(0.86, 0.83, 0.93);
  vec3 limeP = vec3(0.23, 0.27, 0.0);

  // zorza w tle: wolne fbm z przesunięciem
  float f = fbm(q * 1.6 + vec2(t * 0.025, -t * 0.012));
  float g = fbm(q * 3.1 - vec2(t * 0.04, f));
  vec3 col = mix(deep0, deep1, smoothstep(0.15, 0.95, f + 0.25 * g));
  col += lav * 0.10 * smoothstep(0.55, 0.95, g) * smoothstep(0.0, 0.6, uv.x);

  // warstwy szkła: poziome płyty, gęstsze przy linii, z refrakcją od fali
  float side = sign(dy);
  float ad = abs(dy);
  float k = pow(ad, 0.62) * 15.0 + w * 40.0 * exp(-ad * 6.0);
  float slab = fract(k + 0.07 * fbm(vec2(uv.x * 2.4 + t * 0.03, k * 0.3)));
  float edge = smoothstep(0.0, 0.035, slab) * (1.0 - smoothstep(0.86, 1.0, slab));
  float sheen = smoothstep(0.82, 1.0, slab) * (0.35 + 0.65 * fbm(vec2(uv.x * 6.0 - t * 0.05, k)));
  float depth = exp(-ad * 2.4);
  vec3 glass = mix(deep1 * 1.2, lav * 0.55, 0.35 * depth);
  col = mix(col, glass, 0.55 * edge * smoothstep(0.0, 0.25, uv.x + 0.05) * (0.35 + 0.65 * depth));
  col += lav * sheen * 0.22 * depth;
  // pod linią chłodniejsza głębia i różowe iskry w dole
  col += rose * 0.06 * smoothstep(0.0, -0.5, dy) * fbm(q * 4.0 + t * 0.05) * step(dy, 0.0);

  // linia wody: rdzeń, poświata i odbicie
  float core = exp(-pow(dy * uRes.y / 1.6, 2.0));
  float halo = exp(-ad * 34.0) * 0.55 + exp(-ad * 9.0) * 0.16;
  float pulse = 0.85 + 0.15 * sin(t * 1.3 + uv.x * 3.0);
  vec3 lineCol = mix(lime, limeP, uPaper);
  col += lineCol * (core * 1.25 + halo * pulse * (side < 0.0 ? 0.7 : 1.0));

  // krople: jasny punkt w miejscu uderzenia
  for (int i = 0; i < ${MAX}; i++){
    vec4 d = uDrops[i];
    if (d.z <= 0.0) continue;
    float age = t - d.y;
    if (age < 0.0 || age > 1.6) continue;
    vec2 c = vec2(d.x * aspect, uLine + (1.0 - smoothstep(0.0, 0.18, age)) * 0.12 * d.w);
    float r = length(q - c);
    float s = 0.004 + 0.009 * d.z;
    col += mix(lav, lime, 0.65) * exp(-r * r / (s * s)) * (1.0 - age / 1.6) * 0.9;
  }

  // światło kursora
  col += lav * 0.08 * uMouseOn * exp(-length((uv - uMouse) * vec2(aspect, 1.0)) * 4.5);

  // przyciemnienie pod tekstem po lewej i winieta
  float shade = smoothstep(0.62, 0.0, uv.x) * uLeft;
  col *= 1.0 - shade * 0.72;
  col *= 0.82 + 0.18 * smoothstep(1.15, 0.2, length((uv - vec2(0.62, 0.5)) * vec2(1.0, 1.4)));

  // Opal: jasne szkło (odwrócona luminancja w palecie lawendy)
  vec3 paper = mix(pap0, pap1, clamp(1.0 - dot(col, vec3(0.33)) * 1.6, 0.0, 1.0));
  paper = mix(paper, limeP, (core * 1.1 + halo * 0.4) * 0.85);
  col = mix(col, paper, uPaper);

  // ziarno
  col += (hash(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.035;
  gl_FragColor = vec4(col, 1.0);
}`;

  HQ.waterline = (canvas, opts = {}) => {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, VS);
    const fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRes', 'uTime', 'uLine', 'uMouse', 'uMouseOn', 'uDrops', 'uPaper', 'uLeft'].forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));

    const drops = new Float32Array(MAX * 4);
    let slot = 0;
    let t0 = performance.now();
    let now = 0;
    let raf = 0;
    let visible = true;
    let mouse = [-1, -1];
    let mouseOn = 0;
    let mouseTarget = 0;
    let scale = 1;
    let frameBudget = [];

    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5) * scale;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    };
    const draw = () => {
      size();
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, now);
      gl.uniform1f(U.uLine, opts.line ? opts.line() : 0.46);
      gl.uniform2f(U.uMouse, mouse[0], mouse[1]);
      gl.uniform1f(U.uMouseOn, mouseOn);
      gl.uniform4fv(U.uDrops, drops);
      gl.uniform1f(U.uPaper, opts.paper && HQ.theme === "paper" ? 1 : 0);
      gl.uniform1f(U.uLeft, opts.left ? opts.left() : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (ts) => {
      raf = 0;
      if (!visible || document.hidden || HQ.reduced() || paused) return;
      const dt = ts - (loop.last || ts);
      loop.last = ts;
      now = (ts - t0) / 1000;
      mouseOn += (mouseTarget - mouseOn) * 0.06;
      draw();
      // samoregulacja: przy długich klatkach zmniejszamy rozdzielczość bufora
      frameBudget.push(dt);
      if (frameBudget.length > 90) {
        const avg = frameBudget.reduce((a, b) => a + b, 0) / frameBudget.length;
        frameBudget = [];
        if (avg > 22 && scale > 0.5) scale = Math.max(0.5, scale - 0.15);
        else if (avg < 14 && scale < 1) scale = Math.min(1, scale + 0.1);
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (!raf && visible && !document.hidden && !HQ.reduced() && !paused) { loop.last = 0; raf = requestAnimationFrame(loop); } };
    const still = () => { now = 0; drops.fill(0); mouseOn = 0; draw(); };

    canvas.parentElement.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
      mouseTarget = 1;
    }, { passive: true });
    canvas.parentElement.addEventListener('pointerleave', () => (mouseTarget = 0));
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { threshold: 0 }).observe(canvas);
    document.addEventListener('visibilitychange', start);
    document.addEventListener('hq:motion', () => { if (HQ.reduced()) { cancelAnimationFrame(raf); raf = 0; still(); } else start(); });
    document.addEventListener('hq:theme', () => { if (HQ.reduced()) still(); });
    addEventListener('resize', () => { if (HQ.reduced()) still(); });

    let paused = false;
    const api = {
      get paused() { return paused; },
      pause(v) { paused = !!v; if (paused) { cancelAnimationFrame(raf); raf = 0; } else start(); },
      drop(x, strength, side, delay = 0) {
        if (HQ.reduced() || paused) return;
        drops[slot * 4] = x;
        drops[slot * 4 + 1] = now + delay;
        drops[slot * 4 + 2] = strength;
        drops[slot * 4 + 3] = side;
        slot = (slot + 1) % MAX;
      },
      start,
    };
    if (HQ.reduced()) still(); else start();
    canvas.dataset.ready = 'true';
    return api;
  };

  /* Hero: podłączenie strumienia BTC, odczyt ostatniej transakcji i licznik minuty */
  window.HQ.ready(() => {
    const canvas = document.getElementById('waterline');
    if (!canvas) return;
    const hero = canvas.closest('.cinema-hero');
    const mobile = () => innerWidth < 720;
    // Linia wody biegnie po linii bazowej słowa „głębiej.”: litery stoją na niej, ogonki schodzą pod wodę
    const em = hero.querySelector('h1 em');
    const lineAt = () => {
      if (!em) return mobile() ? 0.36 : 0.44;
      let probe = em.querySelector('.bl-probe');
      if (!probe) { probe = document.createElement('i'); probe.className = 'bl-probe'; probe.setAttribute('aria-hidden', 'true'); em.append(probe); }
      const c = canvas.getBoundingClientRect();
      const y = probe.getBoundingClientRect().top;
      if (!c.height || !isFinite(y)) return 0.44;
      return Math.max(0.08, Math.min(0.92, 1 - (y - c.top) / c.height));
    };
    const wl = HQ.waterline(canvas, { line: lineAt, left: () => (mobile() ? 0.35 : 1) });
    if (wl) hero.dataset.gl = 'true';
    // Pauza ruchu tła: animacja trwa dłużej niż 5 s, więc użytkownik może ją zatrzymać (WCAG 2.2.2)
    const pauseBtn = document.getElementById('hero-pause');
    const syncPause = () => {
      if (!pauseBtn) return;
      pauseBtn.hidden = !wl || HQ.reduced();
      const p = wl && wl.paused;
      pauseBtn.setAttribute('aria-pressed', String(!!p));
      pauseBtn.querySelector('[data-hp-icon]').textContent = p ? '▷' : 'Ⅱ';
      pauseBtn.querySelector('[data-hp-label]').textContent = HQ.t(p ? 'p.heroPlay' : 'p.heroPause');
    };
    if (pauseBtn && wl) pauseBtn.addEventListener('click', () => { wl.pause(!wl.paused); syncPause(); });
    document.addEventListener('hq:lang', syncPause);
    document.addEventListener('hq:motion', syncPause);
    syncPause();

    const els = {
      px: document.getElementById('live-px'),
      sz: document.getElementById('live-sz'),
      rate: document.getElementById('live-rate'),
      rateSub: document.getElementById('live-rate-sub'),
      provLast: document.getElementById('live-prov-last'),
      provRate: document.getElementById('live-prov-rate'),
    };
    // Odczyt LIVE: każda transakcja liczona raz (po identyfikatorze), według czasu giełdy.
    // Ostatnia transakcja to najnowsza po czasie, nie ostatnia w paczce. Limit świeżości 30 s, potem „—”.
    const LIMIT = 30000;
    const seen = new Map();        // id → czas giełdy (do odrzucania powtórzeń)
    const times = [];              // czasy giełdy unikalnych transakcji z obserwowanego okna
    let last = null;
    let status = 'connecting';
    let since = null;              // początek ciągłej obserwacji (otwarcie lub ponowne połączenie)
    const MAX_DROPS = 12;          // krople na paczkę; reszta paczki jest liczona, ale nie animowana
    const SKEW = 2000;             // tolerancja różnicy zegara giełdy i przeglądarki na początku obserwacji
    const render = () => {
      const now = Date.now();
      const from = Math.max(now - 60000, (since || now) - SKEW);
      while (times.length && times[0] < from) times.shift();
      for (const [id, t] of seen) if (t < now - 120000) seen.delete(id);
      const live = status === 'live';
      const fresh = !!last && now - last.t <= LIMIT;
      const reason = HQ.t(live ? (last ? 'p.live.noTrades' : 'p.live.waitFirst') : status === 'reconnecting' ? 'p.live.reconnecting' : 'p.live.connecting');
      if (els.px) els.px.textContent = fresh ? HQ.fmt(last.px, 0) + ' USD' : HQ.DASH;
      if (els.sz) els.sz.textContent = fresh ? HQ.fmt(last.sz, last.sz < 0.01 ? 5 : last.sz < 1 ? 4 : 2) + ' BTC' : HQ.DASH;
      // Bez połączenia świeży wydruk dostaje STALE od razu; po limicie liczba gaśnie do „—” z przyczyną
      if (els.provLast) {
        if (fresh && live) HQ.setProv(els.provLast, 'live', last.t, LIMIT);
        else if (fresh) HQ.setProv(els.provLast, 'stale', last.t, LIMIT);
        else HQ.setProv(els.provLast, 'none', null, 0, reason);
      }
      const covered = live && since ? Math.min(60, Math.floor((now - since) / 1000)) : 0;
      if (els.rate) els.rate.textContent = live && since ? HQ.fmt(times.length, 0) : HQ.DASH;
      if (els.rateSub) els.rateSub.textContent = live && since ? (covered >= 60 ? HQ.t('p.live.window60') : HQ.fill(HQ.t('p.live.windowPart'), { s: covered })) : '';
      if (els.provRate) {
        if (live && since) HQ.setProv(els.provRate, 'live', now, LIMIT);
        else HQ.setProv(els.provRate, 'none', null, 0, reason);
      }
      hero.dataset.live = status;
    };
    let pending = false;
    const schedule = () => { if (!pending) { pending = true; setTimeout(() => { pending = false; render(); }, 250); } };
    const attach = (feed) => {
      if (!feed || feed._hero) return;
      feed._hero = true;
      if (feed.ws && feed.ws.readyState === 1) { status = 'live'; since = Date.now(); }
      feed.on('status', (s) => {
        // Ciągłość obserwacji zaczyna się od nowa po każdej przerwie
        if (s === 'live' && status !== 'live') { since = Date.now(); times.length = 0; }
        status = s;
        render();
      });
      feed.on('trades', (ts) => {
        // ID zapisywane od razu: powtórzenie w tej samej paczce też jest odrzucane
        const fresh = [];
        ts.forEach((t) => {
          if (!t || t.id == null || !isFinite(t.t)) return;
          const k = String(t.id);
          if (seen.has(k)) return;
          seen.set(k, t.t);
          fresh.push(t);
        });
        fresh.sort((p, q) => p.t - q.t);
        fresh.forEach((t, i) => {
          if (since && t.t >= since - SKEW) times.push(t.t);
          if (!last || t.t >= last.t) last = t;
          if (!wl || i >= MAX_DROPS) return;
          const usd = t.px * t.sz;
          // pozycja kropli: rozrzut zależny od identyfikatora; transakcje z jednej paczki spadają kolejno
          const seed = ((+String(t.id).slice(-4) || i * 37) % 997) / 997;
          const strength = Math.max(0.1, Math.min(1.2, (Math.log10(Math.max(usd, 100)) - 2.8) * 0.6));
          wl.drop(0.5 + seed * 0.48, strength, t.side === 'buy' ? 1 : -1, i * 0.07);
        });
        times.sort((p, q) => p - q);
        schedule();
      });
    };
    attach(HQ.liveFeed);
    document.addEventListener('hq:feed', (e) => attach(e.detail));
    document.addEventListener('hq:lang', render);
    setInterval(render, 1000);
    render();
  });
})();
