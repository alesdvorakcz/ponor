import { router } from 'expo-router';

import { backToDives } from './backToDives';

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
it('pops the navigation stack when there is history to go back to', () => {
  mockCanGoBack.mockReturnValue(true);
  backToDives();
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('replaces to the dives list for a cold deep link with no history to pop', () => {
  mockCanGoBack.mockReturnValue(false);
  backToDives();
  expect(mockReplace).toHaveBeenCalledWith('/');
  expect(mockBack).not.toHaveBeenCalled();
});

// `replace`, never `push`: a cold deep-link launch must not land on `/` with a second Dives
// screen stacked under it. Asserted rather than left to the `toHaveBeenCalledWith` above,
// which a `push('/')` would satisfy just as well if the two were ever confused.
it('never pushes, so the fallback cannot grow the stack', () => {
  mockCanGoBack.mockReturnValue(false);
  backToDives();
  expect(mockPush).not.toHaveBeenCalled();
});
