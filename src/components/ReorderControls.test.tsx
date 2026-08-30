import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { dive } from '../domain/diveFixture';
import { applyReorder, createReorderGate, moveDown, moveUp, ReorderControls } from './ReorderControls';

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

/** Every "Move ... up" / "Move ... down" control, in tree order (top to
 * bottom, matching `dives`) — matched by prefix/suffix rather than the exact
 * label text, which now names the row's own site and position and so
 * differs row to row (see `rowLabel`'s own docblock in ReorderControls.tsx).
 * Tests that care about ordering, count, or disabled state — not label
 * content — use this rather than restating each row's exact label. */
function findAllMoveButtons(t: RenderResult, direction: 'up' | 'down') {
  return t.root
    ? t.root.queryAll(
        (n) =>
          typeof n.props?.accessibilityLabel === 'string' &&
          n.props.accessibilityLabel.startsWith('Move ') &&
          n.props.accessibilityLabel.endsWith(` ${direction}`),
      )
    : [];
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

// This task's review, Important finding: tapping the reorder controls
// rapidly fires overlapping reorderDivesForDate calls, and an earlier tap's
// promise can resolve `applied: true` (no error shown) while a later
// overlapping write for the SAME day silently discards its effect —
// DivesScreen.tsx's fix, and this is the direct, timing-controlled proof of
// it. A manually-resolvable promise stands in for the write, so "two calls
// issued before either settles" is exact and deterministic here — no
// reliance on React rendering or timing at all, which is deliberate:
// reproducing this same race through actual button presses at the
// DivesScreen level was tried first and abandoned (see
// DivesScreen.test.tsx's own note on firing two overlapping, un-awaited
// `fireEvent.press` calls against each other).
describe('createReorderGate', () => {
  /** A promise this test controls the resolving of, plus the function to do
   * it. No `reject` half: every test below that needs a rejected write uses
   * `Promise.reject` directly (it doesn't need to control WHEN, only THAT),
   * so this doesn't carry a second, unused control path. */
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('runs the write for a date with nothing already in flight', async () => {
    const gate = createReorderGate();
    const write = jest.fn().mockResolvedValue('done');
    const result = gate.run('2026-08-16', write);
    expect(write).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toBe('done');
  });

  // The exact race the review reproduced against reorderDivesForDate
  // directly: two calls for the SAME date, the second issued before the
  // first has settled.
  it('ignores a second call for a date that already has one in flight, without even attempting it', () => {
    const gate = createReorderGate();
    const first = deferred<void>();
    const firstWrite = jest.fn(() => first.promise);
    const secondWrite = jest.fn().mockResolvedValue(undefined);

    const firstResult = gate.run('2026-08-16', firstWrite);
    const secondResult = gate.run('2026-08-16', secondWrite); // issued before firstResult settles

    expect(firstResult).not.toBeNull();
    expect(secondResult).toBeNull();
    expect(secondWrite).not.toHaveBeenCalled();

    first.resolve(); // let the deferred settle so nothing leaks into a later test
  });

  it('does not block a different date while one date is in flight', () => {
    const gate = createReorderGate();
    const stillPending = deferred<void>();
    const otherWrite = jest.fn().mockResolvedValue(undefined);

    gate.run('2026-08-16', () => stillPending.promise);
    const otherResult = gate.run('2026-08-17', otherWrite);

    expect(otherResult).not.toBeNull();
    expect(otherWrite).toHaveBeenCalledTimes(1);

    stillPending.resolve();
  });

  it('releases the date once its write resolves, so a later call for the same date runs', async () => {
    const gate = createReorderGate();
    await gate.run('2026-08-16', () => Promise.resolve('a'));

    const secondWrite = jest.fn().mockResolvedValue('b');
    const secondResult = gate.run('2026-08-16', secondWrite);

    expect(secondResult).not.toBeNull();
    expect(secondWrite).toHaveBeenCalledTimes(1);
  });

  // "Make sure the guard releases on failure as well as success."
  it('releases the date even when its write rejects, so a later call for the same date still runs', async () => {
    const gate = createReorderGate();
    const firstResult = gate.run('2026-08-16', () => Promise.reject(new Error('db unavailable')));
    await expect(firstResult).rejects.toThrow('db unavailable');

    const secondWrite = jest.fn().mockResolvedValue('ok');
    const secondResult = gate.run('2026-08-16', secondWrite);

    expect(secondResult).not.toBeNull();
    expect(secondWrite).toHaveBeenCalledTimes(1);
  });

  it('isPending reflects a date only while its call is unsettled', async () => {
    const gate = createReorderGate();
    expect(gate.isPending('2026-08-16')).toBe(false);

    const inFlight = deferred<void>();
    const result = gate.run('2026-08-16', () => inFlight.promise);
    expect(gate.isPending('2026-08-16')).toBe(true);

    inFlight.resolve();
    await result;
    expect(gate.isPending('2026-08-16')).toBe(false);
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
    const ups = findAllMoveButtons(t, 'up');
    const downs = findAllMoveButtons(t, 'down');
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
    const [firstUp] = findAllMoveButtons(t, 'up');
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
    const [, middleDown] = findAllMoveButtons(t, 'down');
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

  // The Minor finding from this task's review: "Move dive up"/"Move dive
  // down" read identically on every row, so a screen-reader user can't tell
  // which dive a control belongs to. a/b/c above have genuinely different
  // site names, so this also proves the label is actually built per-row
  // rather than from some fixed field.
  it("labels each row's controls with the dive's site and position, not an identical string", async () => {
    const t = await render(
      <ReorderControls dives={[a, b, c]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
    );
    expect(findAllMoveButtons(t, 'up').map((n) => n.props.accessibilityLabel)).toEqual([
      'Move Site A (dive 1 of 3) up',
      'Move Site B (dive 2 of 3) up',
      'Move Site C (dive 3 of 3) up',
    ]);
    expect(findAllMoveButtons(t, 'down').map((n) => n.props.accessibilityLabel)).toEqual([
      'Move Site A (dive 1 of 3) down',
      'Move Site B (dive 2 of 3) down',
      'Move Site C (dive 3 of 3) down',
    ]);
  });

  // The realistic case, not just a hypothetical one: every dive this
  // component is ever actually given in the app shares one exact place
  // (`rowLabel`'s own docblock explains why — `sameDateGroups` only ever
  // splits up one `groupIntoTrips` trip, and a trip's dives share a place by
  // construction). Site name alone is therefore never distinguishing in
  // real use; position has to carry that weight even when a name is shown.
  it('still distinguishes rows by position when every dive shares the same site name', async () => {
    const sameSite1 = dive({ id: 's1', date: '2026-08-16', siteName: 'Blue Hole' });
    const sameSite2 = dive({ id: 's2', date: '2026-08-16', siteName: 'Blue Hole' });
    const t = await render(
      <ReorderControls
        dives={[sameSite1, sameSite2]}
        numbers={new Map()}
        scheme="dark"
        onPress={() => {}}
        onReorder={() => {}}
      />,
    );
    const labels = findAllMoveButtons(t, 'up').map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual(['Move Blue Hole (dive 1 of 2) up', 'Move Blue Hole (dive 2 of 2) up']);
    expect(new Set(labels).size).toBe(2);
  });

  it('falls back to position alone when the dive has neither a site nor a center name', async () => {
    const unnamed1 = dive({ id: 'u1', date: '2026-08-16', siteName: null, centerName: null });
    const unnamed2 = dive({ id: 'u2', date: '2026-08-16', siteName: null, centerName: null });
    const t = await render(
      <ReorderControls
        dives={[unnamed1, unnamed2]}
        numbers={new Map()}
        scheme="dark"
        onPress={() => {}}
        onReorder={() => {}}
      />,
    );
    expect(findAllMoveButtons(t, 'up').map((n) => n.props.accessibilityLabel)).toEqual([
      'Move dive 1 of 2 up',
      'Move dive 2 of 2 up',
    ]);
  });

  // The other half of this task's review (the Important finding):
  // DivesScreen sets `disabled` while a reorder write for this day is in
  // flight, so a second press can't reach `onReorder` before the first
  // settles. This component's own job is just to honour that prop —
  // DivesScreen.test.tsx covers where the prop's value actually comes from.
  describe('disabled', () => {
    it('disables every control, not just the first/last-row ones, and blocks presses', async () => {
      const onReorder = jest.fn();
      const t = await render(
        <ReorderControls
          dives={[a, b, c]}
          numbers={new Map()}
          scheme="dark"
          onPress={() => {}}
          onReorder={onReorder}
          disabled
        />,
      );
      const ups = findAllMoveButtons(t, 'up');
      const downs = findAllMoveButtons(t, 'down');
      expect(ups.map((n) => n.props.accessibilityState?.disabled)).toEqual([true, true, true]);
      expect(downs.map((n) => n.props.accessibilityState?.disabled)).toEqual([true, true, true]);

      // The middle row's controls would otherwise both be enabled (neither
      // first nor last) — pressing them is the strongest proof `disabled`
      // actually blocks the press, not just the rendered state.
      const [, middleUp] = ups;
      const [, middleDown] = downs;
      if (!middleUp || !middleDown) throw new Error('expected middle-row controls');
      await fireEvent.press(middleUp);
      await fireEvent.press(middleDown);
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('defaults to false, leaving first/last-row behaviour exactly as before', async () => {
      const t = await render(
        <ReorderControls dives={[a, b, c]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
      );
      const ups = findAllMoveButtons(t, 'up');
      const downs = findAllMoveButtons(t, 'down');
      expect(ups.map((n) => n.props.accessibilityState?.disabled)).toEqual([true, false, false]);
      expect(downs.map((n) => n.props.accessibilityState?.disabled)).toEqual([false, false, true]);
    });
  });
});
