import { render, type RenderResult } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { doubleTap } from './doubleTap';

// The helper two screen suites lean on to prove an in-flight guard (#61). Each case is the
// claim one of those suites makes through it, checked here on a control with nothing else in
// the way.

/**
 * A control whose only guard is the render flag: the first press disables it. `seen` records
 * which render each press was handled by, so "no render between the taps" is something the
 * test reads rather than infers.
 */
function DisabledAfterOnePress({ seen }: { seen: number[] }) {
  const [presses, setPresses] = useState(0);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go"
        disabled={presses > 0}
        onPress={() => {
          seen.push(presses);
          setPresses(presses + 1);
        }}
      >
        <Text>{`pressed ${presses}`}</Text>
      </Pressable>
    </View>
  );
}

/** `queryAll` walks descendants only, so every subject here sits inside a `View`. */
function control(t: RenderResult, label: string) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === label) : [];
  if (!node) throw new Error(`no control labelled "${label}"`);
  return node;
}

function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.type === 'Text') : []).flatMap((n) => n.children).map(String);
}

it('lands both taps on the render before either, so a render flag cannot turn the second away', async () => {
  const seen: number[] = [];
  const t = await render(<DisabledAfterOnePress seen={seen} />);

  await doubleTap(control(t, 'Go'));

  // Both handled by the first render: the second tap met a control still drawn enabled, which
  // is the double tap only a synchronous guard (a ref) can refuse.
  expect(seen).toEqual([0, 0]);
  // ...and the render after both has happened by the time the helper returns.
  expect(textIn(t)).toContain('pressed 1');
  expect(control(t, 'Go').props.accessibilityState).toMatchObject({ disabled: true });
});

it('prints no "overlapping act()" error, which two presses fired inside one act() do', async () => {
  // Watched, not replaced, so anything else logged still reaches the suite-wide console check.
  const errors = jest.spyOn(console, 'error');
  try {
    const t = await render(<DisabledAfterOnePress seen={[]} />);
    await doubleTap(control(t, 'Go'));
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

it('is refused by a control drawn disabled before the first tap, as a thumb is', async () => {
  const pressed = jest.fn();
  const t = await render(
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Go" disabled onPress={pressed}>
        <Text>Go</Text>
      </Pressable>
    </View>,
  );

  await doubleTap(control(t, 'Go'));

  expect(pressed).not.toHaveBeenCalled();
});

// What `fireEvent.press` refuses for `pointerEvents` (Testing Library's own reading of it, as a
// prop or a style), so the helper is never more willing than the presses it stands in for.
it.each([
  ['an ancestor that takes no touches', { pointerEvents: 'none' }, {}],
  ['an ancestor whose style takes no touches', { style: { pointerEvents: 'none' } }, {}],
  ['an ancestor that keeps touches to itself', { pointerEvents: 'box-only' }, {}],
  ['a control that passes touches to its children only', {}, { pointerEvents: 'box-none' }],
] as const)('is refused under %s, as a press is', async (_, around, own) => {
  const pressed = jest.fn();
  const t = await render(
    <View>
      <View {...around}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go" onPress={pressed} {...own}>
          <Text>Go</Text>
        </Pressable>
      </View>
    </View>,
  );

  await doubleTap(control(t, 'Go'));

  expect(pressed).not.toHaveBeenCalled();
});

it('says so when what it was handed is not something a thumb can press', async () => {
  const t = await render(
    <View>
      <Text accessibilityLabel="Words">Words</Text>
    </View>,
  );

  await expect(doubleTap(control(t, 'Words'))).rejects.toThrow('not a pressable control');
});
