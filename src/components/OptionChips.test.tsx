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
