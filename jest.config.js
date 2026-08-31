module.exports = {
  preset: 'jest-expo',
  // `.superpowers/` is this repo's gitignored scratch space, and agents working here write
  // probe files into it. Jest sweeps the whole tree, so a scratch `*.test.ts` there turns
  // `npm test` red over code that is not part of the app and is not even committed — which
  // has already happened once mid-session. Ignored alongside the build outputs for the same
  // reason: none of it is source.
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/', '/.superpowers/'],
  // Watchman's daemon cannot start on this machine, and Metro/Jest's probe
  // for it has no timeout, so it hangs indefinitely and crashes Jest with
  // an unhandled 'error' event. Not in the brief; added because Jest is
  // otherwise unusable here.
  watchman: false,
};
