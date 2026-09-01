import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { FormGroup } from './FormGroup';

// The only component in `src/components` that had no test file at all. Everything it does
// was reachable from DiveFormScreen.test.tsx only through that file's own `findButton`,
// which matches an accessibilityLabel by `.includes()` — so `Expand Conditions` and
// `Collapse Conditions` are the same query, and freezing the label at one of the two (or
// freezing `accessibilityState.expanded`, or the Show/Hide text) left all 772 tests green
// while a screen reader was told a collapsed group was open. This file asserts those three
// by exact value, which is what `.includes()` structurally cannot do.

// Same RTL adaptation every test file in this codebase uses (FormField.test.tsx,
// DiveRow.test.tsx): `render` is async and its `root` is a test-renderer `TestInstance`
// exposing `queryAll(predicate)`, not `findAllByType`.
function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function headersOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
}

/** The group's own disclosure control. Throws rather than returning undefined, so a test
 * that finds none fails at the query rather than at a confusing downstream `fireEvent`. */
function headerOf(t: RenderResult, index = 0) {
  const header = headersOf(t)[index];
  if (!header) throw new Error(`FormGroup rendered no disclosure control at position ${index}`);
  return header;
}

const CHILD = 'Working pressure';

/**
 * The state `FormGroup` used to hold itself, held by a caller instead.
 *
 * M1h made the component controlled — §2.2 now remembers which groups a diver leaves open, and
 * that memory lives in a settings row the component cannot see (`FormGroup`'s own docblock has
 * the reasoning). Every test below still drives the real control by pressing its header; what
 * changed is that the press goes out through `onToggle` and comes back as a prop, which is
 * exactly the round trip the screen makes. `onToggle` itself is asserted directly, once, below.
 */
function Harness({ title, initiallyExpanded = false }: { title: string; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <FormGroup title={title} scheme="light" expanded={expanded} onToggle={setExpanded}>
      <Text>{CHILD}</Text>
    </FormGroup>
  );
}

async function renderGroup(props: { title?: string; defaultExpanded?: boolean } = {}) {
  return render(<Harness title={props.title ?? 'Gas & cylinders'} initiallyExpanded={props.defaultExpanded} />);
}

it('names the group and offers a way to open it, without showing what is inside', async () => {
  const t = await renderGroup();
  expect(textIn(t)).toContain('Gas & cylinders');
  expect(textIn(t)).not.toContain(CHILD);
});

it('mounts its children only while open — never a style-only hide', async () => {
  // §2.2's groups are collapsible, and this component's own docblock is explicit that a
  // zero-height wrapper would leave every collapsed field's label and value reachable by a
  // plain text search. Asserted as "the child is not in the tree at all" rather than as
  // "the child is not visible", which is the difference between the two implementations.
  const t = await renderGroup();
  expect(textIn(t)).not.toContain(CHILD);

  await fireEvent.press(headerOf(t));
  expect(textIn(t)).toContain(CHILD);

  await fireEvent.press(headerOf(t));
  expect(textIn(t)).not.toContain(CHILD);
});

it('announces which of the two things pressing it will do, by exact label', async () => {
  // The exact string, not a substring: DiveFormScreen.test.tsx's `findButton` matches by
  // `.includes()`, so "Expand Conditions" and "Collapse Conditions" are one query there and
  // a label frozen at either value passes every test in that file. A screen reader reads
  // this out, and a control announcing "Expand" over an already-open group is telling the
  // diver the opposite of what it will do.
  const t = await renderGroup({ title: 'Conditions' });
  expect(headerOf(t).props.accessibilityLabel).toBe('Expand Conditions');

  await fireEvent.press(headerOf(t));
  expect(headerOf(t).props.accessibilityLabel).toBe('Collapse Conditions');
});

it('announces its open state as state, not only in the label', async () => {
  const t = await renderGroup();
  expect(headerOf(t).props.accessibilityState?.expanded).toBe(false);

  await fireEvent.press(headerOf(t));
  expect(headerOf(t).props.accessibilityState?.expanded).toBe(true);

  await fireEvent.press(headerOf(t));
  expect(headerOf(t).props.accessibilityState?.expanded).toBe(false);
});

// DESIGN.md §0.6: "**A collapsible group is marked by a chevron, not by the words
// 'Show'/'Hide'.** **Drawn, not typed** — the same reason §0.6 already gives for rating
// marks: a glyph's size varies by typeface, so a typed chevron looks broken somewhere."
//
// **The test this replaces asserted the opposite** — "says Show or Hide on its face" — and
// was rewritten rather than satisfied, because §0.6 now rules out the thing it was pinning.
// Its own reasoning survives and is what the two tests below turn into assertions: the fonts
// this app bundles have no chevron code point, so the mark must not be text at all, and the
// state must still be readable off the mark.
it('marks its state with a drawn chevron, and puts no second word on the header', async () => {
  const t = await renderGroup();
  const styles = makeStyles('light');

  // Drawn: a box with two borders and nothing inside it (theme/styles.ts's own
  // `reorderArrowUp` technique), never a `Text`. Asserted on the style the header actually
  // wears, not on the sheet alone — a correct style reaching no element is the failure.
  const marks = t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(styles.disclosureChevron)) : [];
  expect(marks).toHaveLength(1);
  expect(marks[0]?.type).toBe('View');
  expect(styles.disclosureChevron.borderRightWidth).toBeGreaterThan(0);
  expect(styles.disclosureChevron.borderBottomWidth).toBeGreaterThan(0);
  // Not typed: nothing about this mark reaches for a font, which is precisely the thing
  // neither bundled face can supply.
  expect(styles.disclosureChevron).not.toHaveProperty('fontFamily');
  expect(marks[0]?.props?.children).toBeUndefined();

  // The header is the group's name and nothing else now: no "Show", no "Hide", and no word
  // that replaced them.
  expect(textIn(t)).toEqual(['Gas & cylinders']);
  await fireEvent.press(headerOf(t));
  expect(textIn(t).filter((s) => s !== CHILD)).toEqual(['Gas & cylinders']);
});

// "It rotates to show state" (§0.6). Both halves: that the second style is actually applied
// when the group opens, and that what it does is turn the mark through a half-circle — a
// chevron rotated by 90° points sideways, which says nothing about open or closed and would
// pass any assertion that merely required the two transforms to differ.
it('rotates the chevron through a half-circle to show the state, rather than merely restyling it', async () => {
  const styles = makeStyles('light');
  const degreesOf = (style: { transform?: unknown }) => {
    const rotate = (style.transform as { rotate?: string }[] | undefined)?.find((entry) => entry.rotate !== undefined);
    return Number(String(rotate?.rotate).replace('deg', ''));
  };
  expect(Math.abs(degreesOf(styles.disclosureChevronExpanded) - degreesOf(styles.disclosureChevron))).toBe(180);

  const t = await renderGroup();
  const markOf = () => (t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(styles.disclosureChevron)) : [])[0];
  expect([markOf()?.props?.style].flat(5)).not.toContain(styles.disclosureChevronExpanded);

  await fireEvent.press(headerOf(t));
  expect([markOf()?.props?.style].flat(5)).toContain(styles.disclosureChevronExpanded);

  await fireEvent.press(headerOf(t));
  expect([markOf()?.props?.style].flat(5)).not.toContain(styles.disclosureChevronExpanded);
});

// §0.1: "colour is depth, and colour is nothing else" — every control is monochrome. The
// chevron is chrome, so it takes the header's own muted ink from the tokens and recolours
// with the scheme, rather than carrying a fixed value that would be right in one theme.
it('draws the chevron in the header’s own muted ink, in whichever scheme is rendering', async () => {
  for (const scheme of ['light', 'dark'] as const) {
    const styles = makeStyles(scheme);
    expect(styles.disclosureChevron.borderRightColor).toBe(themeFor(scheme).fgMuted);
    expect(styles.disclosureChevron.borderBottomColor).toBe(themeFor(scheme).fgMuted);
    expect(styles.disclosureChevron.borderRightColor).toBe(styles.formGroupTitle.color);
  }
  expect(makeStyles('light').disclosureChevron.borderRightColor).not.toBe(
    makeStyles('dark').disclosureChevron.borderRightColor,
  );
});

it('opens on mount when a caller asks it to, and still closes', async () => {
  // §2.2's groups open on mount whenever the diver left this one open last time or the dive
  // already has a value in it, so this is the ordinary case rather than an unused prop.
  const t = await renderGroup({ defaultExpanded: true });
  expect(textIn(t)).toContain(CHILD);
  expect(headerOf(t).props.accessibilityState?.expanded).toBe(true);

  await fireEvent.press(headerOf(t));
  expect(textIn(t)).not.toContain(CHILD);
});

it('keeps each group’s disclosure to itself', async () => {
  // The form renders six of these, and this component owns its own state precisely so that
  // DiveFormScreen does not have to hold an array of booleans. A shared or hoisted state
  // would open all six at once, and every single-group test above would still pass.
  const t = await render(
    <>
      <Harness title="Conditions" />
      <Harness title="People" />
    </>,
  );

  await fireEvent.press(headerOf(t, 0));
  expect(textIn(t)).toContain(CHILD);
  expect(textIn(t).filter((s) => s === CHILD)).toHaveLength(1);
});

// The other half of being controlled, and the half a harness hides: the press has to REPORT the
// state it is asking for, not merely that it happened. A component that called `onToggle()` with
// nothing, or always with `true`, would leave every test above green — the harness's own
// `setExpanded` would simply receive an undefined it then coerces — while the screen, which
// writes that value into a settings row, would remember the wrong thing for ever.
it('reports the state a press is asking for, in both directions', async () => {
  const onToggle = jest.fn();
  const t = await render(
    <FormGroup title="Conditions" scheme="light" expanded={false} onToggle={onToggle}>
      <Text>{CHILD}</Text>
    </FormGroup>,
  );
  await fireEvent.press(headerOf(t));
  expect(onToggle).toHaveBeenLastCalledWith(true);

  const open = await render(
    <FormGroup title="Conditions" scheme="light" expanded onToggle={onToggle}>
      <Text>{CHILD}</Text>
    </FormGroup>,
  );
  await fireEvent.press(headerOf(open));
  expect(onToggle).toHaveBeenLastCalledWith(false);
});

it('gives the header the 48 dp tap target §0.5 sets, and actually wears that style', async () => {
  // Both halves: that the control carries `formGroupHeader`, and that `formGroupHeader`
  // meets the floor. Either alone passes with the other broken.
  const t = await renderGroup();
  const styles = makeStyles('light');
  expect([headerOf(t).props.style].flat(5)).toContain(styles.formGroupHeader);
  expect(styles.formGroupHeader.minHeight).toBe(48);
});

// DESIGN.md §0.6: "**A group header is a cluster label** — Plex Mono 10.5, uppercase,
// +0.14 em, muted. *Conditions* and *Gas & cylinders* name the same groups on both screens
// and used to carry two different treatments."
//
// Asserted against `detailClusterTitle` — the treatment on the OTHER screen — rather than
// against a list of font properties spelled out here, because "the same on both screens" is
// the whole rule. A second copy of the values would go green the moment one screen's copy
// changed, which is the drift this test exists to catch. The one property that may differ is
// named explicitly below.
it('wears the detail screen’s own cluster label, not a heading of its own', async () => {
  const t = await renderGroup({ title: 'Conditions' });
  const styles = makeStyles('light');
  const title = textNodesOf(t).find((n) => String(n.children[0] ?? '') === 'Conditions');
  const worn = Object.assign({}, ...[title?.props?.style].flat(5).filter(Boolean)) as Record<string, unknown>;
  const cluster = { ...(styles.detailClusterTitle as unknown as Record<string, unknown>) };
  // `marginBottom` belongs to a block heading with rows under it; this one sits in a flex row
  // beside its disclosure chevron, where a bottom margin would push it off that row's centre.
  delete cluster.marginBottom;
  for (const [property, value] of Object.entries(cluster)) {
    expect(worn[property]).toBe(value);
  }
  // It was `sans-medium` 15 in full `fg` — a heading — so the two things that actually
  // changed are pinned against something else in the app rather than left implicit. The
  // comparison used to be against the header's own "Show"/"Hide" label; that word is gone
  // (§0.6's chevron), so it is made against `formStatusLabel` — the same object that label
  // WAS, and still the app's one quiet-control face. The claim is unchanged: a group's name
  // is a structural label in mono, not a UI control's label in Archivo.
  expect(worn.color).toBe(styles.formFieldLabel.color);
  expect(worn.fontFamily).not.toBe(styles.formStatusLabel.fontFamily);
});
