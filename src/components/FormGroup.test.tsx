import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { Text } from 'react-native';

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

async function renderGroup(props: { title?: string; defaultExpanded?: boolean } = {}) {
  return render(
    <FormGroup title={props.title ?? 'Gas & cylinders'} scheme="light" defaultExpanded={props.defaultExpanded}>
      <Text>{CHILD}</Text>
    </FormGroup>,
  );
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

it('says Show or Hide on its face, matching the state it announces', async () => {
  // Text rather than a chevron glyph, deliberately: neither bundled font (Archivo, IBM Plex
  // Mono) carries a triangle or chevron code point, so a typed arrow renders as tofu — the
  // same finding `DayStrip`'s Reorder/Done control already records. Both readings are checked
  // against each other here, so a face that stopped following the state cannot pass.
  const t = await renderGroup();
  expect(textIn(t)).toContain('Show');
  expect(textIn(t)).not.toContain('Hide');

  await fireEvent.press(headerOf(t));
  expect(textIn(t)).toContain('Hide');
  expect(textIn(t)).not.toContain('Show');
});

it('opens on mount when a caller asks it to, and still closes', async () => {
  // `defaultExpanded` has no caller in the app today (§2.2: every group starts collapsed),
  // so without this it is a prop that could stop working with nothing to notice.
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
      <FormGroup title="Conditions" scheme="light">
        <Text>Visibility</Text>
      </FormGroup>
      <FormGroup title="People" scheme="light">
        <Text>Buddy</Text>
      </FormGroup>
    </>,
  );

  await fireEvent.press(headerOf(t, 0));
  expect(textIn(t)).toContain('Visibility');
  expect(textIn(t)).not.toContain('Buddy');
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
  // beside its Show/Hide control, where a bottom margin would push it off that row's centre.
  delete cluster.marginBottom;
  for (const [property, value] of Object.entries(cluster)) {
    expect(worn[property]).toBe(value);
  }
  // It was `sans-medium` 15 in full `fg` — a heading — so the two things that actually
  // changed are pinned against the label beside them rather than left implicit.
  expect(worn.color).toBe(styles.formFieldLabel.color);
  expect(worn.fontFamily).not.toBe(styles.formGroupState.fontFamily);
});

// The two words on the header row are a structural LABEL and a UI CONTROL, and §0.2 splits
// the faces on exactly that. Rendered in one face at nearly one size — which is what a mono
// 10.5 title beside a mono 11.5 state was — they read as one continuous string,
// "CONDITIONS HIDE", rather than as a heading with a control beside it.
it('sets the disclosure state in the other face, so it does not read as part of the title', async () => {
  const t = await renderGroup();
  const styles = makeStyles('light');
  const state = textNodesOf(t).find((n) => String(n.children[0] ?? '') === 'Show');
  const worn = Object.assign({}, ...[state?.props?.style].flat(5).filter(Boolean)) as Record<string, unknown>;
  expect(worn.fontFamily).not.toBe(styles.formGroupTitle.fontFamily);
  // ...and it is the app's ONE quiet-control label rather than a private copy of it — the
  // same object §2.4's Logged/Planned control on this very form wears, and the day strip's
  // Reorder/Done one screen over. Reference equality, so a second definition that merely
  // happened to match today could not pass.
  expect(styles.formGroupState).toBe(styles.formStatusLabel);
  // Still the quiet, uppercase, tracked formula every control label in this app shares — the
  // face is the only thing that separates it from the title.
  expect(worn.textTransform).toBe('uppercase');
  expect(worn.color).toBe(styles.formGroupTitle.color);
});
