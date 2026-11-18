import { tr } from '../../../i18n';
import { numberedContacts, type FlowSnapshot } from '../core/smcOrderflow';
import { barEnd, barStart } from '../core/time';
import { MONO, PRO, rgba } from './theme';

export interface SmcHitZone { id: string; x0: number; x1: number; y0: number; y1: number }
export interface ObservationMark { time: number; price: number; kind: 'contact' | 'retreat'; text: string; ordinal: number }

export function observationCaption(s: FlowSnapshot): string {
  const n = s.contacts, few = n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
  const count = tr(`${n} ${n === 1 ? 'kontakt' : few ? 'kontakty' : 'kontaktów'}`, `${n} ${n === 1 ? 'contact' : 'contacts'}`);
  const kind = s.kind === 'ob' ? 'OB' : 'FVG';
  const quality = !s.complete ? tr(' · niepełna taśma', ' · partial tape') :
    s.defense === 'weakening' ? tr(' · obrona słabnie', ' · defense weakening') : '';
  return `${kind} · ${count}${quality}`;
}

export function formationCaption(f: FlowSnapshot['fvg']): string {
  if (!f || f.strongFlow === null || f.lowLiquidity === null) {
    const facts = [f?.strongFlow && tr('silny przepływ', 'strong flow'), f?.lowLiquidity && tr('niska L2', 'thin L2')].filter(Boolean);
    return ['FVG', ...facts, tr('niepełne dane', 'incomplete data')].join(' · ');
  }
  const facts = [f.strongFlow && tr('silny przepływ', 'strong flow'), f.lowLiquidity && tr('niska L2', 'thin L2')].filter(Boolean);
  return facts.length ? ['FVG', ...facts].join(' · ') : tr('FVG · poniżej progów', 'FVG · thresholds not met');
}

export function contactMarks(s: FlowSnapshot, cutoff: number): ObservationMark[] {
  const out: ObservationMark[] = [];
  for (const { ordinal, contact: c } of numberedContacts(s)) {
    if (c.observedAt > cutoff || c.from > cutoff) continue;
    out.push({ time: c.from, price: c.price, kind: 'contact', ordinal, text: tr(`Kontakt ${ordinal}`, `Contact ${ordinal}`) });
    if (c.endedAt !== null && c.endedAt <= cutoff && c.retreatPrice !== null) {
      out.push({ time: c.endedAt, price: c.retreatPrice, kind: 'retreat', ordinal, text: tr(`Odbicie ${ordinal}`, `Retreat ${ordinal}`) });
    }
  }
  return out;
}

/** Brak świecy nie daje współrzędnej, także po prawej stronie danych. */
export function printCoordinate(bars: readonly { t: number }[], t: number, ms: number, center = false) {
  const start = barStart(t, ms);
  let lo = 0, hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = bars[mid].t;
    if (at === start) return { logical: mid + (center ? 0 : (t - at) / (barEnd(at, ms) - at) - .5), bar: mid };
    if (at < start) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function pickSmcZone(zones: readonly SmcHitZone[], x: number, y: number, tolerance: number, selected: string | null): string | null {
  const distance = (z: SmcHitZone) => Math.max(z.y0 - y, y - z.y1, 0);
  const matches = zones.filter(z => x >= z.x0 && x <= z.x1 && distance(z) <= tolerance);
  matches.sort((a, b) => distance(a) - distance(b) || (a.y1 - a.y0) - (b.y1 - b.y0) || b.x0 - a.x0);
  const ids = [...new Set(matches.map(z => z.id))];
  if (!ids.length) return null;
  const first = ids.indexOf(selected ?? '');
  return ids[(first + 1) % ids.length] ?? null;
}

interface ChartPoint { x: number; y: number }
export interface ChartNote extends ChartPoint {
  text: string; ink: string; side: 'left' | 'right'; symbol?: 'dot' | 'diamond';
}
export interface ObservationOverlay {
  path: (ChartPoint & { connect: boolean })[];
  notes: ChartNote[];
  outline: (Omit<SmcHitZone, 'id'> & { ink: string }) | null;
  callout: (ChartNote & { id: string }) | null;
  pickedLabel: SmcHitZone | null;
}

export function drawObservationOverlay(ctx: CanvasRenderingContext2D, overlay: ObservationOverlay, width: number, height: number): void {
  if (!overlay.path.length && !overlay.notes.length && !overlay.callout && !overlay.outline) return;
  ctx.save();
  if (overlay.outline) {
    const z = overlay.outline;
    ctx.strokeStyle = rgba(z.ink, .9);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(z.x0, z.y0, z.x1 - z.x0, Math.max(1, z.y1 - z.y0));
    ctx.setLineDash([]);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = PRO.accent;
  ctx.beginPath();
  overlay.path.forEach((p, i) => {
    if (i && p.connect) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.fillStyle = PRO.accent;
  overlay.path.forEach((p, i) => {
    if (!p.connect || i === overlay.path.length - 1) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  });

  const labels: { left: number; right: number; top: number; bottom: number }[] = [];
  const draw = (note: ChartNote, callout = false) => {
    if (note.x < 0 || note.x > width || note.y < 0 || note.y > height) return null;
    if (note.symbol) {
      ctx.fillStyle = note.ink;
      ctx.beginPath();
      if (note.symbol === 'dot') ctx.arc(note.x, note.y, 3, 0, 2 * Math.PI);
      else {
        ctx.moveTo(note.x, note.y - 4); ctx.lineTo(note.x + 4, note.y);
        ctx.lineTo(note.x, note.y + 4); ctx.lineTo(note.x - 4, note.y);
        ctx.closePath();
      }
      ctx.fill();
    }
    const h = callout ? 22 : 15, room = Math.max(0, width - 4);
    if (room < 30 || height < h) return null;
    ctx.font = `600 ${callout ? 10.5 : 9.5}px ${MONO}`;
    const w = Math.min(room, Math.ceil(ctx.measureText(note.text).width) + 12);
    const preferred = note.side === 'left' ? note.x - w - 5 : note.x + 6;
    const left = Math.max(2, Math.min(width - w - 2, preferred));
    const right = left + w;
    const middle = note.symbol ? note.y - 8 - h / 2 : note.y;
    const tops = [middle - h / 2, middle + h / 2 + 3, middle - 1.5 * h - 3, middle + 1.5 * h + 6];
    for (const top of tops.map(y => Math.max(0, Math.min(height - h, y)))) {
      const bottom = top + h;
      if (labels.some(r => left < r.right + 2 && right > r.left - 2 && top < r.bottom + 2 && bottom > r.top - 2)) continue;
      labels.push({ left, right, top, bottom });
      ctx.fillStyle = rgba(PRO.bg, 0.93);
      ctx.fillRect(left, top, w, h);
      ctx.fillStyle = note.ink;
      ctx.fillRect(left, top, 2, h);
      ctx.fillStyle = PRO.ink1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(note.text, left + 7, top + h / 2, w - 10);
      return { x0: left, x1: right, y0: top, y1: bottom };
    }
    return null;
  };
  if (overlay.callout) {
    const p = draw(overlay.callout, true);
    overlay.pickedLabel = p && { ...p, id: overlay.callout.id };
  }
  for (const note of overlay.notes) draw(note);
  ctx.restore();
}
