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
import { type Dive, type Tank } from '../domain/types';
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

/**
 * The one place this file stubs `useDives()`, and deliberately `mockImplementation`
 * rather than `mockReturnValue`.
 *
 * The real hook hands back a **brand-new object, holding a brand-new array, on every
 * render**: `composeDives`'s `toDives` is `rows.map(toDive).sort(...)` (db/dives.ts), and
 * the wrapper object is an object literal in `useDives`'s own return statement. A
 * `mockReturnValue` stub models the exact opposite contract — one object, referentially
 * stable forever — and that fiction is why 537 green tests never noticed that this screen
 * looped infinitely on mount in create mode: its render-phase `setState` was gated on
 * `initialValues !== carriedPathsSource`, a comparison that can only ever settle if
 * `dives` eventually stops changing identity, which it never does.
 *
 * Every stub goes through here, spreading into a fresh array and a fresh `Map` per call,
 * so no test in this file can quietly reintroduce the stable-object fiction — and so
 * every test here exercises the hook's real worst case rather than a friendlier one.
 */
function stubDives(state: { dives?: Dive[]; numbers?: Map<string, number>; error?: Error } = {}) {
  mockUseDives.mockImplementation(() => ({
    dives: [...(state.dives ?? [])],
    numbers: new Map(state.numbers ?? []),
    error: state.error,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  stubDives();
  // Set explicitly rather than left to the module factory's own `jest.fn(() => true)`:
  // `clearAllMocks` clears calls but not return values, so one test overriding this would
  // otherwise leak its `false` into every test declared after it.
  (router.canGoBack as jest.Mock).mockReturnValue(true);
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

/**
 * Every path in `value` that holds the literal `0`, however deeply nested.
 *
 * `Object.entries(input)` walks exactly one level, and the payload `createDive` receives is
 * `{ date, tanks: [{ ... }] }` — so applied to `{ date, tanks: [{ sizeL: 0, count: 0 }] }` a
 * one-level walk finds nothing to check and stays green, missing the one case DESIGN.md §10
 * calls *contradictory*: a `0` size or count voids the dive's whole gas figure, where an
 * absent one merely skips that cylinder. Returning the paths rather than a count is what
 * makes a failure name the offending field instead of just asserting a number.
 */
function zeroPaths(value: unknown, path = ''): string[] {
  if (typeof value === 'number' && value === 0) return [path || '(root)'];
  if (Array.isArray(value)) return value.flatMap((item, index) => zeroPaths(item, `${path}[${index}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => zeroPaths(item, path === '' ? key : `${path}.${key}`));
  }
  return [];
}

it('sends no zeros for fields the diver left empty, cylinders included', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  const input = mockCreate.mock.calls[0]?.[1] ?? {};
  // The blank cylinder is actually in there to be checked — otherwise this walks a payload
  // with no nested object in it and proves nothing about nesting.
  expect(Array.isArray((input as { tanks?: unknown[] }).tanks)).toBe(true);
  expect((input as { tanks: unknown[] }).tanks.length).toBeGreaterThan(0);
  expect(zeroPaths(input)).toEqual([]);
});

// I2: a successful save leaves this screen the same way DiveDetailScreen's back control
// leaves that one — `backToDives` (navigation/backToDives.ts) owns the rule for both. The
// two tests below are DiveDetailScreen.test.tsx's own pair of branch tests, applied to this
// screen's own exit, because the `router.replace('/')` half had no coverage anywhere near
// this screen: `canGoBack` was mocked true everywhere, so deleting the fallback left every
// test green while a deep-linked diver saved and then sat on the form with no feedback.

it('pops the navigation stack after a save, when there is history to go back to', async () => {
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(router.replace).not.toHaveBeenCalled();
});

it('replaces to the dives list after a save reached by a deep link, with no history to pop', async () => {
  (router.canGoBack as jest.Mock).mockReturnValue(false);
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(router.back).not.toHaveBeenCalled();
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
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
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
  stubDives({
    // The order a real useDives() call actually hands back: newest first, and a
    // future-dated planned dive sorts ahead of a past logged one in that same order —
    // DivesScreen.tsx's own "Up next" section relies on the identical fact.
    dives: [
      dive({ status: 'planned', date: '2026-09-15', buddy: 'Alice' }),
      dive({ status: 'logged', date: '2026-08-01', buddy: 'Petr' }),
    ],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  const peopleHeader = findButton(t, 'People');
  if (!peopleHeader) throw new Error('no People header found');
  await fireEvent.press(peopleHeader);

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petr');
});

it('drops the carried chip the moment the diver types over it', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
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
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [tank({ sizeL: 12 })] })] });
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

// --- C2: a double-tapped Save must not log the dive twice ---
//
// DESIGN.md §10 names this in as many words: "the save control also needs an in-flight
// disabled state, since the repository is safe under concurrency but a double-tap would
// create two dives." `handleSubmit` has no re-entrancy latch of its own, so the screen
// needs one — and the two halves of that guard are tested separately below, because a test
// that only ever exercised one of them would go green with the other deleted.

/**
 * A `createDive` that hangs until the test lets it finish. `releaseWrite` is assigned
 * synchronously by the `Promise` constructor, so it is callable before `createDive` has
 * been called even once — which matters, because these tests hold one write open across a
 * second press that has not happened yet.
 */
function hangingCreate(created: Dive): () => void {
  let releaseWrite!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  mockCreate.mockImplementation(async () => {
    await inFlight;
    return created;
  });
  return releaseWrite;
}

/**
 * A second activation of the save control dispatched straight at the committed host node,
 * rather than through `fireEvent.press`.
 *
 * Two reasons, both load-bearing. `fireEvent.press` opens an `act` scope of its own, and
 * the first press's scope is still open here (its write is deliberately held), which React
 * rejects outright — "You seem to have overlapping act() calls" — and which leaves the NEXT
 * test rendering against a corrupted tree, the exact cross-test damage `pressSave`'s comment
 * above documents. And `onClick` is the activation path that does NOT consult the control's
 * `disabled` prop, which is what makes this test pin the re-entrancy LATCH specifically:
 * verified by mutation in both directions — deleting `savingRef`'s check makes this test
 * report two writes even with `disabled` still wired, and deleting the `disabled` prop
 * leaves it reporting one.
 */
function tapSaveAgain(t: RenderResult) {
  const save = findButton(t, 'Save');
  if (!save) throw new Error('no Save control found');
  save.props.onClick({ nativeEvent: {}, stopPropagation() {}, preventDefault() {}, persist() {} });
}

/** Lets already-scheduled microtasks and timers run — enough for a press's own async
 * resolver chain to reach (or be turned away at) the latch. */
async function settle(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

it('creates one dive, not two, when Save is double-tapped while the write is in flight', async () => {
  const releaseWrite = hangingCreate(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');

  // Deliberately not awaited: `fireEvent.press` only settles once the handler's whole
  // chain has, and this write is held open on purpose — awaiting here would rule out the
  // very overlap this test exists to create.
  const first = fireEvent.press(findButton(t, 'Save')!);
  // The second tap in the SAME frame, before React has re-rendered the control as disabled
  // — which is what a double-tap actually is, and what leaves the re-entrancy latch as the
  // only thing that can turn it away. Dispatched even a tick later and the `disabled` prop
  // alone would swallow it, and this test would pass with the latch deleted.
  tapSaveAgain(t);
  await settle();

  // Recorded before the write is released, so this is genuinely "while in flight" and not
  // "after the latch had already let go".
  const writesInFlight = mockCreate.mock.calls.length;

  releaseWrite();
  await first;

  expect(writesInFlight).toBe(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  // One dive logged, one return to the list — not two of either.
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('lets the diver try again after a failed save, rather than latching the control shut', async () => {
  mockCreate.mockRejectedValue(new Error('disk full'));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

  // A guard that never released would strand the diver on a form they cannot resubmit —
  // the same "told nothing, can do nothing" dead end §1 exists to prevent, reached from the
  // opposite direction.
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
});

it('marks the save control disabled while a write is in flight, and only then', async () => {
  const releaseWrite = hangingCreate(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await typeInto(t, 'Date', '2026-08-16');
  // §1 binds the control itself: nothing about form validity may disable it.
  expect(findButton(t, 'Save')?.props?.accessibilityState?.disabled).not.toBe(true);

  // `accessibilityState.disabled` is the half a screen reader announces, and the only half
  // observable from here: `Pressable` consumes the `disabled` prop itself rather than
  // forwarding it to the host `View` these queries reach. Both are set on the control; a
  // control that silently ignores a tap it still announces as available is its own kind of
  // dead button, and this is the one of the two a test can actually see.
  const press = fireEvent.press(findButton(t, 'Save')!);
  await waitFor(() => expect(findButton(t, 'Save')?.props?.accessibilityState?.disabled).toBe(true));

  releaseWrite();
  await press;
  await waitFor(() => expect(findButton(t, 'Save')?.props?.accessibilityState?.disabled).not.toBe(true));
});

// --- C1: the screen the `+` button opens must actually mount ---
//
// Deliberately placed AFTER the in-flight save tests above: those hold a write open across
// an un-awaited press, and the cheapest proof that they leave nothing settling into the
// next test is a block of fresh mounts that would fail loudly against a corrupted tree.
//
// `useDives()` returns a fresh object and a fresh `dives` array every render (see
// `stubDives` at the top of this file). This screen's render-phase `setState` used to be
// gated on `initialValues !== carriedPathsSource` — an object-identity comparison over a
// value recomputed from `dives` — so the gate could never close, React re-rendered after
// every render-phase update, and mounting create mode threw "Too many re-renders." The
// gate now compares the id of the dive carry-over came from, a string (or `null`), which
// compares by value and cannot churn.
//
// Three separate mounts, because the loop is not conditional on the data: it fired with
// an empty logbook, with a populated one, and in edit mode, and a regression that
// restored it in only one of those cases would otherwise slip through.

it('mounts in create mode with an empty logbook, without looping on a fresh dives array', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // A positive assertion, not merely "render() did not throw": a screen that rendered
  // nothing at all would satisfy the absence of a throw just as well.
  expect(textIn(t).join(' ')).toContain('New dive');
  expect(findButton(t, 'Save')).toBeDefined();
});

it('mounts in create mode with a real carry-over source, without looping', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  expect(textIn(t).join(' ')).toContain('New dive');
  // The carried value still lands — the fix must not have bought stability by dropping
  // carry-over on the floor.
  const peopleHeader = findButton(t, 'People');
  if (!peopleHeader) throw new Error('no People header found');
  await fireEvent.press(peopleHeader);
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petr');
});

it('mounts in edit mode too, where carry-over never applies but the same gate ran', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="edit" diveId="some-id" />);
  expect(textIn(t).join(' ')).toContain('Edit dive');
  expect(findButton(t, 'Save')).toBeDefined();
});

// The re-derivation the gate exists for still has to happen: `useDives()` starts empty and
// resolves asynchronously, so the carried set must be rebuilt when the carry-over source
// dive actually changes — not merely when its containing array is rebuilt. Without this,
// "compare a stable scalar" could be satisfied by comparing a constant.
it('re-derives the carried set when useDives resolves after the first render', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const peopleHeader = findButton(t, 'People');
  if (!peopleHeader) throw new Error('no People header found');
  await fireEvent.press(peopleHeader);
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();

  // The async read lands: a real logged dive appears where there was none. `rerender`
  // rather than pressing something on screen — `FormGroup` owns its own expanded state, so
  // pressing a group header re-renders that group and never this screen, which is precisely
  // the render `useDives()` would have to run again in.
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  await t.rerender(<DiveFormScreen mode="create" />);

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petr');
  expect(findClearCarried(t, 'Buddy')).toBeDefined();
});
