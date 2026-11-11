import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndicatorsDialog } from '../chart/IndicatorsDialog';
import { DEFAULT_SETTINGS } from '../chart/settings';

const html = (narrow: boolean) =>
  renderToStaticMarkup(
    <IndicatorsDialog
      s={DEFAULT_SETTINGS}
      layers={[{ key: 'showVwap', label: 'VWAP dnia', hint: 'Od 00:00 UTC, ze świec 1m: cena typowa ważona wolumenem, ta sama na każdym interwale' }]}
      panes={[]}
      panesTab={null}
      section="flow"
      onSection={() => {}}
      narrow={narrow}
      onChange={() => {}}
      onEdit={() => {}}
      onClose={() => {}}
    />
  );

describe('lista wskaźników: opis zwinięty do jednej linii', () => {
  it('opis w jednej linii (pełny w podpowiedzi), obok przycisk rozwinięcia z aria-expanded i aria-controls', () => {
    for (const narrow of [false, true]) {
      const out = html(narrow);
      expect(out).toMatch(/<span[^>]*id="[^"]+"[^>]*class="[^"]*truncate[^"]*"[^>]*>Od 00:00 UTC/);
      expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*aria-label="Pokaż cały opis: VWAP dnia"/);
    }
  });
});
