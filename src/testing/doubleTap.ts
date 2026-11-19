import { act, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

type Node = NonNullable<RenderResult['root']>;

/**
 * **Two taps on one control with no render between them**: the double tap a thumb makes before
 * the first press has repainted anything, and the only shape that proves an in-flight guard
 * held in a ref (§10) rather than the `disabled` flag the first press renders.
 *
 * Neither obvious way to write it works with Testing Library 14 (#61):
 *
 * - **Two awaited `fireEvent.press` calls** let a render land between them, so the second meets
 *   a control the first already disabled. `fireEvent` refuses that press itself, the guard is
 *   never reached, and the test passes with the guard deleted.
 * - **Two un-awaited presses inside one `act()`**, the shape these suites used, puts no render
 *   between them, but `fireEvent.press` is async and opens an `act()` scope of its own. Three
 *   scopes then close first-in-first-out, and React prints "overlapping act() calls" for each.
 *   The assertions there still held, but §10 records overlapping scopes letting one pass over
 *   nothing elsewhere.
 *
 * So both taps go through React Native's own press path instead, inside one `act()`: the host
 * view's `onClick`, which a screen reader's or keyboard's activation takes. Pressability hands
 * it to `onPress` unless the control is `disabled` in the configuration of its last render, and
 * the helper first refuses what `fireEvent.press` refuses for `pointerEvents` on the control or
 * above it. A control drawn disabled before the first tap gets neither tap, and one the first
 * tap is about to disable still takes the second: a real second tap's position, as far as
 * `disabled` and `pointerEvents` go. No further: it fires no `onPressIn`, `onPressOut` or
 * `onLongPress`, and, like `fireEvent`, it knows nothing of a sibling drawn over the control.
 *
 * Shared rather than copied per suite: this rule took a reading of two libraries to get right,
 * and the cost of a copy is finding a fix twice (`unexpectedGraphics.ts` has the same reason).
 */
export async function doubleTap(control: Node): Promise<void> {
  const click: unknown = control.props.onClick;
  if (typeof click !== 'function') {
    throw new Error(
      `doubleTap: "${String(control.props.accessibilityLabel ?? control.type)}" is not a pressable control (no onClick)`,
    );
  }
  if (!takesTouches(control)) return;
  // The fields Pressability's `onClick` reads: no `pointerType` (that marks a pointer event it
  // has already handled as a press), and the control as its own target (a click bubbling from
  // a nested pressable is not this control's).
  const tap = () => ({ nativeEvent: {}, target: control, currentTarget: control, stopPropagation: () => {} });
  await act(async () => {
    click(tap());
    click(tap());
  });
}

/**
 * `pointerEvents` as Testing Library reads it before a press (its `isPointerEventEnabled`), as a
 * prop or a style: `none` anywhere on the way up refuses, `box-none` refuses the control itself,
 * and `box-only` refuses everything under the view that sets it.
 */
function takesTouches(node: Node, isAncestor = false): boolean {
  const pointerEvents: unknown = node.props.pointerEvents ?? StyleSheet.flatten(node.props.style)?.pointerEvents;
  if (pointerEvents === 'none' || pointerEvents === (isAncestor ? 'box-only' : 'box-none')) return false;
  return node.parent === null ? true : takesTouches(node.parent, true);
}
