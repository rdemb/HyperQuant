/* HyperQuant · sceny pokazu, wersja 2. Osiem żywych ilustracji funkcji terminala (Canvas 2D).
   Każda scena dostaje postęp rozdziału z przewijania (p) i czas (t, sekundy) dla ruchu ciągłego.
   Wszystkie wartości w scenach są symulowane (plakietka SIM na scenie). Ograniczony ruch: t = 0. */
(() => {
  'use strict';
  const W = 900;
  const H = 610;
  const C = {
    lime: '#dcff72', pale: '#f1eaff', blue: '#9bb8ff', rose: '#ff9bb5', plum: '#a490d3',
    ink: '#120e1d', panel: '#18122a', line: '#3a3150', gold: '#f2d391',
  };
  const TXT = {
    pl: { candles: 'Świece', footprint: 'Footprint', heatmap: 'Heatmapa', ask: 'ASK', bid: 'BID', tape: 'TAŚMA', book: 'KSIĘGA', now: 'TERAZ',
      snapA: 'MIGAWKA A', snapB: 'MIGAWKA B', trade: 'TRANSAKCJA', unsettled: 'kolejność nieustalona', detect: 'WYKRYCIE', service: 'SERWIS', device: 'URZĄDZENIE',
      forecast: 'PROGNOZA', outcome: 'WYNIK', save: 'ZAPISANO', drop: 'UPUŚĆ TUTAJ', gold: 'ZŁOTO' },
    en: { candles: 'Candles', footprint: 'Footprint', heatmap: 'Heatmap', ask: 'ASK', bid: 'BID', tape: 'TAPE', book: 'BOOK', now: 'NOW',
      snapA: 'SNAPSHOT A', snapB: 'SNAPSHOT B', trade: 'TRADE', unsettled: 'order not settled', detect: 'DETECT', service: 'SERVICE', device: 'DEVICE',
      forecast: 'FORECAST', outcome: 'OUTCOME', save: 'SAVED', drop: 'DROP HERE', gold: 'GOLD' },
  };
  let L = TXT.pl;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (v) => 1 - (1 - clamp(v)) ** 3;
  const easeIO = (v) => { v = clamp(v); return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2; };
  const mix = (a, b, k) => a + (b - a) * k;
  const noise = (i) => { const v = Math.sin(i * 93.173 + 27.7) * 46543.89; return v - Math.floor(v); };
  const power = (x, c, w) => Math.exp(-((x - c) ** 2) / w);
  const A = (hex, a) => hex + Math.round(clamp(a) * 255).toString(16).padStart(2, '0');

  let g = null;
  const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); };
  const poly = (pts, fill, stroke, w = 1) => { path(pts); if (fill) { g.closePath(); g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = w; g.stroke(); } };
  const ln = (x, y, x2, y2, c, w = 1) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.strokeStyle = c; g.lineWidth = w; g.stroke(); };
  const rr = (x, y, w, h, fill, stroke, r = 0, sw = 1) => { g.beginPath(); g.roundRect(x, y, w, h, r); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = sw; g.stroke(); } };
  const dot = (x, y, r, c) => { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); g.fillStyle = c; g.fill(); };
  const ring = (x, y, r, c, w = 1) => { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); g.strokeStyle = c; g.lineWidth = w; g.stroke(); };
  const txt = (s, x, y, c = C.plum, size = 12, weight = 500, align = 'left') => { g.fillStyle = c; g.font = `${weight} ${size}px "JetBrains Mono", ui-monospace, monospace`; g.textAlign = align; g.fillText(s, x, y); g.textAlign = 'left'; };
  const sans = (s, x, y, c = C.pale, size = 14, weight = 650, align = 'left') => { g.fillStyle = c; g.font = `${weight} ${size}px "Plus Jakarta Sans", system-ui, sans-serif`; g.textAlign = align; g.fillText(s, x, y); g.textAlign = 'left'; };
  const glow = (x, y, c, s, a = 0.28) => { const r = g.createRadialGradient(x, y, 0, x, y, s); r.addColorStop(0, A(c, a)); r.addColorStop(0.45, A(c, a * 0.4)); r.addColorStop(1, A(c, 0)); g.fillStyle = r; g.fillRect(x - s, y - s, s * 2, s * 2); };
  const waterline = (x1, x2, y, a = 1) => { ln(x1, y, x2, y, A(C.lime, 0.22 * a), 9); ln(x1, y, x2, y, A(C.lime, a), 2); };
  const glass = (x, y, w, h, r = 12, tint = C.plum, a = 1) => {
    const gr = g.createLinearGradient(x, y, x, y + h);
    gr.addColorStop(0, A('#2a2140', 0.86 * a)); gr.addColorStop(1, A('#150f22', 0.9 * a));
    rr(x, y, w, h, gr, A(tint, 0.5 * a), r);
    ln(x + r, y + 0.5, x + w - r, y + 0.5, A(C.pale, 0.18 * a));
  };
  const grid = () => {
    for (let x = 35; x < W - 30; x += 35) for (let y = 30; y < H - 24; y += 35) dot(x, y, 1, A(C.plum, 0.08 + noise(x * 17 + y) * 0.2));
    const m = A(C.pale, 0.34);
    [[28, 27, 1, 1], [872, 27, -1, 1], [28, 580, 1, -1], [872, 580, -1, -1]].forEach(([x, y, a, b]) => poly([[x + a * 15, y], [x, y], [x, y + b * 15]], null, m));
  };
  const iso = (x, depth, z = 0) => [150 + x * 6.45 + depth * 2.45, 392 - x * 1.15 + depth * 1.18 - z];

  /* 1 · Przed sesją: profil likwidacji w przekroju 3D, oddychający; cząstki unoszą się z najwyższych skupisk */
  function przed(p, t) {
    glow(500, 330, C.plum, 340);
    const slab = [[-2, -2], [97, -2], [97, 50], [-2, 50]].map(([a, b]) => iso(a, b));
    poly(slab, A('#554673', 0.3), A('#7c6897', 0.6));
    for (let i = 0; i <= 96; i += 8) poly([iso(i, 0), iso(i, 48)], null, A('#7c6897', 0.25));
    const grow = ease(p * 1.6);
    for (let d = 0; d < 48; d += 3) {
      for (let x = 0; x < 96; x += 2) {
        const a = power(x, 25 + d * 0.22, 138) * power(d, 17, 190);
        const b = power(x, 74 - d * 0.22, 138) * power(d, 28, 160);
        const breath = 1 + 0.07 * Math.sin(t * 1.4 + x * 0.21 + d * 0.13);
        const mag = (4 + (Math.max(a, b) * 200 + 22 * noise(x + d * 30)) * (0.25 + 0.75 * grow)) * breath;
        const col = a > b ? C.plum : C.rose;
        const [x1, y1] = iso(x, d);
        const [tx, ty] = iso(x, d, mag);
        ln(x1, y1, tx, ty, A(col, 0.15 + Math.min(0.65, mag / 260)), 2);
        if (mag > 150) {
          dot(tx, ty, 1.3, A(C.pale, 0.75));
          const life = (t * 0.35 + noise(x * 7 + d)) % 1;
          if (noise(x * 13 + d * 3) > 0.72) dot(tx, ty - life * 70, 1.4 * (1 - life), A(C.pale, 0.6 * (1 - life)));
        }
      }
    }
    const a = iso(47, -7, 23);
    const b = iso(47, 59, 23);
    poly([a, b], null, A(C.lime, 0.25), 10);
    poly([a, b], null, C.lime, 2);
    const pulse = (t * 0.6) % 1;
    ring(b[0], b[1], 4 + pulse * 22, A(C.lime, 0.6 * (1 - pulse)), 1.5);
    dot(b[0], b[1], 4, C.lime);
    txt('BTC', b[0] + 12, b[1] + 5, C.lime, 15, 600);
  }

  /* 2 · Wykresy: szklane karty wysuwają się nad wykres, przełączają widok i chowają */
  function wykresy(p, t) {
    const x = 92, y = 118, w = 716, h = 400;
    glow(450, 330, C.blue, 320, 0.22);
    rr(x, y, w, h, '#120d1f', A('#77638e', 0.8), 14);
    const tabs = [L.candles, L.footprint, L.heatmap];
    const active = Math.floor((t / 2.6) % 3);
    const k = ((t / 2.6) % 1);
    const fadeIn = clamp(k * 5);
    // treść wykresu: trzy tryby
    g.save();
    g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, h - 2, 13); g.clip();
    for (let i = 1; i < 10; i++) ln(x + i * w / 10, y, x + i * w / 10, y + h, A('#6f5e85', 0.18));
    for (let i = 1; i < 8; i++) ln(x, y + i * h / 8, x + w, y + i * h / 8, A('#6f5e85', 0.2));
    const mode = t === 0 ? 0 : active;
    const alpha = t === 0 ? 1 : fadeIn;
    const series = (i) => 300 - (Math.sin(i * 0.3) * 40 + i * 2.6 + noise(i * 72) * 26);
    if (mode === 0) {
      for (let i = 0; i < 34; i++) {
        const xx = x + 28 + i * 19.6;
        const o = series(i), c = o + 34 * (noise(i + 100) - 0.5);
        const col = c < o ? C.blue : C.rose;
        ln(xx + 4, Math.min(o, c) - 14, xx + 4, Math.max(o, c) + 14, A(col, alpha));
        rr(xx, Math.min(o, c), 8, Math.max(2, Math.abs(o - c)), A(col, alpha), null, 1);
      }
    } else if (mode === 1) {
      for (let i = 0; i < 16; i++) {
        const xx = x + 30 + i * 42;
        const o = series(i * 2);
        for (let j = 0; j < 7; j++) {
          const yy = o - 42 + j * 12;
          const l = noise(i * 9 + j), r = noise(i * 9 + j + 50);
          rr(xx, yy, 17 * l, 9, A(C.rose, (0.25 + l * 0.6) * alpha), null, 2);
          rr(xx + 19, yy, 17 * r, 9, A(C.blue, (0.25 + r * 0.6) * alpha), null, 2);
        }
      }
    } else {
      for (let j = 0; j < 22; j++) {
        for (let i = 0; i < 36; i++) {
          const v = power(j, 9 + Math.sin(i * 0.2) * 3, 8) + 0.6 * power(j, 16, 4) * noise(i);
          rr(x + i * 20, y + 40 + j * 15, 19, 14, A(v > 0.5 ? C.lime : C.plum, Math.min(0.85, v * 0.75) * alpha), null, 1);
        }
      }
    }
    // linia ceny (linia wody)
    const py = y + 182 + Math.sin(t * 0.5) * 6;
    waterline(x, x + w, py, 0.85);
    rr(x + w - 62, py - 11, 56, 22, C.lime, null, 4);
    txt('BTC', x + w - 48, py + 5, '#191e09', 11, 700);
    g.restore();
    // szklane karty: wysuwają się na początku rozdziału i chowają przy końcu
    const show = t === 0 ? 1 : easeIO(clamp(p * 4)) * (1 - easeIO(clamp((p - 0.82) * 6)));
    const ty = y - 46 + show * 66;
    g.globalAlpha = clamp(show * 1.4);
    const tw = 116, gap = 6, tx = x + w / 2 - (tw * 3 + gap * 2) / 2 - 8;
    glass(tx, ty, tw * 3 + gap * 2 + 16, 42, 21, C.pale);
    const from = tx + 8 + ((active + 2) % 3) * (tw + gap);
    const to = tx + 8 + active * (tw + gap);
    const ix = t === 0 ? tx + 8 : mix(from, to, easeIO(k * 3));
    rr(ix, ty + 6, tw, 30, A(C.pale, 0.12), A(C.pale, 0.2), 15);
    ln(ix + 18, ty + 34, ix + tw - 18, ty + 34, C.lime, 2);
    tabs.forEach((s, i) => sans(s, tx + 8 + i * (tw + gap) + tw / 2, ty + 26, i === (t === 0 ? 0 : active) ? C.pale : A(C.pale, 0.6), 13, 650, 'center'));
    g.globalAlpha = 1;
    // uchwyt karty widoczny po schowaniu
    const handle = 1 - show;
    if (handle > 0.05) { rr(x + w / 2 - 28, y + 6, 56, 5, A(C.pale, 0.35 * handle), null, 3); }
  }

  /* 3 · Order Flow: księga (DOM) po prawej, taśma płynie po linii wody, bąble przy cenie */
  const tapeSeed = Array.from({ length: 60 }, (_, i) => ({ off: noise(i * 3.1), size: noise(i * 7.7), buy: noise(i * 11.3) > 0.48 }));
  function flow(p, t) {
    glow(420, 300, C.plum, 330);
    const base = 305, domX = 640, rowH = 15;
    // księga: 9 poziomów ASK nad linią, 9 BID pod linią
    rr(domX - 14, 96, 236, 418, A(C.panel, 0.7), A(C.line, 0.9), 12);
    txt(L.book, domX, 118, C.plum, 11, 600);
    for (let i = 0; i < 9; i++) {
      const wobA = 0.82 + 0.18 * Math.sin(t * (1.1 + i * 0.13) + i);
      const wobB = 0.82 + 0.18 * Math.sin(t * (0.9 + i * 0.17) + i * 2);
      const wa = (40 + 140 * noise(i * 78)) * wobA * (0.5 + 0.5 * ease(p * 2));
      const wb = (40 + 150 * noise(i * 33 + 5)) * wobB * (0.5 + 0.5 * ease(p * 2));
      const ya = base - 12 - (i + 1) * (rowH + 3);
      const yb = base + 12 + i * (rowH + 3);
      rr(domX, ya, wa, rowH, A(C.rose, 0.3 + noise(i) * 0.45), null, 3);
      rr(domX, yb, wb, rowH, A(C.blue, 0.3 + noise(i + 40) * 0.45), null, 3);
      if (i === 0) { ring(domX + wa + 6, ya + rowH / 2, 3, A(C.rose, 0.6)); ring(domX + wb + 6, yb + rowH / 2, 3, A(C.blue, 0.6)); }
    }
    txt(L.ask, domX + 176, base - 22, C.rose, 11, 700);
    txt(L.bid, domX + 176, base + 31, C.blue, 11, 700);
    // taśma: bąble wpływają z prawej strony linii i płyną w lewo
    waterline(70, domX - 24, base);
    txt(L.tape, 74, base - 154, C.plum, 11, 600);
    const speed = 62;
    for (let i = 0; i < tapeSeed.length; i++) {
      const s = tapeSeed[i];
      const x = domX - 30 - ((t * speed + i * 34 + s.off * 20) % 600);
      if (x < 72) continue;
      const fade = clamp((x - 72) / 80) * clamp((domX - 30 - x) / 40);
      const r = 3 + s.size ** 2.2 * 22;
      const y = base + (s.buy ? -1 : 1) * (8 + s.off * 92) * (0.4 + 0.6 * ease(p * 1.4));
      const col = s.buy ? C.blue : C.rose;
      ln(x, y, x, base, A(col, 0.25 * fade));
      dot(x, y, r, A(col, 0.18 * fade));
      ring(x, y, r, A(col, 0.75 * fade), 1.2);
      if (r > 14) dot(x, y, 2, A(C.pale, 0.9 * fade));
    }
    // znacznik „teraz” przy wejściu taśmy
    const nx = domX - 30;
    ln(nx, base - 130, nx, base + 130, A(C.lime, 0.45), 1);
    dot(nx, base, 6, C.lime);
    ring(nx, base, 6 + ((t * 1.2) % 1) * 16, A(C.lime, 0.6 * (1 - ((t * 1.2) % 1))), 1.5);
    txt(L.now, nx - 15, base + 150, C.lime, 11, 700);
  }

  /* 4 · Powtórka: dwie dokładne migawki i transakcja pomiędzy; kursor przewija nagranie */
  function powtorka(p, t) {
    glow(560, 270, C.blue, 300, 0.22);
    glow(330, 320, C.plum, 240);
    const axisY = 470, x0 = 110, x1 = 790;
    const ta = 0.24, tb = 0.78, tt = 0.52;
    const X = (k) => mix(x0, x1, k);
    const cur = t === 0 ? 0.6 : mix(0.08, 0.94, easeIO(p));
    [[ta, L.snapA], [tb, L.snapB]].forEach(([k, name], i) => {
      const x = X(k);
      const lit = Math.abs(cur - k) < 0.05 ? 1 : 0.55;
      glass(x - 88, 150 + i * 14, 176, 200, 12, C.plum, 1);
      txt(name, x - 72, 178 + i * 14, A(C.plum, 0.6 + lit * 0.4), 11, 700);
      for (let j = 0; j < 8; j++) {
        const w = 24 + noise(i * 10 + j * 14) * 120 * (i === 1 && j === 6 ? 0.19 : 1);
        rr(x - 72, 194 + i * 14 + j * 18, w, 9, A(j < 4 ? C.rose : C.blue, 0.35 + noise(j * 190) * 0.4), null, 2);
      }
      ln(x, 350 + i * 14, x, axisY, A(C.plum, 0.7));
      dot(x, axisY, 4, C.plum);
    });
    // transakcja między migawkami
    const tx = X(tt);
    const near = clamp(1 - Math.abs(cur - tt) * 8);
    glow(tx, 300, C.lime, 90, 0.18 + 0.2 * near);
    ln(tx, 250, tx, axisY, A(C.lime, 0.7));
    dot(tx, 250, 9 + near * 4, A(C.lime, 0.25));
    ring(tx, 250, 9 + near * 4, C.lime, 1.5);
    txt(L.trade, tx - 34, 230, C.lime, 11, 700);
    // klamra „kolejność nieustalona”
    const between = cur > ta && cur < tb;
    if (between) {
      const a = 0.4 + 0.6 * clamp(Math.min(cur - ta, tb - cur) * 12);
      poly([[X(ta), axisY + 26], [X(ta), axisY + 34], [X(tb), axisY + 34], [X(tb), axisY + 26]], null, A(C.lime, a), 1.5);
      sans(L.unsettled, (X(ta) + X(tb)) / 2, axisY + 56, A(C.pale, a), 14, 650, 'center');
    }
    // oś i kursor
    ln(x0, axisY, x1, axisY, A(C.plum, 0.6));
    for (let i = 0; i <= 34; i++) ln(x0 + i * 20, axisY + 6, x0 + i * 20, axisY + 10 + (i % 5 ? 0 : 6), A('#9c86bd', 0.45));
    const cx = X(cur);
    ln(x0, axisY, cx, axisY, C.lime, 2);
    ln(cx, 130, cx, axisY, A(C.lime, 0.35), 1);
    dot(cx, axisY, 7, C.lime);
    // drobne wydruki w tle kursora
    for (let i = 0; i < 18; i++) {
      const k = (noise(i * 5) + t * 0.02) % 1;
      const x = X(k);
      if (Math.abs(x - cx) < 4) dot(x, axisY - 16, 2.2, C.pale);
      else dot(x, axisY - 16, 1.3, A(C.plum, 0.55));
    }
  }

  /* 5 · Rynki: trzy karty w obrocie, szklane zakładki pod spodem */
  function rynki(p, t) {
    glow(450, 300, C.plum, 330);
    const names = ['BTC', L.gold, 'S&P 500'];
    const tints = [C.plum, C.gold, C.blue];
    const spin = t === 0 ? 0 : t * 0.32 + p * 2;
    const items = names.map((n, i) => {
      const ang = spin + (i * Math.PI * 2) / 3;
      return { n, i, ang, z: Math.cos(ang), x: Math.sin(ang) };
    }).sort((a, b) => a.z - b.z);
    items.forEach(({ n, i, z, x }) => {
      const s = 0.72 + 0.28 * (z + 1) / 2;
      const cw = 220 * s, ch = 250 * s;
      const cx = 450 + x * 230 - cw / 2;
      const cy = 270 - ch / 2 + (1 - s) * 40;
      const a = 0.35 + 0.65 * (z + 1) / 2;
      const gr = g.createLinearGradient(cx, cy, cx + cw, cy + ch);
      gr.addColorStop(0, A(tints[i], 0.32 * a)); gr.addColorStop(1, A('#1a1220', 0.95));
      rr(cx, cy, cw, ch, gr, A(tints[i], 0.75 * a), 14 * s);
      sans(n, cx + 18 * s, cy + 34 * s, A(C.pale, a), 17 * s, 700);
      for (let j = 0; j < 14; j++) {
        const hh = (20 + power(j, i * 3 + 4, 12) * 78 + noise(i * 60 + j) * 39) * s * (0.9 + 0.1 * Math.sin(t * 2 + j));
        rr(cx + 18 * s + j * 13 * s, cy + ch - 34 * s - hh, 8 * s, hh, A(tints[i], (0.16 + hh / 235) * a), null, 2);
      }
      ln(cx + 14 * s, cy + ch - 30 * s, cx + cw - 14 * s, cy + ch - 30 * s, A(tints[i], 0.45 * a));
    });
    // szklane zakładki rynków
    const front = items[items.length - 1].i;
    const tw = 112, tx = 450 - (tw * 3 + 12) / 2 - 8;
    glass(tx, 470, tw * 3 + 28, 44, 22, C.pale);
    rr(tx + 8 + front * (tw + 6), 476, tw, 32, A(C.pale, 0.12), A(C.pale, 0.2), 16);
    ln(tx + 26 + front * (tw + 6), 505, tx + 8 + front * (tw + 6) + tw - 18, 505, C.lime, 2);
    names.forEach((n, i) => sans(n, tx + 8 + i * (tw + 6) + tw / 2, 497, i === front ? C.pale : A(C.pale, 0.55), 13, 650, 'center'));
  }

  /* 6 · Po sesji: prognozy opadają na oś wyniku i układają się wzdłuż przekątnej kalibracji */
  function po(p, t) {
    glow(470, 320, C.plum, 320);
    const x0 = 210, y0 = 500, s = 300;
    glass(x0 - 40, y0 - s - 40, s + 80, s + 80, 16, C.plum);
    ln(x0, y0, x0 + s, y0, A(C.plum, 0.7));
    ln(x0, y0, x0, y0 - s, A(C.plum, 0.7));
    g.setLineDash([5, 6]); ln(x0, y0, x0 + s, y0 - s, A(C.pale, 0.35)); g.setLineDash([]);
    txt(L.forecast, x0 + s - 70, y0 + 24, C.plum, 11, 700);
    txt(L.outcome, x0 - 30, y0 - s - 12, C.plum, 11, 700);
    const settle = ease(p * 1.5);
    for (let i = 0; i < 26; i++) {
      const k = (i + 0.5) / 26;
      const tx = x0 + k * s;
      const ty = y0 - (k + (noise(i * 3) - 0.5) * 0.12) * s;
      const sy = mix(y0 - s - 60 - noise(i) * 120, ty, ease(settle * 1.4 - noise(i * 9) * 0.4));
      const pulse = t === 0 ? 0 : 0.5 + 0.5 * Math.sin(t * 2 + i);
      dot(tx, sy, 4.5, A(C.lime, 0.5 + 0.3 * pulse));
      ring(tx, sy, 7 + pulse * 3, A(C.lime, 0.25));
    }
    // dziennik: karty zapisów z prawej, ostatnia z pieczęcią
    for (let i = 0; i < 4; i++) {
      const y = 140 + i * 78 + (t === 0 ? 0 : Math.sin(t * 0.8 + i) * 2);
      glass(580, y, 220, 62, 10, i === 3 ? C.lime : C.plum);
      rr(596, y + 16, 90 + noise(i) * 70, 6, A(C.pale, 0.55), null, 3);
      rr(596, y + 32, 60 + noise(i + 4) * 90, 6, A(C.plum, 0.5), null, 3);
      if (i === 3) { ring(770, y + 31, 13, C.lime, 2); poly([[764, y + 31], [769, y + 36], [777, y + 26]], null, C.lime, 2); }
    }
    txt(L.save, 600, 482, C.lime, 11, 700);
  }

  /* 7 · Źródła: wykrycie → serwis → urządzenie; pakiet przebiega łańcuch, pierścienie potwierdzeń */
  function zrodla(p, t) {
    glow(470, 330, C.blue, 330, 0.22);
    const pts = [[182, 330], [450, 250], [718, 330]];
    const cols = [C.plum, C.blue, C.lime];
    const names = [L.detect, L.service, L.device];
    poly(pts, null, A(C.plum, 0.45), 2);
    const loop = t === 0 ? clamp(p) : ((t * 0.28) % 1);
    const seg = loop < 0.5 ? 0 : 1;
    const k = easeIO(seg === 0 ? loop * 2 : (loop - 0.5) * 2);
    const [ax, ay] = pts[seg];
    const [bx, by] = pts[seg + 1];
    const cx = mix(ax, bx, k), cy = mix(ay, by, k);
    pts.forEach(([x, y], i) => {
      const reached = i === 0 || (i === 1 ? loop >= 0.5 : loop >= 0.98) || t === 0;
      for (let r = 34; r < 110; r += 18) ring(x, y, r, A(cols[i], (reached ? 0.5 : 0.22) - r * 0.003));
      dot(x, y, 26, A(cols[i], reached ? 0.95 : 0.4));
      dot(x, y, 9, '#170f20');
      txt(names[i], x, y + 128, cols[i], 12, 700, 'center');
    });
    glow(cx, cy, C.pale, 40, 0.4);
    dot(cx, cy, 6, C.pale);
    // pieczęcie pochodzenia
    [['LIVE', C.lime], ['MODEL', C.plum], ['SIM', C.gold]].forEach(([s, c], i) => {
      const x = 300 + i * 110, y = 120 + (t === 0 ? 0 : Math.sin(t + i * 1.4) * 3);
      rr(x, y, 92, 26, A('#1c1530', 0.9), A(c, 0.8), 13);
      dot(x + 16, y + 13, 4, c);
      txt(s, x + 28, y + 17, c, 11, 700);
    });
  }

  /* 8 · Stanowisko: panele składają się w układ; przenoszony panel trafia do karty wskazanej linią */
  function stanowisko(p, t) {
    glow(470, 320, C.plum, 320);
    const slots = [[96, 120, 400, 170, C.plum], [512, 120, 292, 170, C.blue], [96, 306, 252, 186, C.rose], [364, 306, 440, 186, C.plum]];
    const gather = ease(p * 1.8);
    slots.forEach(([x, y, w, h, c], i) => {
      const sx = x + (noise(i * 4) - 0.5) * 260 * (1 - gather);
      const sy = y + (noise(i * 9) - 0.5) * 200 * (1 - gather);
      g.globalAlpha = 0.3 + 0.7 * gather;
      glass(sx, sy, w, h, 11, c);
      ln(sx, sy + 32, sx + w, sy + 32, A(c, 0.3));
      rr(sx + 16, sy + 13, 30 + i * 18, 6, A(c, 0.85), null, 3);
      dot(sx + w - 18, sy + 16, 3, c);
      for (let j = 0; j < 14; j++) {
        const v = (16 + noise(j * 52 + i * 71) * 70) * (0.85 + 0.15 * Math.sin(t * 1.6 + j * 0.7 + i));
        const gap = (w - 40) / 14;
        rr(sx + 18 + j * gap, sy + h - 16 - v, gap - 5, v, A(c, 0.2 + v / 180), null, 2);
      }
      g.globalAlpha = 1;
    });
    // przenoszony panel: z karty 3 do karty 4, linia wskazuje cel
    const mv = t === 0 ? 1 : easeIO(clamp((p - 0.35) * 2.2));
    const target = slots[3];
    const tx = target[0] + 24, ty = target[1] + 46;
    const fx = 120, fy = 352;
    const x = mix(fx, tx, mv), y = mix(fy, ty, mv) - Math.sin(mv * Math.PI) * 50;
    if (mv > 0.05 && mv < 0.98) {
      g.setLineDash([4, 6]); rr(target[0] + 12, target[1] + 40, 236, 118, null, A(C.lime, 0.7), 10, 1.5); g.setLineDash([]);
      txt(L.drop, target[0] + 24, target[1] + 172, C.lime, 10, 700);
    }
    g.save(); g.shadowColor = A('#000000', 0.55); g.shadowBlur = 30 * Math.sin(mv * Math.PI) + 6; g.shadowOffsetY = 12;
    glass(x, y, 210, 96, 10, C.lime);
    g.restore();
    rr(x, y, 210, 96, null, C.lime, 10, 1.5);
    for (let j = 0; j < 5; j++) rr(x + 16, y + 20 + j * 13, 50 + noise(j * 14) * 120, 5, A(C.lime, 0.4 + noise(j * 24) * 0.4), null, 3);
    // znacznik celu: linia wody pod kartą docelową
    const land = clamp((mv - 0.85) * 7);
    if (land > 0) { ln(target[0] + 20, target[1] + target[3] + 10, target[0] + 20 + (target[2] - 40) * land, target[1] + target[3] + 10, C.lime, 2); }
  }

  const scenes = [przed, wykresy, flow, powtorka, rynki, po, zrodla, stanowisko];
  window.HQStage = {
    count: scenes.length,
    create(canvas) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return () => {};
      return (scene, progress, time) => {
        const dpr = Math.min(1.75, devicePixelRatio || 1);
        const width = Math.round(canvas.clientWidth * dpr);
        const height = Math.round(canvas.clientHeight * dpr);
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        L = TXT[(window.HQ && window.HQ.lang) === 'en' ? 'en' : 'pl'];
        g = ctx;
        // Wąska scena (telefon): przybliżenie kadru, marginesy ilustracji wychodzą poza krawędź
        const scale = Math.min(width / W, height / H) * (width / height < 1.15 ? 1.24 : 1);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, width, height);
        g.setTransform(scale, 0, 0, scale, (width - W * scale) / 2, (height - H * scale) / 2);
        grid();
        scenes[scene](clamp(progress), time || 0);
      };
    },
  };
})();
