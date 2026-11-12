import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NumbersCard } from '../chart/NumbersCard';
import { HlStream } from '../hl/stream';
import { ProStore } from '../store/proStore';
import { NO_CEX_NOTE, noCexWhy } from '../../../utils/marketCaps';
import { tr } from '../../../i18n';

const card = (coin: string) => {
  const store = new ProStore(new HlStream({ wsFactory: () => ({}) as WebSocket }), coin);
  return renderToStaticMarkup(<NumbersCard store={store} series={store.series('1h')} groups={['hl', 'binance', 'bybit']} onGroups={() => {}} className="" />);
};
// Tekst w HTML: cudzysłowy i apostrofy jako encje
const FETCH = tr('pobiera Twoja przeglądarka', 'Your browser fetches');
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('karta Liczby na rynku bez pary CEX', () => {
  it('kPEPE: grupy Binance i Bybit z dopiskiem i powodem (noCexWhy) zamiast samego „—”', () => {
    const out = card('kPEPE');
    expect(out.split(`— ${NO_CEX_NOTE}`)).toHaveLength(3);
    expect(out).toContain(html(noCexWhy('kPEPE')));
    expect(out).not.toContain(html(FETCH));
  });

  it('BTC: bez dopisku, objaśnienie o pobieraniu z giełdy jak dotąd', () => {
    const out = card('BTC');
    expect(out).not.toContain(NO_CEX_NOTE);
    expect(out).not.toContain(html(noCexWhy('BTC')));
    expect(out).toContain(html(FETCH));
  });
});
