module.exports = {
  preset: 'jest-expo',
  // `.superpowers/` is this repo's gitignored scratch space, and agents working here write
  // probe files into it. Jest sweeps the whole tree, so a scratch `*.test.ts` there turns
  // `npm test` red over code that is not part of the app and is not even committed — which
  // has already happened once mid-session. Ignored alongside the build outputs for the same
  // reason: none of it is source.
  //
  // `.claude/` holds other sessions' git worktrees (`.claude/worktrees/<name>`), each a full copy
  // of the repo with its own `node_modules` (#33). Their tests are not this checkout's, and
  // ignoring them is not enough on its own: each worktree's root `__mocks__/` is another manual
  // mock for the same package, Jest may resolve to a worktree's copy, and that copy imports a
  // second React — the app's own map suites then fail with a null `useRef`. So `.claude/` leaves
  // the module map too. Both are anchored at `<rootDir>`: inside a worktree every path contains
  // `/.claude/`, and an unanchored pattern would ignore all of that worktree's own tests.
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/', '/.superpowers/', '<rootDir>/\\.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/\\.claude/'],
  // Watchman's daemon cannot start on this machine, and Metro/Jest's probe
  // for it has no timeout, so it hangs indefinitely and crashes Jest with
  // an unhandled 'error' event. Not in the brief; added because Jest is
  // otherwise unusable here.
  watchman: false,
  // A test that prints to console.error fails (#61); see the file for why and how a test that
  // means to provoke one says so.
  setupFilesAfterEnv: ['<rootDir>/src/testing/failOnConsoleError.ts'],
};
