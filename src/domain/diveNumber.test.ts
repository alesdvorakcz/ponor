import {
  assignDiveNumbers,
  compareDiveOrder,
  isDiveCount,
  type DiveOrdering,
} from './diveNumber';

const dive = (over: Partial<DiveOrdering> & { id: string }): DiveOrdering => ({
  status: 'logged', date: '2026-08-16', timeIn: null, manualOrder: null,
  createdAt: '2026-08-16T10:00:00.000Z', ...over,
});

describe('assignDiveNumbers', () => {
  it('numbers dives chronologically from one', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'b', date: '2026-08-17' }), dive({ id: 'a', date: '2026-08-16' })],
      0,
    );
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(2);
  });

  it('offsets by the dives logged before Ponor', () => {
    const numbers = assignDiveNumbers([dive({ id: 'a' })], 247);
    expect(numbers.get('a')).toBe(248);
  });

  it('orders same-day dives by entry time', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'second', timeIn: '14:30' }), dive({ id: 'first', timeIn: '09:15' })],
      0,
    );
    expect(numbers.get('first')).toBe(1);
    expect(numbers.get('second')).toBe(2);
  });

  it('falls back to creation order when times are missing', () => {
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'later', createdAt: '2026-08-16T12:00:00.000Z' }),
        dive({ id: 'earlier', createdAt: '2026-08-16T09:00:00.000Z' }),
      ],
      0,
    );
    expect(numbers.get('earlier')).toBe(1);
    expect(numbers.get('later')).toBe(2);
  });

  it('puts a dive with a time before one without, on the same day', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'untimed' }), dive({ id: 'timed', timeIn: '09:15' })],
      0,
    );
    expect(numbers.get('timed')).toBe(1);
    expect(numbers.get('untimed')).toBe(2);
  });

  it('orders same-day, same-time dives by hand when manualOrder is set', () => {
    // Ids are the reverse of the expected order on purpose: if this tier
    // were ever dropped, the id tier (the last one) would produce the
    // opposite result instead of passing by coincidence.
    const numbers = assignDiveNumbers(
      [dive({ id: 'a-second', manualOrder: 9 }), dive({ id: 'z-first', manualOrder: 2 })],
      0,
    );
    expect(numbers.get('z-first')).toBe(1);
    expect(numbers.get('a-second')).toBe(2);
  });

  it('puts a hand-ordered dive before one with no manualOrder, on the same day and time', () => {
    // Same adversarial-id trick as above.
    const numbers = assignDiveNumbers(
      [dive({ id: 'a-unordered' }), dive({ id: 'z-ordered', manualOrder: 3 })],
      0,
    );
    expect(numbers.get('z-ordered')).toBe(1);
    expect(numbers.get('a-unordered')).toBe(2);
  });

  it('falls through to creation order when neither dive has manualOrder set', () => {
    // Proves the tier is transparent when unset: identical to "falls back
    // to creation order when times are missing" above, now that every
    // `dive()` also carries a manualOrder (defaulted to null).
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'later', createdAt: '2026-08-16T12:00:00.000Z' }),
        dive({ id: 'earlier', createdAt: '2026-08-16T09:00:00.000Z' }),
      ],
      0,
    );
    expect(numbers.get('earlier')).toBe(1);
    expect(numbers.get('later')).toBe(2);
  });

  it('does not let manualOrder override timeIn: an earlier time still wins', () => {
    // The "worse" (higher) manualOrder is deliberately on the earlier-time
    // dive, and the "better" (lower) one on the later-time dive, so a bug
    // that checked manualOrder before (or instead of) timeIn would flip
    // this result.
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'later-time-low-order', timeIn: '14:30', manualOrder: 1 }),
        dive({ id: 'earlier-time-high-order', timeIn: '09:15', manualOrder: 9 }),
      ],
      0,
    );
    expect(numbers.get('earlier-time-high-order')).toBe(1);
    expect(numbers.get('later-time-low-order')).toBe(2);
  });

  it('does not let manualOrder cross dates: it only breaks ties within one date', () => {
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'later-date-low-order', date: '2026-08-17', manualOrder: 1 }),
        dive({ id: 'earlier-date-high-order', date: '2026-08-16', manualOrder: 9 }),
      ],
      0,
    );
    expect(numbers.get('earlier-date-high-order')).toBe(1);
    expect(numbers.get('later-date-low-order')).toBe(2);
  });

  it('excludes planned dives entirely', () => {
    const numbers = assignDiveNumbers(
      [dive({ id: 'planned', status: 'planned', date: '2026-08-18' }), dive({ id: 'logged' })],
      0,
    );
    expect(numbers.get('logged')).toBe(1);
    expect(numbers.has('planned')).toBe(false);
  });

  it('renumbers everything after a backfilled dive', () => {
    const existing = [dive({ id: 'a', date: '2026-08-16' }), dive({ id: 'b', date: '2026-08-17' })];
    const before = assignDiveNumbers(existing, 0);
    expect(before.get('b')).toBe(2);

    const after = assignDiveNumbers([...existing, dive({ id: 'old', date: '2020-01-01' })], 0);
    expect(after.get('old')).toBe(1);
    expect(after.get('a')).toBe(2);
    expect(after.get('b')).toBe(3);
  });

  it('returns an empty map for no dives', () => {
    expect(assignDiveNumbers([], 10).size).toBe(0);
  });
});

describe('compareDiveOrder', () => {
  it('returns 0 for a genuine tie, so it is a valid comparator at all', () => {
    // At HEAD the last tier was `return aId < bId ? -1 : 1`, so equal ids fell
    // into the `1` branch: cmp(x, x) was 1. Array.sort with an inconsistent
    // comparator is implementation-defined, and the app runs on Hermes rather
    // than the V8 these tests run on.
    const x = dive({ id: 'x', timeIn: '10:00', manualOrder: 3 });
    expect(compareDiveOrder(x, x)).toBe(0);
    expect(compareDiveOrder(x, { ...x })).toBe(0);
  });

  // The comparator has three non-test call sites — numbering, listing and
  // reordering all lean on it — and used to have zero direct tests. That
  // coverage shape is exactly why the reflexivity bug above survived: both
  // consumers assert on *results*, so a comparator that violates its own laws
  // on tied inputs passes everything they check. These assert the laws
  // themselves, over a field grid that ties at every tier.
  const grid: DiveOrdering[] = [];
  for (const date of ['2026-08-16', '2026-8-16', '2026-08-17', 'not a date']) {
    for (const timeIn of [null, undefined, '', '09:15', '9:15', '19:00']) {
      for (const manualOrder of [null, 1, 2, NaN]) {
        for (const createdAt of ['2026-08-16T01:00:00.000Z', '2026-08-16T02:00:00.000Z']) {
          for (const id of ['a', 'b']) {
            grid.push({
              status: 'logged',
              date,
              timeIn,
              manualOrder,
              createdAt,
              id,
            } as unknown as DiveOrdering);
          }
        }
      }
    }
  }
  // Deliberately includes values that MUST tie: '2026-8-16' with
  // '2026-08-16', '9:15' with '09:15', '' with null and undefined, NaN with
  // NaN — the pairs where a comparator that compares raw values instead of
  // normalised ones returns the same sign in both directions.
  const describeRow = (row: DiveOrdering) => JSON.stringify(row);

  it('is reflexive: every row compares equal to itself', () => {
    const violations = grid.filter((row) => compareDiveOrder(row, row) !== 0);
    expect(violations.map(describeRow)).toEqual([]);
  });

  it('is antisymmetric: sign(cmp(a, b)) === -sign(cmp(b, a)) for every pair', () => {
    const violations: string[] = [];
    for (const a of grid) {
      for (const b of grid) {
        if (Math.sign(compareDiveOrder(a, b)) !== -Math.sign(compareDiveOrder(b, a))) {
          violations.push(`${describeRow(a)} vs ${describeRow(b)}`);
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations).toHaveLength(0);
  });

  it('is transitive: a <= b and b <= c implies a <= c', () => {
    // Every 12th row, so the triple sweep stays exhaustive over a real subset
    // rather than sampled — sampling is how this file's past order-dependence
    // bugs escaped review.
    const subset = grid.filter((_, index) => index % 12 === 0);
    expect(subset.length).toBeGreaterThan(20);

    const violations: string[] = [];
    for (const a of subset) {
      for (const b of subset) {
        if (compareDiveOrder(a, b) > 0) continue;
        for (const c of subset) {
          if (compareDiveOrder(b, c) > 0) continue;
          if (compareDiveOrder(a, c) > 0) {
            violations.push(`${describeRow(a)} -> ${describeRow(b)} -> ${describeRow(c)}`);
          }
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations).toHaveLength(0);
  });

  it('has transitive equality: a == b and b == c implies a == c', () => {
    const subset = grid.filter((_, index) => index % 12 === 0);
    const violations: string[] = [];
    for (const a of subset) {
      for (const b of subset) {
        if (compareDiveOrder(a, b) !== 0) continue;
        for (const c of subset) {
          if (compareDiveOrder(b, c) !== 0) continue;
          if (compareDiveOrder(a, c) !== 0) {
            violations.push(`${describeRow(a)} == ${describeRow(b)} == ${describeRow(c)}`);
          }
        }
      }
    }
    expect(violations).toHaveLength(0);
  });

  it('actually ties the pairs it is meant to tie, so the laws above are not vacuous', () => {
    // If nothing in the grid ever tied, reflexivity would be the only law with
    // any content. These are the specific normalisation ties.
    const base = { status: 'logged' as const, createdAt: '2026-08-16T01:00:00.000Z', id: 'a' };
    const tie = (x: Partial<DiveOrdering>, y: Partial<DiveOrdering>) =>
      compareDiveOrder(
        { ...base, date: '2026-08-16', timeIn: null, manualOrder: null, ...x } as DiveOrdering,
        { ...base, date: '2026-08-16', timeIn: null, manualOrder: null, ...y } as DiveOrdering,
      );
    expect(tie({ date: '2026-8-16' }, { date: '2026-08-16' })).toBe(0);
    expect(tie({ timeIn: '9:15' }, { timeIn: '09:15' })).toBe(0);
    expect(tie({ timeIn: '' }, { timeIn: null })).toBe(0);
    expect(tie({ timeIn: undefined }, { timeIn: null })).toBe(0);
    expect(tie({ manualOrder: NaN }, { manualOrder: NaN })).toBe(0);
  });
});

describe('assignDiveNumbers with loosely spelled dates and times', () => {
  it('orders an unpadded time chronologically, not lexicographically', () => {
    // At HEAD this produced the opposite result: '19:00' < '7:30' as raw
    // strings, so the half-past-seven-in-the-morning dive was numbered after
    // the seven-in-the-evening one.
    const numbers = assignDiveNumbers(
      [dive({ id: 'evening', timeIn: '19:00' }), dive({ id: 'morning', timeIn: '7:30' })],
      0,
    );
    expect(numbers.get('morning')).toBe(1);
    expect(numbers.get('evening')).toBe(2);
  });

  it('treats an empty-string timeIn as no time, not as the earliest time', () => {
    // '' < '08:00' as raw strings, so an untouched text field used to put its
    // dive at the head of the day instead of the tail (DESIGN.md §2.5 puts an
    // untimed dive after a timed one).
    const numbers = assignDiveNumbers(
      [dive({ id: 'blank', timeIn: '' }), dive({ id: 'timed', timeIn: '08:00' })],
      0,
    );
    expect(numbers.get('timed')).toBe(1);
    expect(numbers.get('blank')).toBe(2);
  });

  it('ties an unpadded time with its canonical spelling, falling through to the next tier', () => {
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'z-unpadded', timeIn: '9:15', manualOrder: 2 }),
        dive({ id: 'a-padded', timeIn: '09:15', manualOrder: 1 }),
      ],
      0,
    );
    // Same time -> manualOrder decides, not the raw string compare (which
    // would have put '09:15' first regardless of hand order).
    expect(numbers.get('a-padded')).toBe(1);
    expect(numbers.get('z-unpadded')).toBe(2);
  });

  it('orders an unpadded date chronologically, not lexicographically', () => {
    // At HEAD: '2026-08-18' < '2026-8-17', so the 17th was numbered #3.
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'c', date: '2026-08-18' }),
        dive({ id: 'b', date: '2026-8-17' }),
        dive({ id: 'a', date: '2026-08-16' }),
      ],
      0,
    );
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(2);
    expect(numbers.get('c')).toBe(3);
  });

  it('still numbers a date it cannot read at all, where the diver typed it', () => {
    // '2026-02-30' is not a real day, so datetime.ts refuses it and the raw
    // string fallback places it between the 28th and 1 March. Numbering never
    // refuses to number a dive; the arithmetic in derived.ts is what declines
    // to compute on it.
    const numbers = assignDiveNumbers(
      [
        dive({ id: 'c', date: '2026-03-01' }),
        dive({ id: 'b', date: '2026-02-30' }),
        dive({ id: 'a', date: '2026-02-28' }),
      ],
      0,
    );
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(2);
    expect(numbers.get('c')).toBe(3);
  });
});

describe('assignDiveNumbers against malformed input and non-determinism', () => {
  it('does not throw when dives is not an array', () => {
    expect(() => assignDiveNumbers(null as unknown as DiveOrdering[], 0)).not.toThrow();
    expect(() => assignDiveNumbers(undefined as unknown as DiveOrdering[], 0)).not.toThrow();
    expect(assignDiveNumbers(null as unknown as DiveOrdering[], 0).size).toBe(0);
    expect(assignDiveNumbers(undefined as unknown as DiveOrdering[], 0).size).toBe(0);
  });

  it('does not throw on a null or undefined entry, and still numbers the real dives around it', () => {
    const withHoles = [
      null as unknown as DiveOrdering,
      dive({ id: 'a' }),
      undefined as unknown as DiveOrdering,
    ];
    expect(() => assignDiveNumbers(withHoles, 0)).not.toThrow();
    const numbers = assignDiveNumbers(withHoles, 0);
    expect(numbers.size).toBe(1);
    expect(numbers.get('a')).toBe(1);
  });

  it('excludes an entry with no recognizable status instead of throwing', () => {
    const malformed = {} as unknown as DiveOrdering;
    expect(() => assignDiveNumbers([malformed], 0)).not.toThrow();
    expect(assignDiveNumbers([malformed], 0).size).toBe(0);
  });

  it('falls back to a zero offset for a divesBefore that is not a real non-negative integer', () => {
    const badOffsets = [NaN, Infinity, -Infinity, -5, 2.5, null, undefined];
    for (const bad of badOffsets) {
      const numbers = assignDiveNumbers([dive({ id: 'a' })], bad as unknown as number);
      expect(numbers.get('a')).toBe(1);
    }
  });

  it('never lets a wrong-typed divesBefore turn a dive number into a string', () => {
    // '247' + 0 + 1 is not a type error under plain +, it's the STRING "24701" —
    // the one case here that doesn't just look wrong, it silently breaks the
    // Map<string, number> contract for every consumer downstream.
    const numbers = assignDiveNumbers([dive({ id: 'a' })], '247' as unknown as number);
    expect(numbers.get('a')).toBe(1);
    expect(typeof numbers.get('a')).toBe('number');
  });

  it('numbers a dive with a missing createdAt or date the same way regardless of input order', () => {
    // Before toComparable: a.createdAt < b.createdAt and b.createdAt < a.createdAt
    // were BOTH false whenever one side was undefined (each side coerces toward
    // NaN), so the tiebreak's chosen sign depended on which of (a,b)/(b,a) the
    // sort happened to compare — the exact "two devices disagree" failure this
    // function exists to prevent.
    const noCreatedAt = { id: 'a', status: 'logged', date: '2026-08-16', timeIn: null } as unknown as DiveOrdering;
    const real = dive({ id: 'b' });
    const forward = assignDiveNumbers([noCreatedAt, real], 0);
    const backward = assignDiveNumbers([real, noCreatedAt], 0);
    expect(forward.get('a')).toBe(backward.get('a'));
    expect(forward.get('b')).toBe(backward.get('b'));

    const noDate = {
      id: 'c', status: 'logged', timeIn: null, createdAt: '2026-08-16T10:00:00.000Z',
    } as unknown as DiveOrdering;
    const real2 = dive({ id: 'd' });
    const forward2 = assignDiveNumbers([noDate, real2], 0);
    const backward2 = assignDiveNumbers([real2, noDate], 0);
    expect(forward2.get('c')).toBe(backward2.get('c'));
    expect(forward2.get('d')).toBe(backward2.get('d'));
  });

  it('numbers a dive with a non-string timeIn the same way regardless of input order', () => {
    // Mirrors the missing-createdAt/date test above, for the timeIn tier's
    // own toComparable call: without it, comparing a number against a
    // string via `<` converts both operands toward Number, the same
    // false-in-both-directions failure that broke createdAt and date.
    const numericTimeIn = {
      id: 'p', status: 'logged', date: '2026-08-16', timeIn: 99,
      createdAt: '2026-08-16T10:00:00.000Z',
    } as unknown as DiveOrdering;
    const realTime = dive({ id: 'q', timeIn: '09:15' });
    const forward = assignDiveNumbers([numericTimeIn, realTime], 0);
    const backward = assignDiveNumbers([realTime, numericTimeIn], 0);
    expect(forward.get('p')).toBe(backward.get('p'));
    expect(forward.get('q')).toBe(backward.get('q'));
  });

  it('numbers a dive with an object manualOrder the same way regardless of input order', () => {
    // Mirrors the numericTimeIn test above, for the manualOrder tier: an
    // object can't be fed into a numeric `<` the way a number can, so it
    // must be treated as "not set" rather than compared directly.
    const objectOrder = {
      id: 'p', status: 'logged', date: '2026-08-16', timeIn: null,
      manualOrder: {}, createdAt: '2026-08-16T10:00:00.000Z',
    } as unknown as DiveOrdering;
    const realOrder = dive({ id: 'q', manualOrder: 4 });
    const forward = assignDiveNumbers([objectOrder, realOrder], 0);
    const backward = assignDiveNumbers([realOrder, objectOrder], 0);
    expect(forward.get('p')).toBe(backward.get('p'));
    expect(forward.get('q')).toBe(backward.get('q'));
    // And the real, usable value correctly sorts first either way.
    expect(forward.get('q')).toBe(1);
    expect(forward.get('p')).toBe(2);
  });

  it('numbers two NaN-manualOrder dives the same way regardless of input order', () => {
    // The case this tier's design is built around: NaN !== NaN, so a naive
    // `value !== other ? value < other ? -1 : 1` tiebreak here would return
    // the same sign for both (a, b) and (b, a) whenever both sides are NaN
    // — not antisymmetric, and the chosen sign would depend on which of
    // (a, b)/(b, a) the sort happened to compare, the exact "two devices
    // disagree" failure this file exists to prevent.
    const nanA = {
      id: 'nan-a', status: 'logged', date: '2026-08-16', timeIn: null,
      manualOrder: NaN, createdAt: '2026-08-16T10:00:00.000Z',
    } as unknown as DiveOrdering;
    const nanB = { ...nanA, id: 'nan-b' } as unknown as DiveOrdering;
    const forward = assignDiveNumbers([nanA, nanB], 0);
    const backward = assignDiveNumbers([nanB, nanA], 0);
    expect(forward.get('nan-a')).toBe(backward.get('nan-a'));
    expect(forward.get('nan-b')).toBe(backward.get('nan-b'));
    // Both NaN -> both "not usable" -> tie -> fall through to id.
    expect(forward.get('nan-a')).toBe(1);
    expect(forward.get('nan-b')).toBe(2);
  });

  it('sweeps every permutation of a mixed-manualOrder list to the identical result', () => {
    // Exhaustive, not sampled: every one of the 7! orderings of this list
    // must produce the identical id->number map. This list ties on date,
    // timeIn and createdAt, and covers every "not usable" shape manualOrder
    // can corrupt to (null, undefined, NaN, Infinity, a string, an object)
    // alongside one real value. Sampling a handful of orderings is exactly
    // how this file's past order-dependence bugs escaped review.
    const base = {
      status: 'logged' as const, date: '2026-08-16', timeIn: null,
      createdAt: '2026-08-16T10:00:00.000Z',
    };
    // 'zz-num' is deliberately the alphabetically LAST id, so a tier that
    // silently stopped being consulted (falling through straight to the id
    // tier) would rank it last, not first — the assertion below would then
    // catch it instead of passing by coincidence of id naming.
    const items = [
      { ...base, id: 'zz-num', manualOrder: 5 },
      { ...base, id: 'u-null', manualOrder: null },
      { ...base, id: 'u-undefined', manualOrder: undefined },
      { ...base, id: 'u-nan', manualOrder: NaN },
      { ...base, id: 'u-infinity', manualOrder: Infinity },
      { ...base, id: 'u-string', manualOrder: 'nine' },
      { ...base, id: 'u-object', manualOrder: {} },
    ] as unknown as DiveOrdering[];

    const permute = (arr: DiveOrdering[]): DiveOrdering[][] =>
      arr.length <= 1
        ? [arr]
        : arr.flatMap((item, i) =>
            permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((rest) => [item, ...rest]),
          );

    const allPermutations = permute(items);
    expect(allPermutations.length).toBe(5040); // 7!

    const reference = assignDiveNumbers(items, 0);
    expect(reference.get('zz-num')).toBe(1); // the only usable value always sorts first

    let checked = 0;
    for (const perm of allPermutations) {
      const numbers = assignDiveNumbers(perm, 0);
      expect(Object.fromEntries(numbers)).toEqual(Object.fromEntries(reference));
      checked += 1;
    }
    expect(checked).toBe(5040);
  });

  it('numbers dives with distinct non-string ids the same way regardless of input order', () => {
    // The regression this fixes: at HEAD, [{id:1},{id:2}] tied on every
    // other field produced 2 different numberings across its 2
    // permutations, because both ids collapsed to the same '' fallback —
    // id is the last tier, so nothing below it could break the tie.
    // Numbers specifically, because the pre-hardening code (`aId < bId` on
    // the raw ids) got this exact case right via numeric `<`, making a
    // regression here easy to miss.
    const one = {
      id: 1, status: 'logged', date: '2026-08-16', timeIn: null,
      createdAt: '2026-08-16T10:00:00.000Z',
    } as unknown as DiveOrdering;
    const two = { ...one, id: 2 } as unknown as DiveOrdering;
    const forward = assignDiveNumbers([one, two], 0);
    const backward = assignDiveNumbers([two, one], 0);
    expect(forward.get(one.id)).toBe(backward.get(one.id));
    expect(forward.get(two.id)).toBe(backward.get(two.id));
  });

  it('does not throw for a Symbol id, and orders it deterministically regardless of input order', () => {
    const symA = {
      id: Symbol('a'), status: 'logged', date: '2026-08-16', timeIn: null,
      createdAt: '2026-08-16T10:00:00.000Z',
    } as unknown as DiveOrdering;
    const symB = { ...symA, id: Symbol('b') } as unknown as DiveOrdering;
    expect(() => assignDiveNumbers([symA, symB], 0)).not.toThrow();
    const forward = assignDiveNumbers([symA, symB], 0);
    const backward = assignDiveNumbers([symB, symA], 0);
    expect(forward.get(symA.id)).toBe(backward.get(symA.id));
    expect(forward.get(symB.id)).toBe(backward.get(symB.id));
  });

  it('treats a missing (undefined) timeIn the same as a null one, not as an early time', () => {
    // At HEAD these disagreed: null correctly sorted after a real time, but
    // undefined sorted BEFORE it (toComparable(undefined) === '', and ''
    // sorts before any real "HH:MM" string) — the `=== null` check ran
    // before toComparable could normalise the two to the same thing.
    const withNull = assignDiveNumbers(
      [dive({ id: 'timed', timeIn: '09:15' }), dive({ id: 'untimed', timeIn: null })],
      0,
    );
    const undefinedTimeIn = {
      id: 'untimed', status: 'logged', date: '2026-08-16',
      createdAt: '2026-08-16T10:00:00.000Z',
    } as unknown as DiveOrdering; // timeIn omitted entirely -> undefined
    const withUndefined = assignDiveNumbers(
      [dive({ id: 'timed', timeIn: '09:15' }), undefinedTimeIn],
      0,
    );
    expect(withUndefined.get('timed')).toBe(withNull.get('timed'));
    expect(withUndefined.get('untimed')).toBe(withNull.get('untimed'));
    expect(withNull.get('timed')).toBe(1);
    expect(withNull.get('untimed')).toBe(2);
  });

  it('numbers a large list identically no matter how the input is ordered', () => {
    const n = 500;
    const dives: DiveOrdering[] = [];
    for (let i = 0; i < n; i++) {
      const date = new Date(Date.UTC(2015, 0, 1) + i * 86400000).toISOString().slice(0, 10);
      dives.push(dive({ id: `id-${i}`, date, createdAt: `${date}T00:00:00.000Z` }));
    }
    const reversed = [...dives].reverse();
    // A fixed, non-random permutation distinct from both forward and reverse order.
    const interleaved = dives.filter((_, i) => i % 2 === 0).concat(dives.filter((_, i) => i % 2 === 1));

    const forward = assignDiveNumbers(dives, 0);
    const backward = assignDiveNumbers(reversed, 0);
    const mixed = assignDiveNumbers(interleaved, 0);
    const repeat = assignDiveNumbers(dives, 0);

    dives.forEach((d, i) => {
      expect(forward.get(d.id)).toBe(i + 1);
      expect(backward.get(d.id)).toBe(i + 1);
      expect(mixed.get(d.id)).toBe(i + 1);
      expect(repeat.get(d.id)).toBe(i + 1);
    });
  });

  it('breaks a tie on every other field using id, the same way regardless of input order', () => {
    const x = dive({ id: 'x', timeIn: '10:00' });
    const y = dive({ id: 'y', timeIn: '10:00' });
    const forward = assignDiveNumbers([x, y], 0);
    const backward = assignDiveNumbers([y, x], 0);
    // 'x' and 'y' tie on date, timeIn and createdAt; 'x' < 'y' lexicographically
    // decides it, independent of which one came first in the input array.
    expect(forward.get('x')).toBe(1);
    expect(forward.get('y')).toBe(2);
    expect(backward.get('x')).toBe(1);
    expect(backward.get('y')).toBe(2);
  });

  it('skips a repeated id instead of letting it consume a dive number and shift everything after it', () => {
    const shared = {
      id: 'dup', status: 'logged' as const, date: '2026-08-16',
      timeIn: null, manualOrder: null, createdAt: '2026-08-16T10:00:00.000Z',
    };
    expect(() => assignDiveNumbers([{ ...shared }, { ...shared }], 0)).not.toThrow();
    // A duplicate id is a data-integrity bug outside this function's remit
    // (id is the primary key) — but it IS reachable: a paginated dive list
    // that concatenates overlapping pages (the routine infinite-scroll
    // pattern), or a pre-dedupe import. The two entries collapse to one map
    // entry under the shared key either way; what matters is that the repeat
    // doesn't consume a number that then leaves a gap, shifting every dive
    // after it down by one.
    const numbers = assignDiveNumbers([{ ...shared }, { ...shared }], 0);
    expect(numbers.size).toBe(1);

    const withDuplicate = assignDiveNumbers(
      [
        dive({ id: 'a', date: '2026-01-01' }),
        { ...shared, date: '2026-02-01' },
        { ...shared, date: '2026-03-01' },
        dive({ id: 'z', date: '2026-04-01' }),
      ],
      0,
    );
    const withoutDuplicate = assignDiveNumbers(
      [
        dive({ id: 'a', date: '2026-01-01' }),
        { ...shared, date: '2026-02-01' },
        dive({ id: 'z', date: '2026-04-01' }),
      ],
      0,
    );
    expect(withDuplicate.get('z')).toBe(withoutDuplicate.get('z'));
    expect(withDuplicate.get('z')).toBe(3);
  });
});

describe('isDiveCount — the one owner of the "valid dives_before" rule', () => {
  // Three places need this predicate and each acts differently on the answer:
  // settings.getDivesBefore throws, settings.setDivesBefore throws, and
  // assignDiveNumbers falls back to 0 because it runs during render. The
  // differing actions are deliberate; three copies of the predicate were the
  // same one-rule-written-several-times shape this milestone spent itself
  // closing, one tier smaller.
  it('accepts a non-negative integer', () => {
    for (const good of [0, 1, 247, Number.MAX_SAFE_INTEGER]) {
      expect(isDiveCount(good)).toBe(true);
    }
  });

  it('rejects everything that cannot be a count of dives', () => {
    for (const bad of [-1, -0.5, 2.5, NaN, Infinity, -Infinity, null, undefined, '247', {}, []]) {
      expect(isDiveCount(bad)).toBe(false);
    }
  });

  it('never coerces: a numeric-looking string is not a count', () => {
    // The bug this whole path exists for — settings is a text column, so '247'
    // is exactly what a careless caller holds.
    expect(isDiveCount('247')).toBe(false);
    expect(isDiveCount('')).toBe(false);
  });

  it('is the same rule assignDiveNumbers applies to its offset', () => {
    // Ties the predicate to the behaviour, so the two cannot drift apart the
    // way three hand-written copies could.
    const one = dive({ id: 'a' });
    for (const value of [247, 0, -1, 2.5, NaN, '247' as unknown as number]) {
      const numbers = assignDiveNumbers([one], value);
      expect(numbers.get('a')).toBe(isDiveCount(value) ? value + 1 : 1);
    }
  });
});
