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
import { createGearPreset } from '../db/gearPresets';
import { useDives } from '../db/useDives';
import { useGearPresets } from '../db/useGearPresets';
import { useUnitSystem } from '../db/useUnitSystem';
import { dive } from '../domain/diveFixture';
import { formatCylinderSpec, formatEquipmentToken, formatTankMaterial, HE_LABEL, O2_LABEL } from '../format/display';
import {
  CONFIGURATION_VALUES,
  ENTRY_VALUES,
  EQUIPMENT_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  VISIBILITY_VALUES,
  WATER_BODY_VALUES,
  WEATHER_VALUES,
  WEIGHTS_FEEL_VALUES,
  type Dive,
  type GearPreset,
  type Tank,
} from '../domain/types';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { depthScale } from '../theme/tokens';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import DiveFormScreen from './DiveFormScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
// Task 6: DiveFormScreen.tsx now reads useDives() for carry-over and calls createDive on
// save, so this screen's test needs the same per-module mock split DivesScreen.test.tsx
// already established: the one read mocked here, the write mocked separately (below) so a
// save test can control exactly what it resolves or rejects with, without a real database.
// Task 7 gives updateDive a real caller: mode="edit" writes a patch of changed fields
// through it, and completing a planned dive (§2.4) is that same write plus `status`.
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// The unit preference (§3), mocked per module exactly as `useDives` is above and for the
// same reason: it is a live database read, and this screen must be renderable in either
// system without one. Left on its own default, `metric`, by every test that does not care
// — which is what keeps the existing assertions below reading in metres, unchanged.
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));

jest.mock('../db/dives', () => ({ createDive: jest.fn(), updateDive: jest.fn() }));
// M1e task 2: the cylinder presets the form applies, mocked per module for the same reason
// `useDives` above is — it is a live database read.
jest.mock('../db/useGearPresets', () => ({ useGearPresets: jest.fn() }));
// Only the WRITE is a mock here. `presetNamed` is a pure function over the list the screen
// is already holding (db/gearPresets.ts), and it is the one owner of "is this name already
// taken" — replacing it with a stub would let the duplicate-name tests below pass against a
// screen wired to a rule that does not exist, which is this project's second-most-common
// defect. `jest.requireActual` inside a `jest.mock` factory is one of the two references
// babel-plugin-jest-hoist permits (`jest` and `require`).
jest.mock('../db/gearPresets', () => ({
  ...jest.requireActual('../db/gearPresets'),
  createGearPreset: jest.fn(),
}));
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
const mockUseUnitSystem = useUnitSystem as jest.Mock;
const mockUseGearPresets = useGearPresets as jest.Mock;
const mockCreatePreset = createGearPreset as jest.Mock;

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
function stubDives(
  state: { dives?: Dive[]; numbers?: Map<string, number>; error?: Error; resolved?: boolean } = {},
) {
  mockUseDives.mockImplementation(() => ({
    dives: [...(state.dives ?? [])],
    numbers: new Map(state.numbers ?? []),
    error: state.error,
    // Defaults to TRUE, and every test in this file that omits it means exactly that: it is
    // about a form whose read has already produced an answer. The renders BEFORE that answer
    // are their own describe block ("before the dives read has answered"), which passes
    // `false` explicitly — so this default cannot quietly re-hide the defect that block
    // exists for.
    resolved: state.resolved ?? true,
  }));
}

/**
 * The same `mockImplementation`-not-`mockReturnValue` discipline `stubDives` above
 * documents, and for the identical reason: `useGearPresets` builds its list with
 * `toGearPresets(rows)`, which is `rows.map(...).sort(...)` — a brand-new array whenever the
 * memo's input changes — so a stub handing back one referentially-stable array forever would
 * model a contract the real hook does not have.
 */
function stubPresets(presets: GearPreset[] = [], error?: Error) {
  mockUseGearPresets.mockImplementation(() => ({ presets: [...presets], error }));
}

beforeEach(() => {
  jest.clearAllMocks();
  stubDives();
  stubPresets();
  // Set explicitly rather than left to the module factory's own `jest.fn(() => true)`:
  // `clearAllMocks` clears calls but not return values, so one test overriding this would
  // otherwise leak its `false` into every test declared after it.
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  // Set explicitly for the same reason `canGoBack` is: `clearAllMocks` clears calls but not
  // return values, so one imperial test would otherwise leak into every test after it.
  mockUseUnitSystem.mockReturnValue('metric');
});

// `nonCanonicalSource` (below) pins `Date` so the carry-over window can be reasoned about;
// nothing else here fakes anything. Restored for every test rather than only for those four,
// because a faked clock leaking into the next test in the file is exactly the kind of
// order-dependent green this suite's own stubbing docblock exists to prevent — and
// `useRealTimers()` is a no-op when nothing was faked.
afterEach(() => {
  jest.useRealTimers();
});

// Same RTL adaptation every screen test in this codebase uses (DivesScreen.test.tsx,
// DiveDetailScreen.test.tsx): `render` is async and its `root` is a test-renderer
// `TestInstance` exposing `queryAll(predicate)`. A single root `<View>` (DiveFormScreen.tsx
// has one) is required for `root` to resolve to something whose descendants `queryAll` can
// actually reach — a bare `<>...</>` Fragment root would leave `root` pointing at only the
// first top-level child, per M1d task 1's own probe finding.
//
// `TestNode` is that same instance type, named so a helper can take one as a parameter —
// `RenderResult['root']` types as possibly-null, and every query in this file already guards
// for that before handing anything on.
type TestNode = NonNullable<RenderResult['root']>;

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

/**
 * The dive's own save control, matched by its WHOLE announced label.
 *
 * Every one of this file's dozen save queries used to be `findButton(t, 'Save')`, which
 * matches by substring — and `formFooter` is a sibling AFTER `formScroll`, so any button
 * inside an open group whose label merely contains "Save" is earlier in tree order and wins.
 * That is not a hypothetical: it is why M1e's cylinder-preset capture was first labelled "Add
 * to my presets" rather than "Save as preset", a label chosen to route around this helper
 * instead of for the diver. Matching the whole label is what lets a control say what it does,
 * and it is what the next "Save and add another" or "Unsaved changes" will need too.
 *
 * The two literals are `saveLabelFor`'s own output (DiveFormScreen.tsx), which is
 * module-private to that screen. They are spelled here rather than imported because this file
 * already asserts those exact words directly ("shows Save dive on a logged dive"), so the
 * words are deliberately part of what this suite pins — and a helper that silently followed a
 * renamed constant would stop pinning them.
 */
function findSaveControl(t: RenderResult) {
  return buttonsOf(t).find((n) => {
    const label = String(n.props?.accessibilityLabel ?? '');
    return label === 'Save dive' || label === 'Save plan';
  });
}

// Task 6 brief, Step 1: presses the one Save control via the query above rather than
// reimplementing it.
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
  const save = findSaveControl(t);
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

/**
 * Opens §2.2's cylinder specification row, so a test can reach the four fields it reads back
 * (rig, size, material, working pressure). The group has to be open first — this is a row
 * inside *Gas & cylinders*, not a group of its own.
 *
 * **"Ensure open", not "press"**, unlike `openGroup` above, because this row's default depends
 * on the dive: it starts open when the cylinder records no specification (there is nothing to
 * summarise) and closed when it does. A helper that always pressed would close it for exactly
 * the tests that seed a cylinder — which is most of them.
 */
async function openCylinder(t: RenderResult) {
  const row = findPickerField(t, 'Cylinder');
  if (!row) throw new Error('no Cylinder row found');
  if (row.props?.accessibilityState?.expanded === true) return;
  await fireEvent.press(row);
}

// --- §2.4: the Logged/Planned control ---
//
// Queried by the `switch` role rather than by `button`, which is exactly how the screen
// declares it (the same idiom `EquipmentTokenField` uses for each accessory) — and which
// means `findSaveControl(t)` above can never accidentally land on it.

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

// The §0.4/§0.1 guard now lives in `src/testing/unexpectedGraphics.ts` — one owner, because
// five files carried the same copy and all five were wrong in the same way: the check read
// `!style.some(known.includes)`, so one known style excused every literal beside it and
// `[styles.x, { backgroundColor: '#f00' }]` — the only shape anyone writes — passed. See that
// module and its own test for what it enforces and why the scheme is now explicit here.

// --- Task 4 brief, Step 1, verbatim ---

// §2.2's core strip, as M1h amended it: **date · site · centre · max depth · duration · time
// in · start pressure · end pressure**. The last three moved in because the first version of
// this strip was fixed before anyone had logged a dive with it — surface interval was computed
// and displayed while its only input sat behind a collapsed group, and the diver who fills both
// pressures on every dive had to open a group every time.
const CORE_STRIP_LABELS = [
  'Date',
  'Site',
  'Centre',
  'Max depth',
  'Duration',
  'Time in',
  'Start pressure',
  'End pressure',
] as const;

it('shows the core strip without opening anything', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  for (const label of CORE_STRIP_LABELS) {
    expect(text).toContain(label);
  }
});

// The other half of the move, and the half a "does the label show" assertion cannot see: each
// of the three left its group rather than being copied into the strip. A field rendered twice
// gives one form value two `Controller`s — two boxes a diver can type opposite numbers into,
// of which only the last one touched survives — and it is invisible from the strip, because
// the strip looks right either way.
it('moved time in and the two pressures out of their groups rather than repeating them', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // Every group open at once, so nothing can hide inside a collapsed one.
  for (const group of ['Times & depth', 'Conditions', 'Gas & cylinders', 'Equipment', 'People', 'Notes & rating']) {
    await openGroup(t, group);
  }
  for (const label of ['Time in', 'Start pressure', 'End pressure']) {
    expect(textIn(t).filter((s) => s === label)).toHaveLength(1);
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
  const save = findSaveControl(t);
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
  const before = findSaveControl(t);
  expect(before?.props?.disabled).not.toBe(true);
  expect(before?.props?.accessibilityState?.disabled).not.toBe(true);

  const header = findButton(t, 'Gas & cylinders');
  if (!header) throw new Error('no Gas & cylinders header found');
  await fireEvent.press(header);

  const after = findSaveControl(t);
  expect(after?.props?.disabled).not.toBe(true);
  expect(after?.props?.accessibilityState?.disabled).not.toBe(true);
});

it('lets the save control actually be pressed, with nothing set but the default date', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const save = findSaveControl(t);
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
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
  const header = findButton(t, 'Gas & cylinders');
  if (!header) throw new Error('no Gas & cylinders header found');
  await fireEvent.press(header);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// --- §0.6's design pass: a field is a row, and focus is the only thing that draws a box ---

/** Every `backgroundColor` anything on screen is painted with, flattened the way RN composes
 * styles. `View`s and `Text`s alike, so a fill that moved onto a label would still be seen. */
function fillsOn(t: RenderResult): unknown[] {
  const nodes = t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
  return nodes
    .flatMap((n) => [n.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[])
    .map((s) => s.backgroundColor)
    .filter((c) => c !== undefined);
}

/**
 * The `backgroundColor` a node actually renders with — the LAST one its composed style array
 * declares, which is how RN flattens `[base, override]`. Not `.some(...)`: a selected chip
 * wears `[formChip, formChipSelected]`, so "does any layer mention `surface`" answers yes for
 * a chip that is painted `action` on screen, and a test built on that could not tell the
 * inverted state from the resting one at all.
 */
function effectiveFill(node: TestNode): unknown {
  return ([node.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[]).reduce(
    (fill: unknown, layer) => (layer.backgroundColor === undefined ? fill : layer.backgroundColor),
    undefined,
  );
}

/** Every node painted with `colour`. The counterpart of `fillsOn` above for a test that needs
 * to know WHICH object carries a fill rather than only that something does. */
function nodesFilledWith(t: RenderResult, colour: unknown): TestNode[] {
  const nodes = t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
  return nodes.filter((n) => effectiveFill(n) === colour);
}

/** Whether a node wears one of `makeStyles`' own style objects, by reference. */
function wears(node: TestNode, style: unknown): boolean {
  return [node.props?.style].flat(5).includes(style);
}

// DESIGN.md §0.6: "**Focus is what draws the affordance.** The focused row fills with
// `surface`; nothing else does. The box appears where it is wanted instead of five times
// over" — and, since the owner's chip call in that same section, with exactly one named
// exception: "`surface` behind an unselected chip, `action` ink behind the selected one...
// This does put a `surface` fill on two different things (a chip, and the focused row);
// they are told apart by shape and scale rather than by colour, a small pill inside a row
// against a full-bleed fill. Recorded as a known trade-off, not an oversight."
//
// **This test asserted the opposite until that call, and was rewritten rather than
// satisfied.** It read `expect(fillsOn(t)).not.toContain(surface)` — no `surface` anywhere
// on screen until a field takes focus — which is now a claim §0.6 contradicts outright: an
// implementation that passed it would be one shipping unfilled chips. What the assertion was
// really protecting survives intact and is what stands here instead — the fill is not drawn
// down the column of FIELD ROWS in advance, which is the "five times over" the sentence
// rules out — with the exception pinned to its own boundary: every `surface` on screen
// belongs to a chip or to the one focused row, and to nothing else.
//
// Both groups holding chips are opened first, so this sees them.
//
// 'light' throughout: this screen resolves its own scheme from `useColorScheme()`, which
// reports light under Jest (the same note the monochrome test below carries).
it('fills chips and the focused row with surface, and nothing else — least of all a column of unfocused rows', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Conditions');
  await openGroup(t, 'Equipment');
  const styles = makeStyles('light');
  const surface = themeFor('light').surface;

  // The sweep is worth nothing if it sweeps nothing: the screen has to be painting SOMETHING
  // (the save control's inverted ink, the carried chip's `border` fill) for the classification
  // below to mean anything at all.
  expect(fillsOn(t).length).toBeGreaterThan(0);

  // Every `surface` before focus is a chip, and there are plenty of them: entry, salinity,
  // water body, suit and the three yes/no controls are all open at this point.
  const atRest = nodesFilledWith(t, surface);
  expect(atRest.length).toBeGreaterThan(5);
  expect(atRest.filter((n) => !wears(n, styles.formChip))).toEqual([]);
  // ...and not one field row among them.
  expect(atRest.filter((n) => wears(n, styles.formField))).toEqual([]);

  const input = findTextInput(t, 'Max depth');
  if (!input) throw new Error('no Max depth field found');
  await fireEvent(input, 'focus');
  // Exactly one row, not the whole column: "the box appears where it is wanted."
  const focused = nodesFilledWith(t, surface).filter((n) => wears(n, styles.formField));
  expect(focused).toHaveLength(1);
  expect(focused.filter((n) => wears(n, styles.formFieldFocused))).toHaveLength(1);
  // And the chips did not change their minds about being filled while a row took focus.
  expect(nodesFilledWith(t, surface)).toHaveLength(atRest.length + 1);
});

// §0.6's chip rule, at the one place it is visible: the same invert the save control uses.
// Read off the rendered chip rather than off `makeStyles` alone, because a style object that
// is correct and never reaches a chip is the failure this is for — `formChipSelected` and
// `formChipTextSelected` were both already defined, and both would still be, if `selected`
// stopped being wired to the style array at all.
it('inverts the chip a diver picked, and leaves the rest on surface', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Conditions');
  const theme = themeFor('light');
  const styles = makeStyles('light');

  const before = findChip(t, 'Entry', 1);
  if (!before) throw new Error('no Entry chip found');
  expect(wears(before, styles.formChip)).toBe(true);
  expect(wears(before, styles.formChipSelected)).toBe(false);

  await pressChip(t, 'Entry', 1);
  const after = findChip(t, 'Entry', 1);
  if (!after) throw new Error('the Entry chip vanished when it was picked');

  // The chosen one is `action` on `action-fg`; every other chip in the same row stays on
  // `surface`. Both halves, because a fill that inverted every chip at once would satisfy
  // either one alone.
  expect(nodesFilledWith(t, theme.action)).toContain(after);
  expect(nodesFilledWith(t, theme.surface)).not.toContain(after);
  for (const index of [0, 2]) {
    const other = findChip(t, 'Entry', index);
    if (!other) throw new Error(`no Entry chip at position ${index}`);
    expect(nodesFilledWith(t, theme.surface)).toContain(other);
    expect(nodesFilledWith(t, theme.action)).not.toContain(other);
  }
  // ...and the label inverts with the ground, rather than staying `fg` on `action`.
  const label = after.queryAll((n) => n.type === 'Text')[0];
  expect([label?.props?.style].flat(5)).toContain(styles.formChipTextSelected);
});

// §0.6: "A field is a row, not a box... Separated by a hairline on each row's **top** edge,
// the same rule dive rows follow." The edge is not interchangeable — `diveRow` (theme/
// styles.ts) records at length what a bottom edge cost the dives list — so it is pinned as
// the edge, not merely as "a border somewhere".
//
// Counted across the whole core strip rather than asserted for one field, because the point
// is that EVERY field is a row: §2.2's eight names, plus the group header above them, is
// what makes the form one ruled column instead of eight boxes.
it('rules every field on its top edge, the way a dive row is ruled', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const styles = makeStyles('light');
  const strip = regionWith(t, styles.formCoreStrip);
  expect(strip).toBeDefined();

  const rows = strip?.queryAll((n) => [n.props?.style].flat(5).filter(Boolean).includes(styles.formField)) ?? [];
  // Date, site, centre, max depth, duration, time in, start and end pressure (§2.2, as M1h
  // amended it). Five until the three the owner had to open a group for joined the strip.
  expect(rows).toHaveLength(8);
  expect(styles.formField.borderTopWidth).toBe(1);
  expect(styles.formField.borderTopColor).toBe(themeFor('light').border);
  // ...and no bottom edge beside it, which would double every rule between two rows and
  // leave one hanging under the last field of every group.
  expect((styles.formField as unknown as Record<string, unknown>).borderBottomWidth ?? 0).toBe(0);
});

// The fields that are NOT a `FormField` — each accessory in the equipment set is an
// `EquipmentTokenField`, and suit and weights sit beside them — have to be rows too, or
// "a field is a row" is a rule with exceptions in one group. That control used to render the
// bare label row with no field wrapper at all, which is exactly why those rows drew no
// hairline of their own and their Yes/No chips sat flush against the end of the word instead
// of at the row's edge. (It was `BooleanField`, bound to `hood`/`gloves`/`boots`, until M1h
// replaced the three columns with a token set; the body is unchanged, only what it writes.)
it('makes a yes/no field a row like every other field, hairline and all', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const styles = makeStyles('light');
  await openGroup(t, 'Equipment');

  // By the `switch` role `EquipmentTokenField` declares, the same idiom §2.4's control uses
  // — never `buttonsOf`, which would find neither.
  const chip = (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'switch') : []).find(
    (n) => String(n.props?.accessibilityLabel ?? '') === 'Hood',
  );
  expect(chip).toBeDefined();
  const row = fieldRootOf(chip);
  expect(row).not.toBeNull();
  // The row it sits in is `formField` — so it carries the hairline and the 48 dp floor — and
  // it also carries the padding a 48 dp chip needs inside a 48 dp row.
  expect([row?.props?.style].flat(5)).toContain(styles.formFieldChoice);
  // ...and the value trails, which for this one field depends on the row itself rather than
  // on a `formFieldValue` slot it does not have.
  expect(styles.formFieldRow.justifyContent).toBe('space-between');
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
// leaves that one — `backToDives` (navigation/leaveScreen.ts) owns the rule for both. The
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

/**
 * Everything Jest's modern fake timers can take over EXCEPT the clock — the same list, and
 * the same reasoning, as `DiveFormScreen.utc-plus-14.test.tsx`: `setSystemTime` is only
 * available under fake timers, but this screen is a real React tree whose render and RTL's
 * own `act`/cleanup run on microtasks and timers, so freezing those to pin a date would
 * replace one source of flakiness with a larger one. Listing them here fakes `Date` alone.
 */
const CLOCK_ONLY = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  'setImmediate', 'clearImmediate',
  'setInterval', 'clearInterval',
  'setTimeout', 'clearTimeout',
] as const;

/**
 * A logged dive whose stored date is real but not canonical — the shape an M2 sync from
 * another client can deliver, and the only thing that still puts an unreadable value in
 * front of this form. Getting it *into* the field is the mechanics, not the point being
 * made, so the mechanics are stated here once for the four tests below.
 *
 * **The clock is pinned to the day this dive was logged**, because carry-over hands the
 * date forward only when the previous dive was today or yesterday (`carryOverDate`,
 * domain/carryOver.ts). This used to lean on `date: '2099-8-17'` instead, with a comment
 * saying the 48-hour rule "keeps it rather than substituting today" — which was true only
 * because that rule was one-sided and carried *any* future date for ever, the very defect
 * the m1d carry-over fix closed. Four tests about the Date field's blocking message were
 * therefore standing on a bug in a different module; a far-future source now correctly
 * yields today's date and no message at all. Pinning the clock is what makes the mechanics
 * say what they mean, and only `Date` is faked (see `CLOCK_ONLY` above).
 */
const NON_CANONICAL_DATE = '2026-8-17';

function nonCanonicalSource() {
  jest.useFakeTimers({ now: new Date(2026, 7, 17, 10, 0), doNotFake: [...CLOCK_ONLY] });
  stubDives({ dives: [dive({ status: 'logged', date: NON_CANONICAL_DATE })] });
}

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
  // silently "corrected" into a different day. Read from the same constant the source dive
  // is built from, so the two cannot drift into a test that passes on a value nobody set.
  expect(shownIn(t, 'Date')).toBe(NON_CANONICAL_DATE);
});

// §1 again, one field over — and the policy behind it, settled after M1d (DESIGN.md §10:
// "a value outside the expected range is saved and can be flagged; it is not refused").
//
// An option or boolean field holding something outside its fixed list used to fail
// `zodResolver`, and `handleSubmit` then refuses to call `onValid` for the WHOLE form. Wave
// A gave that refusal a message, which turned silence into an explanation but left the
// diver's save refused over a value they never entered and cannot see. The refusal itself is
// what had to go: a value from a future client that this one cannot represent must not stop
// a diver saving a note on that dive.
//
// The value has to come from outside the form, because that is the only place it can come
// from: `OptionChips` hands back a member of its own list or `''`, and the boolean chip
// hands back true or false. M2 sync is the real source — a row written by a client whose
// `Entry` has a member this one has never heard of — and edit mode is where it lands.
describe('a value the form itself could not have produced, in a field that is not the date', () => {
  /** A dive carrying a value from a newer client. Cast, because the whole point is that the
   * domain types say this cannot happen and the network does not care. */
  const fromANewerClient = (over: Record<string, unknown>) =>
    dive({ id: 'target', date: '2026-08-16', siteName: 'Blue Hole', ...over } as Parameters<typeof dive>[0]);

  it('flags an option field holding an unknown value, and still saves the dive', async () => {
    const target = fromANewerClient({ entry: 'liveaboard' });
    stubLogbookFor(target);
    mockUpdate.mockResolvedValue(target);
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    await openGroup(t, 'Conditions');

    // The schema's own sentence (diveFormSchema.ts), not one written in the screen — and it
    // is there before anything is pressed, because the value is already on screen.
    expect(textIn(t).join(' ')).toContain('saved as it is');

    // The diver came here for something else entirely, and gets it.
    await typeInto(t, 'Max depth', '28');
    await pressSave(t);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(writtenPatch()).toHaveProperty('maxDepthM', 28);
    // Kept, not cleared: the patch does not NAME `entry`, so the stored value stands. A
    // patch carrying `entry: null` would be the other way to "not refuse" — dropping a
    // column the diver never touched — and it would satisfy an assertion about the save
    // succeeding just as well.
    expect(writtenPatch()).not.toHaveProperty('entry');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('keeps an equipment token it has no chip for, and still saves the dive', async () => {
    // The token set's version of the rule, and it has one extra trap the scalar fields do
    // not: the chips could plausibly be implemented by rebuilding the array from the five
    // this build knows, which would DELETE the foreign token on the first unrelated toggle.
    // So this drives a real toggle and then reads the write.
    const target = fromANewerClient({ equipment: ['hood', 'rebreather-bailout'] });
    stubLogbookFor(target);
    mockUpdate.mockResolvedValue(target);
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    await openGroup(t, 'Equipment');
    await pressEquipmentToken(t, 'Gloves');

    await typeInto(t, 'Max depth', '28');
    await pressSave(t);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(writtenPatch()).toHaveProperty('maxDepthM', 28);
    expect(writtenPatch().equipment).toEqual(['hood', 'gloves', 'rebreather-bailout']);
  });

  it('carries an unknown option into a NEW dive rather than dropping it on the way', async () => {
    // Carry-over is the path that turns one synced row into a value on a form the diver is
    // filling in now, and `toNewDiveInput` writes every non-null field — so this is where
    // "kept" would quietly become "dropped" without the patch diff to hide behind.
    mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
    stubDives({ dives: [fromANewerClient({ entry: 'liveaboard' })] });
    const t = await render(<DiveFormScreen mode="create" />);
    await pressSave(t);
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ entry: 'liveaboard' }));
  });

  it('lets the diver replace the flagged value by tapping a chip, and drops the note with it', async () => {
    // The note names a way out, and it has to work: picking any option replaces the value
    // this client cannot represent, and the note goes with it.
    const target = fromANewerClient({ entry: 'liveaboard' });
    stubLogbookFor(target);
    mockUpdate.mockResolvedValue(target);
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    await openGroup(t, 'Conditions');
    expect(textIn(t).join(' ')).toContain('saved as it is');

    const boat = buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Entry: Boat'));
    if (!boat) throw new Error('no Entry chip found');
    await fireEvent.press(boat);
    expect(textIn(t).join(' ')).not.toContain('saved as it is');

    await pressSave(t);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(writtenPatch()).toHaveProperty('entry', 'boat');
  });

  it('says nothing at all about a field holding a value this client knows', async () => {
    // The control that stops the note from being a permanent fixture under every option and
    // boolean row: an ordinary dive shows none of it.
    stubLogbookFor(fromANewerClient({ entry: 'boat', equipment: ['hood'] }));
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    await openGroup(t, 'Conditions');
    await openGroup(t, 'Equipment');
    expect(textIn(t).join(' ')).not.toContain('saved as it is');
  });
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

/**
 * The `formField` row a control belongs to — the node §0.6 makes a field's own root.
 *
 * **Walked for, not counted in `.parent` hops.** The assertion below is about a
 * RELATIONSHIP (the message is the field's sibling), and counting hops pins the depth of the
 * tree between them instead: §0.6's design pass put a `formFieldRow` between a field's root
 * and its control, which moved every hop by one while leaving the relationship exactly as it
 * was — a red that says nothing about what the test is for.
 */
function fieldRootOf(node: TestNode | undefined): TestNode | null {
  const field = makeStyles('light').formField;
  let current: TestNode | null = node?.parent ?? null;
  while (current !== null) {
    if ([current.props?.style].flat(5).filter(Boolean).includes(field)) return current;
    current = current.parent;
  }
  return null;
}

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
  // The message's own wrapper (`formFieldError`) and the Date field's `formField` root sit
  // in the same container, one directly after the other — §0.6: "under the row it belongs
  // to."
  const fieldRoot = fieldRootOf(dateField);
  expect(fieldRoot).not.toBeNull();
  expect(message?.parent?.parent).toBe(fieldRoot?.parent);
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
  material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232,
  o2Pct: 32, hePct: null, startBar: 200, endBar: 50, ...over,
});

/**
 * A dive that is deliberately **not** the one under edit, filled in every field an edit-mode
 * test reads back — and filled with different values from the ones those tests expect, so a
 * form that loaded this dive instead fails on the value rather than merely on the id.
 */
const decoy = (over: Partial<Dive> = {}): Dive =>
  dive({
    siteName: 'Wrong Reef',
    centerName: 'Wrong Centre',
    maxDepthM: 9.9,
    durationMin: 9,
    timeIn: '23:59',
    notes: 'A different dive entirely',
    buddy: 'Nobody',
    tanks: [tank({ sizeL: 3, endBar: 7 })],
    ...over,
  });

/**
 * The logbook an edit-mode test opens against: the dive under edit with **another dive ahead
 * of it** and a third behind it.
 *
 * Every `mode="edit"` test used to stub a logbook holding exactly one dive, which made
 * `DiveFormScreen.tsx`'s own `dives.find((d) => d.id === diveId)` indistinguishable from
 * `dives[0]` — the two agree on a one-dive list, and every one of the ~18 tests below stayed
 * green with the lookup replaced by the index. A diver editing dive #47 would then have
 * loaded, displayed and `updateDive`d the NEWEST dive instead: the form shows one dive's
 * values under another dive's id, and the save writes them there.
 *
 * `useDives()` hands its list back newest-first (`toDives`, db/dives.ts), so the decoy ahead
 * of the target is dated later and the one behind it earlier — the real shape, not an
 * arbitrary shuffle. `alsoLive` is for a test that needs a specific extra dive on the list.
 */
function stubLogbookFor(target: Dive, ...alsoLive: Dive[]) {
  stubDives({
    dives: [
      decoy({ id: 'decoy-newer', date: '2026-12-31' }),
      target,
      ...alsoLive,
      decoy({ id: 'decoy-older', date: '2019-01-01' }),
    ],
  });
}

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
  // The spec collapses into one row when it records something (§2.2), and this dive's
  // carried cylinder does — so the four fields behind it have to be opened to be read.
  await openCylinder(t);

  expect(findTextInput(t, 'Size')?.props?.value).toBe('12');
  expect(findClearCarried(t, 'Size')).toBeDefined();
  // He is the same cylinder's own null field — must not be marked, the tanks-array
  // analogue of the Buddy/Guide check above: it proves computeCarriedPaths' per-key
  // iteration over one cylinder, not an all-or-nothing flag for the whole tank.
  //
  // Queried by `HE_LABEL` rather than by a literal, here and below. The field was labelled
  // `He %` until M1d's closing fixes unified it with the detail screen's `He` (see
  // `O2_LABEL`, format/display.ts, for that decision) — and a screen test that spells a
  // label out for itself is a second copy of the same string, which is how these queries
  // would go on passing against a label nobody renders.
  expect(findClearCarried(t, HE_LABEL)).toBeUndefined();
});

// `hasCarriedValue`'s whole reason to exist is that `0` is a real answer and `null` is not,
// yet `if (!value) return false;` was a green mutation: every test above happens to carry a
// truthy value, so the function was only ever asked the easy question. The two cases below
// are the ones a diver actually produces — `hePct: 0` is how air is recorded on a cylinder
// that also records a real O₂ percentage, and `weightsKg: 0` is a dive done with no weight
// at all — and both are the previous dive's genuine answer, which is what the chip means.
it('marks a carried 0 as carried — a zero is an answer, an empty field is not', async () => {
  stubDives({
    dives: [dive({ date: '2026-08-10', weightsKg: 0, tanks: [tank({ o2Pct: 21, hePct: 0 })] })],
  });
  const t = await render(<DiveFormScreen mode="create" />);

  await openGroup(t, 'Equipment');
  expect(findTextInput(t, 'Weights')?.props?.value).toBe('0');
  expect(findClearCarried(t, 'Weights')).toBeDefined();

  await openGroup(t, 'Gas & cylinders');
  expect(findTextInput(t, HE_LABEL)?.props?.value).toBe('0');
  expect(findClearCarried(t, HE_LABEL)).toBeDefined();
});

it('marks a carried suit thickness, and drops the mark the moment the diver types over it', async () => {
  // §0.6's `carried ×` on the one field M1h added to `CARRIED_FIELDS`. Both halves in one
  // test because they are two different props on one call site — `carriedPaths` is what puts
  // the mark there and `onDropCarried` is what takes it away — and either can be left off
  // alone. The neighbouring `weightsKg` has had both since M1d; this one arrived without them
  // being pinned, which is the same per-call-site-prop hole the chip sweep below exists for.
  stubDives({ dives: [dive({ date: '2026-08-10', suitThicknessMm: 5 })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Equipment');

  expect(findTextInput(t, 'Suit thickness')?.props?.value).toBe('5');
  expect(findClearCarried(t, 'Suit thickness')).toBeDefined();

  await typeInto(t, 'Suit thickness', '7');
  expect(findClearCarried(t, 'Suit thickness')).toBeUndefined();
  expect(findTextInput(t, 'Suit thickness')?.props?.value).toBe('7');
});

it('still marks nothing on a field the previous dive left empty, beside one it filled with 0', async () => {
  // The control for the test above. "Mark everything" would satisfy it just as well, and
  // would put a `×` on fields carry-over never touched — so the same render has to show a
  // 0-valued field marked and a null one not.
  stubDives({ dives: [dive({ date: '2026-08-10', weightsKg: 0, buddy: null })] });
  const t = await render(<DiveFormScreen mode="create" />);

  await openGroup(t, 'Equipment');
  expect(findClearCarried(t, 'Weights')).toBeDefined();
  await openGroup(t, 'People');
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
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
  const save = findSaveControl(t);
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
  const first = fireEvent.press(findSaveControl(t)!);
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
  expect(findSaveControl(t)?.props?.accessibilityState?.disabled).not.toBe(true);

  // `accessibilityState.disabled` is the half a screen reader announces, and the only half
  // observable from here: `Pressable` consumes the `disabled` prop itself rather than
  // forwarding it to the host `View` these queries reach. Both are set on the control; a
  // control that silently ignores a tap it still announces as available is its own kind of
  // dead button, and this is the one of the two a test can actually see.
  const press = fireEvent.press(findSaveControl(t)!);
  await waitFor(() => expect(findSaveControl(t)?.props?.accessibilityState?.disabled).toBe(true));

  releaseWrite();
  await press;
  await waitFor(() => expect(findSaveControl(t)?.props?.accessibilityState?.disabled).not.toBe(true));
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
  expect(findSaveControl(t)).toBeDefined();
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
  expect(findSaveControl(t)).toBeDefined();
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

// The other half of that re-sync, and the one thing that made it safe: `resetOptions:
// { keepDirtyValues: true }`. Flipping it to `false` left the whole suite green, even though
// a test comment already called it load-bearing — because every re-sync test above types
// AFTER the hook has resolved, and by then there is nothing left to arrive.
//
// On a device the race is the ordinary case, not an edge one: `useDives()` starts empty and
// resolves a frame or more later, and a diver who taps `+` and starts typing immediately is
// typing into a form whose real defaults have not landed yet.
it("keeps what the diver typed before carry-over landed, and still fills the fields they didn't", async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');
  await typeInto(t, 'Buddy', 'Jana');

  // The async read lands, carrying a different buddy — the value that would overwrite what
  // is already on screen.
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr', guide: 'Ondra' })] });
  await t.rerender(<DiveFormScreen mode="create" />);

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Jana');
  // ...while Guide, which the diver never touched, does receive it. Both halves are the
  // test: without this one, a form that simply stopped re-syncing at all — no `values`
  // option, `defaultValues` alone — would pass the line above and silently drop carry-over
  // for every diver whose hook resolves after the first render, which is all of them.
  expect(findTextInput(t, 'Guide')?.props?.value).toBe('Ondra');
});

// The chip means "this came from your last dive" (§0.6) and must mean nothing else.
//
// The value above is kept correctly, and the chip was offered over it anyway: the reseed ran
// `computeCarriedPaths` over the newly-arrived carry-over values, which of course name
// `buddy`, so the field the diver had typed themselves came back marked `carried` — with an
// `×` offering to clear their own text as though it were somebody else's. Found by reading
// §0.6 against the race the test above already sets up; the two run the same setup for
// exactly that reason.
//
// The guard is the `typed` set (`SeedState`, DiveFormScreen.tsx), which survives the reseed.
// Both fields are checked: without the Guide half, a fix that simply stopped marking anything
// after the first render would pass.
it('never re-marks a field the diver typed into before carry-over landed', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');
  await typeInto(t, 'Buddy', 'Jana');

  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr', guide: 'Ondra' })] });
  await t.rerender(<DiveFormScreen mode="create" />);

  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
  expect(findClearCarried(t, 'Guide')).toBeDefined();
});

// The same rule for the other gesture that means "this value is mine now": clearing. A diver
// who taps the `×` on a carried field before the read resolves has said the field is empty on
// purpose, and the reseed must not put the chip — or the old value — back.
it('never re-marks a field the diver cleared before carry-over landed', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr', guide: 'Ondra' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');

  const clear = findClearCarried(t, 'Buddy');
  if (!clear) throw new Error('Buddy was not marked carried to begin with');
  await fireEvent.press(clear);
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();

  // A later render from a DIFFERENT source dive — the same reseed path the race above takes.
  stubDives({ dives: [dive({ id: 'later', date: '2026-08-11', buddy: 'Petr', guide: 'Ondra' })] });
  await t.rerender(<DiveFormScreen mode="create" />);

  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('');
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
type WrittenTank = { sizeL?: number | null; configuration?: string | null };

function writtenTanks(): WrittenTank[] | undefined {
  return (mockCreate.mock.calls[0]?.[1] as { tanks?: WrittenTank[] })?.tanks;
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
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [tank({ sizeL: 12, configuration: 'twinset' })] })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await pickDate(t, '2026-08-16');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  expect(writtenTanks()).toHaveLength(1);
  expect(writtenTanks()?.[0]?.sizeL).toBe(12);
  expect(writtenTanks()?.[0]?.configuration).toBe('twinset');
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

  // **Four rows were missing from this table until M1h's structure pass**, and they are the
  // same hole the field sweep further down was rewritten for: `Visibility`, `Weather`,
  // `Weighting` and `Configuration` all arrived in Task 1 and joined the *write* sweep without
  // joining this one. A chip row offering five of a vocabulary's six values passes every other
  // test in this file — the write sweep taps `values[1]` and never looks at how many chips
  // there are — so a member could be added to the domain and never reach a diver's thumb,
  // which is precisely the defect the paragraph above this describes for the copy that used to
  // live in the screen. The rule is the same: a fixed-choice field added to this form joins
  // this table on the same commit.
  it.each([
    ['Entry', 'Conditions', ENTRY_VALUES],
    ['Salinity', 'Conditions', SALINITY_VALUES],
    ['Water body', 'Conditions', WATER_BODY_VALUES],
    ['Visibility', 'Conditions', VISIBILITY_VALUES],
    ['Weather', 'Conditions', WEATHER_VALUES],
    ['Suit', 'Equipment', SUIT_VALUES],
    ['Weighting', 'Equipment', WEIGHTS_FEEL_VALUES],
    ['Material', 'Gas & cylinders', TANK_MATERIAL_VALUES],
    ['Configuration', 'Gas & cylinders', CONFIGURATION_VALUES],
  ] as const)('offers one %s chip per value the domain declares', async (label, group, values) => {
    const t = await render(<DiveFormScreen mode="create" />);
    await openGroup(t, group);
    // Compared as a count and as a set of the underlying values: the labels themselves are
    // display strings (`formatEntry` and friends), so this asserts one chip per member
    // without pinning the wording, which format/display.ts owns.
    expect(chipsFor(t, label)).toHaveLength(values.length);
  });
});

// --- §0.6: "An icon appears only where the value has one" ---

/** The SF Symbols drawn inside one chip. Same `SymbolModule` host-node match
 * SearchCapsule.test.tsx and EntryIcon.test.tsx use — see either for why that name, and not
 * "some icon-shaped element", is what tells a real SF Symbol from a drawn approximation. */
function symbolsInside(node: TestNode | undefined) {
  return node ? node.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
}

// DESIGN.md §0.6: "*Shore* and *boat* pass trivially." *Salt* and *fresh* do not, and
// neither do *wet*, *semidry* and *dry* or *steel* and *alu* — drawn as icons those collapse
// into near-identical droplets and suits separated by tally marks, which is a legend.
//
// Both halves in one test, because the rule is a boundary and either half alone is
// satisfiable by the wrong implementation: an icon on every chip passes "shore has one", and
// an icon on none passes "salinity has none". Asserted through the real screen rather than
// against `EntryIcon` directly — that component can be perfectly correct and still be wired
// to no chip at all, or to all five fields' chips.
it('draws an icon on the two entry chips that have one, and on no other chip anywhere', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Conditions');
  await openGroup(t, 'Equipment');
  await openGroup(t, 'Gas & cylinders');

  // shore, boat, other — in ENTRY_VALUES' own order, which `findChip` indexes by.
  expect(symbolsInside(findChip(t, 'Entry', 0))).toHaveLength(1);
  expect(symbolsInside(findChip(t, 'Entry', 1))).toHaveLength(1);
  // "*other* does not [have one]" — the value §0.6 names as the one that must stay bare.
  expect(symbolsInside(findChip(t, 'Entry', 2))).toHaveLength(0);

  for (const [label, values] of [
    ['Salinity', SALINITY_VALUES],
    ['Water body', WATER_BODY_VALUES],
    ['Suit', SUIT_VALUES],
    ['Material', TANK_MATERIAL_VALUES],
  ] as const) {
    for (let index = 0; index < values.length; index += 1) {
      expect(symbolsInside(findChip(t, label, index))).toHaveLength(0);
    }
  }
});

// §0.6: the icon "**supplements the label rather than replacing it** — never an icon alone."
// The failure this guards is a chip that swapped its word for a picture, which would still
// draw an icon in the right place and still save the right value: only the word's presence,
// and what a screen reader is told, tell the two apart.
it('keeps the word on an entry chip that has an icon, and announces it unchanged', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Conditions');
  const shore = findChip(t, 'Entry', 0);

  expect(symbolsInside(shore)).toHaveLength(1);
  expect(shore?.queryAll((n) => n.type === 'Text').flatMap((n) => n.children)).toContain('Shore');
  // The announcement is the label alone — an icon that added its own accessibility label
  // would have a screen reader read the same control twice over.
  expect(String(shore?.props?.accessibilityLabel)).toBe('Entry: Shore');
});

// The icon is a companion to the label, so it inverts with it (§0.6's chip rule): on the
// selected chip both are `action-fg`, everywhere else both are `fg`. An icon holding its own
// colour would be `fg` ink on an `action` ground — invisible on exactly the one chip the
// diver picked, which is the state nobody tests by accident.
it('inverts the entry icon along with the label it sits beside', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Conditions');
  const theme = themeFor('light');

  expect(symbolsInside(findChip(t, 'Entry', 1))[0]?.props?.tintColor).toBe(theme.fg);
  await pressChip(t, 'Entry', 1);
  expect(symbolsInside(findChip(t, 'Entry', 1))[0]?.props?.tintColor).toBe(theme.actionFg);
  // ...and its unselected neighbour did not invert with it.
  expect(symbolsInside(findChip(t, 'Entry', 0))[0]?.props?.tintColor).toBe(theme.fg);
});

// --- Every field that would otherwise be dead to this suite ---
//
// `ControlledOptionField`'s `onChange={field.onChange}` could be replaced by `() => {}` with
// the whole suite green, and so could `OptionChips`' "tapping the selected chip clears it"
// and the equipment chip's own toggle. Between them that was entry, salinity, water body,
// suit, cylinder material and the three accessory booleans: eight fields that could
// silently never save, or save but never clear, with nothing to say so.
//
// The seam is between the control and the WRITE, so every assertion below reads the payload
// `createDive` was handed and not the component's own state — a control that updates itself
// and never reaches the form is exactly the failure, and reading the chip back would report
// it as working. Driven per field rather than once for the wrapper, because **`name` is a
// per-call-site prop: a chip row wired to the wrong field would save the wrong column.**
//
// **M1h added seven fields to this screen and only three of them joined this sweep**, which
// is exactly the hole the paragraph above was written about. `equipment` and
// `tanks.0.configuration` were covered; `visibility`, `weather`, `weightsFeel` and
// `suitThicknessMm` were not, and every one of them could be repointed at another column
// with 1285 tests green — tapping *High* under Visibility would have written
// `waterBody: 'high'`, a value that vocabulary does not contain and that §10 keeps rather
// than refuses, while `visibility` stayed null for ever and §7 carried the wrong column to
// every device. The lesson is not "write more tests": it is that a field added to this
// screen belongs in the table below on the same commit, and that the last row of that table
// is the checklist.

/** One of a field's chips, by its position in the domain's own `*_VALUES` order — never by
 * its display string, which `format/display.ts` owns and this file has no business pinning
 * a second time. */
function findChip(t: RenderResult, label: string, index: number) {
  return buttonsOf(t).filter((n) => String(n.props?.accessibilityLabel ?? '').startsWith(`${label}: `))[index];
}

async function pressChip(t: RenderResult, label: string, index: number) {
  const chip = findChip(t, label, index);
  if (!chip) throw new Error(`no ${label} chip at position ${index}`);
  await fireEvent.press(chip);
}

/** One accessory's own control (`EquipmentTokenField`), which declares itself a `switch`
 * exactly as §2.4's status control does — so this can never land on that one, which is
 * labelled "Planned dive". */
function findEquipmentToken(t: RenderResult, label: string) {
  return (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'switch') : []).find(
    (n) => String(n.props?.accessibilityLabel ?? '') === label,
  );
}

async function pressEquipmentToken(t: RenderResult, label: string) {
  const control = findEquipmentToken(t, label);
  if (!control) throw new Error(`no ${label} control found`);
  await fireEvent.press(control);
}

/** The input `createDive` was handed on the nth save of this test. */
function writtenInput(call = 0): Record<string, unknown> {
  return (mockCreate.mock.calls[call]?.[1] ?? {}) as Record<string, unknown>;
}

it.each([
  ['Entry', 'Conditions', 'entry', ENTRY_VALUES],
  ['Salinity', 'Conditions', 'salinity', SALINITY_VALUES],
  ['Water body', 'Conditions', 'waterBody', WATER_BODY_VALUES],
  ['Visibility', 'Conditions', 'visibility', VISIBILITY_VALUES],
  ['Weather', 'Conditions', 'weather', WEATHER_VALUES],
  ['Suit', 'Equipment', 'suit', SUIT_VALUES],
  ['Weighting', 'Equipment', 'weightsFeel', WEIGHTS_FEEL_VALUES],
] as const)('saves the %s a diver picked, and clears it when they pick it again', async (label, group, field, values) => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, group);

  // Deliberately not the first chip: an `onChange` hard-wired to `options[0]` would pass
  // against index 0 and be wrong for every other value the field can hold.
  await pressChip(t, label, 1);
  expect(findChip(t, label, 1)?.props?.accessibilityState?.selected).toBe(true);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(writtenInput(0)[field]).toBe(values[1]);

  // The same chip again, which §2.2's "only the fields you use" needs to mean "and unuse":
  // `OptionChips` hands back `''`, `optionalPicked` turns that into `null`, and
  // `toNewDiveInput` omits a null outright. A chip that could only ever be set would leave
  // a diver who mis-tapped with no way back to "not recorded".
  await pressChip(t, label, 1);
  expect(findChip(t, label, 1)?.props?.accessibilityState?.selected).toBe(false);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(writtenInput(1)).not.toHaveProperty(field);
});

it("saves the cylinder material a diver picked, which lives inside the dive's tanks", async () => {
  // The fifth option field, and the only one whose value is not a column of its own: it is
  // `tanks.0.material` inside §6's one JSON blob, so it reaches the write through a
  // different path from the four above and a wrapper wired only for top-level fields would
  // still leave this one dead.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');

  await pressChip(t, 'Material', 1);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(writtenTanks()?.[0]).toEqual(expect.objectContaining({ material: TANK_MATERIAL_VALUES[1] }));

  await pressChip(t, 'Material', 1);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  const cleared = (mockCreate.mock.calls[1]?.[1] as { tanks?: { material?: unknown }[] })?.tanks;
  expect(cleared?.[0]?.material).toBeNull();
});

it("saves the cylinder configuration a diver picked, which lives inside the dive's tanks too", async () => {
  // The sixth option field, and the rig `count` was replaced by (§10). It was already red
  // under a repointed `name` — but only through a preset test that reads the chip's own
  // selected state back, which is precisely the coverage this section's header warns is not
  // coverage ("a control that updates itself and never reaches the form is exactly the
  // failure, and reading the chip back would report it as working"). This drives it to the
  // write, as its sibling `Material` already is.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');

  await pressChip(t, 'Configuration', 1);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(writtenTanks()?.[0]).toEqual(expect.objectContaining({ configuration: CONFIGURATION_VALUES[1] }));

  await pressChip(t, 'Configuration', 1);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  const cleared = (mockCreate.mock.calls[1]?.[1] as { tanks?: { configuration?: unknown }[] })?.tanks;
  expect(cleared?.[0]?.configuration).toBeNull();
});

it.each(EQUIPMENT_VALUES.map((token) => [formatEquipmentToken(token), token] as const))(
  'adds %s to the equipment set and takes it out again — a token is not a one-way door',
  async (label, token) => {
    mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
    const t = await render(<DiveFormScreen mode="create" />);
    await openGroup(t, 'Equipment');

    await pressEquipmentToken(t, label);
    expect(findEquipmentToken(t, label)?.props?.accessibilityState?.checked).toBe(true);
    await pressSave(t);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(writtenInput(0).equipment).toEqual([token]);

    await pressEquipmentToken(t, label);
    expect(findEquipmentToken(t, label)?.props?.accessibilityState?.checked).toBe(false);
    await pressSave(t);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    // `[]`, not the token still sitting there: taking an accessory off is a real edit, and a
    // control that could only ever add would look identical after one tap.
    expect(writtenInput(1).equipment).toEqual([]);
  },
);

it('saves the suit thickness a diver typed, and clears it when they empty the field', async () => {
  // The one field M1h added that is TYPED rather than tapped, so it cannot ride the chip
  // table above — but it carries the identical per-call-site `name` hazard, and
  // `name="weightsKg"` in its place would quietly put millimetres in the weights column.
  // Driven to the write for the same reason everything else in this section is.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Equipment');

  await typeInto(t, 'Suit thickness', '5');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(writtenInput(0).suitThicknessMm).toBe(5);
  // ...and it did not land in the column next to it, which is exactly what a repointed
  // `name` looks like from the write side: the right value, the wrong field, nothing to say so.
  expect(writtenInput(0)).not.toHaveProperty('weightsKg');

  // Emptying it is a real instruction (§2.2's "only the fields you use", and unuse):
  // `optionalNumber` turns `''` into null and `toNewDiveInput` omits a null outright.
  await typeInto(t, 'Suit thickness', '');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(writtenInput(1)).not.toHaveProperty('suitThicknessMm');
});

it('writes the equipment set in the vocabulary\'s own order, whichever order the diver taps', async () => {
  // The order is what `domain/types.ts` says the list declares, and what `formatEquipment`
  // reads back on the detail — so a set assembled in tap order would read "Torch · Hood" on
  // one dive and "Hood · Torch" on the next for identical gear.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Equipment');
  await pressEquipmentToken(t, 'Camera');
  await pressEquipmentToken(t, 'Hood');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(writtenInput(0).equipment).toEqual(['hood', 'camera']);
});

it('carries an option and an equipment token into an edit through the same two controls', async () => {
  // The write is `updateDive` here, not `createDive`, and the diff (`toDivePatch`) is what
  // decides whether either field is named at all — so the create-mode tests above cannot
  // stand in for this one. Both fields start unset on the stored dive, so a patch that
  // names them is the control having reached the form.
  const target = existing();
  stubLogbookFor(target);
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Conditions');
  await pressChip(t, 'Entry', 1);
  await openGroup(t, 'Equipment');
  await pressEquipmentToken(t, 'Gloves');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  expect(writtenPatch()).toHaveProperty('entry', ENTRY_VALUES[1]);
  expect(writtenPatch().equipment).toEqual(['gloves']);
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

it('names the cylinder gas fields from the one owner of those words, with the unit on the figure', async () => {
  // The same drift as the material chips above, one row down and found the same way: this
  // screen labelled the two gas fields `O2 %` and `He %` while DiveDetailScreen labelled them
  // `O₂` and `He`. Asserted against `O2_LABEL`/`HE_LABEL` (format/display.ts) rather than
  // against a literal, so a screen that re-inlines a spelling of its own fails here instead
  // of quietly disagreeing with the detail page a diver reaches next.
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(findTextInput(t, O2_LABEL)).toBeDefined();
  expect(findTextInput(t, HE_LABEL)).toBeDefined();
  // The constants are not empty strings, which would make the two queries above match the
  // first unlabelled input in the tree and agree for the wrong reason.
  expect(O2_LABEL).toBe('O₂');
  expect(HE_LABEL).toBe('He');

  // And the `%` the old label carried is on the FIGURE now, not lost in the rename — the
  // same place `Size` keeps its `l` and `Working pressure` its `bar`, and the same place the
  // detail screen has always kept it (`formatPercent` renders "32 %"). `unit` reaches an
  // empty field as its placeholder (FormField.tsx, §0.6), which is what makes it readable
  // here on a form nobody has typed into.
  expect(findTextInput(t, O2_LABEL)?.props?.placeholder).toBe('%');
  expect(findTextInput(t, HE_LABEL)?.props?.placeholder).toBe('%');
});

it('asks for the rig with chips, and asks for no cylinder count at all', async () => {
  // This replaces a test that pinned `number-pad` on a typed Count, because a fractional
  // count was *contradictory* in derived.ts and voided the dive's whole gas figure. §10
  // removed the field: the count is derived from the rig (`cylinderCount`), so the hazard
  // has no way in. Both halves are asserted — the chips exist, and no typed count survives
  // anywhere on the form, which is what would quietly reintroduce it.
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(findChip(t, 'Configuration', 0)).toBeDefined();
  expect(findTextInput(t, 'Count')).toBeUndefined();
  expect(findTextInput(t, 'Size')?.props?.keyboardType).toBe('decimal-pad');
});

// --- §2.2: the cylinder specification reads back as one row ---
//
// The owner's complaint was six cylinder fields on a form where he changes only the gas and
// the pressures. §10's snapshot ruling is what makes the answer a display question: the dive
// stores its own full copy of the spec, and *storing and showing are different questions*. So
// the four fields a diver sets once collapse into `formatCylinderSpec`'s line and expand when
// they want to correct them on this dive.
//
// **Every test below drives the row rather than the component's props**, for the reason the
// field sweep's own header gives: a summary that renders correctly and cannot be opened, or
// one that opens onto fields wired to nothing, both look right from the outside.

/** The four fields the summary stands in for — the ones that must vanish behind it and come
 * back when it opens. `Size` and `Working pressure` are typed; `Material` and `Configuration`
 * are chip rows, so this checks both kinds. */
const SPEC_FIELD_LABELS = ['Size', 'Working pressure'] as const;

function specFieldsShown(t: RenderResult): boolean {
  return SPEC_FIELD_LABELS.every((label) => findTextInput(t, label) !== undefined);
}

/** A dive whose cylinder records a full specification and a mix — the ordinary carried case. */
const cylinderDive = () =>
  dive({
    id: 'target',
    date: '2026-08-16',
    tanks: [tank({ material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232, o2Pct: 32 })],
  });

it('reads a recorded cylinder back as one line instead of four fields', async () => {
  stubLogbookFor(cylinderDive());
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');

  // The line itself comes from `formatCylinderSpec` (format/display.ts) rather than being
  // spelled out here, so a screen that grew a private copy of the order or the separators
  // fails this instead of quietly disagreeing with §3's preset list.
  expect(shownIn(t, 'Cylinder')).toBe(formatCylinderSpec(cylinderDive().tanks[0] as Tank, 'metric'));
  // The formatter is not returning null, which would make the line above read "Not set" and
  // agree with a broken screen for the wrong reason.
  expect(shownIn(t, 'Cylinder')).toBe('Single 12 l Steel · 232 bar');
  expect(specFieldsShown(t)).toBe(false);
  expect(findChip(t, 'Material', 0)).toBeUndefined();
});

it('gives every one of those fields back on a press — the spec is summarised, never removed', async () => {
  // §10 is explicit that the fields stay reachable: the dive stores its own copy of the spec,
  // "or the snapshot is a snapshot nobody can amend". A row that summarised and could not be
  // opened would pass the test above.
  stubLogbookFor(cylinderDive());
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');
  await openCylinder(t);

  expect(specFieldsShown(t)).toBe(true);
  expect(findTextInput(t, 'Size')?.props?.value).toBe('12');
  expect(findTextInput(t, 'Working pressure')?.props?.value).toBe('232');
  expect(findChip(t, 'Material', 0)).toBeDefined();
  expect(findChip(t, 'Configuration', 0)).toBeDefined();

  // ...and closes again, so this is a disclosure rather than a one-way door.
  await fireEvent.press(findPickerField(t, 'Cylinder')!);
  expect(specFieldsShown(t)).toBe(false);
});

it('follows a correction the diver makes, rather than the value it was seeded with', async () => {
  // The summary reads the LIVE form values. A row that formatted the seed would show the old
  // cylinder back to a diver who had just corrected it, which is the same "says one thing,
  // does another" defect §2.4's own control was rebuilt to end.
  stubLogbookFor(cylinderDive());
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');
  await openCylinder(t);
  await typeInto(t, 'Size', '15');

  expect(shownIn(t, 'Cylinder')).toBe('Single 15 l Steel · 232 bar');
});

it('says nothing about the gas or the gauge readings, which stay directly editable', async () => {
  // The split §10's ruling actually draws: the spec is what kind of cylinder this is, the mix
  // and the pressures are what happened on this dive. Both halves are asserted — the summary
  // omits them, and they are reachable without opening the row at all — because a summary that
  // swallowed the mix would put one value on screen twice with only one copy editable.
  stubLogbookFor(cylinderDive());
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');

  expect(shownIn(t, 'Cylinder')).not.toContain(O2_LABEL);
  expect(findTextInput(t, O2_LABEL)?.props?.value).toBe('32');
  expect(findTextInput(t, HE_LABEL)).toBeDefined();
  // The two pressures live in the core strip now and never needed this group opened.
  expect(findTextInput(t, 'Start pressure')).toBeDefined();
  expect(findTextInput(t, 'End pressure')).toBeDefined();
});

it('shows the fields themselves when there is no specification to summarise', async () => {
  // §0.6: an empty labelled row reads as a control that failed to load — and on a first-ever
  // dive this row would be the only way in to the cylinder fields at all. So the rule is §2.2's
  // group rule turned around: a group opens when it HOLDS something, a summary opens when it
  // holds nothing.
  stubDives({ dives: [] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');

  expect(shownIn(t, 'Cylinder')).toBe('Not set');
  expect(specFieldsShown(t)).toBe(true);
});

it('does not flash the four fields open before the read that would have closed them', async () => {
  // `resolved` (db/liveQuery.ts) is what makes the difference, and without it this row is open
  // on every create-mode form for a frame: the first render always precedes carry-over, so the
  // cylinder always looks unrecorded, and the four fields would close under the diver the
  // moment the previous dive's cylinder landed. Collapsed is the honest answer while nothing
  // has been read — the common case then needs no correction at all.
  // The real first frame, reproduced rather than approximated: `useDives` hands back an empty
  // list before it has read anything, so the seed holds no cylinder and the row's own rule
  // says "open". `resolved` is the only thing that can tell that from a diver who genuinely
  // has none.
  stubDives({ dives: [], resolved: false });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(specFieldsShown(t)).toBe(false);
  expect(shownIn(t, 'Cylinder')).toBe('Not set');

  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [tank()] })] });
  await t.rerender(<DiveFormScreen mode="create" />);
  // Still closed, and now holding the carried cylinder: nothing on screen changed state.
  expect(specFieldsShown(t)).toBe(false);
  expect(shownIn(t, 'Cylinder')).toBe('Single 12 l Steel · 232 bar');
});

it('reads the specification in the diver’s own units', async () => {
  // §6 stores bar and the form holds what the diver types, so the summary rounds the trip
  // through `toStoredTanks` and back out through `formatCylinderSpec`. An imperial diver whose
  // cylinder read `232 bar` here would be reading the stored figure rather than their own.
  mockUseUnitSystem.mockReturnValue('imperial');
  stubLogbookFor(cylinderDive());
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');

  expect(shownIn(t, 'Cylinder')).toBe('Single 12 l Steel · 3365 psi');
});

it('carries a rig this build has no chip for into a new dive rather than dropping it', async () => {
  // What the rounding test that stood here defended against, arriving through the door that
  // is still open: a value from somewhere this form's controls do not govern — carry-over
  // from a row an M2 client wrote. There is no rounding to do any more (a rig is a tap on a
  // closed list), so what is left to defend is §10's "kept, not refused": the cylinder must
  // reach `createDive` with the foreign rig intact, not silently nulled on the way.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({
    dives: [dive({ date: '2026-08-16', tanks: [tank({ sizeL: 12, configuration: 'rebreather' as Tank['configuration'] })] })],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  expect(writtenTanks()?.[0]?.configuration).toBe('rebreather');
  // ...and the rest of the cylinder came through beside it, so this is not passing because
  // the whole array was handed over untouched by a form that never read it.
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

  expect(findTextInput(t, 'Time in')).toBeUndefined();
  expect(findPickerField(t, 'Time in')).toBeDefined();

  // And the fields either side of them ARE still text fields, so none of the above is
  // passing merely because `findTextInput` stopped finding anything.
  expect(findTextInput(t, 'Site')).toBeDefined();
  // `Start pressure` rather than the `Avg depth` this used to name: both pickers sit in the
  // core strip now (§2.2), and a neighbour that needed a group opened to be found would make
  // this test's own sanity check depend on a group's disclosure state.
  expect(findTextInput(t, 'Start pressure')).toBeDefined();
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

// The lookup itself, stated once and directly: which dive `diveId` names, out of a logbook
// that holds more than one. Everything else in this section exercises it in passing (see
// `stubLogbookFor` above for why they now all can); this is the test whose failure names the
// defect. The mutation it exists for is `dives.find((d) => d.id === diveId)` → `dives[0]`,
// which is silent cross-dive data corruption: the newest dive's values shown under the
// edited dive's heading, and written back to the edited dive's id on save.
it('loads and patches the dive the id names, not whichever dive happens to be first', async () => {
  const target = existing();
  stubLogbookFor(target);
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);

  // What the diver is looking at is the TARGET's data, not the newest dive's — in the core
  // strip and inside a collapsed group alike, so this covers the whole seeding path rather
  // than one field that might be special.
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Blue Hole');
  expect(findTextInput(t, 'Max depth')?.props?.value).toBe('32.4');
  expect(shownIn(t, 'Date')).toBe('16 Aug 2026');
  await openGroup(t, 'Notes & rating');
  expect(findTextInput(t, 'Notes')?.props?.value).toBe('Arch at 30 m');

  await typeInto(t, 'Max depth', '28');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  // ...and the write goes to that same dive. Both halves are needed: loading the wrong dive
  // and patching the right id is how a diver's dive #47 quietly becomes a copy of their
  // newest one, and the id alone would not have shown it.
  expect(mockUpdate.mock.calls[0]?.[1]).toBe('target');
  expect(writtenPatch()).toEqual({ maxDepthM: 28 });
});

it('sends only the fields that changed', async () => {
  const target = existing();
  stubLogbookFor(target);
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
  stubLogbookFor(target);
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
  stubLogbookFor(target);
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
  stubLogbookFor(planned);
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
  stubLogbookFor(planned);
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
  stubLogbookFor(planned);
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
  stubLogbookFor(target);
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
  stubLogbookFor(dive({ id: 'target', date: '2026-08-16', timeIn: '07:05' }));
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);

  // Read the way a diver writes a date (`formatDiveDate`), never the stored ISO string —
  // and it is the DIVE's date, which is what an unseeded picker (today, or "Not set") would
  // fail to be.
  expect(shownIn(t, 'Date')).toBe('16 Aug 2026');
  expect(shownIn(t, 'Time in')).toBe('07:05');
});

it("seeds the entry-time picker on the dive's own day, not on today", async () => {
  // What the field SHOWS and what its picker OPENS on are two different values, and only
  // the first was ever checked. `timeOfDayToLocalDate` has to put an `HH:MM` on some day so
  // the picker has a moment to open at, and it used to be today: on the two Sundays a year
  // the clocks move, that day has no 02:30 in it, `new Date(y, m, d, 2, 30)` normalises to
  // 03:30, and confirming the picker unchanged wrote the hour back changed (Android).
  //
  // Asserted on the seed's calendar day rather than by moving the clock: today is not
  // 2026-08-16, so a picker seeded from today fails this outright, in every zone and on
  // every day of the year. `datetime.dst.test.ts` covers the hour itself, in a forced zone
  // whose clocks actually move.
  stubLogbookFor(dive({ id: 'target', date: '2026-08-16', timeIn: '02:30' }));
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);

  const field = findPickerField(t, 'Time in');
  if (!field) throw new Error('no Time in field found');
  await fireEvent.press(field);
  const picker = (t.root ? t.root.queryAll((n) => n.type === 'RNDateTimePicker') : [])[0];
  if (!picker) throw new Error('the Time in field opened no picker');

  // The native side takes the seed as an epoch number on the `date` prop, not as the `Date`
  // the JS component is given — read back through `new Date(...)` and local getters, because
  // "which day did it open on" is a question about the diver's own calendar.
  const seed = new Date(picker.props.date as number);
  expect(seed.getFullYear()).toBe(2026);
  expect(seed.getMonth()).toBe(7);
  expect(seed.getDate()).toBe(16);
  // And it is still the dive's own time on that day, not merely the right day at midnight.
  expect(seed.getHours()).toBe(2);
  expect(seed.getMinutes()).toBe(30);
});

it('follows the date the diver just picked, rather than the one the dive was loaded with', async () => {
  // The seed is the form's LIVE date, not the stored one: a diver who corrects the date
  // before setting the entry time must get a picker that already knows the new day, or the
  // rewrite this fix closes simply moves to the corrected date.
  stubLogbookFor(dive({ id: 'target', date: '2026-08-16', timeIn: '02:30' }));
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await pickDate(t, '2026-03-08');

  const field = findPickerField(t, 'Time in');
  if (!field) throw new Error('no Time in field found');
  await fireEvent.press(field);
  const picker = (t.root ? t.root.queryAll((n) => n.type === 'RNDateTimePicker') : [])[0];
  if (!picker) throw new Error('the Time in field opened no picker');

  const seed = new Date(picker.props.date as number);
  expect(seed.getMonth()).toBe(2);
  expect(seed.getDate()).toBe(8);
});

it('marks nothing as carried in edit mode — a dive already holds its own values', async () => {
  stubLogbookFor(dive({ id: 'target', date: '2026-08-16', siteName: 'Blue Hole', buddy: 'Petr' }));
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
  stubLogbookFor(target);
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
  stubLogbookFor(target);
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
  stubLogbookFor(target);
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');
  await openCylinder(t);
  expect(findTextInput(t, 'Size')?.props?.value).toBe('12');
  // The end pressure is in the core strip now, not in this group — the group is opened
  // above for the cylinder SIZE this test also reads.
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
  // `useDives()` answers asynchronously, so this is the ordinary case on a real device, not
  // an edge one: `defaultValues` is read once at construction, and edit mode built on it
  // alone would show a blank new-dive form over a real dive forever.
  //
  // The first render is stubbed the way the real hook actually behaves there — `resolved:
  // false`, no answer yet (M1f) — which is also the half this test used to model wrongly, as
  // an answered read holding no dives. Those are two different facts now, and the form draws
  // no fields at all for the first, so the seeding this test exists for has to survive the
  // fields MOUNTING late rather than merely being re-synced in place.
  stubDives({ resolved: false });
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  expect(findTextInput(t, 'Site')).toBeUndefined();

  stubLogbookFor(existing());
  await t.rerender(<DiveFormScreen mode="edit" diveId="target" />);

  expect(findTextInput(t, 'Site')?.props?.value).toBe('Blue Hole');
  expect(shownIn(t, 'Date')).toBe('16 Aug 2026');
});

/**
 * M1f, and the third face of the same defect `DiveDetailScreen` and `GearPresetScreen` show
 * as a sentence. Here it is thirty empty rows: on the renders before `useDives()` answers,
 * `target` is `null`, edit mode seeds from `blankFormValues()`, and the diver is shown a form
 * asserting that their dive has no site, no depth and no duration — then it corrects itself.
 * `target === null` meant "not read yet" and "no such dive" at once, and the form said the
 * second out loud while the first was true.
 *
 * So edit mode holds the frame — §0.6's way out and the heading, the two things that are true
 * before anything is read — and draws the fields only once there is an answer. What that
 * answer turns out to be is untouched: a dive that really is gone still gets today's blank
 * form and `MISSING_DIVE_MESSAGE` on save (the test above), because a save against a missing
 * dive refusing is the direction that must never loosen.
 */
describe('before the dives read has answered', () => {
  it('draws no fields over a dive it has not read yet', async () => {
    stubDives({ resolved: false });
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    expect(findTextInput(t, 'Site')).toBeUndefined();
    expect(findTextInput(t, 'Max depth')).toBeUndefined();
    // Nor the control that would write them: there is nothing on screen for it to save, and
    // §1's "never block a save" is about a control that refuses, not about one that has no
    // form under it yet.
    expect(findSaveControl(t)).toBeUndefined();
  });

  it('still offers the way out while it waits', async () => {
    stubDives({ resolved: false });
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    // §0.6: "A form with no visible way out was shipped once and only found by using the
    // app." A frame drawn while waiting is exactly the screen where that would recur.
    expect(findLeave(t)).toBeDefined();
  });

  it('does not name what it is while it does not know, and names it correctly once it does', async () => {
    // The claim this branch was still making (M1g). `headingFor` answers from the dive's STORED
    // status, which is precisely what has not been read — so with `target` null it was told
    // "logged" and said "Edit dive" over what may be a plan, then corrected itself to "Edit
    // plan" a render later. That correction is the proof it had been guessing, and this is the
    // one sentence left inside the code that exists so a screen with no answer does not state
    // one. It says nothing instead, exactly as `DiveDetailScreen` and `GearPresetScreen` do.
    stubDives({ resolved: false });
    const t = await render(<DiveFormScreen mode="edit" diveId="p1" />);
    expect(textIn(t).join(' ')).not.toContain('Edit dive');
    // Both of the other things a heading could say, so a mutation cannot pass this by swapping
    // one guess for another.
    expect(textIn(t).join(' ')).not.toContain('Edit plan');
    expect(textIn(t).join(' ')).not.toContain('Complete dive');

    // **Withheld, not dropped**, and this half is what makes the assertions above a rule rather
    // than a screen that lost its heading: the moment the dive arrives it is named, from its own
    // stored status, and the name is the one the guess got wrong.
    stubLogbookFor(dive({ id: 'p1', date: '2026-09-05', status: 'planned' }));
    await t.rerender(<DiveFormScreen mode="edit" diveId="p1" />);
    expect(textIn(t).join(' ')).toContain('Edit plan');
    expect(textIn(t).join(' ')).not.toContain('Edit dive');
  });

  it('does not make a NEW dive wait for a read it does not need', async () => {
    // Create mode's blank form is the honest one — there is no dive for it to be blank ABOUT
    // — and it is the app's most-used gesture (§2.2). Carry-over lands later through
    // `keepDirtyValues`, which is a fill, not the correction of a false statement. A gate
    // that forgot `mode === 'edit'` would delay every new dive behind a database read.
    stubDives({ resolved: false });
    const t = await render(<DiveFormScreen mode="create" />);
    expect(findTextInput(t, 'Site')).toBeDefined();
    expect(findSaveControl(t)).toBeDefined();
  });
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
  stubLogbookFor(existing());
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
 * against `findSaveControl(t)` in the test below, because the one thing this control must
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
  stubLogbookFor(existing());
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
  const saveStyle = [findSaveControl(t)?.props?.style].flat(5);

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
  const box = Object.assign({}, ...container) as {
    borderWidth?: number;
    borderTopWidth?: number;
    backgroundColor?: string;
    minHeight?: number;
  };
  const styles = makeStyles('light');

  // Nothing that makes a field a field. Directly beneath one, this used to carry
  // `noticeBanner`'s border, `surface` fill and 12 px radius at the same width — the same
  // object one row down, which is why it read as a second empty field rather than as a
  // sentence about the first.
  //
  // The three properties it must not have are the same three, but §0.6's design pass moved
  // where they live: a field is a ROW now, not a box, so the border it must not draw is the
  // row's own top hairline, the fill is the one a FOCUSED row draws, and the height is the
  // row's 48 dp floor. A message that grew any of them would be a row of the form again.
  expect(box.borderWidth ?? 0).toBe(0);
  expect(box.borderTopWidth ?? 0).toBe(0);
  expect(box.backgroundColor).toBeUndefined();
  expect(box.minHeight ?? 0).toBe(0);
  // ...and a real field does have all three, so the difference above is a real one rather
  // than the whole form having quietly lost its rows.
  expect(styles.formField.borderTopWidth).toBeGreaterThan(0);
  expect(styles.formFieldFocused.backgroundColor).toBeDefined();
  expect(styles.formField.minHeight).toBe(48);
  // Weight and size are the lever §0.1 leaves (no red): smaller than the input's own text,
  // and muted rather than full ink. §0.6 adds one more — "muted, **trailing**, under the row
  // it belongs to" — so it lands in the value's column rather than under the label, which
  // names the field and is not what went wrong.
  const text = [message?.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  const ink = Object.assign({}, ...text) as { fontSize?: number; color?: string; textAlign?: string };
  // `fontSize` types as optional on the shared `rowValueSans` this style is built from, so
  // it is pinned present before being compared — an `undefined` slipping through as `NaN`
  // would make the comparison below meaningless rather than red.
  const inputSize = styles.formFieldInput.fontSize;
  expect(inputSize).toBeDefined();
  expect(ink.fontSize).toBeLessThan(inputSize ?? 0);
  expect(ink.color).toBe(styles.formFieldLabel.color);
  expect(ink.textAlign).toBe('right');
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
  expect(findSaveControl(t)?.props?.accessibilityLabel).toBe('Save dive');

  await toggleStatus(t);
  expect(textIn(t).join(' ')).toContain('Save plan');
  expect(textIn(t).join(' ')).not.toContain('Save dive');
  // The announced label moves with the visible one: a screen reader that went on saying
  // "Save dive" would be the same false promise one sense over.
  expect(findSaveControl(t)?.props?.accessibilityLabel).toBe('Save plan');
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
  stubLogbookFor(planned);
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
  stubLogbookFor(planned);
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
  stubLogbookFor(logged);
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
  stubLogbookFor(dive({ id: 'p1', date: '2026-09-05', status: 'planned', siteName: 'Silfra' }));
  await t.rerender(<DiveFormScreen mode="edit" diveId="p1" initialStatus="logged" />);

  // The dive really did arrive (otherwise "still on Logged" would be true of a blank form)...
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Silfra');
  // ...and the control still holds what the route asked for, over the dive's own status.
  expect(plannedIsOn(t)).toBe(false);
});

// --- DESIGN.md §3's unit setting on the form (m/ft · bar/psi · °C/°F · kg/lb) ---
//
// The form is the one screen where getting this half-right is a data bug rather than a
// display one: a field labelled `ft` holding a figure in metres would be written to a
// metres column on the next save. So these cover the whole loop — what the suffix says,
// what the field is seeded with, and what reaches the repository — rather than the label
// alone.
describe('the unit setting', () => {
  const imperial = () => mockUseUnitSystem.mockReturnValue('imperial');

  /** A field's unit suffix and placeholder, which §0.6 makes the same word in the same slot
   * (`FormField.tsx`: one is drawn or the other, never both). Read off the real
   * `TextInput`'s placeholder, so this follows the control rather than the prop. */
  const unitOf = (t: RenderResult, label: string) =>
    String(findTextInput(t, label)?.props?.placeholder ?? '');

  it('labels every unit-bearing field in the chosen system', async () => {
    imperial();
    const t = await render(<DiveFormScreen mode="create" />);
    await openGroup(t, 'Times & depth');
    await openGroup(t, 'Conditions');
    await openGroup(t, 'Gas & cylinders');
    await openGroup(t, 'Equipment');

    expect(unitOf(t, 'Max depth')).toBe('ft');
    expect(unitOf(t, 'Avg depth')).toBe('ft');
    expect(unitOf(t, 'Visibility distance')).toBe('ft');
    expect(unitOf(t, 'Water temp')).toBe('°F');
    expect(unitOf(t, 'Air temp')).toBe('°F');
    expect(unitOf(t, 'Working pressure')).toBe('psi');
    expect(unitOf(t, 'Start pressure')).toBe('psi');
    expect(unitOf(t, 'End pressure')).toBe('psi');
    expect(unitOf(t, 'Weights')).toBe('lb');

    // The four that have no pair (format/units.ts) must NOT move: minutes are minutes,
    // a cylinder's litres are water capacity rather than the cubic feet of free gas an
    // imperial cylinder is named for, a suit's neoprene is stated in millimetres on every
    // label ever printed, and a gas fraction is a percentage in any system.
    expect(unitOf(t, 'Duration')).toBe('min');
    expect(unitOf(t, 'Size')).toBe('l');
    expect(unitOf(t, 'Suit thickness')).toBe('mm');
    expect(unitOf(t, O2_LABEL)).toBe('%');
  });

  it('labels them in metric for a metric diver', async () => {
    const t = await render(<DiveFormScreen mode="create" />);
    await openGroup(t, 'Conditions');
    expect(unitOf(t, 'Max depth')).toBe('m');
    expect(unitOf(t, 'Water temp')).toBe('°C');
  });

  it('seeds an edited dive with the figures the diver reads, not the metres it stores', async () => {
    imperial();
    const target = dive({ id: 'target', date: '2026-08-16', maxDepthM: 24.6, weightsKg: 6.5 });
    stubLogbookFor(target);
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    await openGroup(t, 'Equipment');

    expect(findTextInput(t, 'Max depth')?.props?.value).toBe('81');
    expect(findTextInput(t, 'Weights')?.props?.value).toBe('14');
  });

  it('writes SI whatever the diver typed in', async () => {
    imperial();
    mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
    const t = await render(<DiveFormScreen mode="create" />);
    await typeInto(t, 'Max depth', '81');
    await pressSave(t);

    // 81 ft x 0.3048 m/ft, exactly — the column is metres and stays metres (§6).
    expect(writtenInput().maxDepthM).toBeCloseTo(24.6888, 10);
  });

  // The defect `storedValueFor` exists for, reached through the real screen rather than
  // through the function alone: an imperial diver who opens a dive to fix a typo must not
  // have its stored depth quietly re-quantised to the nearest foot on the way out.
  it('writes nothing for a figure the imperial diver only looked at', async () => {
    imperial();
    const target = dive({ id: 'target', date: '2026-08-16', siteName: 'Blue Hole', maxDepthM: 24.6 });
    stubLogbookFor(target);
    mockUpdate.mockResolvedValue(target);
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    await typeInto(t, 'Site', 'Blue Hole II');
    await pressSave(t);

    expect(writtenPatch()).toEqual({ siteName: 'Blue Hole II' });
    expect(Object.keys(writtenPatch())).not.toContain('maxDepthM');
  });

  it('writes the depth in SI once the imperial diver actually changes it', async () => {
    imperial();
    const target = dive({ id: 'target', date: '2026-08-16', maxDepthM: 24.6 });
    stubLogbookFor(target);
    mockUpdate.mockResolvedValue(target);
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    await typeInto(t, 'Max depth', '82');
    await pressSave(t);

    expect(Object.keys(writtenPatch())).toEqual(['maxDepthM']);
    expect(writtenPatch().maxDepthM).toBeCloseTo(24.9936, 10);
  });

  // `useUnitSystem` resolves asynchronously exactly as `useDives` does, so the first render
  // always sees the metric default. Without `units` in the reseed gate an imperial diver's
  // form would seed metres under `ft` labels and never correct itself.
  it('reseeds when the preference arrives after the first render', async () => {
    const target = dive({ id: 'target', date: '2026-08-16', maxDepthM: 24.6 });
    stubLogbookFor(target);
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    expect(findTextInput(t, 'Max depth')?.props?.value).toBe('24.6');

    imperial();
    await t.rerender(<DiveFormScreen mode="edit" diveId="target" />);
    expect(findTextInput(t, 'Max depth')?.props?.value).toBe('81');
    expect(unitOf(t, 'Max depth')).toBe('ft');
  });
});

// --- §2.3: autocomplete from the diver's own history ---
//
// The list itself is FormField.test.tsx's, and the ranking is suggest.test.ts's. What is
// this screen's, and is tested here, is the wiring: which four fields get a list, which
// dives it is drawn from, and — the correctness half — that §6's `site_id` + `site_name`
// snapshot pair moves together in both directions.

/** Focuses a field the way a diver does, which is what draws its list (§0.6: the list
 * belongs under the FOCUSED row). `fireEvent(input, 'focus')` rather than a prop, so a
 * field wired to a condition it could never satisfy fails here instead of passing. */
async function focusField(t: RenderResult, label: string) {
  const input = findTextInput(t, label);
  if (!input) throw new Error(`no field labelled ${label}`);
  await fireEvent(input, 'focus');
  return input;
}

/** What one field is currently offering, in the order it offers it — read off the
 * `` `Fill ${label} with ${value}` `` label FormField gives each row, so this sees exactly
 * what a screen reader would and can tell one field's list from another's. */
function suggestionsUnder(t: RenderResult, label: string): string[] {
  const prefix = `Fill ${label} with `;
  return buttonsOf(t)
    .map((n) => String(n.props?.accessibilityLabel ?? ''))
    .filter((announced) => announced.startsWith(prefix))
    .map((announced) => announced.slice(prefix.length));
}

async function pickSuggestion(t: RenderResult, label: string, value: string) {
  const row = buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === `Fill ${label} with ${value}`);
  if (!row) throw new Error(`no suggestion offering ${value} under ${label}`);
  await fireEvent.press(row);
}

/** A two-dive logbook whose older dive holds a different value in every autocompleting
 * field, so each field can be asked for a value only IT could supply — a screen that
 * suggested from one column for every field would fail on the value, not just on a count. */
const historyOfTwo = () => [
  dive({ date: '2026-08-20', siteName: 'Silfra', centerName: 'Dive.is', buddy: 'Petr', guide: 'Jana', title: 'Best dive yet', notes: 'Arch at 30 m' }),
  dive({ date: '2026-08-10', siteName: 'Blue Hole', centerName: 'Aqua Divers', buddy: 'Anna', guide: 'Karel' }),
];

it('offers each of §2.3\'s four fields its own column of the diver\'s history', async () => {
  stubDives({ dives: historyOfTwo() });
  const t = await render(<DiveFormScreen mode="create" />);

  await focusField(t, 'Site');
  await typeInto(t, 'Site', 'blue');
  expect(suggestionsUnder(t, 'Site')).toEqual(['Blue Hole']);

  await focusField(t, 'Centre');
  await typeInto(t, 'Centre', 'aq');
  expect(suggestionsUnder(t, 'Centre')).toEqual(['Aqua Divers']);

  await openGroup(t, 'People');
  await focusField(t, 'Buddy');
  await typeInto(t, 'Buddy', 'ann');
  expect(suggestionsUnder(t, 'Buddy')).toEqual(['Anna']);

  await focusField(t, 'Guide');
  await typeInto(t, 'Guide', 'kar');
  expect(suggestionsUnder(t, 'Guide')).toEqual(['Karel']);
});

// The other half of the same rule: §2.3 names four fields, and title and notes are prose a
// diver wrote about one dive rather than names they reuse. `Max depth` stands for the
// numeric fields, which have nothing to autocomplete from at all.
//
// **What this can and cannot fail on.** Stated because the obvious reading is wrong twice
// over, and both readings were checked by mutation rather than reasoned about.
//
// A row draws a list only when BOTH gates open: `asSuggestedField(name)` names it one of
// §2.3's four, and its call site passed `history`. So this cannot catch a screen that handed
// every `ControlledTextField` a list (the name still decides), and it cannot catch `title`
// being added to `SUGGESTED_FIELDS` either — that mutation was run, and this test stayed
// green, because the `Title` call site passes no `history` for the new membership to act on.
// No single edit reaches it.
//
// The half that IS single-edit falsifiable lives with the decision: `suggest.test.ts`'s
// `covers exactly the four fields, and not the prose ones` fails the moment `title` or
// `notes` joins that list, and `PAIRED_ID_FIELD`'s `Record` makes the same edit a build
// error. What this test adds is the end-to-end statement that the wiring agrees with the
// list — that no row outside those four was handed the other gate's key — which is the
// claim a reader of this screen actually wants checked.
it('offers nothing to the fields §2.3 does not name', async () => {
  stubDives({ dives: historyOfTwo() });
  const t = await render(<DiveFormScreen mode="create" />);

  await focusField(t, 'Max depth');
  expect(suggestionsUnder(t, 'Max depth')).toEqual([]);

  await openGroup(t, 'Notes & rating');
  await focusField(t, 'Title');
  await typeInto(t, 'Title', 'best');
  expect(suggestionsUnder(t, 'Title')).toEqual([]);

  await focusField(t, 'Notes');
  await typeInto(t, 'Notes', 'arch');
  expect(suggestionsUnder(t, 'Notes')).toEqual([]);
});

// **The correctness half of this task** (DESIGN.md §10, written for it): "picking a
// suggestion sets both together... otherwise a dive carries one site's id under another's
// name, which is latent while every id is null and becomes wrong the day M2 fills them in."
//
// Asserted on the WRITE, not on the screen, because that is the level where it can fail:
// `siteId` has no row of its own — it is not a field a diver types — so nothing on screen
// would ever show the mismatch. The carried id belongs to a *different* site from the one
// picked, which is what makes the assertion about provenance rather than about not-null.
it('fills a site and its paired id from the same suggestion, not from carry-over', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({
    dives: [
      dive({ date: '2026-08-20', siteName: 'Silfra', siteId: 'site-silfra' }),
      dive({ date: '2026-08-10', siteName: 'Blue Hole', siteId: 'site-blue' }),
    ],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  // Carry-over opened the form on the most recent dive's site — name AND id.
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Silfra');

  await focusField(t, 'Site');
  await typeInto(t, 'Site', 'blue');
  await pickSuggestion(t, 'Site', 'Blue Hole');
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Blue Hole');

  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(writtenInput().siteName).toBe('Blue Hole');
  // The id of the dive the NAME came from. `site-silfra` here — the id carry-over opened
  // with, under a name the diver has since replaced — is the exact defect.
  expect(writtenInput().siteId).toBe('site-blue');
});

// The other direction, and the one no existing test could fail on: a typed name no longer
// refers to the carried id, so the id must be cleared rather than left pointing at a site
// the dive is no longer at. Both pairs, so the rule is not wired to `site` alone.
it('clears the paired id when a name is typed over by hand', async () => {
  const target = dive({
    id: 'target', date: '2026-08-16',
    siteName: 'Blue Hole', siteId: 'site-blue',
    centerName: 'Aqua Divers', centerId: 'centre-aqua',
  });
  stubLogbookFor(target);
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);

  await typeInto(t, 'Site', 'Somewhere else');
  await typeInto(t, 'Centre', 'Another centre');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

  expect(writtenPatch().siteName).toBe('Somewhere else');
  expect(writtenPatch().centerName).toBe('Another centre');
  // `null`, not absent: absent means "don't touch" to the repository (db/dives.ts's patch
  // contract), which would leave one site's id under another site's name in the row.
  expect(writtenPatch()).toHaveProperty('siteId', null);
  expect(writtenPatch()).toHaveProperty('centerId', null);
});

// §0.6: "overwriting is just typing, and drops the chip" — and picking a suggestion is
// overwriting by another gesture. The carried value is a PREFIX of the offered one, which
// is what lets a field still holding its carried text have anything to offer at all (a
// suggestion never repeats the value the field already holds).
it('drops the carried mark when a suggestion is picked, not only when one is typed', async () => {
  stubDives({
    dives: [
      dive({ date: '2026-08-20', buddy: 'Petr' }),
      dive({ date: '2026-08-10', buddy: 'Petra' }),
    ],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');
  expect(findClearCarried(t, 'Buddy')).toBeDefined();

  await focusField(t, 'Buddy');
  expect(suggestionsUnder(t, 'Buddy')).toEqual(['Petra']);
  await pickSuggestion(t, 'Buddy', 'Petra');

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petra');
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
});

// Edit mode reads the same one list every screen reads, so the dive under edit is IN it —
// and it must not offer its own values back to the field they came from. Its spelling would
// also be the most recent one, so it would decide how every other dive's version of that
// name is displayed, which is the wrong dive to ask.
it('does not offer the dive under edit its own values back', async () => {
  const target = dive({ id: 'target', date: '2026-08-16', siteName: 'Blue Hole' });
  stubDives({ dives: [target, dive({ date: '2026-08-01', siteName: 'Blue Lagoon' })] });
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);

  await focusField(t, 'Site');
  await typeInto(t, 'Site', 'blue');
  expect(suggestionsUnder(t, 'Site')).toEqual(['Blue Lagoon']);
});

// The case §2.3's own wiring is mostly FOR, end to end: carry-over fills the site, so a
// diver changing sites clears it and is then looking at an empty field. That empty query is
// not "no suggestions" — it is §2.1's "the app learns: pickers order options by your usage
// frequency" applied to a text field, and it is the only path where the list appears without
// a single keystroke. Both halves are asserted in one test because they are one gesture: the
// field holding its carried value offers nothing (it would be offering itself), and the same
// field a tap later offers the diver's most-used sites.
it('offers the most-used sites the moment a carried one is cleared', async () => {
  stubDives({
    dives: [
      dive({ date: '2026-08-20', siteName: 'Silfra' }),
      dive({ date: '2026-08-10', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-05', siteName: 'Blue Hole' }),
    ],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  await focusField(t, 'Site');
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Silfra');
  expect(suggestionsUnder(t, 'Site')).toEqual([]);

  const clear = findClearCarried(t, 'Site');
  if (!clear) throw new Error('Site was not marked carried to begin with');
  await fireEvent.press(clear);

  expect(findTextInput(t, 'Site')?.props?.value).toBe('');
  // Most-used first, most recent breaking the tie — not the order the dives arrived in.
  expect(suggestionsUnder(t, 'Site')).toEqual(['Blue Hole', 'Silfra']);
});

// --- §2.1: cylinder presets, applied and captured in the Gas & cylinders group (M1e) ---
//
// The repository, the pressure strip, the ordering and the duplicate rule are all
// `db/gearPresets.test.ts`'s, against a real database. What is this screen's, and is tested
// here, is the wiring: which chips appear (and when none do), what one tap does to the
// cylinder fields the diver is looking at, and — the correctness half — that a preset
// captured from an imperial diver's form is stored in bar and litres rather than in psi.

/** A `GearPreset` with only the fields a test cares about. Ids come from a counter for the
 * reason `diveFixture`'s own do: two presets built with identical arguments must still be
 * distinct, since this screen keys its chip row by id. */
let presetSeq = 0;
const preset = (over: Partial<GearPreset> = {}): GearPreset => ({
  id: `preset-${String(presetSeq++).padStart(4, '0')}`,
  name: 'twin 12 steel',
  tanks: [],
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

/** A preset's own chip, by the `Apply preset <name>` label the row announces — a button that
 * DOES something, never a fixed-choice option that stays selected (see the screen's own
 * `PresetChips` for why this is not `OptionChips`). */
const findPresetChip = (t: RenderResult, name: string) => findButton(t, `Apply preset ${name}`);

/** Every preset chip currently offered, in the order the row draws them. */
const presetChipsIn = (t: RenderResult): string[] =>
  buttonsOf(t)
    .map((n) => String(n.props?.accessibilityLabel ?? ''))
    .filter((label) => label.startsWith('Apply preset '))
    .map((label) => label.slice('Apply preset '.length));

/** The cylinders the screen asked the repository to store. */
function writtenPresetTanks(): Partial<Tank>[] | undefined {
  return (mockCreatePreset.mock.calls[0]?.[1] as { tanks?: Partial<Tank>[] } | undefined)?.tanks;
}

/** Fills the cylinder group with enough for a preset to be worth storing. */
async function typeACylinder(t: RenderResult, size = '12', workingPressure = '232') {
  await typeInto(t, 'Size', size);
  await typeInto(t, 'Working pressure', workingPressure);
}

/**
 * Reveals the name row and confirms it — the two-step the group's end offers.
 *
 * `Save as preset` and `Save preset` are two distinct whole labels, and neither is a
 * substring of the other, so `findButton`'s substring match cannot confuse them. Neither can
 * reach `findSaveControl` above, which matches the dive's save by its whole label.
 */
async function addPresetNamed(t: RenderResult, name: string) {
  const reveal = findButton(t, 'Save as preset');
  if (!reveal) throw new Error('no "Save as preset" control found');
  await fireEvent.press(reveal);
  if (name !== '') await typeInto(t, 'Preset name', name);
  const confirm = findButton(t, 'Save preset');
  if (!confirm) throw new Error('the name row offered no confirm');
  await fireEvent.press(confirm);
}

/**
 * **The two gestures that write into the form without going through a `Controller`, and the
 * one flag that keeps what they wrote.**
 *
 * `setPairedId` and `applyPreset` both reach the form through `setValue`, so react-hook-form
 * only knows the diver moved anything because of `{ shouldDirty: true }` — and
 * `resetOptions.keepDirtyValues` protects nothing else. Without the flag the next `values`
 * re-sync replaces both from carry-over: the paired id reverts to the id of a site the diver
 * has already typed over (`siteName: "Blue Hole"` with `siteId: "site-silfra"`, which is
 * verbatim the defect §10's autocomplete entry was amended for), and applied cylinders
 * silently become the previous dive's again.
 *
 * **Deleting `{ shouldDirty: true }` from both call sites left all 1155 tests green.** It was
 * read and adjudicated as correct by two reviews before a probe went looking — which is the
 * milestone's own lesson, one layer below where it had been learned: reading cannot tell a
 * guarantee that holds from one that is merely undefended.
 *
 * **The second dive must DIFFER from the first, and that is the whole trick.** The gate in
 * this screen reopens on a new `sourceId`, but react-hook-form skips the reset entirely when
 * the new `values` object is deep-equal to the old one — so a probe whose two carry-over
 * sources held identical values passed with the flag removed. The `buddy` below is what makes
 * these tests able to fail; it is not scenery.
 *
 * The same race every other re-sync test here models (`useDives()` starts empty and resolves a
 * frame or more later), except that those all exercise TYPING, which a `Controller` marks
 * dirty on its own — so the two gestures that bypass the `Controller` are exactly the two the
 * suite never reached.
 */

it('keeps a picked paired id when carry-over resolves again afterwards', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({
    dives: [
      dive({ date: '2026-08-20', siteName: 'Silfra', siteId: 'site-silfra', buddy: 'Petr' }),
      dive({ date: '2026-08-10', siteName: 'Blue Hole', siteId: 'site-blue' }),
    ],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  await focusField(t, 'Site');
  await typeInto(t, 'Site', 'blue');
  await pickSuggestion(t, 'Site', 'Blue Hole');

  // A newer dive lands, so carry-over re-derives from a different source — and differs in a
  // field nothing here touches, so the re-sync actually runs.
  stubDives({
    dives: [
      dive({ date: '2026-08-21', siteName: 'Silfra', siteId: 'site-silfra', buddy: 'Ondra' }),
      dive({ date: '2026-08-10', siteName: 'Blue Hole', siteId: 'site-blue' }),
    ],
  });
  await t.rerender(<DiveFormScreen mode="create" />);
  // The re-sync did happen: a field the diver never touched took the new source's value.
  // Without this line the test could pass against a screen that stopped re-syncing at all,
  // which is the other way to keep a picked id and is not the one being pinned.
  await openGroup(t, 'People');
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Ondra');

  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  // Asserted on the WRITE, because `siteId` has no row of its own — nothing on screen would
  // ever show the mismatch. The name is dirty from the typing and survives either way; the id
  // is the half only `shouldDirty` keeps.
  expect(writtenInput().siteName).toBe('Blue Hole');
  expect(writtenInput().siteId).toBe('site-blue');
});

it('keeps applied preset cylinders when carry-over resolves again afterwards', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubPresets([
    preset({ name: 'alu 80', tanks: [tank({ material: 'alu', sizeL: 11.1, workingBar: 207, startBar: null, endBar: null })] }),
  ]);
  stubDives({ dives: [dive({ date: '2026-08-20', buddy: 'Petr', tanks: [tank({ sizeL: 15 })] })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await openCylinder(t);
  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);
  expect(findTextInput(t, 'Size')?.props?.value).toBe('11.1');

  stubDives({ dives: [dive({ date: '2026-08-21', buddy: 'Ondra', tanks: [tank({ sizeL: 15 })] })] });
  await t.rerender(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Ondra');

  // On screen and in what is written: the applied cylinder, not the carried 15 l one.
  expect(findTextInput(t, 'Size')?.props?.value).toBe('11.1');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect((writtenInput().tanks as { sizeL?: number }[])[0]?.sizeL).toBe(11.1);
});

it('shows nothing new to a diver who has never saved a preset', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(presetChipsIn(t)).toEqual([]);
  // Not merely "no chips": the row's own label must be absent too, so an empty preset row
  // does not read as a control that failed to load.
  expect(textIn(t).join(' ')).not.toContain('Presets');
  // The capture control is still there — it is how the first preset ever gets made.
  expect(findButton(t, 'Save as preset')).toBeDefined();
});

// The order is `comparePresets`' (domain/presets.ts), decided once and applied inside
// `toGearPresets` — this screen must draw the list it is handed and never re-sort it, or the
// chips and §3's Settings list would disagree about where a preset sits.
//
// Stubbed in the order that is NOT sorted, deliberately: with `['alu 80', 'twin 12 steel']`
// — which is already the comparator's answer — a screen that re-sorted would pass this test
// while breaking the claim its name makes.
it('offers one chip per preset, in the order the hook hands them', async () => {
  stubPresets([preset({ name: 'twin 12 steel' }), preset({ name: 'alu 80' })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(presetChipsIn(t)).toEqual(['twin 12 steel', 'alu 80']);
});

// §2.1 puts the chips where the cylinders are, and §10 puts the capture where a deliberate
// act belongs — "the position `Delete dive` occupies on the detail screen". Asserted by
// position against the group's own first field rather than by looking at a style, because
// position is the whole claim.
it('puts the chips above the cylinder fields and the capture below them', async () => {
  stubPresets([preset({ name: 'alu 80' })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const labels = buttonsOf(t).map((n) => String(n.props?.accessibilityLabel ?? ''));
  const material = labels.indexOf(`Material: ${formatTankMaterial('steel')}`);
  expect(material).toBeGreaterThan(-1);
  expect(labels.indexOf('Apply preset alu 80')).toBeLessThan(material);
  expect(labels.indexOf('Save as preset')).toBeGreaterThan(material);
});

// Two controls, one word, and no ambiguity about which of them writes a dive. Worth pinning
// because the preset control was first named AROUND this collision ("Add to my presets")
// rather than for the diver: `formFooter` is a sibling AFTER `formScroll`, so a query that
// matched "Save" as a substring landed on the group's control first. The screen is allowed to
// say "Save" where it says what it saves; the query is what had to get stricter.
it('keeps the dive’s own save distinct from the preset control beside it', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const labels = buttonsOf(t).map((n) => String(n.props?.accessibilityLabel ?? ''));
  // In tree order — the group's control first, the footer's last — which is exactly why a
  // substring match would have found the wrong one.
  expect(labels.filter((label) => label.includes('Save'))).toEqual(['Save as preset', 'Save dive']);
  expect(findSaveControl(t)?.props?.accessibilityLabel).toBe('Save dive');
});

it('fills the whole cylinder block in one tap', async () => {
  stubPresets([
    preset({ name: 'alu 80', tanks: [tank({ material: 'alu', configuration: 'twinset', sizeL: 11.1, workingBar: 207, o2Pct: 32, startBar: null, endBar: null })] }),
  ]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);

  expect(findTextInput(t, 'Size')?.props?.value).toBe('11.1');
  expect(findTextInput(t, 'Working pressure')?.props?.value).toBe('207');
  expect(findTextInput(t, O2_LABEL)?.props?.value).toBe('32');
  // The material and the rig are chip rows, not text fields — and "the chosen thing is the
  // inverted thing" is what a diver actually sees change. The rig is asserted because it
  // replaced a typed Count: a preset that stopped carrying it would look identical here
  // without this line, and would silently halve a twinset's gas figure on every dive it
  // filled in.
  expect(findChip(t, 'Material', 1)?.props?.accessibilityState?.selected).toBe(true);
  expect(findChip(t, 'Configuration', 1)?.props?.accessibilityState?.selected).toBe(true);
});

// A preset holds no pressures (§10), so it has nothing to say about them — and wiping a
// gauge reading the diver typed thirty seconds ago would be the same silent destruction of
// diver-entered data that `withoutUndefinedFields` (db/dives.ts) exists to prevent, arriving
// through a tap instead of through a patch.
it('leaves a pressure the diver has already typed exactly where it is', async () => {
  stubPresets([preset({ name: 'alu 80', tanks: [tank({ sizeL: 11.1, startBar: null, endBar: null })] })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeInto(t, 'Start pressure', '210');
  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);

  expect(findTextInput(t, 'Start pressure')?.props?.value).toBe('210');
  expect(findTextInput(t, 'Size')?.props?.value).toBe('11.1');
});

// §0.6: "overwriting is just typing, and drops the chip". A field the diver has just filled
// from a preset is not carried from their last dive any more, and an `×` still offering to
// clear it would be offering to clear a value they chose.
it('drops the carried mark from the fields it fills', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [tank({ sizeL: 15 })] })] });
  stubPresets([preset({ name: 'alu 80', tanks: [tank({ sizeL: 11.1, startBar: null, endBar: null })] })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await openCylinder(t);
  expect(findClearCarried(t, 'Size')).toBeDefined();

  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);
  expect(findClearCarried(t, 'Size')).toBeUndefined();
});

/**
 * §0.6: "overwriting is just typing, and drops the chip". A preset holding NO cylinders blanks
 * the whole block — pressures included, since there is no cylinder left for a pressure to
 * belong to — so every `carried ×` over those fields is now offering to clear a value the
 * diver no longer has.
 *
 * The bug was in the shape of the loop rather than in the rule: `applied` is `[]` for such a
 * preset, so `applied.forEach` ran zero times while `setValue` wrote `[EMPTY_TANK]`. Dropping
 * the marks for what was WRITTEN rather than for what the preset held is the fix, and it is
 * the only arrangement that is true of both cases.
 *
 * Unreachable through either authoring path — `presetRefusal` refuses a cylinderless preset in
 * the form and in the editor alike — and reachable the day M2's `pull_changes` delivers one,
 * which is a row this branch writes both code and a §10 entry for.
 */
it('drops the carried marks from a block a cylinderless preset blanked', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [tank({ sizeL: 15, workingBar: 300 })] })] });
  stubPresets([preset({ name: 'from another device', tanks: [] })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await openCylinder(t);
  expect(findClearCarried(t, 'Size')).toBeDefined();
  expect(findClearCarried(t, 'Working pressure')).toBeDefined();

  const chip = findPresetChip(t, 'from another device');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);

  // Blanked, which is the existing behaviour and the reason the marks are now wrong...
  expect(findTextInput(t, 'Size')?.props?.value).toBe('');
  expect(findTextInput(t, 'Working pressure')?.props?.value).toBe('');
  // ...and no longer offering to clear what is already gone.
  expect(findClearCarried(t, 'Size')).toBeUndefined();
  expect(findClearCarried(t, 'Working pressure')).toBeUndefined();
});

// A preset is stored in SI (§6) and the form holds what the diver reads, so applying one has
// to convert on the way IN as surely as capturing one converts on the way out.
it('fills an imperial diver’s fields in psi, not in the bar it stores', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  stubPresets([preset({ name: 'alu 80', tanks: [tank({ sizeL: 11.1, workingBar: 232, startBar: null, endBar: null })] })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);

  // 232 bar is 3365 psi (format/units.ts owns the factor and the precision).
  expect(findTextInput(t, 'Working pressure')?.props?.value).toBe('3365');
  // Litres in both systems (§10): the imperial cylinder unit is the cubic foot, which is a
  // different quantity rather than a conversion, so this figure must NOT move.
  expect(findTextInput(t, 'Size')?.props?.value).toBe('11.1');
});

it('asks for a name before it writes anything', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  // Nothing to type into until the diver says they want a preset.
  expect(findTextInput(t, 'Preset name')).toBeUndefined();

  const reveal = findButton(t, 'Save as preset');
  if (!reveal) throw new Error('no "Save as preset" control found');
  await fireEvent.press(reveal);
  expect(findTextInput(t, 'Preset name')).toBeDefined();
  expect(mockCreatePreset).not.toHaveBeenCalled();
});

/**
 * **The defect this task is most likely to ship.** The form holds what the diver reads —
 * `3365` in a field labelled `psi` — and §6 stores SI and nothing else, so a preset captured
 * without the conversion is stored in psi and then applied, wrongly, to every later dive.
 * `toNewDiveInput`'s own docblock records the identical trap for a dive.
 */
it('stores an imperial diver’s preset in bar, not in the psi they typed', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  mockCreatePreset.mockResolvedValue(preset({ name: 'alu 80' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeACylinder(t, '11.1', '3365');
  await addPresetNamed(t, 'alu 80');

  await waitFor(() => expect(mockCreatePreset).toHaveBeenCalledTimes(1));
  expect(mockCreatePreset.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ name: 'alu 80' }));
  // 3365 psi back to bar, exactly — the column is bar and stays bar. The figure is
  // `format/units.ts`'s own psi-to-bar conversion of 3365 and nothing rounder, because a
  // preset stored under the diver's psi reading would come back 3365 here and pass any
  // assertion loose enough to call that "about 232".
  expect(writtenPresetTanks()?.[0]?.workingBar).toBeCloseTo(232.0086, 4);
  // Litres are litres in both systems (§10), so this one must survive untouched.
  expect(writtenPresetTanks()?.[0]?.sizeL).toBe(11.1);
});

it('stores a metric diver’s preset exactly as they typed it', async () => {
  mockCreatePreset.mockResolvedValue(preset({ name: 'twin 12 steel' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeACylinder(t, '12', '232');
  await addPresetNamed(t, 'twin 12 steel');

  await waitFor(() => expect(mockCreatePreset).toHaveBeenCalledTimes(1));
  expect(writtenPresetTanks()?.[0]?.workingBar).toBe(232);
  expect(writtenPresetTanks()?.[0]?.sizeL).toBe(12);
});

// §0.6: "a field error is text, not a field" — it was shipped once as a white box the same
// height as an input.
/**
 * **The three refusals below assert the whole sentence the diver reads, and assert it ABSENT
 * first.** They did not, and that was the defect this block shipped with: `toContain('name')`
 * is satisfied by the field's own "Preset name" label, `toContain('cylinder')` by the "Gas &
 * cylinders" group header, and `toContain('alu 80')` by the stubbed chip's own text. All
 * three passed with `PresetCapture`'s `<FieldNote>` deleted outright — so the diver being
 * told **nothing at all** was green.
 *
 * The brief's requirement is the half that was unguarded: "An empty name does not save. Say
 * so in muted text under the row — §0.6: 'a field error is text, not a field'", and §0.6
 * records that this exact rule shipped broken once already. The `not.toContain` before the
 * gesture is what makes each assertion provably a function of the message rather than of the
 * surrounding UI: a substring already on screen fails the first half.
 *
 * The sentences are literals here, and that is the same deliberate duplication §4.1 records
 * for this screen's field labels — the words a diver reads are part of what this suite pins,
 * and a test that followed a renamed constant would stop pinning them. `says so when the
 * write fails` below has always done it this way.
 */
it('refuses an empty name, and says so in text rather than in a box', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeACylinder(t);
  expect(textIn(t).join(' ')).not.toContain('Give this preset a name');

  await addPresetNamed(t, '');

  expect(mockCreatePreset).not.toHaveBeenCalled();
  expect(textIn(t).join(' ')).toContain('Give this preset a name, so you can find it again.');
  // The name row is still open, so the diver can fix exactly the thing they were told about.
  expect(findTextInput(t, 'Preset name')).toBeDefined();
});

it('refuses a whitespace-only name for the same reason, and says the same thing', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeACylinder(t);
  await addPresetNamed(t, '   ');
  expect(mockCreatePreset).not.toHaveBeenCalled();
  expect(textIn(t).join(' ')).toContain('Give this preset a name, so you can find it again.');
});

// A preset captured from an untouched cylinder block stores nothing useful — and a chip that
// fills a dive with nothing is worse than no chip.
it('refuses to store a preset from a cylinder block with nothing in it', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(textIn(t).join(' ')).not.toContain('A preset with no cylinders fills nothing in — fill the cylinder fields first.');

  await addPresetNamed(t, 'empty');

  expect(mockCreatePreset).not.toHaveBeenCalled();
  expect(textIn(t).join(' ')).toContain('A preset with no cylinders fills nothing in — fill the cylinder fields first.');
});

// The pressures are the one thing a preset does not keep (§10), so a cylinder block holding
// nothing but a gauge reading is still an empty preset — the refusal has to be judged on
// what would actually be STORED, not on what is on screen.
it('counts a cylinder holding only pressures as nothing to store', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(textIn(t).join(' ')).not.toContain('A preset with no cylinders fills nothing in — fill the cylinder fields first.');
  await typeInto(t, 'Start pressure', '210');
  await typeInto(t, 'End pressure', '50');
  await addPresetNamed(t, 'gauge only');
  expect(mockCreatePreset).not.toHaveBeenCalled();
  expect(textIn(t).join(' ')).toContain('A preset with no cylinders fills nothing in — fill the cylinder fields first.');
});

// Two chips reading "alu 80" with different cylinders is a row the diver cannot tell apart
// and cannot fix by looking. `presetNamed` (domain/presets.ts) is the one owner of the
// question, and it is asked of the live list this screen is already showing.
it('refuses a name the diver already has, whatever case they typed it in', async () => {
  stubPresets([preset({ name: 'alu 80' })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeACylinder(t);
  // The chip already puts the bare words "alu 80" on screen, which is exactly why the
  // assertion below is the whole sentence and not the name.
  expect(textIn(t).join(' ')).toContain('alu 80');
  expect(textIn(t).join(' ')).not.toContain('You already have a preset called');

  await addPresetNamed(t, 'Alu 80');

  expect(mockCreatePreset).not.toHaveBeenCalled();
  // Quoting the spelling the diver ALREADY has, not the one they just typed — "You already
  // have a preset called “Alu 80”" would send them looking for a chip that says no such
  // thing.
  expect(textIn(t).join(' ')).toContain('You already have a preset called “alu 80”.');
});

it('closes the name row once the preset is written', async () => {
  mockCreatePreset.mockResolvedValue(preset({ name: 'twin 12 steel' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeACylinder(t);
  await addPresetNamed(t, 'twin 12 steel');

  await waitFor(() => expect(mockCreatePreset).toHaveBeenCalled());
  expect(findTextInput(t, 'Preset name')).toBeUndefined();
  expect(findButton(t, 'Save as preset')).toBeDefined();
});

// §10: "A local save failure is shown to the diver." A preset that silently failed to save
// is one the diver will look for on the next dive and not find.
it('says so when the write fails, and keeps what the diver typed', async () => {
  mockCreatePreset.mockRejectedValue(new Error('disk full'));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  await typeACylinder(t);
  await addPresetNamed(t, 'twin 12 steel');

  await waitFor(() => expect(textIn(t).join(' ')).toContain("Couldn't"));
  expect(findTextInput(t, 'Preset name')?.props?.value).toBe('twin 12 steel');
});

// The preset row is a convenience for filling in a cylinder the diver can simply type, so a
// read that failed draws exactly what a diver with no presets sees — and never a banner over
// the dive they are in the middle of logging (`useGearPresets`' own docblock).
it('keeps working when the preset read itself fails', async () => {
  stubPresets([], new Error('no database'));
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(presetChipsIn(t)).toEqual([]);
  await typeInto(t, 'Size', '15');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
});

// The mirror of the empty-preset case: a preset holding a bottom mix AND a deco gas applies
// both, even though this form still shows only the first cylinder ("+ add cylinder" is not
// built — §6, and the group's own note). Keeping only the first would silently lose gas the
// diver deliberately named, which is most of what a multi-cylinder preset is for.
it('applies every cylinder a preset holds, not just the one the form shows', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubPresets([
    preset({
      name: 'bottom plus deco',
      tanks: [
        tank({ sizeL: 12, o2Pct: 21, startBar: null, endBar: null }),
        tank({ sizeL: 7, o2Pct: 80, startBar: null, endBar: null }),
      ],
    }),
  ]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const chip = findPresetChip(t, 'bottom plus deco');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);

  // The first is what the diver can see, and the second is what the form is holding for them.
  expect(findTextInput(t, 'Size')?.props?.value).toBe('12');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(writtenTanks()).toHaveLength(2);
  expect(writtenTanks()?.[1]?.sizeL).toBe(7);
});

// The third gesture that moves §6's snapshot pair, and the one nothing defended until now:
// the `carried ×`. Typing and picking are pinned on the write payload above; clearing was
// not, and deleting its `onPairedId` line left all 1012 tests green.
//
// **Create mode, because that is the only mode the chip exists in** — it means "this came
// from your last dive", so `seedStateFor` marks nothing at all under edit. That makes the
// assertion an absence rather than an explicit `null`: `toNewDiveInput` omits null fields, so
// a cleared pair leaves neither half in the payload. It is still exactly falsifiable — with
// the clear removed the payload carries `siteId: 'site-blue'` under no site name at all,
// which is the defect in its purest form: a dive that names no site while pointing at one.
it('clears the paired id when the carried chip is cleared, not only when a name is typed', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({
    dives: [dive({ date: '2026-08-10', siteName: 'Blue Hole', siteId: 'site-blue', centerName: 'Aqua Divers', centerId: 'centre-aqua' })],
  });
  const t = await render(<DiveFormScreen mode="create" />);

  const clearSite = findClearCarried(t, 'Site');
  if (!clearSite) throw new Error('Site was not marked carried to begin with');
  await fireEvent.press(clearSite);
  const clearCentre = findClearCarried(t, 'Centre');
  if (!clearCentre) throw new Error('Centre was not marked carried to begin with');
  await fireEvent.press(clearCentre);

  expect(findTextInput(t, 'Site')?.props?.value).toBe('');
  expect(findTextInput(t, 'Centre')?.props?.value).toBe('');

  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());

  // Neither half of either pair. `siteId` alone would be a dive pointing at a site it does
  // not name — and every id is null today, so nothing on screen could ever have shown it.
  expect(Object.keys(writtenInput())).not.toContain('siteName');
  expect(Object.keys(writtenInput())).not.toContain('siteId');
  expect(Object.keys(writtenInput())).not.toContain('centerName');
  expect(Object.keys(writtenInput())).not.toContain('centerId');
});

// §2.4 is why this is the right call, and a decision nothing defends is one an innocent
// refactor deletes: adding `.filter(d => d.status === 'logged')` to the screen's `history`
// used to leave every test green. A planned dive is a site the diver typed an hour ago on the
// boat, which is the site they are most likely to type next.
//
// It also pins the deliberate DIFFERENCE from `carryOverSource`, which takes the most recent
// LOGGED dive: the field opens on Silfra (carry-over skipped the planned dive) while the
// planned dive's own site is still offered. One list, two questions, two answers.
it('offers a site from a dive that is only planned, though carry-over skips it', async () => {
  stubDives({
    dives: [
      dive({ status: 'planned', date: '2026-09-15', siteName: 'Kotelna' }),
      dive({ status: 'logged', date: '2026-08-01', siteName: 'Silfra' }),
    ],
  });
  const t = await render(<DiveFormScreen mode="create" />);
  expect(findTextInput(t, 'Site')?.props?.value).toBe('Silfra');

  await focusField(t, 'Site');
  await typeInto(t, 'Site', 'kot');
  expect(suggestionsUnder(t, 'Site')).toEqual(['Kotelna']);
});
