// The package's own official Jest mock — see the jest.mock call below, and
// DivesScreen.test.tsx's own copy of this exact preamble, for why this screen's test needs
// it too: DiveFormScreen.tsx calls useSafeAreaInsets() for the same reason DivesScreen.tsx
// does (clearing the home indicator, DESIGN.md §0.6), gets a real SafeAreaProvider for free
// from expo-router's root layout in the app, and has no such ancestor when rendered bare
// here. Imported first, and named `mock...`, for the same babel-plugin-jest-hoist reason
// DivesScreen.test.tsx's own copy documents: a jest.mock() factory may only close over
// out-of-scope identifiers starting with `mock`/`require`, and every jest.mock() call is
// hoisted above every import regardless of where it sits textually.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';

import { createDive } from '../db/dives';
import { useDives } from '../db/useDives';
import { dive } from '../domain/diveFixture';
import { type Tank } from '../domain/types';
import { makeStyles } from '../theme/styles';
import DiveFormScreen from './DiveFormScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
// Task 6: DiveFormScreen.tsx now reads useDives() for carry-over and calls createDive on
// save, so this screen's test needs the same per-module mock split DivesScreen.test.tsx
// already established: the one read mocked here, the write mocked separately (below) so a
// save test can control exactly what it resolves or rejects with, without a real database.
// updateDive is mocked alongside createDive only because both live in the one module this
// screen imports from — mode="edit" does not call it yet (Task 7's job).
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/dives', () => ({ createDive: jest.fn(), updateDive: jest.fn() }));
// A successful save calls router.back()/canGoBack() (returnToList, DiveFormScreen.tsx) —
// the identical shape DiveDetailScreen.test.tsx's own mock already uses for the same
// canGoBack()-guarded pattern in that screen's BackButton.
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockUseDives = useDives as jest.Mock;
const mockCreate = createDive as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDives.mockReturnValue({ dives: [], numbers: new Map(), error: undefined });
});

// Same RTL adaptation every screen test in this codebase uses (DivesScreen.test.tsx,
// DiveDetailScreen.test.tsx): `render` is async and its `root` is a test-renderer
// `TestInstance` exposing `queryAll(predicate)`. A single root `<View>` (DiveFormScreen.tsx
// has one) is required for `root` to resolve to something whose descendants `queryAll` can
// actually reach — a bare `<>...</>` Fragment root would leave `root` pointing at only the
// first top-level child, per M1d task 1's own probe finding.
function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function buttonsOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
}

function findButton(t: RenderResult, labelIncludes: string) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '').includes(labelIncludes));
}

// Task 6 brief, Step 1: presses the one Save control via the query above rather than
// reimplementing it — `findButton(t, 'Save')` already matches "Save dive"'s own
// accessibilityLabel.
//
// `async`/awaited, unlike the brief's own un-awaited sample. `@testing-library/react-native`
// v14 makes `fireEvent.press` itself `async` — its returned promise chains all the way
// through `handleSubmit(onValid)` — and firing it without awaiting left a promise (`onValid`
// is async now, Task 6: it awaits `createDive`) still settling once the test that pressed
// Save had already returned. Confirmed by bisecting: with only `typeInto` below also fixed,
// this file's full suite still reproduced `console.error`'s "You seem to have overlapping
// act() calls" plus a demonstrably corrupted render on the NEXT test — a fresh
// `<DiveFormScreen>` whose core-strip fields, rendered unconditionally by that screen's own
// shell, `t.root`'s query helpers could no longer find. Awaiting both this and `typeInto`
// together is what made the leftover work settle before the test that started it returns,
// rather than bleeding into whichever test happens to run next.
const pressSave = async (t: RenderResult) => {
  const save = findButton(t, 'Save');
  if (!save) throw new Error('no Save control found');
  await fireEvent.press(save);
};

// Task 6 brief, Step 1, adapted two ways: this file's own null-safe `t.root` convention
// (textNodesOf/buttonsOf above) rather than the brief's un-guarded `t.root.queryAll`, and
// awaited — `fireEvent.changeText` is exactly as `async` as `fireEvent.press` is, and left
// un-awaited it reproduces the same cross-test corruption `pressSave`'s own comment above
// documents, via the same mechanism one control earlier.
const typeInto = async (t: RenderResult, label: string, value: string) => {
  const input = (t.root ? t.root.queryAll((n) => n.type === 'TextInput') : []).find(
    (n) => String(n.props?.accessibilityLabel ?? '') === label,
  );
  if (!input) throw new Error(`no field labelled ${label}`);
  await fireEvent.changeText(input, value);
};

/** A field's own `TextInput`, by its exact accessibilityLabel (FormField.tsx) — unlike
 * `textIn`, which only ever sees `Text` children and so can never read a TextInput's
 * current `value`. */
function findTextInput(t: RenderResult, label: string) {
  return (t.root ? t.root.queryAll((n) => n.type === 'TextInput') : []).find(
    (n) => String(n.props?.accessibilityLabel ?? '') === label,
  );
}

/** The DESIGN.md §0.6 `carried ×` control for one field, by FormField.tsx's own
 * `` `Clear carried ${label}` `` accessibilityLabel — present only while that exact field
 * is in DiveFormScreen.tsx's own `carriedPaths`, which is what makes this the one query
 * that can tell "this field is marked carried" from "this field merely has a value." */
function findClearCarried(t: RenderResult, label: string) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === `Clear carried ${label}`);
}

// Same guard DiveRow.test.tsx and DiveDetailScreen.test.tsx already carry (§0.4/§0.1),
// copied rather than imported per this codebase's own no-shared-test-utils convention.
const SUSPICIOUS_TYPE_NAME = /svg|path|circle|rect|ellipse|polyline|polygon|canvas|chart|sparkline|profile|image/i;

function unexpectedGraphics(t: RenderResult, scheme: 'dark' | 'light' = 'light') {
  if (!t.root) return [];
  const known = Object.values(makeStyles(scheme));
  const byName = t.root.queryAll((n) => typeof n.type === 'string' && SUSPICIOUS_TYPE_NAME.test(n.type));
  const byAdHocStyle = t.root.queryAll((n) => {
    if (n.type !== 'View') return false;
    const style = [n.props?.style].flat(5).filter(Boolean);
    return style.length > 0 && !style.some((s) => known.includes(s));
  });
  return [...byName, ...byAdHocStyle];
}

// --- Task 4 brief, Step 1, verbatim ---

it('shows the core strip without opening anything', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  // §2.2: date, site, center, max depth, duration are always visible
  for (const label of ['Date', 'Site', 'Centre', 'Max depth', 'Duration']) {
    expect(text).toContain(label);
  }
});

it('keeps the deeper groups collapsed until asked', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  expect(text).toContain('Gas & cylinders'); // the group's header shows
  expect(text).not.toContain('Working pressure'); // its fields do not
});

it('saves a dive carrying nothing but a date', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // only the date is required (§2.2) — the save must be reachable with nothing else set.
  // Same query the brief's own sample uses, through this file's `findButton` helper rather
  // than inlined a second time — `t.root` types as possibly-null in the installed RTL
  // version, which `findButton`/`buttonsOf` already guard against.
  const save = findButton(t, 'Save');
  expect(save?.props?.accessibilityState?.disabled).not.toBe(true);
});

// --- Beyond the brief's sample: the collapsed/expanded trap it warns about ---
//
// "An assertion that a group's header renders would pass whether or not its fields are
// actually hidden." The given test above only proves the COLLAPSED half of that; a
// FormGroup that never opened at all — its `expanded` state permanently stuck at
// `false`, or its press handler wired to the wrong group — would pass it just as well.
// Pressing the SAME header and checking the SAME field string against itself, collapsed
// then expanded, is what tells a real disclosure from a permanently-hidden one.

it("reveals Gas & cylinders' fields on press — the header text alone was never proof they exist", async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  expect(textIn(t).join(' ')).not.toContain('Working pressure');
  const header = findButton(t, 'Gas & cylinders');
  if (!header) throw new Error('no Gas & cylinders header found');
  await fireEvent.press(header);
  expect(textIn(t).join(' ')).toContain('Working pressure');
});

// A second, independent group, so "collapsed by default" is not proven only for the one
// group the brief's own sample happens to check.
it('keeps every group collapsed by default, not only the one the sample test checks', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  expect(textIn(t).join(' ')).not.toContain('Buddy');
  const header = findButton(t, 'People');
  if (!header) throw new Error('no People header found');
  await fireEvent.press(header);
  expect(textIn(t).join(' ')).toContain('Buddy');
});

it('names all six §2.2 groups', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  for (const group of ['Times & depth', 'Conditions', 'Gas & cylinders', 'Equipment', 'People', 'Notes & rating']) {
    expect(text).toContain(group);
  }
});

// --- §1, "never block a save," hardened beyond the brief's one snapshot ---

it('never sets a disabled state on the save control, before or after opening a group', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const before = findButton(t, 'Save');
  expect(before?.props?.disabled).not.toBe(true);
  expect(before?.props?.accessibilityState?.disabled).not.toBe(true);

  const header = findButton(t, 'Gas & cylinders');
  if (!header) throw new Error('no Gas & cylinders header found');
  await fireEvent.press(header);

  const after = findButton(t, 'Save');
  expect(after?.props?.disabled).not.toBe(true);
  expect(after?.props?.accessibilityState?.disabled).not.toBe(true);
});

it('lets the save control actually be pressed, with nothing set but the default date', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const save = findButton(t, 'Save');
  if (!save) throw new Error('no Save control found');
  // Awaited, not fire-and-forget: `handleSubmit` runs `zodResolver(diveFormSchema)`
  // internally, and awaiting is what lets a rejected promise inside that chain surface as
  // this test failing, rather than as an unhandled rejection after the test has already
  // moved on (the same reasoning ReorderControls.test.tsx's own `await fireEvent.press`
  // calls document).
  await fireEvent.press(save);
  expect(textIn(t).join(' ')).toContain('Date');
});

// --- §0.4/§0.1: no schematic graphic, and colour only from makeStyles(scheme) ---

it('draws nothing outside its own makeStyles treatment, collapsed or expanded', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  expect(unexpectedGraphics(t)).toHaveLength(0);
  const header = findButton(t, 'Gas & cylinders');
  if (!header) throw new Error('no Gas & cylinders header found');
  await fireEvent.press(header);
  expect(unexpectedGraphics(t)).toHaveLength(0);
});

// --- mode is a real prop, not a dead one, even though Task 7 owns loading the dive ---

it('shows an edit heading in edit mode, and a new-dive heading in create mode', async () => {
  const created = await render(<DiveFormScreen mode="create" />);
  expect(textIn(created).join(' ')).toContain('New dive');

  const edited = await render(<DiveFormScreen mode="edit" diveId="some-id" />);
  expect(textIn(edited).join(' ')).toContain('Edit dive');
});

// --- Task 6 brief, Step 1, verbatim — plus one positive assertion per test where the
// brief's own sample checked less than its test name claims. Every addition below is
// called out in its own comment; nothing the brief wrote is removed or weakened. ---

it('creates a dive and returns to the list', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ date: '2026-08-16' }));
  // Added: this test's own name says "...and returns to the list", but nothing above
  // actually checks that — only that createDive was called. canGoBack() is mocked true
  // (this file's own expo-router mock), so a real returnToList() calls router.back(), not
  // router.replace(). Without this, an onValid that called createDive and stopped there
  // would still pass the whole test — the same "passes for everything but the one value
  // it names" gap a bare `.not.toHaveBeenCalled()` on the failure test below would leave.
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

it('sends no zeros for fields the diver left empty', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  const input = mockCreate.mock.calls[0]?.[1] ?? {};
  expect(Object.entries(input).filter(([, v]) => v === 0)).toHaveLength(0);
});

it('tells the diver when a save fails instead of pretending it worked', async () => {
  mockCreate.mockRejectedValue(new Error('disk full'));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  await pressSave(t);
  // §1's "never block a save" does not mean "never admit a save failed"
  await waitFor(() => expect(textIn(t).join(' ').toLowerCase()).toContain("couldn't"));
  expect(router.back).not.toHaveBeenCalled();
  // Added: "the form keeps its values on failure" (this task's own brief) is not actually
  // checked above — router.back() not firing only proves the screen didn't navigate away,
  // not that the diver's typing survived. Verified by mutation: a catch branch that clears
  // the date via `reset({ date: '' }, { keepDirtyValues: false })` still passes both
  // assertions above (a bare `reset()` alone does not — this screen's own `resetOptions:
  // { keepDirtyValues: true }`, DiveFormScreen.tsx, already protects a dirty field from
  // that simpler case) — only reading the field back catches the explicit-override one.
  expect(findTextInput(t, 'Date')?.props?.value).toBe('2026-08-16');
});

// --- Task 6 coverage: computeCarriedPaths and its ten ControlledTextField call sites
// (DiveFormScreen.tsx) had no committed test before this task supplied the real carry-over
// data (`useDives()` + `carryOverFrom`) needed to exercise them. Every check below is a
// positive assertion of one exact field's value or marker, or a marker checked absent on a
// field proven wired to the same mechanism — never a blanket "nothing looks wrong," which
// this project's own review history keeps finding passes for the wrong reason (a
// permanently collapsed group, an always-false flag) as readily as the right one.

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel', sizeL: 12, count: 1, workingBar: 232,
  o2Pct: 32, hePct: null, startBar: 200, endBar: 50, ...over,
});

it('prefills a carried field from the most recent logged dive, and marks it carried', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ date: '2026-08-10', buddy: 'Petr' })],
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DiveFormScreen mode="create" />);
  const peopleHeader = findButton(t, 'People');
  if (!peopleHeader) throw new Error('no People header found');
  await fireEvent.press(peopleHeader);

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petr');
  expect(findClearCarried(t, 'Buddy')).toBeDefined();
  // Guide is the People group's other carried-capable field (DiveFormScreen.tsx), left
  // null on this same previous dive — must not be marked, proving the chip is per-field
  // rather than "something on this dive carried, so mark every field."
  expect(findClearCarried(t, 'Guide')).toBeUndefined();
});

it('only a LOGGED dive counts as "most recent" — a newer planned one is skipped', async () => {
  mockUseDives.mockReturnValue({
    // The order a real useDives() call actually hands back: newest first, and a
    // future-dated planned dive sorts ahead of a past logged one in that same order —
    // DivesScreen.tsx's own "Up next" section relies on the identical fact.
    dives: [
      dive({ status: 'planned', date: '2026-09-15', buddy: 'Alice' }),
      dive({ status: 'logged', date: '2026-08-01', buddy: 'Petr' }),
    ],
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DiveFormScreen mode="create" />);
  const peopleHeader = findButton(t, 'People');
  if (!peopleHeader) throw new Error('no People header found');
  await fireEvent.press(peopleHeader);

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petr');
});

it('drops the carried chip the moment the diver types over it', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ date: '2026-08-10', buddy: 'Petr' })],
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DiveFormScreen mode="create" />);
  const peopleHeader = findButton(t, 'People');
  if (!peopleHeader) throw new Error('no People header found');
  await fireEvent.press(peopleHeader);
  expect(findClearCarried(t, 'Buddy')).toBeDefined();

  await typeInto(t, 'Buddy', 'Jana');

  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Jana');
});

it('prefills and marks a carried cylinder field too, not just top-level ones', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ date: '2026-08-10', tanks: [tank({ sizeL: 12 })] })],
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DiveFormScreen mode="create" />);
  const gasHeader = findButton(t, 'Gas & cylinders');
  if (!gasHeader) throw new Error('no Gas & cylinders header found');
  await fireEvent.press(gasHeader);

  expect(findTextInput(t, 'Size')?.props?.value).toBe('12');
  expect(findClearCarried(t, 'Size')).toBeDefined();
  // He % is the same cylinder's own null field — must not be marked, the tanks-array
  // analogue of the Buddy/Guide check above: it proves computeCarriedPaths' per-key
  // iteration over one cylinder, not an all-or-nothing flag for the whole tank.
  expect(findClearCarried(t, 'He %')).toBeUndefined();
});
