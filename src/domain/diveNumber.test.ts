import { assignDiveNumbers, type DiveOrdering } from './diveNumber';

const dive = (over: Partial<DiveOrdering> & { id: string }): DiveOrdering => ({
  status: 'logged', date: '2026-08-16', timeIn: null,
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

  it('does not throw for two dives fully identical, including id', () => {
    const shared = {
      id: 'dup', status: 'logged' as const, date: '2026-08-16',
      timeIn: null, createdAt: '2026-08-16T10:00:00.000Z',
    };
    expect(() => assignDiveNumbers([{ ...shared }, { ...shared }], 0)).not.toThrow();
    // A duplicate id is a data-integrity bug outside this function's remit (id is
    // the primary key); the two entries collapse to one map entry under that
    // shared key rather than corrupting the numbering of anything else.
    const numbers = assignDiveNumbers([{ ...shared }, { ...shared }], 0);
    expect(numbers.size).toBe(1);
  });
});
