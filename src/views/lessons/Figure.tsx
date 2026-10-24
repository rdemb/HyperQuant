import React, { useEffect, useState } from 'react';
import { loadSlice, type LessonSlice } from '../../lessons/data';
import { FootprintFigure } from '../../lessons/chart/FootprintFigure';
import { LessonChart, type ChartMark, type ChartZone } from '../../lessons/chart/LessonChart';
import type { FigureLayers } from '../../lessons/chart/model';
import type { LessonsContent } from '../../lessons/content/types';

/** Wycinek rynku dla ryciny; `failed` po błędzie pobrania albo złym formacie. */
export function useSlice(id: string): { slice: LessonSlice | null; failed: boolean } {
  const [state, setState] = useState<{ id: string; slice: LessonSlice | null; failed: boolean }>({ id, slice: null, failed: false });
  useEffect(() => {
    let live = true;
    loadSlice(id)
      .then((slice) => live && setState({ id, slice, failed: false }))
      .catch(() => live && setState({ id, slice: null, failed: true }));
    return () => {
      live = false;
    };
  }, [id]);
  return state.id === id ? state : { slice: null, failed: false };
}

interface FigureProps {
  slice: LessonSlice;
  view: 'candles' | 'footprint';
  layers: FigureLayers;
  cursor: number;
  marks?: readonly ChartMark[];
  zones?: readonly ChartZone[];
  pick?: { value: number | null; step: number; onPick?: (px: number) => void } | null;
  c: LessonsContent;
  label: string;
}

/** Rycina lekcji: świece ze wskaźnikami albo footprint, z tekstami i strefą czasu wybranego języka. */
export const Figure: React.FC<FigureProps> = ({ slice, view, layers, c, ...rest }) =>
  view === 'footprint' && slice.fp ? (
    <FootprintFigure slice={slice} text={c.chart} tz={c.tz} locale={c.locale} {...rest} />
  ) : (
    <LessonChart slice={slice} layers={layers} text={c.chart} tz={c.tz} locale={c.locale} {...rest} />
  );

/** Miejsce na rycinę w trakcie wczytywania albo po błędzie. */
export const FigureStatus: React.FC<{ failed: boolean; c: LessonsContent; height?: number }> = ({ failed, c, height = 360 }) => (
  <div className="w-full flex items-center justify-center rounded-lg bg-of-bg text-sm text-ink-3" style={{ height }} role="status">
    {failed ? c.ui.loadError : c.ui.loading}
  </div>
);
