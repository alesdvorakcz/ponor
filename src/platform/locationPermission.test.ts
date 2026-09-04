import * as Location from 'expo-location';

import { LOCATION_PERMISSION_STATES, locationPermission, requestLocationPermission } from './locationPermission';

/**
 * **The three calls this module makes, and nothing else** — `Accuracy`, `PermissionStatus` and
 * every other value expo-location exports stay the library's own, exactly as
 * `cloud/auth.test.ts` keeps `@supabase/supabase-js`'s real error classes rather than
 * hand-making objects that agree with the code by construction. What is faked here is the
 * device, which a test machine does not have; what is not faked is the vocabulary the answers
 * are spelled in.
 */
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));

const mockServices = Location.hasServicesEnabledAsync as jest.Mock;
const mockRead = Location.getForegroundPermissionsAsync as jest.Mock;
const mockRequest = Location.requestForegroundPermissionsAsync as jest.Mock;

/**
 * One of expo-location's own permission answers, built from `PermissionStatus` rather than
 * from a string literal — so a test cannot assert against a status spelling the library does
 * not use. `granted` is the library's own convenience boolean and is derived here exactly as
 * the library derives it, which is what makes "the module reads `granted`" a real claim.
 */
function permissionResponse(status: Location.PermissionStatus, canAskAgain = true) {
  return {
    status,
    granted: status === Location.PermissionStatus.GRANTED,
    canAskAgain,
    expires: 'never' as const,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockServices.mockResolvedValue(true);
  mockRead.mockResolvedValue(permissionResponse(Location.PermissionStatus.GRANTED));
  mockRequest.mockResolvedValue(permissionResponse(Location.PermissionStatus.GRANTED));
});

describe('reading the standing answer', () => {
  it('never raises a prompt, which is the whole reason it is separate from asking', async () => {
    // §3's Settings row shows what the permission currently is, and iOS spends its one sheet
    // on whoever asks first — so a screen that "checked" by requesting would burn the diver's
    // one prompt on a row they were only looking at. This is that guarantee, and it is the
    // one assertion in this file that would still pass if the return value were wrong, so it
    // is stated alongside the value rather than instead of it.
    mockRead.mockResolvedValue(permissionResponse(Location.PermissionStatus.UNDETERMINED));
    expect(await locationPermission()).toBe('undetermined');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([
    [Location.PermissionStatus.GRANTED, 'granted'],
    [Location.PermissionStatus.DENIED, 'denied'],
    [Location.PermissionStatus.UNDETERMINED, 'undetermined'],
  ])('reads %s back as %s', async (status, expected) => {
    mockRead.mockResolvedValue(permissionResponse(status));
    expect(await locationPermission()).toBe(expected);
  });

  it('reports services being off ahead of the permission, even a granted one', async () => {
    // The ordering rule, in the direction that proves it is a rule: the app IS allowed, and
    // the honest answer is still that the device cannot locate anyone. A module that read the
    // permission first would answer `granted` here and send a Settings row to describe a
    // switch that is not the one in the diver's way.
    mockServices.mockResolvedValue(false);
    mockRead.mockResolvedValue(permissionResponse(Location.PermissionStatus.GRANTED));
    expect(await locationPermission()).toBe('servicesOff');
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('says it does not know when the query itself fails, rather than reporting a refusal', async () => {
    // `unknown` is not `denied`: nobody refused anything, and a screen that said "you have
    // denied this" would send the diver to change a setting they may already have set.
    mockRead.mockRejectedValue(new Error('no module'));
    expect(await locationPermission()).toBe('unknown');
  });

  it('says it does not know when the services query itself fails', async () => {
    mockServices.mockRejectedValue(new Error('no module'));
    expect(await locationPermission()).toBe('unknown');
  });
});

describe('asking for it', () => {
  it('raises the request, and reads the answer the diver gave', async () => {
    mockRequest.mockResolvedValue(permissionResponse(Location.PermissionStatus.DENIED, false));
    expect(await requestLocationPermission()).toBe('denied');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('never asks on a device whose Location Services are off', async () => {
    // The rule iOS's one-sheet-ever behaviour makes load-bearing: a grant cannot produce a fix
    // while the device switch is off, so spending the prompt there leaves the diver with a
    // permission they cannot use and no sheet left once they turn the switch back on.
    mockServices.mockResolvedValue(false);
    expect(await requestLocationPermission()).toBe('servicesOff');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('asks again after a refusal, rather than remembering one', async () => {
    // The dead-control rule at this layer. On Android and on the web the next tap can really
    // be granted, and a diver who allowed it in the device's Settings and came back must get a
    // pin without reopening the form — so this module caches nothing, and the second call is a
    // real second ask.
    mockRequest.mockResolvedValueOnce(permissionResponse(Location.PermissionStatus.DENIED, false));
    expect(await requestLocationPermission()).toBe('denied');
    mockRequest.mockResolvedValueOnce(permissionResponse(Location.PermissionStatus.GRANTED));
    expect(await requestLocationPermission()).toBe('granted');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('says it does not know when the request itself fails', async () => {
    mockRequest.mockRejectedValue(new Error('no module'));
    expect(await requestLocationPermission()).toBe('unknown');
  });
});

it('answers with a state it declares, on every path either function has', async () => {
  // The completeness half, and the reason `LOCATION_PERMISSION_STATES` is a list rather than a
  // bare union: a sixth answer invented inside either function — a typo'd `'granted '`, a
  // `'blocked'` borrowed from another platform's vocabulary — would be read by two screens and
  // matched by neither, silently. Every branch above is driven again here through both entry
  // points, so this sweeps the module rather than one call.
  const paths: (() => void)[] = [
    () => mockServices.mockResolvedValue(false),
    () => mockRead.mockResolvedValue(permissionResponse(Location.PermissionStatus.GRANTED)),
    () => mockRead.mockResolvedValue(permissionResponse(Location.PermissionStatus.DENIED)),
    () => mockRead.mockResolvedValue(permissionResponse(Location.PermissionStatus.UNDETERMINED)),
    () => mockRead.mockRejectedValue(new Error('no module')),
    () => mockRequest.mockResolvedValue(permissionResponse(Location.PermissionStatus.DENIED)),
    () => mockRequest.mockRejectedValue(new Error('no module')),
  ];
  const answers = new Set<string>();
  for (const arrange of paths) {
    jest.clearAllMocks();
    mockServices.mockResolvedValue(true);
    mockRead.mockResolvedValue(permissionResponse(Location.PermissionStatus.GRANTED));
    mockRequest.mockResolvedValue(permissionResponse(Location.PermissionStatus.GRANTED));
    arrange();
    answers.add(await locationPermission());
    answers.add(await requestLocationPermission());
  }
  for (const answer of answers) expect(LOCATION_PERMISSION_STATES).toContain(answer);
  // ...and the sweep really reached every state, so "they are all declared" is not a claim
  // about two of five.
  expect([...answers].sort()).toEqual([...LOCATION_PERMISSION_STATES].sort());
});
