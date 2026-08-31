import { render } from '@testing-library/react-native';
import { View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from './unexpectedGraphics';

// The guard has a test of its own now, which is the other half of it having one owner: five
// test files lean on it to enforce DESIGN.md §0.4 and §0.1, and until this file existed the
// only thing checking the guard was the guard.
//
// Every case below is a real shape from this app, not an invented one. `styles.formField` and
// `styles.floatingRow` are entries `makeStyles` actually hands out; the composed arrays are
// how React Native styles are written everywhere in `src/`.
//
// Each subject is rendered as the tree's own root deliberately: `queryAll` walks descendants
// only, so the root was the one node the guard could never see, and these cases would all
// have passed vacuously against the version that only looked below it.

const styles = makeStyles('light');

it('catches a literal composed beside a known style — the only shape anyone writes', async () => {
  // The defect this file exists for. The old check was `!style.some((s) => known.includes(s))`
  // — flag a View only when NONE of its entries is known — so one known style excused every
  // literal beside it, and this exact array passed. A dropped-in chart, a fill, or an accent
  // arrives precisely like this, because RN styles compose as arrays.
  const t = await render(<View style={[styles.formField, { backgroundColor: '#ff0000' }]} />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('still catches a bare literal with nothing known beside it', async () => {
  const t = await render(<View style={{ backgroundColor: '#ff0000' }} />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('passes a View wearing only styles the sheet handed out', async () => {
  const t = await render(<View style={[styles.formField, styles.formFieldFocused]} />);
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

it('passes an unstyled View, so the guard is not simply flagging everything', async () => {
  const t = await render(<View />);
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

it('passes a device measurement composed in locally, which cannot live in a scheme-only sheet', async () => {
  // `DiveFormScreen`'s footer and `DivesScreen`'s floating row both compose a safe-area inset
  // this way, and both say why where they are written. Without this the fixed guard would
  // report two correct screens and the fix would be reverted rather than kept.
  const t = await render(<View style={[styles.floatingRow, { bottom: 34 }]} />);
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

it('does not let a geometry key smuggle a colour in beside it', async () => {
  // The allowlist is per KEY, and every key on the object has to be in it — otherwise
  // `{ bottom: 34, backgroundColor: '#ff0000' }` would ride in on the exemption above.
  const t = await render(<View style={[styles.floatingRow, { bottom: 34, backgroundColor: '#ff0000' }]} />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('catches an element that names what it draws, whatever it is styled with', async () => {
  // The guard's other half: react-native-svg is not a dependency, so nothing under `src/`
  // can render one today — which is exactly why this arm needs a test that does not depend
  // on the app happening to contain one. A component simply named for the thing it draws is
  // the realistic case (Chart, Sparkline, Profile).
  const Sparkline = 'Sparkline' as unknown as typeof View;
  const t = await render(<Sparkline />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('reads the scheme it is given, so a screen test compares against the sheet that rendered', async () => {
  // `useColorScheme()` reports light under Jest, so a screen test handed the dark sheet would
  // find none of its own styles known and report the whole tree — which is why `scheme` is a
  // required argument rather than a default.
  const t = await render(<View style={makeStyles('dark').formField} />);
  expect(unexpectedGraphics(t, 'dark')).toEqual([]);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});
