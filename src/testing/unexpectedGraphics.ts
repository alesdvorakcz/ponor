import { type RenderResult } from '@testing-library/react-native';

import { makeStyles } from '../theme/styles';
import { depthScale, type ColorScheme } from '../theme/tokens';

/**
 * The §0.4/§0.1 guard: **the only graphic on screen is the mark**, and no `View` is painted
 * with anything `makeStyles(scheme)` did not hand out or the depth scale did not produce.
 *
 * Both exemptions arrived together in M1h with the first-run empty state, and both are named
 * rather than opened as categories — see `isDepthPaint` below and the `Image` arm of the
 * filter. Until then the claim really was "nothing draws a graphic", because nothing did.
 *
 * **Shared, unlike every other helper in this codebase's tests.** Five test files carried a
 * character-for-character copy of this, each under a comment saying it was copied "per this
 * codebase's own no-shared-test-utils convention" — and all five copies were wrong in the
 * same way, which is precisely what a shared owner prevents. The convention is right for a
 * three-line query helper; it is wrong for a rule two DESIGN.md sections depend on, where
 * the cost of the copies is that a fix has to be found five times.
 *
 * Kept out of the app program (`tsconfig.json` excludes it, `tsconfig.test.json` includes
 * it) exactly as `src/db/testDb.ts` is, so importing a test library here cannot leak into
 * anything Metro bundles.
 *
 * ---
 *
 * **What was wrong.** The check read
 *
 * ```
 * style.length > 0 && !style.some((s) => known.includes(s))
 * ```
 *
 * — flag a `View` only when *none* of its style entries is a known one. So a single known
 * style excused every literal beside it, and `style={[styles.something, { backgroundColor:
 * '#f00' }]}` — the only shape anyone actually writes, since RN styles compose as arrays —
 * passed. The guard caught a `View` styled with a bare literal and nothing else, which is
 * not how a dropped-in chart, a fill, or an accent would ever arrive.
 *
 * It reads every entry now: an entry is acceptable if it is a style `makeStyles` produced,
 * or if it is a pure device-geometry object (below). Anything else — a colour, a radius, a
 * border, a size — is reported.
 *
 * The same hole had a second half, found while writing this file's own test: `queryAll`
 * walks descendants and never returns the instance it is called on, so the rendered
 * subject's own ROOT node was the one element no copy of this guard could ever see. It is
 * included below.
 *
 * `unexpectedGraphics.test.tsx` beside this file is what keeps both halves closed — until it
 * existed, the only thing checking the guard was the guard.
 */
/**
 * An element whose own type NAME says what it draws. `image` stays in the list even though
 * the filter now handles `Image` before reaching here: the pattern is a substring match, so
 * this is what still catches a `FastImage`, an `ImageBackground` or anything else that draws
 * a bitmap under a different host name, while the arm above admits exactly one styled `Image`.
 */
const SUSPICIOUS_TYPE_NAME = /svg|path|circle|rect|ellipse|polyline|polygon|canvas|chart|sparkline|profile|image/i;

/**
 * The one kind of inline style a screen may legitimately compose in locally: a position or
 * padding read off the device at runtime, which by definition cannot live in a scheme-only
 * stylesheet. Every screen root in the app is one — `{ paddingTop: screenTopInset(insets.top) }`
 * (theme/styles.ts owns the rule, §4.1) — as is `DiveFormScreen`'s
 * `{ paddingBottom: insets.bottom + 24 }`, and each names its reason where it is written.
 * `DivesScreen`'s floating row was another (`{ bottom: insets.bottom + ... }`) until
 * DESIGN.md §3's note moved it to the top of the screen. The list keeps its
 * `bottom`/`left`/`right` entries regardless: what it permits is bounded by construction
 * rather than by which screens happen to use it, and trimming it to today's call sites would
 * just have to be undone by the next one.
 *
 * Deliberately a key allowlist rather than a "no colour keys" denylist: a denylist has to
 * anticipate every property that can carry a hue or draw a shape (`shadowColor`,
 * `tintColor`, `borderTopColor`, …), and the one it forgets is the one that ships. Nothing
 * in this list can hold a colour or draw anything, so what it permits is bounded by
 * construction. Values must be numbers for the same reason.
 */
const DEVICE_GEOMETRY_KEYS: readonly string[] = [
  'top',
  'bottom',
  'left',
  'right',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'marginTop',
  'marginBottom',
];

function isDeviceGeometry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const own = Object.entries(entry as Record<string, unknown>);
  return own.length > 0 && own.every(([key, value]) => DEVICE_GEOMETRY_KEYS.includes(key) && typeof value === 'number');
}

/**
 * The second kind of inline style a screen may compose, and the one that is about §0.1 rather
 * than about the device: **paint taken from the depth scale itself**.
 *
 * `theme/depth.ts` is the only reader of that scale (§4.1), and what it returns cannot be
 * precomputed into `makeStyles` — a band's colour depends on the band as well as on the
 * scheme, which is exactly why `depthValue` carries no colour and `depthLegendBar` carries no
 * background. So the one legitimate way for a hue to reach a `View` from outside the sheet is
 * for it to *be* a depth, and this says so precisely: the value must be one of the six colours
 * `tokens.js` declares for this scheme, and nothing else on the object.
 *
 * **Bounded by construction on both axes, like the geometry allowlist above.** The keys are an
 * allowlist, so nothing here can draw a shape or set a size; the values are checked against the
 * palette itself, so `{ backgroundColor: '#FF0000' }` is still reported and so is a *dark*
 * band colour on a light render. That value check is the half that matters: without it this
 * would be "a View may have a background colour", which is the guard turned off.
 *
 * Added for M1h's first-run legend (`DepthLegend.tsx`), the one place in Ponor where a depth
 * colour appears without a dive under it. Before it, every depth colour in the app landed on
 * `Text` — which this guard has never inspected — so the case had simply never arisen.
 */
const DEPTH_PAINT_KEYS: readonly string[] = ['backgroundColor', 'color'];

function isDepthPaint(entry: unknown, scheme: ColorScheme): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const palette: readonly string[] = depthScale[scheme];
  const own = Object.entries(entry as Record<string, unknown>);
  return (
    own.length > 0 &&
    own.every(
      ([key, value]) =>
        DEPTH_PAINT_KEYS.includes(key) && typeof value === 'string' && palette.includes(value),
    )
  );
}

type Node = NonNullable<RenderResult['root']>;

/**
 * Every node that breaks the rule — empty when the render is clean.
 *
 * `scheme` is required rather than defaulted, because it has to be the scheme that actually
 * rendered: `useColorScheme()` reports light under Jest, so a screen test comparing against
 * the dark sheet would find none of its own styles known and report the entire tree.
 */
export function unexpectedGraphics(t: RenderResult, scheme: ColorScheme): Node[] {
  if (!t.root) return [];
  const known = Object.values(makeStyles(scheme)) as unknown[];
  // `queryAll` walks DESCENDANTS only — it never returns the instance it was called on — so
  // the rendered subject's own root node was the one element the guard could never see. A
  // component whose outermost View carried the literal was therefore exempt, which is the
  // second half of the same hole and free to close here.
  const nodes = [t.root, ...t.root.queryAll(() => true)];
  const mark = makeStyles(scheme).emptyStateMark as unknown;
  // **"Exactly one" is counted, not merely described.** Matching on `emptyStateMark` alone
  // says "every image is painted like the mark", which is not the same claim and leaves the
  // most plausible bad edit through: a SECOND `<Image>` reusing that very style with a
  // different source — the gradient `icon.png`, a photo — passes an identity check on its
  // style and would draw a second graphic on a screen whose comment promises one. So the
  // count is part of the rule, and a tree holding two images reports both rather than
  // silently picking a winner.
  const imageCount = nodes.filter((n) => n.type === 'Image').length;
  return nodes.filter((n) => {
    // **The one graphic Ponor draws, named** (M1h). The empty state renders the mark as an
    // `Image` — DESIGN.md §0.3's shape, monochrome, from the same `assets/mark.svg` the icons
    // are built from — so the blanket "nothing on screen draws a graphic" is no longer true
    // and this says the narrower thing that is: **the app draws exactly one image, and it is
    // the mark.** Matched on `emptyStateMark`, the single style that paints it, so a second
    // image anywhere costs a deliberate edit to this guard rather than riding in on a
    // category that had been opened for the first one. That deliberate edit is the point:
    // photos are a v1.1 feature (§10) and will arrive with their own decision about §0.4.
    //
    // The style is compared by identity against the sheet, exactly as a `View`'s is, which is
    // also what carries the §0.1 half: the mark's `tintColor` and its half strength live in
    // `makeStyles`, so an image tinted from anywhere else — a depth colour included — is
    // still reported.
    if (n.type === 'Image') {
      if (imageCount > 1) return true;
      const style = [n.props?.style].flat(5).filter(Boolean) as unknown[];
      return style.length === 0 || !style.every((entry) => entry === mark);
    }
    // An element whose own type NAME says what it draws: an SVG primitive if
    // react-native-svg is ever added, an `Image` used as a rendered sprite, or a component
    // simply named for the thing it draws (Chart, Sparkline, Profile).
    if (typeof n.type === 'string' && SUSPICIOUS_TYPE_NAME.test(n.type)) return true;
    if (n.type !== 'View') return false;
    const style = [n.props?.style].flat(5).filter(Boolean) as unknown[];
    return style.some(
      (entry) => !known.includes(entry) && !isDeviceGeometry(entry) && !isDepthPaint(entry, scheme),
    );
  });
}
