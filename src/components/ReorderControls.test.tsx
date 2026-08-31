import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { dive } from '../domain/diveFixture';
import { makeStyles } from '../theme/styles';
import { DiveRow } from './DiveRow';
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

  // M1c task 6 (DESIGN.md §0.6): the arrows used to sit in a separate column BESIDE the
  // row (a `reorderRow` wrapping `reorderRowContent` + `reorderButtonColumn`), and two
  // 48 x 48 buttons stacked there made that column taller than the row it sat next to —
  // the whole row grew to fit it, roughly 1.5x, the exact bug this task exists to fix.
  // The fix moves the arrows INTO the row, in the slot DepthValue occupies
  // (DiveRow.tsx's `depthSlot`), rather than beside it. This test environment has no
  // real layout engine (react-test-renderer never runs Yoga), so a pixel height can't be
  // asserted directly — what these tests pin instead is the actual mechanism a pixel
  // height would depend on: the row's own container style, the arrows' box size, and
  // where in the tree the arrows actually live.
  describe('keeps the row from growing (M1c task 6)', () => {
    const d1 = dive({ id: 'd1', date: '2026-08-16', siteName: 'Site D', maxDepthM: 12.2 });
    const d2 = dive({ id: 'd2', date: '2026-08-16', siteName: 'Site D', maxDepthM: 9.2 });

    function flatStyle(node: { props: { style?: unknown } } | undefined) {
      return [node?.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
    }

    // Every dive this component is given still gets exactly one row, and that row's own
    // top-level style is byte-identical to a plain (non-reorder) DiveRow's — proving no
    // extra sizing wrapper was reintroduced around it. Matched by accessibilityRole
    // "button" with a label that is NOT one of the arrow labels (those start with
    // "Move "), which is exactly how a screen reader would tell the two kinds of button
    // apart too.
    it("renders one row per dive, each with DiveRow's own unmodified container style", async () => {
      const plain = await render(<DiveRow dive={d1} number={1} scheme="dark" onPress={() => {}} />);
      if (!plain.root) throw new Error('expected DiveRow to render a root element');
      const plainRowStyle = flatStyle(plain.root);

      const t = await render(
        <ReorderControls dives={[d1, d2]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
      );
      const rowRoots = t.root
        ? t.root.queryAll(
            (n) =>
              n.props?.accessibilityRole === 'button' &&
              typeof n.props?.accessibilityLabel === 'string' &&
              !n.props.accessibilityLabel.startsWith('Move '),
          )
        : [];
      expect(rowRoots).toHaveLength(2);
      for (const row of rowRoots) {
        expect(flatStyle(row)).toEqual(plainRowStyle);
      }
    });

    // The arrows must be DESCENDANTS of the row they belong to (inside `diveRowTop`,
    // where DepthValue used to be), not a sibling column next to it — a sibling is
    // exactly what forced the old row to grow to match its height, since a flex row's
    // own cross-axis size is the tallest of its children.
    it('nests each arrow inside its own row rather than beside it in a separate column', async () => {
      const t = await render(
        <ReorderControls dives={[d1, d2]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
      );
      const rowRoots = t.root
        ? t.root.queryAll(
            (n) =>
              n.props?.accessibilityRole === 'button' &&
              typeof n.props?.accessibilityLabel === 'string' &&
              !n.props.accessibilityLabel.startsWith('Move '),
          )
        : [];
      const ups = findAllMoveButtons(t, 'up');
      expect(ups.length).toBeGreaterThan(0);
      for (const up of ups) {
        let node = up.parent;
        let foundRow = false;
        while (node) {
          if (rowRoots.includes(node)) {
            foundRow = true;
            break;
          }
          node = node.parent;
        }
        expect(foundRow).toBe(true);
      }
    });

    // 34 x 26 (task brief's Constraints), not the old 48 x 48 — the dimension change that
    // actually stops the row from growing. `minHeight`/`minWidth` (the old, row-inflating
    // shape) must be gone from the visible box; the 48 dp touch target is proven
    // separately below, via hitSlop rather than the box itself.
    it('draws each arrow at 34 x 26, not the old 48 x 48 box that used to inflate the row', async () => {
      const t = await render(
        <ReorderControls dives={[d1, d2]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
      );
      const [firstUp] = findAllMoveButtons(t, 'up');
      if (!firstUp) throw new Error('expected a move-up control');
      const style = flatStyle(firstUp);
      const merged = Object.assign({}, ...style) as Record<string, number | undefined>;
      expect(merged.width).toBe(34);
      expect(merged.height).toBe(26);
      expect(merged.minHeight).not.toBe(48);
      expect(merged.minWidth).not.toBe(48);
    });

    // §0.5's 48 dp tap-target floor still applies to a 34 x 26 button — just via
    // `hitSlop`, which (unlike the box's own width/height) has no effect on layout, so
    // the touch target can stay generous without the row growing to fit it.
    //
    // The arithmetic below is necessary and was never sufficient: it sums a box and its
    // slop and asks whether the total reaches 48, which is true of numbers that are never
    // delivered. A touch reaches a view only when every ancestor contains the point as
    // well, and `reorderArrows` used to be exactly as tall as its 26 dp buttons and flush
    // against `diveRowTop`'s trailing edge — so the real target was about 37 x 41 while
    // this test went on passing. The container's own room is asserted right after.
    it('still reaches a 48 dp touch target via hitSlop, even though the visible box is smaller', async () => {
      const t = await render(
        <ReorderControls dives={[d1, d2]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
      );
      const [firstUp] = findAllMoveButtons(t, 'up');
      if (!firstUp) throw new Error('expected a move-up control');
      const hitSlop = firstUp.props.hitSlop as
        | number
        | { top?: number; bottom?: number; left?: number; right?: number }
        | undefined;
      if (typeof hitSlop !== 'object' || hitSlop === null) {
        throw new Error('expected the arrow to declare a hitSlop object');
      }
      const boxWidth = 34;
      const boxHeight = 26;
      expect(boxWidth + (hitSlop.left ?? 0) + (hitSlop.right ?? 0)).toBeGreaterThanOrEqual(48);
      expect(boxHeight + (hitSlop.top ?? 0) + (hitSlop.bottom ?? 0)).toBeGreaterThanOrEqual(48);

      // The half the sum cannot see: the container the buttons sit in has to hold that
      // slop, or none of it is delivered. `minHeight` covers the 11 above and below;
      // `paddingHorizontal` covers the 7 at each outer end; the gap keeps the two buttons'
      // facing slops from overlapping, which matters more here than anywhere else on the
      // screen — the down arrow is drawn later, so it is hit-tested first, and an overlap
      // would send a press aimed at "up" to "down".
      const arrows = makeStyles('dark').reorderArrows;
      expect(arrows.minHeight).toBeGreaterThanOrEqual(boxHeight + (hitSlop.top ?? 0) + (hitSlop.bottom ?? 0));
      expect(arrows.paddingHorizontal).toBeGreaterThanOrEqual(Math.max(hitSlop.left ?? 0, hitSlop.right ?? 0));
      expect(arrows.gap).toBeGreaterThanOrEqual((hitSlop.left ?? 0) + (hitSlop.right ?? 0));
    });

    // The trap the task brief names by name: an assertion that arrows are PRESENT would
    // also pass an implementation that renders them ALONGSIDE the depth value rather
    // than in place of it. This is the other half — the depth value must actually be
    // GONE from a row that is showing arrows.
    // M1c closing fixes, Important #2: '▲' used to be a literal glyph in a `Text` node,
    // which is exactly what broke (neither bundled font contains it — see
    // `reorderArrowUp`'s own comment in theme/styles.ts). The arrow is now drawn as a
    // zero-size `View` with a coloured border edge, so there is no `Text` reading '▲' to
    // search for any more; this checks for the drawn shape by style reference instead; the
    // "no ad hoc literal" test just below checks that reference is actually the theme's.
    it('hides the depth value on a row that is showing arrows, rather than showing both', async () => {
      const styles = makeStyles('dark');
      const t = await render(
        <ReorderControls dives={[d1, d2]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
      );
      const upArrows = t.root
        ? t.root.queryAll((n) => n.type === 'View' && [n.props?.style].flat(3).includes(styles.reorderArrowUp))
        : [];
      expect(upArrows.length).toBeGreaterThan(0);
      const text = t.root
        ? t.root
            .queryAll((n) => n.type === 'Text')
            .flatMap((n) => n.children)
            .filter((c): c is string => typeof c === 'string')
            .join(' ')
        : '';
      expect(text).not.toContain('12.2');
      expect(text).not.toContain('9.2');
    });

    // Sanity check that the style objects this whole describe block compares are
    // actually the theme's real, cached `diveRow`/`reorderButton` styles and not two
    // coincidentally-equal literals — makeStyles(scheme) is a stable-by-reference cache
    // (styles.test.ts), so if DiveRow or ReorderControls ever stopped reading from it,
    // this would be the test to notice.
    //
    // M1c closing fixes, Important #7: this comment already claimed "row and arrow
    // styles", but the assertion beneath it used to check only the row — a hardcoded
    // colour literal on the arrows themselves (theme/styles.ts's `reorderArrowUp`/
    // `reorderArrowDown`, or the button box around them) would have passed silently.
    // Checked the identical way the row already was: reference equality against the
    // theme's own cached objects, which only a value actually read from `makeStyles` can
    // satisfy — a literal that happens to look the same could never pass this.
    it('reads its row and arrow styles from the theme, not from ad hoc literals', async () => {
      const styles = makeStyles('dark');
      const t = await render(
        <ReorderControls dives={[d1, d2]} numbers={new Map()} scheme="dark" onPress={() => {}} onReorder={() => {}} />,
      );
      const rowRoots = t.root
        ? t.root.queryAll((n) => n.props?.style === styles.diveRow)
        : [];
      expect(rowRoots).toHaveLength(2);

      const buttons = t.root
        ? t.root.queryAll(
            (n) => n.type === 'View' && [n.props?.style].flat(3).some((s) => s === styles.reorderButton),
          )
        : [];
      expect(buttons).toHaveLength(4); // 2 dives x (up + down)

      const upArrows = t.root
        ? t.root.queryAll((n) => n.type === 'View' && [n.props?.style].flat(3).includes(styles.reorderArrowUp))
        : [];
      const downArrows = t.root
        ? t.root.queryAll((n) => n.type === 'View' && [n.props?.style].flat(3).includes(styles.reorderArrowDown))
        : [];
      expect(upArrows).toHaveLength(2);
      expect(downArrows).toHaveLength(2);
    });
  });
});
