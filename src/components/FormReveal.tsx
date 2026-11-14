import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import { ScrollView, type ScrollViewProps, type View } from 'react-native';

/**
 * **What a focused field tells the form it sits in: "keep this node in view"** (2026-11-14,
 * found on a phone). With the keyboard up the dive form's save button rides on the keys, which
 * leaves roughly half the screen for the form — and nothing scrolled a focused field's
 * suggestion list into that half, so the fourth suggestion for "K" sat behind the button until
 * the diver thought to scroll. The design canvas states the rule the list broke: suggestions
 * "must fit above [the keyboard], never scroll under".
 *
 * A field cannot scroll the form, and the form cannot know which field is focused or how tall
 * its list just grew, so the two meet here: the field hands over the node that holds it and its
 * list with `holding: true` on focus and on every layout change while focused, and the same
 * node with `holding: false` on blur. **Letting go names the node**, because moving from one
 * field to the next can deliver the old field's blur after the new field's focus — a bare "let
 * go" would drop the field the diver just moved into.
 *
 * Without a provider the default does nothing, so a field outside a revealing scroll is exactly
 * what it was.
 */
export type KeepInView = (node: View, holding: boolean) => void;

export const FormRevealContext = createContext<KeepInView>(() => {});

export function useKeepInView(): KeepInView {
  return useContext(FormRevealContext);
}

/** Clear space kept between a revealed field and the visible edge it was brought to — enough
 * that the card's rounded edge never sits flush against the save button or the screen top. */
export const REVEAL_MARGIN = 12;

/**
 * **Where to scroll so a field is in view, or `null` to stay put** — content coordinates
 * throughout: `field` is where the focused field (card and list together) sits in the form,
 * `view` is the scroll offset and the visible height, which shrinks while the keyboard is up.
 *
 * Three cases, in order. A field taller than the visible area cannot fit, so its TOP goes to the
 * top and its list runs down from there as far as it can — the field itself must never be the
 * part scrolled away. A field whose top has gone above the visible edge comes back down to it.
 * A field whose bottom is below the visible edge — a list growing under the keyboard — is lifted
 * just far enough to clear it, not thrown to the top: the diver's eye is on the field, and the
 * smallest move keeps it nearest where it was.
 *
 * Never above the top of the form, and nothing at all before the view has a height — before
 * layout every field would look out of view, and scrolling on that would throw the form about
 * on its first render.
 */
export function revealOffset(
  field: { top: number; bottom: number },
  view: { offset: number; height: number },
  margin: number = REVEAL_MARGIN,
): number | null {
  if (!(view.height > 0)) return null;
  let target: number | null = null;
  if (field.bottom - field.top > view.height - 2 * margin) target = field.top - margin;
  else if (field.top < view.offset + margin) target = field.top - margin;
  else if (field.bottom > view.offset + view.height - margin) target = field.bottom - view.height + margin;
  if (target === null) return null;
  const clamped = Math.max(0, target);
  return clamped === view.offset ? null : clamped;
}

/**
 * A `ScrollView` that keeps the field its children say is focused in view (see
 * `FormRevealContext` above). It re-checks at the two moments the answer can change: when a
 * field asks — on focus, and on every layout change of a focused field, which is how a growing
 * list arrives — and when the scroll itself is re-laid out, which is how the keyboard arrives:
 * the screen's `KeyboardAvoidingView` pads the keyboard's height in under this scroll, and the
 * scroll's new, shorter height is the visible area the field now has to fit in.
 *
 * The field is measured against the scroll's CONTENT view, so its position is the same number
 * whatever the scroll offset happens to be; the offset is tracked from the scroll's own events.
 * Every prop is passed through, and the two handlers it needs to see are called on to the
 * caller's own.
 */
export function RevealingScrollView({ children, onScroll, onLayout, ...rest }: ScrollViewProps & { children?: ReactNode }) {
  const scrollRef = useRef<ScrollView | null>(null);
  const held = useRef<View | null>(null);
  const offset = useRef(0);
  const height = useRef(0);

  const reveal = useCallback(() => {
    const node = held.current;
    const scroll = scrollRef.current;
    // `getInnerViewRef` is real and public on React Native 0.86's ScrollView (and in its
    // generated types) but missing from the hand-written `ScrollView.d.ts` this project compiles
    // against, hence the narrow cast. The content view, not the scroll itself, so a measured
    // position is the same number whatever the scroll offset is.
    const content = (scroll as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.();
    if (node === null || scroll === null || content == null) return;
    node.measureLayout(
      content,
      (_x, y, _width, fieldHeight) => {
        const next = revealOffset({ top: y, bottom: y + fieldHeight }, { offset: offset.current, height: height.current });
        if (next !== null) scroll.scrollTo({ y: next, animated: true });
      },
      // A node that cannot be measured — unmounted between the request and the answer — is
      // simply not revealed. There is nothing to recover and nothing worth saying.
      () => {},
    );
  }, []);

  const keep = useCallback<KeepInView>(
    (node, holding) => {
      if (holding) {
        held.current = node;
        reveal();
      } else if (held.current === node) {
        held.current = null;
      }
    },
    [reveal],
  );

  return (
    <FormRevealContext.Provider value={keep}>
      <ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y;
          onScroll?.(event);
        }}
        onLayout={(event) => {
          height.current = event.nativeEvent.layout.height;
          reveal();
          onLayout?.(event);
        }}
        {...rest}
      >
        {children}
      </ScrollView>
    </FormRevealContext.Provider>
  );
}
