import React, { useEffect, useState } from 'react';

/**
 * Liczba jak licznik mechaniczny: każda cyfra to taśma 0–9 przesuwana w pionie (transform, bez zmiany układu). Przy
 * pierwszym pokazaniu cyfry przewijają się od zera, przy zmianie tylko te, które się zmieniły. Szerokość stała (cyfry
 * tabelaryczne), czytnik ekranu dostaje zwykły tekst. Tylko dla liczb odświeżanych rzadko (karty rynków co 60 s), nie dla
 * ceny w nagłówku, którą trader czyta w ruchu. Ograniczony ruch: bez przewijania (CSS).
 */
const CYFRY = '0123456789';

export const Liczydlo: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  // Pierwsza klatka z zerami, potem właściwe cyfry: przejście CSS przewija taśmy (setTimeout zamiast rAF, który bywa dławiony)
  const [gotowe, setGotowe] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGotowe(true), 40);
    return () => window.clearTimeout(t);
  }, []);
  const znaki = [...text];
  return (
    <span className={`hq-liczydlo ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="hq-liczydlo-cyfry">
        {znaki.map((z, i) => {
          // Klucz od prawej: przy zmianie długości liczby jedności zostają tą samą taśmą
          const klucz = znaki.length - i;
          const d = CYFRY.indexOf(z);
          if (d < 0) return <span key={`z${klucz}`} className="hq-liczydlo-znak">{z}</span>;
          return (
            <span key={`c${klucz}`} className="hq-cyfra">
              <span className="hq-cyfra-tasma" style={{ transform: `translateY(${gotowe ? -d * 10 : 0}%)`, transitionDelay: `${Math.min(i, 8) * 35}ms` }}>
                {CYFRY.split('').map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
};
