import React from 'react';
import { moveCalNote, moveLevelWord } from '../../components/schrodi/moveLevel';
import { locale, tr } from '../../i18n';
import { useDeskLedger } from '../../state/useDeskLedger';
import { Badge, DASH, Panel } from '../../ui';
import { isCat } from '../../utils/deskLedger';
import { CLOCK_DAYS, CLOCK_MIN_N, CLOCK_SEASON_DAYS, type NearestHour, clockHours, nearestHour } from '../../utils/moveClock';

const hmFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

/** Powód braku poziomu najbliższej godziny */
function nearestWhy(n: Exclude<NearestHour, { level: string }>, latestT: number | null): string {
  if (n.missing === 'no-forecast') return tr('brak prognozy kota w rejestrze', 'no cat forecast in the ledger');
  if (n.missing === 'stale')
    return tr(
      `ostatnia prognoza kota z ${latestT === null ? DASH : hmFmt.format(latestT)} jest starsza niż 45 min`,
      `the latest cat forecast from ${latestT === null ? DASH : hmFmt.format(latestT)} is older than 45 min`
    );
  return tr(`za mało rozstrzygniętych prognoz kota z ${CLOCK_DAYS} dni (min. ${CLOCK_MIN_N})`, `too few resolved cat forecasts from ${CLOCK_DAYS} days (min. ${CLOCK_MIN_N})`);
}

/**
 * Zegar ruchu (projekt B) przed awansem kalibracji `cat-cal-v1`: najbliższa godzina (okno ostatniej prognozy kota z rejestru)
 * jako poziom wobec typowej godziny — tercyl `pBig` w rozstrzygniętych prognozach z 14 dni — bez procentu, obok AUC
 * z rejestru i zdanie o kalibracji; godziny 2–24 jako baza sezonowa: w ilu z 20 ostatnich dni tego samego typu w tej
 * godzinie był duży ruch. Opis rynku, bez rady i kierunku.
 */
export const MoveClockPanel: React.FC = () => {
  const { status, summary } = useDeskLedger();
  if (status === 'unconfigured') return null;
  const cat = summary && isCat(summary.cat) ? summary.cat : null;
  const clock = cat?.clock ?? null;
  const now = Date.now();
  const auc = cat && cat.scores.nEff >= 20 && cat.scores.big.auc !== null ? cat.scores.big.auc : null;
  const near = clock ? nearestHour(cat?.latest ?? null, clock.terciles, now) : null;
  const hours = clock ? clockHours(clock.season, now) : [];
  return (
    <Panel
      eyebrow={tr('Rejestr prognoz · najbliższa doba', 'Forecast ledger · the next day')}
      title={tr('Zegar ruchu', 'Move clock')}
      actions={
        <Badge tone="model" title={tr('Poziom z tercyli prognoz kota i baza sezonowa z rozliczeń rejestru', 'Level from cat forecast terciles and a seasonal base from ledger settlements')}>
          MODEL
        </Badge>
      }
      bodyClassName="p-4 flex flex-col gap-3 text-sm"
    >
      {!clock ? (
        <p className="text-ink-3">
          {DASH}{' '}
          {status === 'loading'
            ? tr('czekam na podsumowanie rejestru', 'waiting for the ledger summary')
            : !summary
              ? tr('podsumowanie rejestru niedostępne (błąd pobrania), kolejna próba za chwilę', 'ledger summary unavailable (fetch error), retrying shortly')
              : tr('brak sekcji zegara w podsumowaniu rejestru', 'no clock section in the ledger summary')}
        </p>
      ) : (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-ink-2">
                {tr('Najbliższa godzina', 'The next hour')}
                {near && 'level' in near && (
                  <span className="font-mono text-ink-3">
                    {' '}
                    {hmFmt.format(near.from)}–{hmFmt.format(near.to)}
                  </span>
                )}
              </span>
              <span className="font-mono font-semibold text-accent">{near && 'level' in near ? `${tr('ruch', 'move')} ${moveLevelWord(near.level)}` : DASH}</span>
            </div>
            <p className="mt-1 text-[11px] text-ink-3 leading-snug">
              {near && 'level' in near
                ? tr(
                    `Szansa dużego ruchu wobec typowej godziny: tercyl wśród ${near.n} rozstrzygniętych prognoz kota z ${CLOCK_DAYS} dni.`,
                    `Odds of a big move against a typical hour: tercile among ${near.n} resolved cat forecasts from ${CLOCK_DAYS} days.`
                  )
                : near
                  ? `${tr('Poziomu brak', 'No level')}: ${nearestWhy(near, cat?.latest?.t ?? null)}.`
                  : ''}{' '}
              {auc !== null && tr(`Kolejność szans sprawdzona: AUC ${auc.toFixed(2).replace('.', ',')} w rejestrze.`, `Ranking checked: AUC ${auc.toFixed(2)} in the ledger.`)} {moveCalNote()}
            </p>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2 text-ink-2">
              <span>{tr('Godziny 2–24', 'Hours 2–24')}</span>
              <Badge
                tone="model"
                title={tr(
                  `Baza sezonowa: w ilu z ${CLOCK_SEASON_DAYS} ostatnich dni tego samego typu (robocze albo sobota i niedziela UTC) w tej godzinie był duży ruch kota; bez prognozy i bez twierdzenia o przewadze`,
                  `Seasonal base: on how many of the last ${CLOCK_SEASON_DAYS} days of the same type (weekdays, or Saturday and Sunday UTC) the cat's big move happened in this hour; no forecast and no claim of an edge`
                )}
              >
                {tr('MODEL · baza sezonowa', 'MODEL · seasonal base')}
              </Badge>
            </div>
            <ul className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 font-mono text-[11px]">
              {hours.map((h) => (
                <li key={h.hour} className="flex justify-between gap-2">
                  <span className="text-ink-2">
                    {hmFmt.format(h.hour)}
                    {h.weekend && <span className="text-ink-3"> {tr('wknd', 'wknd')}</span>}
                  </span>
                  <span className="text-ink-1">{h.n > 0 ? tr(`${h.k} z ${h.n} dni`, `${h.k} of ${h.n} days`) : DASH}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-ink-3 leading-snug">
              {tr(
                `Duży ruch: zakres godziny ponad medianę zakresu godziny z 30 dni (próg kota). Częstość z ${CLOCK_SEASON_DAYS} ostatnich dni tego samego typu, pełne godziny z rejestru; „—” oznacza brak godzin w rejestrze. To opis przeszłości, nie prognoza.`,
                `Big move: an hourly range above the 30-day median hourly range (the cat's threshold). Frequency over the last ${CLOCK_SEASON_DAYS} days of the same type, full hours from the ledger; “—” means no hours in the ledger. A description of the past, not a forecast.`
              )}
            </p>
          </div>
        </>
      )}
    </Panel>
  );
};
