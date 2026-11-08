/**
 * Publiczne szablony agentów HyperQuant: dane do zakładki agentów na stronie (nazwa, rola i przykładowe polecenia po polsku
 * i po angielsku, narzędzia serwera MCP, plik profilu). Pełne profile do wklejenia leżą obok w plikach `.md`, po angielsku.
 * Czyste dane bez importów: moduł trafia do bundla strony.
 */
export interface AgentTemplate {
  id: 'desk' | 'big-hands' | 'session-review';
  name: { pl: string; en: string };
  /** Jedno zdanie o roli; po angielsku to także pole „Title” profilu w pliku `.md`. */
  role: { pl: string; en: string };
  /** Narzędzia serwera `hyperquant-mcp`, których używa szablon (nazwy jak w `tools/list`). */
  tools: string[];
  /** Przykładowe polecenia; angielskie są w sekcji „Example prompts” pliku profilu. */
  prompts: { pl: string[]; en: string[] };
  /** Plik profilu względem katalogu repo. */
  file: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'desk',
    name: { pl: 'HyperQuant Desk', en: 'HyperQuant Desk' },
    role: {
      pl: 'Skrót przed sesją i rozliczenie rynku po sesji dla BTC',
      en: 'Pre-session brief and post-session market review for BTC',
    },
    tools: ['market_brief', 'session_context', 'day_map', 'session_review'],
    prompts: {
      pl: [
        'Przygotuj mnie do otwarcia Londynu.',
        'Zrób skrót przed sesją nowojorską.',
        'Co się dzieje teraz w sesji NY?',
        'Jak poszła sesja londyńska?',
        'Które poziomy z dzisiejszej mapy dnia zostały już dotknięte?',
      ],
      en: [
        'Prepare me for the London open.',
        'Brief me before the New York session.',
        'What is happening in the NY session right now?',
        'How did the London session go?',
        "Which levels of today's day map have been hit?",
      ],
    },
    file: 'integrations/agents/hyperquant-desk.md',
  },
  {
    id: 'big-hands',
    name: { pl: 'Duże ręce', en: 'Big Hands' },
    role: {
      pl: 'Gdzie stoją duże i wymuszone przepływy na BTC: wieloryby, likwidacje, TWAP-y',
      en: 'Where large and forced flows sit in BTC: whales, liquidations, TWAPs',
    },
    tools: ['liquidation_map', 'liquidation_tape', 'whales', 'twaps'],
    prompts: {
      pl: [
        'Gdzie są klastry likwidacji wokół ceny?',
        'Jakie są teraz największe pozycje na BTC?',
        'Czy w ostatniej godzinie były duże likwidacje?',
        'Jaką część taśmy stanowią TWAP-y?',
        'Pokaż wymuszone przepływy w promieniu 3% od ceny.',
      ],
      en: [
        'Where are the liquidation clusters around the price?',
        'What are the largest BTC positions right now?',
        'Were there large liquidations in the last hour?',
        'How much of the tape is TWAP flow?',
        'Map the forced flows within 3% of the price.',
      ],
    },
    file: 'integrations/agents/big-hands.md',
  },
  {
    id: 'session-review',
    name: { pl: 'Rozliczenie sesji', en: 'Session Review' },
    role: {
      pl: 'Rozliczenie sesji Londynu i Nowego Jorku po zamknięciu',
      en: 'London and New York session reviews after the close',
    },
    tools: ['session_review', 'day_map', 'forecast_ledger'],
    prompts: {
      pl: [
        'Rozlicz sesję londyńską.',
        'Jak poszła wczorajsza sesja NY?',
        'Których poziomów z bloga dotknęła sesja nowojorska?',
        'Jak dobrze skalibrowane są prognozy HyperQuant?',
      ],
      en: [
        'Review the London session.',
        "How did yesterday's NY session go?",
        'Which blog levels did the New York session touch?',
        'How well calibrated are the HyperQuant forecasts?',
      ],
    },
    file: 'integrations/agents/session-review.md',
  },
];
