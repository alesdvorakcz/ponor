import { depthBand, depthColor } from './depth';

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
