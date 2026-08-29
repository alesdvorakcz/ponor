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
