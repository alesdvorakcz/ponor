import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { Text } from 'react-native';

import { makeStyles } from '../theme/styles';
import { OptionChips } from './OptionChips';

// Same adaptation the other component tests in this repo note: `render` wraps its own
// `act()` and is async, and `root.queryAll(predicate)` searches host elements.
function findChip(t: RenderResult, label: string) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === `Water: ${label}`) : [];
  if (!node) throw new Error(`OptionChips did not render a "${label}" chip`);
  return node;
}

const OPTIONS = ['salt', 'fresh'] as const;
const capitalize = (option: string) => option.charAt(0).toUpperCase() + option.slice(1);

function renderChips(props: Partial<Parameters<typeof OptionChips<'salt' | 'fresh'>>[0]> = {}) {
  return render(
    <OptionChips
      label="Water"
      value={null}
      options={OPTIONS}
      displayLabel={capitalize}
      onChange={() => {}}
      scheme="dark"
      {...props}
    />,
  );
}

it('reports the pressed option', async () => {
  const onChange = jest.fn();
  const t = await renderChips({ onChange });
  await fireEvent.press(findChip(t, 'Fresh'));
  expect(onChange).toHaveBeenCalledWith('fresh');
});

/**
 * **Pressing the chip that is already selected reports `''`.** This is the one contract the
 * component's two callers read differently and therefore the one worth pinning here rather
 * than in either screen: the dive form treats it as clearing the field (`optionalPicked`
 * treats `''` identically to never having picked anything), and Settings absorbs it, because
 * a unit system has no cleared state. Both readings depend on this being `''` and not, say,
 * the option again or nothing at all.
 */
it("reports '' when the already-selected option is pressed, so a caller can clear or ignore", async () => {
  const onChange = jest.fn();
  const t = await renderChips({ value: 'salt', onChange });
  await fireEvent.press(findChip(t, 'Salt'));
  expect(onChange).toHaveBeenCalledWith('');
});

// §0.6: "`surface` behind an unselected chip, `action` ink behind the selected one — the
// same invert the save control uses, so 'the chosen thing is the inverted thing' is one rule
// across the app." Both the fill and the ink, since a chip that inverted its ground and left
// its label in `fg` would be unreadable and would still pass a fill-only assertion.
it('inverts the chosen chip, ground and ink together', async () => {
  const styles = makeStyles('dark');
  const t = await renderChips({ value: 'salt' });
  const chipStyle = (label: string) =>
    [findChip(t, label).props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  expect(chipStyle('Salt')).toContain(styles.formChipSelected);
  expect(chipStyle('Fresh')).not.toContain(styles.formChipSelected);

  const inkOf = (label: string) => {
    const [text] = findChip(t, label).queryAll((n) => n.type === 'Text');
    return [text?.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  };
  expect(inkOf('Salt')).toContain(styles.formChipTextSelected);
  expect(inkOf('Fresh')).not.toContain(styles.formChipTextSelected);
});

// A screen reader hears the field AND the value, so a diver moving through a form of chip
// rows can tell one row's "Salt" from another's — and the selection state is announced as
// state rather than baked into the words.
it('announces each chip as its field and its value, with its selection as state', async () => {
  const t = await renderChips({ value: 'fresh' });
  expect(findChip(t, 'Fresh').props.accessibilityRole).toBe('button');
  expect(findChip(t, 'Fresh').props.accessibilityState).toEqual({ selected: true });
  expect(findChip(t, 'Salt').props.accessibilityState).toEqual({ selected: false });
});

// --- §0.6, M1h: one carried mark and one clear for the whole group ---

/** Every text child in the tree, so a test can read what the label row says. */
function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.type === 'Text') : [])
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

/** Every control in the tree, including this component's own root — `queryAll` walks
 * descendants only, and the root is a `View` here rather than a control, but the sweep is
 * written this way so it cannot go half-blind if that ever changes. */
function buttonsOf(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter((n) => n.props?.accessibilityRole === 'button');
}

function clearOf(t: RenderResult) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === 'Clear carried Water');
}

/** Every drawn mark, by the host node a real `SymbolView` resolves to — see
 * `CarriedMark.test.tsx` for why that name and not "something icon-shaped". */
function marksIn(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
}

// The three states, on one control, in one test — because the rule is a distinction and each
// state alone is satisfiable by an implementation that has lost it: a component that drew the
// mark unconditionally passes "carried shows one", and one that drew nothing passes "a fresh
// row shows none".
it('reads three different ways for never-carried, carried and cleared', async () => {
  const fresh = await renderChips();
  expect(clearOf(fresh)).toBeUndefined();
  expect(textIn(fresh)).not.toContain('— cleared');
  expect(marksIn(fresh)).toHaveLength(0);

  const carried = await renderChips({ value: 'salt', carried: true, onClear: () => {} });
  expect(clearOf(carried)).toBeDefined();
  expect(textIn(carried)).not.toContain('— cleared');

  const cleared = await renderChips({ value: '', cleared: true });
  expect(textIn(cleared)).toContain('— cleared');
  // Nothing left to clear, exactly as on a text row: the value is already gone.
  expect(clearOf(cleared)).toBeUndefined();
});

// **The marks, counted on the carried row and not only on the fresh one.** Deleting the return
// mark from this component left the whole 1646-test suite green: the count above asked the
// fresh row for zero and never asked the carried row for anything, which is precisely the
// asymmetry this file's own comment three lines up warns about — "one that drew nothing passes
// 'a fresh row shows none'". Six carried rows on the dive form could lose the sheet's mark with
// nothing to say so. `FormField.test.tsx` had the strong version of this from the start; this
// is it, mirrored.
//
// Two on a carried row, and the identity of each is asserted rather than the count alone: the
// count is satisfied by two rings.
it('draws the return mark and the ring on the carried row, and neither anywhere else', async () => {
  const carried = await renderChips({ value: 'salt', carried: true, onClear: () => {} });
  expect(marksIn(carried).map((n) => n.props.name)).toEqual(['return', 'xmark.circle']);

  const cleared = await renderChips({ value: '', cleared: true });
  expect(marksIn(cleared)).toHaveLength(0);

  const fresh = await renderChips({ value: 'salt' });
  expect(marksIn(fresh)).toHaveLength(0);
});

// The em dash is typography, and a screen reader unaided makes "dash cleared" of it. Defended
// on `FormField` from the start and not here, so a diver on a cleared CHIP row heard exactly
// the thing `CLEARED_ANNOUNCEMENT` exists to prevent — the same guarantee written once and not
// mirrored.
it('announces the tag as a word, not as punctuation', async () => {
  const t = await renderChips({ value: '', cleared: true });
  const tag = (t.root ? t.root.queryAll((n) => n.type === 'Text') : []).find(
    (n) => String(n.children[0] ?? '') === '— cleared',
  );
  expect(tag?.props?.accessibilityLabel).toBe('cleared');
});

// §0.6/the sheet: the clear belongs to the FIELD, on its label row, and there is one of it —
// not one per chip. A control attached to a chip would be a second thing that chip's own press
// already does, and a mark on the selected chip would read as a fact about that option rather
// than about the field.
it('offers exactly one clear for the whole group, and it is not a chip', async () => {
  const t = await renderChips({ value: 'salt', carried: true, onClear: () => {} });
  const clears = buttonsOf(t).filter((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Clear '));
  expect(clears).toHaveLength(1);
  // The chips are still exactly the vocabulary, with no extra control among them: a clear
  // that had been added per chip would show up here as four buttons for two options.
  expect(buttonsOf(t)).toHaveLength(OPTIONS.length + 1);
  // And it announces no selection, which is what tells it apart from a chip for a screen
  // reader as well as for the form's own "every option control" sweep, which is keyed on
  // exactly this. (`selected`, not the whole `accessibilityState`: RN's `Pressable` always
  // hands the host node an object with every state key present and undefined.)
  expect(clearOf(t)?.props.accessibilityState?.selected).toBeUndefined();
});

// The two gestures that empty this control are different gestures, and the caller has to be
// able to tell them apart — the whole cleared state hangs on it. Pressing the selected chip is
// the diver *choosing* (a deselection), and reports `''` through `onChange` exactly as it
// always has; pressing the ring is the diver saying the value was never theirs.
it('tells deselecting a chip apart from clearing the field', async () => {
  const onChange = jest.fn();
  const onClear = jest.fn();
  const t = await renderChips({ value: 'salt', carried: true, onChange, onClear });

  await fireEvent.press(findChip(t, 'Salt'));
  expect(onChange).toHaveBeenCalledWith('');
  expect(onClear).not.toHaveBeenCalled();

  const clear = clearOf(t);
  if (!clear) throw new Error('no clear control found');
  await fireEvent.press(clear);
  expect(onClear).toHaveBeenCalledTimes(1);
  // ...and clearing is not routed through the typing path, which would leave the caller unable
  // to tell it from the press above.
  expect(onChange).toHaveBeenCalledTimes(1);
});

// The same guard `FormField` applies to its own tag: `cleared` is a claim about a gesture and
// `— cleared` is a claim about what the row holds, so a row with a chosen chip must never say
// it is empty. Here the contradiction would be visible twice over — an inverted chip beside a
// tag saying nothing is set.
it('never says cleared over a chip the diver has since chosen', async () => {
  const t = await renderChips({ value: 'salt', cleared: true });
  expect(textIn(t)).not.toContain('— cleared');
});

// The row a fresh field draws must be exactly the row it drew before any of this existed —
// which is most of this form's chip rows (§2.1 marks six of the twelve fresh). Whole-tree
// equality rather than a query, because "unchanged" is a claim about everything, including the
// props a query would not think to ask about.
it('is unchanged for a field that carried nothing', async () => {
  const bare = await renderChips({ value: 'salt' });
  const given = await renderChips({ value: 'salt', carried: false, cleared: false, onClear: () => {} });
  expect(JSON.stringify(given.toJSON())).toBe(JSON.stringify(bare.toJSON()));
});

// §0.6: the icon "supplements the label rather than replacing it — never an icon alone", and
// its tint is handed OUT so a symbol beside the label inverts with it instead of staying
// `fg` on an `action` ground where it would vanish. Both halves: the label survives, and the
// selected chip's icon is given the selected ink.
it('draws an icon beside the label, tinted to match whichever ink that chip wears', async () => {
  const styles = makeStyles('dark');
  const seen: { option: string; tint: unknown }[] = [];
  const t = await renderChips({
    value: 'salt',
    icon: (option, tintColor) => {
      seen.push({ option, tint: tintColor });
      return <Text>{`icon-${option}`}</Text>;
    },
  });
  expect(seen).toEqual([
    { option: 'salt', tint: styles.formChipTextSelected.color },
    { option: 'fresh', tint: styles.formChipText.color },
  ]);
  // The label is still there beside it.
  const labels = findChip(t, 'Salt')
    .queryAll((n) => n.type === 'Text')
    .flatMap((n) => n.children);
  expect(labels).toContain('Salt');
  expect(labels).toContain('icon-salt');
});
