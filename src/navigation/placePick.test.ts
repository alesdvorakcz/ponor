import { router } from 'expo-router';

import {
  completePlacePick,
  firstParam,
  forgetPlacePick,
  openPlacePicker,
  placePickRequest,
  type PlacePickRequest,
} from './placePick';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), dismiss: jest.fn() },
}));

const mockPush = router.push as jest.Mock;
const mockDismiss = router.dismiss as jest.Mock;

const dive = { pin: null, entry: null, salinity: null, waterBody: null, siteId: null, diveId: null };

function request(kind: PlacePickRequest['kind'] = 'site'): PlacePickRequest & { onPick: jest.Mock } {
  return { kind, selected: null, dive, onPick: jest.fn() };
}

/** The token `openPlacePicker` handed to the router — the only way a screen ever learns it. */
function pushedToken(): string {
  return mockPush.mock.calls[mockPush.mock.calls.length - 1][0].params.token;
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('open registers the request under a fresh token and pushes the picker for its kind', () => {
  const site = request('site');
  const center = request('center');
  openPlacePicker(site);
  const siteToken = pushedToken();
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/pick/site', params: { token: siteToken } });
  openPlacePicker(center);
  const centerToken = pushedToken();
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/pick/center', params: { token: centerToken } });
  expect(centerToken).not.toBe(siteToken);
  expect(placePickRequest(siteToken)).toBe(site);
  expect(placePickRequest(centerToken)).toBe(center);
});

it('complete hands the pick to onPick once, forgets the token and closes the given number of screens', () => {
  const req = request();
  openPlacePicker(req);
  const token = pushedToken();
  completePlacePick(token, { id: 'a', name: 'Blue Hole' }, 2);
  expect(req.onPick).toHaveBeenCalledTimes(1);
  expect(req.onPick).toHaveBeenCalledWith({ id: 'a', name: 'Blue Hole' });
  expect(placePickRequest(token)).toBeNull();
  expect(mockDismiss).toHaveBeenCalledWith(2);
});

// *Use this site* on a near-match's page: that page, the create page under it and the picker.
it('closes three screens from a site page stacked on the create page', () => {
  const req = request();
  openPlacePicker(req);
  completePlacePick(pushedToken(), { id: 'a', name: 'Blue Hole' }, 3);
  expect(req.onPick).toHaveBeenCalledWith({ id: 'a', name: 'Blue Hole' });
  expect(mockDismiss).toHaveBeenCalledWith(3);
});

// A second dismiss would pop the dive form under the picker and lose the half-typed dive.
it('a second complete for the same token does nothing at all — one onPick, one dismiss', () => {
  const req = request();
  openPlacePicker(req);
  const token = pushedToken();
  completePlacePick(token, { id: 'a', name: 'A' }, 1);
  completePlacePick(token, { id: 'b', name: 'B' }, 1);
  expect(req.onPick).toHaveBeenCalledTimes(1);
  expect(req.onPick).toHaveBeenCalledWith({ id: 'a', name: 'A' });
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

// A JS reload under an open picker: the registry never saw this token, and the diver must be put
// back on the form rather than left on a picker that can do nothing.
it('an unknown token completes without throwing and still closes', () => {
  expect(() => completePlacePick('nope', { id: null, name: '' }, 2)).not.toThrow();
  expect(mockDismiss).toHaveBeenCalledWith(2);
});

it('forget drops the request', () => {
  openPlacePicker(request());
  const token = pushedToken();
  forgetPlacePick(token);
  expect(placePickRequest(token)).toBeNull();
});

// A pick that lands while ‹ Cancel is already taking the page away.
it('a complete after forget delivers nothing and closes nothing', () => {
  const req = request();
  openPlacePicker(req);
  const token = pushedToken();
  forgetPlacePick(token);
  completePlacePick(token, { id: 'a', name: 'A' }, 1);
  expect(req.onPick).not.toHaveBeenCalled();
  expect(mockDismiss).not.toHaveBeenCalled();
});

it('closes the screens even when onPick throws, and lets the error through', () => {
  const req = request();
  req.onPick.mockImplementation(() => {
    throw new Error('form refused');
  });
  openPlacePicker(req);
  const token = pushedToken();
  expect(() => completePlacePick(token, { id: 'a', name: 'A' }, 2)).toThrow('form refused');
  expect(mockDismiss).toHaveBeenCalledWith(2);
  completePlacePick(token, { id: 'a', name: 'A' }, 2);
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

it('firstParam reads a route param sent as one string or as several', () => {
  expect(firstParam('a')).toBe('a');
  expect(firstParam(['a', 'b'])).toBe('a');
  expect(firstParam(undefined)).toBeUndefined();
});
