import { fonts } from './fonts';
import { themeFor } from './resolve';
import { makeStyles, screenBottomInset, screenTopInset } from './styles';
import { depthScale } from './tokens';

// makeStyles(scheme) is called on every render (see src/screens/DivesScreen.tsx). If it built a
// fresh StyleSheet each time, `styles` would get a new object identity on every render,
// defeating React.memo on any component that receives it as a prop — invisible with two
// screens, a real cost once a FlashList of dive rows depends on it. The sheets must be
// built once per scheme and handed back by reference, so this pins reference equality,
// not just deep equality (two different objects with the same shape would still fail
// React.memo's shallow prop comparison).
describe('makeStyles', () => {
  it('returns the same object reference for repeated calls with the same scheme', () => {
    expect(makeStyles('dark')).toBe(makeStyles('dark'));
    expect(makeStyles('light')).toBe(makeStyles('light'));
  });

  it('still returns a different sheet for a different scheme', () => {
    expect(makeStyles('dark')).not.toBe(makeStyles('light'));
  });
});

// DESIGN.md §0.5: "Tap targets never below 48 dp." A style that says `minHeight: 48` is
// claiming to meet that floor, and a negative vertical margin on the same style takes it
// straight back: the parent lays the view out at `48 + marginTop + marginBottom` and the
// view's own bounds overhang that box, while a touch only ever reaches a view whose every
// ancestor contains the point too. `formStatus` carried `marginVertical: -8` under a
// comment saying the tap target "stays 48 dp" — it was 32.
//
// Swept across the whole sheet rather than asserted for that one style, because the shape
// is a general one and the next control to want a compact row will reach for the same
// trick: this is a property of the design system, not a fact about one form control.
describe('the 48 dp floor a style claims is a floor it keeps', () => {
  const negativeVerticalMargin = (style: Record<string, unknown>) =>
    [style.marginVertical, style.marginTop, style.marginBottom].filter(
      (value): value is number => typeof value === 'number' && value < 0,
    );

  it.each(['dark', 'light'] as const)('never shrinks a 48 dp box with a negative margin (%s)', (scheme) => {
    const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
    const claiming48 = Object.entries(sheet).filter(([, style]) => style?.minHeight === 48);
    // The sweep is worth nothing if it sweeps nothing: several controls declare this floor,
    // and a sheet where none did would pass every assertion below by vacuity.
    expect(claiming48.length).toBeGreaterThan(3);
    const shrunk = claiming48
      .filter(([, style]) => negativeVerticalMargin(style).length > 0)
      .map(([name]) => name);
    expect(shrunk).toEqual([]);
  });

  /**
   * **Every control drawn as a small pill inside a bigger target keeps the target** (M3c).
   *
   * §0.6's day strip, §2.4's *Complete dive*, the form's Logged/Planned control and the Map's
   * *All centres* all use one shape: `actionPill` nested inside a `Pressable` whose own box is
   * §0.5's 48 dp floor — "small visible control, generous hidden target". The pill itself is
   * 11 pt of label and ~26 dp tall, so **the floor is the only thing making any of them
   * pressable by a wet thumb**, and nothing was checking it: the sweep above only refuses a
   * negative margin on a box that already claims 48.
   *
   * Swept by NAME rather than listed, on this file's own rule: a style `X` whose sibling
   * `XPill` exists is one of these pairs by construction, so a fifth arrives already covered
   * and a fifth that forgot the floor fails here rather than shipping.
   */
  it.each(['dark', 'light'] as const)('gives every pill control a 48 dp box to sit in (%s)', (scheme) => {
    const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
    const pairs = Object.keys(sheet).filter((name) => sheet[`${name}Pill`] !== undefined);
    // Vacuity check, exactly as above: a sheet with no such pairs would pass by saying nothing.
    expect(pairs.length).toBeGreaterThan(3);
    const short = pairs.filter(
      (name) => sheet[name]?.minHeight !== 48 || sheet[name]?.minWidth !== 48,
    );
    expect(short).toEqual([]);
  });
});

// Every field on the dive form (FormField.tsx, DateTimeField.tsx, OptionChips /
// EquipmentTokenField in DiveFormScreen.tsx) is one CONTROL row: §0.6's clear control, a
// picker field's `×`, one accessory's Yes/No chip and the field's own input all land in it. The two `×`
// controls reach §0.5's floor through `hitSlop`, and hitSlop is delivered only inside the
// ancestors — so the row's own height is what decides whether those targets exist at all.
// Pinned here rather than left implicit: this is the value both components' hitSlop
// comments depend on, and it was 24 dp while they claimed 48.
//
// The floor moved from `formFieldHeader` (the label row above a bordered input) to
// `formField` itself when §0.6's design pass collapsed the two into one row — same floor,
// same reason, one row instead of two.
/**
 * **A map mark is its own tap target** (M3c, measured on a device).
 *
 * Each mark used to sit in a transparent 48 dp box, written to meet §0.5's floor the way
 * `capsuleGlyph` does for a capsule. An `MKAnnotationView` is hit-tested over the mark it
 * actually draws, so that box bought nothing and the 14 pt community dot could not be pressed at
 * all — on a mocked map nothing could have said so, since it measures no view and produces no
 * gesture.
 *
 * What is left to pin from here is the half a stylesheet can see: **the two marks are the same
 * size**, so whichever one a layer draws, a press lands on the same thing. A dot quietly shrunk
 * back below the badge is the defect returning.
 */
describe('a map mark', () => {
  it.each(['dark', 'light'] as const)('draws both marks at one size, which is what a press hits (%s)', (scheme) => {
    const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
    const dot = sheet.mapMarkDot?.width;
    expect(typeof dot).toBe('number');
    expect(dot).toBe(sheet.mapMarkDot?.height);
    expect(dot).toBe(sheet.mapMarkBadge?.height);
    // The badge grows with a three-digit count, so its width is a MINIMUM rather than a size.
    expect(sheet.mapMarkBadge?.minWidth).toBe(dot);
    // 26 rather than 48, which is §0.5's floor and is deliberately not met here: a 48 pt disc on
    // a map covers the place it is marking. Asserted as an upper bound so that "make it bigger
    // until it is pressable" cannot creep back the other way without a decision.
    expect(dot).toBeLessThan(48);
  });
});

describe('the form field row', () => {
  it('is tall enough for the controls that sit in it', () => {
    expect(makeStyles('dark').formField.minHeight).toBe(48);
  });

  // ...and the LABEL/VALUE line inside it carries the floor too, which neither of the two
  // above implies. A field whose value trails gets there for free: the input's own 48 sets
  // the line's height, `formField` centres it, and the label lands 24 below the hairline. A
  // field whose value is STACKED underneath — `OptionChips`, notes, an opened picker — has
  // content past 48 already, so the centring does nothing and the line collapsed to the
  // height of the label text: *Units* sat 10 below Settings' first hairline, touching it,
  // while *Dives before Ponor* under it sat at 24 (reported on the running app). Tied to the
  // input's own floor rather than to a retyped 48, because they are the same floor: the row
  // has to be at least as tall as the tallest thing that can sit in it.
  it('holds the label line at that floor too, so a stacked field keeps its label off the rule', () => {
    const styles = makeStyles('dark');
    expect(styles.formFieldRow.minHeight).toBe(styles.formFieldInput.minHeight);
    expect(styles.formFieldRow.minHeight).toBe(styles.formField.minHeight);
  });

  // ...and the input inside it reaches the floor too, which the row's own height does not
  // imply: a `TextInput` shorter than its row leaves the rest of that row inert, so a diver
  // aiming at the field's top or bottom third focuses nothing. Both halves are needed —
  // vertical padding on the row would satisfy the assertion above while breaking this one.
  it('gives the input the same floor, so the whole row focuses the field', () => {
    expect(makeStyles('dark').formFieldInput.minHeight).toBe(48);
    // No vertical padding on the row, in any of its three spellings: padding there would
    // hold the row at 48 while pushing the input — the thing a diver taps to start typing —
    // below the floor, which is exactly the shape `da2769f` found in four controls at once.
    const row = makeStyles('dark').formField as unknown as Record<string, unknown>;
    expect(row.paddingVertical ?? 0).toBe(0);
    expect(row.paddingTop ?? 0).toBe(0);
    expect(row.paddingBottom ?? 0).toBe(0);
  });
});

// The reorder arrows are the same arrangement one screen over: a 34 x 26 visible box
// reaching 48 dp through hitSlop, inside a container that has to be big enough to deliver
// it. `ARROW_HIT_SLOP` (ReorderControls.tsx) is 11 vertical / 7 horizontal.
describe('the reorder arrows row', () => {
  it('holds the slop its buttons declare, vertically and at both ends', () => {
    const arrows = makeStyles('dark').reorderArrows;
    expect(arrows.minHeight).toBeGreaterThanOrEqual(26 + 11 * 2);
    expect(arrows.paddingHorizontal).toBeGreaterThanOrEqual(7);
  });

  it('keeps the two buttons far enough apart that their slop cannot overlap', () => {
    // Facing slops of 7 need 14 between the boxes. Any less and the down arrow — drawn
    // later, so hit-tested first — would take presses aimed at the up arrow, which is the
    // worst possible failure for a control whose whole job is direction.
    expect(makeStyles('dark').reorderArrows.gap).toBeGreaterThanOrEqual(7 * 2);
  });
});

// **The rating dots begin in the form's leading column, like every other row's contents.**
// §0.6 puts the chips and the dots in the same slot — a field's second line — and a field's
// contents start at its own inset; `formRatingRow`'s comment says so in words ("it starts at
// the leading edge under its own label") and, until a review measured it on a device, it did
// not: each dot is centred inside its 48 dp target (§0.5's floor per dot, since each dot is a
// control), so the first dot's ink sat 15 dp right of the label above it and of every chip on
// the form.
//
// Pinned here, as a RELATIONSHIP between the three styles rather than as the number `-15`,
// because the number is not the rule: the rule is that the row gives back exactly the slack
// its own targets take, so resizing a dot or a target cannot silently reintroduce the indent.
// A geometry defect is otherwise invisible in review — every one of the three styles reads
// correctly on its own, and the offset only exists between them.
describe('the form rating row', () => {
  it.each(['dark', 'light'] as const)('starts its first dot where the label above it starts (%s)', (scheme) => {
    const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
    const target = Number(sheet.ratingTarget?.width);
    const dot = Number(sheet.ratingDotField?.width);
    const slack = (target - dot) / 2;
    // The centring is real — a target the size of its dot would make this whole rule moot and
    // the assertion below pass on zero.
    expect(slack).toBeGreaterThan(0);
    expect(sheet.formRatingRow?.marginLeft).toBe(-slack);
  });

  it.each(['dark', 'light'] as const)('is a leading row, not a centred or trailing one (%s)', (scheme) => {
    // The other way to lose the alignment, and the one that is a single word rather than a
    // measurement: `justifyContent: 'center'` on this row re-centres all five targets in the
    // field's width and moves the offset above from a correction into a new error. Five 48 dp
    // targets are laid out to fit without wrapping (see the style's own comment), so nothing
    // here ever needs a distribution rule — the absence is the design.
    const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
    expect(sheet.formRatingRow?.justifyContent ?? 'flex-start').toBe('flex-start');
  });
});

// DESIGN.md §4.1: what a screen calls itself is one rule, so it has one owner. Three screens
// draw a title — the dive form, Settings, and the Dives list — and the face, size and ink of
// all three come from one `screenHeading` definition; each screen supplies only the column it
// indents to, which genuinely differs (the form and Settings use the form row's 20, the Dives
// list its own rows' 16). Pinned as agreement rather than as values, so the three can still
// be restyled together and can no longer drift apart one at a time.
//
// The Dives list's title is a native LARGE title now — it lives in the scroll content and
// scrolls away — and it still reads at this one size rather than at UIKit's 34: taking that
// would have split this rule three ways for one screen.
describe('a screen title', () => {
  it('reads the same on every screen that draws one', () => {
    const styles = makeStyles('dark');
    const dives = styles.divesTitle as Record<string, unknown>;
    for (const other of [
      styles.formHeading,
      styles.settingsHeading,
      styles.presetHeading,
      // M2e. A sign-in screen is where a title quietly grows a size of its own, because every
      // app has one and none of them is this app.
      styles.accountHeading,
    ] as Record<string, unknown>[]) {
      expect(dives.fontFamily).toBe(other.fontFamily);
      expect(dives.fontSize).toBe(other.fontSize);
      expect(dives.color).toBe(other.color);
    }
  });

  // A title with nothing on its line must not carry the `flex: 1` that lets one wrap beside a
  // control (§0.5's Czech): the form's heading shares its line with §2.4's Logged/Planned
  // control and needs it, Settings' and the Dives list's have the line to themselves and
  // would be claiming membership of a row they are not in. Written as the contrast rather
  // than as two separate assertions, since it is the difference that is the rule.
  it('takes the wrapping flex only where something shares its line', () => {
    const styles = makeStyles('dark');
    expect((styles.formHeading as Record<string, unknown>).flex).toBe(1);
    expect((styles.divesTitle as Record<string, unknown>).flex).toBeUndefined();
    expect((styles.settingsHeading as Record<string, unknown>).flex).toBeUndefined();
    expect((styles.accountHeading as Record<string, unknown>).flex).toBeUndefined();
  });
});

// **Where the top of a screen is — one owner, one answer** (DESIGN.md §4.1). The Dives
// screen got this rule first, in the pinned bar it has since lost, and the other five roots
// kept the sheet's flat 48 for a release, which is INSIDE the safe area on a Dynamic Island
// phone: measured on an
// iPhone 17 Pro, the capsule sat at 62 pt (exactly where iOS 26's Files puts its trailing
// `•••`) while "Settings" sat at 56.3 and crowded the island. Two screens of one app
// disagreeing about where the top is, and only one agreeing with iOS.
//
// The helper is what these tests pin, deliberately: it is the rule, and it is a pure
// function of the device's inset. Restating each screen's resulting padding here would be
// six assertions that can only fail by being edited, and none of them would have caught the
// defect — every one of the six was green while Settings was 5.7 pt too high.
describe('the screen top inset', () => {
  // Pinned as the RULE (the greater of the device's inset and the app's own floor) rather
  // than as 62, which is one phone's answer: a hard-coded 62 would be wrong on every device
  // without an island, and is the reason this is a function of `insets.top` at all.
  it('clears the greater of the device safe area and the app floor', () => {
    // A Dynamic Island phone (iPhone 17 Pro reports 62): the device wins, and the app lands
    // on the same line iOS 26's own apps use.
    expect(screenTopInset(62)).toBe(62);
    // A notched phone, an iPad (24) and an iPhone SE (20): the app's own floor wins, so
    // nothing moves from where it has sat since M0, and the wide layout's two columns stay
    // aligned (the list column's bar and the detail pane beside it ask this same function).
    expect(screenTopInset(47)).toBe(48);
    expect(screenTopInset(24)).toBe(48);
    expect(screenTopInset(0)).toBe(48);
    // It is a floor, not a clamp: a device with a deeper inset than any shipped today gets
    // its own clearance rather than being cropped back to 48.
    expect(screenTopInset(100)).toBe(100);
  });

  // **The second implementation, as a property of the sheet.** `screen` carried
  // `paddingTop: 48` — a second answer to the question the helper above owns, and the one
  // every screen except Dives was actually getting. It cannot come back quietly: a static
  // number here would silently outrank nothing and silently under-clear an island, whereas
  // its absence forces every root to compose the device's answer in. Asserted as "no top
  // padding at all" rather than as some particular number, because any number here is the
  // defect regardless of which one it is.
  it('is not also written into the sheet, where the device cannot be read', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const screen = makeStyles(scheme).screen as Record<string, unknown>;
      expect(screen.paddingTop).toBeUndefined();
      expect(screen.padding).toBeUndefined();
      expect(screen.paddingVertical).toBeUndefined();
    }
  });
});

// **Where the bottom of a screen is — the other edge, and the same rule** (DESIGN.md §4.1,
// M1h). The empty state's "Log your first dive" sat behind the iOS 26 Liquid Glass tab bar
// for a release: `emptyStateWrap` carried `paddingBottom: 48`, and a screen inside `(tabs)`
// reports 83 pt of bottom safe area on an iPhone 17 Pro — 34 of home indicator plus a 49 pt
// `UITabBar`, measured on the device against the same app's dive form, which is drawn over
// the tabs and reports 34. §0.6 leaves the top-right capsule off the empty logbook on
// purpose, so the hidden button was a first-run diver's only way into the form.
//
// The helper is what these pin, for the reason the top's own tests give: it IS the rule, and
// restating the padding each screen ends up with would be assertions that can only fail by
// being edited. What no assertion in this file can do is SEE a tab bar — that is a fact
// about a real UITabBarController, not about a stylesheet — so these pin the arithmetic and
// DivesScreen.test.tsx pins that the screen actually asks for it.
describe('the screen bottom inset', () => {
  // Pinned as the RULE (the greater of the device's inset and the app's own floor) rather
  // than as 83, which is one phone's answer on one kind of screen.
  it('clears the greater of the device safe area and the app floor', () => {
    // A tab screen on an iPhone 17 Pro: home indicator plus the Liquid Glass bar in front of
    // it, which UIKit reports as one inset. The device wins, and the button clears the bar.
    expect(screenBottomInset(83)).toBe(83);
    // The same phone with no tab bar over the screen (the dive form reports exactly this),
    // and an Android gesture strip: the app's own floor wins.
    expect(screenBottomInset(34)).toBe(48);
    // The browser, where the tab bar is a sibling below the screen and obscures nothing:
    // the empty state keeps the 48 it has had since M0, so nothing moves there.
    expect(screenBottomInset(0)).toBe(48);
    // A floor, not a clamp: a device with a deeper inset than anything shipped today gets
    // its own clearance instead of being cropped back to 48 and hidden all over again.
    expect(screenBottomInset(120)).toBe(120);
  });

  // **The constant, as a property of the sheet.** `emptyStateWrap` held `paddingBottom: 48`
  // — a second answer to the question the helper above owns, and the one the button was
  // actually getting. Asserted as "no bottom padding at all" rather than as some particular
  // number, because any number here is the defect regardless of which one it is: 83 typed
  // into the sheet would look fixed on the one phone it was measured on and be wrong on
  // every other, which is the whole reason this is a function of `insets.bottom`.
  it('is not also written into the sheet, where the device cannot be read', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const wrap = makeStyles(scheme).emptyStateWrap as Record<string, unknown>;
      expect(wrap.paddingBottom).toBeUndefined();
      expect(wrap.padding).toBeUndefined();
      expect(wrap.paddingVertical).toBeUndefined();
    }
  });
});

// **What each scrolling screen meets at its bottom edge, and why one constant could not
// serve two of them** (M1h, DESIGN.md §4.1's "a deliberate near-duplicate names its
// siblings"). `rowScrollContent` carried `paddingBottom: 40` for both the dive form and
// Settings. The form's scroll is a SIBLING ABOVE `formFooter`, which composes
// `insets.bottom + 24` itself, so its frame stops at the footer and 40 is internal spacing.
// Settings' scroll is its root's only child and runs to the bottom of the display, where 40
// is 43 pt short of the 83 a screen inside `(tabs)` reports — a last row under the Liquid
// Glass, invisible only because Settings has too few rows to reach the bottom. The Dives
// list had the same defect at 24 and enough rows to show it.
//
// Written as RELATIONS between the two styles rather than as their numbers: what matters is
// that they agree where they are one rule and differ where they are two, so re-merging them
// fails here, and so does splitting the half that was never in dispute.
describe('what a scrolling screen clears at its bottom edge', () => {
  it('shares the row rhythm between the form and Settings, and nothing about the bottom', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const styles = makeStyles(scheme);
      const form = styles.formScrollContent as Record<string, unknown>;
      const settings = styles.settingsContent as Record<string, unknown>;

      // One rule, and it stays one: both screens are the same column of §0.6 rows, so where
      // their first row starts and how far apart their groups sit must not drift.
      expect(form.paddingTop).toBe(settings.paddingTop);
      expect(form.gap).toBe(settings.gap);

      // Two rules, and they must stay two. The form's bottom is a constant because a footer
      // that already spent the device's inset is what sits below it — reading the safe area
      // there would spend the tab bar twice, in the one place it is already spent.
      expect(typeof form.paddingBottom).toBe('number');
      // Settings' is the device's, so the sheet cannot hold it. Any number here is the
      // defect regardless of which one it is.
      expect(settings.paddingBottom).toBeUndefined();
      expect(settings.paddingVertical).toBeUndefined();
    }
  });

  // **The Dives list's contentContainer is empty on purpose**, and both absences are a defect
  // that has already shipped. `paddingTop` was 60 — clearance for a capsule that floated over
  // the TOP of the list's content. The capsule floats again (M1k) and this must stay 0
  // anyway, because it floats BESIDE the title rather than above it: 60 here would open the
  // list with a hole and push the title back down by more than the pinned bar ever did.
  // `paddingBottom` was 24, described in the sheet as "a last row's breathing room above the
  // tab bar", which is the claim it could not keep: 24 against an 83 pt inset put the last
  // dive 59 pt inside the bar, its site name cut mid-word.
  it('leaves the Dives list no clearance of its own at either end', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const list = makeStyles(scheme).listContent as Record<string, unknown>;
      expect(list.paddingTop ?? 0).toBe(0);
      expect(list.paddingBottom).toBeUndefined();
      expect(list.padding).toBeUndefined();
      expect(list.paddingVertical).toBeUndefined();
    }
  });
});

// The Dives screen's floating capsule (DESIGN.md §0.6 and §10, the owner's call, M1k —
// replacing the pinned bar these tests used to describe). Three properties, and each is a
// defect this screen has already shipped in one direction or the other.
describe('the Dives screen floating capsule', () => {
  // **It floats, and it floats over a corner.** `position: absolute` is what takes it out of
  // flow — in flow it is the bar again, and the title goes back to sitting a bar's height too
  // low. `top: 0` is the region's own top edge (`divesListArea`), which is the title's, so
  // "beside the title" needs no arithmetic and no inset read twice.
  //
  // **No `left` and no `width`**, and that is the half that keeps it a capsule rather than a
  // strip: either one would stretch this wrapper across the screen, which would put an
  // invisible 48 pt band over the full width of the first row — swallowing taps meant for it —
  // and would be the pinned bar rebuilt as an overlay, which is the arrangement §10 rejected.
  it('floats out of flow at the top trailing corner, sized by the capsule and not by the screen', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const float = makeStyles(scheme).capsuleFloat as Record<string, unknown>;
      expect(float.position).toBe('absolute');
      expect(float.top).toBe(0);
      expect(float.left).toBeUndefined();
      expect(float.width).toBeUndefined();
      // ...and it paints nothing. A ground here would be the opaque bar again, drawn over a
      // capsule whose own material is deliberately glass.
      expect(float.backgroundColor).toBeUndefined();
      // The region it floats in is a containing block and nothing else: give it padding or a
      // ground and `top: 0` stops meaning "the title's own top edge".
      expect(makeStyles(scheme).divesListArea).toEqual({ flex: 1 });
    }
  });

  // **The title lands where every other screen's title lands** — the owner's whole complaint
  // (M1k): "Dives" sat a pinned bar's height below "Settings" on the same phone, which nothing
  // could see because each screen's own spacing was correct in isolation. Written as the
  // relation rather than as 4: every root composes `screenTopInset`, so what remains is what
  // each screen puts between that inset and its first line, and the three must agree.
  //
  // The two zeroes are the rest of the sum, and each is a real way to break it: a `paddingTop`
  // on the Dives root's sheet entry (`screen`) would move that screen alone, and one on the
  // list's contentContainer would push the title down inside the scroll.
  it('starts the Dives title the same distance below the safe area as Settings', () => {
    // Every `paddingTop` between a screen's safe-area inset and its title, added up. Written
    // as a sum over the named layers rather than as one lookup, because the two screens reach
    // the same distance through different objects — a scroll's content padding on Settings, the
    // title's own on Dives — and it is the DISTANCE that has to agree.
    const topPadding = (sheet: Record<string, Record<string, unknown>>, keys: readonly string[]) =>
      keys.reduce((total, key) => {
        const value = sheet[key]?.paddingTop;
        return total + (typeof value === 'number' ? value : 0);
      }, 0);

    for (const scheme of ['dark', 'light'] as const) {
      const styles = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const dives = topPadding(styles, ['listContent', 'divesTitle']);
      const settings = topPadding(styles, ['settingsContent', 'settingsHeading']);
      // A sum of two absent paddings is 0 and would agree with anything, including a Dives
      // title that had lost its own spacing entirely.
      expect(dives).toBeGreaterThan(0);
      expect(dives).toBe(settings);
      // Neither screen's ROOT adds any of its own: both compose the device's inset and
      // nothing else (`screen` carries no `paddingTop` at all — the test above pins that).
      expect(styles.screen?.paddingTop).toBeUndefined();
    }
  });

  // The capsule, the large title and the list rows all sit on this screen's own 16 dp column
  // (§0.6), so the capsule's trailing edge lines up with the date ranges it floats near and
  // the title with the trip titles below it. Read off the sheet as a relation, so moving the
  // list's inset moves all of them rather than silently splitting them.
  it('shares the list rows own column with the title beneath it', () => {
    const styles = makeStyles('dark');
    const inset = (styles.capsuleFloat as Record<string, unknown>).right;
    expect(inset).toBe((styles.divesTitle as Record<string, unknown>).paddingHorizontal);
    expect(inset).toBe((styles.tripHeader as Record<string, unknown>).paddingHorizontal);
    expect(inset).toBe((styles.diveRow as Record<string, unknown>).paddingHorizontal);
  });

  // **The capsule reaches past the title, so the header's text column has to stop short of it**
  // (§0.6, M1m — the correction to M1l). The float is 48 pt tall at `top: 0` of the region the
  // title heads and the title's own block is about 36, so the two overlap in the vertical
  // whatever either does; the clearance can only come out of the horizontal. Measured on the
  // device with this cap removed and the sheet's own 128-dive line rendered: the capsule's
  // leading edge is at 281.0 pt and the line's ink ends at 291.3, so it runs 10 pt UNDER the
  // glass. It clears at one dive, which is why this arrives with the diver's hundredth and with
  // nobody's edit — or sooner, in Czech (§0.5: 20–30 % longer).
  //
  // **A relation, not a number, and the capsule's own geometry is what it is read from**: the
  // two glyph boxes, the hairline between them and the capsule's inner padding, summed here the
  // way Yoga sums them rather than restated as the 105 pt they currently make. So widening
  // §0.5's tap floor, or the capsule's padding, moves the requirement — and a hand-typed inset
  // in the sheet fails this the moment either moves, which is the whole reason the sheet derives
  // it. What this cannot see is how many glyphs the capsule holds (a prop, not a style); §3
  // expects a third, and DivesScreen.test.tsx counts the rendered ones against this same sum.
  it('stops the header text column short of the capsule that floats beside it', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const capsuleWidth =
        (sheet.actionCapsulePlain?.paddingHorizontal as number) * 2 +
        (sheet.capsuleGlyph?.width as number) * 2 +
        (sheet.capsuleDivider?.width as number);
      const leadingEdge = (sheet.capsuleFloat?.right as number) + capsuleWidth;
      expect(leadingEdge).toBeGreaterThan(0);

      // Both lines of the header, because the cap is on the COLUMN. `divesSummary` is the line
      // that was rendering behind the glass; `divesTitle` is the one that would if a translation
      // ever made it long, and capping only the line that misbehaves today is how this screen
      // acquires a second answer to one question.
      const short = ['divesTitle', 'divesSummary'].filter((name) => {
        const inset = sheet[name]?.paddingRight;
        return typeof inset !== 'number' || inset < leadingEdge;
      });
      expect(short).toEqual([]);
      // One column, so one cap: two different values would be a visible step between two lines
      // that read as one block.
      expect(sheet.divesSummary?.paddingRight).toBe(sheet.divesTitle?.paddingRight);
      // The LEADING edge is untouched by any of it — still the app's one content column, which
      // is what the sweep further down reads off `paddingHorizontal`.
      expect(sheet.divesTitle?.paddingHorizontal).toBe(sheet.diveRow?.paddingHorizontal);

      // **And the height is not reserved any more.** M1l bought this same clearance out of
      // vertical space — `minHeight: CAPSULE_HEIGHT` on the title, so the line wrapped below the
      // capsule — and the cost, measured on the device either side of the change, was 14 pt of
      // extra gap between "Dives" and the line under it, which was the owner's actual complaint.
      // A `minHeight` reappearing here would pay for the clearance twice and undo the fix while
      // every other assertion above stayed green.
      expect(sheet.divesTitle?.minHeight).toBeUndefined();

      // The glass capsule is the same object on a device that has Liquid Glass, so neither the
      // height nor the padding this width is summed from may differ between the two materials.
      expect(sheet.actionCapsuleGlass?.height).toBe(sheet.actionCapsulePlain?.height);
      expect(sheet.actionCapsuleGlass?.paddingHorizontal).toBe(
        sheet.actionCapsulePlain?.paddingHorizontal,
      );
    }
  });
});

// **The sheet holds no depth colour, anywhere** (DESIGN.md §4.1: "`theme/depth.ts` is the only
// reader of the depth scale"). Swept over every style rather than asserted for the two that
// could plausibly want one, because the shape is general and the tempting version is specific:
// six `depthLegendBar1…6` keys would make the legend a one-liner and would put a second copy of
// the palette in a file that has no way to know a band from a depth. The same edit reaches for
// `depthValue` every time somebody notices it carries no colour.
//
// This is also the half `unexpectedGraphics` cannot see: that guard checks what a screen
// composes at a call site, and a hue baked into the sheet is by definition a style the sheet
// handed out.
describe('the depth scale and the stylesheet', () => {
  it('keeps every band colour out of the sheet, in both schemes', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const palette: readonly string[] = [...depthScale.dark, ...depthScale.light];
      const painted = Object.entries(makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>)
        .filter(([, style]) =>
          Object.values(style).some((value) => typeof value === 'string' && palette.includes(value)),
        )
        .map(([name]) => name);
      expect(painted).toEqual([]);
    }
  });

  // The two styles that are drawn in a band colour and must therefore carry none: the legend's
  // swatch and the dive row's depth. Each is completed at its call site out of `theme/depth.ts`,
  // and an absence is what makes that the only way to complete it.
  it('leaves the swatch and the depth value uncoloured, for the call site to finish', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const styles = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      expect(styles.depthLegendBar?.backgroundColor).toBeUndefined();
      expect(styles.depthValue?.color).toBeUndefined();
    }
  });
});

// **The mark is monochrome, and the sheet is where that is decided** (§0.1, M1h). §0.3 strokes
// the same shape in the depth gradient ON THE APP ICON; on screen that would be colour used as
// brand, on the one screen whose job is teaching that colour is only ever depth. The asset is
// single-colour before any tint (scripts/build-icons.mjs), and this is the other half: the ink
// it is tinted with is a theme token and not a band.
describe('the first-run mark', () => {
  it('is drawn in the theme ink, at half strength, in both themes', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const mark = makeStyles(scheme).emptyStateMark as Record<string, unknown>;
      expect(mark.tintColor).toBe(themeFor(scheme).fg);
      // Half strength — the owner's drawing. Pinned as "quieter than the ink", not as 0.5
      // exactly, because the number is a design judgement and the rule is that the mark
      // recedes behind the legend it introduces.
      expect(typeof mark.opacity).toBe('number');
      expect(mark.opacity as number).toBeGreaterThan(0);
      expect(mark.opacity as number).toBeLessThan(1);
    }
  });

  // **The mark gets more air beneath it than the block's own rhythm gives** (M1l, the owner:
  // *"the icon/logo should have a bit higher bottom padding"*). Every seam in the first-run
  // block is `emptyStateContent`'s one `gap`; under a 120 pt graphic that read as the mark
  // being the first item of the list it heads rather than the thing the page opens with.
  //
  // **Two halves, and the second one is what a first draft of this test missed.** Deleting the
  // mark's `marginBottom` is the obvious way to lose this; raising the container's `gap` to 32
  // is the *plausible* way, and it passed the version of this test that only asked whether the
  // mark's seam was bigger than the rhythm — because that mutation grows both. It answers a
  // different request: the legend drifts from the caption that explains it and the label from
  // the mark it names, to fix one seam.
  //
  // So the block's rhythm is bounded as well as compared against. A band rather than the exact
  // 16, because the number is a spacing judgement and the RULE is that the block runs on a text
  // rhythm with the graphic's clearance as its one exception — 32 pt between two lines of
  // caption is not a rhythm, it is this property having been used to do the mark's job.
  it('gives the mark more clearance beneath it than the block gives its other seams', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const gap = sheet.emptyStateContent?.gap;
      expect(typeof gap).toBe('number');
      const extra = sheet.emptyStateMark?.marginBottom ?? 0;
      expect(typeof extra).toBe('number');
      // The mark's seam is meaningfully the wider one, not wider by a point.
      expect((extra as number) + (gap as number)).toBeGreaterThan((gap as number) * 1.4);
      // ...and every other seam is still a seam between two lines of type.
      expect(gap as number).toBeLessThanOrEqual(20);
    }
  });

  // **The prose has a measure** (M1l, the owner: *"the text lines should not go for full
  // width"*). The first-run screen is the only place in Ponor that sets running prose, and both
  // of its blocks — §1's promise and the two-line reason under the legend — ran the whole
  // column.
  //
  // Three claims, and the middle one is the one a lazy fix passes: a `maxWidth` that exists,
  // that actually constrains on the phone the owner is looking at, and that is the SAME on both
  // blocks. `maxWidth: 9999` is a real number and a real property and constrains nothing;
  // measuring it against a known content width is what makes this a test rather than a
  // spelling check.
  it('holds both prose blocks to one measure narrower than the screen', () => {
    // An iPhone 17 Pro is 402 pt wide, and the first-run block sits in the app's content
    // column on both sides — so this is the width a line would take with no measure at all.
    const sheet = makeStyles('light') as unknown as Record<string, Record<string, unknown>>;
    const column = sheet.diveRow?.paddingHorizontal as number;
    const fullWidth = 402 - 2 * column;

    for (const scheme of ['dark', 'light'] as const) {
      const themed = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const measure = themed.emptyStateText?.maxWidth;
      expect(typeof measure).toBe('number');
      expect(measure as number).toBeLessThan(fullWidth);
      // Not so narrow that the block becomes a ribbon: the request was to stop the line
      // running edge to edge, not to break it every few words.
      expect(measure as number).toBeGreaterThan(fullWidth / 2);
      // One measure, not two. The reason lines sit directly under the paragraph, so two
      // different right edges would be the four-point step this screen has already paid for
      // once, on the other side.
      expect(themed.emptyStateReason?.maxWidth).toBe(measure);
    }
  });

  it('says NOTHING LOGGED YET in the same cluster-label treatment the other two screens use', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const styles = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const label = styles.emptyStateLabel ?? {};
      const detail = styles.detailClusterTitle ?? {};
      // §0.6 introduced the shared definition because *Conditions* and *Gas & cylinders* carried
      // two treatments for one thing. A third call site retyping 10.5/uppercase/+0.14 em is the
      // same defect with a third spelling, so this compares the treatment rather than the
      // numbers — the detail screen's own margin is the only thing that may differ.
      for (const key of ['fontFamily', 'fontSize', 'color', 'textTransform', 'letterSpacing']) {
        expect(label[key]).toBe(detail[key]);
      }
    }
  });
});

// **The first-run block hangs off one edge** (M1h, the owner's drawing, settled against the
// build). The first version centred it — mark, cluster label, paragraph, legend and both reason
// lines — and that was the one visible departure from the design: every other screen in Ponor
// hangs its content off a single column, so a centred block is the one place the eye has to find
// a new starting point.
//
// Swept over the whole first-run block rather than asserted for the container, because the way
// this breaks is a MIXTURE and not a reversal: somebody adds a caption, reaches for
// `textAlign: 'center'` because a first-run screen "usually is", and the screen ends up with two
// left edges. Nothing about the rendering looks broken; it just stops being one composition.
describe('the first-run block alignment', () => {
  // Every style this screen draws text with. Listed rather than derived from a prefix, because
  // the legend's own two are not named `emptyState*` and are exactly the ones a sweep by name
  // would miss — the same reason `unexpectedGraphics` names its exemptions instead of matching
  // them.
  const FIRST_RUN_TEXT = ['emptyStateLabel', 'emptyStateText', 'emptyStateReason', 'depthLegendLabel'];

  it('starts every line of it at the same edge, in both schemes', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const container = sheet.emptyStateContent ?? {};
      expect(container.alignItems).toBe('flex-start');
      // The sweep is worth nothing if it sweeps nothing — a renamed style would otherwise leave
      // this passing over an empty list.
      const found = FIRST_RUN_TEXT.filter((name) => sheet[name] !== undefined);
      expect(found).toEqual(FIRST_RUN_TEXT);
      const centred = found.filter((name) => sheet[name]?.textAlign === 'center');
      expect(centred).toEqual([]);
    }
  });

  // **The legend has to claim the width the container stopped handing out**, and this is one
  // relation rather than two facts. While the block was centred, a legend with no `alignSelf`
  // was at least centred at its content width; under `flex-start` its six `flex: 1` columns have
  // nothing to divide and the whole scale collapses to the width of its six labels. So the two
  // properties are asserted together: change the container's alignment without the legend's and
  // this fails, which is the point at which somebody would otherwise ship a squashed scale.
  it('still lets the legend span that column, which a sized child would not', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      expect(sheet.emptyStateContent?.alignItems).toBe('flex-start');
      expect(sheet.depthLegend?.alignSelf).toBe('stretch');
    }
  });

  // **And it is the SAME edge as the title above it.** `emptyStateWrap` carried
  // `paddingHorizontal: 20` from M0, when the whole screen was a sentence and a button with
  // nothing over them to line up with; the title and the summary sit at 16, so the first-run
  // block hung four points inboard of the heading it belongs to — the mark's ink at 20.00 pt
  // against "0 dives" at ≈16.7, measured on the device. A centred block has no left edge to
  // disagree with, which is why left-aligning is what exposed it.
  //
  // Written as a RELATION, because the rule is "one column on this screen" and not "16": move
  // the Dives title's inset and this requires the block to follow rather than quietly
  // reintroducing the step at a new width.
  it('shares the Dives title own column, so the screen has one left edge', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const column = sheet.divesTitle?.paddingHorizontal;
      expect(typeof column).toBe('number');
      expect(sheet.divesSummary?.paddingHorizontal).toBe(column);
      expect(sheet.emptyStateWrap?.paddingHorizontal).toBe(column);
    }
  });
});

// **One content column, across every screen** (M1l, the owner: *"I think there is no reason to
// have them different"*).
//
// The app had two: the Dives list, its title and the dive detail's hero at 16, and the form,
// Settings and the detail's own clusters at 20 through a constant called `FORM_ROW_INSET`. The
// owner found it by putting the Dives title beside Settings'; M1d had already found the same
// 4 pt step inside one screen, between the detail's back control and the hero title under it,
// and fixed that one control alone.
//
// **This is the assertion the whole suite was missing.** Moving every one of these from 20 to
// 16 — the change this test exists for — left 1654 tests green, because a 4 pt inset is a
// layout fact and Jest has no layout: nothing rendered, nothing measured, nothing compared. A
// sheet-level relation is the only place it can be caught, which is the same trade
// `screenBottomInset`'s own tests make about a tab bar no unit test can see.
//
// **Written as a relation to the list's own row, not against the number 16.** The rule is "one
// column", so moving `diveRow` moves all of them; retyping the number here would let two of
// these drift to a new shared value while this test agreed with a copy of the old one.
describe('the app content column', () => {
  // **Every style in the sheet that pads horizontally and is NOT this rule**, so the sweep
  // below can be over the sheet itself rather than over a list of names.
  //
  // That direction matters, and a hand-listed set of column members is what it replaces:
  // dropping a name from such a list shortens the expectation as well as the sweep, so the
  // list can quietly stop covering a screen while staying green — this project's most-repeated
  // defect, and a mutation deleting one name from it passed. Swept from the sheet, a new style
  // at some other inset fails until somebody puts it here on purpose, which is the deliberate
  // act the test exists to force. `unexpectedGraphics` is the same shape: sweep everything,
  // name the exemptions.
  //
  // Each of these is a distance INSIDE an object rather than where a screen's content begins —
  // a button's own label padding, a pill's, a glyph capsule's, a notice's inner padding (its
  // OUTER margin is the column, asserted below), a centred message's breathing room, the search
  // screen's bottom dock.
  const NOT_THE_COLUMN = [
    'action',
    'centerFill',
    'searchDock',
    'searchCapsuleGlass',
    'searchCapsulePlain',
    'actionCapsuleGlass',
    'actionCapsulePlain',
    'reorderArrows',
    'dayStripAction',
    'dayStripActionPill',
    'plannedAction',
    'plannedActionPill',
    'detailComplete',
    'detailCompletePill',
    'detailDeleteError',
    'formStatus',
    'formStatusPill',
    'formChip',
    'formPresetAction',
    'formSaveError',
    'reorderNotice',
    'settingsNotice',
    'presetNotice',
    // A map mark's own pill: the padding inside the badge that holds a dive count, at map
    // scale. Nothing about it is where a screen's content begins — it is not on a screen's
    // column at all, it is on Apple's cartography.
    'mapMarkBadge',
    // The centres layer's *All centres* control (M3c): the 48 dp target around its pill, and the
    // pill's own label padding. Both are distances INSIDE the control — `mapCentersRow` is the
    // one that says where it begins, and that is in the column and asserted below.
    'mapCentersAction',
    'mapCentersActionPill',
  ];

  // The surfaces this is about, named so the test says which screens it is claiming — the
  // Dives list, the first-run screen, the dive detail, the form, Settings and the preset
  // editor. This half catches a rename or a deletion; the sweep above catches a drift, and
  // catches it whether or not anyone remembered to add the style here.
  const COLUMN = [
    'divesTitle',
    'divesSummary',
    'tripHeader',
    'diveRow',
    'dayStrip',
    'plannedActions',
    'emptyStateWrap',
    'detailHero',
    'detailBack',
    'detailAction',
    'detailContent',
    'formHeadingRow',
    'formCarriedNote',
    'formField',
    'formGroupHeader',
    'formFieldError',
    'formBack',
    'formFooter',
    'formPresetActions',
    'presetHeading',
    'settingsHeading',
    'settingsCaption',
    'settingsSectionTitle',
    'settingsPresetEmpty',
    // The Map tab (M2n): its title and the layer line under it, and the three blocks of the
    // sheet a tapped site opens. The sheet is a panel over the map rather than a screen, and it
    // still hangs off the app's one column — a site's name starting 4 pt inboard of the dive
    // rows listed beneath it is exactly the step M1l found between Dives and Settings.
    'mapTitle',
    'mapSummary',
    'mapSheetHeader',
    'mapSheetSummary',
    'mapSheetFacts',
    // The centres layer's way into the directory (M3c) and the two screens behind it. A control
    // under the layer's summary line hangs off the same column that line does, and a centre's
    // page and the directory are ordinary row screens — Settings' shape, Settings' column.
    'mapCentersRow',
    'centerHeading',
    'centerSummary',
    'centerSectionTitle',
    'centerEmpty',
    'centersHeading',
  ];

  it('starts every screen content at the same edge, in both schemes', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const column = sheet.diveRow?.paddingHorizontal;
      expect(typeof column).toBe('number');

      // The named surfaces still exist and are in it. A renamed or deleted style shows up here
      // rather than silently leaving the set.
      const found = COLUMN.filter((name) => sheet[name] !== undefined);
      expect(found).toEqual(COLUMN);
      expect(COLUMN.filter((name) => sheet[name]?.paddingHorizontal !== column)).toEqual([]);

      // ...and nothing else in the whole sheet pads horizontally to some other number without
      // being named as an inside-an-object distance. This is the half that does not depend on
      // the list above being complete.
      const strays = Object.entries(sheet)
        .filter(([name, style]) => !NOT_THE_COLUMN.includes(name) && style?.paddingHorizontal !== undefined)
        .filter(([, style]) => style.paddingHorizontal !== column)
        .map(([name]) => name);
      expect(strays).toEqual([]);
    }
  });

  // A notice banner is a card, so its INNER padding is its own; what has to sit in the column
  // is its outer edge, or a failed-read banner hangs four points inboard of the rows it is
  // reporting on. `detailDeleteError` is deliberately not here — it lives inside
  // `detailContent`, which already pads, and carries `marginHorizontal: 0` for that reason.
  it('lands a notice banner outer edge on that column too', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const column = sheet.diveRow?.paddingHorizontal;
      for (const name of ['reorderNotice', 'settingsNotice', 'syncNotice', 'formSaveError', 'presetNotice']) {
        expect([name, sheet[name]?.marginHorizontal]).toEqual([name, column]);
      }
    }
  });

  // **Which styles override that column's own trailing edge, named** (M1m). `paddingHorizontal`
  // sets both edges, and an edge-specific `paddingRight` beside it wins on the right — which is
  // how the Dives header stops short of the floating capsule while its left edge stays in the
  // column. The sweep above reads only `paddingHorizontal`, so it would stay green over a style
  // whose real right edge is anywhere at all; this is the half that says only the header's own
  // lines are allowed to be doing that, and which they are.
  //
  // **`divesPending` joined them in M2h** (§7.5's quiet indicator) and had to: the cap is on the
  // header's COLUMN rather than on one line of it, so a pending count that kept the plain column
  // would run under the floating capsule exactly as the summary did before M1m fixed it. A new
  // line in this block that is NOT here is the same defect; a line here that is not in the
  // header is a style borrowing the capsule's clearance for no reason.
  //
  // **The Map tab's two header lines joined them in M2n**, and they carry a DIFFERENT reserve
  // rather than the same one: that capsule holds one glyph (§3's layer toggle) against this
  // one's two, so `MAP_HEADER_TRAILING_INSET` is narrower than `DIVES_HEADER_TRAILING_INSET` by
  // one glyph box and one hairline. Both are derived from `actionCapsuleWidth`; neither is
  // typed. The test below asserts the membership; the two `it`s after it assert that each set
  // clears its own capsule.
  it('lets only the two screens with a floating capsule override that column trailing edge', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const overriding = Object.entries(sheet)
        .filter(([, style]) => style?.paddingRight !== undefined || style?.paddingEnd !== undefined)
        .map(([name]) => name)
        .sort();
      expect(overriding).toEqual(['divesPending', 'divesSummary', 'divesTitle', 'mapSummary', 'mapTitle']);
    }
  });

  // **The Map tab's own cap, read the same way and against its own capsule** (M2n).
  //
  // Written as a relation for the reason the Dives one is, and with one difference that is the
  // whole point of it being a separate test: the capsule this clears holds **one** glyph, so the
  // sum below counts one glyph box and no divider. A sheet that gave this header the Dives
  // reserve would pass every "is it capped" check and leave 61 pt of empty column on a screen
  // whose summary line is the longest thing on it; a sheet that gave the Dives header THIS
  // reserve would put its summary back under the glass. Neither can happen while both are
  // derived, and this is what fails if either stops being.
  it('stops the map header text column short of its own capsule, glyph for glyph', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      // **Two glyphs since M3c** — §3's toggle gained a third layer (dive centres) and the
      // capsule now shows the two layers the diver is NOT on, so it holds a glyph box, a
      // hairline and a second glyph box inside its own padding.
      const twoGlyphCapsule =
        (sheet.actionCapsulePlain?.paddingHorizontal as number) * 2 +
        (sheet.capsuleGlyph?.width as number) * 2 +
        (sheet.capsuleDivider?.width as number);
      const leadingEdge = (sheet.capsuleFloat?.right as number) + twoGlyphCapsule;
      expect(leadingEdge).toBeGreaterThan(0);

      const short = ['mapTitle', 'mapSummary'].filter((name) => {
        const inset = sheet[name]?.paddingRight;
        return typeof inset !== 'number' || inset < leadingEdge;
      });
      expect(short).toEqual([]);
      // One column, so one cap across both lines of the block.
      expect(sheet.mapSummary?.paddingRight).toBe(sheet.mapTitle?.paddingRight);
      // ...and it now EQUALS the Dives header's, because both capsules hold two glyphs — which
      // is a coincidence of the counts rather than a shared constant, and is why the assertion
      // above is written against this capsule's own geometry rather than against that number.
      // It was `toBeLessThan` while the map's capsule held one glyph; keeping that form would
      // have meant deleting the check the day the counts met, which is exactly when a sheet
      // reusing the other screen's constant stops being visible to anything else in this file.
      expect(sheet.mapTitle?.paddingRight).toBe(sheet.divesTitle?.paddingRight);
      // The LEADING edge is untouched, exactly as on the Dives header.
      expect(sheet.mapTitle?.paddingHorizontal).toBe(sheet.diveRow?.paddingHorizontal);
    }
  });

  // The capsule floats at the column's TRAILING edge, so its `right` is the same rule read from
  // the other side — and it is the one member of the set that is not a `paddingHorizontal`,
  // which is precisely why the sweep above cannot see it.
  it('lands the floating capsule on the same column, from the trailing side', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      expect(sheet.capsuleFloat?.right).toBe(sheet.diveRow?.paddingHorizontal);
    }
  });

  // **The detail screen's vertical padding is NOT that rule**, and this is what keeps the two
  // apart. `detailContent` was a single `padding: 20` doing both jobs, which is what let the
  // column be argued about as though it were the same decision as the gap under the hero's
  // divider. Collapsing it back to one `padding` would move that gap to 16 with no test
  // noticing, so the split is asserted rather than merely written.
  it('keeps the dive detail top gap independent of that column', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      const content = sheet.detailContent ?? {};
      expect(content.padding).toBeUndefined();
      expect(content.paddingTop).toBe(20);
      expect(content.paddingHorizontal).toBe(sheet.diveRow?.paddingHorizontal);
    }
  });
});

// **The pair this sheet's own comment calls load-bearing, defended** (M1h; the second half
// re-aimed in M1k). `emptyStateContent` carries `flexGrow: 1` and `justifyContent: 'center'`
// and the comment beside them explains what each does: short content is centred in the space
// above the button (it was pushed down against it until the owner asked for the block to move
// up); tall content makes the container taller than its frame, which leaves `justifyContent`
// no free space and lays the block out from the TOP, so nothing overflows off the top edge
// unreachable — which is true of `center` exactly as it was of `flex-end`, because the
// container grows to its content rather than clipping it. Deleting both left 86 tests green.
//
// A comment asserting a guarantee that nothing defends is this project's signature defect, and
// neither half can be checked by rendering: Jest has no layout, and the failure only appears on a
// screen short enough to overflow. So they are pinned as the properties they are, with the reason
// each exists written where it can be read — which is the same trade `screenBottomInset`'s own
// tests make about a tab bar no unit test can see.
describe('the first-run block scroll', () => {
  it('keeps both halves of the pair that positions it', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const content = makeStyles(scheme).emptyStateContent as Record<string, unknown>;
      // Without this the container is only as tall as its content, `justifyContent` has no
      // space to distribute even on a tall screen, and the block floats at the top of the
      // scroll with the button far below it.
      expect(content.flexGrow).toBe(1);
      // Without this the block sits at the top of a full-height container, hard under "0
      // dives", with every point of the screen's slack in one hole above the button. The
      // owner's call is that the slack is split, not spent at one end — it was all at the top
      // before M1k and would be all at the bottom without this.
      expect(content.justifyContent).toBe('center');
    }
  });

  // The scroll has to take the slack for either of those to mean anything: a `ScrollView` with
  // no `flex` is sized by its content, so the container would never be shorter than the frame
  // and the pair above would never fire.
  it('gives the scroll the slack, so the content container has a frame to fill', () => {
    for (const scheme of ['dark', 'light'] as const) {
      expect((makeStyles(scheme).emptyStateScroll as Record<string, unknown>).flex).toBe(1);
    }
  });
});

// The three properties a first-run screen can lose without any test noticing, because each
// degrades to something that still renders: an invisible mark, an invisible scale, and a caption
// in the wrong face. All three survived mutation before this block existed.
describe('the first-run block stays legible', () => {
  it('draws the mark quietly but visibly, in both themes', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const opacity = (makeStyles(scheme).emptyStateMark as Record<string, unknown>).opacity;
      expect(typeof opacity).toBe('number');
      // A band, not a value, because the number is a design judgement and the RULE is that the
      // mark is present and recedes. `> 0 && < 1` was the first version of this and `0.02`
      // passed it — a mark nobody can see, on the screen a diver meets first.
      expect(opacity as number).toBeGreaterThanOrEqual(0.35);
      expect(opacity as number).toBeLessThanOrEqual(0.7);
    }
  });

  it('draws the legend swatches as bands rather than hairlines', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const bar = makeStyles(scheme).depthLegendBar as Record<string, unknown>;
      // `height: 0` renders a legend of six invisible bars under six labels — on the screen
      // whose entire purpose is showing the scale — and every colour assertion in
      // `DepthLegend.test.tsx` stays green, because the styles are all still correct.
      expect(typeof bar.height).toBe('number');
      expect(bar.height as number).toBeGreaterThanOrEqual(4);
      // The radius is what makes it a swatch rather than a rule, and it cannot exceed the half
      // height without the pill becoming a lozenge of a different height than stated.
      expect(bar.borderRadius).toBe((bar.height as number) / 2);
    }
  });

  it('sets the caption in the face §0.2 reserves for figures', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const sheet = makeStyles(scheme) as unknown as Record<string, Record<string, unknown>>;
      // "red fades out by 6 m, blue carries past 40 m" is a reading, not a sentence about the
      // app, and it sits directly under a row of mono figures it has to agree with. Archivo
      // here renders perfectly and quietly breaks that pairing.
      expect(sheet.emptyStateReason?.fontFamily).toBe(fonts.mono);
      expect(sheet.depthLegendLabel?.fontFamily).toBe(fonts.mono);
    }
  });
});

/**
 * **The account screen borrows and invents nothing** (M2e). §0.6's whole origin is "a screen
 * that was built to spec and then styled by default into a different language", and a sign-in
 * screen is where that happens by reflex. Asserted by IDENTITY against the definitions the
 * other screens already use — a look-alike copy would satisfy any property-by-property check
 * and is exactly what `noticeBanner`, `backControl` and `mutedControl` were each written after
 * finding.
 */
describe('the account screen', () => {
  it.each(['dark', 'light'] as const)('takes the app’s existing definitions rather than copies of them (%s)', (scheme) => {
    const styles = makeStyles(scheme);

    // The sentence under a row, shared with Settings — one definition, two names.
    expect(styles.accountCaption).toBe(styles.settingsCaption);
    expect(styles.accountCaptionText).toBe(styles.settingsCaptionText);
    // The notice, shared with the preset editor's own failed save.
    expect(styles.accountNotice).toBe(styles.presetNotice);
    expect(styles.accountNoticeText).toBe(styles.presetNoticeText);
    // The deliberate-reach control, shared with *Delete preset* — §10's "the app's own control
    // stays muted", with the weight in a dialog this app does not draw.
    expect(styles.accountSecondaryAction).toBe(styles.presetDelete);
    expect(styles.accountSecondaryActionLabel).toBe(styles.presetDeleteLabel);
  });

  /**
   * The two rows on Settings that are not settings — a preset's name and §3's account & sync —
   * wear one ink, and it is not the ink a label wears. §0.6: "ink versus muted ink is the only
   * lever", §0.1 rules out a hue, and the chevron "is never spent on navigation".
   */
  it.each(['dark', 'light'] as const)('marks a destination with ink, from one definition (%s)', (scheme) => {
    const styles = makeStyles(scheme);
    const theme = themeFor(scheme);

    expect(styles.settingsAccountLabel).toBe(styles.settingsPresetName);
    expect((styles.settingsAccountLabel as Record<string, unknown>).color).toBe(theme.fg);
    // The contrast is the rule: a row taking the label's own muted ink would be
    // indistinguishable from `Units` with its value missing.
    expect((styles.formFieldLabel as Record<string, unknown>).color).toBe(theme.fgMuted);
  });
});
