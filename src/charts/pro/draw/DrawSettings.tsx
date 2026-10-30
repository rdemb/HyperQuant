import React, { useEffect, useRef, useState } from 'react';
import { Bold, ChevronDown, Italic, X } from 'lucide-react';
import { DRAW_WIDTHS, Drawing, EXTENDABLE, FIB_FILL_ALPHA, FIB_LEVELS, FILL_ALPHA, SEGMENTS, TEXT_SIZES, extension, fibLevels, styleCaps, textSize, toolDef } from './model';
import type { DrawingTools, SettingsTab } from './tools';
import { ColorPicker, DASH_OPTIONS, DashIcon, useDrawState } from './DrawToolbar';
import { INTERVALS } from '../core/time';
import { fmtPx } from '../chart/layout';
import { Segmented } from '../../../ui';
import { tr } from '../../../i18n';

/**
 * Okno ustawień zaznaczonego rysunku, jak w TradingView: zakładki Styl, Tekst, Współrzędne i Widoczność na interwałach,
 * szablon (zapis jako domyślny), Anuluj i OK. Zmiany widać na wykresie od razu; „Anuluj” i Esc je cofają.
 */

const TAB_LABEL: Record<SettingsTab, string> = {
  style: tr('Styl', 'Style'),
  text: tr('Tekst', 'Text'),
  coords: tr('Współrzędne', 'Coordinates'),
  visibility: tr('Widoczność', 'Visibility'),
};

/** Zakładki narzędzia: tekst i notatka mają kolor w zakładce Tekst, pomiar i pozycje nie mają stylu, pędzel współrzędnych. */
function tabsFor(d: Drawing): SettingsTab[] {
  const caps = styleCaps(d.kind);
  const tabs: SettingsTab[] = [];
  if (caps.color && d.kind !== 'text' && d.kind !== 'note') tabs.push('style');
  if (caps.text) tabs.push('text');
  if (d.kind !== 'brush') tabs.push('coords');
  tabs.push('visibility');
  return tabs;
}

interface PointRow {
  i: number;
  label: string;
  price: boolean;
  time: boolean;
}

/** Pola współrzędnych: pozycja ma wejście, cel, stop i koniec; linia pozioma tylko cenę; VWAP, linia pionowa i profil tylko czas. */
function pointRows(d: Drawing): PointRow[] {
  switch (d.kind) {
    case 'hline':
      return [{ i: 0, label: tr('Cena', 'Price'), price: true, time: false }];
    case 'vline':
    case 'avwap':
      return [{ i: 0, label: tr('Czas', 'Time'), price: false, time: true }];
    case 'profile':
      return [
        { i: 0, label: tr('Początek', 'Start'), price: false, time: true },
        { i: 1, label: tr('Koniec', 'End'), price: false, time: true },
      ];
    case 'long':
    case 'short':
      return [
        { i: 0, label: tr('Wejście', 'Entry'), price: true, time: true },
        { i: 1, label: tr('Cel', 'Target'), price: true, time: false },
        { i: 2, label: 'Stop', price: true, time: false },
        { i: 1, label: tr('Koniec', 'End'), price: false, time: true },
      ];
    default:
      return d.pts.map((_, i) => ({ i, label: tr(`Punkt ${i + 1}`, `Point ${i + 1}`), price: true, time: true }));
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Czas lokalny do pola `datetime-local` (oś wykresu też pokazuje czas lokalny). */
const toLocal = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const FIELD = 'h-8 min-w-0 px-2 rounded-md bg-page border border-line font-mono text-xs text-ink-1 outline-none focus:border-accent [color-scheme:dark]';

/** Cena wpisywana do końca (Enter albo wyjście z pola), żeby rysunek nie skakał przy każdej cyfrze. */
const PriceField: React.FC<{ value: number; label: string; onCommit: (v: number) => void }> = ({ value, label, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft.replace(',', '.').replace(/\s/g, ''));
    if (Number.isFinite(v) && v > 0) onCommit(v);
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? fmtPx(value).replace(/\s/g, '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className={`${FIELD} w-full`}
    />
  );
};

const Check: React.FC<{ label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2.5 min-h-8 cursor-pointer text-ink-1">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 shrink-0 accent-accent" />
    {label}
  </label>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-3 min-h-9">
    <span className="w-16 shrink-0 text-ink-2">{label}</span>
    <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5">{children}</div>
  </div>
);

const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="pt-1 text-[11px] uppercase tracking-[0.08em] text-ink-3 font-medium">{children}</div>;

/** Przycisk koloru, który rozwija paletę pod wierszem. */
const ColorBtn: React.FC<{ label: string; color: string; alpha: number; open: boolean; onClick: () => void }> = ({ label, color, alpha, open, onClick }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-expanded={open}
    onClick={onClick}
    className={`h-8 px-1.5 rounded-md border inline-flex items-center gap-1.5 ${open ? 'border-accent' : 'border-line hover:border-line-strong'}`}
  >
    <span className="w-5 h-5 rounded" style={{ background: color, opacity: Math.max(alpha, 0.15) }} />
    <ChevronDown className="w-3.5 h-3.5 text-ink-3" />
  </button>
);

type ColorTarget = 'line' | 'fill' | null;

const StyleTab: React.FC<{ tools: DrawingTools; d: Drawing }> = ({ tools, d }) => {
  const [pick, setPick] = useState<ColorTarget>(null);
  const s = d.style;
  const caps = styleCaps(d.kind);
  const fib = d.kind === 'fib' || d.kind === 'fibext';
  const ext = extension(d);
  const fill = s.fill ?? s.color;
  const fillAlpha = s.fillAlpha ?? FILL_ALPHA[d.kind] ?? 0.1;
  const on = fibLevels(d).map((l) => l.v);
  const toggle = (p: ColorTarget) => setPick((x) => (x === p ? null : p));
  return (
    <div className="flex flex-col gap-1">
      <Row label={caps.stroke ? tr('Linia', 'Line') : tr('Kolor', 'Colour')}>
        <ColorBtn label={tr('Kolor', 'Colour')} color={s.color} alpha={s.alpha ?? 1} open={pick === 'line'} onClick={() => toggle('line')} />
        {caps.stroke && (
          <>
            <select aria-label={tr('Grubość linii', 'Line width')} value={s.width} onChange={(e) => tools.styleSelected({ width: Number(e.target.value) })} className={`${FIELD} w-[4.5rem]`}>
              {DRAW_WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </select>
            <Segmented
              ariaLabel={tr('Rodzaj linii', 'Line style')}
              size="xs"
              value={s.dash}
              onChange={(dash) => tools.styleSelected({ dash })}
              options={DASH_OPTIONS.map((o) => ({ value: o.value, title: o.label, label: <DashIcon d={o.d} /> }))}
            />
          </>
        )}
      </Row>
      {pick === 'line' && (
        <div className="rounded-lg border border-line bg-surface-1 p-1.5">
          <ColorPicker color={s.color} alpha={s.alpha ?? 1} onColor={(color, merge) => tools.styleSelected({ color }, merge)} onAlpha={(a) => tools.styleSelected({ alpha: a }, true)} />
        </div>
      )}
      {caps.fill && (
        <>
          <Row label={tr('Tło', 'Background')}>
            <input
              type="checkbox"
              aria-label={tr('Tło', 'Background')}
              checked={fillAlpha > 0}
              onChange={(e) => tools.styleSelected({ fillAlpha: e.target.checked ? undefined : 0 })}
              className="w-4 h-4 accent-accent"
            />
            <ColorBtn label={tr('Kolor tła', 'Background colour')} color={fill} alpha={fillAlpha} open={pick === 'fill'} onClick={() => toggle('fill')} />
          </Row>
          {pick === 'fill' && (
            <div className="rounded-lg border border-line bg-surface-1 p-1.5">
              <ColorPicker color={fill} alpha={fillAlpha} onColor={(c, merge) => tools.styleSelected({ fill: c }, merge)} onAlpha={(a) => tools.styleSelected({ fillAlpha: a }, true)} />
            </div>
          )}
        </>
      )}
      {EXTENDABLE.has(d.kind) && (
        <>
          <Title>{tr('Przedłużenie', 'Extend')}</Title>
          <div className="grid grid-cols-2 gap-x-3">
            <Check label={tr('W lewo', 'Left')} checked={ext.left} onChange={(v) => tools.editSelected({ extL: v })} />
            <Check label={tr('W prawo', 'Right')} checked={ext.right} onChange={(v) => tools.editSelected({ extR: v })} />
          </div>
        </>
      )}
      {SEGMENTS.has(d.kind) && (
        <>
          <Title>{tr('Opis', 'Labels')}</Title>
          <Check label={tr('Ceny przy końcach', 'Prices at the ends')} checked={!!d.labels} onChange={(v) => tools.editSelected({ labels: v || undefined })} />
          <Check
            label={tr('Statystyki: zmiana ceny, świece, czas, wolumen i delta', 'Stats: price change, candles, time, volume and delta')}
            checked={!!d.stats}
            onChange={(v) => tools.editSelected({ stats: v || undefined })}
          />
        </>
      )}
      {fib && (
        <>
          <Title>{tr('Poziomy', 'Levels')}</Title>
          <div className="grid grid-cols-3 gap-x-3">
            {FIB_LEVELS[d.kind === 'fibext' ? 'fibext' : 'fib'].map((l) => (
              <Check
                key={l.v}
                checked={on.includes(l.v)}
                onChange={(v) => tools.editSelected({ levels: FIB_LEVELS[d.kind === 'fibext' ? 'fibext' : 'fib'].map((x) => x.v).filter((x) => (x === l.v ? v : on.includes(x))) })}
                label={
                  <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} aria-hidden />
                    {l.v}
                  </span>
                }
              />
            ))}
          </div>
          <Check
            label={tr('Tło między poziomami', 'Background between levels')}
            checked={(s.fillAlpha ?? FIB_FILL_ALPHA) > 0}
            onChange={(v) => tools.styleSelected({ fillAlpha: v ? undefined : 0 })}
          />
        </>
      )}
    </div>
  );
};

const TextTab: React.FC<{ tools: DrawingTools; d: Drawing }> = ({ tools, d }) => {
  const [pick, setPick] = useState(false);
  const s = d.style;
  const own = d.kind === 'text' || d.kind === 'note';
  const size = textSize(d);
  const toggleBtn = (on: boolean) =>
    `h-8 w-8 rounded-md inline-flex items-center justify-center border ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line text-ink-2 hover:text-ink-1'}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {own && <ColorBtn label={tr('Kolor tekstu', 'Text colour')} color={s.color} alpha={s.alpha ?? 1} open={pick} onClick={() => setPick((p) => !p)} />}
        <select
          aria-label={tr('Rozmiar tekstu', 'Text size')}
          value={size}
          onChange={(e) => tools.styleSelected({ size: Number(e.target.value) })}
          className={`${FIELD} w-[4.5rem]`}
        >
          {[...new Set<number>([...TEXT_SIZES, size])].sort((a, b) => a - b).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" title={tr('Pogrubienie', 'Bold')} aria-label={tr('Pogrubienie', 'Bold')} aria-pressed={!!s.bold} onClick={() => tools.styleSelected({ bold: !s.bold || undefined })} className={toggleBtn(!!s.bold)}>
          <Bold className="w-4 h-4" />
        </button>
        <button type="button" title={tr('Kursywa', 'Italic')} aria-label={tr('Kursywa', 'Italic')} aria-pressed={!!s.italic} onClick={() => tools.styleSelected({ italic: !s.italic || undefined })} className={toggleBtn(!!s.italic)}>
          <Italic className="w-4 h-4" />
        </button>
      </div>
      {pick && (
        <div className="rounded-lg border border-line bg-surface-1 p-1.5">
          <ColorPicker color={s.color} alpha={s.alpha ?? 1} onColor={(color, merge) => tools.styleSelected({ color }, merge)} onAlpha={(a) => tools.styleSelected({ alpha: a }, true)} />
        </div>
      )}
      <textarea
        aria-label={tr('Tekst rysunku', 'Drawing text')}
        rows={4}
        maxLength={280}
        value={d.text ?? ''}
        placeholder={own ? tr('Tekst', 'Text') : tr('Opis poziomu', 'Level label')}
        onChange={(e) => tools.setText(e.target.value)}
        className="w-full resize-y rounded-md border border-line bg-page px-2 py-1.5 text-xs leading-[18px] text-ink-1 outline-none focus:border-accent"
      />
      <p className="text-[11px] text-ink-3">{tr('Nowa linia: Enter. Najwięcej 8 linii i 280 znaków.', 'New line: Enter. Up to 8 lines and 280 characters.')}</p>
    </div>
  );
};

const CoordsTab: React.FC<{ tools: DrawingTools; d: Drawing }> = ({ tools, d }) => (
  <div className="flex flex-col gap-1.5">
    {pointRows(d).map((r) => {
      const q = d.pts[r.i];
      return (
        <div key={`${r.i}-${r.label}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] sm:grid-cols-[4rem_6.5rem_minmax(0,1fr)] items-center gap-1.5">
          <span className="col-span-2 sm:col-span-1 text-ink-2 truncate">{r.label}</span>
          {r.price ? <PriceField value={q.p} label={`${r.label}: ${tr('cena', 'price')}`} onCommit={(p) => tools.setPoint(r.i, { t: q.t, p })} /> : <span />}
          {r.time ? (
            <input
              type="datetime-local"
              aria-label={`${r.label}: ${tr('czas', 'time')}`}
              value={toLocal(q.t)}
              onChange={(e) => {
                const t = new Date(e.target.value).getTime();
                if (Number.isFinite(t)) tools.setPoint(r.i, { t, p: q.p });
              }}
              className={`${FIELD} w-full px-1`}
            />
          ) : (
            <span />
          )}
        </div>
      );
    })}
    <p className="text-[11px] text-ink-3">{tr('Czas lokalny, dociągany do początku świecy.', 'Local time, snapped to the start of the candle.')}</p>
  </div>
);

const VisibilityTab: React.FC<{ tools: DrawingTools; d: Drawing }> = ({ tools, d }) => {
  const hidden = d.hideIv ?? [];
  const set = (ms: number, show: boolean) => {
    const next = show ? hidden.filter((x) => x !== ms) : [...hidden, ms];
    tools.editSelected({ hideIv: next.length ? next : undefined });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-4 gap-x-3">
        {INTERVALS.map((iv) => (
          <Check key={iv.id} label={<span className="font-mono">{iv.label}</span>} checked={!hidden.includes(iv.ms)} onChange={(v) => set(iv.ms, v)} />
        ))}
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => tools.editSelected({ hideIv: undefined })} className="h-8 px-2.5 rounded-md text-ink-2 hover:text-ink-1 hover:bg-surface-3">
          {tr('Wszystkie', 'All')}
        </button>
      </div>
      <p className="text-[11px] leading-snug text-ink-3">
        {tr('Na odznaczonych interwałach rysunku nie widać, ale zostaje zapisany.', 'On unchecked timeframes the drawing is not shown, but it stays saved.')}
      </p>
    </div>
  );
};

/** Szablon: zapis stylu i ustawień jako domyślnych dla nowych rysunków tego narzędzia, przywrócenie zapisanych albo wbudowanych. */
const TemplateMenu: React.FC<{ tools: DrawingTools }> = ({ tools }) => {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  const item = (label: string, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        run();
        setOpen(false);
      }}
      className="w-full min-h-8 px-2.5 rounded-md text-left text-ink-1 hover:bg-surface-3 whitespace-nowrap"
    >
      {label}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="h-8 px-2.5 rounded-md border border-line inline-flex items-center gap-1 text-ink-1 hover:border-line-strong"
      >
        {saved ? tr('Zapisano', 'Saved') : tr('Szablon', 'Template')}
        <ChevronDown className="w-3.5 h-3.5 text-ink-3" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 bottom-full mb-1 z-10 rounded-lg border border-line-strong bg-surface-2 p-1 shadow-2xl">
          {item(tr('Zapisz jako domyślny', 'Save as default'), () => {
            tools.saveDefault();
            setSaved(true);
          })}
          {tools.hasDefault() && item(tr('Zastosuj domyślny', 'Apply default'), () => tools.applyDefault(false))}
          {item(tr('Przywróć ustawienia fabryczne', 'Reset to factory settings'), () => tools.applyDefault(true))}
        </div>
      )}
    </div>
  );
};

/** Okno ustawień rysunku nad panelem ceny (przesuwane za nagłówek, żeby nie zasłaniało rysunku). */
export const DrawSettings: React.FC<{ tools: DrawingTools | null }> = ({ tools }) => {
  const st = useDrawState(tools);
  const d = st.selected;
  const [off, setOff] = useState({ x: 0, y: 0 });
  const grab = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const open = !!st.settings;

  useEffect(() => {
    if (open) setOff({ x: 0, y: 0 });
  }, [open, d?.id]);

  if (!tools || !d || !st.settings) return null;
  const tabs = tabsFor(d);
  const tab = tabs.includes(st.settings) ? st.settings : tabs[0];

  return (
    <div
      role="dialog"
      aria-label={tr(`Ustawienia: ${toolDef(d.kind).label}`, `Settings: ${toolDef(d.kind).label}`)}
      style={{ transform: `translate(calc(-50% + ${off.x}px), ${off.y}px)` }}
      className="absolute left-1/2 top-2 z-40 w-[min(400px,calc(100%-16px))] max-h-[calc(100%-16px)] flex flex-col rounded-xl border border-line-strong bg-surface-2 text-xs shadow-2xl"
      onKeyDown={(e) => {
        // Klawisze okna nie trafiają do skrótów wykresu (Delete, Ctrl+Z)
        e.stopPropagation();
        if (e.key === 'Escape') tools.closeSettings(false);
        else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) tools.closeSettings(true);
      }}
    >
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          grab.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
        }}
        onPointerMove={(e) => {
          const g = grab.current;
          if (g) setOff({ x: g.ox + e.clientX - g.x, y: Math.max(0, g.oy + e.clientY - g.y) });
        }}
        onPointerUp={() => (grab.current = null)}
        onPointerCancel={() => (grab.current = null)}
        className="flex items-center gap-2 pl-3 pr-1 pt-1 cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <span className="flex-1 truncate text-sm font-medium text-ink-1">{toolDef(d.kind).label}</span>
        <button type="button" aria-label={tr('Zamknij', 'Close')} title={tr('Zamknij', 'Close')} onClick={() => tools.closeSettings(true)} className="w-8 h-8 inline-flex items-center justify-center rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div role="tablist" className="flex gap-3 px-3 border-b border-line overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            onClick={() => tools.setSettingsTab(t)}
            className={`h-9 -mb-px border-b-2 whitespace-nowrap ${t === tab ? 'border-accent text-ink-1 font-medium' : 'border-transparent text-ink-3 hover:text-ink-1'}`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5">
        {tab === 'style' && <StyleTab tools={tools} d={d} />}
        {tab === 'text' && <TextTab tools={tools} d={d} />}
        {tab === 'coords' && <CoordsTab tools={tools} d={d} />}
        {tab === 'visibility' && <VisibilityTab tools={tools} d={d} />}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-line">
        <TemplateMenu tools={tools} />
        <span className="flex-1" />
        <button type="button" onClick={() => tools.closeSettings(false)} className="h-8 px-3 rounded-md text-ink-2 hover:text-ink-1 hover:bg-surface-3">
          {tr('Anuluj', 'Cancel')}
        </button>
        <button type="button" onClick={() => tools.closeSettings(true)} className="h-8 px-4 rounded-md bg-accent text-page font-medium hover:opacity-90">
          OK
        </button>
      </div>
    </div>
  );
};
