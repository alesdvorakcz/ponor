import { type RenderResult } from '@testing-library/react-native';
import { processColor } from 'react-native';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { depthScale, type ColorScheme } from '../theme/tokens';

/**
 * The §0.4/§0.1 guard: **every graphic on screen is one somebody decided to draw, in a colour
 * this app's own palette produced.** Three arms say that of three kinds of node — the only
 * `Image` is the mark, an SVG element is painted from the depth scale or the theme tokens, and
 * no `View` wears anything `makeStyles(scheme)` did not hand out or the depth scale did not
 * produce.
 *
 * The first two exemptions arrived together in M1h with the first-run empty state, and both
 * are named rather than opened as categories — see `isDepthPaint` below and the `Image` arm
 * of the filter. Until then the claim really was "nothing draws a graphic", because nothing
 * did. The third is M3p's depth profile, and it is a rule rather than an exemption: an SVG
 * node is judged by what it was painted with (`isSanctionedSvg`), not admitted by being one.
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
 *
 * The SVG names stay too, and still do work: `RNSVG*` nodes are taken by the arm above this
 * one (`SVG_HOST`), but a component that merely *calls itself* `Path` or `Circle` — a host
 * type this pattern matches and that one does not — has said what it draws and has no paint
 * to be judged on, so it lands here and reports.
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

/**
 * **react-native-svg's own host elements**, which is what an `<Svg>`, a `<Path>` or a `<Circle>`
 * arrives as once React Native has rendered it: `RNSVGSvgView`, `RNSVGGroup`, `RNSVGPath`,
 * `RNSVGCircle`, `RNSVGLine`. Matched on the library's prefix rather than on a list of shapes,
 * so a primitive the app has not used yet is judged by the same rule instead of falling through
 * to an arm that knows nothing about paint.
 */
const SVG_HOST = /^RNSVG/;

/**
 * The two SVG hosts that **draw nothing of their own**: the canvas, and a group.
 *
 * They are exempt from one half of the rule below — the half that insists a drawing element
 * name its own paint — and from that half only. Everything else still applies to them, which is
 * what catches a `<G fill="…">` colouring every child under it without any child naming a
 * colour, and the `<Svg>`'s own `style`.
 *
 * Named, not derived, and short on purpose: a container react-native-svg adds later is reported
 * until somebody decides it belongs here, which is the direction this file wants to fail in.
 */
const SVG_CONTAINERS: readonly string[] = ['RNSVGSvgView', 'RNSVGGroup'];

/**
 * The one SVG host that draws a **raster** rather than a vector shape, and the reason it is
 * reported unconditionally by the arm below regardless of what it was painted with (review,
 * M3p task 7 fix round 1, closing a gap the review found in `isSanctionedSvg` itself).
 *
 * `RNSVGImage` matches `SVG_HOST` exactly like every shape, and react-native-svg's `Image`
 * accepts `fill`/`stroke` like any other element (`CommonPathProps`) whether or not either
 * paints anything visible — so judging it on declared paint the way a `Path` or `Circle` is
 * judged would admit a bitmap that happened to declare a sanctioned colour, where the arm this
 * replaced always reported any SVG on sight. A blameless-looking `fill` does not make a photo,
 * an imported chart PNG, or anything else this app has never drawn any less a raster: no
 * legitimate node in this app is one, since the app draws exactly one image and it is the
 * mark, which the `Image` arm above already owns and judges by identity against
 * `emptyStateMark`. So this is carved out before `isSanctionedSvg` ever runs on it — the same
 * way the two containers above are carved out from the opposite side (they draw nothing
 * themselves, so there is no paint to be missing).
 */
const SVG_RASTER = 'RNSVGImage';

/** The two props that put colour on an SVG element. Both, not `stroke` alone: the deepest-sample
 * marker on the profile card is a filled `Circle`, so a rule reading strokes would leave the
 * app's one filled shape unguarded. */
const SVG_PAINT_PROPS: readonly string[] = ['fill', 'stroke'];

/**
 * Every colour an SVG element in this app is allowed to be painted with — **the depth scale for
 * this scheme, plus this scheme's theme tokens**, and nothing else.
 *
 * That pairing is §0.1 stated for a drawing: the curve's colour is *data* (`depthColor`, one
 * `Path` per band), and the three non-depth things the card has to draw — the grid, the gas
 * trace, the scrub hairline — are `border`, `fgMuted` and `fg`, one ink each. `themeFor` rather
 * than `makeStyles` because an SVG `stroke` is a prop and not a style property, so the sheet is
 * not where it could come from; `DepthProfile`'s own docblock records the same licence from the
 * other end.
 *
 * **Run through `processColor`, because that is what the elements hold.** react-native-svg does
 * not keep the string it was handed: `extractBrush` converts every `stroke`/`fill` and gives the
 * host `{ type: 0, payload: <int> }`. Converting the expected colours the same way compares one
 * colour with another rather than pinning the encoding the library happens to use today —
 * `DepthProfile.test.tsx`'s `paint`/`paintOf` helpers are the same move.
 *
 * A conversion that came back empty is dropped rather than admitted: an unreadable token would
 * otherwise put `undefined` in this set, and `undefined` is exactly what reading `payload` off
 * something that is not a brush produces — so one bad colour would quietly stop the check.
 */
function sanctionedPaint(scheme: ColorScheme): Set<unknown> {
  const colours = [...depthScale[scheme], ...Object.values(themeFor(scheme))];
  return new Set(colours.map((colour) => processColor(colour)).filter((value) => value != null));
}

/**
 * An `<Svg>`'s own `style` entry that **cannot paint and cannot draw**, which is what the two
 * react-native-svg composes for itself are: `{ backgroundColor: 'transparent', borderWidth: 0 }`
 * — its reset — and `{ width, height, flex }`, built from the element's own `width`/`height`
 * props.
 *
 * Bounded by construction on both axes, exactly as `DEVICE_GEOMETRY_KEYS` and `DEPTH_PAINT_KEYS`
 * above are, and for the same reason: the keys are an allowlist, so nothing here can set a
 * border, a radius or a shadow; and the two keys that *could* carry a hue are pinned to the two
 * values that carry none. So a third entry with a real background — a fill reaching the canvas
 * without going near `stroke` or `fill` — is still reported.
 */
function isPaintlessSvgBox(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const own = Object.entries(entry as Record<string, unknown>);
  return (
    own.length > 0 &&
    own.every(([key, value]) => {
      if (key === 'backgroundColor') return value === 'transparent';
      if (key === 'borderWidth') return value === 0;
      return ['width', 'height', 'flex'].includes(key) && ['number', 'string'].includes(typeof value);
    })
  );
}

/**
 * **What a legitimate SVG node looks like** — the question this arm was left open for, decided
 * by the screen that put `DepthProfile` on the dive detail (M3p).
 *
 * The rule is *paint*, not existence: **every colour an SVG element was painted with has to be
 * one this app's own palette produced.** It is the same shape `isDepthPaint` gives a `View` and
 * the `Image` arm gives the mark — a value checked against what produced it, not a category
 * opened — and it is §0.1's own sentence for a drawing, which is why it, rather than "no SVG
 * anywhere", is what this guard can defend now that the app genuinely draws.
 *
 * Three parts, and each closes a way past the other two:
 *
 * - **`propList` says what the element actually declared.** react-native-svg gives every node
 *   both props whether or not anyone set them — an unpainted shape inherits opaque black from
 *   the canvas — so the raw `fill` is not evidence of a decision. `propList` is, and a declared
 *   `none` (which arrives as `null`) paints nothing and passes.
 * - **A drawing element must declare paint at all.** Since an undeclared colour is not evidence,
 *   a `<Path d="…" />` that names none would otherwise ride in — and it draws, in that inherited
 *   black, which is neither a depth colour nor a token. Only `SVG_CONTAINERS` are excused, and
 *   they draw nothing themselves.
 * - **The element's own `style` is read too**, or a backdrop could be painted onto the canvas
 *   without touching either paint prop (`isPaintlessSvgBox`).
 *
 * **What this deliberately no longer does is make the mere existence of an SVG cost an edit
 * here.** That was the old arm's whole content, and it was the right placeholder while nothing
 * could be written against a real component; kept now it would report `DepthProfile` and
 * `ProfileSparkline` on twelve screens and be exempted away within the week, which is how a
 * guard becomes a formality. §0.4's other rule — that nothing is drawn which was not measured —
 * is not this file's to enforce and never was: it is about whether a component draws at all with
 * no series behind it, which each component's own tests pin directly (`DepthProfile.test.tsx`,
 * `ProfileSparkline.test.tsx`, both of which assert an empty render). What is left here is the
 * half a whole-screen sweep can actually see, and it still bites: a chart in any hue nobody
 * chose, a shape that names no paint, a group tinting its children, a coloured canvas — and a
 * dark-palette stroke on a light render, which is a real colour from a real scale and still
 * wrong.
 */
function isSanctionedSvg(node: Node, palette: Set<unknown>, known: unknown[]): boolean {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const declaredList = Array.isArray(props.propList) ? (props.propList as unknown[]) : [];
  const declared = SVG_PAINT_PROPS.filter((prop) => declaredList.includes(prop));
  const type = typeof node.type === 'string' ? node.type : '';
  if (declared.length === 0 && !SVG_CONTAINERS.includes(type)) return false;

  const paintedFromPalette = declared.every((prop) => {
    const brush = props[prop];
    // `fill="none"` reaches the host as `null` — nothing is painted, so there is no colour to
    // check. Anything that is not a brush object (a gradient reference, say) has no payload and
    // falls through to the palette test, which no `undefined` is a member of.
    if (brush === null) return true;
    const payload = (brush as { payload?: unknown } | undefined)?.payload;
    return palette.has(payload);
  });

  const style = [props.style].flat(5).filter(Boolean) as unknown[];
  return paintedFromPalette && style.every((entry) => known.includes(entry) || isPaintlessSvgBox(entry));
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
  // Built once beside `known` and for the same reason: it is a property of the scheme, not of
  // any node, and a whole-screen sweep asks it of several hundred of them.
  const palette = sanctionedPaint(scheme);
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
    // **A real SVG element, judged by what it was painted with** (M3p) — the decision this arm
    // was left holding open, and `isSanctionedSvg` above is where it is written and argued.
    //
    // The arm it replaces reported any SVG on sight, which was the right default for exactly as
    // long as nothing in the app drew one: the rule §0.1 gives a drawing — its paint is a depth
    // colour or a theme token — cannot be written until there is a component whose answer it can
    // be written against, and `DepthProfile` and `ProfileSparkline` are now that. So the cost of
    // a new graphic is no longer an edit here; it is painting it from the app's own palette, and
    // being reported by this line the moment it is painted from anywhere else.
    //
    // **Except a raster, which reports regardless of paint** (review, M3p task 7 fix round 1):
    // `RNSVGImage` matches `SVG_HOST` like every shape, so without the `SVG_RASTER` carve-out a
    // bitmap that happened to declare a sanctioned colour would be admitted here, where the arm
    // this replaced always reported it on sight — see `SVG_RASTER`'s own comment for why a
    // raster's paint is beside the point.
    //
    // Ordered before the name test below, and it has to be: every `RNSVG*` type contains "svg",
    // so that pattern matches all of them and would report the card wholesale.
    if (typeof n.type === 'string' && SVG_HOST.test(n.type)) {
      return n.type === SVG_RASTER || !isSanctionedSvg(n, palette, known);
    }
    // An element whose own type NAME says what it draws: an `Image` used as a rendered sprite,
    // or a component simply named for the thing it draws (Chart, Sparkline, Profile). It has
    // announced a drawing and carries no paint for the arm above to read, so it reports.
    if (typeof n.type === 'string' && SUSPICIOUS_TYPE_NAME.test(n.type)) return true;
    if (n.type !== 'View') return false;
    const style = [n.props?.style].flat(5).filter(Boolean) as unknown[];
    return style.some(
      (entry) => !known.includes(entry) && !isDeviceGeometry(entry) && !isDepthPaint(entry, scheme),
    );
  });
}
