import { join } from 'node:path';

import { callerOf } from './failOnConsoleError';

// Where the check says a logged error came from (#61's review). The guard wraps `console.error`,
// so the frame Jest itself shows is the wrapper's; the check's own report names the caller.

const root = '/repo';
const wrapper = join(__dirname, 'failOnConsoleError.ts');

const stack = (...frames: string[]) => ['Error', ...frames.map((frame) => `    at ${frame}`)].join('\n');

it('names the first frame in the project, past its own wrapper and the libraries that logged', () => {
  expect(
    callerOf(
      stack(
        `console.error (${wrapper}:30:3)`,
        'warnIfUpdatesNotWrappedWithActDEV (/repo/node_modules/react-test-renderer/cjs/a.js:10:5)',
        'dispatchSetState (/repo/node_modules/react-test-renderer/cjs/a.js:20:7)',
        'ask (/repo/src/hooks/useCatalogueSupplement.ts:146:31)',
        'Object.<anonymous> (/repo/src/screens/PlacePickerScreen.test.tsx:9:1)',
      ),
      root,
    ),
  ).toBe('src/hooks/useCatalogueSupplement.ts:146:31');
});

it('falls back to the first frame past its wrapper when only libraries are on the stack', () => {
  expect(
    callerOf(
      stack(
        `console.error (${wrapper}:30:3)`,
        'Timeout._updateCellsToRender [as _onTimeout] (/repo/node_modules/@react-native/virtualized-lists/Lists/VirtualizedList.js:1806:16)',
        'listOnTimeout (node:internal/timers:588:17)',
      ),
      root,
    ),
  ).toBe('node_modules/@react-native/virtualized-lists/Lists/VirtualizedList.js:1806:16');
});

it('reads a frame with no function name, and a path with a space in it', () => {
  expect(callerOf(stack(`${wrapper}:30:3`, '/repo/My Dives/src/a.ts:2:11'), root)).toBe('My Dives/src/a.ts:2:11');
});

it('names nothing when no frame has a location', () => {
  expect(callerOf(stack(`console.error (${wrapper}:30:3)`, 'new Promise (<anonymous>)'), root)).toBeUndefined();
  expect(callerOf(undefined, root)).toBeUndefined();
});
