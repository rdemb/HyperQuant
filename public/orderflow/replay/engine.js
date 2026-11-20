// Source amounts are integers in millionths of a USD. A price is an integer
// tick. Archive timestamps are milliseconds UTC, and coverage spans are [a,b).

const thresholds = [1000, 10000, 50000, 100000, 500000, 1000000].map((n) => n * 1e6);
const classify = (amount) => thresholds.reduce((i, boundary) => i + Number(amount >= boundary), 0);
function upper(array, t, key) {
  let lo = 0,
    hi = array.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(array[mid]) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function covered(spans, a, b) {
  return spans.reduce((n, [lo, hi]) => n + Math.max(0, Math.min(hi, b) - Math.max(lo, a)), 0);
}
const emptyLevel = () => ({
  flow: [0, 0],
  now: [0, 0],
  bands: [0, 0, 0, 0, 0, 0, 0],
  hits: [0, 0, 0, 0, 0, 0, 0],
  slices: [0, 0, 0, 0],
  sliceN: [0, 0, 0, 0],
  recent: null,
  count: 0,
});
const getTime = (row) => row[0];
function create(archives) {
  const index = {};
  for (const [key, data] of Object.entries(archives)) {
    const { start, end, trades, books, tapeSpans, bookSpans } = data;
    const tape = trades.filter((r) => covered(tapeSpans, r[0], r[0] + 1) === 1);
    const depth = books.filter((r) => covered(bookSpans, r[0], r[0] + 1) === 1);
    const events = [...new Set([start, end, ...tape.map(getTime), ...depth.map(getTime)])]
      .filter((t) => start <= t && t <= end)
      .sort((a, b) => a - b);
    index[key] = { data, tape, depth, events };
  }
  function markets() {
    return Object.fromEntries(
      Object.entries(index).map(([k, { data, events }]) => [
        k,
        { scale: data.scale, symbol: data.symbol, start: data.start, end: data.end, marks: data.marks, events },
      ]),
    );
  }
  function frame(key, time, requestedPrice) {
    const market = index[key];
    if (!market) throw new RangeError('Nieznany rynek');
    const { data, tape, depth } = market;
    if (!Number.isSafeInteger(time) || time < data.start || time > data.end)
      throw new RangeError('Czas poza nagraniem');
    if (requestedPrice != null && (!Number.isSafeInteger(requestedPrice) || requestedPrice <= 0))
      throw new RangeError('Nieprawidłowy poziom ceny');
    const end = upper(tape, time, getTime);
    const start = upper(tape, time - 120000, getTime);
    const levels = Object.create(null),
      total = [0, 0],
      bandCount = Array(7).fill(0);
    const timeline = Array.from({ length: 60 }, () => [0, 0]);
    const trail20 = [];
    const atStamp = new Map();
    let stamp = null;
    const bookEnd = upper(depth, time, getTime);
    const currentSpan = data.bookSpans.find(([a, b]) => a <= time && time < b);
    const history = currentSpan
      ? depth.slice(Math.max(0, bookEnd - 4), bookEnd).filter((r) => r[0] >= currentSpan[0])
      : [];
    const book = history.at(-1);
    let examplePrice = null,
      largest = -1;
    for (let i = start; i < end; i++) {
      const row = tape[i],
        [t, price, , sign, amount, band] = row,
        age = time - t;
      const s = sign > 0 ? 0 : 1;
      const level = (levels[price] ||= emptyLevel());
      total[s] += amount;
      level.flow[s] += amount;
      bandCount[band]++;
      timeline[59 - Math.floor(age / 2000)][s] += amount;
      if (age < 20000) {
        const j = 3 - Math.floor(age / 5000);
        level.slices[j] += sign * amount;
        level.sliceN[j]++;
        if (t >= data.start) {
          if (stamp !== t) {
            atStamp.clear();
            stamp = t;
          }
          if (!atStamp.has(price)) {
            const point = [t, price, 0, 0];
            atStamp.set(price, point);
            trail20.push(point);
          }
          atStamp.get(price)[2 + s] += amount;
        }
      }
      if (age < 2000) {
        if (!level.recent || level.recent[0] !== t) level.recent = [t, 0, 0, 0];
        level.recent[s + 1] += amount;
        level.recent[3]++;
      }
      if (age === 0) {
        level.count++;
        level.now[s] += amount;
        level.bands[band] += sign * amount;
        level.hits[band]++;
        const gross = level.now[0] + level.now[1];
        if (gross > largest) {
          largest = gross;
          examplePrice = price;
        }
      }
    }
    const price = requestedPrice ?? examplePrice ?? (end ? tape[end - 1][1] : book?.[1][0][0]) ?? data.marks[0][1];
    const atPrice = [];
    for (let i = end - 1; i >= start; i--) if (tape[i][1] === price) atPrice.push(tape[i]);
    return {
      time,
      price,
      levels,
      total,
      bandCount,
      timeline,
      trail20,
      history,
      atPrice,
      count: end - start,
      recent: tape.slice(Math.max(start, end - 7), end).reverse(),
      coverage: covered(data.tapeSpans, time - 119999, time + 1),
      instantCoverage: covered(data.tapeSpans, time, time + 1),
      recentCoverage: covered(data.tapeSpans, time - 1999, time + 1),
      sliceCoverage: Array.from({ length: 4 }, (_, index) => {
        const from = time + 1 - 20000 + index * 5000;
        return covered(data.tapeSpans, from, from + 5000);
      }),
    };
  }
  return { markets, frame };
}
// Return a signed BID/ASK observation only in the price range the snapshot covers.
function quote(book, p) {
  if (!book || !book[1].length || !book[2].length) return null;
  const bid = book[1],
    ask = book[2];
  if (p < bid.at(-1)[0] || p > ask.at(-1)[0]) return null;
  const b = bid.find((r) => r[0] === p),
    a = ask.find((r) => r[0] === p);
  return { bid: b?.[1] ?? 0, ask: a?.[1] ?? 0, nb: b ? b[2] : 0, na: a ? a[2] : 0 };
}
export { create, quote, emptyLevel, classify };
