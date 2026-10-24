import type { StationId } from '../../charts/pro/chart/stations';
import type { LessonsContent } from './types';

/** Angielskie nazwy stacji jak w README (widok Wykresy nie ma jeszcze wersji angielskiej). */
const STATION: Record<StationId, string> = { start: 'Start', scalp: 'Scalper', liquidity: 'Liquidity', auction: 'Auction', venues: 'Exchanges', mtf: 'Two timeframes' };

/** Treść zakładki Lekcje po angielsku. Godziny w UTC (w polskiej wersji czas polski, CEST = UTC + 2 h), ceny BTC w USD. */
export const en: LessonsContent = {
  tz: 'UTC',
  locale: 'en-GB',
  tzLabel: 'UTC',
  ui: {
    eyebrow: 'HyperQuant Academy',
    title: 'Lessons on our charts',
    lead:
      'Real situations from the BTC market on Hyperliquid, stopped at an important moment. You say what you see and where you would be wrong, then we reveal what happened next. We score the reasoning, not the profit: no buy/sell signals and no promised results.',
    tabs: { exercises: 'Exercises', atlas: 'Indicators', combine: 'Combining', myths: 'Myths and data', risk: 'Risk' },
    progress: (done, total) => `Completed: ${done} of ${total}`,
    level: (n) => ['Basics', 'Intermediate', 'Advanced'][n - 1],
    start: 'Start',
    again: 'Start over',
    back: 'All exercises',
    check: 'Check',
    next: 'Next',
    reveal: 'Reveal what happened next',
    revealEnd: 'Reveal to the end',
    finish: 'Debrief',
    score: (s, max) => `Reasoning score: ${s} of ${max}`,
    scoreNote: 'Points for reading the context and for a logical invalidation level, not for whether the trade would have made money.',
    yourAnswer: 'Your answer',
    pickPrompt: 'Click or tap a price on the chart.',
    pickNone: 'No price marked yet.',
    verdict: { 0: 'Needs work', 1: 'Defensible', 2: 'Sound reasoning' },
    debrief: 'What this situation teaches',
    honest: 'Honestly',
    practice: 'Practise live',
    openStation: (id) => `Open the “${STATION[id]}” workstation in Charts`,
    openReplay: 'Open this moment in Charts',
    replayNote: 'A replay of the recorded tape and order book from that evening on the full chart: it starts paused at the moment of the question, and you play it forward yourself.',
    atlasLinks: 'Indicators in this exercise',
    labTitle: 'What the desk data says',
    labLoading: 'Loading Folklore lab results…',
    labUnavailable: 'Folklore lab results are temporarily unavailable.',
    labLine: (rate, p0, n) => `Success in ${rate} of events, where a randomly wandering price would give ${p0} (${n} ${n === 1 ? 'event' : 'events'} in history).`,
    labEffect: (pp) => `Difference: ${pp}.`,
    labVerdict: {
      support: 'History supports this rule (exploratory, after correcting for multiple tests).',
      against: 'History contradicts this rule (exploratory, after correcting for multiple tests).',
      none: 'No evidence that the rule works better than chance. That is not proof that it never works.',
      few: 'Too few events for a verdict.',
    },
    labShort: { support: 'supports', against: 'contradicts', none: 'no evidence', few: 'too little data' },
    labOpen: 'Full results in the Plan Analyzer',
    loading: 'Loading the market slice…',
    loadError: 'Could not load the exercise data. Refresh the page.',
    dataNote: "Data: Hyperliquid candles from the desk archive; delta, open interest and footprint from the tape recorded by the desk; liquidations from the desk's liquidation tape.",
    checkpoint: (i, n) => `Stop ${i} of ${n}`,
    question: (i, n) => `Question ${i} of ${n}`,
    exercisesIntro: 'Six real situations from 20–24 October 2026, from the basics to the footprint. Each takes a few minutes.',
    best: 'Best answer',
    pickInput: 'Price in USD',
    quote: (s) => `“${s}”`,
  },
  chart: {
    hidden: 'rest hidden',
    stopped: 'stopped',
    noTape: 'no tape',
    delta: 'Delta (aggressors), BTC',
    cvd: 'CVD since recording began, BTC',
    oi: 'Open interest, BTC',
    sessions: { london: 'London', ny: 'New York' },
    liq: (m) => `$${m}M`,
    pickHint: 'Mark a price: click or tap the price panel.',
    yourPick: 'Your level',
    volume: 'Volume',
    oiChange: 'ΔOI',
    imbalance: '3:1 imbalance',
  },
  exercises: {
    'ny-breakout': {
      title: 'Breakout at the New York open',
      when: 'Tue 20 Oct 2026 · BTC · 5-min candles',
      tagline: 'A quiet morning, a sharp break through PDH and a drop back to VWAP. Where would you be wrong?',
      intro:
        "Tuesday. BTC has gone nowhere all morning, and at 13:30 UTC the New York stock exchange opens. On the chart: the daily VWAP with ±1σ and ±2σ bands, the daily volume profile (POC, VAH, VAL), Monday's high and low (PDH, PDL) and the New York open.",
      checkpoints: [
        {
          context:
            "It is 13:30. Since midnight UTC price has been rotating between 81,300 and 81,800 USD. VWAP has barely moved (81,630), and the day's value area, the range holding 70% of the volume, fits within 400 dollars (81,360–81,760).",
          questions: [
            {
              prompt: 'How would you describe this morning?',
              options: [
                { label: "Downtrend: price is below VWAP and below yesterday's low.", feedback: 'Price is indeed below VWAP for the moment, but VWAP is flat and price has crossed it many times in both directions. That is not a trend, just rotation around one price.' },
                {
                  label: 'Balance: flat VWAP, price rotating around it, a narrow value area.',
                  feedback: 'Yes. The market accepts one price and waits. Balance does not tell you which way the break will go, but it does tell you that a move out of a narrow range is often violent, because orders build up on both sides.',
                },
                { label: 'Uptrend: price has been making higher lows since 01:00.', feedback: 'The overnight higher lows ended quickly, and price has not moved away from VWAP for hours. A trending market leaves VWAP behind.' },
                { label: 'Nothing can be said before the NY open.', feedback: 'We do not know the direction, but we already know the type of morning. That will matter in a moment: a break out of balance has to be judged by whether it gets accepted.' },
              ],
            },
          ],
          reveal:
            'The NY open breaks price out of balance: within an hour BTC rises by more than 2,000 USD, on volume several times higher than in the morning. Price breaks through PDH (83,138) and peaks at 83,425 (1), but does not stay above it: at 15:10 a single five-minute candle drops it to 82,200 (2), almost back to VWAP.',
        },
        {
          context: 'It is 15:30. After the drop to 82,200, price has held between 82,330 and 82,630 for twenty minutes, above VWAP (82,150). PDH 83,138 was broken but not held.',
          questions: [
            {
              prompt: 'Someone assumes the breakout will continue. Where is the level whose break invalidates that scenario?',
              pick: {
                hint: 'Mark the price on the chart: below it, the continuation thesis no longer makes sense.',
                good: "Good. Below the low of the drop (82,200) and below VWAP the thesis loses its meaning: if buyers are defending the day's average price, price should not stay below it. The invalidation is close, so a mistake costs little, and the position size can be calculated from that distance.",
                ok: 'Defensible, but wide. A return into the morning range (below 81,800) really does mean the breakout failed, but the risk is two to three times larger. For the same dollar risk the position has to be correspondingly smaller.',
                tight: 'Too tight. That is the middle of normal swings after a breakout, and the low of the drop (82,200) is lower. Noise will hit such a level before the market says anything about the thesis.',
                wide: "Too wide. Below the morning range nothing is left of this scenario's logic, and the risk grows several times over for no benefit.",
              },
            },
          ],
          reveal:
            'VWAP held. Price never went below 82,310 again and in the evening returned to 82,800–82,900. The next day BTC broke PDH for good and put in a trend day: that is the exercise “Trend day: +2σ is not a ceiling”.',
        },
      ],
      debrief: {
        points: [
          'Balance (flat VWAP, narrow value area) does not reveal the direction, but it warns that the breakout may be violent. A breakout is judged by acceptance, not by the break itself.',
          'PDH was broken but not accepted: price came back below it within about fifteen minutes. Touching a level means nothing on its own; what counts is time and volume on the other side.',
          "After the breakout VWAP changed roles: from the “middle of the range” it became the buyers' line of defence. The drop stopped just above it.",
          'The invalidation follows from the place where the thesis stops making sense. Position size follows from the distance to that place, not the other way round.',
        ],
        honest:
          "This is one example, not a rule: on another day the same picture ends with a move below VWAP. The desk's Folklore lab tests a related rule, “PDH sweep → reversion”, on history and compares it with a randomly wandering price.",
      },
      zoneLabels: ['invalidation area'],
    },
    'trend-up': {
      title: 'Trend day: +2σ is not a ceiling',
      when: 'Wed 21 Oct 2026 · BTC · 15-min candles',
      tagline: "Price touches the +2σ band. “Expensive, time to short”? Check what the day's context says.",
      intro:
        "The day after the breakout from the previous exercise. On the chart: the daily VWAP with ±1σ and ±2σ bands, PDH and PDL (Tuesday's high and low) and the London and New York opens.",
      checkpoints: [
        {
          context:
            'It is 14:45. Price has been rising since the London open; PDH 83,425 was broken in the morning and held. Since 09:00 price has not touched VWAP, which is itself rising (now 83,390). Price 84,185 is +1.9σ from VWAP, right at the +2σ band.',
          questions: [
            {
              prompt: "Many traders teach that “price at +2σ is statistically too high”. What does this day's context say?",
              options: [
                {
                  label: 'Short with a target at VWAP: price is too far from the average.',
                  feedback:
                    'That is a reflex from balance days. Today VWAP is rising, price has not touched it for more than five hours, and the broken PDH has become support. On such a day the bands widen together with price, and selling at +2σ means fighting the trend without a logical invalidation.',
                },
                {
                  label: 'Trend day: rising VWAP, price constantly above it, PDH broken and held. I do not fight the move; I would rather look for an entry on a pullback to structure.',
                  feedback:
                    'Yes. A σ band is a ruler, not a signal. In a trend price can ride the +1σ…+2σ band for hours. A sensible process is to wait for a pullback to structure (for example the +1σ band or a broken level) with a clear invalidation, or not to trade at all.',
                },
                {
                  label: 'I buy now, because the trend is strong.',
                  feedback:
                    'The direction is read correctly, but chasing price at +2σ gives the worst location: the furthest from the logical invalidation. A better process is a pullback or a smaller position.',
                },
                { label: 'Nothing can be said.', feedback: 'We do know something: the type of day. Uncertainty about the next candle does not make the context useless.' },
              ],
            },
          ],
          reveal:
            'Price reached 84,850 at 16:39 and did not return to VWAP once before 22:00 UTC: the low was 84,136, with VWAP around 83,850. The window closed near the highs, at 84,795. Anyone who sold at +2σ with a target at VWAP never saw the target.',
        },
      ],
      debrief: {
        points: [
          'You can recognise a trend day while it is happening: VWAP sloping, price on one side of it for hours, shallow pullbacks (they do not reach VWAP), broken levels changing roles.',
          "σ bands measure the volume-weighted dispersion of the day's prices. In balance their edges are often the extremes of the range; in a trend price can ride along them.",
          'The most expensive trade on a trend day is a contrarian trade without an invalidation. If you do trade against the move, do it with a small position and a level that says “I was wrong”.',
        ],
        honest:
          "The desk's Folklore lab tests the rule “Price reverts from 2σ off VWAP” (back to VWAP before reaching 4σ) on history, and compares the result with what we would expect from a randomly wandering price.",
      },
    },
    'trend-down': {
      title: 'Bounce on a down day',
      when: 'Thu 22 Oct 2026 · BTC · 15-min candles',
      tagline: 'After a 2,700 USD drop, price bounces to the lower edge of value. Reversal or a test from below?',
      intro:
        "The mirror image of the previous exercise. On the chart: the daily VWAP with bands, the daily volume profile, PDH and PDL (Wednesday's high and low) and the session opens.",
      checkpoints: [
        {
          context:
            "It is 11:00. Overnight price slid from 84,300, broke PDL 82,613 before 08:00 and made a low of 81,619 at 09:00. It has now bounced to 82,172 (1) and sits at 82,020: the lower edge of the day's value area (VAL 82,000). VWAP is falling and is 770 USD higher (82,774); price is at −1.1σ.",
          questions: [
            {
              prompt: 'Has the market regained value?',
              options: [
                { label: 'Yes: the bounce off the low is a trend reversal.', feedback: 'One bounce is not enough. A reversal needs evidence: acceptance back inside the value area and above VWAP. So far price is only touching the lower edge from below.' },
                {
                  label: 'No: this is a test from below. Regaining value means acceptance inside the value area and above VWAP, not just touching VAL.',
                  feedback: 'Yes. A value-area edge that was broken to the downside often acts as resistance from below. Sellers are in control until price is back inside and above VWAP.',
                },
                { label: 'Price is “cheap” (−1σ), so it is worth buying.', feedback: 'On a trend day “cheap” can keep getting cheaper. Distance from VWAP in σ is not a bargain price, only a measure of how far the market has run from the average.' },
                { label: 'VAL does not matter during the day.', feedback: 'The profile develops during the day and its edges show where the market traded most willingly. It is an important map, though not an oracle.' },
              ],
            },
            {
              prompt: 'Someone is playing for the decline to continue. Where is the level above which the thesis that sellers are in control stops making sense?',
              pick: {
                hint: 'Mark the price on the chart: above it, the continuation thesis falls apart.',
                good: 'Good. Above the bounce high (82,172), and at the latest above VWAP, sellers lose their argument: the market is returning to value. It is close, so a mistake costs little.',
                ok: 'Defensible, but wide. Above VWAP the thesis certainly fails, but the risk is much larger than needed: the bounce high tells you the same thing earlier.',
                tight: 'Too tight. Below the bounce high is ordinary noise: the first swing hits such a level before the market says anything about the thesis.',
                wide: 'Too wide. That far above VWAP nothing is left of the “sellers control the day” logic, and the risk grows several times over.',
              },
            },
          ],
          reveal: 'Price never broke 82,172 again (the high was 82,100). After the New York open it fell further and made a low of 80,911 at 16:53. VWAP was not regained by the end of the window; the close was 81,381.',
        },
      ],
      debrief: {
        points: [
          'A down trend day looks like the mirror of an up day: VWAP slopes down, bounces fail to reach VWAP, a broken PDL stops being support.',
          "The day's profile develops behind price. Its lower edge (VAL), once broken to the downside, often stops bounces from below.",
          'The invalidation for continuation lies above the bounce high or above VWAP. Buying a “cheap” −1σ on a trend day is catching a knife with no exit point.',
        ],
        honest: "The desk's Folklore lab tests the rule “PDL sweep → reversion” on history (after touching PDL, price returns to the middle of yesterday's range). On this day it did not.",
      },
      zoneLabels: ['invalidation area'],
    },
    'balance-day': {
      title: 'Balance day: breakouts without acceptance',
      when: 'Fri 23 Oct 2026 · BTC · 5-min candles',
      tagline: 'A jump at the NY open, then a drop below the value area. A change of day type or two false breakouts?',
      intro:
        'Friday. On the chart: VWAP with bands, the daily volume profile, the session opens and the New York initial balance (the range of the first hour of the session, with 1.5× and 2× extensions), visible once that hour is over. PDH and PDL are far outside the range.',
      checkpoints: [
        {
          context:
            'It is 14:10. Since the morning VWAP has stood still (81,600–81,700), and price has crossed it many times. At the NY open a jump to 82,088 (1), above the upper edge of the value area (VAH 82,020), but ten minutes later price is back inside, at 81,890.',
          questions: [
            {
              prompt: 'What kind of day is this?',
              options: [
                { label: 'Balance: flat VWAP, many crossings of it, a narrow value area; the jump above VAH quickly came back inside.', feedback: 'Yes. In balance the edges reject price more often than they let it through. The quick return from 82,088 is a rejection, not acceptance.' },
                { label: "Uptrend: the day's high has just been made.", feedback: "The day's high was made but not held. A trend leaves VWAP behind; here price came back to it within a quarter of an hour." },
                { label: 'Downtrend: price is falling right now.', feedback: 'Ten minutes of decline after a jump is not enough. Price came back into the middle of the value area, not below it.' },
                { label: 'Too early to say anything.', feedback: 'Too early for certainty, but not for a hypothesis. The “balance” hypothesis gives you a plan: watch whether the edges reject price.' },
              ],
            },
          ],
          reveal: 'At 14:15 price slides from 81,890 to 81,106 (2) in ten minutes, below the lower edge of the value area (VAL around 81,500). The New York initial balance is now complete: 81,106–82,088.',
        },
        {
          context: "It is 14:30. In twenty minutes price has gone from the day's high to the day's low. It is now bouncing and sits at 81,470, below VAL.",
          questions: [
            {
              prompt: 'Has the day type just changed?',
              options: [
                { label: 'Yes, this is the start of a downtrend.', feedback: 'One violent candle does not make a trend. A trend needs acceptance: price that stays below VAL and below VWAP, and a profile that starts building lower.' },
                {
                  label: 'For now this is a move below value without acceptance. The balance hypothesis is under threat; it will be settled by whether price stays below VAL or returns inside.',
                  feedback: 'Yes. Acceptance is time and volume on the other side of the edge; rejection is a quick return. A “watch for acceptance” plan works both ways and protects you from trading your first impression.',
                },
                { label: 'I buy, because in balance price always comes back.', feedback: '“Always” is the most expensive word in trading. In balance returns are more common, but a balance day can turn into a trend at any moment.' },
                { label: 'I sell the bounce to VAL without a stop, because the day is weak.', feedback: 'Selling without an invalidation is having no plan. Even a correct thesis with no “I was wrong” level ends badly at the first violent move.' },
              ],
            },
          ],
          reveal:
            'Price returned inside: by 16:30 it reached 81,932, and for the rest of the window it did not leave the initial balance again (high 81,932, low 81,238). VWAP stayed flat; the close was 81,407. Both breakouts from the IB turned out to be false.',
        },
      ],
      debrief: {
        points: [
          'Balance: flat VWAP, price rotating around it, a narrow value area. On such a day the edges (VAH, VAL, σ bands, IB) reject more often than they let price through, but not always.',
          'Acceptance versus rejection: rejection is a quick return; acceptance is price that stays on the other side (several candles, volume, a profile building at the new level).',
          'The New York initial balance contained both violent moves, and the rest of the day stayed inside it. The IB is a map: it shows where the market has already rejected price once.',
        ],
        honest:
          "The desk's Folklore lab tests the rule “IB breakout follows through” on history (for the IB of the first hour of the UTC day). That is a different IB definition from the one on the chart, but the same idea.",
      },
    },
    'liq-cascade': {
      title: 'Liquidation cascade and who buys the bounce',
      when: 'Sat 24 Oct 2026 · BTC · 5-min candles',
      tagline: "$45M of longs liquidated below yesterday's low, then a bounce. Who is behind it?",
      intro:
        "Saturday. On the chart: VWAP with bands, PDH and PDL (Friday's high and low), liquidation circles (circle area by amount), and in the panels below price, CVD and open interest from the tape the desk has been recording since 16:25 UTC.",
      checkpoints: [
        {
          context:
            'It is 15:30. A quiet day (VWAP around 80,760) ended at 14:15: price fell below PDL 80,500 and triggered long liquidations, $17.7M in a single candle (1). After a short bounce came a second wave, $14.3M at 15:10 (2), and a low of 79,184. In total about $45M of longs have been liquidated since 14:15. Price is 1.65σ below VWAP.',
          questions: [
            {
              prompt: 'What do you do with this information?',
              options: [
                { label: 'I buy immediately: after a cascade like this there is always a bounce.', feedback: 'Cascades often end with a bounce, but you cannot know after which wave. Entering in the middle of a cascade with no invalidation is guessing where forced selling will end.' },
                {
                  label: 'I wait for a sign that forced selling is ending (smaller liquidations, no new lows, a return above a level). Only then a plan, with the invalidation below the 79,184 low.',
                  feedback: 'Yes. Liquidations are forced selling, not the decision of someone who knows more. When they end, the move often runs out of fuel. We also know where we would be wrong: a new low below 79,184.',
                },
                { label: 'I sell, because the trend is strong: I join the cascade.', feedback: 'Joining after $45M of liquidations means selling at the very bottom of the wave, with the invalidation far above price. The direction of the day is read correctly, the location is the worst possible.' },
                { label: 'I ignore liquidations, they are noise.', feedback: 'Liquidations are very concrete information: who had to get out and where. They do not tell you what comes next, but they describe where the move came from.' },
              ],
            },
          ],
          reveal:
            'There were no more large liquidations, and no new low either. From 15:45 price recovers, and around 16:50 it is back above VWAP. From 16:25 the desk records the tape, so CVD and open interest appear in the panels.',
        },
        {
          context: 'It is 18:15. Price 80,330, above VWAP (80,124). In the last quarter of an hour aggressive buying outweighed selling by almost 500 BTC (CVD rising), while open interest fell by more than 600 BTC (3).',
          questions: [
            {
              prompt: 'Price is rising, delta strongly positive, open interest falling. Who is most likely buying?',
              options: [
                { label: 'New buyers are opening longs.', feedback: 'New longs would increase open interest. Here open interest is falling, so positions are being closed, not opened.' },
                { label: 'Shorts are closing: buying back to get out.', feedback: 'Yes. Falling OI with aggressive buying is most often short covering. Such rallies have fuel only until the shorts left to close run out; new demand is not visible yet.' },
                { label: 'Market makers are buying from sellers.', feedback: 'Market makers sit on the other side of the aggressors, so here they are more likely selling. Delta counts aggressors: those who buy at the offer.' },
                { label: 'You cannot tell without addresses.', feedback: 'There is no certainty, because two sides close every trade. But the combination “price up, aggressive buying, OI down” has one most likely explanation.' },
              ],
            },
          ],
          reveal:
            'At 18:45 one more jump: delta +534 BTC, open interest −387 BTC, a high of 80,628, back above PDL. Then two hours of standing still on low volume. At 21:00 price drops to 80,259 (4) with delta −443 and rising open interest: those are new shorts.',
        },
      ],
      debrief: {
        points: [
          'The four quadrants of price and open interest: price ↑ and OI ↑ means new longs; price ↑ and OI ↓ means short covering; price ↓ and OI ↑ means new shorts; price ↓ and OI ↓ means longs closing, in the extreme case liquidations.',
          "A liquidation cascade is forced selling. It ends when the leveraged positions within price's reach run out; after that the move often loses fuel.",
          'The bounce after the cascade was largely short covering (OI fell by more than 1,000 BTC while price rose). A rally on short covering is not the same as new demand.',
          'A broken level (PDL 80,500) regained in the evening is information, not a guarantee: at 21:00 new shorts pushed price back below it.',
        ],
        honest:
          "This is one situation. The liquidation tape in the desk's public data starts on 24 Oct, so rules about cascades cannot yet be tested reliably on history. The exercise teaches reading the flow, not prediction.",
      },
    },
    'footprint-zone': {
      title: 'Footprint: an imbalance zone that did not hold',
      when: 'Sat 24 Oct 2026 · BTC · 15-min footprint',
      tagline: 'Aggressive buying through nine price levels. Support for sure? We read it cell by cell.',
      intro:
        "The same evening as in the cascade exercise, zoomed in. In every candle the left column is aggressor selling (market orders hitting the bid) and the right is aggressor buying (lifting the ask), in BTC, with rows every 20 USD. The frame marks the candle's POC, and a bar at the edge of a cell marks a diagonal 3:1 imbalance. Below the candles: delta, volume and the change in open interest.",
      checkpoints: [
        {
          context:
            'It is 19:00. The 18:45 candle (1) went from 80,326 to 80,628: delta +534 BTC, volume 669 BTC, POC 80,460, buy imbalances on nine levels from 80,360 to 80,620, including four in a row at 80,420–80,480. Open interest fell by 387 BTC in this candle.',
          questions: [
            {
              prompt: 'What does the 18:45 candle tell you?',
              options: [
                { label: 'Buyers have taken control; the 80,420–80,480 zone will surely hold price.', feedback: '“Surely” is too much. An imbalance zone tells you where buyers were aggressive, not where they will defend price in the future.' },
                {
                  label: 'Aggressive buying through many levels, but OI falls by 387 BTC: much of it is short covering. This describes what happened, it is not a promise.',
                  feedback: 'Yes. The footprint shows who was aggressive and at which prices. The drop in OI adds context: part of this aggression is exiting positions, not new conviction.',
                },
                { label: 'This is absorption: sellers are soaking up the buying.', feedback: 'Absorption would look different: heavy buying while price stands still. Here price moved 300 USD up, so the buying was not absorbed.' },
                { label: 'Delta +534 is a buy signal.', feedback: 'Delta describes a past candle. On its own it says nothing about what the next one will do.' },
              ],
            },
            {
              prompt: 'If the buyers from this candle are right, which level should they not give up? Mark the price whose break invalidates their edge.',
              pick: {
                hint: "Mark the price on the footprint: below it, the buyers' edge from the 18:45 candle loses its meaning.",
                good: 'Good. The bottom of the candle and of the imbalance run (80,320–80,460): if price returns below the place where buyers were most aggressive, their edge no longer exists.',
                ok: 'Defensible, but wide. Below the zone from the 18:00 candle the edge certainly fails, but the risk is larger than needed.',
                tight: 'Too tight. That is the upper half of the candle, where ordinary swings after the jump will hit the level without telling you anything.',
                wide: 'Too wide. That far below the candle nothing is left of its logic, and the risk grows several times over.',
              },
            },
          ],
          reveal:
            'At 19:00 sell imbalances appear at the top (80,480–80,540), then two hours of standing still with 74–144 BTC of volume per candle. At 21:00 a single candle cuts through both buy zones, from 18:00 and from 18:45 (2): delta −443 BTC, sell imbalances from 80,260 to 80,420, open interest +103 BTC, a low of 80,259.',
        },
      ],
      debrief: {
        points: [
          'How to read a cell: the left number is aggressor selling and the right is aggressor buying at that price level. Diagonal imbalance: buying at a level at least 3 times the selling one level below (and vice versa).',
          'The 18:45 candle showed buyer aggression through nine levels, but the 387 BTC drop in OI says that a large part of it was short covering.',
          'After the jump: sellers at the top and fading volume. At 21:00 a single candle with new shorts (OI rising) cut through both zones.',
          'An imbalance zone describes the past; it is not guaranteed support. It is useful as a map: where there was aggression, it is easy to check whether it is still there.',
        ],
        honest:
          'Honestly about the footprint: in the historical tests we ran while building the desk, imbalances on their own, their runs, absorption and CVD divergences gave no edge after costs. That is why we teach them as context and as confirmation of what location says, not as signals.',
      },
      zoneLabels: ['invalidation area', 'imbalances (18:45 buying)'],
    },
  },
  atlas: {
    intro:
      'Every indicator from the Charts tab: what it is, how we compute it, how to read it, where it is easy to go wrong and what to combine it with. The figures come from the same slices as the exercises.',
    groups: { price: 'Price and value', flow: 'Flow: who is aggressive', book: 'Order book and liquidity', context: 'Positions and leverage' },
    labels: { what: 'What it is', how: 'How we compute it', read: 'How to read it', traps: 'Traps', combine: 'Combine with', where: 'In Charts' },
    entries: [
      {
        id: 'vwap',
        name: 'Daily VWAP and σ bands',
        group: 'price',
        what: "The day's volume-weighted average price: what everyone who traded today paid on average.",
        how: 'From 00:00 UTC, the typical price of each candle (H+L+C)/3 weighted by volume; the bands are ±1σ and ±2σ, the volume-weighted standard deviation of price from VWAP. Session VWAP computes the same from the Asia, London or New York open.',
        read: [
          'The slope tells you the type of day: a flat VWAP means balance, a sloping one a trend.',
          "Price above VWAP: the day's buyers are on average in profit; below VWAP: at a loss.",
          'In balance the band edges are often the extremes of the range; in a trend price can ride the +1σ…+2σ band.',
        ],
        traps: ['The ±2σ band is not a reversal signal: on a trend day “expensive” keeps getting more expensive.', 'In the morning, with few candles, the bands are narrow and easy to break.'],
        combine: ["With the profile: VWAP near the POC means agreement on the day's value.", 'With flow: VWAP holding against aggressive selling says more than a mere touch.'],
        where: 'Indicators → Daily VWAP, VWAP bands ±1σ and ±2σ, Session VWAP',
        station: 'start',
        figure: { slice: '2026-10-21-trend', layers: { vwap: true, bands: true }, caption: 'Wednesday 21 Oct: a trend day. VWAP rises and price rides the +1σ…+2σ band for hours.' },
      },
      {
        id: 'profile',
        name: 'Volume profile: POC, VAH, VAL',
        group: 'price',
        what: 'How much traded at each price: a map of the prices the market considered fair and the ones it flew through.',
        how: "We spread each candle's volume across its range (candles fully recorded from the tape: exactly at trade prices). The POC is the row with the most volume; the value area (VAH–VAL) is the 70% of volume around the POC.",
        read: [
          'Price inside the value area: the market accepts these prices. Outside it: either a quick return (rejection) or new value being built (acceptance).',
          'A thick, symmetric profile means balance; an elongated, thin one means a trend.',
          'An edge broken in one direction often works from the other side (VAL as resistance from below).',
        ],
        traps: ['The profile depends on the range: the visible range, the session and the day give different POCs.', 'The POC is not a guaranteed magnet: price returns to it often because it usually sits close to the current price.'],
        combine: ["With VWAP and the day's levels: several levels lining up make a stronger map.", 'With flow at the edge: does aggressive buying at VAH get through or get absorbed?'],
        where: 'Indicators → Volume profile, Session profiles and naked POCs, Developing POC and value area',
        station: 'auction',
        figure: { slice: '2026-10-23-balance', layers: { vwap: true, profile: true }, caption: 'Friday 23 Oct: a balance day. A narrow value area, the POC right next to a flat VWAP.' },
      },
      {
        id: 'devpoc',
        name: 'Session profiles, naked POCs and developing POC',
        group: 'price',
        what: 'A separate profile for each session, POCs that price never returned to, and the POC computed candle by candle.',
        how: 'A profile for each session (Asia, London, New York) or day from its start. Naked POC: the POC of a closed period that price did not touch afterwards, extended to the right edge. Developing POC and value area: the state since the start of the period at every moment.',
        read: ['A developing POC moving with price is value migrating (a trend); a POC standing still is balance.', 'Naked POCs show where the market traded heavily, then left and never came back.'],
        traps: ['A naked POC is a place, not a target: frequent returns are largely geometry (the POC usually lies close to price).'],
        combine: ['With sessions: the London POC versus price after the New York open.', "With the day's levels: a naked POC near PDH or PDL."],
        where: 'Indicators → Session profiles and naked POCs, Developing POC and value area',
        station: 'auction',
      },
      {
        id: 'tpo',
        name: 'TPO: time profile',
        group: 'price',
        what: 'A profile of time instead of volume: how long the market spent at each price.',
        how: 'The UTC day is split into 30-minute periods marked with letters; each price row gets the letter of every period whose range touched it. Plus POC, value area, initial balance (the first two periods), single prints and tails.',
        read: ['Single prints (one letter) are price flying through quickly: places without acceptance.', 'Long tails at the edge of the day are price rejection.'],
        traps: ['Time is not volume: price can sit for a long time on low turnover.'],
        combine: ['With the volume profile: matching time and volume POCs mean strong value.', 'With the IB: leaving the IB and building letters outside it is acceptance.'],
        where: 'Indicators → TPO, daily time profile',
        station: 'auction',
      },
      {
        id: 'levels',
        name: 'Daily levels: PDH, PDL, open',
        group: 'price',
        what: "The previous UTC day's high and low and the day's open: points every market participant can see.",
        how: 'From Hyperliquid daily candles: PDH and PDL are the high and low of the previous UTC day, the open is the price at 00:00 UTC.',
        read: ["A break and acceptance on the other side changes the level's role (PDH becomes support).", 'A break and a quick return is a rejection: the first warning for a breakout.'],
        traps: ['Touching a level means nothing on its own. Stops often sit below PDL and above PDH, so the move can be violent in both directions.'],
        combine: ['With liquidations: a broken PDL can trigger a cascade.', 'With the profile and VWAP: a daily level at a value edge matters more.'],
        where: 'Indicators → Daily levels',
        station: 'start',
        figure: { slice: '2026-10-20-ny', layers: { levels: true, vwap: true, sessions: true }, caption: 'Tuesday 20 Oct: price below PDL in the morning, then after the New York open a break of PDH and a quick return below it.' },
      },
      {
        id: 'sessions',
        name: 'Session opens',
        group: 'price',
        what: 'The moments when new participants enter the market: Asia, London, New York.',
        how: 'Asia from 00:00 UTC, London from 08:00 London time, New York from 09:30 New York time (the cash equity open), with daylight saving handled automatically. A session lasts until the next one opens.',
        read: ['Volatility and volume rise after the opens, especially New York.', 'The type of day is often set in the morning; the New York open can change it.'],
        traps: ['An open is not a direction: the move after an open goes both ways and is often quickly given back.'],
        combine: ["With the IB: the range of the session's first hour as a map of the day.", "With session VWAP: is the new session trading above or below the previous one's price."],
        where: 'Indicators → Session opens',
        station: 'start',
      },
      {
        id: 'ib',
        name: 'Initial balance (IB)',
        group: 'price',
        what: "The range of the session's first hour: where the market set its first boundaries.",
        how: 'The high and low of the candles from the first hour of each session, and after it ends, 1.5× and 2× range extensions above the high and below the low.',
        read: ['Leaving the IB and acceptance outside it is range extension (a directional day).', 'Rejection at both edges is a range day.'],
        traps: ['BTC sessions have no real open like an exchange: the IB can be very wide (the whole move in the first hour) or very narrow.'],
        combine: ['With the profile: an IB edge at VAH or VAL is a stronger boundary.', 'With flow: an IB breakout with aggression and rising OI versus one without them.'],
        where: 'Indicators → Initial balance',
        station: 'auction',
        figure: { slice: '2026-10-23-balance', layers: { ib: 'ny', sessions: true, vwap: true }, caption: 'Friday 23 Oct: the New York IB contained the jump up and the drop down; the rest of the day stayed inside.' },
      },
      {
        id: 'footprint',
        name: 'Footprint: Bid × Ask, Delta, Volume',
        group: 'flow',
        what: 'Inside the candle: how much aggressors bought and sold at each price level.',
        how: 'From the Hyperliquid trade tape recorded by the desk: every trade has an aggressor side (a buy lifting the ask or a sell hitting the bid). The Bid × Ask style shows both numbers, Delta their difference, Volume their sum. Candles without a full tape are marked as partial.',
        read: [
          "Where the candle's volume was (framed POC): at the bottom, in the middle, at the top.",
          'Who was aggressive at the extremes: buying at the top of a rising candle versus the selling that stopped it.',
          'Empty or small cells at the edge of a candle (no trading on one side) mean a finished auction; both sides at the edge mean an unfinished auction.',
        ],
        traps: ["The footprint describes the candle's past. Without location (levels, profile, VWAP) it is easy to see anything in it.", "Tape history only goes back as far as the desk's recording."],
        combine: ['With open interest: aggression with rising OI means new positions, with falling OI closing.', 'With levels: a footprint at a value edge says more than one in the middle of the range.'],
        where: 'Footprint view and the Bid × Ask, Delta and Volume styles above the chart',
        station: 'scalp',
        figure: { slice: '2026-10-24-footprint', view: 'footprint', layers: {}, caption: 'Saturday 24 Oct, 18:00–21:30 UTC: a jump with aggressive buying and falling OI, then fading volume and a candle with new shorts.' },
      },
      {
        id: 'imbalance',
        name: 'Imbalances, zones and unfinished auctions',
        group: 'flow',
        what: 'Places where one side clearly dominated, and candle extremes where the auction did not finish.',
        how: 'Diagonal imbalance: buying at a level at least 3× the selling one level below (selling: 3× the buying one level above), above a value threshold. Zone: a run of at least 3 such rows, extended to the right until price trades through it. Unfinished auction: a candle high or low with trading on both sides, until price returns.',
        read: ['A run of imbalances shows where aggression went through several levels at once.', 'An unfinished auction is a level the market often returns to in order to “finish” the trade.'],
        traps: ['An imbalance zone is not guaranteed support (see the footprint exercise).', 'In our tests imbalances and their runs on their own gave no edge after costs.'],
        combine: ['With open interest and location: a zone at a value edge with rising OI is stronger context than a zone in the middle of the range.'],
        where: 'Indicators → Imbalance zones, Unfinished auctions; threshold in the footprint settings',
        station: 'scalp',
      },
      {
        id: 'delta',
        name: 'Aggressor delta',
        group: 'flow',
        what: 'The difference between aggressive buying and aggressive selling in a candle.',
        how: 'The volume of trades where the buyer was the aggressor minus those where the seller was, from the Hyperliquid tape (in BTC).',
        read: ["Delta in line with the candle's direction is a move with aggression; opposite delta is a move without it (for example price rising because sellers stepped back).", 'Large delta with no price movement is absorption by resting orders.'],
        traps: ['Delta describes the candle, not the future.', 'Every trade has a buyer and a seller; delta only tells you who was impatient.'],
        combine: ['With open interest: is the aggression opening or closing positions.', 'With a level: delta when an edge is tested.'],
        where: 'Delta panel under the chart',
        station: 'start',
        figure: { slice: '2026-10-24-cascade', layers: { delta: true, vwap: true }, at: '2026-10-24T21:30Z', caption: 'Saturday 24 Oct: delta since the tape recording began (16:25 UTC). Before that the panel is hatched.' },
      },
      {
        id: 'cvd',
        name: 'CVD: cumulative delta',
        group: 'flow',
        what: 'The sum of deltas since the start of a period: the direction of aggression over time.',
        how: "The delta of successive candles added up from the reset (session, UTC day, week or no reset). In Charts there is also exchange CVD: Hyperliquid, Binance (perp and spot) and Bybit, computed in the reader's browser.",
        read: ['Price and CVD in the same direction: a move with aggression. A divergence: a move without aggression, or aggression being absorbed.', 'Exchange CVD tells you whether Hyperliquid moves together with the larger markets.'],
        traps: ['CVD divergences look convincing on a chart, but in our tests they gave no edge after costs.', 'The shape of CVD depends on where it resets.'],
        combine: ['With open interest and price (the four quadrants from the cascade exercise).', 'With the exchange panels: agreement between HL, Binance and Bybit strengthens the reading.'],
        where: 'CVD panel under the chart; reset in the settings; Indicators → Exchange CVD',
        station: 'venues',
        figure: { slice: '2026-10-24-cascade', layers: { cvd: true, oi: true, vwap: true }, at: '2026-10-24T21:30Z', caption: 'Saturday 24 Oct: CVD rises together with price while open interest falls. Short covering.' },
      },
      {
        id: 'bubbles',
        name: 'Aggressor order bubbles',
        group: 'flow',
        what: 'Large market orders as circles on the chart: who hit with size, and where.',
        how: 'We join the fills of one aggressor order exactly (same taker and transaction hash). A bubble appears above a threshold tuned to the market (a high quantile of order values over the last hour); circle area by value, and a double ring marks a battle with one large maker.',
        read: ['A series of large bubbles at a level while price stands still: someone on the other side is absorbing.', 'A large bubble on a breakout with rising OI: a new position, not a close.'],
        traps: ['One large order is not a trend yet; often it is a position being closed or a hedge.'],
        combine: ['With the tape and DOM: what was resting in the book before the order came.', 'With whales: are large accounts moving.'],
        where: 'Indicators → Aggressor order bubbles',
        station: 'scalp',
      },
      {
        id: 'clashes',
        name: 'Bursts, walls and icebergs',
        group: 'flow',
        what: 'Clashes between participants computed from public trade data, without guesswork.',
        how: 'Burst: small orders from at least 4 different takers on one side within 2 seconds, together above a threshold. Wall: one maker at one price absorbed more than a threshold from at least 3 orders. Iceberg: a wall that absorbed at least 2× more than the whole level ever showed in the book (an order refreshed after each fill).',
        read: ['A wall at the level where price stopped explains why it stopped.', 'An iceberg is hidden liquidity: the book showed less than was really resting.'],
        traps: ['A wall can disappear at any moment; it describes what happened, it is not a promise.'],
        combine: ['With the heatmap and DOM: visible liquidity versus liquidity actually absorbed.'],
        where: 'Indicators → Bursts and walls',
        station: 'scalp',
      },
      {
        id: 'tape',
        name: 'Order tape (Time & Sales)',
        group: 'flow',
        what: 'A live list of trades: time, price, size, aggressor side.',
        how: 'Trades from the Hyperliquid WebSocket with a value filter (USD) and an optional sound for large orders.',
        read: ['The pace of the tape shows urgency: speeding up at a level is a fight for that level.', 'Large prints on one side with no price movement are absorption.'],
        traps: ['The tape tempts you to react to every print. Without a plan it is mostly noise.'],
        combine: ['With the DOM: who is taking liquidity and whether the book refills it.'],
        where: 'Indicators → Order tape; on phones the Tape card',
        station: 'scalp',
      },
      {
        id: 'venues',
        name: 'Exchange panels and the Numbers table',
        group: 'flow',
        what: 'The same market on three exchanges: CVD, OI change and funding from Hyperliquid, Binance and Bybit.',
        how: "Binance and Bybit data is fetched by the reader's browser (off by default, switched on in Sources); the desk does not store it. The Numbers table collects candle statistics in one place.",
        read: ['A move on Hyperliquid without confirmation on Binance is often local and short-lived.', 'Diverging funding between exchanges shows where leverage is crowding.'],
        traps: ['Different exchanges, different contracts and different participants: agreement is context, not a signal.'],
        combine: ['With CVD and OI on Hyperliquid: is the flow shared by the whole market.'],
        where: 'Indicators → Exchange CVD, Exchange ΔOI; Numbers table under the chart; Exchanges workstation',
        station: 'venues',
      },
      {
        id: 'heatmap',
        name: 'Order book heatmap',
        group: 'book',
        what: 'Resting orders over time: where liquidity stood and how it changed.',
        how: "Snapshots of the Hyperliquid l2Book (20 levels per side) at two price aggregations; each snapshot holds until the next. Brighter = more orders, white bands are walls. History from when the page was opened, and from the desk's recording for the last day.",
        read: ['A bright band where price stops is liquidity taking the move.', 'A band that disappears just before price arrives is an order pulled, not filled.'],
        traps: ['Resting orders can be pulled in a millisecond. Visible liquidity is not a promise.', 'The book only shows 20 levels per side.'],
        combine: ['With bubbles and walls: was the liquidity filled or pulled.', 'With levels: liquidity at PDH or PDL.'],
        where: 'Indicators → Order book heatmap; Scalper and Liquidity workstations',
        station: 'liquidity',
      },
      {
        id: 'dom',
        name: 'DOM: book ladder',
        group: 'book',
        what: 'The current order book as a ladder: size at each price above and below price.',
        how: 'The latest book snapshot at the right edge of the chart (asks above price, bids below), on a square-root scale so that one wall does not flatten the rest.',
        read: ['Asymmetry of the nearest levels shows which side is thinner.', 'A wall that stays as price approaches matters more than a wall far from price.'],
        traps: ['The DOM changes several times a second; individual walls are often placed and pulled.'],
        combine: ['With the tape: are aggressors eating the wall, or is the wall refilling.'],
        where: 'Ladder next to the heatmap; on phones the DOM card',
        station: 'scalp',
      },
      {
        id: 'lots',
        name: 'Large orders in the book',
        group: 'book',
        what: 'Book levels with exceptionally large resting orders, and how long they stayed.',
        how: 'A level whose average order is in the top 1% of the last 30 minutes for that market (no less than a fraction of the large aggressor order threshold); a line for as long as it rests in the book, and after 30 s a label “number of orders × average value”.',
        read: ["A large order that rests for a long time is someone's plan; a one-second flash is often a test."],
        traps: ['A large order can be bait and disappear before price gets there.'],
        combine: ['With walls: was the large order actually filled.'],
        where: 'Indicators → Large orders in the book',
        station: 'liquidity',
      },
      {
        id: 'liq',
        name: 'Liquidations and liquidation clusters',
        group: 'context',
        what: 'Forced closes of leveraged positions: those that have already happened, and places where they might happen.',
        how: "The clusters in Charts are the desk scanner's estimate of where the liquidation prices of open positions lie. The circles on the lesson figures are liquidations that have already happened (the desk's liquidation tape, in USD millions per candle).",
        read: ['A liquidation cascade is forced selling (or buying), not the decision of someone who knows more.', 'A large cluster close to price is fuel: reaching it can accelerate the move.'],
        traps: ['A cluster is an estimate from public positions, not a certainty; positions change.', 'The end of a cascade is hard to time in real time.'],
        combine: ["With the day's levels: stops and liquidations often sit just beyond PDH and PDL.", 'With open interest: a cascade is a sharp drop in OI.'],
        where: 'Indicators → Liquidation clusters; Desk → liquidation map and tape',
        station: 'liquidity',
        figure: { slice: '2026-10-24-cascade', layers: { liq: true, levels: true, vwap: true }, at: '2026-10-24T17:30Z', caption: 'Saturday 24 Oct: a break of PDL 80,500 and two waves of long liquidations, about $45M in total.' },
      },
      {
        id: 'whales',
        name: 'Whales',
        group: 'context',
        what: 'The largest positions and resting orders of the biggest Hyperliquid accounts.',
        how: 'The desk scanner reads the public state of the largest accounts and publishes it without addresses: each account has a pseudonym valid for one UTC day. On the chart: entry price (L/S, value, leverage), liquidation price and large orders, including stops and take-profits.',
        read: ['Large whale stops and take-profits are places where flow may appear.', "A change in a large account's position is information about its decision, not about the future price."],
        traps: ['Whales are wrong too, and some positions hedge other positions.', "Copying without knowing another player's whole portfolio is guessing."],
        combine: ['With liquidation clusters and levels: where several things fall in one place.'],
        where: 'Indicators → Whales',
        station: 'liquidity',
      },
      {
        id: 'oi',
        name: 'Open interest and funding',
        group: 'context',
        what: 'The number of open contracts (how many positions there are) and the rate the more crowded side pays.',
        how: 'Open interest from the Hyperliquid market context, recorded every minute together with the tape; hourly funding from the same source (in Charts also from Binance and Bybit).',
        read: ['Price ↑ and OI ↑: new longs. Price ↑ and OI ↓: short covering. Price ↓ and OI ↑: new shorts. Price ↓ and OI ↓: longs closing.', 'Extreme funding shows which side is overcrowded.'],
        traps: ['Every contract has two sides; OI tells you how many, not who is right.', 'Extreme funding can last a long time.'],
        combine: ['With delta and price (the cascade exercise).', 'With liquidations: a sharp OI drop during a move is forced closing.'],
        where: 'Indicators → Exchange ΔOI; Numbers table',
        station: 'venues',
        figure: { slice: '2026-10-24-cascade', layers: { oi: true, vwap: true }, at: '2026-10-24T21:30Z', caption: 'Saturday 24 Oct: the bounce after the cascade with falling open interest.' },
      },
    ],
  },
  combine: {
    intro:
      'No indicator answers everything. Professionals combine them by question, not by the number of lines on the screen. These three questions are worth asking before every decision, in this order.',
    questions: [
      { q: 'Where am I?', tools: 'Type of day (VWAP, bands), value (profile, POC, VAH, VAL), daily levels, session, IB.', answer: 'Context and location: is price at an edge, in the middle of the range, or somewhere new.' },
      { q: 'Who is pushing?', tools: 'Footprint, delta, CVD, bubbles, tape, open interest, liquidations, exchanges.', answer: 'Flow: is aggression opening new positions, closing old ones, or being absorbed.' },
      { q: 'Where am I wrong?', tools: 'Structure (low, high, value edge, VWAP), position size from the distance to invalidation.', answer: 'Risk: the level that says “the thesis has failed”, and the loss you accept before you enter.' },
    ],
    rules: [
      'Location first, then flow. A footprint in the middle of the range says little; the same footprint at a value edge says a lot.',
      'Two independent sources beat five dependent ones. VWAP, bands and profile are all price with volume; open interest and liquidations are different information.',
      'Every thesis has its invalidation level. If you cannot point to it, you do not have a thesis, only an opinion.',
      'You calculate position size from the distance to invalidation and the risk you accept. Never the other way round.',
      'Judge a decision by its process, not by the result of a single trade. A good decision can lose, a bad one can win.',
    ],
    recipesTitle: 'Ready-made question sets',
    recipesIntro: 'These are not signals. They are sets of questions for typical situations, with the place where you can see you are wrong.',
    recipeLabels: { context: 'Context', flow: 'Flow', risk: 'Invalidation', against: 'What argues against' },
    recipes: [
      {
        name: 'Value edge test',
        context: 'A balance day, price reaches VAH or VAL, ideally near another level (PDH/PDL, an IB edge).',
        flow: 'Does aggression at the edge carry through, or is it absorbed (large delta with no movement, walls, one-sided bubbles with no progress)?',
        risk: 'Acceptance on the other side of the edge: several candles and volume building outside the value area.',
        against: 'Rising open interest with aggression in the breakout direction, and price that stays beyond the edge.',
      },
      {
        name: 'Pullback on a trend day',
        context: 'A sloping VWAP, price on one side for hours, a broken daily level has changed roles.',
        flow: 'On the pullback to VWAP, a band or the broken level, is counter-trend aggression weakening (smaller delta, lower volume)?',
        risk: 'Acceptance on the other side of VWAP or of the broken level.',
        against: 'The pullback goes through VWAP with rising volume and open interest on the opposite side.',
      },
      {
        name: 'After a liquidation cascade',
        context: 'An important level broken, a series of large liquidations, price far from VWAP.',
        flow: 'Are liquidations shrinking, has price stopped making new extremes, has open interest stopped falling sharply?',
        risk: 'A new extreme of the cascade (low or high).',
        against: 'More waves of liquidations and new positions in the direction of the cascade (OI rising).',
      },
      {
        name: 'Initial balance breakout',
        context: "The session's first hour is complete, price moves outside the IB.",
        flow: 'Does the breakout have aggression and rising open interest (new positions), or only position closing?',
        risk: 'A return into the middle of the IB.',
        against: 'A quick return inside the edge and aggression on the opposite side (a range day, like 23 Oct).',
      },
    ],
  },
  myths: {
    intro:
      "Popular day-trading rules set against BTC history. The desk's Folklore lab counts how often each rule worked and compares that with what we would expect if price wandered randomly. Results refresh every hour.",
    how: 'How to read it: “success” is the share of events in which the rule worked; “random” is the expected share for a price without memory (for two-barrier rules it follows from their distances). What counts is the difference, not the share itself: a rule that works 60% of the time has no edge if random gives 60%.',
    columns: { claim: 'Rule', result: 'Success / random', n: 'Events', verdict: 'Verdict' },
    footer:
      "The historical score is exploratory (many rules at once, Benjamini–Hochberg correction). The real test is the forward score on events after the rule catalogue was recorded in the desk's verifiable ledger.",
  },
  risk: {
    badge: 'simulation',
    intro:
      'The same trader with the same hit rate can survive or go bust: risk per trade decides. The simulator draws a thousand trade series with your parameters and shows what they can look like.',
    labels: { winRate: 'Hit rate', payoff: 'Average win to loss (R)', riskPct: 'Risk per trade', trades: 'Number of trades', cost: 'Costs per trade (R)', reset: 'Defaults' },
    out: {
      expectancy: 'Expected result per trade',
      median: 'Median final equity',
      band: 'Typical range (5–95%)',
      dd20: 'Chance of a 20% or deeper drawdown',
      dd50: 'Chance of a 50% or deeper drawdown',
      streak: 'Typical longest losing streak',
      paths: 'Sample equity paths (start = 100)',
    },
    lessons: [
      { title: 'Losing streaks are normal', text: 'With a 50% hit rate, a run of 6–8 losses in a row over 200 trades is not bad luck, just statistics. The plan has to survive it, mentally and financially.' },
      { title: 'Risk per trade decides survival', text: 'The same edge gives a smooth path at 1% risk and deep drawdowns at 5%. After losing 50% you need a 100% gain to get back.' },
      { title: 'Without an edge, costs eat your capital', text: 'With an expected result of 0 R before costs (a coin flip), fees and slippage push median equity down. Only an honest journal can show an edge, not a few winning trades.' },
    ],
    sizeLink: 'Position size calculator: Microstructure tab',
    planLink: 'Enter a concrete plan in the Plan Analyzer',
  },
};
