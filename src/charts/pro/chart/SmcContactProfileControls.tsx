import { tr } from '../../../i18n';
import { fmtFixed, fmtSigned } from '../../../ui/format';
import type { ContactProfile, ContactProfiles } from '../core/smcContactDelta';

function profileText(profile: ContactProfile): string {
  const running = profile.active ? tr(' · trwa', ' · ongoing') : '';
  const kind = `#${profile.ordinal}${running}`;
  if (profile.status === 'coverage') return tr(`${kind} · niepełna taśma`, `${kind} · incomplete tape`);
  if (profile.status === 'retention') return tr(`${kind} · brak zachowanego zapisu`, `${kind} · recording unavailable`);
  return `${kind} · Δ ${fmtSigned(profile.deltaUsd, 2)} USD`;
}

function profileTitle(profile: ContactProfile): string {
  return profile.status === 'complete'
    ? tr(`Kontakt ${profile.ordinal} · obrót ${fmtFixed(profile.turnoverUsd, 2)} USD · delta ${fmtSigned(profile.deltaUsd, 2)} USD`,
      `Contact ${profile.ordinal} · turnover ${fmtFixed(profile.turnoverUsd, 2)} USD · delta ${fmtSigned(profile.deltaUsd, 2)} USD`)
    : profileText(profile);
}

export function SmcContactProfileControls({ profiles, compare, onCompare, replay }: {
  profiles: ContactProfiles | null; compare: boolean; onCompare: () => void; replay: boolean;
}) {
  const cur = profiles?.current;
  const previous = profiles?.previous;
  return <div className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 text-xs text-ink-1" data-smc-contact-profile={cur?.status ?? 'no-contact'}>
    <span className="sr-only">{tr('Tło: obrót USD. Niebieski w prawo: dodatnia delta USD. Czerwony w lewo: ujemna delta USD.', 'Background: USD turnover. Blue to the right: positive USD delta. Red to the left: negative USD delta.')}</span>
    <span className="py-2 font-mono tabular-nums" title={cur && profileTitle(cur)}>
      {tr('Profil kontaktu', 'Contact profile')} · {cur ? profileText(cur) : tr('brak kontaktu z taśmy', 'no contact on tape')}
    </span>
    {cur && <><span className="text-ink-3">{replay ? tr('Odtworzenie', 'Replay') : 'LIVE'}</span>
      <button type="button" className="min-h-11 sm:min-h-7 rounded-md px-2 underline decoration-dotted underline-offset-2 aria-pressed:bg-surface-3 aria-pressed:text-accent"
        aria-pressed={compare} onClick={onCompare}>{tr('Porównaj z poprzednim', 'Compare with previous')}</button></>}
    {compare && cur && <span className="py-1 tabular-nums" title={previous ? profileTitle(previous) : undefined}>
      {previous ? profileText(previous) : cur.ordinal > 1 ? tr('Brak zachowanego poprzedniego kontaktu', 'Previous contact was not retained') :
        tr('Brak poprzedniego kontaktu', 'No previous contact')}
    </span>}
  </div>;
}
