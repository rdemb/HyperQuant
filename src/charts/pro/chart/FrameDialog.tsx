import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Copy, Download, OctagonAlert, X } from 'lucide-react';
import { Segmented } from '../../../ui';
import { FOCUSABLE, dialogKeyDown, holdFocus } from './dialogFocus';
import { FRAME_SIZE, type FrameQuality, type FrameRatio, composeFrame, frameAlt, frameFileName, frameWarnings, titleProblems } from './frame';
import { IMAGE_FAILED, downloadCanvas } from './screenshot';
import { tr } from '../../../i18n';

/**
 * Okno Klatki: proporcja (16:9 albo 1:1), tytuł do edycji z blokadą rad, podgląd obrazu, ostrzeżenia, tekst alternatywny
 * do skopiowania i pobranie PNG. Obraz powstaje w przeglądarce i zostaje na komputerze — nic nie jest wysyłane.
 * Okno modalne: fokus w środku (Tab krąży, dialogFocus), Escape zamyka, fokus wraca do przycisku, który je otworzył.
 */

/** Co trafia do Klatki: obraz, domyślny tytuł, źródło, chwila danych i jakość — z chwili otwarcia okna. */
export interface FrameSource {
  /** Część nazwy pliku: id układu albo „czworka”. */
  layout: string;
  /** Domyślny tytuł (do edycji). */
  title: string;
  source: string;
  time: number;
  quality: FrameQuality;
  /** Warstwy na wykresie ceny; Czwórka — 0. */
  layersShown: number;
  /** Warstwy ceny we wzorcu panelu układu: ostrzeżenie tylko ponad wzorzec i ponad 4 (`frameWarnings`). */
  presetLayers: number;
  /** Obraz do kadru w proporcji `ratio` (wykres: ten sam zrzut, Czwórka: karta 4 × 1 albo 2 × 2); null — brak płótna. */
  image: (ratio: FrameRatio) => HTMLCanvasElement | null;
  /** Opis obrazu do tekstu alternatywnego (Czwórka: wszystkie cztery liczby). */
  body?: string;
}

const RATIOS: { value: FrameRatio; label: string; title: string }[] = [
  { value: '16:9', label: '16:9', title: `${FRAME_SIZE['16:9'].w} × ${FRAME_SIZE['16:9'].h} px` },
  { value: '1:1', label: '1:1', title: `${FRAME_SIZE['1:1'].w} × ${FRAME_SIZE['1:1'].h} px` },
];
const TITLE_MAX = 200;
/** Podgląd po przerwie w pisaniu (kodowanie PNG trwa kilkadziesiąt ms). */
const PREVIEW_DELAY_MS = 150;

export const FrameDialog: React.FC<{
  src: FrameSource;
  onClose: () => void;
  /** Fokus po zamknięciu, gdy elementu, który otworzył okno, już nie ma (pozycja menu „Więcej” na telefonie). */
  returnFocus?: () => HTMLElement | null;
}> = ({ src, onClose, returnFocus }) => {
  const [ratio, setRatio] = useState<FrameRatio>('16:9');
  const [title, setTitle] = useState(src.title);
  // Ostatni tytuł bez rad: podgląd i opis nie pokazują zablokowanego tytułu (podglądu też nie da się zapisać z nim)
  const [good, setGood] = useState(() => (titleProblems(src.title).length === 0 ? src.title : ''));
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const headId = useId();
  const problemsId = useId();
  const onTitle = (t: string) => {
    setTitle(t);
    if (titleProblems(t).length === 0) setGood(t);
  };
  // Obraz każdej proporcji raz: zrzut z chwili otwarcia i karta z tych samych liczb co tytuł i opis
  const images = useRef(new Map<FrameRatio, HTMLCanvasElement | null>());
  const imageFor = (r: FrameRatio) => {
    if (!images.current.has(r)) images.current.set(r, src.image(r));
    return images.current.get(r) ?? null;
  };
  /** Klatka z tytułem `t` w proporcji `r`; brak płótna — null (bez obrazu, nigdy obraz bez paska jakości). */
  const make = (t: string, r: FrameRatio) => {
    const canvas = imageFor(r);
    return canvas ? composeFrame({ canvas, ratio: r, title: t, time: src.time, source: src.source, quality: src.quality, layersShown: src.layersShown }) : null;
  };
  const encode = (t: string, r: FrameRatio) => ({ url: make(t, r)?.toDataURL('image/png') ?? null, ratio: r });
  // Pierwszy podgląd od razu, kolejne po przerwie w pisaniu albo po zmianie proporcji
  const [preview, setPreview] = useState(() => encode(good, ratio));
  const firstPreview = useRef(true);
  useEffect(() => {
    if (firstPreview.current) {
      firstPreview.current = false;
      return;
    }
    const id = window.setTimeout(() => setPreview(encode(good, ratio)), PREVIEW_DELAY_MS);
    return () => window.clearTimeout(id);
    // encode czyta tylko src (stałe przez życie okna)
  }, [good, ratio]);
  const alt = useMemo(() => frameAlt({ title: good, time: src.time, source: src.source, quality: src.quality, body: src.body }), [good, src]);
  const problems = titleProblems(title);
  const blocked = problems.length > 0;
  const warnings = frameWarnings(src.layersShown, src.presetLayers);
  const shown = FRAME_SIZE[preview.ratio];

  // Fokus w oknie od otwarcia; przy zamknięciu wraca do elementu, który okno otworzył (bez niego — `returnFocus`)
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  useEffect(() => holdFocus(document, ref.current, () => returnRef.current?.() ?? null), []);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(id);
  }, [note]);

  const download = () => {
    if (blocked) return;
    const out = make(title, ratio);
    if (!out) return setNote(IMAGE_FAILED);
    downloadCanvas(out, frameFileName(src.layout, src.time, ratio));
    setNote(tr('Zapisano PNG na tym komputerze', 'PNG saved on this computer'));
  };
  const copyAlt = () => {
    if (blocked) return;
    const fail = () => setNote(tr('Nie udało się skopiować — zaznacz opis poniżej i skopiuj go ręcznie', 'Copy failed — select the description below and copy it by hand'));
    if (!navigator.clipboard) return fail();
    navigator.clipboard.writeText(alt).then(() => setNote(tr('Skopiowano opis obrazu', 'Image description copied')), fail);
  };

  // Miejsce okna ustalone przy otwarciu: w pełnym ekranie wykresu w jego elemencie (inaczej byłoby pod nim). Wyjście
  // z pełnego ekranu nie przenosi okna (bez ponownego montowania i utraty fokusu).
  const [host] = useState(() => document.fullscreenElement ?? document.body);
  // Tło zamyka tylko kliknięcie zaczęte i skończone na nim (przewijanie dotykiem od marginesu go nie zamyka)
  const downOnBackdrop = useRef(false);
  return createPortal(
    <div
      // Wyśrodkowanie marginesem (my-auto), nie items-center: wyższe od ekranu okno przewija się od góry, bez uciętego nagłówka
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-page/80 backdrop-blur-sm p-2 sm:p-4"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headId}
        tabIndex={-1}
        className="w-full max-w-[760px] h-fit my-auto rounded-xl border border-line-strong bg-surface-2 text-xs text-ink-1 shadow-2xl outline-none"
        onKeyDown={(e) => {
          // Klawisze okna nie trafiają do skrótów wykresu; Tab krąży w oknie, Escape zamyka
          e.stopPropagation();
          // Bez pól z tabIndex −1 (nieaktywne opcje przełącznika proporcji)
          const items = ref.current ? [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.tabIndex >= 0) : [];
          dialogKeyDown(e, items, document.activeElement as HTMLElement | null, onClose);
        }}
      >
        <div className="flex items-start gap-2 border-b border-line pl-3 pr-1 py-1.5">
          <div className="flex-1 min-w-0 py-1">
            <h2 id={headId} className="text-sm font-medium text-ink-1">
              {tr('Klatka', 'Frame')}
            </h2>
            <p className="mt-0.5 leading-snug text-ink-3">
              {tr(
                'Obraz do publikacji z tytułem, godziną, źródłem i paskiem jakości danych. Plik powstaje w przeglądarce i zostaje na tym komputerze.',
                'An image to publish with a title, time, source and the data quality strip. The file is made in your browser and stays on this computer.'
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label={tr('Zamknij', 'Close')}
            title={tr('Zamknij', 'Close')}
            onClick={onClose}
            className="w-11 h-11 sm:w-8 sm:h-8 shrink-0 inline-flex items-center justify-center rounded-md text-ink-3 hover:text-ink-1 hover:bg-surface-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Segmented<FrameRatio> ariaLabel={tr('Proporcja Klatki', 'Frame aspect ratio')} value={ratio} onChange={setRatio} options={RATIOS} />
            <span className="font-mono tabular-nums text-ink-3">
              {FRAME_SIZE[ratio].w} × {FRAME_SIZE[ratio].h} px
            </span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Tytuł', 'Title')}</span>
            <textarea
              value={title}
              maxLength={TITLE_MAX}
              rows={3}
              onChange={(e) => onTitle(e.target.value)}
              aria-invalid={blocked}
              aria-describedby={blocked ? problemsId : undefined}
              className={`w-full resize-y rounded-lg border bg-surface-1 px-2.5 py-2 text-[13px] leading-snug text-ink-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                blocked ? 'border-critical' : 'border-line-strong'
              }`}
            />
            <span className="leading-snug text-ink-3">
              {tr(
                'Najlepiej z liczbą z wykresu. Opis rynku, nie rada: bez „kup”, „sprzedaj”, gotowych wejść long i short ani TP/SL.',
                'Ideally with a number from the chart. A description of the market, not advice: no buy or sell calls, ready-made long or short entries, or TP/SL.'
              )}
            </span>
          </label>

          {blocked && (
            <div id={problemsId} role="alert" className="flex flex-col gap-1 rounded-lg border border-critical/50 bg-critical/10 px-2.5 py-2">
              {problems.map((p) => (
                <p key={p} className="flex items-start gap-1.5 leading-snug text-ink-1">
                  <OctagonAlert className="w-3.5 h-3.5 mt-px shrink-0 text-critical" aria-hidden="true" />
                  <span>{p}</span>
                </p>
              ))}
              <p className="pl-5 leading-snug text-ink-3">
                {good
                  ? tr('Podgląd i opis pokazują ostatni tytuł bez tych słów.', 'The preview and description show the last title without these words.')
                  : tr('Podgląd i opis bez tytułu, dopóki go nie poprawisz.', 'The preview and description have no title until you fix it.')}
              </p>
            </div>
          )}

          {warnings.map((wn) => (
            <p key={wn} role="status" className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 leading-snug text-ink-1">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-warn" aria-hidden="true" />
              <span>{wn}</span>
            </p>
          ))}

          {preview.url ? (
            <img
              src={preview.url}
              alt={alt}
              width={shown.w}
              height={shown.h}
              className={`block h-auto rounded-lg border border-line ${preview.ratio === '1:1' ? 'w-full sm:w-[min(100%,420px)] sm:mx-auto' : 'w-full'} ${blocked ? 'opacity-40' : ''}`}
            />
          ) : (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-critical/50 bg-critical/10 px-2.5 py-2 leading-snug text-ink-1">
              <OctagonAlert className="w-3.5 h-3.5 mt-px shrink-0 text-critical" aria-hidden="true" />
              <span>{tr(`${IMAGE_FAILED}: przeglądarka nie dała płótna do rysowania.`, `${IMAGE_FAILED}: the browser gave no drawing canvas.`)}</span>
            </p>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{tr('Opis obrazu (tekst alternatywny)', 'Image description (alt text)')}</span>
            <p className="select-all rounded-lg border border-line bg-surface-1 px-2.5 py-2 leading-snug text-ink-2">{alt}</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {note && (
              <span role="status" className="mr-auto leading-snug text-ink-2">
                {note}
              </span>
            )}
            <button
              type="button"
              onClick={copyAlt}
              disabled={blocked}
              className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg border border-line-strong text-ink-1 font-medium hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 transition-colors duration-150"
            >
              <Copy className="w-4 h-4" />
              {tr('Kopiuj opis', 'Copy alt text')}
            </button>
            <button
              type="button"
              onClick={download}
              disabled={blocked || !preview.url}
              title={blocked ? problems[0] : frameFileName(src.layout, src.time, ratio)}
              className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg bg-accent text-page font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity duration-150"
            >
              <Download className="w-4 h-4" />
              {tr('Pobierz PNG', 'Download PNG')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    host
  );
};
