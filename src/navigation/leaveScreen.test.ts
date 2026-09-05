import { router } from 'expo-router';

import { backToCenters, backToDives, backToMap, backToSettings, backToSites } from './leaveScreen';

// The same expo-router shape both screen tests already mock — `router` is a plain object of
// functions, so the whole module is replaced rather than any one method spied on.
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn(), push: jest.fn() },
}));

const mockCanGoBack = router.canGoBack as jest.Mock;
const mockBack = router.back as jest.Mock;
const mockReplace = router.replace as jest.Mock;
const mockPush = router.push as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// Both branches, at the owner rather than only through the two screens that call it —
// DiveDetailScreen.test.tsx pinned these through its own back control and DiveFormScreen's
// save path pins them again through the save, but neither of those would survive the rule
// moving house, and the rule now has a house of its own.
//
// Asked of BOTH exits, because what they share is the guard and what differs is one route:
// a `backToSettings` that quietly forgot the `canGoBack` check would pass every assertion
// written about `backToDives` alone.
const exits = [
  ['backToDives', backToDives, '/'],
  ['backToSettings', backToSettings, '/settings'],
  // The two M3c added: the centres directory sits on §3's Map tab, where the centre layer is,
  // and one centre's page sits on the directory. Each is here rather than only in the screen
  // that calls it, for the reason above — and each names a DIFFERENT route, which is what makes
  // the fallback assertion below able to fail at all.
  ['backToMap', backToMap, '/map'],
  ['backToCenters', backToCenters, '/centers'],
  // ...and the one M3f added: a site's page sits on the sites directory, which sits on the Map
  // beside the centres one. Both directories share `backToMap` rather than each getting an exit
  // of its own, because they are reached from one screen and land on it.
  ['backToSites', backToSites, '/sites'],
] as const;

it.each(exits)('%s pops the navigation stack when there is history to go back to', (_name, leave) => {
  mockCanGoBack.mockReturnValue(true);
  leave();
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

// The one thing the two exits differ in, and the reason the fallback is a parameter: a diver
// who deep-linked into the preset editor belongs back on Settings, where the preset list is,
// not on the logbook.
it.each(exits)('%s replaces to its own screen for a cold deep link with no history', (_name, leave, fallback) => {
  mockCanGoBack.mockReturnValue(false);
  leave();
  expect(mockReplace).toHaveBeenCalledWith(fallback);
  expect(mockBack).not.toHaveBeenCalled();
});

// `replace`, never `push`: a cold deep-link launch must not land on `/` with a second Dives
// screen stacked under it. Asserted rather than left to the `toHaveBeenCalledWith` above,
// which a `push('/')` would satisfy just as well if the two were ever confused.
it.each(exits)('%s never pushes, so the fallback cannot grow the stack', (_name, leave) => {
  mockCanGoBack.mockReturnValue(false);
  leave();
  expect(mockPush).not.toHaveBeenCalled();
});
