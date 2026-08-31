import { makeStyles } from './styles';

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

// Every field on the dive form (FormField.tsx, DateTimeField.tsx, OptionChips/BooleanField
// in DiveFormScreen.tsx) is one CONTROL row: §0.6's `carried ×`, a picker field's `×`,
// hood/gloves/boots' Yes/No chip and the field's own input all land in it. The two `×`
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
