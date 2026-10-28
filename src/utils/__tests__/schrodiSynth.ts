import { mulberry32 } from '../pathEngine.ts';
import type { Bar } from '../schrodi.ts';

/** Ten sam generator co w kodzie uczenia: błądzenie losowe, co trzeci dzień spokojniej, ok. 0,2% brakujących minut. */
export function synth(seed: number, start: number, days: number): Bar[] {
  const u = mulberry32(seed);
  const out: Bar[] = [];
  let p = 80000;
  for (let i = 0; i < days * 1440; i++) {
    const a = u();
    const b = u();
    const c = u();
    const d = u();
    const e = u();
    const vol = Math.floor(i / 1440) % 3 ? 0.0006 : 0.0012;
    const o = p;
    p = p * (1 + (a - 0.5) * vol);
    const h = Math.max(o, p) * (1 + b * 0.0003);
    const l = Math.min(o, p) * (1 - c * 0.0003);
    const v = 1 + d * 20 + (e > 0.99 ? 40 : 0);
    if (e < 0.002) continue;
    const r = (x: number) => Math.floor(x * 10) / 10;
    out.push({ t: start + i * 60_000, o: r(o), h: r(h), l: r(l), c: r(p), v });
  }
  return out;
}

export function agg(m1: Bar[], ms: number): Bar[] {
  const out: Bar[] = [];
  for (const b of m1) {
    const t = Math.floor(b.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else out.push({ ...b, t });
  }
  return out;
}
