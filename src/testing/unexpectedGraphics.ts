import { type RenderResult } from '@testing-library/react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * The §0.4/§0.1 guard: nothing on screen draws a graphic, and no `View` is painted with
 * anything `makeStyles(scheme)` did not hand out.
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
const SUSPICIOUS_TYPE_NAME = /svg|path|circle|rect|ellipse|polyline|polygon|canvas|chart|sparkline|profile|image/i;

/**
 * The one kind of inline style a screen may legitimately compose in locally: a position or
 * padding read off the device at runtime, which by definition cannot live in a scheme-only
 * stylesheet. `DiveFormScreen`'s `{ paddingBottom: insets.bottom + 24 }` is the one in the
 * app today, and it names its reason where it is written. `DivesScreen`'s floating row was
 * the other (`{ bottom: insets.bottom + ... }`) until DESIGN.md §3's note moved it to the
 * top of the screen, where `screen`'s own static `paddingTop` is the clearance and no inset
 * is read at all. The list keeps its `bottom`/`left`/`right` entries regardless: what it
 * permits is bounded by construction rather than by which screens happen to use it, and
 * trimming it to today's call sites would just have to be undone by the next one.
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
  return nodes.filter((n) => {
    // An element whose own type NAME says what it draws: an SVG primitive if
    // react-native-svg is ever added, an `Image` used as a rendered sprite, or a component
    // simply named for the thing it draws (Chart, Sparkline, Profile).
    if (typeof n.type === 'string' && SUSPICIOUS_TYPE_NAME.test(n.type)) return true;
    if (n.type !== 'View') return false;
    const style = [n.props?.style].flat(5).filter(Boolean) as unknown[];
    return style.some((entry) => !known.includes(entry) && !isDeviceGeometry(entry));
  });
}
