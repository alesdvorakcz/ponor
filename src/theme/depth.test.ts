import { depthBand, depthColor, depthColorOrNull } from './depth';

describe('depthBand', () => {
  it('puts a surface dive in band 1', () => {
    expect(depthBand(0)).toBe(1);
  });

  it('puts a shallow dive in band 1', () => {
    expect(depthBand(4.5)).toBe(1);
  });

  it('treats a boundary depth as belonging to the shallower band', () => {
    expect(depthBand(6)).toBe(1);
    expect(depthBand(6.1)).toBe(2);
    expect(depthBand(20)).toBe(3);
    expect(depthBand(20.1)).toBe(4);
  });

  it('puts anything past 40 m in band 6', () => {
    expect(depthBand(40)).toBe(5);
    expect(depthBand(40.1)).toBe(6);
    expect(depthBand(120)).toBe(6);
  });

  it('rejects a negative depth', () => {
    expect(() => depthBand(-1)).toThrow(RangeError);
  });

  it('rejects a depth that is not a finite number', () => {
    expect(() => depthBand(Number.NaN)).toThrow(RangeError);
  });
});

describe('depthColor', () => {
  it('returns the dark colour for the band', () => {
    expect(depthColor(32.4, 'dark')).toBe('#2E9BE0');
  });

  it('returns the light colour for the same band', () => {
    expect(depthColor(32.4, 'light')).toBe('#0B76B8');
  });

  it('colours a quarry dive differently from a deep reef dive', () => {
    expect(depthColor(14.8, 'dark')).toBe('#F5CE3E');
    expect(depthColor(41.0, 'dark')).toBe('#6673E4');
  });
});

// M1's dive fields are all nullable except the date, and an empty numeric form field
// parses to NaN (`parseFloat('') === NaN`). A list row cannot let that reach
// `depthColor` and throw during render, but `depthColor`/`depthBand`'s throw-on-invalid
// contract is correct and stays as-is (see the `depthColor`/`depthBand` suites above) —
// this is the null-safe entry point a render path should call instead.
describe('depthColorOrNull', () => {
  it('returns null for a null depth', () => {
    expect(depthColorOrNull(null, 'dark')).toBeNull();
  });

  it('returns null for an undefined depth', () => {
    expect(depthColorOrNull(undefined, 'dark')).toBeNull();
  });

  it('returns null for NaN, as parseFloat gives an empty numeric field', () => {
    expect(depthColorOrNull(Number.NaN, 'dark')).toBeNull();
  });

  it('returns null for a negative depth', () => {
    expect(depthColorOrNull(-1, 'dark')).toBeNull();
  });

  it('returns null for a non-finite depth', () => {
    expect(depthColorOrNull(Number.POSITIVE_INFINITY, 'dark')).toBeNull();
    expect(depthColorOrNull(Number.NEGATIVE_INFINITY, 'dark')).toBeNull();
  });

  it('returns the same colour depthColor would for a valid depth, in both schemes', () => {
    expect(depthColorOrNull(32.4, 'dark')).toBe(depthColor(32.4, 'dark'));
    expect(depthColorOrNull(32.4, 'light')).toBe(depthColor(32.4, 'light'));
  });
});
