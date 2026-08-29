module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/'],
  // Watchman's daemon cannot start on this machine, and Metro/Jest's probe
  // for it has no timeout, so it hangs indefinitely and crashes Jest with
  // an unhandled 'error' event. Not in the brief; added because Jest is
  // otherwise unusable here.
  watchman: false,
};
