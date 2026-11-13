import React from 'react';
import { tr } from '../../i18n';
import { Badge } from '../../ui';

/**
 * Komórka liczby LIVE: wartość, pod nią plakietka LIVE z godziną odczytu albo — gdy liczb nie ma — powód „—”.
 * Tylko prezentacja: tekst wartości, godzinę i powód dostaje gotowe.
 */
export const LiveCell: React.FC<{ value: string; readAt: string | null; why: string | null }> = ({ value, readAt, why }) => (
  <>
    <span className={why === null ? undefined : 'text-ink-3'}>{value}</span>
    <span className="mt-0.5 flex justify-end items-center gap-1 font-sans text-[10.5px] text-ink-3">
      {readAt !== null ? (
        <>
          <Badge tone="live" size="sm" title={tr('Realne dane Hyperliquid; godzina odczytu w czasie lokalnym', 'Real Hyperliquid data; reading time in local time')}>
            LIVE
          </Badge>
          <span>{readAt}</span>
        </>
      ) : (
        why
      )}
    </span>
  </>
);
