import { newId } from './ids';

describe('newId', () => {
  it('returns a canonical UUID string', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns version 7, so ids sort by creation time', () => {
    expect(newId()[14]).toBe('7');
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  it('sorts lexicographically in creation order', () => {
    const a = newId();
    const b = newId();
    expect([b, a].sort()).toEqual([a, b]);
  });
});
