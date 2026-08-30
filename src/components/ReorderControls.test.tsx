import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { dive } from '../domain/diveFixture';
import { applyReorder, moveDown, moveUp, ReorderControls } from './ReorderControls';

// Same adaptation DiveRow.test.tsx and DivesScreen.test.tsx already note: `render`
// wraps its own `act()` and is async; its `root` is a `test-renderer` `TestInstance`
// exposing `queryAll(predicate)`, not `findAllByType`; and `Pressable` never appears
// as a node of its own (it's a composite component) — `fireEvent.press` on the host
// node it renders is what the installed @testing-library/react-native@14 supports.

function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

/** Every node carrying a given `accessibilityLabel`, in tree order — which, for
 * this component, is the same top-to-bottom order as `dives`. */
function findAllByLabel(t: RenderResult, label: string) {
  return t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === label) : [];
}

describe('moveDown / moveUp', () => {
  // Three ids, not two: with only two, "swap then reverse" and other wrong
  // shapes can coincide (this task's own brief calls this out — see
  // ReorderControls.tsx's moveDown docblock for why the reversal direction
  // specifically is easy to get backwards without a test noticing). A third
  // id makes the middle position distinguish a real per-pair swap from a
  // comparator that merely reverses, or that swaps the wrong pair.
  const listOrder = ['x', 'y', 'z']; // the screen's own newest-first display order

  it('moves the id at index down one slot in DISPLAY order, then reverses to CHRONOLOGICAL order', () => {
    // swap(0,1) on [x,y,z] -> [y,x,z]; reversed -> [z,x,y]
    expect(moveDown(listOrder, 0)).toEqual(['z', 'x', 'y']);
    // swap(1,2) on [x,y,z] -> [x,z,y]; reversed -> [y,z,x]
    expect(moveDown(listOrder, 1)).toEqual(['y', 'z', 'x']);
  });

  it('moving index up is the same swap as moving its predecessor down', () => {
    expect(moveUp(listOrder, 1)).toEqual(moveDown(listOrder, 0));
    expect(moveUp(listOrder, 2)).toEqual(moveDown(listOrder, 1));
  });

  it('has nowhere to go at the ends, but still reports chronological order', () => {
    expect(moveDown(listOrder, 2)).toEqual([...listOrder].reverse());
    expect(moveUp(listOrder, 0)).toEqual([...listOrder].reverse());
  });
});

describe('applyReorder', () => {
  it('passes the date and ids straight through to reorder, and reports no message when applied', async () => {
    const reorder = jest.fn().mockResolvedValue({ applied: true, effectiveOrder: ['a', 'b'], overriddenIds: [] });
    const result = await applyReorder('2026-08-16', ['b', 'a'], reorder);
    expect(reorder).toHaveBeenCalledWith(expect.anything(), '2026-08-16', ['b', 'a']);
    expect(result.message).toBeNull();
  });

  // The exact trap this task's brief names: `applied: false` must surface,
  // not vanish. canReorder (domain/trips.ts) is meant to keep the UI from
  // ever reaching this, which is exactly why it's covered directly here —
  // this function has to keep telling the truth even if that gate is ever
  // wrong.
  it('surfaces a reorder that did not take effect rather than silently springing back', async () => {
    const reorder = jest.fn().mockResolvedValue({
      applied: false,
      effectiveOrder: ['a', 'b'],
      overriddenIds: ['b'],
    });
    const result = await applyReorder('2026-08-16', ['b', 'a'], reorder);
    expect(result.message).toBeTruthy();
  });
});

describe('ReorderControls', () => {
  const a = dive({ id: 'a', date: '2026-08-16', siteName: 'Site A' });
  const b = dive({ id: 'b', date: '2026-08-16', siteName: 'Site B' });
  const c = dive({ id: 'c', date: '2026-08-16', siteName: 'Site C' });

  it("renders each dive's row via DiveRow, in the given order", async () => {
    const t = await render(
      <ReorderControls dives={[a, b, c]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
    );
    const text = textIn(t).join(' ');
    expect(text).toContain('Site A');
    expect(text).toContain('Site B');
    expect(text).toContain('Site C');
    expect(text.indexOf('Site A')).toBeLessThan(text.indexOf('Site B'));
    expect(text.indexOf('Site B')).toBeLessThan(text.indexOf('Site C'));
  });

  it('disables move-up on the first row and move-down on the last, and nothing else', async () => {
    const t = await render(
      <ReorderControls dives={[a, b, c]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
    );
    const ups = findAllByLabel(t, 'Move dive up');
    const downs = findAllByLabel(t, 'Move dive down');
    expect(ups).toHaveLength(3);
    expect(downs).toHaveLength(3);
    // Pressable's own `disabled` prop is consumed internally (to gate touch
    // handling) rather than forwarded verbatim to the host node it renders —
    // the same "no literal onPress prop either" shape DiveRow.test.tsx
    // already notes — so `accessibilityState.disabled` is what's actually
    // observable here, and it is also the value a screen reader would read.
    expect(ups.map((n) => n.props.accessibilityState?.disabled)).toEqual([true, false, false]);
    expect(downs.map((n) => n.props.accessibilityState?.disabled)).toEqual([false, false, true]);
  });

  it('a disabled control does not fire onReorder even if pressed', async () => {
    const onReorder = jest.fn();
    const t = await render(
      <ReorderControls dives={[a, b, c]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={onReorder} />,
    );
    const [firstUp] = findAllByLabel(t, 'Move dive up');
    if (!firstUp) throw new Error('expected a move-up control on the first row');
    await fireEvent.press(firstUp);
    expect(onReorder).not.toHaveBeenCalled();
  });

  // Three dives again, for the same reason as moveDown/moveUp above: this is
  // the one test proving the component wires a real button press through to
  // the correct chronological ids, and a two-dive fixture can't rule out a
  // coincidentally-right answer.
  it("moving the middle dive down sends the day's new order in chronological order", async () => {
    const onReorder = jest.fn();
    const t = await render(
      <ReorderControls
        dives={[a, b, c]}
        numbers={new Map()}
        scheme="dark"
        onPress={() => {}}
        onReorder={onReorder}
      />,
    );
    const [, middleDown] = findAllByLabel(t, 'Move dive down');
    if (!middleDown) throw new Error('expected a move-down control on the middle row');
    await fireEvent.press(middleDown);
    // display order [a,b,c] -> swap(1,2) -> [a,c,b] -> chronological (reversed) -> [b,c,a]
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('passes the dive id, not the row, to onPress', async () => {
    const onPress = jest.fn();
    const t = await render(
      <ReorderControls dives={[a, b]} numbers={new Map()} scheme="dark" onPress={onPress} onReorder={() => {}} />,
    );
    const [siteA] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children[0] === 'Site A') : [];
    // DiveRow's own row is the Pressable ancestor of its site text; walking up
    // to it and pressing mirrors exactly how DiveRow.test.tsx already presses
    // a row, rather than inventing a second way to trigger the same handler.
    const row = siteA?.parent?.parent;
    if (!row) throw new Error('could not find the dive row to press');
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledWith('a');
  });
});
