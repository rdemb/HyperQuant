import React from 'react';

/**
 * Tytuł wyłaniający się litera po literze (spod linii, z lekkim rozmyciem), raz przy wejściu. Czytnik ekranu dostaje
 * cały tekst (sr-only), litery są dekoracją. Słowa nie łamią się w środku. Ograniczony ruch: tekst od razu (CSS).
 */
export const Litery: React.FC<{ text: string; start?: number; className?: string }> = ({ text, start = 0, className = '' }) => {
  let i = start;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split(' ').map((slowo, w, all) => (
          <React.Fragment key={w}>
            <span className="hq-litery-slowo">
              {[...slowo].map((z) => (
                <span key={i} className="hq-litera" style={{ animationDelay: `${0.15 + i++ * 0.035}s` }}>
                  {z}
                </span>
              ))}
            </span>
            {w < all.length - 1 && ' '}
          </React.Fragment>
        ))}
      </span>
    </span>
  );
};
