import { cleanup } from '@testing-library/react-native/pure';
import { relative, sep } from 'node:path';
import { format } from 'node:util';

/**
 * **A test that makes something print to `console.error` fails** (#61).
 *
 * Before this, React's "overlapping act() calls" and "not wrapped in act(...)" warnings sat in
 * a green run for weeks. The four tests they came from turned out to check what they claimed
 * (each was shown to fail with its guard removed), but §10 records the same kind of warning
 * marking tests that did not, and noise nothing fails on hides the next real warning.
 *
 * - **A test that asserts nothing was logged needs no spy of its own**: this check is that
 *   assertion, for every test. To assert about one message by name, spy without replacing
 *   (`jest.spyOn(console, 'error')`, restored in `finally`), so every message still reaches here.
 * - **A test that means to provoke an error** replaces `console.error` for itself
 *   (`.mockImplementation`, restored in `finally`) and then asserts on every call, since the
 *   replacement hides the ones it did not expect from this check. No test does today.
 *
 * **What a test rendered is unmounted before anything else, then the check runs.** Testing
 * Library's own cleanup waits a tick *before* it unmounts, outside `act()`, and any timer due in
 * that tick updated the screen outside `act()`: a FlatList's 50 ms render batch, or a search's
 * `setTimeout(0)`. Only a busy run made one due in time, so the check would have turned CI red
 * now and then over a test that checked what it claimed (it did, once, on #61's branch). So the
 * hook below calls the same `cleanup` first thing, from Testing Library's `pure` entry, which
 * registers no hooks of its own. Nothing runs between a test's end and that unmount, so whatever
 * the test left pending goes with the screen. Then one tick, as Testing Library's cleanup takes,
 * so that anything else the test left due logs before the check that blames this test and not
 * the next. Testing Library's own `afterEach`, declared later when the test file imports it,
 * then finds nothing left to unmount.
 *
 * Installed for the whole run and never swapped out per test, so an error logged between two
 * tests is not lost: it is reported at the next check, the next test's or the file's own at
 * the end. Each line of the report names where the error was logged from (`callerOf`), because
 * Jest's own printout of the message points at the wrapper below.
 */

type Logged = { text: string; at: string | undefined };

const framed = /\((.+:\d+:\d+)\)$/;
const bare = /^\s*at (.+:\d+:\d+)$/;
const library = `${sep}node_modules${sep}`;
const reactItself = /[\\/]node_modules[\\/](react|react-reconciler|react-test-renderer|test-renderer|scheduler|@babel[\\/]runtime)[\\/]/;

/**
 * **Where a `console.error` came from**, read off a stack taken inside the wrapper: the first
 * frame in the project, past this file and anything under `node_modules`. React logs its
 * warnings from inside itself, and the frame worth naming is the app's code that set the state.
 * When only libraries are on the stack (a list's own timer), the first one past React itself,
 * and failing that the first frame past this file.
 */
export function callerOf(stack: string | undefined, root = process.cwd()): string | undefined {
  const frames = (stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => (framed.exec(line) ?? bare.exec(line))?.[1])
    .filter((at): at is string => at !== undefined && !at.startsWith(`${__filename}:`) && !at.startsWith('node:'));
  const at =
    frames.find((frame) => !frame.includes(library)) ??
    frames.find((frame) => !reactItself.test(frame)) ??
    frames[0];
  if (at === undefined) return undefined;
  return at.startsWith(root + sep) ? relative(root, at) : at;
}

const original = console.error.bind(console);
const logged: Logged[] = [];
// Taken before any test can fake the timers.
const realSetImmediate = setImmediate;

console.error = (...args: unknown[]) => {
  // Deep enough to get past React's own frames to the code that called it.
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const stack = new Error().stack;
  Error.stackTraceLimit = limit;
  logged.push({ text: format(...args), at: callerOf(stack) });
  original(...args);
};

function reportLogged(): void {
  if (logged.length === 0) return;
  // The place goes on the message's own line: a line of its own starting `at` is read by Jest as
  // a frame of this check's stack, and printed under it.
  const lines = logged
    .splice(0)
    .map(({ text, at }) => `  • ${text.split('\n')[0]}${at === undefined ? '' : `  (from ${at})`}`);
  throw new Error(
    'console.error was called during this test or since the last check. A test that means to ' +
      `provoke it replaces console.error itself and asserts on every call (see failOnConsoleError.ts).\n${lines.join('\n')}`,
  );
}

afterEach(async () => {
  await cleanup();
  await new Promise((done) => realSetImmediate(done));
  reportLogged();
});
afterAll(reportLogged);
