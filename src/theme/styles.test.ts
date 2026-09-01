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
});

// Every field on the dive form (FormField.tsx, DateTimeField.tsx, OptionChips /
// EquipmentTokenField in DiveFormScreen.tsx) is one CONTROL row: §0.6's `carried ×`, a
// picker field's `×`, one accessory's Yes/No chip and the field's own input all land in it. The two `×`
// controls reach §0.5's floor through `hitSlop`, and hitSlop is delivered only inside the
// ancestors — so the row's own height is what decides whether those targets exist at all.
// Pinned here rather than left implicit: this is the value both components' hitSlop
// comments depend on, and it was 24 dp while they claimed 48.
//
// The floor moved from `formFieldHeader` (the label row above a bordered input) to
// `formField` itself when §0.6's design pass collapsed the two into one row — same floor,
// same reason, one row instead of two.
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
    for (const other of [styles.formHeading, styles.settingsHeading] as Record<string, unknown>[]) {
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
  });
});

// **Where the top of a screen is — one owner, one answer** (DESIGN.md §4.1). The Dives
// screen's pinned bar got this rule first and the other five roots kept the sheet's flat 48
// for a release, which is INSIDE the safe area on a Dynamic Island phone: measured on an
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
  // the list and has since moved into a sibling bar above it, leaving a hole at the top.
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

// The Dives screen's pinned bar (DESIGN.md §0.6, rewritten again for the native large-title
// arrangement). Two properties, and each is a defect that has already shipped once.
describe('the Dives screen pinned bar', () => {
  // **The `…16` defect, as a property of the sheet.** The capsule floated over the list once
  // and covered the trailing slot of every sticky trip header — where a trip's date range
  // lives — and `UNNAMED SITE`'s range read as `…16` on the simulator. DivesScreen.test.tsx
  // pins the structural half (the list is the bar's sibling, so nothing passes beneath it);
  // this is the second lock: the bar is opaque, in the app's own ground, so even an overlap
  // introduced later could not be seen through. A transparent bar is exactly the shape that
  // regression takes.
  it('draws an opaque ground, in the theme the screen under it is painted in', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const styles = makeStyles(scheme);
      const bar = styles.divesBar as Record<string, unknown>;
      expect(bar.backgroundColor).toBe(themeFor(scheme).bg);
      expect(bar.backgroundColor).toBe((styles.divesScreen as Record<string, unknown>).backgroundColor);
    }
  });

  // The capsule's two glyphs are 48 dp boxes (§0.5), and the bar has to be able to hold them
  // — as a floor, since a `height` here is the one way to clip a tap target while every other
  // test still passes. The floor sits on the bar's CONTENT row rather than on the bar, and
  // that is not interchangeable: Yoga measures `minHeight` on the border box, so a floor on
  // the bar itself would be swallowed whole by its safe-area `paddingTop` and reserve
  // nothing — which is what would let the title jump 48 pt between the branches that render
  // a capsule and the two that do not.
  it('reserves the glyphs their floor below the safe-area inset, not inside it', () => {
    const row = makeStyles('dark').divesBarRow as Record<string, unknown>;
    expect(row.minHeight).toBeGreaterThanOrEqual(48);
    expect(row.height).toBeUndefined();
    // ...and the bar itself carries no floor, which would be the version that reserves
    // nothing.
    expect((makeStyles('dark').divesBar as Record<string, unknown>).minHeight).toBeUndefined();
  });

  // The bar, the large title and the list all indent to this screen's own 16 dp column
  // (§0.6), so the capsule's trailing edge lines up with the date ranges it used to cover and
  // the title with the trip titles below it. Read off the sheet as a relation, so moving the
  // list's inset moves both with it rather than silently splitting them.
  it('shares the list rows own column with the title beneath it', () => {
    const styles = makeStyles('dark');
    const inset = (styles.divesBar as Record<string, unknown>).paddingHorizontal;
    expect(inset).toBe((styles.divesTitle as Record<string, unknown>).paddingHorizontal);
    expect(inset).toBe((styles.tripHeader as Record<string, unknown>).paddingHorizontal);
    expect(inset).toBe((styles.diveRow as Record<string, unknown>).paddingHorizontal);
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
