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

// The stack a FlatList's own render batch logs from, as a run printed it: nothing of the
// project's, and React's frames first. The library that set the state is the one to name.
it('names the first library past React itself when only libraries are on the stack', () => {
  expect(
    callerOf(
      stack(
        `console.error (${wrapper}:30:3)`,
        '/repo/node_modules/react-reconciler/cjs/react-reconciler.development.js:16307:19',
        'warnIfUpdatesNotWrappedWithActDEV (/repo/node_modules/react-reconciler/cjs/react-reconciler.development.js:16306:9)',
        'Component.setState (/repo/node_modules/react/cjs/react.development.js:655:20)',
        '/repo/node_modules/@babel/runtime/helpers/superPropGet.js:6:14',
        'VirtualizedList.setState (/repo/node_modules/@react-native/virtualized-lists/Lists/StateSafePureComponent.js:40:7)',
        'listOnTimeout (node:internal/timers:588:17)',
      ),
      root,
    ),
  ).toBe('node_modules/@react-native/virtualized-lists/Lists/StateSafePureComponent.js:40:7');
});

it('falls back to the first frame past its wrapper when React alone is on the stack', () => {
  expect(
    callerOf(
      stack(
        `console.error (${wrapper}:30:3)`,
        'popActScope (/repo/node_modules/react/cjs/react.development.js:800:13)',
        'listOnTimeout (node:internal/timers:588:17)',
      ),
      root,
    ),
  ).toBe('node_modules/react/cjs/react.development.js:800:13');
});

it('reads a frame with no function name, and a path with a space in it', () => {
  expect(callerOf(stack(`${wrapper}:30:3`, '/repo/My Dives/src/a.ts:2:11'), root)).toBe('My Dives/src/a.ts:2:11');
});

it('names nothing when no frame has a location', () => {
  expect(callerOf(stack(`console.error (${wrapper}:30:3)`, 'new Promise (<anonymous>)'), root)).toBeUndefined();
  expect(callerOf(undefined, root)).toBeUndefined();
});
