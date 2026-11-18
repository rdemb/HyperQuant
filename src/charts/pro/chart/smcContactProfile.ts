import type { ContactProfile, ContactProfiles } from '../core/smcContactDelta';
import { MONO, PRO, rgba } from './theme';

export interface ContactProfileView { zone: string; at: number | null; ordinal: number | null; compare: boolean }
const LANE_PX = 44;
const PADDING_PX = 4;
export function contactProfileWidth(compare: boolean): number {
  return PADDING_PX + (LANE_PX + PADDING_PX) * (compare ? 2 : 1);
}

export function contactProfileScale(profiles: ContactProfiles): number {
  let max = 0;
  for (const profile of [profiles.current, profiles.previous]) {
    for (const bin of profile?.bins ?? []) max = Math.max(max, bin.turnoverUsd);
  }
  return max;
}

interface ContactLane {
  profile: ContactProfile | null;
  bins: { top: number; bottom: number; turnover: number; delta: number }[];
}

export function contactProfileScene(profiles: ContactProfiles, compare: boolean, project: (price: number) => number | null): ContactLane[] {
  const scale = contactProfileScale(profiles);
  const objects = compare ? [profiles.current, profiles.previous] : [profiles.current];
  return objects.map(profile => {
    const bins: ContactLane['bins'] = [];
    for (const b of profile?.bins ?? []) {
      const a = project(b.hi), z = project(b.lo);
      if (a === null || z === null || b.turnoverUsd <= 0 || !(scale > 0)) continue;
      bins.push({ top: Math.min(a, z), bottom: Math.max(a, z), turnover: b.turnoverUsd / scale, delta: b.deltaUsd / scale });
    }
    return { profile, bins };
  });
}

/** Osobny pas osi ceny. Wspólna skala USD dla obu kontaktów i obu kodowań. */
export function drawContactProfiles(ctx: CanvasRenderingContext2D, lanes: readonly ContactLane[], right: number, height: number): void {
  if (!lanes.length) return;
  const left = right - contactProfileWidth(lanes.length > 1);
  if (left < 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, 0, right - left, height);
  ctx.clip();
  ctx.font = `600 9px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const half = LANE_PX / 2;
  for (let i = 0; i < lanes.length; i++) {
    const { profile, bins } = lanes[i];
    const center = left + PADDING_PX + i * (LANE_PX + PADDING_PX) + half;
    for (const b of bins) {
      const h = Math.max(0, b.bottom - b.top - 0.35);
      if (b.bottom <= 0 || b.top >= height || h <= 0) continue;
      const background = b.turnover * half;
      ctx.fillStyle = rgba(PRO.volBar, 0.85);
      ctx.fillRect(center - background, b.top, background * 2, h);
      const inset = h >= 5 ? 1 : 0;
      const tail = b.delta * half;
      if (tail) {
        ctx.fillStyle = b.delta > 0 ? PRO.buy : PRO.sell;
        ctx.fillRect(center + Math.min(0, tail), b.top + inset, Math.abs(tail), h - inset * 2);
      }
      ctx.fillStyle = rgba(PRO.ink1, 0.55);
      ctx.fillRect(center - 0.5, b.top, 1, h);
    }
    ctx.fillStyle = PRO.ink2;
    const y = Math.min(height - 2, Math.max(14, (bins.filter(b => b.bottom > 0 && b.top < height).at(-1)?.top ?? 27) - 3));
    ctx.fillText(profile?.status === 'complete' ? `#${profile.ordinal}` : '—', center, y, LANE_PX);
  }
  ctx.restore();
}
