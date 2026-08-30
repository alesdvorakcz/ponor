import { render, type RenderResult } from '@testing-library/react-native';

import { fonts } from '../theme/fonts';
import { themeFor } from '../theme/resolve';
import { TripHeader } from './TripHeader';

// Same adaptation the other component tests in this directory note: `render` wraps its own
// `act()` and is async, and `root` is a test-renderer `TestInstance` exposing
// `queryAll(predicate)` rather than `findAllByType`.
function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function nodeReading(t: RenderResult, s: string) {
  return textNodesOf(t).find((n) => String(n.children[0] ?? '') === s);
}

function flatStyle(node: { props: { style?: unknown } } | undefined) {
  return [node?.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
}

function colorOf(node: { props: { style?: unknown } } | undefined): unknown {
  return flatStyle(node).reduce((acc: unknown, s) => s.color ?? acc, undefined);
}

// A logged trip is an archive heading: uppercase, tracked and MUTED, with its date range
// trailing in mono (DESIGN.md §0.6's "Trip header" row). This is the control the "Up next"
// tests below are measured against — without it, "up next is full ink" could pass simply by
// everything being full ink.
it('sets a trip’s own title in muted ink, with its date range trailing', async () => {
  const t = await render(
    <TripHeader title="Blue Hole" trailing="16–18 Aug 2026" variant="trip" scheme="dark" />,
  );
  expect(colorOf(nodeReading(t, 'Blue Hole'))).toBe(themeFor('dark').fgMuted);
  const range = nodeReading(t, '16–18 Aug 2026');
  expect(range).toBeDefined();
  expect(flatStyle(range).some((s) => s.fontFamily === fonts.mono)).toBe(true);
});

// "Up next" is a forward-looking queue of unnumbered planned dives, not a logged trip, and
// rendering it identically to one said otherwise. Full ink reads as live where muted reads
// as archived — and colour is not one of the levers available here (§0.1: colour encodes
// depth and nothing else), so ink vs muted ink is the whole difference.
it('sets "Up next" in full ink, so a live queue does not read as an archived trip', async () => {
  const t = await render(<TripHeader title="Up next" trailing="3 dives" variant="upNext" scheme="dark" />);
  expect(colorOf(nodeReading(t, 'Up next'))).toBe(themeFor('dark').fg);
  expect(colorOf(nodeReading(t, 'Up next'))).not.toBe(themeFor('dark').fgMuted);
});

// The trailing slot used to sit empty for this section — the same slot where a trip shows
// its date range — which read at a glance as a value that failed to load rather than a
// section that genuinely has none. It now carries the count, in the SAME mono face the date
// range uses: one slot, one treatment, different content.
it('fills the trailing slot with its count, in the same mono face a trip’s date range uses', async () => {
  const t = await render(<TripHeader title="Up next" trailing="3 dives" variant="upNext" scheme="dark" />);
  const count = nodeReading(t, '3 dives');
  expect(count).toBeDefined();
  expect(flatStyle(count).some((s) => s.fontFamily === fonts.mono)).toBe(true);
});

// The variant decides the treatment; it must not also decide the CONTENT. A header handed
// nothing for its trailing slot still renders no empty pill there — the reason this
// component omitted it in the first place.
it('omits the trailing slot entirely when there is nothing to put in it', async () => {
  const t = await render(<TripHeader title="Blue Hole" trailing="" variant="trip" scheme="dark" />);
  expect(textNodesOf(t)).toHaveLength(1);
});

// Every colour traces back to makeStyles(scheme), never a literal — proven by scheme, the
// same way DayStrip.test.tsx proves it: rendering light must change the ink.
it('recolours for the light scheme rather than carrying a fixed colour', async () => {
  const t = await render(<TripHeader title="Up next" trailing="1 dive" variant="upNext" scheme="light" />);
  expect(colorOf(nodeReading(t, 'Up next'))).toBe(themeFor('light').fg);
  expect(colorOf(nodeReading(t, 'Up next'))).not.toBe(themeFor('dark').fg);
});
