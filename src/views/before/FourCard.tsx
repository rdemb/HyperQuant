import React, { useEffect, useId, useState } from 'react';
import { Badge, type BadgeTone, DASH } from '../../ui';
import { type Market, storeFor } from '../../charts/pro/store/proStore';
import { startRecording } from '../../charts/pro/store/recording';
import { useStoreVersion } from '../../charts/pro/store/useStoreVersion';
import { useBlogMaps } from '../../state/useBlogMaps';
import { useLiqMap } from '../../state/useLiqMap';
import { type FourNumber, type FourNumbers, fourNumbers, readFourInputs } from '../../utils/fourNumbers';
import { tr } from '../../i18n';

/** Bez zmian w magazynie (cisza, brak połączenia) i tak co tyle przeliczamy: wiek migawki skanera, granice sesji. */
const TICK_MS = 30_000;

/**
 * Czwórka nad wykresem Przed sesją: cztery liczby (utils/fourNumbers) dla rynku wykresu — świece z jego magazynu
 * (jak nagłówek układu), mapa likwidacji skanera i mapy z bloga (BTC). Przeliczana najwyżej co 2 s przy zmianach magazynu.
 */
export const FourCard: React.FC<{ coin: Market }> = ({ coin }) => {
  const store = storeFor(coin);
  useEffect(() => startRecording(store), [store]);
  useStoreVersion(store, 2_000);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const liq = useLiqMap();
  const maps = useBlogMaps(coin === 'BTC');
  return <FourCardView n={fourNumbers(readFourInputs(store, liq, maps))} />;
};

const toneOf = (n: FourNumber): BadgeTone => (n.value === DASH ? 'neutral' : n.note ? 'stale' : n.badge === 'LIVE' ? 'live' : 'model');

/**
 * Karta Czwórki (też do Klatki, zadanie 9): na komputerze jeden rząd czterech kafli, na telefonie 2×2. Kafel: tytuł, wartość,
 * plakietka (wiek migawki albo „tylko BTC” zamiast niej) i podpowiedź — źródło liczby albo powód „—”; dotknięcie rozwija
 * przyciętą podpowiedź.
 */
export const FourCardView: React.FC<{ n: FourNumbers }> = ({ n }) => {
  const titleId = useId();
  return (
    <section id="czworka" aria-labelledby={titleId} className="min-w-0 rounded-xl border border-line bg-surface-1">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line px-3 pt-2.5 pb-2 sm:px-4">
        <h2 id={titleId} className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
          {tr('Czwórka', 'Four numbers')} · {n.coin}
        </h2>
        <p className="text-[11px] leading-snug text-ink-3">{tr('Cztery liczby przed sesją. Opis, nie sygnał.', 'Four numbers before the session. A description, not a signal.')}</p>
      </header>
      {/* Odstęp 1 px na tle linii — kreski między kaflami w obu układach */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-line lg:grid-cols-4">
        {n.items.map((i) => (
          <Tile key={i.id} n={i} />
        ))}
      </div>
    </section>
  );
};

const Tile: React.FC<{ n: FourNumber }> = ({ n }) => {
  const [open, setOpen] = useState(false);
  const missing = n.value === DASH;
  return (
    <button
      type="button"
      data-four={n.id}
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      title={n.hint}
      // Kolumna od góry: przycisk domyślnie centruje treść w pionie, a kafle w rzędzie mają tę samą wysokość
      className="flex min-w-0 flex-col justify-start bg-surface-1 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-4"
    >
      <span className="text-[10.5px] font-medium uppercase leading-snug tracking-[0.08em] text-ink-3">{n.title}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className={`text-[15px] font-medium leading-tight ${missing ? 'text-ink-3' : 'text-ink-1'}`}>{n.value}</span>
        <Badge tone={toneOf(n)}>{n.note ?? n.badge}</Badge>
      </span>
      {/* Przycięcie do 2 linii (line-clamp ustawia własne display — bez „block”); całość w podpowiedzi i po dotknięciu */}
      <span className={`mt-1 text-[11px] leading-snug text-ink-3 ${open ? '' : 'line-clamp-2'}`}>{n.hint}</span>
    </button>
  );
};
