import React, { useCallback, useEffect, useState } from 'react';
import { PickCard, compact } from '../../charts/pro/chart/FlowPanels';
import type { LiquidityPick } from '../../charts/pro/chart/liquidity';
import { classify } from '../../charts/pro/core/clashes';
import { bidShare } from '../../charts/pro/core/ladder';
import type { AggressorOrder } from '../../charts/pro/core/orders';
import { COIN, MARKETS, type Market, type ProStore } from '../../charts/pro/store/proStore';
import { Segmented, numLang } from '../../ui';
import { tr } from '../../i18n';
import { BTC_ONLY_TITLE, type StepId, scannerScope } from './flowColumnModel';
import { FlowTape } from './FlowTape';
import { Ladder } from './Ladder';
import { type PanelId, type PulseTile, Pulse } from './Pulse';
import { type TwapData, TwapPanel, useTwaps } from './TwapPanel';
import { type FlowColumnData, useFlowColumn } from './useFlowColumn';
import { WallFatesPanel } from './WallFatesPanel';
import { type WhoData, WhoPanel, useWho } from './WhoPanel';

/**
 * Prawa kolumna DOM i taśmy obok wykresu (W sesji): na górze Pulse, pod nim drabina „kto stoi w kolejce”, a niżej
 * karty Taśma, Kto przyjmuje, TWAP-y i Ściany. Drabina i taśma działają na rynku wykresu; panele ze skanera kont są
 * tylko dla BTC (na innym rynku „—, tylko BTC”). Wariant `pulse` to sam pasek Pulse (telefon, nad wykresem).
 */

/** Dane paneli ze skanera kont (tylko BTC). */
export interface ScannerData {
  who: WhoData;
  twap: TwapData;
}

/**
 * Kafle Pulse: po jednej liczbie na panel. `short` — wąski kafel (telefon, kolumna): krótkie etykiety i para bid / ask
 * bez znaku %. Bez danych skanera kafle Kto i TWAP pokazują „—” z dopiskiem „tylko BTC”.
 */
export function pulseTiles(f: FlowColumnData, scanner: ScannerData | null, short: boolean): PulseTile[] {
  const { store, hist, pace, walls } = f;
  const hq = store.head;
  const f0 = hist?.latest() ?? null;
  const bs = f0 && f0.nBids > 0 && f0.nBids < f0.px.length ? bidShare(f0) : Number.NaN;
  const ratio = pace.median > 0 ? pace.usd1m / pace.median : Number.NaN;
  const untouched = walls.fates.filter((x) => x.verdict !== 'eaten' && !x.touched).length;
  const pctS = (x: number) => (Number.isFinite(x) ? `${numLang(String(Math.round(x * 100)))}%` : '—');
  // Para bid / ask; w wąskim kaflu bez znaku % i spacji, żeby się zmieściła
  const pair = (b: number, a: number) => {
    const v = (x: number) => (short ? (Number.isFinite(x) ? String(Math.round(x * 100)) : '—') : pctS(x));
    return (
      <>
        <span className="text-of-buy-ink">{v(b)}</span>
        <span className="text-ink-3">{short ? '/' : ' / '}</span>
        <span className="text-of-sell-ink">{v(a)}</span>
      </>
    );
  };
  const btcOnly = tr('tylko BTC', 'BTC only');
  // Bez nagrania ostatnich chwil (zerwane połączenie) tempo i TWAP-y to brak danych z powodem, nie zero
  const noTape = tr('brak taśmy na żywo', 'no live tape');
  const who = scanner?.who ?? null;
  const twap = scanner?.twap ?? null;
  const whoTitle = tr('Kto przyjmuje uderzenia: udział 3 największych kont makerów po stronie bidów i asków z 15 min.', 'Who absorbs the hits: share of the 3 largest maker accounts on the bid and ask side in 15 min.');
  const twapTitle = tr('TWAP-y w drodze: ile według znanych planów kupią minus sprzedadzą w najbliższych 15 min (USD).', 'TWAPs en route: how much the known plans will buy minus sell in the next 15 min (USD).');
  return [
    {
      id: 'dom',
      label: tr('Arkusz', 'Book'),
      value: pair(bs, 1 - bs),
      sub: hq.bid && hq.ask ? tr(`czoło ${compact(hq.bid.sz * hq.bid.px)} / ${compact(hq.ask.sz * hq.ask.px)} USD`, `head ${compact(hq.bid.sz * hq.bid.px)} / ${compact(hq.ask.sz * hq.ask.px)} USD`) : tr('głębokość bid / ask', 'bid / ask depth'),
      title: tr('Arkusz: kto stoi w kolejce. Liczba: udział bidów i asków w widocznej głębokości; dopisek: wartość czoła kolejki (najlepszy bid / ask).', 'Book: who is in the queue. Number: share of bids and asks in the visible depth; below: value at the head of the queue (best bid / ask).'),
    },
    {
      id: 'tape',
      label: tr('Taśma', 'Tape'),
      value: <span className={ratio >= 2 ? 'text-warn font-semibold' : undefined}>{Number.isFinite(ratio) ? `${numLang(ratio.toFixed(1))}×` : '—'}</span>,
      sub: Number.isNaN(pace.usd1m) ? noTape : tr(`${compact(pace.usd1m)}/min · kupno ${pctS(pace.buyShare)}`, `${compact(pace.usd1m)}/min · buy ${pctS(pace.buyShare)}`),
      title: tr('Taśma: wartość transakcji z ostatniej minuty wobec mediany minut z godziny i udział kupujących.', 'Tape: trade value in the last minute against the median minute of the hour, and the buyers’ share.'),
    },
    {
      id: 'who',
      label: short ? tr('Kto', 'Who') : tr('Kto przyjmuje', 'Who absorbs'),
      value: who ? pair(who.bid.share, who.ask.share) : '—',
      sub: who ? tr('3 największych makerów', 'top 3 makers') : btcOnly,
      title: who ? whoTitle : `${whoTitle} ${BTC_ONLY_TITLE}`,
    },
    {
      id: 'walls',
      label: tr('Ściany', 'Walls'),
      value: walls.fates.length > 0 ? pctS(untouched / walls.fates.length) : '—',
      sub: tr(`bez transakcji · ${walls.fates.length} w 1 h`, `no trade · ${walls.fates.length} in 1 h`),
      title: tr('Ściany: zjedzone czy zdjęte. Liczba: odsetek ścian z ostatniej godziny, które zniknęły bez żadnej transakcji.', 'Walls: eaten or pulled. Number: share of walls from the last hour that vanished without any trade.'),
    },
    {
      id: 'twap',
      label: short ? 'TWAP' : tr('TWAP-y w drodze', 'TWAPs en route'),
      value: twap?.live ? <span className={twap.net >= 0 ? 'text-of-buy-ink' : 'text-of-sell-ink'}>{`${twap.net > 0 ? '+' : ''}${compact(twap.net)}`}</span> : '—',
      sub: twap ? (twap.live ? tr(`netto 15 min · plany ${twap.known}`, `net 15 min · plans ${twap.known}`) : noTape) : btcOnly,
      title: twap ? twapTitle : `${twapTitle} ${BTC_ONLY_TITLE}`,
    },
  ];
}

/** Hooki paneli skanera (koncentracja makerów, TWAP-y z planami) — montowane tylko dla BTC. */
const WithScanner: React.FC<{ store: ProStore; narrow: boolean; children: (s: ScannerData) => React.ReactNode }> = ({ store, narrow, children }) => {
  const who = useWho(store);
  const twap = useTwaps(store, narrow);
  return <>{children({ who, twap })}</>;
};

type LowerTab = 'tape' | 'who' | 'twap' | 'walls';

const toMarket = (coin: string): Market => ((MARKETS as readonly string[]).includes(coin) ? (coin as Market) : COIN);

export const FlowColumn: React.FC<{ coin: string; narrow: boolean; variant: 'column' | 'pulse' }> = ({ coin, narrow, variant }) => {
  const market = toMarket(coin);
  const f = useFlowColumn(market);
  // Karta pod drabiną, panel powiększony kaflem Pulse (drugie kliknięcie wraca), kliknięte zlecenie i podświetlone konto
  const [lower, setLower] = useState<LowerTab>('tape');
  const [max, setMax] = useState<PanelId | null>(null);
  const [pick, setPick] = useState<LiquidityPick | null>(null);
  const [highlight, setHighlight] = useState('');
  const { bigUsd } = f;
  const pickOrder = useCallback((o: AggressorOrder) => setPick({ kind: 'order', order: o, cls: classify(o, bigUsd) }), [bigUsd]);
  const closePick = useCallback(() => {
    setPick(null);
    setHighlight('');
  }, []);
  // Inny rynek: zlecenie i konto z poprzedniego nie dotyczą nowego
  useEffect(closePick, [market, closePick]);

  const render = (s: ScannerData | null): React.ReactNode => {
    if (variant === 'pulse') return <Pulse tiles={pulseTiles(f, s, true)} active={null} narrow={narrow} />;
    const frame = 'h-full rounded-xl border border-line overflow-hidden';
    const head = (title: string) => <span className="text-[11px] uppercase tracking-[0.08em] text-ink-2 font-medium truncate">{title}</span>;
    // Przełącznik kart w nagłówku panelu pod drabiną (w powiększeniu panel ma swój tytuł)
    const lowerHead =
      max === null ? (
        <Segmented<LowerTab>
          size="xs"
          ariaLabel={tr('Panel pod drabiną', 'Panel below the ladder')}
          value={lower}
          onChange={setLower}
          options={[
            { value: 'tape', label: tr('Taśma', 'Tape'), title: tr('Taśma z pamięcią', 'Tape with memory') },
            { value: 'who', label: tr('Kto', 'Who'), title: tr('Kto przyjmuje uderzenia', 'Who absorbs the hits') },
            { value: 'twap', label: 'TWAP', title: tr('TWAP-y w drodze', 'TWAPs en route') },
            { value: 'walls', label: tr('Ściany', 'Walls'), title: tr('Ściany: zjedzone czy zdjęte', 'Walls: eaten or pulled') },
          ]}
        />
      ) : undefined;
    const panels: Record<PanelId, React.ReactNode> = {
      dom: (
        <Ladder
          store={f.store}
          hist={f.hist}
          steps={f.steps.map((x) => ({ id: x.id, step: x.step }))}
          stepId={f.chosen?.id ?? f.prefs.step}
          onStep={(id) => f.patch({ step: id as StepId })}
          whales={f.whales}
          fates={f.walls.fates}
          open={f.walls.open}
          lotUsd={f.walls.lotUsd}
          top={f.top}
          head={f.head}
          narrow={narrow}
          className={frame}
        />
      ),
      tape: (
        <FlowTape
          store={f.store}
          minUsd={f.prefs.minUsd}
          sound={f.prefs.sound}
          bigUsd={bigUsd}
          pace={f.pace}
          selected={pick?.kind === 'order' ? pick.order : null}
          highlight={highlight}
          narrow={narrow}
          className={frame}
          onPick={pickOrder}
          onMinUsd={(v) => f.patch({ minUsd: v })}
          onSound={(v) => f.patch({ sound: v })}
          head={lowerHead}
        />
      ),
      who: <WhoPanel data={s?.who ?? null} highlight={highlight} onHighlight={setHighlight} head={lowerHead} wide={false} narrow={narrow} className={frame} />,
      twap: <TwapPanel store={f.store} data={s?.twap ?? null} head={lowerHead ?? head(tr('TWAP-y w drodze', 'TWAPs en route'))} narrow={narrow} className={frame} />,
      walls: <WallFatesPanel fates={f.walls.fates} minUsd={f.walls.minUsd} step={f.chosen?.step ?? Number.NaN} since={f.walls.since} narrow={narrow} className={frame} head={lowerHead} />,
    };
    return (
      <div className="relative h-full flex flex-col gap-1.5 min-h-0">
        <Pulse tiles={pulseTiles(f, s, true)} active={max} narrow={false} dense onPick={(id) => setMax((m) => (m === id ? null : id))} />
        {max !== null ? (
          <div className="flex-1 min-h-0">{panels[max]}</div>
        ) : (
          <>
            {/* Drabina wyższa niż taśma: przy 900 px wysokości ok. 20 poziomów drabiny i 12 wierszy taśmy */}
            <div className="flex-[11] min-h-0">{panels.dom}</div>
            <div className="flex-[8] min-h-0">{panels[lower]}</div>
          </>
        )}
        {pick && (
          <div className="absolute inset-x-2 bottom-2 z-30 max-h-[calc(100%-16px)] overflow-y-auto rounded-xl">
            <PickCard pick={pick} store={f.store} bigUsd={bigUsd} highlight={highlight} onHighlight={setHighlight} onClose={closePick} />
          </div>
        )}
      </div>
    );
  };

  return scannerScope(market) === 'full' ? (
    <WithScanner store={f.store} narrow={narrow}>
      {render}
    </WithScanner>
  ) : (
    <>{render(null)}</>
  );
};
