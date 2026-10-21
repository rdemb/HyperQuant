import React, { useEffect, useRef, useState } from 'react';
import { DASH } from './format';

interface AnimatedNumberProps {
  value: number | null | undefined;
  format: (v: number) => string;
  className?: string;
  /** Błysk tła przy zmianie (≤ 3/s, 160 ms) */
  flash?: boolean;
}

/**
 * Liczba z krótkim błyskiem kierunku zmiany. Bez animowania cyfr (tekst nie rusza się podczas czytania).
 * Błyski są dławione do max 3 na sekundę (WCAG 2.3.1).
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, format, className = '', flash = true }) => {
  const prev = useRef<number | null>(null);
  const lastFlashAt = useRef(0);
  const [flashClass, setFlashClass] = useState('');
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    if (!flash || typeof value !== 'number' || !Number.isFinite(value)) return;
    const p = prev.current;
    prev.current = value;
    if (p === null || p === value) return;
    const now = performance.now();
    if (now - lastFlashAt.current < 334) return;
    lastFlashAt.current = now;
    setFlashClass(value > p ? 'hq-flash-up' : 'hq-flash-down');
    setFlashKey((k) => k + 1);
  }, [value, flash]);

  const text = typeof value === 'number' && Number.isFinite(value) ? format(value) : DASH;
  return (
    <span key={flashKey} className={`rounded-sm ${flashClass} ${className}`}>
      {text}
    </span>
  );
};
