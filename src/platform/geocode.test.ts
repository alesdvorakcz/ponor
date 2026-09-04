import * as Location from 'expo-location';

import { countryFor, GEOCODE_TIMEOUT_MS } from './geocode';

/**
 * The one call this module makes to the device — the same split `location.test.ts` makes, and
 * for the same reason: the device is faked, the library's own vocabulary is not.
 */
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  reverseGeocodeAsync: jest.fn(),
}));

const mockGeocode = Location.reverseGeocodeAsync as jest.Mock;

/**
 * A placemark shaped like the library's own — every field of `LocationGeocodedAddress`, not
 * the one this module reads. A fixture holding only `isoCountryCode` would agree with the code
 * rather than with the device, and would hide the whole reason the code is preferred over the
 * localized `country` name sitting right beside it.
 */
function placemark(isoCountryCode: string | null, country: string | null = 'Croatia') {
  return {
    city: 'Split',
    district: null,
    streetNumber: null,
    street: null,
    region: null,
    subregion: null,
    country,
    postalCode: null,
    name: null,
    isoCountryCode,
    timezone: null,
    formattedAddress: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGeocode.mockResolvedValue([placemark('HR')]);
});

afterEach(() => {
  jest.useRealTimers();
});

it('infers the country from the point, as an ISO alpha-2 code', async () => {
  await expect(countryFor(43.5081, 16.4402)).resolves.toBe('HR');
  expect(mockGeocode).toHaveBeenCalledWith({ latitude: 43.5081, longitude: 16.4402 });
});

// The whole reason `isoCountryCode` is read rather than `country`: the name beside it is
// localized, so a Czech phone and a British one would file the same site under two countries.
// The fixture holds a name that is NOT the code's, so a module reading the wrong field fails
// on the value rather than merely on a shape.
it('takes the code and not the localized country name beside it', async () => {
  mockGeocode.mockResolvedValue([placemark('HR', 'Chorvatsko')]);
  await expect(countryFor(43.5081, 16.4402)).resolves.toBe('HR');
});

it('upper-cases the code, so one country is one value in a shared column', async () => {
  mockGeocode.mockResolvedValue([placemark('hr')]);
  await expect(countryFor(43.5081, 16.4402)).resolves.toBe('HR');
});

// §6 already allows a null country; it does not allow two vocabularies in one column. An
// alpha-3 code or a display name arriving from some platform is refused rather than stored.
it.each([['HRV'], ['Croatia'], [''], ['H'], ['H1']])('refuses %p, which is not an alpha-2 code', async (raw) => {
  mockGeocode.mockResolvedValue([placemark(raw)]);
  await expect(countryFor(43.5081, 16.4402)).resolves.toBeNull();
});

it('answers null for a placemark that carries no code at all', async () => {
  mockGeocode.mockResolvedValue([placemark(null)]);
  await expect(countryFor(43.5081, 16.4402)).resolves.toBeNull();
});

it('answers null when the geocoder knows of no place there, which is most of the ocean', async () => {
  mockGeocode.mockResolvedValue([]);
  await expect(countryFor(0, -140)).resolves.toBeNull();
});

// The offline case, which is the one this whole module was written around: a site created on
// a boat gets no country, keeps its pin, and nothing throws into the gesture that created it.
it('answers null when the geocoder rejects, and never throws', async () => {
  mockGeocode.mockRejectedValue(new Error('no network'));
  await expect(countryFor(43.5081, 16.4402)).resolves.toBeNull();
});

// The rule in one sentence: country is inferred FROM THE POINT. Asserted on the platform call
// as well as on the answer, because a module that asked a geocoder about a missing coordinate
// would be the one that could invent a country from somewhere else.
it.each([
  [null, 16.4402],
  [43.5081, null],
  [null, null],
])('asks nothing and answers null with no pin (%p, %p)', async (latitude, longitude) => {
  await expect(countryFor(latitude, longitude)).resolves.toBeNull();
  expect(mockGeocode).not.toHaveBeenCalled();
});

it('asks nothing for a coordinate that is not a finite number', async () => {
  await expect(countryFor(Number.NaN, 16.4402)).resolves.toBeNull();
  expect(mockGeocode).not.toHaveBeenCalled();
});

// A geocoder that never answers must not hold the diver on a control that has gone quiet —
// the same rule `POSITION_TIMEOUT_MS` states for the receiver, at the length one HTTP round
// trip deserves rather than the length a cold GPS fix does.
it('gives up after GEOCODE_TIMEOUT_MS and answers null', async () => {
  jest.useFakeTimers();
  mockGeocode.mockReturnValue(new Promise(() => {}));
  const answer = countryFor(43.5081, 16.4402);
  await jest.advanceTimersByTimeAsync(GEOCODE_TIMEOUT_MS);
  await expect(answer).resolves.toBeNull();
});

it('waits for an answer that arrives inside the timeout', async () => {
  jest.useFakeTimers();
  mockGeocode.mockReturnValue(
    new Promise((resolve) => {
      setTimeout(() => resolve([placemark('HR')]), GEOCODE_TIMEOUT_MS - 1);
    }),
  );
  const answer = countryFor(43.5081, 16.4402);
  await jest.advanceTimersByTimeAsync(GEOCODE_TIMEOUT_MS - 1);
  await expect(answer).resolves.toBe('HR');
});
