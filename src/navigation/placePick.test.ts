import { router } from 'expo-router';

import {
  completePlacePick,
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

const dive = { pin: null, entry: null, salinity: null, waterBody: null, siteId: null };

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

it('a second complete for the same token does nothing but close', () => {
  const req = request();
  openPlacePicker(req);
  const token = pushedToken();
  completePlacePick(token, { id: 'a', name: 'A' }, 1);
  completePlacePick(token, { id: 'b', name: 'B' }, 1);
  expect(req.onPick).toHaveBeenCalledTimes(1);
  expect(mockDismiss).toHaveBeenCalledTimes(2);
});

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
