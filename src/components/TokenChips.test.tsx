import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { TokenChips } from './TokenChips';

type Kind = 'wreck' | 'reef' | 'wall';
const OPTIONS: readonly Kind[] = ['wreck', 'reef', 'wall'];
const capitalize = (option: string) => option.charAt(0).toUpperCase() + option.slice(1);

function renderChips(props: Partial<Parameters<typeof TokenChips<Kind>>[0]> = {}) {
  return render(
    <TokenChips
      label="Type"
      values={[]}
      options={OPTIONS}
      displayLabel={capitalize}
      onChange={() => {}}
      scheme="dark"
      {...props}
    />,
  );
}

function findChip(t: RenderResult, label: string) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === `Type: ${label}`) : [];
  if (!node) throw new Error(`TokenChips did not render a "${label}" chip`);
  return node;
}

it('keeps the vocabulary’s order whatever order the chips are pressed in', async () => {
  const onChange = jest.fn();
  const t = await renderChips({ values: ['wall'], onChange });
  await fireEvent.press(findChip(t, 'Wreck'));
  expect(onChange).toHaveBeenCalledWith(['wreck', 'wall']);
});

it('takes a chip off when it is pressed again', async () => {
  const onChange = jest.fn();
  const t = await renderChips({ values: ['wreck', 'wall'], onChange });
  await fireEvent.press(findChip(t, 'Wreck'));
  expect(onChange).toHaveBeenCalledWith(['wall']);
});

it('keeps a token this build does not know, after the ones it offers', async () => {
  const onChange = jest.fn();
  const t = await renderChips({ values: ['wall', 'cavern' as Kind], onChange });
  await fireEvent.press(findChip(t, 'Reef'));
  expect(onChange).toHaveBeenCalledWith(['reef', 'wall', 'cavern']);
});

it('announces each chip as a checkbox with its state', async () => {
  const t = await renderChips({ values: ['reef'] });
  const reef = findChip(t, 'Reef');
  expect(reef.props.accessibilityRole).toBe('checkbox');
  expect(reef.props.accessibilityState).toMatchObject({ checked: true });
  expect(findChip(t, 'Wall').props.accessibilityState).toMatchObject({ checked: false });
});

it('inverts a chosen chip, ground and ink together', async () => {
  const styles = makeStyles('dark');
  const t = await renderChips({ values: ['reef'] });
  expect([findChip(t, 'Reef').props.style].flat(5)).toContain(styles.formChipSelected);
  expect([findChip(t, 'Wall').props.style].flat(5)).not.toContain(styles.formChipSelected);
});

it('shuts every chip while disabled', async () => {
  const onChange = jest.fn();
  const t = await renderChips({ disabled: true, onChange });
  for (const label of ['Wreck', 'Reef', 'Wall']) {
    expect(findChip(t, label).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(findChip(t, label));
  }
  expect(onChange).not.toHaveBeenCalled();
});

it('draws its caption in the label row', async () => {
  const styles = makeStyles('dark');
  const captioned = (t: RenderResult) =>
    (t.root ? t.root.queryAll((n) => n.type === 'Text' && [n.props.style].flat(3).includes(styles.formFieldCaption)) : []).flatMap(
      (n) => n.children,
    );
  expect(captioned(await renderChips({ caption: 'from this dive' }))).toEqual(['from this dive']);
  expect(captioned(await renderChips())).toEqual([]);
});

it('paints nothing of its own', async () => {
  const t = await renderChips({ values: ['reef'], caption: 'x' });
  expect(unexpectedGraphics(t, 'dark')).toHaveLength(0);
});
