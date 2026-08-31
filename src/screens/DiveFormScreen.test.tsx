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

import { createDive, updateDive } from '../db/dives';
import { useDives } from '../db/useDives';
import { dive } from '../domain/diveFixture';
import { formatTankMaterial } from '../format/display';
import {
  ENTRY_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  WATER_BODY_VALUES,
  type Dive,
  type Tank,
} from '../domain/types';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { depthScale } from '../theme/tokens';
import DiveFormScreen from './DiveFormScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
// Task 6: DiveFormScreen.tsx now reads useDives() for carry-over and calls createDive on
// save, so this screen's test needs the same per-module mock split DivesScreen.test.tsx
// already established: the one read mocked here, the write mocked separately (below) so a
// save test can control exactly what it resolves or rejects with, without a real database.
// Task 7 gives updateDive a real caller: mode="edit" writes a patch of changed fields
// through it, and completing a planned dive (§2.4) is that same write plus `status`.
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
const mockUpdate = updateDive as jest.Mock;

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

// --- M1d: `date` and `timeIn` are pickers now, not text fields (DESIGN.md §10) ---
//
// A picker-backed field has no `TextInput` to type into and no `value` prop to read back, so
// the three helpers below stand in for `typeInto`/`findTextInput` on exactly those two
// fields. They drive the real control end to end — press the field, then post the same
// `change` event the native side posts — rather than reaching for the component's props, so
// a screen wired to a picker that could never be opened would fail here rather than pass.

/** The field's own 48 dp control, by the `` `${label}: ${value}` `` shape `DateTimeField`
 * announces. */
function findPickerField(t: RenderResult, label: string) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '').startsWith(`${label}: `));
}

/** What a picker field currently shows the diver — the counterpart of `findTextInput(...)
 * .props.value` for a control that holds no text of its own. */
function shownIn(t: RenderResult, label: string): string {
  const announced = String(findPickerField(t, label)?.props?.accessibilityLabel ?? '');
  return announced.slice(`${label}: `.length);
}

/**
 * Picks a value in a picker field, the way the device does: open the field, then post the
 * native `change` event carrying an epoch timestamp, which the library's own JS layer turns
 * into the `Date` the component converts.
 *
 * The timestamp is built from LOCAL calendar components — `new Date(year, month - 1, day)`
 * — because that is what a real picker returns for a chosen day, and because building it
 * with `Date.parse('2026-08-16')` (UTC midnight) would quietly hand the screen a moment on
 * the previous day west of Greenwich and make this helper agree with a bug rather than
 * catch one.
 */
async function pickInto(t: RenderResult, label: string, moment: Date) {
  const field = findPickerField(t, label);
  if (!field) throw new Error(`no ${label} field found`);
  await fireEvent.press(field);
  const picker = (t.root ? t.root.queryAll((n) => n.type === 'RNDateTimePicker') : [])[0];
  if (!picker) throw new Error(`the ${label} field opened no picker`);
  await fireEvent(picker, 'change', { nativeEvent: { timestamp: moment.getTime(), utcOffset: 0 } });
  // Closed again afterwards, so only one picker is ever open at a time (the query above
  // takes the first) and so this leaves the screen the way a diver would.
  await fireEvent.press(field);
}

/**
 * The moment is built from LOCAL calendar components — `new Date(year, month - 1, day)` —
 * because that is what a real picker returns for a chosen day, and because building it with
 * `Date.parse('2026-08-16')` (UTC midnight) would quietly hand the screen a moment on the
 * previous day west of Greenwich, making this helper agree with a bug rather than catch one.
 */
async function pickDate(t: RenderResult, isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number);
  await pickInto(t, 'Date', new Date(Number(year), Number(month) - 1, Number(day)));
}

/** Opens a collapsed §2.2 group, so a test can reach the fields inside it. */
async function openGroup(t: RenderResult, title: string) {
  const header = findButton(t, title);
  if (!header) throw new Error(`no ${title} header found`);
  await fireEvent.press(header);
}

// --- §2.4: the Logged/Planned control ---
//
// Queried by the `switch` role rather than by `button`, which is exactly how the screen
// declares it (the same idiom `BooleanField` uses for hood/gloves/boots) — and which means
// `findButton(t, 'Save')` above can never accidentally land on it.

/** The status control itself, or `undefined` when the screen renders none. */
function findStatusControl(t: RenderResult) {
  return (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'switch') : []).find(
    (n) => String(n.props?.accessibilityLabel ?? '') === 'Planned dive',
  );
}

/** Whether the control is currently on Planned, read from the state it ANNOUNCES rather
 * than from the word on its face — a control that showed "Planned" while telling a screen
 * reader it was off would pass a text assertion and be broken. The visible label is checked
 * against this separately, once, below. */
function plannedIsOn(t: RenderResult): boolean {
  return findStatusControl(t)?.props?.accessibilityState?.checked === true;
}

/** Moves the control. Awaited like every other `fireEvent` in this file — see `pressSave`
 * for what an un-awaited one does to the test that runs next. */
async function toggleStatus(t: RenderResult) {
  const control = findStatusControl(t);
  if (!control) throw new Error('no Logged/Planned control found');
  await fireEvent.press(control);
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
  await pickDate(t, '2026-08-16');
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

it('saves the depth a Czech keypad typed, comma and all', async () => {
  // The entry half of the decimal-comma defect. `decimal-pad` is the keyboard every
  // numeric field on this form asks for (FormField.tsx), and on a `cs`/`de`/`fr` device its
  // separator key types `,` — so this is the ordinary spelling for the app's first diver,
  // and it used to reach `createDive` as no depth at all.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  await typeInto(t, 'Max depth', '18,4');
  await typeInto(t, 'Duration', '47');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  const input = mockCreate.mock.calls[0]?.[1] ?? {};
  expect(input).toEqual(expect.objectContaining({ maxDepthM: 18.4, durationMin: 47 }));
  // `toNewDiveInput` omits a null field entirely, so the failure this guards is a MISSING
  // key rather than a null one — which `objectContaining` above would also catch, but only
  // by accident of what it happens to name. Said outright.
  expect(input).toHaveProperty('maxDepthM');
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
  await pickDate(t, '2026-08-16');
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
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(router.replace).not.toHaveBeenCalled();
});

it('replaces to the dives list after a save reached by a deep link, with no history to pop', async () => {
  (router.canGoBack as jest.Mock).mockReturnValue(false);
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(router.back).not.toHaveBeenCalled();
});

// --- I3, as it stands after M1d's pickers ---
//
// A date the schema cannot read used to make Save do nothing at all — no dive, no
// navigation, no message — and `31.8.2026`, the Czech spelling of a real date in an app that
// ships `cs`, was one keystroke away at any moment. Since `date` became a picker there is no
// keystroke to make: the control cannot produce an unreadable value, which is the owner's
// resolution of §1 versus §2.2 (DESIGN.md §10) — the case is removed rather than adjudicated.
//
// The three tests below therefore no longer type. They cover what is left, which is not
// nothing: **the schema rule and the message it raises both stay**, because the schema is
// the domain's guarantee rather than this form's, and a value the diver never entered can
// still reach the field. Carry-over is the live path for that today — this form prefills
// from the diver's own most recent logged dive (§2.1), and M2 sync will deliver those rows
// from other clients — so a row whose `date` is real but not canonical (`2099-8-17`, which
// `isCalendarDate` refuses and `normaliseCalendarDate` would accept) lands in the field
// without this screen's controls ever touching it.
//
// The first test below is the one that would catch a future "the UI is safe now, delete the
// rule" change; the second and third pin that the message clears and sits where it belongs.

/** A logged dive whose stored date is real but not canonical — the shape an M2 sync from
 * another client can deliver, and the only thing that still puts an unreadable value in
 * front of this form. Dated far ahead so `carryOverDate`'s own 48-hour rule keeps it rather
 * than substituting today: that is the mechanics of getting the value into the field, not
 * the point being made. */
const nonCanonicalSource = () => stubDives({ dives: [dive({ status: 'logged', date: '2099-8-17' })] });

it('says why Save did nothing for a date this form itself could never have produced', async () => {
  nonCanonicalSource();
  const t = await render(<DiveFormScreen mode="create" />);
  await pressSave(t);

  // The schema's own message (diveFormSchema.ts: "Enter a real date (YYYY-MM-DD)."), not a
  // second sentence written in the screen — asserted on its distinctive half so this fails
  // if the screen ever starts inventing its own wording.
  await waitFor(() => expect(textIn(t).join(' ')).toContain('Enter a real date'));
  expect(mockCreate).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  // And §1's other direction: the value is shown as it stands rather than blanked or
  // silently "corrected" into a different day.
  expect(shownIn(t, 'Date')).toBe('2099-8-17');
});

it('clears the date message once the diver picks a real date, rather than leaving a stale warning', async () => {
  nonCanonicalSource();
  mockCreate.mockResolvedValue(dive({ date: '2026-08-31' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await pressSave(t);
  await waitFor(() => expect(textIn(t).join(' ')).toContain('Enter a real date'));

  await pickDate(t, '2026-08-31');
  await waitFor(() => expect(textIn(t).join(' ')).not.toContain('Enter a real date'));
  // Two taps in the picker is the whole repair — and the field now reads as a diver writes
  // a date, through formatDiveDate.
  expect(shownIn(t, 'Date')).toBe('31 Aug 2026');

  // And the save the message was blocking now goes through, so this proves a corrected
  // form recovers rather than merely that one string disappeared.
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ date: '2026-08-31' }));
});

it('shows a blocking field message under the field it belongs to, not somewhere else', async () => {
  nonCanonicalSource();
  const t = await render(<DiveFormScreen mode="create" />);
  await pressSave(t);
  await waitFor(() => expect(textIn(t).join(' ')).toContain('Enter a real date'));

  // The message is a sibling of the Date field's own root, not a screen-level banner that
  // happens to mention a date — "near the control that caused it" is the whole point, and a
  // top-of-screen notice would satisfy a bare text assertion just as well.
  const message = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes('Enter a real date'));
  const dateField = findPickerField(t, 'Date');
  expect(message).toBeDefined();
  expect(dateField).toBeDefined();
  // DateTimeField.tsx renders `formField` > the control; the message sits next to that
  // `formField`, so the two share a grandparent-level container.
  expect(message?.parent?.parent).toBe(dateField?.parent?.parent);
});

it('tells the diver when a save fails instead of pretending it worked', async () => {
  mockCreate.mockRejectedValue(new Error('disk full'));
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  // §1's "never block a save" does not mean "never admit a save failed"
  await waitFor(() => expect(textIn(t).join(' ').toLowerCase()).toContain("couldn't"));
  expect(router.back).not.toHaveBeenCalled();
  // Added: "the form keeps its values on failure" (this task's own brief) is not actually
  // checked above — router.back() not firing only proves the screen didn't navigate away,
  // not that the diver's entry survived. Verified by mutation: a catch branch that clears
  // the date via `reset({ date: '' }, { keepDirtyValues: false })` still passes both
  // assertions above (a bare `reset()` alone does not — this screen's own `resetOptions:
  // { keepDirtyValues: true }`, DiveFormScreen.tsx, already protects a dirty field from
  // that simpler case) — only reading the field back catches the explicit-override one.
  expect(shownIn(t, 'Date')).toBe('16 Aug 2026');
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
  await pickDate(t, '2026-08-16');

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
  await pickDate(t, '2026-08-16');
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
  await pickDate(t, '2026-08-16');
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

// --- M3: carrying over from a dive that recorded no cylinders ---
//
// `tanks` is the one Dive field that is never nullable, and `[]` is a legitimate value for
// it — "an empty array already means no cylinders recorded" (DESIGN.md §6, diveFormSchema's
// own comment). `carryOverFrom` copies it faithfully, which used to overwrite the single
// blank cylinder `blankFormValues()` guarantees, leaving this screen's `tanks.0.*` fields
// bound to an array element that does not exist: the form went on SHOWING one cylinder
// (§6 — it shows exactly one until "+ add cylinder" exists) while HOLDING none, and two
// divers who both left the cylinder group untouched wrote different data purely because of
// what their previous dives happened to record.

/** The `tanks` a save actually wrote, from the one `createDive` call. */
function writtenTanks(): { sizeL?: number | null; count?: number | null }[] | undefined {
  return (mockCreate.mock.calls[0]?.[1] as { tanks?: { sizeL?: number | null; count?: number | null }[] })?.tanks;
}

it('still holds its one blank cylinder when carrying over from a dive that logged none', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [], buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  // Untouched on purpose: this is the shape the form was already showing, so it is the
  // shape the write has to carry. Typing into the cylinder first would hide the defect —
  // react-hook-form creates `tanks[0]` on the first keystroke either way.
  expect(writtenTanks()).toHaveLength(1);
  // And nothing was invented to get there: an empty cylinder is all-null, never 0 (§10 —
  // a 0 size or count is *contradictory* and voids the dive's whole gas figure).
  expect(zeroPaths(mockCreate.mock.calls[0]?.[1] ?? {})).toEqual([]);
});

it('writes the same cylinder shape whether the previous dive logged none or there was no previous dive', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [] })] });
  const carried = await render(<DiveFormScreen mode="create" />);
  await pickDate(carried, '2026-08-16');
  await pressSave(carried);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  const afterEmptyCarryOver = writtenTanks();

  mockCreate.mockClear();
  stubDives();
  const fresh = await render(<DiveFormScreen mode="create" />);
  await pickDate(fresh, '2026-08-16');
  await pressSave(fresh);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  // Two divers, the same untouched form, the same write — the previous dive having
  // recorded no cylinders is not a fact about THIS dive.
  expect(afterEmptyCarryOver).toEqual(writtenTanks());
});

it('carries a real cylinder through unchanged, so the empty-tanks fix is not a blanket override', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [tank({ sizeL: 12, count: 2 })] })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  expect(writtenTanks()).toHaveLength(1);
  expect(writtenTanks()?.[0]?.sizeL).toBe(12);
  expect(writtenTanks()?.[0]?.count).toBe(2);
});

// Every fixed-option field offers exactly the vocabulary `domain/types.ts` declares — read
// off those arrays rather than a list written here, so a member added there either shows up
// as a chip or fails this test. This screen used to keep a second copy of all five, typed
// `readonly Entry[]`, which type-checks a list that is MISSING a member perfectly happily:
// the missing value was a chip the diver never saw, plus a Zod rejection that blocked the
// whole save if it ever arrived from anywhere else, and nothing failed to build.
describe('the fixed-option chips, against the vocabulary they come from', () => {
  /** The chip labels for one field, by the `` `${label}: ${text}` `` shape `OptionChips`
   * announces — the values themselves, not the display strings, so this stays about which
   * options exist rather than about how they are capitalised. */
  function chipsFor(t: RenderResult, label: string): string[] {
    return buttonsOf(t)
      .map((n) => String(n.props?.accessibilityLabel ?? ''))
      .filter((announced) => announced.startsWith(`${label}: `))
      .map((announced) => announced.slice(`${label}: `.length));
  }

  it.each([
    ['Entry', 'Conditions', ENTRY_VALUES],
    ['Salinity', 'Conditions', SALINITY_VALUES],
    ['Water body', 'Conditions', WATER_BODY_VALUES],
    ['Suit', 'Equipment', SUIT_VALUES],
    ['Material', 'Gas & cylinders', TANK_MATERIAL_VALUES],
  ] as const)('offers one %s chip per value the domain declares', async (label, group, values) => {
    const t = await render(<DiveFormScreen mode="create" />);
    await openGroup(t, group);
    // Compared as a count and as a set of the underlying values: the labels themselves are
    // display strings (`formatEntry` and friends), so this asserts one chip per member
    // without pinning the wording, which format/display.ts owns.
    expect(chipsFor(t, label)).toHaveLength(values.length);
  });
});

it('labels the material chips from the one owner of that string, not a private copy', async () => {
  // The drift this closes was visible: this screen's own `materialLabel` said "Steel"
  // while DiveDetailScreen rendered the raw stored 'steel', so one cylinder read two ways
  // one screen apart. Asserted against `formatTankMaterial` itself rather than against the
  // literal "Steel", so the day that formatter changes — a unit/locale pass, an i18next
  // milestone — this screen either follows it or fails here.
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const labels = buttonsOf(t)
    .map((n) => String(n.props?.accessibilityLabel ?? ''))
    .filter((label) => label.startsWith('Material: '));
  expect(labels).toEqual([
    `Material: ${formatTankMaterial('steel')}`,
    `Material: ${formatTankMaterial('alu')}`,
  ]);
  // The formatter is not returning null here, which would make the two expectations above
  // read "Material: null" and agree with each other for the wrong reason.
  expect(formatTankMaterial('steel')).toBe('Steel');
});

it('asks for whole cylinders with a keypad that has no separator on it', async () => {
  // §6: "count (twinset = 2)". A fractional count is *contradictory* in derived.ts — it
  // voids the dive's whole gas figure rather than skipping the cylinder — so this field
  // must not be handed `decimal-pad`, whose separator key types a comma on the Czech
  // device this app's first diver holds. Checked against Size in the same render, so a
  // screen that gave every cylinder field the same keyboard fails here.
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(findTextInput(t, 'Count')?.props?.keyboardType).toBe('number-pad');
  expect(findTextInput(t, 'Size')?.props?.keyboardType).toBe('decimal-pad');
});

it('rounds a cylinder count that reaches it fractional anyway, rather than voiding the gas figure', async () => {
  // The keypad stops a diver typing 1.5; this is the value arriving from somewhere the
  // keypad does not govern — carry-over from a row an M2 client wrote, a device keypad
  // that offers a separator regardless. `countGas` (derived.ts) reads a non-integer count
  // exactly as it reads 0: contradictory, and the whole dive's RMV and gas-used figures
  // disappear with no message anywhere.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-16', tanks: [tank({ sizeL: 12, count: 1.5 })] })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  expect(writtenTanks()?.[0]?.count).toBe(2);
  expect(Number.isInteger(writtenTanks()?.[0]?.count)).toBe(true);
  // Not rounded into the OTHER contradictory value: `sizeL` is a real measurement and
  // 11.1 l is an ordinary cylinder, so the rounding must be scoped to the count alone.
  expect(writtenTanks()?.[0]?.sizeL).toBe(12);
});

it('lets the diver fill the cylinder in, after carrying over from a dive that logged none', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [] })] });
  const t = await render(<DiveFormScreen mode="create" />);
  const gasHeader = findButton(t, 'Gas & cylinders');
  if (!gasHeader) throw new Error('no Gas & cylinders header found');
  await fireEvent.press(gasHeader);
  await typeInto(t, 'Size', '15');
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  expect(writtenTanks()).toHaveLength(1);
  expect(writtenTanks()?.[0]?.sizeL).toBe(15);
});

// --- M1d: date and time are pickers, so an invalid value cannot be entered (§10) ---
//
// The owner's call, and the reason this screen no longer has a text field for either: a
// mistyped date was the one thing on this form that could refuse a save (§1), and a mistyped
// time silently dropped a dive out of §2.5's time-ordering and voided its surface interval.
// Every test below is about the SCREEN's wiring — that the right control is on the right
// field and that what it produces reaches `createDive` in the stored string form.
// `DateTimeField.test.tsx` owns the control's own behaviour, and does it in UTC+14.

it('offers no free-text field for the date or the entry time', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // The regression this whole task exists to prevent, stated directly: a future edit that
  // put either field back on the keyboard fails here.
  expect(findTextInput(t, 'Date')).toBeUndefined();
  expect(findPickerField(t, 'Date')).toBeDefined();

  await openGroup(t, 'Times & depth');
  expect(findTextInput(t, 'Time in')).toBeUndefined();
  expect(findPickerField(t, 'Time in')).toBeDefined();

  // And the fields either side of them ARE still text fields, so none of the above is
  // passing merely because `findTextInput` stopped finding anything.
  expect(findTextInput(t, 'Site')).toBeDefined();
  expect(findTextInput(t, 'Avg depth')).toBeDefined();
});

it('opens on a real date the diver can read, without anyone typing one', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // The form's own default (today) reaches the field already formatted the way a diver
  // writes a date — "16 Aug 2026", never the stored "2026-08-16" — and it is a date the
  // schema accepts, which is why an untouched form saves.
  expect(shownIn(t, 'Date')).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
});

it('stores a picked date as the YYYY-MM-DD string, never a Date', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  expect(shownIn(t, 'Date')).toBe('16 Aug 2026');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  // §10: the domain, the database and the sync protocol all speak the string form, so the
  // `Date` the picker deals in must not survive as far as the write.
  const written = (mockCreate.mock.calls[0]?.[1] ?? {}) as { date?: unknown };
  expect(written.date).toBe('2026-08-16');
  expect(typeof written.date).toBe('string');
});

it('stores a picked entry time as the HH:MM string the domain sorts and computes on', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Times & depth');
  // 07:05 rather than a round hour: a single-digit hour and a leading-zero minute are
  // exactly what used to be typed as '7:5' and sort after '19:00' (datetime.ts's own
  // docblock), so this pins the canonical spelling and not just "some time".
  await pickInto(t, 'Time in', new Date(2026, 7, 16, 7, 5));
  expect(shownIn(t, 'Time in')).toBe('07:05');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ timeIn: '07:05' }));
});

it('saves a dive with no entry time at all, which stays optional', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Times & depth');
  // §2.2: only the date is required. An untouched time field reads as unrecorded and must
  // reach the write as nothing at all — `toNewDiveInput` omits a null rather than sending it.
  expect(shownIn(t, 'Time in')).toBe('Not set');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0]?.[1]).not.toHaveProperty('timeIn');
});

it('clears a picked entry time back to unrecorded, and still saves', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Times & depth');
  await pickInto(t, 'Time in', new Date(2026, 7, 16, 7, 5));

  const clear = buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === 'Clear Time in');
  if (!clear) throw new Error('no clear control on the entry time');
  await fireEvent.press(clear);
  expect(shownIn(t, 'Time in')).toBe('Not set');

  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  // Cleared means absent, never a stored `''` — which used to sort an untimed dive to the
  // head of its day instead of the tail (§2.5, storedTimeOfDay's own docblock).
  expect(mockCreate.mock.calls[0]?.[1]).not.toHaveProperty('timeIn');
});

it('asks for no exit time, which is computed rather than entered', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Times & depth');
  // §0.6: `timeOut` is derived from time in plus duration (derived.ts) and is marked as
  // computed where it is shown. A control for it would be a second, contradictable source.
  expect(findTextInput(t, 'Time out')).toBeUndefined();
  expect(findPickerField(t, 'Time out')).toBeUndefined();
  expect(textIn(t).join(' ')).not.toContain('Time out');
});

// --- Task 7: editing a dive, completing a planned one, and leaving without saving ---
//
// Everything below drives `mode="edit"`, which had never been exercised by a test before
// this task: the screen accepted the prop, showed a different heading, and wrote nothing.
// `stubDives` (top of this file) is what puts the dive on screen — edit mode finds it inside
// `useDives()`'s own list, exactly as DiveDetailScreen does, rather than through a second
// query — so a fresh array and a fresh object still arrive on every render here too.

/** The dive under edit in most of the tests below. A function, not a shared constant: each
 * test gets its own object, so one test mutating what it was handed cannot reach another. */
const existing = () =>
  dive({ id: 'target', date: '2026-08-16', siteName: 'Blue Hole', maxDepthM: 32.4, notes: 'Arch at 30 m' });

/** The patch `updateDive(db, id, patch)` was called with — the third argument, and the
 * whole point of every test in this section. */
function writtenPatch(): Record<string, unknown> {
  return (mockUpdate.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
}

it('sends only the fields that changed', async () => {
  const target = existing();
  stubDives({ dives: [target] });
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await typeInto(t, 'Max depth', '28.0');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  expect(writtenPatch()).toHaveProperty('maxDepthM', 28);
  // The other half of `updateDive`'s contract (db/dives.ts): a field the patch does not
  // name is left alone. Sending `siteName: 'Blue Hole'` here would look harmless and is
  // not — under §7's whole-row last-write-wins it overwrites whatever another device wrote
  // to a field this diver never opened, while advancing `updated_at` so that write wins.
  expect(writtenPatch()).not.toHaveProperty('siteName');
  // The right dive, through the right function: an edit that reached `createDive` would
  // leave the original untouched and duplicate it, which no assertion about the patch alone
  // would notice.
  expect(mockUpdate.mock.calls[0]?.[1]).toBe('target');
  expect(mockCreate).not.toHaveBeenCalled();
});

it('clears a field the diver emptied, rather than leaving the old value', async () => {
  const target = existing();
  stubDives({ dives: [target] });
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  // `notes` lives inside a collapsed §2.2 group, so it has to be opened first — and the
  // value has to actually be there before emptying it means anything.
  await openGroup(t, 'Notes & rating');
  expect(findTextInput(t, 'Notes')?.props?.value).toBe('Arch at 30 m');

  await typeInto(t, 'Notes', '');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // `null`, not absent and not `''`: absent means "don't touch" to the repository, which
  // would silently keep the note the diver just deleted.
  expect(writtenPatch().notes).toBeNull();
  expect(writtenPatch()).toHaveProperty('notes');
});

it('keeps a depth typed with a decimal comma, rather than clearing the one already there', async () => {
  // The whole chain, not just the schema (diveFormSchema.test.ts covers that): a Czech
  // device's `decimal-pad` types `,` for the separator, and this is what a diver correcting
  // 32.4 m to 32.6 m on that keypad actually produces. `Number('32,6')` is NaN, which the
  // coercion contract maps to null — so the patch carried `maxDepthM: null` and the save
  // ERASED a depth that was on screen a moment earlier.
  const target = existing();
  stubDives({ dives: [target] });
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await typeInto(t, 'Max depth', '32,6');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  expect(writtenPatch()).toHaveProperty('maxDepthM', 32.6);
  // Stated separately, because `toHaveProperty(..., 32.6)` and "did not clear it" are two
  // different claims and it is the second one that cost a diver their reading.
  expect(writtenPatch().maxDepthM).not.toBeNull();
});

it('completing a planned dive turns it into a logged one', async () => {
  const planned = dive({ id: 'p1', date: '2026-09-05', status: 'planned', siteName: 'Silfra' });
  stubDives({ dives: [planned] });
  mockUpdate.mockResolvedValue(planned);
  // Arriving the way §2.4's *Complete dive* pill sends a diver: the control is already on
  // Logged, so saving finishes the dive. This used to happen with no control at all — the
  // screen logged any planned dive it was handed — which is what made the same save
  // complete a dive whose site name the diver had only come back to correct.
  const t = await render(<DiveFormScreen mode="edit" diveId="p1" initialStatus="logged" />);
  // §2.4: "Complete dive asks only for the missing numbers" — and this is the one that
  // makes the dive real.
  await typeInto(t, 'Duration', '44');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  expect(writtenPatch().status).toBe('logged');
  // The diver's own number went with it: a patch that logged the dive but dropped what
  // they actually came here to type would pass an assertion about `status` alone.
  expect(writtenPatch().durationMin).toBe(44);
});

it('says it is completing a planned dive when that is what the save will do', async () => {
  const planned = dive({ id: 'p1', date: '2026-09-05', status: 'planned' });
  stubDives({ dives: [planned] });
  const t = await render(<DiveFormScreen mode="edit" diveId="p1" initialStatus="logged" />);
  // Saving is what logs the dive (§2.4), so the screen has to say so before it happens —
  // and all three of the things that say it agree: the heading, the control, and the
  // button. The heading is a claim about THIS save now, not about the dive's stored status,
  // which is why the control has to be on Logged for it to appear at all.
  expect(textIn(t).join(' ')).toContain('Complete dive');
  expect(textIn(t).join(' ')).not.toContain('Edit dive');
  expect(plannedIsOn(t)).toBe(false);
  expect(textIn(t).join(' ')).toContain('Save dive');
});

it('does not promise to complete a planned dive it is only going to edit', async () => {
  const planned = dive({ id: 'p1', date: '2026-09-05', status: 'planned' });
  stubDives({ dives: [planned] });
  // No `initialStatus`: this is the diver who opened the dive to fix something, not the one
  // who came through the *Complete dive* pill. The heading said "Complete dive" here for as
  // long as the save silently made it true; with that rule deleted, saying it would be a
  // false promise — the exact defect §3 of this task removes.
  const t = await render(<DiveFormScreen mode="edit" diveId="p1" />);

  expect(plannedIsOn(t)).toBe(true);
  expect(textIn(t).join(' ')).not.toContain('Complete dive');
  // ...and it is not calling a plan a dive either: heading and button both say plan, which
  // is what the control says and what the save will leave it as.
  expect(textIn(t).join(' ')).toContain('Edit plan');
  expect(textIn(t).join(' ')).toContain('Save plan');
});

it('leaves a logged dive logged — status is not written on every save', async () => {
  const target = existing();
  stubDives({ dives: [target] });
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await typeInto(t, 'Max depth', '28');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // The mirror of the completion test above: `status: 'logged'` on every edit would be
  // invisible on a logged dive and pass that test just as well, while quietly touching a
  // column no edit asked about.
  expect(writtenPatch()).not.toHaveProperty('status');
  expect(textIn(t).join(' ')).toContain('Edit dive');
});

it("opens both pickers on the dive's own date and time, not on today", async () => {
  stubDives({ dives: [dive({ id: 'target', date: '2026-08-16', timeIn: '07:05' })] });
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);

  // Read the way a diver writes a date (`formatDiveDate`), never the stored ISO string —
  // and it is the DIVE's date, which is what an unseeded picker (today, or "Not set") would
  // fail to be.
  expect(shownIn(t, 'Date')).toBe('16 Aug 2026');
  await openGroup(t, 'Times & depth');
  expect(shownIn(t, 'Time in')).toBe('07:05');
});

it('marks nothing as carried in edit mode — a dive already holds its own values', async () => {
  stubDives({ dives: [dive({ id: 'target', date: '2026-08-16', siteName: 'Blue Hole', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'People');

  // Both halves matter. The value IS seeded (this is the dive's own data)...
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petr');
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Blue Hole');
  // ...but §0.6's chip means "this came from your LAST DIVE", which is not true of any
  // field here — and a `×` on it would offer to clear a value the diver actually stored.
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
  expect(findClearCarried(t, 'Site')).toBeUndefined();
});

it('sends an empty patch, and still returns to the list, when nothing was changed', async () => {
  const target = existing();
  stubDives({ dives: [target] });
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // The strongest statement of the whole diff: a dive read into the form, parsed back out
  // by the schema and compared against itself must produce NOTHING. Any field that fails to
  // round-trip — a number reformatted, a null turned into '', the blank cylinder the form
  // always shows — shows up here as a key that should not exist.
  expect(writtenPatch()).toEqual({});
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

it('leaves a recorded cylinder alone when the diver never opens the cylinder group', async () => {
  const target = dive({ id: 'target', date: '2026-08-16', tanks: [tank({ sizeL: 12, startBar: 200, endBar: 50 })] });
  stubDives({ dives: [target] });
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // `tanks` is the one field a diff cannot do with `===`, and the one the form rebuilds on
  // every render (it always shows a cylinder, recorded or not) — so an untouched cylinder
  // group is exactly where a whole-array rewrite would hide.
  expect(writtenPatch()).not.toHaveProperty('tanks');
});

it('writes a cylinder the diver actually changed', async () => {
  const target = dive({ id: 'target', date: '2026-08-16', tanks: [tank({ sizeL: 12 })] });
  stubDives({ dives: [target] });
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');
  expect(findTextInput(t, 'Size')?.props?.value).toBe('12');
  await typeInto(t, 'End pressure', '40');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // The other side of the test above: "never writes tanks" would pass that one and be
  // completely wrong. The whole cylinder goes, because `tanks` is one JSON column (§6) —
  // so the fields the diver did not touch have to survive the write.
  const tanks = writtenPatch().tanks as { sizeL?: number; endBar?: number }[] | undefined;
  expect(tanks).toHaveLength(1);
  expect(tanks?.[0]?.endBar).toBe(40);
  expect(tanks?.[0]?.sizeL).toBe(12);
});

it('seeds the form from a dive that only arrives after the first render', async () => {
  // `useDives()` starts empty and resolves asynchronously, so this is the ordinary case on
  // a real device, not an edge one: `defaultValues` is read once at construction, and edit
  // mode built on it alone would show a blank new-dive form over a real dive forever.
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  expect(findTextInput(t, 'Site')?.props?.value).toBe('');

  stubDives({ dives: [existing()] });
  await t.rerender(<DiveFormScreen mode="edit" diveId="target" />);

  expect(findTextInput(t, 'Site')?.props?.value).toBe('Blue Hole');
  expect(shownIn(t, 'Date')).toBe('16 Aug 2026');
});

it('writes nothing, and says so, when the dive being edited cannot be found', async () => {
  const t = await render(<DiveFormScreen mode="edit" diveId="gone" />);
  await pressSave(t);

  await waitFor(() => expect(textIn(t).join(' ')).toContain("Couldn't find that dive"));
  expect(mockUpdate).not.toHaveBeenCalled();
  // The failure that matters most: falling back to `createDive` would duplicate the dive on
  // every device that still has it, and again on every retry.
  expect(mockCreate).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
});

it('tells the diver when an edit fails to save, instead of pretending it worked', async () => {
  stubDives({ dives: [existing()] });
  mockUpdate.mockRejectedValue(new Error('disk full'));
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await typeInto(t, 'Max depth', '28');
  await pressSave(t);

  await waitFor(() => expect(textIn(t).join(' ').toLowerCase()).toContain("couldn't"));
  expect(router.back).not.toHaveBeenCalled();
  // §1 cuts both ways: what the diver typed survives a failed write.
  expect(findTextInput(t, 'Max depth')?.props?.value).toBe('28');
});

// --- Amendment D: the form had no visible way out at all ---

/** The form's exit control, by the label that says what it does. Deliberately checked
 * against `findButton(t, 'Save')` in the test below, because the one thing this control must
 * never be mistaken for is the primary action. */
const findLeave = (t: RenderResult) => findButton(t, 'Leave without saving');

it('offers a visible way out of a new dive, which saves nothing', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const leave = findLeave(t);
  expect(leave).toBeDefined();
  // Visible text, not only an accessibility label: swipe-back already existed and was
  // invisible, which is the entire defect this fixes.
  expect(textIn(t).join(' ')).toContain('Cancel');

  await fireEvent.press(leave!);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalled();
});

it('offers the same way out of an edit, and writes nothing on the way', async () => {
  stubDives({ dives: [existing()] });
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await typeInto(t, 'Max depth', '28');

  const leave = findLeave(t);
  expect(leave).toBeDefined();
  await fireEvent.press(leave!);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalled();
});

it('gives the way out the wayfinding treatment, never the primary action one', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const styles = makeStyles('light');
  const leaveStyle = [findLeave(t)?.props?.style].flat(5);
  const saveStyle = [findButton(t, 'Save')?.props?.style].flat(5);

  // §0.5/§0.6: the same mono, muted, 48 dp control DiveDetailScreen's `‹ Dives` uses — and
  // emphatically not `action`, the app's one filled-ink button, which the save control
  // beside it does carry.
  expect(leaveStyle).toContain(styles.formBack);
  expect(leaveStyle).not.toContain(styles.action);
  expect(saveStyle).toContain(styles.action);
  expect(styles.formBack.minHeight).toBe(48);
});

// --- Amendment E: the blocking-field message was shaped like an empty text input ---

it('shows a blocking field message as a line of text, not as a second empty field', async () => {
  nonCanonicalSource();
  const t = await render(<DiveFormScreen mode="create" />);
  await pressSave(t);
  await waitFor(() => expect(textIn(t).join(' ')).toContain('Enter a real date'));

  const message = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes('Enter a real date'));
  const container = [message?.parent?.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  const box = Object.assign({}, ...container) as { borderWidth?: number; backgroundColor?: string; minHeight?: number };
  const styles = makeStyles('light');

  // Nothing that makes an input an input. Directly beneath one, this used to carry
  // `noticeBanner`'s border, `surface` fill and 12 px radius at the same width — the same
  // object one row down, which is why it read as a second empty field rather than as a
  // sentence about the first.
  expect(box.borderWidth ?? 0).toBe(0);
  expect(box.backgroundColor).toBeUndefined();
  expect(box.minHeight ?? 0).toBe(0);
  // ...and the input it sits under still has all three, so the difference above is a real
  // one rather than the whole form having quietly lost its field boxes.
  expect(styles.formFieldInput.borderWidth).toBeGreaterThan(0);
  expect(styles.formFieldInput.backgroundColor).toBeDefined();
  expect(styles.formFieldInput.minHeight).toBe(48);
  // Weight and size are the lever §0.1 leaves (no red): smaller than the input's own text,
  // and muted rather than full ink.
  const text = [message?.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  const ink = Object.assign({}, ...text) as { fontSize?: number; color?: string };
  expect(ink.fontSize).toBeLessThan(styles.formFieldInput.fontSize);
  expect(ink.color).toBe(styles.formFieldLabel.color);
});

// --- M1d: creating a planned dive — §2.4's missing producer ---
//
// Every CONSUMER of a planned dive shipped first: the "Up next" section, exclusion from
// numbering and stats, the *Complete dive* pill, the completion flow. The producer never
// did. `createDive` defaulted `status` to `'logged'`, this form's schema had no `status`
// field at all, and the form is `createDive`'s only caller — so no diver could create a
// planned dive, and the one visible in the dev database came from seed data, which is
// exactly why the feature looked finished.
//
// One control now does both jobs (§2.4, and DESIGN.md §10's "one place changes a dive's
// status"): setting a new dive to Planned, and completing a planned one by moving it back
// to Logged. Everything below drives that control the way a diver does — pressing it —
// rather than reaching into the form's state.

/** The one View carrying a given `makeStyles` entry, so a test can ask what is INSIDE it. */
function regionWith(t: RenderResult, style: object) {
  return (t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).filter(Boolean).includes(style)) : [])[0];
}

it('puts the Logged/Planned control in the header row, beside the heading', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const styles = makeStyles('light');

  const header = regionWith(t, styles.formHeadingRow);
  expect(header).toBeDefined();
  // The heading and the control are one object: a control rendered somewhere else entirely
  // would still satisfy "the control exists" below.
  expect(header?.queryAll((n) => n.props?.accessibilityRole === 'switch')).toHaveLength(1);
  expect(header?.queryAll((n) => n.type === 'Text').flatMap((n) => n.children)).toContain('New dive');

  // ...and emphatically NOT in the core strip, which §2.2 fixes as date, site, centre, max
  // depth and duration. A dive's status is not one of its measurements, and a sixth slot
  // there would say it was. This is the assertion that fails if the control is "just moved
  // down a bit" into the strip, where the header-row check above would still pass.
  const strip = regionWith(t, styles.formCoreStrip);
  expect(strip).toBeDefined();
  expect(strip?.queryAll((n) => n.props?.accessibilityRole === 'switch')).toHaveLength(0);
});

it('opens every new dive on Logged, and says so on its face', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // Asserted explicitly, so a later change of default is caught here rather than found by a
  // diver whose ordinary dives all filed themselves as plans.
  expect(plannedIsOn(t)).toBe(false);
  // The announced state and the visible word are checked against each other exactly once,
  // here: everything below reads `plannedIsOn` alone, which would be satisfied by a control
  // whose label never changed.
  expect(textIn(t).join(' ')).toContain('Logged');
  expect(textIn(t).join(' ')).not.toContain('Planned');
});

it('shows Planned on its face once moved, so the two readings cannot disagree', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await toggleStatus(t);
  expect(plannedIsOn(t)).toBe(true);
  expect(textIn(t).join(' ')).toContain('Planned');
});

it('moves back to Logged on a second press — it is a two-state control, not a one-way door', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await toggleStatus(t);
  await toggleStatus(t);
  expect(plannedIsOn(t)).toBe(false);
});

it("keeps the diver's thumb target at 48 dp, however small the control looks", async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const styles = makeStyles('light');
  // §0.5: "Tap targets never below 48 dp" — on the Pressable, not on the pill inside it,
  // which is deliberately small (§0.6's quiet chip). Both halves asserted: that the control
  // actually wears this style, and that the style actually meets the floor.
  expect([findStatusControl(t)?.props?.style].flat(5)).toContain(styles.formStatus);
  expect(styles.formStatus.minHeight).toBe(48);
  expect(styles.formStatus.minWidth).toBe(48);
});

it('stays monochrome in both states — colour encodes depth and nothing else', async () => {
  // 'light' throughout: this screen resolves its own scheme from `useColorScheme()`, which
  // reports light under Jest, so the sheet and the palette compared against have to be the
  // ones that actually rendered (the same note DivesScreen.test.tsx and
  // DiveDetailScreen.test.tsx already carry).
  const theme = themeFor('light');
  const monochrome = [theme.bg, theme.surface, theme.border, theme.fg, theme.fgMuted, theme.action, theme.actionFg];
  const hues = depthScale.light;

  const coloursOf = (t: RenderResult): unknown[] => {
    const control = findStatusControl(t);
    const nodes = control ? [control, ...control.queryAll(() => true)] : [];
    return nodes
      .flatMap((n) => [n.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[])
      .flatMap((s) => [s.backgroundColor, s.borderColor, s.color])
      .filter((c) => c !== undefined);
  };

  const t = await render(<DiveFormScreen mode="create" />);
  const atRest = coloursOf(t);
  await toggleStatus(t);
  const whenPlanned = coloursOf(t);

  // Both states, because §0.1's rule is about the whole control and the "on" state is the
  // one a designer would be tempted to give an accent. Non-empty first, so an empty list
  // cannot pass this vacuously.
  expect(atRest.length).toBeGreaterThan(0);
  expect(whenPlanned.length).toBeGreaterThan(0);
  for (const colour of [...atRest, ...whenPlanned]) {
    expect(monochrome).toContain(colour);
    expect(hues).not.toContain(colour);
  }
});

it('says what the save will do, rather than making the diver remember the mode', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  expect(textIn(t).join(' ')).toContain('Save dive');
  expect(findButton(t, 'Save')?.props?.accessibilityLabel).toBe('Save dive');

  await toggleStatus(t);
  expect(textIn(t).join(' ')).toContain('Save plan');
  expect(textIn(t).join(' ')).not.toContain('Save dive');
  // The announced label moves with the visible one: a screen reader that went on saying
  // "Save dive" would be the same false promise one sense over.
  expect(findButton(t, 'Save')?.props?.accessibilityLabel).toBe('Save plan');
});

it('calls a new plan a plan in its heading too', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  expect(textIn(t).join(' ')).toContain('New dive');
  await toggleStatus(t);
  expect(textIn(t).join(' ')).toContain('New plan');
  expect(textIn(t).join(' ')).not.toContain('New dive');
});

it('creates a planned dive when the control is on Planned', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-09-05', status: 'planned' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-09-05');
  await toggleStatus(t);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  // The whole point of this task: `status: 'planned'` reaching the repository from the form,
  // which nothing in this app could produce before.
  expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ status: 'planned', date: '2026-09-05' }));
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

it("creates a logged dive when the control is left alone — the default is written, not assumed", async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  // Explicitly `'logged'`, not merely "not planned": `createDive` has a `?? 'logged'`
  // fallback of its own, so an input that carried NO status at all would still store a
  // logged dive and pass a weaker assertion — while leaving this form's own default
  // untested and free to drift.
  expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ status: 'logged' }));
});

it('does not inherit Planned from the logbook — a plan is an exception, not a mode', async () => {
  // Carry-over really does run here (the buddy proves it), and the control is still Logged.
  // Nothing in this app may make the next dive default to planned: a diver who queues one
  // dive on a boat is not switching the form into a planning mode.
  //
  // This is the SCREEN's half of that rule — that the form's own default survives a real
  // carry-over rather than being overwritten by it. The other half, that `carryOverFrom`
  // names no status at all to overwrite it with, cannot be proven from here (carry-over
  // reads the most recent LOGGED dive, so the status it would copy is 'logged' either way)
  // and is asserted directly in carryOver.test.ts instead.
  stubDives({
    dives: [
      dive({ id: 'p', date: '2026-09-05', status: 'planned', buddy: 'Nobody' }),
      dive({ id: 'l', date: '2026-08-16', buddy: 'Petra' }),
    ],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petra');
  expect(plannedIsOn(t)).toBe(false);
});

it('saves a planned dive dated in the past without complaint', async () => {
  // Not a hypothetical: a planned dive becomes past-dated by the clock moving. Plan three
  // dives on a boat, do two, and at midnight the third is a past-dated plan with no diver
  // involved — so a minimum date, or a warning, would be a rule that time itself violates.
  mockCreate.mockResolvedValue(dive({ date: '2020-01-01', status: 'planned' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2020-01-01');
  await toggleStatus(t);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ status: 'planned', date: '2020-01-01' }));
  // Nothing on screen argued with it, and the form left as a successful save does.
  expect(textIn(t).join(' ').toLowerCase()).not.toContain("couldn't");
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

it("leaves a planned dive planned when the diver only fixes its site name", async () => {
  const planned = dive({ id: 'p1', date: '2026-09-05', status: 'planned', siteName: 'Sifra' });
  stubDives({ dives: [planned] });
  mockUpdate.mockResolvedValue(planned);
  const t = await render(<DiveFormScreen mode="edit" diveId="p1" />);
  await typeInto(t, 'Site', 'Silfra');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // THIS is the assertion, and the only one here that discriminates. `DiveFormScreen.tsx`
  // used to run `if (target.status === 'planned') patch.status = 'logged'` on every save,
  // so a diver correcting a typo silently completed the dive — and a test asserting only
  // that the site name changed passes just as happily against that code. A patch that does
  // not NAME `status` is the whole difference between the two.
  expect(writtenPatch()).not.toHaveProperty('status');
  expect(writtenPatch().siteName).toBe('Silfra');
  // ...and the control still shows what the dive still is.
  expect(plannedIsOn(t)).toBe(true);
});

it('completes a planned dive when the diver moves the control to Logged by hand', async () => {
  const planned = dive({ id: 'p1', date: '2026-09-05', status: 'planned' });
  stubDives({ dives: [planned] });
  mockUpdate.mockResolvedValue(planned);
  // No route param this time: the pill is one way in, and moving the control is the other.
  // Both have to work, and they are different code paths — one seeds the form, the other
  // changes it after it is on screen.
  const t = await render(<DiveFormScreen mode="edit" diveId="p1" />);
  expect(plannedIsOn(t)).toBe(true);
  await toggleStatus(t);
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  expect(writtenPatch().status).toBe('logged');
  // Nothing else went with it: a save that rewrote the whole row would satisfy the line
  // above while overwriting fields the diver never opened (§7's last-write-wins).
  expect(Object.keys(writtenPatch())).toEqual(['status']);
});

it('turns a logged dive back into a plan when the diver moves the control the other way', async () => {
  const logged = dive({ id: 'l1', date: '2026-08-16' });
  stubDives({ dives: [logged] });
  mockUpdate.mockResolvedValue(logged);
  const t = await render(<DiveFormScreen mode="edit" diveId="l1" />);
  expect(plannedIsOn(t)).toBe(false);
  await toggleStatus(t);
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // The mirror of the test above, and not a formality: a control wired to send `'logged'`
  // whichever way it was pointing would pass that one and fail this one.
  expect(writtenPatch().status).toBe('planned');
  expect(Object.keys(writtenPatch())).toEqual(['status']);
});

it('opens on the state the route asked for, even when the dive arrives afterwards', async () => {
  // `useDives()` starts empty and resolves later, so this is the ordinary case on a device:
  // the *Complete dive* pill pushes, the form renders once with no dive, and the dive lands
  // after. The screen re-seeds itself from that dive when it does — and the route's request
  // has to survive that re-seed, or the control silently springs back to Planned and the
  // pill completes nothing.
  const t = await render(<DiveFormScreen mode="edit" diveId="p1" initialStatus="logged" />);
  stubDives({ dives: [dive({ id: 'p1', date: '2026-09-05', status: 'planned', siteName: 'Silfra' })] });
  await t.rerender(<DiveFormScreen mode="edit" diveId="p1" initialStatus="logged" />);

  // The dive really did arrive (otherwise "still on Logged" would be true of a blank form)...
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Silfra');
  // ...and the control still holds what the route asked for, over the dive's own status.
  expect(plannedIsOn(t)).toBe(false);
});
