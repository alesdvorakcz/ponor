import { render } from '@testing-library/react-native';
import { Image, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { depthScale } from '../theme/tokens';
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
  // `DiveFormScreen`'s footer composes a safe-area inset exactly this way, and says why where
  // it is written. Without this the fixed guard would report a correct screen and the fix
  // would be reverted rather than kept.
  //
  // `styles.formFooter` replaces `styles.floatingRow` here, which was this case's other real
  // example until DESIGN.md §3's note moved that row to the top of the screen, where the
  // clearance it needs is `screen`'s own static `paddingTop` and no inset is composed in at
  // all. Swapped rather than left pointing at a key `makeStyles` no longer hands out: with
  // `undefined` in its place both this test and the one below still PASSED — the guard simply
  // saw one style instead of two — so the composed-beside-a-known-style half of each stopped
  // being exercised while both stayed green. Caught by `tsc`, which is the only thing that
  // could catch it.
  const t = await render(<View style={[styles.formFooter, { paddingBottom: 34 }]} />);
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

it('does not let a geometry key smuggle a colour in beside it', async () => {
  // The allowlist is per KEY, and every key on the object has to be in it — otherwise
  // `{ paddingBottom: 34, backgroundColor: '#ff0000' }` would ride in on the exemption above.
  const t = await render(<View style={[styles.formFooter, { paddingBottom: 34, backgroundColor: '#ff0000' }]} />);
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

// ---------------------------------------------------------------------------------------
// **The two exemptions M1h's first-run screen added**, each named rather than opened as a
// category. Both arms need cases that FAIL as well as cases that pass: an exemption written
// as "an Image is fine" or "a background colour is fine" is the guard switched off, and it
// would look identical from the passing side.
// ---------------------------------------------------------------------------------------

const DEPTH_1 = depthScale.light[0];

it('passes the one graphic the app draws — the mark, wearing the style that paints it', async () => {
  // `EmptyState`'s own Image, exactly as it is written. Its tint and its half strength live in
  // `emptyStateMark`, which is what makes DESIGN.md §0.1 enforceable there in one edit.
  const t = await render(<Image source={{ uri: 'x' }} style={styles.emptyStateMark} />);
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

it('still catches a second image, however innocently styled', async () => {
  // A photo, a chart exported as a PNG, an illustration. v1.1 brings photos (§10) and they
  // arrive with their own decision about §0.4 — which is the point of matching the mark by
  // name: that decision has to be made here, deliberately, rather than inherited.
  const t = await render(<Image source={{ uri: 'x' }} style={styles.formField} />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('catches an unstyled image, which would otherwise ride in on the View rule', async () => {
  // A `View` with no style at all passes, and must — see above. An `Image` with none is a
  // bitmap nobody decided anything about, so the two rules differ here on purpose.
  const t = await render(<Image source={{ uri: 'x' }} />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('catches the mark with a tint composed over it, which is where §0.1 would actually break', async () => {
  const t = await render(
    <Image source={{ uri: 'x' }} style={[styles.emptyStateMark, { tintColor: DEPTH_1 }]} />,
  );
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('passes a depth colour composed onto a View, because the depth scale is where colour comes from', async () => {
  // `DepthLegend`'s swatch. A band colour cannot be precomputed into a scheme-only sheet — it
  // depends on the band too — so `theme/depth.ts`, §4.1's only reader of the scale, hands it in
  // at the call site exactly as `depthValue` has always taken its own.
  const t = await render(<View style={[styles.depthLegendBar, { backgroundColor: DEPTH_1 }]} />);
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

it('still catches a colour that is not on the depth scale', async () => {
  const t = await render(<View style={[styles.depthLegendBar, { backgroundColor: '#ff0000' }]} />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('catches the other scheme own band colour, so the exemption is per palette', async () => {
  // The dark palette on a light render is a real colour from a real scale and still wrong: it
  // is the failure `scheme` is a required argument for, arriving through the new exemption.
  const t = await render(
    <View style={[styles.depthLegendBar, { backgroundColor: depthScale.dark[0] }]} />,
  );
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('does not let a depth colour smuggle a shape in beside it', async () => {
  // Per KEY, like the geometry allowlist: nothing in the depth-paint list can draw or size
  // anything, so `{ backgroundColor: <band 1>, borderRadius: 40 }` is still reported.
  const t = await render(
    <View style={[styles.depthLegendBar, { backgroundColor: DEPTH_1, borderRadius: 40 }]} />,
  );
  expect(unexpectedGraphics(t, 'light')).toHaveLength(1);
});

it('catches a second image even when it wears the mark own style, because the rule is one image', async () => {
  // The most plausible bad edit there is, and an identity check on the style alone lets it
  // through: somebody adds an `<Image>` for a second thing and reaches for the style that is
  // already there. Both are reported rather than one, since nothing here can say which of two
  // identical-looking images was meant to be the mark.
  const t = await render(
    <View>
      <Image source={{ uri: 'a' }} style={styles.emptyStateMark} />
      <Image source={{ uri: 'b' }} style={styles.emptyStateMark} />
    </View>,
  );
  expect(unexpectedGraphics(t, 'light')).toHaveLength(2);
});
