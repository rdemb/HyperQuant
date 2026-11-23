import React, { useEffect, useRef } from 'react';

/**
 * Nagłówek, który „odszyfrowuje się” jak w terminalu, gdy pierwszy raz wjedzie na ekran: znaki przewijają się przez
 * cyfry i litery, potem kolejno od lewej stają na właściwych miejscach (ok. 0,7 s). Układ się nie rusza: właściwy tekst
 * zajmuje miejsce (niewidoczny), a szyfr leży nad nim. Czytnik ekranu dostaje zwykły tekst. Ograniczony ruch: bez efektu.
 */
const ZNAKI = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ#%&*+=<>/';

function ruchOgraniczony(): boolean {
  return document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export const Deszyfr: React.FC<{ text: string }> = ({ text }) => {
  const nakladka = useRef<HTMLSpanElement>(null);
  const kotwica = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = nakladka.current;
    const cel = kotwica.current;
    if (!el || !cel || ruchOgraniczony() || typeof IntersectionObserver === 'undefined') return;
    let timer = 0;
    const start = () => {
      const t0 = performance.now();
      const dlugosc = 700;
      const krok = () => {
        const p = Math.min(1, (performance.now() - t0) / dlugosc);
        const gotowe = Math.floor(p * text.length);
        let out = '';
        for (let i = 0; i < text.length; i++) {
          const z = text[i];
          out += i < gotowe || z === ' ' ? z : ZNAKI[Math.floor(Math.random() * ZNAKI.length)];
        }
        el.textContent = out;
        if (p < 1) timer = window.setTimeout(krok, 32);
        else {
          el.textContent = '';
          el.dataset.gotowe = '';
          cel.style.color = '';
        }
      };
      cel.style.color = 'transparent';
      delete el.dataset.gotowe;
      krok();
    };
    const obs = new IntersectionObserver(
      (wpisy) => {
        if (wpisy.some((w) => w.isIntersecting)) {
          obs.disconnect();
          start();
        }
      },
      { threshold: 0.6 }
    );
    obs.observe(cel);
    return () => {
      obs.disconnect();
      window.clearTimeout(timer);
      cel.style.color = '';
    };
  }, [text]);
  return (
    <span className="hq-deszyfr">
      <span ref={kotwica}>{text}</span>
      <span ref={nakladka} aria-hidden="true" className="hq-deszyfr-nakladka" data-gotowe="" />
    </span>
  );
};
