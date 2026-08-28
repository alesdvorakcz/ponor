module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/'],
  // Watchman's daemon cannot start in this environment (hangs indefinitely
  // and crashes Jest with an unhandled 'error' event). Not in the brief;
  // added because Jest is otherwise unusable here. See task-2-report.md.
  watchman: false,
};
