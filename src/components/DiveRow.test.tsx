import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { Text } from 'react-native';

import { dive } from '../domain/diveFixture';
import { formatDuration, formatTimeRange } from '../format/display';
import { depthColor } from '../theme/depth';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { DiveRow } from './DiveRow';

// Adapted from the brief's react-test-renderer-shaped example to the API the installed
// @testing-library/react-native@14 actually exposes:
//   - `render` is async (it wraps its own `act()`) and returns `{ root, ... }` where
//     `root` is a `test-renderer` `TestInstance`, not a classic react-test-renderer one.
//   - That `TestInstance` has `queryAll(predicate)`, not `findAllByType`/`findByType`.
//   - Its tree holds host elements only. `Pressable` is a composite component and never
//     appears as a node — `root` for a `<Pressable>...</Pressable>` render is the `View`
//     Pressable renders internally, with responder props merged in but no literal
//     `onPress` prop to call directly. `fireEvent.press(root)` is the supported way to
//     trigger it; it walks the fiber tree to find the handler.
// The assertions below are unchanged from the brief.

function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

// M1c closing fixes, Important #1 — the worst finding in the whole-branch review, and it
// indicts every "tested rather than hoped" claim this codebase has made about §0.4 since
// M1b. The old version of the test below searched for `n.type === 'Svg'`: react-native-svg
// is not a dependency (nothing in package.json needs it) and the literal string 'Svg'
// appears nowhere under src/ except that predicate and DiveDetailScreen.test.tsx's twin, so
// the query always returned `[]` regardless of what DiveRow actually rendered. Proven
// directly: adding a five-bar sparkline to this row (a `View` per bar, background-coloured
// — nothing to do with `Svg`) left that assertion passing.
//
// §0.4's real property is "this row renders no graphical element", not "no element happens
// to be named Svg" — the guard has to describe what a graphic would actually look like in
// this codebase, not one exact node type that happens not to exist yet. Two realistic
// shapes, checked independently: (1) an element whose own type NAME says what it draws — an
// SVG primitive if react-native-svg is ever added (Svg/Path/Circle/Rect/...), an Image used
// as a rendered sprite, or a component simply named for the thing it draws (Chart,
// Sparkline, Profile); (2) a `View` styled with anything that didn't come from this file's
// own `makeStyles(scheme)` — a bar or fill built from an ad hoc literal, exactly the shape a
// dropped-in chart component would bring, since it would carry its own styling rather than
// reuse DiveRow's. `known` is every value `makeStyles` actually hands out, not a hand-picked
// subset, so this can't go stale as DiveRow's own styling evolves — only a style DiveRow was
// never given trips it.
//
// It lives in `src/testing/unexpectedGraphics.ts` now rather than here. Five files carried
// this same copy and all five shared a second defect the account above did not reach: the
// check read `!style.some(known.includes)`, so one known style excused every literal beside
// it — `[styles.diveRowTop, { backgroundColor: '#f00' }]` passed, which is exactly how a
// dropped-in chart's own styling would arrive, and is the only shape anyone writes.

it('shows the dive number, site and depth', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Blue Hole', maxDepthM: 32.4 })} number={248} scheme="dark" onPress={() => {}} />,
  );
  // `.join('')`, not `.join(' ')`: DepthValue (this task) now splits "32.4 m" across two
  // sibling Text nodes — the value and a nested, quieter unit — so the two arrive here as
  // separate array entries, "32.4" then " m" (the unit carries its own leading space, the
  // way RN renders adjacent Text with no separator of its own). `join(' ')` would insert a
  // second space that nothing on screen actually shows ("32.4  m") and break the
  // `toContain` below; `join('')` reconstructs exactly what's rendered, since sibling Text
  // nodes never gain a space RN didn't put there.
  const text = textIn(t).join('');
  expect(text).toContain('248');
  expect(text).toContain('Blue Hole');
  expect(text).toContain('32.4 m');
});

// Review task 7, Important #4: this row is the only route into a dive, and a Pressable
// carries no accessibilityRole on its own — a screen reader user heard the number, site
// and depth as three disconnected text fragments and was never told the row was
// actionable at all.
it('announces itself as a button, with a label composed from number, site and depth', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Blue Hole', maxDepthM: 32.4 })} number={248} scheme="dark" onPress={() => {}} />,
  );
  // DiveRow's own top-level element IS the Pressable's rendered host view here (this file's
  // own top comment) — read its props directly, the same way the "passes the dive id to
  // onPress" test below fires directly on `t.root` rather than searching for it.
  if (!t.root) throw new Error('DiveRow did not render a root element');
  expect(t.root.props.accessibilityRole).toBe('button');
  expect(t.root.props.accessibilityLabel).toBe('Dive 248, Blue Hole, 32.4 m');
});

// The number is omitted for a planned dive (§2.4: no number until completed) and depth is
// omitted for a dive that never recorded one (§1 — no form-shaming) — the label degrades
// the same way the row's own visible text does, rather than reading "Dive undefined" or
// leaving a trailing ", " where the missing piece would have been. The date stays (dive()'s
// own default, '2026-08-16' -> '16 Aug 2026') since a planned dive always carries one (§6).
it("omits whichever label piece the row itself omits, for a planned dive with no depth", async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Shore entry', status: 'planned' })} number={undefined} scheme="dark" onPress={() => {}} />,
  );
  if (!t.root) throw new Error('DiveRow did not render a root element');
  expect(t.root.props.accessibilityLabel).toBe('Shore entry, 16 Aug 2026');
});

// M1c closing fixes, Minor carried from task 3's review: the row shows a planned dive's date
// visibly ("shows a planned dive its date..." below) but the label used to leave it out, so
// two planned dives at the same site on different dates announced identically even though
// the two rows read differently on screen — no depth to tell them apart either, since a
// planned dive is set up before diving (§2.4: date, site, cylinder, starting pressure, no
// depth yet). This is the bug itself, not just the label's composition in isolation: two
// real DiveRow renders, same site, different dates, proven to diverge.
it("includes a planned dive's date in the label, so two planned dives at the same site on different dates announce differently", async () => {
  const soon = await render(
    <DiveRow dive={dive({ status: 'planned', date: '2026-09-05', siteName: 'Silfra' })} number={undefined} scheme="dark" onPress={() => {}} />,
  );
  const later = await render(
    <DiveRow dive={dive({ status: 'planned', date: '2026-09-12', siteName: 'Silfra' })} number={undefined} scheme="dark" onPress={() => {}} />,
  );
  if (!soon.root || !later.root) throw new Error('DiveRow did not render a root element');
  expect(soon.root.props.accessibilityLabel).toBe('Silfra, 5 Sep 2026');
  expect(later.root.props.accessibilityLabel).toBe('Silfra, 12 Sep 2026');
  expect(soon.root.props.accessibilityLabel).not.toBe(later.root.props.accessibilityLabel);
});

// The row's own half of item 5's one rule (`diveSiteLabel`, format/display.ts). Untested
// until now, on either side, which is how the row and the detail screen came to disagree:
// the row named an unsited dive "Unnamed site" while its own detail page rendered no title
// at all. Both call sites now read the same function, and both files pin the same two
// answers for the same two dives — so a change to one that broke the other could not pass.
it('falls back to the dive centre when no site name was recorded', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: null, centerName: 'Aqua' })} number={7} scheme="dark" onPress={() => {}} />,
  );
  expect(textIn(t)).toContain('Aqua');
});

// The case the two tests around this one cannot see: `diveSiteLabel` is `siteName ??
// centerName ?? 'Unnamed site'`, and its PRECEDENCE was pinned only in display.test.ts. No
// fixture anywhere set both fields, so this call site accepted a centre-first inline copy —
// a row that named every dive after the shop rather than the place, on every trip where both
// are recorded, which is the ordinary case for a diver who books through a centre.
it('names the site, not the centre, when the dive records both', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Blue Hole', centerName: 'Aqua' })} number={7} scheme="dark" onPress={() => {}} />,
  );
  expect(textIn(t)).toContain('Blue Hole');
  expect(textIn(t)).not.toContain('Aqua');
  // The announced label is composed from the same string (`accessibilityLabelFor`), so a
  // row that got this right on screen and wrong in the label would be caught here too.
  expect(t.root?.props?.accessibilityLabel).toBe('Dive 7, Blue Hole');
});

it('names a dive with neither a site nor a centre, rather than leaving a blank line', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: null, centerName: null })} number={7} scheme="dark" onPress={() => {}} />,
  );
  expect(textIn(t)).toContain('Unnamed site');
});

// M1c closing fixes, Important #3: `depth` here used to come from `formatDepth(...)`
// alone, which returned a string for a negative reading even though the row's own visible
// `<DepthValue />` (gated by `depthColorOrNull`) drew nothing for the same value — so a
// screen reader announced a depth this row never actually showed. `formatDepth` now
// refuses a negative depth the same way `depthColorOrNull` always has (format/display.ts's
// formatDepthParts is the one owner both defer to), so the label omits it exactly like any
// other unrecorded field, rather than naming a number nobody can see on screen.
it('omits a negative depth from the label, since the row never actually draws one', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Blue Hole', maxDepthM: -5 })} number={3} scheme="dark" onPress={() => {}} />,
  );
  if (!t.root) throw new Error('DiveRow did not render a root element');
  expect(t.root.props.accessibilityLabel).toBe('Dive 3, Blue Hole');
  expect(t.root.props.accessibilityLabel).not.toContain('-5');
  const text = textIn(t).join(' ');
  expect(text).not.toContain('-5');
});

it('colours the depth by its band, not by the theme', async () => {
  const t = await render(
    <DiveRow dive={dive({ maxDepthM: 32.4 })} number={1} scheme="dark" onPress={() => {}} />,
  );
  const depthNode = textNodesOf(t).find((n) => String(n.children[0]).includes('32.4'));
  expect(depthNode).toBeDefined();
  expect(depthNode?.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ color: depthColor(32.4, 'dark') })]),
  );
});

it('renders a dive with nothing but a date, without placeholders or a crash', async () => {
  const t = await render(
    <DiveRow dive={dive({ date: '2026-08-16' })} number={1} scheme="dark" onPress={() => {}} />,
  );
  const text = textIn(t).join(' ');
  expect(text).not.toContain('null');
  expect(text).not.toContain('NaN');
  expect(text).not.toContain('undefined');
});

it('shows no dive number for a planned dive', async () => {
  const t = await render(
    <DiveRow dive={dive({ status: 'planned' })} number={undefined} scheme="dark" onPress={() => {}} />,
  );
  expect(textIn(t).join(' ')).not.toMatch(/#\d/);
});

it('draws no graphic for a dive, because no dive has a sample series', async () => {
  // `rating: 4` on top of `maxDepthM` so this render also exercises RatingDots' own
  // `View`s (§0.6's drawn marks, task 7) — proving the whitelist above recognises every
  // legitimate View this row can produce, not just the ones a depth-only fixture reaches.
  const t = await render(
    <DiveRow dive={dive({ maxDepthM: 32.4, rating: 4 })} number={1} scheme="dark" onPress={() => {}} />,
  );
  expect(unexpectedGraphics(t, 'dark')).toHaveLength(0);
});

it('passes the dive id to onPress', async () => {
  const onPress = jest.fn();
  const d = dive({ id: 'abc' });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={onPress} />);
  if (!t.root) throw new Error('DiveRow did not render a root element');
  await fireEvent.press(t.root);
  expect(onPress).toHaveBeenCalledWith('abc');
});

// DESIGN.md §0.6: depth is the anchor of a dive row — the value that actually differs
// dive to dive, set larger than everything else so a column of dives reads as a column
// of aligned, colour-coded numbers rather than every element competing at one size.
it('sets the depth larger than the site name, so the row has an anchor', async () => {
  const d = dive({ siteName: 'Blue Hole', maxDepthM: 32.4 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const sizeOf = (s: string) => {
    const node = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes(s));
    return [node?.props.style].flat(3).filter(Boolean)
      .reduce((acc: number, st) => st?.fontSize ?? acc, 0);
  };
  expect(sizeOf('32.4')).toBe(20);
  expect(sizeOf('Blue Hole')).toBe(16);
  expect(sizeOf('32.4')).toBeGreaterThan(sizeOf('Blue Hole'));
});

it('gives the depth tabular figures so a column of dives aligns', async () => {
  const d = dive({ maxDepthM: 9.2 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const node = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes('9.2'));
  const style = [node?.props.style].flat(3).filter(Boolean);
  expect(style.some((s) => s?.fontVariant?.includes('tabular-nums'))).toBe(true);
});

// M1c task 1 review, Minor: this used to also assert `ellipsizeMode` is not `'head'`.
// diveSite's Text never sets ellipsizeMode at all, so that read undefined and the
// assertion passed unconditionally — it would only have failed had someone later written
// literally `ellipsizeMode="head"`, which says nothing about whether the name actually
// wraps. `numberOfLines` below is the real mechanism (RN wraps up to that many lines and
// only then truncates) and is the one assertion this test needs to isolate the guarantee.
it('lets a long site name wrap rather than truncate', async () => {
  const d = dive({ siteName: 'Šenkýřův lom u Zbraslavi nad Vltavou' });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const node = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes('Šenkýřův'));
  expect(node?.props.numberOfLines).toBe(2);
});

// M1c task 3: DESIGN.md §3 now pins planned dives under "Up next" "with their date" — on
// screen today that section showed a site name and nothing else, the one omission that
// mattered for a section whose entire purpose is *when*.
it('shows a planned dive its date, since "Up next" is about when', async () => {
  const d = dive({ status: 'planned', date: '2026-09-05', siteName: 'Silfra' });
  const t = await render(<DiveRow dive={d} number={undefined} scheme="dark" onPress={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).toContain('5 Sep 2026');
  expect(text).not.toMatch(/#\d/);
});

// The more important half of this task: a logged dive's trip header already states the day
// ("BLUE HOLE · 16–18 Aug 2026", TripHeader.tsx) — repeating it on every row beneath would
// be redundant noise in the common case, the one this screen shows most often.
it('does not put the date on a logged dive row, where the trip header carries it', async () => {
  const d = dive({ status: 'logged', date: '2026-09-05', siteName: 'Silfra', timeIn: '09:00' });
  const t = await render(<DiveRow dive={d} number={7} scheme="dark" onPress={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).not.toContain('5 Sep 2026');
});

// M1c closing fixes, Important #4: DESIGN.md §0.6 specifies the metadata line as "Time ·
// duration · rating, middot-separated", but the row used to space its chips with a bare
// `gap` and render no middot at all. Computed via the same formatters DiveRow.tsx itself
// calls, rather than a hand-typed clock-arithmetic string, so this can't drift from
// whatever `formatTimeRange`/`formatDuration` actually produce.
it('middot-separates the time and duration chips, per §0.6', async () => {
  const d = dive({ timeIn: '09:30', durationMin: 44 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const expected = `${formatTimeRange(d.timeIn, d.durationMin)} · ${formatDuration(d.durationMin)}`;
  expect(textIn(t)).toContain(expected);
});

// The other half: RatingDots (§0.6, task 7) is drawn as circles, not typed, so it can't
// join into the same string the text chips above do — it needs its own middot Text
// between the joined chips and the dots, rendered only when both sides actually exist.
it('middot-separates the text chips from the rating dots, since dots are drawn rather than typed', async () => {
  const d = dive({ durationMin: 44, rating: 3 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const text = textIn(t);
  expect(text).toContain(formatDuration(d.durationMin));
  expect(text).toContain(' · ');
});

// M1c task 6 (DESIGN.md §0.6): ReorderControls puts its arrows in the exact slot
// DepthValue occupies, rather than beside the row, so entering reorder mode does not
// change the row's height. `depthSlot` is the seam that makes that possible without
// ReorderControls re-drawing a dive's number/site/metadata a second way — every test
// above this one already proves the DEFAULT (no `depthSlot`) path still renders
// DepthValue exactly as before; this is the other half: given an override, the depth
// value must actually be GONE, not merely joined by the override, or a row in reorder
// mode would show both and read as broken.
it('lets a caller override the depth slot, hiding the depth value rather than adding beside it', async () => {
  const d = dive({ siteName: 'Blue Hole', maxDepthM: 32.4 });
  const t = await render(
    <DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} depthSlot={<Text>ARROWS</Text>} />,
  );
  const text = textIn(t).join(' ');
  expect(text).toContain('ARROWS');
  expect(text).not.toContain('32.4');
});

// The main point of this task: row height must not change entering reorder mode. This
// test environment has no real layout engine (react-test-renderer never runs Yoga), so a
// pixel height can't be measured directly — what CAN be pinned is the fact this height
// actually depends on: the row's own top-level container style. `depthSlot` only ever
// swaps ONE child inside `diveRowTop`; if it ever grew to also swap in a taller
// container around the whole row, this — not a pixel measurement — is what would catch
// it.
it("keeps the row's own container style identical with or without a depthSlot override", async () => {
  const d = dive({ siteName: 'Blue Hole', maxDepthM: 32.4 });
  const plain = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const withSlot = await render(
    <DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} depthSlot={<Text>ARROWS</Text>} />,
  );
  if (!plain.root || !withSlot.root) throw new Error('DiveRow did not render a root element');
  expect(withSlot.root.props.style).toEqual(plain.root.props.style);
});

// DESIGN.md §0.6 ("Chrome the type scale does not cover"): dive rows had no borders at
// all, so a list of them read as "one undifferentiated column." A hairline on
// `theme.border` gives the eye an edge to stop at — between one row and the next, and
// under a trip group's own first row too, since that is where the group's header (or, for
// a hand-orderable day, its DayStrip) closes off against the data beneath it.
//
// M1c closing fixes: this used to assert `borderBottomWidth`, which is exactly the "an
// assertion that a border exists would pass on either edge" trap — the row briefly shipped
// the hairline on the BOTTOM edge (M1c task 7) and this test kept passing throughout,
// because it only ever checked "some border, some colour", never which edge. It now also
// asserts `borderBottomWidth` is ABSENT, so reverting to the bottom edge reddens this test
// directly instead of leaving it silently correct on the wrong property.
it('gives the row a hairline border on theme.border, on its TOP edge specifically', async () => {
  const t = await render(<DiveRow dive={dive({ maxDepthM: 12 })} number={1} scheme="dark" onPress={() => {}} />);
  if (!t.root) throw new Error('DiveRow did not render a root element');
  const style = [t.root.props.style].flat(3).filter(Boolean);
  expect(style.some((s) => typeof s?.borderTopWidth === 'number' && s.borderTopWidth > 0)).toBe(true);
  expect(style.some((s) => s?.borderTopColor === themeFor('dark').border)).toBe(true);
  // Not just "no OTHER edge happens to be set" — the bottom-edge properties specifically,
  // the ones this row carried before the fix, must be gone.
  expect(style.some((s) => typeof s?.borderBottomWidth === 'number' && s.borderBottomWidth > 0)).toBe(false);
  expect(style.some((s) => s?.borderBottomColor !== undefined)).toBe(false);
});

it("recolours the row's top hairline for the light scheme rather than carrying a fixed colour", async () => {
  const t = await render(<DiveRow dive={dive({ maxDepthM: 12 })} number={1} scheme="light" onPress={() => {}} />);
  if (!t.root) throw new Error('DiveRow did not render a root element');
  const style = [t.root.props.style].flat(3).filter(Boolean);
  expect(style.some((s) => s?.borderTopColor === themeFor('light').border)).toBe(true);
  expect(style.some((s) => s?.borderTopColor === themeFor('dark').border)).toBe(false);
});

// DESIGN.md §0.6 ("Chrome the type scale does not cover" / M1c task 7): '●' and '○' render
// at different sizes in almost every typeface — exactly what the owner saw in the running
// app — so a rating is now drawn as RATING_MAX small circles, filled or outlined, rather
// than typed. `styles.ratingDot` is the one style every dot (filled or not) carries, so
// matching on it (rather than e.g. guessing at borderRadius) finds exactly the five dots
// regardless of which are filled.
describe('rating, drawn as circles rather than typed glyphs', () => {
  function findDots(t: RenderResult, scheme: 'dark' | 'light' = 'dark') {
    const styles = makeStyles(scheme);
    if (!t.root) throw new Error('DiveRow did not render a root element');
    return t.root.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.ratingDot));
  }

  function isFilled(node: ReturnType<typeof findDots>[number], scheme: 'dark' | 'light' = 'dark') {
    const styles = makeStyles(scheme);
    return [node.props.style].flat(3).includes(styles.ratingDotFilled);
  }

  it('renders no rating dots when the dive has no rating', async () => {
    const t = await render(<DiveRow dive={dive({ maxDepthM: 12 })} number={1} scheme="dark" onPress={() => {}} />);
    expect(findDots(t)).toHaveLength(0);
  });

  it('draws exactly RATING_MAX dots, filling only up to the rating', async () => {
    const t = await render(<DiveRow dive={dive({ rating: 3 })} number={1} scheme="dark" onPress={() => {}} />);
    const dots = findDots(t);
    expect(dots).toHaveLength(5);
    expect(dots.filter((d) => isFilled(d))).toHaveLength(3);
  });

  // The trap this task's own brief names: a test that only counts "5 marks rendered" would
  // pass whether or not the two states are the same size, since a typed '●'/'○' pair would
  // also produce 5 marks — it's the SIZE difference between those two glyphs that broke,
  // not their count. This asserts the actual property that broke: a filled dot and an
  // empty dot must report the identical width and height, not merely both be "some size".
  it('gives filled and empty marks identical dimensions, the property the two glyphs broke', async () => {
    const t = await render(<DiveRow dive={dive({ rating: 2 })} number={1} scheme="dark" onPress={() => {}} />);
    const dots = findDots(t);
    const filled = dots.find((d) => isFilled(d));
    const empty = dots.find((d) => !isFilled(d));
    if (!filled || !empty) throw new Error('expected both a filled and an empty dot at rating 2');

    const dims = (n: (typeof dots)[number]) => {
      const style = [n.props.style].flat(3).filter(Boolean);
      return {
        width: style.reduce((a: unknown, s: any) => s?.width ?? a, undefined),
        height: style.reduce((a: unknown, s: any) => s?.height ?? a, undefined),
      };
    };
    expect(dims(filled).width).toBeGreaterThan(0);
    expect(dims(filled).height).toBeGreaterThan(0);
    expect(dims(filled)).toEqual(dims(empty));
  });

  // §0.1: colour encodes depth and nothing else — controls (and this row-metadata chip)
  // stay monochrome. Proven the same relative way DayStrip.test.tsx proves it: every dot's
  // own ink is the theme's plain `fg`, never a depth-band hue.
  it('keeps rating marks monochrome, in the theme ink rather than any depth colour', async () => {
    const theme = themeFor('dark');
    const t = await render(<DiveRow dive={dive({ rating: 5 })} number={1} scheme="dark" onPress={() => {}} />);
    const dots = findDots(t);
    expect(dots).toHaveLength(5);
    for (const d of dots) {
      const style = [d.props.style].flat(3).filter(Boolean);
      const bg = style.reduce((a: unknown, s: any) => s?.backgroundColor ?? a, undefined);
      const border = style.reduce((a: unknown, s: any) => s?.borderColor ?? a, undefined);
      expect(bg === theme.fg || border === theme.fg).toBe(true);
    }
  });
});
