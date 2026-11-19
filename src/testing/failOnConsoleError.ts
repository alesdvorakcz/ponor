import { format } from 'node:util';

/**
 * **A test that makes something print to `console.error` fails** (#61), unless it says it
 * expects that by replacing `console.error` itself (`jest.spyOn(console, 'error')
 * .mockImplementation(...)`, as the suites that provoke an error on purpose already do).
 *
 * Before this, React's "overlapping act() calls" and "not wrapped in act(...)" warnings sat in
 * a green run for weeks. The four tests they came from turned out to check what they claimed
 * (each was shown to fail with its guard removed), but §10 records the same kind of warning
 * marking tests that did not, and noise nothing fails on hides the next real warning.
 *
 * Installed for the whole run and never swapped out per test, so an error logged while a test
 * is being torn down, or between two tests, is not lost: it is reported at the next check, the
 * next test's or the file's own at the end.
 */
const original = console.error.bind(console);
const logged: string[] = [];

console.error = (...args: unknown[]) => {
  logged.push(format(...args));
  original(...args);
};

function reportLogged(): void {
  if (logged.length === 0) return;
  const lines = logged.splice(0).map((text) => `  • ${text.split('\n')[0]}`);
  throw new Error(
    'console.error was called during this test or since the last check. If the test means to ' +
      `provoke it, replace console.error in the test (jest.spyOn(...).mockImplementation).\n${lines.join('\n')}`,
  );
}

afterEach(reportLogged);
afterAll(reportLogged);
