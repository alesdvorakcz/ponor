import { render } from '@testing-library/react-native';
import { useContext } from 'react';
import { Text } from 'react-native';

import { FormRevealContext, RevealingScrollView, REVEAL_MARGIN, revealOffset } from './FormReveal';

// The arithmetic `RevealingScrollView` scrolls by, in content coordinates: `field` is where the
// focused field (card and list together) sits in the form, `view` is the part of the form the
// diver can see — its scroll offset and its height, which shrinks while the keyboard is up.

const view = (offset: number, height: number) => ({ offset, height });
const field = (top: number, bottom: number) => ({ top, bottom });

it('leaves a field alone when the whole of it is already in view', () => {
  expect(revealOffset(field(100, 200), view(0, 400))).toBeNull();
});

// The case found on a phone: a list growing under the keyboard. Just enough to bring its last
// row above the edge — not a jump that throws the field to the top of the screen.
it('scrolls up just far enough to bring the bottom of a field above the visible edge', () => {
  expect(revealOffset(field(300, 520), view(0, 400))).toBe(520 - 400 + REVEAL_MARGIN);
});

it('scrolls back to a field whose top has gone above the visible edge', () => {
  expect(revealOffset(field(100, 160), view(300, 400))).toBe(100 - REVEAL_MARGIN);
});

// The canvas's rule is that suggestions fit above the keyboard. When the list is taller than
// the whole visible half, it cannot — so the field goes to the top, and the list runs down from
// it as far as it can, rather than the field itself being scrolled out of sight to show rows.
it('puts a field taller than the visible area at the top, so its list runs down from it', () => {
  expect(revealOffset(field(300, 900), view(0, 400))).toBe(300 - REVEAL_MARGIN);
  expect(revealOffset(field(300, 900), view(300 - REVEAL_MARGIN, 400))).toBeNull();
});

it('never asks to scroll above the top of the form', () => {
  expect(revealOffset(field(4, 60), view(200, 400))).toBe(0);
});

// Before the scroll has been laid out it has no height, and every field would look out of
// view; scrolling on that would throw the form about on first render.
it('does nothing until the visible area has a height', () => {
  expect(revealOffset(field(300, 520), view(0, 0))).toBeNull();
});

// Without a provider a field's request goes nowhere, so a FormField outside a revealing scroll
// is exactly what it was. Inside one, the request reaches the scroll.
it('hands the fields inside it a real request, where outside one they get the inert default', async () => {
  const seen: unknown[] = [];
  function Probe() {
    seen.push(useContext(FormRevealContext));
    return <Text>probe</Text>;
  }
  await render(<Probe />);
  await render(
    <RevealingScrollView>
      <Probe />
    </RevealingScrollView>,
  );
  expect(seen).toHaveLength(2);
  expect(seen[1]).not.toBe(seen[0]);
});
