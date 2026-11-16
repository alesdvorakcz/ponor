import { distanceKm } from './geo';

describe('distanceKm', () => {
  it('is zero from a point to itself', () => {
    expect(distanceKm({ latitude: 43.06, longitude: 16.18 }, { latitude: 43.06, longitude: 16.18 })).toBe(0);
  });

  it('is one degree of longitude on the equator, about 111.19 km', () => {
    expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111.19, 1);
  });

  it('puts Komiža about 7.6 km from Vis', () => {
    const vis = { latitude: 43.06, longitude: 16.18 };
    const komiza = { latitude: 43.04, longitude: 16.09 };
    expect(Math.abs(distanceKm(vis, komiza) - 7.6)).toBeLessThan(0.2);
  });

  it('is the same in either direction', () => {
    const a = { latitude: 43.06, longitude: 16.18 };
    const b = { latitude: 28.51, longitude: 34.51 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
  });
});
