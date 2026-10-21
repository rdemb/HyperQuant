import React from 'react';

/** Uczciwy stan braku danych — mówi dlaczego i co zrobić, zamiast pokazywać liczby zastępcze. */
export const EmptyState: React.FC<{ title: string; detail?: React.ReactNode; className?: string }> = ({ title, detail, className = '' }) => (
  <div className={`flex flex-col items-start gap-1 px-4 py-6 text-left ${className}`}>
    <div className="text-sm font-medium text-ink-2">{title}</div>
    {detail && <div className="text-xs text-ink-3 max-w-prose leading-relaxed">{detail}</div>}
  </div>
);
