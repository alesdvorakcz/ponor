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

import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createDive, updateDive } from '../db/dives';
import { createGearPreset } from '../db/gearPresets';
import { useDives } from '../db/useDives';
import { useGearPresets } from '../db/useGearPresets';
import { useOpenFormGroups } from '../db/useOpenFormGroups';
import { setOpenFormGroups } from '../db/settings';
import { useUnitSystem } from '../db/useUnitSystem';
import { CARRIED_FIELDS, TANK_PRESSURE_FIELDS } from '../domain/carryOver';
import { dive } from '../domain/diveFixture';
import { diveFormSchema, outOfScaleNote, TANK_FIELDS } from '../domain/diveFormSchema';
import {
  formatCurrent,
  formatCylinderSpec,
  formatEquipmentToken,
  formatSurge,
  formatTankMaterial,
  formatWaves,
  HE_LABEL,
  O2_LABEL,
} from '../format/display';
import {
  CONDITION_SCALE_VALUES,
  CONFIGURATION_VALUES,
  ENTRY_VALUES,
  RATING_MAX,
  RATING_VALUES,
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
import DiveFormScreen, {
  blankFormValues,
  CARRIED_WITHOUT_A_MARK,
  type FormGroupId,
  defaultOpenGroups,
  CORE_STRIP_FIELDS,
  FORM_GROUPS,
  FORM_GROUP_IDS,
  OFF_FORM_FIELDS,
} from './DiveFormScreen';

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

// §2.2's remembered group state (M1h), mocked per module exactly as the three hooks above
// are, and for the identical reason: it is a live read of a settings row, and this screen must
// be renderable without a database. `stubOpenGroups` below is how a test says what was
// remembered; every test that does not call it gets §2.2's own defaults — nothing remembered,
// and the read has answered — which is what keeps every existing assertion here unchanged.
jest.mock('../db/useOpenFormGroups', () => ({ useOpenFormGroups: jest.fn() }));
// The write half of that memory. Mocked rather than left real because it reaches `db`, and
// because what these tests assert about it is exactly what it was HANDED — a screen that wrote
// the wrong set would look identical on screen.
jest.mock('../db/settings', () => ({ ...jest.requireActual('../db/settings'), setOpenFormGroups: jest.fn() }));
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
const mockUseOpenGroups = useOpenFormGroups as jest.Mock;
const mockSetOpenGroups = setOpenFormGroups as jest.Mock;
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

/**
 * What §2.2's remembered half says — what the diver decided about each group on their last dive,
 * and whether that read has answered yet.
 *
 * **Three states, and the default here is the third one**: `true` for a group they left open,
 * `false` for one they collapsed, and *absent* for one they have never touched, which is the
 * state `FormGroupSpec.startsOpen` answers. Every test that does not call this gets `{}` — a
 * diver who has decided nothing — so *Times & depth* and *Gas & cylinders* are open in most of
 * this file, exactly as they are for a diver opening the app for the first time.
 *
 * `mockImplementation` and a fresh object per call, on `stubDives`' own reasoning: the real hook
 * builds its answer inside `readOpenFormGroups`, so a stub handing back one referentially-stable
 * object for ever would model a contract it does not have.
 */
function stubOpenGroups(remembered: Record<string, boolean> = {}, resolved = true) {
  mockUseOpenGroups.mockImplementation(() => ({ remembered: { ...remembered }, resolved }));
}

/** The two groups §2.2 gives a starting state of open, collapsed by the diver — the memory a
 * test stubs when it wants to see one group's own behaviour with no default underneath it. */
const COLLAPSE_DEFAULT_OPEN = { times: false, gas: false } as const;

beforeEach(() => {
  jest.clearAllMocks();
  stubDives();
  stubPresets();
  stubOpenGroups();
  mockSetOpenGroups.mockResolvedValue(undefined);
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

/**
 * Makes sure a §2.2 group is open, so a test can reach the fields inside it.
 *
 * **"Ensure open", not "press", since M1h**, and the change is not cosmetic. A group now opens
 * by itself when this dive already has a value in it or the diver left it open last time
 * (§2.2), so a helper that always pressed would CLOSE the group for exactly the tests that seed
 * a dive — which is most of the edit-mode ones. What each test means by this call has always
 * been "let me at these fields"; that is now what it says.
 *
 * The disclosure tests further down deliberately do NOT use this: they press the header
 * directly, because the press is what they are about.
 */
async function openGroup(t: RenderResult, title: string) {
  const header = findButton(t, title);
  if (!header) throw new Error(`no ${title} header found`);
  if (header.props?.accessibilityState?.expanded === true) return;
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

/**
 * DESIGN.md §0.6's clear control for one field, by the `` `Clear carried ${label}` ``
 * accessibilityLabel `FormField` and `OptionChips` both give it — present only while that exact
 * field is in this screen's own carried paths, which is what makes this the one query that can
 * tell "this field is marked carried" from "this field merely has a value."
 *
 * Matched on the WHOLE label, so `Suit` cannot answer for `Suit thickness`, and the same query
 * serves a text row and a chip group: the two draw the treatment in different places on the row
 * and announce it identically, which is what makes it one treatment rather than two.
 */
function findClearCarried(t: RenderResult, label: string) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === `Clear carried ${label}`);
}

// The §0.4/§0.1 guard now lives in `src/testing/unexpectedGraphics.ts` — one owner, because
// five files carried the same copy and all five were wrong in the same way: the check read
// `!style.some(known.includes)`, so one known style excused every literal beside it and
// `[styles.x, { backgroundColor: '#f00' }]` — the only shape anyone writes — passed. See that
// module and its own test for what it enforces and why the scheme is now explicit here.

// --- Task 4 brief, Step 1, verbatim ---

// §2.2's core strip, as M1i shrank it: **date · site · centre** — what identifies a dive rather
// than what measures it. The five measurements it held are back in the two groups that open by
// default, so nothing is hidden and a diver who never fills one can collapse it once.
//
// Written out here rather than read off `CORE_STRIP_FIELDS`, on `FIELD_LABELS`' own reasoning:
// a test derived from the layout it is checking agrees with that layout being wrong.
const CORE_STRIP_LABELS = ['Date', 'Site', 'Centre'] as const;

it('shows the core strip without opening anything', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  for (const label of CORE_STRIP_LABELS) {
    expect(text).toContain(label);
  }
});

// The other half of the move, and the half a "does the label show" assertion cannot see: each
// measurement moved INTO its group rather than being copied there. A field rendered twice gives
// one form value two `Controller`s — two boxes a diver can type opposite numbers into, of which
// only the last one touched survives — and it is invisible from either place, because each looks
// right on its own.
it('moved the five measurements into their groups rather than repeating them', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // Every group open at once, so nothing can hide inside a collapsed one.
  for (const group of ['Times & depth', 'Conditions', 'Gas & cylinders', 'Equipment', 'People', 'Notes & rating']) {
    await openGroup(t, group);
  }
  for (const label of ['Max depth', 'Duration', 'Time in', 'Start pressure', 'End pressure']) {
    expect(textIn(t).filter((s) => s === label)).toHaveLength(1);
  }
});

// ...and the strip itself holds the three and nothing else. The sweep above proves each label
// exists once somewhere; this proves WHERE — read off the `formCoreStrip` region, so a
// measurement left behind in the strip fails here rather than passing as "rendered once".
it('keeps the core strip to what identifies the dive, with no measurement in it', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const strip = regionWith(t, makeStyles('light').formCoreStrip);
  expect(strip).toBeDefined();
  const labelled = new Set(
    strip?.queryAll((n) => n.type === 'Text').flatMap((n) => n.children.filter((c) => typeof c === 'string')) ?? [],
  );
  for (const label of CORE_STRIP_LABELS) expect([...labelled]).toContain(label);
  for (const label of ['Max depth', 'Avg depth', 'Duration', 'Time in', 'Start pressure', 'End pressure']) {
    expect([...labelled]).not.toContain(label);
  }
});

it('keeps the deeper groups collapsed until asked', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  expect(text).toContain('Conditions'); // the group's header shows
  expect(text).not.toContain('Water temp'); // its fields do not
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

it("reveals Conditions' fields on press — the header text alone was never proof they exist", async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  expect(textIn(t).join(' ')).not.toContain('Water temp');
  const header = findButton(t, 'Conditions');
  if (!header) throw new Error('no Conditions header found');
  await fireEvent.press(header);
  expect(textIn(t).join(' ')).toContain('Water temp');
});

// A second, independent group, so "collapsed by default" is not proven only for the one
// group the brief's own sample happens to check. (Four of the six are collapsed by default;
// which two are not, and why, is the `startsOpen` block much further down.)
it('keeps a second group collapsed by default, not only the one the sample test checks', async () => {
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

// --- §2.2: groups remember themselves ---
//
// "A group opens when the diver opened it last time **or** when this dive already has a value
// in it." The second half is not optional and §2.2 says why: carry-over fills groups nobody
// touched, so a group holding a carried value the diver cannot see is the same defect as the
// hidden pressures, one layer down.
//
// The three blocks below are three different kinds of claim, and none stands in for the others.
// The first is the LAYOUT INVARIANT: every field the schema declares is placed somewhere. The
// second sweeps the pure rule over every one of those fields. The third proves the screen
// actually wires each group to its own entry — which is the per-call-site hazard the field
// sweep further down was rewritten for, arriving one level up.

/** Every field path this form is responsible for: the schema's own fields, with `tanks`
 * expanded into the cylinder leaves the form actually binds. Read off `diveFormSchema` and
 * `TANK_FIELDS` rather than typed out, so a field added to the domain shows up here on the day
 * it is added. */
const ALL_FORM_FIELDS = Object.keys(diveFormSchema.shape)
  .filter((field) => field !== 'tanks')
  .concat(TANK_FIELDS.map((field) => `tanks.0.${field}`));

it('places every field the schema declares exactly once, and invents none', () => {
  // The checklist, and the reason `FORM_GROUPS` exists as data at all. §2.2's "already has a
  // value in it" is a rule about which fields belong to which group; a field rendered into a
  // group but missing from its entry leaves that group shut over a carried value, silently and
  // with every other test in this file green. A field named here but rendered nowhere is the
  // mirror image — a group that opens for a value no row shows.
  const placed = [
    ...CORE_STRIP_FIELDS,
    ...OFF_FORM_FIELDS,
    ...FORM_GROUP_IDS.flatMap((id) => FORM_GROUPS[id].fields),
  ];
  expect([...placed].sort()).toEqual([...ALL_FORM_FIELDS].sort());
  // ...and no field is in two places, which `toEqual` on sorted lists would report only as a
  // length mismatch with a confusing diff.
  expect(new Set(placed).size).toBe(placed.length);
});

it('draws its groups in the order the layout declares, under the titles it declares', async () => {
  // The other half of the constant being data: the screen must render FROM it. A screen that
  // kept its own titles beside `FORM_GROUPS`' would pass every rule test above while persisting
  // one id and showing another group's name.
  const t = await render(<DiveFormScreen mode="create" />);
  const headers = buttonsOf(t)
    .map((n) => String(n.props?.accessibilityLabel ?? ''))
    .filter((label) => label.startsWith('Expand ') || label.startsWith('Collapse '))
    .map((label) => label.replace(/^(Expand|Collapse) /, ''));
  expect(headers).toEqual(FORM_GROUP_IDS.map((id) => FORM_GROUPS[id].title));
});

/**
 * **What each field's row actually reads on screen — written out here, and deliberately not
 * derived from anything the screen exports.**
 *
 * That is the whole point of this table, and it is the one place in this file where a
 * hand-maintained list is the correct answer rather than the defect §4.1 warns about. Every
 * other assertion about `FORM_GROUPS` is built FROM `FORM_GROUPS`, so all of them stay
 * self-consistent when an entry in it is simply wrong: moving `'weather'` from `conditions` to
 * `people` left **1398 of 1398 tests passing** and `tsc` clean, while producing exactly §2.2's
 * defect — an empty *People* opening while *Conditions*, holding the carried weather, stayed
 * shut. A test derived from the thing it tests cannot catch that thing being wrong.
 *
 * So this is an independent witness: it says what the SCREEN renders, the group test below
 * compares that against what the LAYOUT claims, and the two can only agree by being right. A
 * label that goes stale fails loudly as "the layout claims a field this group does not render"
 * rather than quietly passing.
 *
 * §4.1's "one deliberate exception, until i18next" already scopes duplicated **field labels** as
 * the acceptable duplication, which is exactly what these are.
 *
 * Two entries are not a plain label row and say why here rather than in the assertion:
 * `equipment` renders five accessory rows rather than one labelled row, so its probe is the
 * first of them; the two gas fractions are labelled from `format/display.ts`'s own constants,
 * so they are read through those rather than spelled a second time.
 */
const FIELD_LABELS: Record<string, string> = {
  date: 'Date',
  siteName: 'Site',
  centerName: 'Centre',
  maxDepthM: 'Max depth',
  durationMin: 'Duration',
  timeIn: 'Time in',
  'tanks.0.startBar': 'Start pressure',
  'tanks.0.endBar': 'End pressure',
  avgDepthM: 'Avg depth',
  waterTempC: 'Water temp',
  airTempC: 'Air temp',
  visibility: 'Visibility',
  visibilityM: 'Visibility distance',
  waves: 'Waves',
  current: 'Current',
  surge: 'Surge',
  weather: 'Weather',
  entry: 'Entry',
  salinity: 'Salinity',
  waterBody: 'Water body',
  latitude: 'Latitude',
  longitude: 'Longitude',
  'tanks.0.material': 'Material',
  'tanks.0.sizeL': 'Size',
  'tanks.0.configuration': 'Configuration',
  'tanks.0.workingBar': 'Working pressure',
  'tanks.0.o2Pct': O2_LABEL,
  'tanks.0.hePct': HE_LABEL,
  suit: 'Suit',
  suitThicknessMm: 'Suit thickness',
  equipment: formatEquipmentToken('hood'),
  weightsKg: 'Weights',
  weightsFeel: 'Weighting',
  buddy: 'Buddy',
  guide: 'Guide',
  title: 'Title',
  notes: 'Notes',
  rating: 'Rating',
};

it('has a label for every field that has a row, and none for the three that do not', () => {
  // Keeps the witness honest in the other direction: a field added to the schema and rendered
  // into a group has to get a probe here, or the sweep below would silently stop watching it.
  expect(Object.keys(FIELD_LABELS).sort()).toEqual(
    ALL_FORM_FIELDS.filter((field) => !(OFF_FORM_FIELDS as readonly string[]).includes(field)).sort(),
  );
  // Exact strings, matched against whole `Text` children — so `Suit` cannot match
  // `Suit thickness`, and `Visibility` cannot match `Visibility distance`.
  expect(new Set(Object.values(FIELD_LABELS)).size).toBe(Object.keys(FIELD_LABELS).length);
});

it.each(FORM_GROUP_IDS)(
  'renders exactly the fields the layout claims for %s — read off the screen, not off the layout',
  async (id) => {
    // One group open, five shut, nothing seeded — so what is on screen is the core strip plus
    // this group and nothing else. Compared as a SET of field paths, so the failure names the
    // field rather than a diff of thirty labels.
    //
    // The two groups that start open are stubbed collapsed to get "five shut": left undecided
    // they would be open on every row of this sweep, and the comparison would then be satisfied
    // by any field of theirs appearing anywhere.
    stubOpenGroups(COLLAPSE_DEFAULT_OPEN);
    const t = await render(<DiveFormScreen mode="create" />);
    await openGroup(t, FORM_GROUPS[id].title);

    const onScreen = new Set(textIn(t));
    const shown = Object.entries(FIELD_LABELS)
      .filter(([, label]) => onScreen.has(label))
      .map(([field]) => field);
    expect(shown.sort()).toEqual([...CORE_STRIP_FIELDS, ...FORM_GROUPS[id].fields].sort());
  },
);

// The pure rule, swept over every placed field: a value in a group's field opens THAT group and
// no other.
//
// **It cannot see a field listed under the wrong group, and this comment said it could.** The
// sweep is built FROM `FORM_GROUPS`, so it stays perfectly self-consistent when an entry in it
// is wrong — moving `'weather'` to `people` left the whole suite green. What this defends is
// `holdsValue`, `valueAtPath` and the two halves of the rule; **the membership itself is pinned
// against the screen** by the label sweep above, which is the only assertion in this file that
// does not read `FORM_GROUPS` to decide what to expect. A false claim here is what let the gap
// read as covered, so it is corrected rather than deleted.
describe('defaultOpenGroups', () => {
  /** A form value that counts as recorded, for a field of each shape the schema holds. Chosen
   * per field rather than "any truthy thing", because `holdsValue`'s whole job is to tell a
   * recorded `0` and an empty accessory set apart. */
  const SAMPLE: Record<string, unknown> = {
    maxDepthM: 30,
    avgDepthM: 12,
    durationMin: 47,
    timeIn: '09:15',
    waterTempC: 20,
    airTempC: 24,
    visibility: 'high',
    visibilityM: 15,
    waves: 1,
    current: 0,
    surge: 2,
    weather: 'sunny',
    entry: 'shore',
    salinity: 'salt',
    waterBody: 'ocean',
    latitude: 50.1,
    longitude: 14.4,
    suit: 'wet',
    suitThicknessMm: 5,
    equipment: ['hood'],
    weightsKg: 0,
    weightsFeel: 'good',
    buddy: 'Petr',
    guide: 'Ana',
    title: 'Arch',
    notes: 'Nice',
    rating: 4,
    'tanks.0.material': 'steel',
    'tanks.0.sizeL': 12,
    'tanks.0.configuration': 'single',
    'tanks.0.workingBar': 232,
    'tanks.0.o2Pct': 32,
    'tanks.0.hePct': 0,
    'tanks.0.startBar': 200,
    'tanks.0.endBar': 50,
  };

  /** The form's own blank values, with one field set — built through the same path setter the
   * screen's own `valueAtPath` reads, so a mismatch between the two is impossible. */
  function valuesWith(path: string, value: unknown) {
    const values = { ...blankFormValues() } as Record<string, unknown>;
    const steps = path.split('.');
    let target = values;
    for (const step of steps.slice(0, -1)) {
      target[step] = Array.isArray(target[step]) ? [...(target[step] as unknown[])] : { ...(target[step] as object) };
      target = target[step] as Record<string, unknown>;
    }
    target[steps[steps.length - 1]!] = value;
    return values as unknown as Parameters<typeof defaultOpenGroups>[0];
  }

  /** A memory in which the diver has collapsed both groups that start open (M1i) — so what the
   * sweeps below see is the VALUE rule alone, with no default underneath it to hide behind.
   * Spelled as a decision rather than as `{}`, because `{}` means "never decided" and that is
   * exactly the state `startsOpen` answers. */
  const NOTHING_STARTS_OPEN = { times: false, gas: false } as const;

  it.each(FORM_GROUP_IDS.flatMap((id) => FORM_GROUPS[id].fields.map((field) => [field, id] as const)))(
    'opens the group %s belongs to, and only that one',
    (field, id) => {
      const sample = SAMPLE[field];
      // Every placed field needs a sample; a new one added to a group without one would
      // otherwise sweep through as "nothing recorded" and prove nothing.
      expect(sample).toBeDefined();
      expect([...defaultOpenGroups(valuesWith(field, sample), NOTHING_STARTS_OPEN)]).toEqual([id]);
    },
  );

  it('opens nothing for a dive that records nothing, once the two default groups are collapsed', () => {
    expect([...defaultOpenGroups(blankFormValues(), NOTHING_STARTS_OPEN)]).toEqual([]);
  });

  it('does not open Equipment for an accessory set that records no accessories', () => {
    // The one input on which this rule and the carried-mark rule deliberately disagree
    // (`holdsValue` vs `hasCarriedValue`): `[]` is a real carried answer, and it is also what
    // every untouched form holds — so opening the group for it would open it on every dive.
    expect([...defaultOpenGroups(valuesWith('equipment', []), NOTHING_STARTS_OPEN)]).toEqual([]);
  });

  it('opens a group the diver left open last time even though this dive has nothing in it', () => {
    expect([...defaultOpenGroups(blankFormValues(), { ...NOTHING_STARTS_OPEN, people: true })]).toEqual(['people']);
  });

  it('keeps an id it has never heard of, so an older build cannot forget a newer one’s group', () => {
    // §10's "kept, not refused". The set is what gets written back, so an id dropped here is a
    // memory deleted for the build that understands it.
    expect([...defaultOpenGroups(blankFormValues(), { ...NOTHING_STARTS_OPEN, profile: true })]).toEqual(['profile']);
  });

  // --- §2.2's third state, as a rule (M1i) ---
  //
  // A group with no remembered preference falls back to `startsOpen`; one the diver decided
  // about does not, in EITHER direction. The two `false` cases are the ones that did not exist
  // before this milestone and the ones that a set-of-open-ids could not have stored.
  it('opens the groups that start open when the diver has decided nothing at all', () => {
    expect([...defaultOpenGroups(blankFormValues(), {})].sort()).toEqual(['gas', 'times']);
  });

  it('leaves a group the diver collapsed shut, though it is one that starts open', () => {
    expect([...defaultOpenGroups(blankFormValues(), { times: false })]).toEqual(['gas']);
  });

  it('does not reopen a collapsed group merely because a second one was left open', () => {
    // The two halves of the memory are read per group, not as one flag: a `true` for Conditions
    // must not drag Times open, and a `false` for Times must not shut Gas.
    expect([...defaultOpenGroups(blankFormValues(), { times: false, conditions: true })].sort()).toEqual([
      'conditions',
      'gas',
    ]);
  });

  // The boundary M1i deliberately did NOT move (`defaultOpenGroups`' own docblock): where the
  // memory and the value rule disagree, open still wins. Recorded as a test because it is a
  // decision with a visible cost — cylinders carry over, so a collapse of *Gas & cylinders*
  // will not survive to the next dive — and a silent flip of it should fail here.
  it('opens a collapsed group that this dive has a value in, which is the settled union', () => {
    expect([...defaultOpenGroups(valuesWith('buddy', 'Petr'), { people: false, ...NOTHING_STARTS_OPEN })]).toEqual([
      'people',
    ]);
  });
});

// The screen half. Everything above is a rule; these are the assertions that the form ASKS it,
// of the values it was seeded with, and that a press reaches the row that remembers the answer.

/** Which groups are currently open, by title, read off the state each header announces rather
 * than off what happens to be in the tree — a group whose body rendered while its header said
 * "Expand" would be broken in the direction a screen reader cannot recover from. */
function expandedGroups(t: RenderResult): string[] {
  return buttonsOf(t)
    .filter((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Collapse '))
    .map((n) => String(n.props?.accessibilityLabel).replace('Collapse ', ''));
}

/** The memory the screen last asked `setOpenFormGroups` to store — a decision per group, since
 * M1i, so an id that is absent from it is one the diver has still never touched. */
function lastRemembered(): Record<string, boolean> | undefined {
  return mockSetOpenGroups.mock.calls.at(-1)?.[1] as Record<string, boolean> | undefined;
}

it.each([
  ['times', { avgDepthM: 12 }],
  ['conditions', { waterTempC: 20 }],
  [
    'gas',
    {
      tanks: [{ material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232, o2Pct: 32, hePct: null, startBar: null, endBar: null }],
    },
  ],
  ['equipment', { suit: 'wet' }],
  ['people', { buddy: 'Petr' }],
  ['notes', { notes: 'Arch at 30 m' }],
] as [FormGroupId, Partial<Dive>][])('opens %s over a dive that has a value in it, and leaves the other five shut', async (id, recorded) => {
  // §2.2's second half, asked of a dive the diver opened for editing — where "already has a
  // value in it" means the dive's own stored values. Driven per group because the wiring is per
  // call site: a `<FormGroup>` handed another group's entry would open the wrong one with every
  // rule test above still green.
  //
  // The two groups that start open are stubbed collapsed, so what is measured here is the value
  // rule alone: with them left undecided, *Times & depth* and *Gas & cylinders* would be open on
  // every row of this table and "the other five shut" would stop being a claim about anything.
  //
  // Written as a `Partial<Dive>` rather than through this file's `tank()`/`existing()` helpers
  // because `it.each`'s table is built while the module is still evaluating and those are
  // declared further down.
  stubOpenGroups(COLLAPSE_DEFAULT_OPEN);
  stubLogbookFor(dive({ id: 'target', ...recorded }));
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  expect(expandedGroups(t)).toEqual([FORM_GROUPS[id].title]);
});

it('opens the group carry-over filled, which is the case §2.2 says makes this matter', async () => {
  // "The second half is not optional — carry-over fills groups nobody touched." §2.1 makes the
  // suit and the buddy carry and the water temperature fresh, so a new dive opens Equipment and
  // People over values nobody on this form typed, and leaves Conditions shut.
  stubOpenGroups(COLLAPSE_DEFAULT_OPEN);
  stubDives({ dives: [dive({ date: '2026-08-16', suit: 'wet', buddy: 'Petr', waterTempC: 20 })] });
  const t = await render(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t).sort()).toEqual(['Equipment', 'People']);
});

it('opens a group the diver left open last time, though this dive has nothing in it', async () => {
  stubOpenGroups({ ...COLLAPSE_DEFAULT_OPEN, people: true });
  const t = await render(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t)).toEqual(['People']);
  // ...and the fields really are there, not merely a header claiming to be open.
  expect(findTextInput(t, 'Buddy')).toBeDefined();
});

it('lets the diver close a group the dive has a value in, which is what a control is for', async () => {
  stubOpenGroups(COLLAPSE_DEFAULT_OPEN);
  stubDives({ dives: [dive({ buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t)).toEqual(['People']);

  const header = findButton(t, 'People');
  if (!header) throw new Error('no People header found');
  await fireEvent.press(header);
  expect(expandedGroups(t)).toEqual([]);
});

it('remembers a group the diver opens, alongside everything it already remembered', async () => {
  stubOpenGroups({ conditions: true });
  const t = await render(<DiveFormScreen mode="create" />);
  const header = findButton(t, 'People');
  if (!header) throw new Error('no People header found');
  await fireEvent.press(header);

  // Conditions is carried through untouched, and the two groups the diver has still said nothing
  // about stay absent — a write that helpfully filled them in would turn a starting state into a
  // decision nobody made, which is the whole distinction M1i's third state exists for.
  expect(lastRemembered()).toEqual({ conditions: true, people: true });
});

it('composes one memory out of two presses, rather than losing the first', async () => {
  // The race this exists for: a write built from the STORED set plus the single group just
  // pressed is computed from a row the first write has not landed in yet, so opening two groups
  // in a second would store only the second. Every toggle of this form goes into every write.
  const t = await render(<DiveFormScreen mode="create" />);
  for (const title of ['People', 'Notes & rating']) {
    const header = findButton(t, title);
    if (!header) throw new Error(`no ${title} header found`);
    await fireEvent.press(header);
  }
  expect(lastRemembered()).toEqual({ notes: true, people: true });
});

it('writes a group the diver closes as closed, not as forgotten', async () => {
  // **The half M1i changed, and the one a set of open ids could not say.** Dropping the id would
  // read back as "never decided", so a group that starts open would start open again on the next
  // dive and the diver's gesture would silently undo itself. It has to be stored as `false`.
  stubOpenGroups({ people: true, notes: true });
  const t = await render(<DiveFormScreen mode="create" />);
  const header = findButton(t, 'People');
  if (!header) throw new Error('no People header found');
  await fireEvent.press(header);

  expect(lastRemembered()).toEqual({ people: false, notes: true });
});

it('writes an id it has never heard of straight back, rather than deleting it', async () => {
  // §10's "kept, not refused" at the write end, which is where it actually costs something: an
  // older build opening one form would otherwise wipe a newer build's memory of its own group.
  stubOpenGroups({ profile: true, atmosphere: false });
  const t = await render(<DiveFormScreen mode="create" />);
  const header = findButton(t, 'People');
  if (!header) throw new Error('no People header found');
  await fireEvent.press(header);

  // Both of a newer build's states survive, not only the open one: a `false` dropped here is a
  // collapse that build would find undone.
  expect(lastRemembered()).toEqual({ profile: true, atmosphere: false, people: true });
});

it('writes nothing at all before the read has answered', async () => {
  // `{}` is what the hook reads before it has looked, and it is also what "the diver has decided
  // about nothing" looks like — so a write composed then would store a memory built on an answer
  // nobody has, erasing whatever was really there. The press still opens the group; only the
  // memory of it is skipped.
  stubOpenGroups({}, false);
  const t = await render(<DiveFormScreen mode="create" />);
  const header = findButton(t, 'People');
  if (!header) throw new Error('no People header found');
  await fireEvent.press(header);

  expect(expandedGroups(t).sort()).toEqual(['Gas & cylinders', 'People', 'Times & depth']);
  expect(mockSetOpenGroups).not.toHaveBeenCalled();
});

it('draws its groups without waiting for a memory that has not arrived', async () => {
  // The one place this screen deliberately does not follow M1f's waiting frame. A collapsed
  // group states nothing untrue about the dive — the fields are there, unexpanded — where every
  // case that frame exists for was a screen asserting something false. So the half that needs
  // no read at all is answered at once, and the remembered half lands when it lands.
  stubDives({ dives: [dive({ buddy: 'Petr' })] });
  stubOpenGroups({}, false);
  const t = await render(<DiveFormScreen mode="create" />);

  expect(findButton(t, 'People')).toBeDefined();
  // The two groups that start open are drawn open on this first frame too, rather than waiting
  // to be told whether the diver collapsed them — see the screen's own note on which of the two
  // one-frame corrections is the rarer one.
  expect(expandedGroups(t).sort()).toEqual(['Gas & cylinders', 'People', 'Times & depth']);
});

it('opens a remembered group when the memory arrives after the first render', async () => {
  stubOpenGroups(COLLAPSE_DEFAULT_OPEN, false);
  const t = await render(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t)).toEqual([]);

  stubOpenGroups({ ...COLLAPSE_DEFAULT_OPEN, notes: true });
  await t.rerender(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t)).toEqual(['Notes & rating']);
});

// The same arrival, in the direction only M1i can produce: the first frame draws *Times & depth*
// open because nothing is known, and the memory then says the diver collapsed it. A screen that
// read the memory as "the open ones" would leave it open for ever.
it('closes a group the arriving memory says the diver collapsed', async () => {
  stubOpenGroups({}, false);
  const t = await render(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t).sort()).toEqual(['Gas & cylinders', 'Times & depth']);

  stubOpenGroups({ times: false });
  await t.rerender(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t)).toEqual(['Gas & cylinders']);
});

it('never lets a late memory reopen a group the diver has closed', async () => {
  // The diver's own gesture outranks both rules, and it has to outrank them across a read that
  // answers afterwards — otherwise a group they shut springs open again for no visible reason.
  stubOpenGroups(COLLAPSE_DEFAULT_OPEN, false);
  const t = await render(<DiveFormScreen mode="create" />);
  const header = findButton(t, 'Notes & rating');
  if (!header) throw new Error('no Notes & rating header found');
  await fireEvent.press(header);
  await fireEvent.press(header);
  expect(expandedGroups(t)).toEqual([]);

  stubOpenGroups({ ...COLLAPSE_DEFAULT_OPEN, notes: true });
  await t.rerender(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t)).toEqual([]);
});

// --- §2.2's "open by default", and the three states it needs to be true (M1i) ---
//
// **The whole cross product, on what the screen SHOWS.** Three memory states — never decided,
// explicitly opened, explicitly collapsed — crossed with the two the value rule has, for one
// group that starts open and one that does not. Twelve cells, and the reason all twelve are here
// rather than the four that look interesting is that a table covering *most* of a cross product
// reads as complete: the pair that would have shipped this feature broken is (collapsed, no
// value) on a group that starts open, which is exactly the cell a "does it open by default"
// test and a "does a remembered group open" test both skip.
//
// Read as a design, the two rows that state something not otherwise written down:
//
// - **collapsed + no value on *Times & depth*** is the one M1i exists for. It was unreachable
//   before, because the memory could not hold a collapse.
// - **collapsed + a value** opens anyway, on either group. That is §2.2's settled union — "a
//   group opens when the diver opened it last time OR when this dive already has a value in it"
//   — deliberately not relitigated here, and it has a cost worth knowing: cylinders carry over,
//   so a collapse of *Gas & cylinders* will not survive to the next dive that carries one.
//
// Driven in edit mode so "has a value in it" is the dive's own stored value rather than
// carry-over's, and asserted per group rather than over the whole set, so each row says one
// thing about the group it names.
it.each([
  ['starts open', 'Times & depth', {}, false, true],
  ['starts open', 'Times & depth', {}, true, true],
  ['starts open', 'Times & depth', { times: true }, false, true],
  ['starts open', 'Times & depth', { times: true }, true, true],
  ['starts open', 'Times & depth', { times: false }, false, false],
  ['starts open', 'Times & depth', { times: false }, true, true],
  ['starts closed', 'People', {}, false, false],
  ['starts closed', 'People', {}, true, true],
  ['starts closed', 'People', { people: true }, false, true],
  ['starts closed', 'People', { people: true }, true, true],
  ['starts closed', 'People', { people: false }, false, false],
  ['starts closed', 'People', { people: false }, true, true],
] as [string, string, Record<string, boolean>, boolean, boolean][])(
  'a group that %s (%s), remembered as %p, with a value: %p — open: %p',
  async (_kind, title, remembered, hasValue, expected) => {
    // One value per group, chosen to be a field of THAT group and of no other: a max depth is
    // *Times & depth* and a buddy is *People*, so a row cannot pass because some third group
    // happened to open.
    const recorded: Partial<Dive> = hasValue
      ? title === 'People'
        ? { buddy: 'Petr' }
        : { maxDepthM: 18 }
      : {};
    stubOpenGroups(remembered);
    stubLogbookFor(dive({ id: 'target', ...recorded }));
    const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
    expect(expandedGroups(t).includes(title)).toBe(expected);
  },
);

// ...and the group really is open or shut, rather than a header announcing a state its body
// does not have. `expandedGroups` reads the announcement, which is the right thing for a screen
// reader and would pass over a body that never rendered — the failure `FormGroup`'s own test
// warns about, one level up.
it('draws the fields of the groups that start open, without a gesture and without a memory', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  expect(expandedGroups(t).sort()).toEqual(['Gas & cylinders', 'Times & depth']);
  for (const label of ['Max depth', 'Avg depth', 'Duration', 'Start pressure', 'End pressure']) {
    expect(findTextInput(t, label)).toBeDefined();
  }
  // The one field in those two groups that is a picker rather than a text input, so a query
  // for TextInputs cannot see it: `Time in` announces itself as `` `Time in: ${value}` ``.
  expect(findPickerField(t, 'Time in')).toBeDefined();
});

// The other end of the same gesture, end to end rather than through the stubbed memory: what a
// diver does to a default-open group reaches the row that has to remember it. Without the
// `false` this writes, the collapse would be undone by the very default it disagreed with.
it('writes a collapse of a group that starts open, so the next dive keeps it collapsed', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const header = findButton(t, 'Times & depth');
  if (!header) throw new Error('no Times & depth header found');
  await fireEvent.press(header);

  expect(expandedGroups(t)).toEqual(['Gas & cylinders']);
  expect(lastRemembered()).toEqual({ times: false });
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

  // **Every group, not one**, and that is a correction rather than thoroughness for its own
  // sake. This opened *Gas & cylinders* alone until M1h — which held no drawn graphic at all —
  // so the sweep passed vacuously on the day the form grew two: the visibility bars in
  // *Conditions* and the rating dots in *Notes & rating* are `View`s with real geometry, and
  // neither was ever in front of the guard. A sweep that samples one group is a sweep of
  // whatever that group happens to contain, which is the same hole the field sweep further
  // down was rewritten for.
  for (const id of FORM_GROUP_IDS) {
    await openGroup(t, FORM_GROUPS[id].title);
    expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
  }

  // **And every state of the carried treatment**, which the sweep above cannot reach for
  // exactly the reason it already records about groups: a form with no previous dive draws no
  // return mark, no clear control, no caption and no cleared tag, so the guard would have been
  // in front of none of them. M1h added four drawn or painted things to this screen at once and
  // a sweep that never seeds carry-over is a sweep of the half of the form that has none.
  stubDives({ dives: [FULLY_CARRIED()] });
  const carried = await render(<DiveFormScreen mode="create" />);
  for (const id of FORM_GROUP_IDS) await openGroup(carried, FORM_GROUPS[id].title);
  await openCylinder(carried);
  expect(unexpectedGraphics(carried, 'light')).toHaveLength(0);

  // ...and the third state, which is a `Text` the other two never draw.
  await pressClear(carried, 'Buddy');
  expect(unexpectedGraphics(carried, 'light')).toHaveLength(0);
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
  // (the save control's inverted ink, the option chips' own `surface`) for the classification
  // below to mean anything at all. It used to name the `carried ×` chip's `border` fill here
  // too; M1h's carried treatment paints nothing at all — a drawn mark and a drawn ring, both
  // tinted rather than filled — so that half of the sentence went with the chip.
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
  // Date, site and centre (§2.2, as M1i shrank it) — counted from the layout the screen itself
  // declares rather than from a 3 written here, so a field added to the strip is a row this test
  // expects rather than one it reports as a surprise. The literal beside it is what stops the
  // count from agreeing with an empty strip.
  expect(rows).toHaveLength(CORE_STRIP_FIELDS.length);
  expect(CORE_STRIP_FIELDS).toHaveLength(3);
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
  await openGroup(t, 'People');

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
  await openGroup(t, 'People');

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Petr');
});

it('drops the carried chip the moment the diver types over it', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');
  expect(findClearCarried(t, 'Buddy')).toBeDefined();

  await typeInto(t, 'Buddy', 'Jana');

  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Jana');
});

it('prefills and marks a carried cylinder field too, not just top-level ones', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', tanks: [tank({ sizeL: 12 })] })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
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
  // §0.6's carried treatment on the one field M1h added to `CARRIED_FIELDS`. Both halves in one
  // test because they were two different props on one call site — one put the mark there and
  // the other took it away — and either could be left off alone. The neighbouring `weightsKg`
  // had both since M1d; this one arrived without them being pinned, which is the per-call-site
  // prop hole the carried sweep further up now closes for every field at once, and the reason
  // M1h bundled the four into a single `carryOver` prop that cannot be passed by halves.
  stubDives({ dives: [dive({ date: '2026-08-10', suitThicknessMm: 5 })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Equipment');

  expect(findTextInput(t, 'Suit thickness')?.props?.value).toBe('5');
  expect(findClearCarried(t, 'Suit thickness')).toBeDefined();

  await typeInto(t, 'Suit thickness', '7');
  expect(findClearCarried(t, 'Suit thickness')).toBeUndefined();
  expect(findTextInput(t, 'Suit thickness')?.props?.value).toBe('7');
});

// --- §0.6, M1h: three states, and the one the form knew and never showed ---
//
// "Nothing was carried here" and "I threw it away" were the same empty row until this
// milestone, so a diver who deliberately discarded a carried buddy could not tell that from
// the form simply not having one. Every test in this section renders more than one state at
// once, because the rule is a DISTINCTION: a screen that marked everything satisfies "a
// carried field is marked", one that marked nothing satisfies "a fresh field is not", and a
// screen with no cleared state at all satisfies both.

/** What the `— cleared` tag reads on screen, spelled here rather than imported from the
 * component that draws it — this file's witness tables are deliberately not derived from the
 * things they witness, and a tag read back off its own constant would agree with any rewording
 * of it. */
const CLEARED_ROW = '— cleared';

/**
 * **Which rows are saying they were cleared, by label.** Not a count: a count answers "how
 * many tags are on screen" and the failure this section exists to prevent is a tag on the
 * WRONG row, which a count cannot see at all. Reading the label back off the row the tag is
 * actually inside is what makes these tests about placement rather than about arithmetic.
 *
 * Every field on this form is one `formField` (§0.6's "a field is a row, not a box"), so the
 * row is the unit, and its first `Text` child is its label — the same structure `FormField`,
 * `OptionChips` and `DateTimeField` all share.
 */
function clearedRowLabels(t: RenderResult): string[] {
  const styles = makeStyles('light');
  const rows = t.root ? t.root.queryAll((n) => wears(n, styles.formField)) : [];
  return rows
    .filter((row) => row.queryAll((n) => n.type === 'Text').some((n) => String(n.children[0] ?? '') === CLEARED_ROW))
    .map((row) => String(row.queryAll((n) => n.type === 'Text')[0]?.children[0] ?? ''));
}

/** How many rows are saying it — read off the placement above, so the two can never disagree
 * about what "one cleared row" means. */
function clearedRows(t: RenderResult): number {
  return clearedRowLabels(t).length;
}

/** Presses one field's clear control, by the label `FormField`/`OptionChips` give it. */
async function pressClear(t: RenderResult, label: string) {
  const clear = findClearCarried(t, label);
  if (!clear) throw new Error(`${label} was not marked carried to begin with`);
  await fireEvent.press(clear);
}

it('reads three different ways: never carried, carried, and cleared', async () => {
  // One previous dive, one field filled and one left empty — so the same render holds a
  // carried row and a never-carried one, and clearing turns the first into the third.
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr', guide: null })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');

  expect(findClearCarried(t, 'Buddy')).toBeDefined();
  expect(findClearCarried(t, 'Guide')).toBeUndefined();
  expect(clearedRows(t)).toBe(0);

  await pressClear(t, 'Buddy');

  // The third state: the row says so — and it is BUDDY's row that says it, which is the half a
  // count cannot see. A tag drawn on the wrong row, or on every empty row, reads as three
  // states and is not.
  expect(clearedRowLabels(t)).toEqual(['Buddy']);
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('');
  // ...and Guide, which was never carried, is still saying nothing at all — which is what
  // makes the cleared row a distinction rather than a decoration. Both rows are empty and
  // exactly one of them explains why.
  expect(findTextInput(t, 'Guide')?.props?.value).toBe('');
  expect(clearedRows(t)).toBe(1);
});

// The other gesture that empties a carried field, and it must NOT leave the tag: a diver who
// types over a carried value and then deletes what they typed has not thrown anything away —
// they have been editing. Only the clear control says "this was not mine".
it('leaves no cleared tag behind when the diver empties a field by typing', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');

  await typeInto(t, 'Buddy', 'Jana');
  await typeInto(t, 'Buddy', '');

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('');
  expect(clearedRows(t)).toBe(0);
});

// And the reverse, which is the direction a stale flag would fail in: clear a field, change
// your mind, type. The tag describes a blank, and the blank is gone.
it('takes the cleared tag back off the moment the diver types a value into that row', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');

  await pressClear(t, 'Buddy');
  expect(clearedRows(t)).toBe(1);

  await typeInto(t, 'Buddy', 'Jana');
  expect(clearedRows(t)).toBe(0);
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('Jana');
});

// **Clear, change your mind, type, change it back** — the one sequence that can put the tag
// back over a row the diver has since taken ownership of, and the one the component's own
// value guard cannot catch, because by then the row really is empty again.
//
// Found by mutation: deleting the `else cleared.delete(name)` half of the screen's own
// `noteTouched` left the whole suite green, because every other test that types after clearing
// leaves a value in the box, and `FormField` refuses to draw the tag over a value whatever the
// screen's state says. The two guards are on opposite sides of the boundary on purpose, and
// this is the case where only the screen's half is doing anything.
//
// The rule it defends: the tag is what the CLEAR CONTROL left behind. A diver who typed a name
// and then deleted it emptied the row themselves, and a row claiming they discarded a carried
// value would be describing a gesture they did not make.
it('does not put the cleared tag back when the diver empties a row they had typed into', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');

  await pressClear(t, 'Buddy');
  expect(clearedRows(t)).toBe(1);
  await typeInto(t, 'Buddy', 'Jana');
  await typeInto(t, 'Buddy', '');

  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('');
  expect(clearedRows(t)).toBe(0);
});

// **The cleared state survives a reseed**, which is the half `keepDirtyValues` makes necessary
// rather than optional: that option keeps the EMPTIED VALUE across the re-sync, so a form that
// re-derived its marks and forgot the gesture would show the blank and lose the sentence
// explaining it — the exact state this treatment exists to end, arrived at through a race.
//
// The reseed is driven the way the device drives it: `useDives()` starts empty and resolves a
// frame later, and here it resolves again from a DIFFERENT source dive, which is what actually
// re-runs `seedStateFor`.
it('keeps the cleared row through a reseed, tag and blank together', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr', guide: 'Ondra' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'People');
  await pressClear(t, 'Buddy');

  stubDives({ dives: [dive({ id: 'later', date: '2026-08-11', buddy: 'Petr', guide: 'Ondra' })] });
  await t.rerender(<DiveFormScreen mode="create" />);

  expect(clearedRows(t)).toBe(1);
  expect(findTextInput(t, 'Buddy')?.props?.value).toBe('');
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();
  // Guide is the control: the reseed really did run and really did re-mark the field the diver
  // never touched, so the assertion above is about the gesture surviving rather than about
  // nothing having happened.
  expect(findClearCarried(t, 'Guide')).toBeDefined();
});

// --- What a cleared field WRITES, which no assertion about a row can see ---
//
// DESIGN.md §1 and §10: "the `×` clears the field to a real blank, never a zero". That stopped
// being theoretical the moment M1h gave `0` a chip of its own — a dive genuinely logged with no
// weight records `weightsKg: 0`, and a diver who threw the carried figure away records nothing
// at all, and the two are the same falsy number to anything that reads them carelessly. One
// voids nothing; the other reaches `derived.ts` as *contradictory* data and takes the dive's
// whole gas figure with it.
//
// Driven through the real control and read off the real `createDive` call, because a test that
// set the value with `setValue` would bypass the control entirely and prove nothing about the
// gesture — which cost this milestone a round already.
it('writes a cleared field as null, not as the zero it was carrying', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-10', weightsKg: 0 })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Equipment');

  // The state the whole distinction rests on: a real, recorded 0 that carried forward.
  expect(findTextInput(t, 'Weights')?.props?.value).toBe('0');
  await pressClear(t, 'Weights');

  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  const written = mockCreate.mock.calls[0]?.[1] as Record<string, unknown>;
  // A create-mode write OMITS an unrecorded field rather than naming it `null` —
  // `toNewDiveInput`'s own `value !== null` gate — and `createDive` stores the column's own
  // null for a key it was not given. So "cleared" reaches the repository as an absent key.
  expect(written.weightsKg).toBeUndefined();
  // The half §10 actually writes down, stated separately because it is the failure and the
  // line above is only its absence: **never a zero.** `zeroPaths` walks the whole payload, so
  // a 0 that arrived somewhere else in it — inside the cylinder, say — fails here too.
  expect(written.weightsKg).not.toBe(0);
  expect(zeroPaths(written)).toEqual([]);
});

it('writes a carried zero the diver left alone as the zero it is', async () => {
  // The control for the test above, and it is not a formality: "write null whenever the field
  // looks falsy" passes that test and destroys this one — a dive logged with no weight at all
  // would silently stop recording that it had none.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-10', weightsKg: 0 })] });
  const t = await render(<DiveFormScreen mode="create" />);

  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect((mockCreate.mock.calls[0]?.[1] as Record<string, unknown>).weightsKg).toBe(0);
});

// --- Chip groups: one clear for the whole group ---

// The sheet's own instruction, and the two gestures that empty a chip row have to stay
// distinguishable: pressing the selected chip is the diver CHOOSING (a deselection), pressing
// the ring is the diver saying the value was never theirs. Only the second leaves the tag.
it('clears a carried chip group from its label row, and a deselection does not', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', entry: 'shore', salinity: 'salt' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Conditions');

  expect(findClearCarried(t, 'Entry')).toBeDefined();
  expect(findClearCarried(t, 'Salinity')).toBeDefined();
  // Fresh chip rows are untouched by any of this — `weather` and the three 0–3 scales are in
  // §2.1's fresh half, so there is nothing on them to carry or to clear.
  expect(findClearCarried(t, 'Weather')).toBeUndefined();
  expect(findClearCarried(t, 'Waves')).toBeUndefined();

  // Deselecting: the mark goes, because choosing is overwriting (§0.6), and no tag is left.
  await pressChip(t, 'Salinity', SALINITY_VALUES.indexOf('salt'));
  expect(findClearCarried(t, 'Salinity')).toBeUndefined();
  expect(clearedRows(t)).toBe(0);

  // Clearing: the mark goes and the row says why.
  await pressClear(t, 'Entry');
  expect(findClearCarried(t, 'Entry')).toBeUndefined();
  expect(clearedRows(t)).toBe(1);
});

it('writes a cleared chip group as null', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  stubDives({ dives: [dive({ date: '2026-08-10', entry: 'shore' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Conditions');
  await pressClear(t, 'Entry');

  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  const written = mockCreate.mock.calls[0]?.[1] as Record<string, unknown>;
  // Absent, for the reason the weights test above states: a create-mode write omits what was
  // not recorded. What must never happen is the value surviving the clear — the diver threw
  // *shore* away, and a dive that still says `entry: 'shore'` is the same silent wrong value
  // a stale carried figure would be.
  expect(written.entry).toBeUndefined();
  expect(written.entry).not.toBe('shore');
});

// --- Every field §2.1 carries, and only those ---

/**
 * **Which rows wear the carried treatment, and what each one is called on screen** — written
 * out, and deliberately not derived from the screen.
 *
 * The same kind of independent witness `FIELD_LABELS` and `CHIP_MARKS` above are, and after
 * the same failure: `suitThicknessMm` shipped in M1h able to SHOW a carried mark and unable to
 * drop it, because one of the two props it needed was missing at its call site and every
 * assertion about the marks was written per field rather than swept. A per-call-site prop is
 * invisible from any test that does not ask about that call site.
 *
 * The membership below is checked against `CARRIED_FIELDS` (domain/carryOver.ts, §2.1's own
 * owner) rather than against the screen, and the labels are checked against the screen. The two
 * can only agree by both being right.
 */
const CARRIED_ROWS: Record<string, { label: string; group?: FormGroupId; cylinder?: true }> = {
  siteName: { label: 'Site' },
  centerName: { label: 'Centre' },
  entry: { label: 'Entry', group: 'conditions' },
  salinity: { label: 'Salinity', group: 'conditions' },
  waterBody: { label: 'Water body', group: 'conditions' },
  'tanks.0.material': { label: 'Material', group: 'gas', cylinder: true },
  'tanks.0.sizeL': { label: 'Size', group: 'gas', cylinder: true },
  'tanks.0.configuration': { label: 'Configuration', group: 'gas', cylinder: true },
  'tanks.0.workingBar': { label: 'Working pressure', group: 'gas', cylinder: true },
  'tanks.0.o2Pct': { label: O2_LABEL, group: 'gas' },
  'tanks.0.hePct': { label: HE_LABEL, group: 'gas' },
  suit: { label: 'Suit', group: 'equipment' },
  suitThicknessMm: { label: 'Suit thickness', group: 'equipment' },
  weightsKg: { label: 'Weights', group: 'equipment' },
  buddy: { label: 'Buddy', group: 'people' },
  guide: { label: 'Guide', group: 'people' },
};

/**
 * The three carried fields that deliberately have no row of their own to wear the treatment,
 * each for a different reason — named here so "every carried field is covered" stays a
 * checkable claim rather than one with a silent exception.
 *
 * `siteId`/`centerId` are §6's half of the site snapshot: written by picking a suggestion,
 * never typed, so there is no row and nothing to clear (`computeCarriedPaths` marks them all
 * the same, and nothing reads that mark). `equipment` is a token set rendered as five Yes/No
 * rows, so there is no single row for one mark and one clear to sit on — and `[]` is a real
 * carried answer meaning "no accessories", which a clear control could not distinguish itself
 * from. That is a known gap rather than an oversight: M1h's own note on
 * `ControlledEquipmentField` says the honest wording for that control's own state is still
 * outstanding.
 */
const CARRIED_WITHOUT_A_ROW = ['siteId', 'centerId', 'equipment'];

/** A previous dive that filled every carried field there is, so one render can be asked about
 * all of them. The two pressures are set and must NOT carry — `withoutPressures` strips them
 * (§2.1), which is what keeps them out of the table above. */
const FULLY_CARRIED = () =>
  dive({
    date: '2026-08-10',
    siteName: 'Nautica Vis', centerName: 'Nautica',
    entry: 'shore', salinity: 'salt', waterBody: 'ocean',
    // `hePct` explicitly, where `tank()`'s own default leaves it null: it is a carried field
    // like the rest, and a fixture that left it empty would sweep past its row reporting
    // "not carried" as a pass.
    tanks: [tank({ hePct: 20 })],
    suit: 'wet', suitThicknessMm: 5, equipment: ['hood'], weightsKg: 6,
    buddy: 'Petr', guide: 'Ondra',
  });

it('has a carried row for every field §2.1 carries, and names the three that have none', () => {
  const expected = [
    ...CARRIED_FIELDS.filter((field) => field !== 'tanks' && !CARRIED_WITHOUT_A_ROW.includes(field)),
    // `tanks` carries only most of itself: `withoutPressures` blanks the two pressures on the
    // way over, so a cylinder's start and end can never be carried and can never be cleared.
    ...TANK_FIELDS.filter((field) => !(TANK_PRESSURE_FIELDS as readonly string[]).includes(field)).map(
      (field) => `tanks.0.${field}`,
    ),
  ];
  expect(Object.keys(CARRIED_ROWS).sort()).toEqual(expected.sort());
  // Exact, distinct labels, so `Suit` cannot match `Suit thickness` in the sweep below.
  expect(new Set(Object.values(CARRIED_ROWS).map((row) => row.label)).size).toBe(expected.length);

  // The screen keeps its own copy of the three, for a different job — deciding whether the
  // carried caption has anything left to explain — and a fourth name added there would switch
  // that line off for a dive whose only carried field is the one just exempted, silently. The
  // list above is pinned against what the screen RENDERS by the sweep below, so comparing the
  // two transfers that pinning to the screen's copy rather than letting either agree with
  // itself.
  expect([...CARRIED_WITHOUT_A_MARK].sort()).toEqual([...CARRIED_WITHOUT_A_ROW].sort());
});

it.each(Object.entries(CARRIED_ROWS))(
  'offers the carried treatment on %s, and only when that field carried something',
  async (_field, { label, group, cylinder }) => {
    const reveal = async (t: RenderResult) => {
      if (group !== undefined) await openGroup(t, FORM_GROUPS[group].title);
      if (cylinder === true) await openCylinder(t);
    };

    // Carried: the row offers a way to throw the value away.
    stubDives({ dives: [FULLY_CARRIED()] });
    const carried = await render(<DiveFormScreen mode="create" />);
    await reveal(carried);
    expect(findClearCarried(carried, label)).toBeDefined();

    // Not carried: the same row, from a previous dive that recorded nothing, offers none. The
    // pair is the assertion — a screen that put a clear control on every row would pass the
    // first half alone, and it would be offering to clear values the diver typed themselves.
    stubDives({ dives: [dive({ date: '2026-08-10' })] });
    const fresh = await render(<DiveFormScreen mode="create" />);
    await reveal(fresh);
    expect(findClearCarried(fresh, label)).toBeUndefined();
  },
);

// **Both halves of the treatment, on every carried row at once** — the assertion the per-field
// sweep above structurally cannot make.
//
// That sweep asks `findClearCarried`, which finds the RING. Deleting the return mark from
// `OptionChips` therefore left the whole 1646-test suite green: six carried chip rows lost the
// sheet's mark and every test still passed, because no test on this screen ever counted a mark
// that was not inside a chip. `CHIP_MARKS` above counts marks inside chips; this counts the
// ones beside labels.
//
// Read off `formFieldCarryState`, the one slot both components put the pair in, so the count is
// per ROW rather than per screen: a form drawing thirty-two marks in sixteen slots and a form
// drawing them all in one are the same number and not the same form.
it('gives every carried row both halves of the treatment, and nothing a fresh row', async () => {
  stubDives({ dives: [FULLY_CARRIED()] });
  const t = await render(<DiveFormScreen mode="create" />);
  for (const id of FORM_GROUP_IDS) await openGroup(t, FORM_GROUPS[id].title);
  await openCylinder(t);

  const styles = makeStyles('light');
  const slots = t.root ? t.root.queryAll((n) => wears(n, styles.formFieldCarryState)) : [];
  // Exactly the rows `CARRIED_ROWS` names — which is itself checked against `CARRIED_FIELDS`
  // above, so this is the §2.1 rule arriving on screen rather than a number typed twice.
  expect(slots).toHaveLength(Object.keys(CARRIED_ROWS).length);
  for (const slot of slots) {
    expect(symbolsInside(slot).map((n) => n.props.name)).toEqual(['return', 'xmark.circle']);
  }

  // The control: a previous dive that recorded nothing draws no slot at all, so "both halves
  // everywhere" cannot be satisfied by drawing them unconditionally.
  stubDives({ dives: [dive({ date: '2026-08-10' })] });
  const fresh = await render(<DiveFormScreen mode="create" />);
  for (const id of FORM_GROUP_IDS) await openGroup(fresh, FORM_GROUPS[id].title);
  expect(fresh.root ? fresh.root.queryAll((n) => wears(n, styles.formFieldCarryState)) : []).toHaveLength(0);
});

// --- The header line that names the mark ---
//
// §0.6's carried caption: `↵ Carried from #127 — clear any of them`. It is the mark's legend,
// which is what earns it a row at all (§0.6's standing test is that a symbol needing a legend
// has already failed, and stating the legend in the same view as the marks is the difference
// between a caption and a thing to memorise).

/** What the caption currently reads, or `undefined` when the form is not drawing one. */
function captionIn(t: RenderResult): string | undefined {
  return textIn(t).find((s) => s.startsWith('Carried from '));
}

it('names the dive its carried values came from, by number', async () => {
  const previous = dive({ id: 'previous', date: '2026-08-10', buddy: 'Petr' });
  stubDives({ dives: [previous], numbers: new Map([[previous.id, 127]]) });
  const t = await render(<DiveFormScreen mode="create" />);
  expect(captionIn(t)).toBe('Carried from #127 — clear any of them');
});

// **The caption draws the mark it names.** Deleting `<CarriedMark size={12} />` from that row
// left the whole suite green, because `captionIn()` matches on the sentence alone — and the
// mark is the load-bearing half of the line's whole justification: §0.6's standing test is that
// a symbol needing a legend has already failed, and this caption is what keeps a bare `↵` from
// being that symbol. A legend that has silently lost the symbol it names is a sentence about
// nothing.
//
// The size is asserted too, and it is not decoration: 12 against the row's mono 11 is the same
// "a shade larger than the text beside it" relationship the mark has at 16 beside a 15 px
// label, and a caption drawing the field-row size would put the loudest object on the form in
// its quietest line.
it('draws the mark its own sentence names, at the size that line takes', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  const styles = makeStyles('light');
  const note = (t.root ? t.root.queryAll((n) => wears(n, styles.formCarriedNote)) : [])[0];
  if (!note) throw new Error('no carried caption found');

  const marks = symbolsInside(note);
  expect(marks).toHaveLength(1);
  expect(marks[0]?.props.name).toBe('return');
  expect(marks[0]?.props.size).toBe(12);
});

it('names the dive some other way rather than saying #undefined', async () => {
  // `numbers` lands from a settings read that resolves independently of the dives themselves
  // (useDives.ts), so for a render or two the map can be empty while carry-over has already
  // filled the form. A caption reading `#undefined` would be worse than not naming the dive,
  // and dropping the line for those renders would flicker the legend out from under the marks
  // it explains.
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  expect(captionIn(t)).toBe('Carried from your last dive — clear any of them');
});

it('says nothing about carry-over where there is none to explain', async () => {
  // A first-ever dive, an edit, and a form whose every mark the diver has dealt with: three
  // different reasons for an empty `paths`, and the legend has nothing to legend in any of
  // them. The third is the one a `mode === 'create'` check alone would miss.
  const empty = await render(<DiveFormScreen mode="create" />);
  expect(captionIn(empty)).toBeUndefined();

  stubDives({ dives: [dive({ id: 'target', date: '2026-08-10', buddy: 'Petr' })] });
  const editing = await render(<DiveFormScreen mode="edit" diveId="target" />);
  expect(captionIn(editing)).toBeUndefined();

  const cleared = await render(<DiveFormScreen mode="create" />);
  await openGroup(cleared, 'People');
  expect(captionIn(cleared)).toBeDefined();
  await pressClear(cleared, 'Buddy');
  expect(captionIn(cleared)).toBeUndefined();
});

// The line is a CAPTION, not a control — §0.6 records a different affordance in the same
// corner ("the form header's 'from #6' is tappable and starts the dive blank") which has never
// been built, and the two are opposite defects: a caption that silently wipes a form, or a
// control that reads as a label. Pinned because "make the line tappable" is the obvious next
// edit and it is the wrong one.
it('is a caption and not a control, so reading it cannot blank the form', async () => {
  stubDives({ dives: [dive({ date: '2026-08-10', buddy: 'Petr' })] });
  const t = await render(<DiveFormScreen mode="create" />);
  const caption = textNodesOf(t).find((n) => String(n.children[0] ?? '').startsWith('Carried from '));
  expect(caption).toBeDefined();
  expect(caption?.props?.accessibilityRole).toBeUndefined();
  expect(caption?.props?.onPress).toBeUndefined();
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
  //
  // Wrapped in `act` rather than left bare, which is a change of bookkeeping and not of what
  // this test does: the press is still un-awaited and the overlap is still real, but the
  // renders it schedules while the write hangs are now inside a scope React knows about. Bare,
  // every one of them was reported as "an update ... was not wrapped in act(...)", and §2.2's
  // eight-field core strip made that louder rather than introducing it — `timeIn` and the two
  // pressures are permanently mounted `Controller`s now, where they used to sit inside a
  // collapsed group, so each save notified three more subscribers from outside the scope.
  let first!: Promise<unknown>;
  await act(async () => {
    first = fireEvent.press(findSaveControl(t)!) as unknown as Promise<unknown>;
    // The second tap in the SAME frame, before React has re-rendered the control as disabled
    // — which is what a double-tap actually is, and what leaves the re-entrancy latch as the
    // only thing that can turn it away. Dispatched even a tick later and the `disabled` prop
    // alone would swallow it, and this test would pass with the latch deleted.
    tapSaveAgain(t);
    await settle();
  });

  // Recorded before the write is released, so this is genuinely "while in flight" and not
  // "after the latch had already let go".
  const writesInFlight = mockCreate.mock.calls.length;

  await act(async () => {
    releaseWrite();
    await first;
  });

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
  // `act` for the same bookkeeping reason the double-tap test above records: the press is held
  // open on purpose, and the renders it schedules meanwhile belong inside a scope.
  let press!: Promise<unknown>;
  await act(async () => {
    press = fireEvent.press(findSaveControl(t)!) as unknown as Promise<unknown>;
    await settle();
  });
  await waitFor(() => expect(findSaveControl(t)?.props?.accessibilityState?.disabled).toBe(true));

  await act(async () => {
    releaseWrite();
    await press;
  });
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
  await openGroup(t, 'People');
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
  await openGroup(t, 'People');
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
type WrittenTank = {
  sizeL?: number | null;
  configuration?: string | null;
  startBar?: number | null;
  endBar?: number | null;
};

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
    // The three 0–3 scales, which M1h turned from `0-3` text boxes into chip rows. They share
    // one vocabulary because the levels are one fact; what differs is the words, which
    // display.ts owns and this table deliberately does not pin.
    ['Waves', 'Conditions', CONDITION_SCALE_VALUES],
    ['Current', 'Conditions', CONDITION_SCALE_VALUES],
    ['Surge', 'Conditions', CONDITION_SCALE_VALUES],
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

  /**
   * **Which formatter each scale reads its words from** — the one thing the sweep above
   * deliberately does not pin, and until this round the one thing nothing else pinned either.
   *
   * The three 0–3 rows share a single vocabulary, so every count-and-membership assertion in
   * this file passes with all three wired to the same words. Measured, at 1553 green:
   * repointing Waves' `displayLabel` at `formatCurrent` put *None · Light · Medium · Strong*
   * over the sea state; repointing Surge's put *Light* where the design says *Some*; and
   * `displayLabel={(level) => String(level)}` put the bare digits `0 1 2 3` back on the chips
   * — the owner's original complaint about this form, restored in silence. §4.1's opening
   * example is `Steel`/`steel` one screen apart; this is the same drift one row apart.
   *
   * **Asserted through the formatters, not against words typed here.** `format/display.ts`
   * owns "every conversion of a stored value into diver-facing text" (§4.1) and
   * `display.test.ts` pins what each of the three actually says; what this file owns is
   * which one each row *asks*, which is a fact about the screen. The two halves together are
   * the chain, and neither alone is worth anything: a formatter nothing calls is dead code,
   * and a row calling the wrong one is a lie a passing suite would keep.
   */
  it.each([
    ['Waves', formatWaves],
    ['Current', formatCurrent],
    ['Surge', formatSurge],
  ] as [string, (level: number) => string | null][])(
    'reads the %s chips through the formatter that scale owns',
    async (label, format) => {
      const t = await render(<DiveFormScreen mode="create" />);
      await openGroup(t, 'Conditions');
      expect(chipsFor(t, label)).toEqual(CONDITION_SCALE_VALUES.map((level) => format(level)));
    },
  );

  // ...and the three formatters are actually three, which is what makes the assertion above
  // able to fail. Two scales that happened to agree word for word would let either be wired
  // to the other with everything green — and the words genuinely do overlap (level 2 is
  // *Medium* on all three, level 3 *Strong* on two), so this is a live condition and not a
  // ceremonial one.
  it('is asserting against three distinguishable vocabularies, not three copies of one', () => {
    const said = [formatWaves, formatCurrent, formatSurge].map((format) =>
      CONDITION_SCALE_VALUES.map((level) => format(level)).join('·'),
    );
    expect(new Set(said).size).toBe(said.length);
  });
});

// --- §0.6: "An icon appears only where the value has one" ---

/** The SF Symbols drawn inside one chip. Same `SymbolModule` host-node match
 * SearchCapsule.test.tsx and EntryIcon.test.tsx use — see either for why that name, and not
 * "some icon-shaped element", is what tells a real SF Symbol from a drawn approximation. */
function symbolsInside(node: TestNode | undefined) {
  return node ? node.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
}

/** Every drawn mark inside one control, of either kind this form still uses: a real SF Symbol,
 * or a rating dot. One counter rather than two, because the question the witness below asks is
 * "how many marks does this option carry" and the mechanism is exactly what must not be pinned —
 * a mark that changed from a symbol to a drawn shape would still be the same claim to a diver.
 * (It counted a third kind, the visibility bars, until M1i took the scale marks out; a drawn
 * mark that comes back off §9's shelf will need an arm here again.) */
function marksInside(node: TestNode | undefined) {
  if (!node) return [];
  const sheet = makeStyles('light');
  return node.queryAll((n) => {
    if (typeof n.type === 'string' && n.type.includes('SymbolModule')) return true;
    if (n.type !== 'View') return false;
    const worn = [n.props?.style].flat(3);
    return worn.includes(sheet.ratingDot) || worn.includes(sheet.ratingDotField);
  });
}

/**
 * **How many marks each option of each control carries — written out, and deliberately not
 * derived from the screen or from the mark components.**
 *
 * The same kind of independent witness `FIELD_LABELS` above is, for the same reason and after
 * the same failure. An assertion built FROM the thing it checks stays perfectly self-consistent
 * while that thing is wrong — `EntryIcon.test.tsx` asks the component what it drew and cannot
 * see the *form* wiring it to Salinity. This table says what the SCREEN shows, so the two can
 * only agree by both being right.
 *
 * It is also the only place that states §0.6's boundary as a whole. The rule is a boundary and
 * either half alone is satisfiable by the wrong implementation: a mark on every chip passes
 * "shore has one", and a mark on none passes "salinity has none". The version of this test
 * before M1h checked four fields and claimed "no other chip anywhere" — which was true when it
 * was written and silently stopped being true the moment four more rows grew marks, because
 * those four were simply not in its list. Every option control on the form is a row here now,
 * and the sweep below keeps it that way.
 *
 * Read the numbers as the design:
 *
 * - **Entry** — *shore* and *boat* have one, *other* has none. §0.6 names all three, and after
 *   M1i they are the only marked chips on the form: "*Shore* and *boat* pass trivially."
 * - **Every other row is zero, and that is now one decision rather than twelve.** M1h gave the
 *   scales marks that encoded themselves — visibility bars counting up, current and surge
 *   arrows accumulating, a sky per weather — and §10 records the owner taking them out again:
 *   they passed §0.6's no-legend test and still cost *Current* and *Surge* a wrapped second
 *   line, and made *Visibility low* read as a word with a full stop in front of it. §9's shelf
 *   holds what replaces them, and it is a drawn set for this app rather than a mark per row.
 *   **If a future change gives one of these rows a mark, this table is what fails** — which is
 *   the point: it should cost a deliberate edit here, not a silent arrival.
 * - **Rating** — one drawn dot per target, which is §0.6's "drawn, not typed" for the one
 *   control whose marks *are* the control.
 */
const CHIP_MARKS: [string, string, number[]][] = [
  ['Entry', 'Conditions', [1, 1, 0]],
  ['Salinity', 'Conditions', [0, 0]],
  ['Water body', 'Conditions', [0, 0, 0, 0, 0, 0]],
  ['Visibility', 'Conditions', [0, 0, 0]],
  ['Waves', 'Conditions', [0, 0, 0, 0]],
  ['Current', 'Conditions', [0, 0, 0, 0]],
  ['Surge', 'Conditions', [0, 0, 0, 0]],
  ['Weather', 'Conditions', [0, 0, 0, 0, 0, 0]],
  ['Suit', 'Equipment', [0, 0, 0, 0, 0]],
  ['Weighting', 'Equipment', [0, 0, 0]],
  ['Material', 'Gas & cylinders', [0, 0]],
  ['Configuration', 'Gas & cylinders', [0, 0, 0]],
  ['Rating', 'Notes & rating', [1, 1, 1, 1, 1]],
];

it.each(CHIP_MARKS)('draws the marks §0.6 gives %s, and no others', async (label, group, marks) => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, group);
  const counts = marks.map((_, index) => marksInside(findChip(t, label, index)).length);
  expect(counts).toEqual(marks);
});

// Keeps the witness honest in the other direction, exactly as the `FIELD_LABELS` sweep does:
// a control added to this form has to get a row above, or the table would silently stop being
// a statement about the whole form and quietly become a statement about twelve of its
// controls. Derived from what actually announces itself on screen, with every group open.
it('has a marks row for every option control on the form, and none for a control that is not there', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  for (const id of FORM_GROUP_IDS) await openGroup(t, FORM_GROUPS[id].title);

  // **What makes a control one of these is that it can be *chosen*** — `accessibilityState
  // .selected` — not that its label happens to contain a colon. `Date`, `Time in` and
  // `Cylinder` all announce `` `${label}: ${value}` `` too and are not options at all: the
  // first two open a picker over the row and the third discloses rows beneath it (§0.6's
  // chevron rule draws exactly that distinction). Filtering on the label's shape would have
  // dragged all three in, which is how this check ends up loosened until it says nothing.
  const announced = new Set(
    buttonsOf(t)
      .filter((n) => n.props?.accessibilityState?.selected !== undefined)
      .map((n) => String(n.props?.accessibilityLabel ?? ''))
      .filter((label) => label.includes(': '))
      .map((label) => label.slice(0, label.indexOf(': '))),
  );
  // The status control and the five accessory toggles announce differently again — they are
  // `switch`es carrying `checked`, and the status one announces the QUESTION rather than a
  // `label: value` pair (see its own docblock) — so neither is one of these.
  expect([...announced].sort()).toEqual(CHIP_MARKS.map(([label]) => label).sort());

  // ...and each row's length is the number of options that control actually offers, so a
  // vocabulary that grew a member cannot leave the last chip unwitnessed.
  for (const [label, , marks] of CHIP_MARKS) {
    const offered = buttonsOf(t).filter(
      (n) =>
        n.props?.accessibilityState?.selected !== undefined &&
        String(n.props?.accessibilityLabel ?? '').startsWith(`${label}: `),
    );
    expect(offered).toHaveLength(marks.length);
  }
});

// M1h's `REPEATED_MARK_SYMBOLS` witness stood here — which symbol *Current* and *Surge* each
// repeated, by name, because `CHIP_MARKS` counts nodes and their counts were identical, so it
// was satisfied by the two rows being swapped. It went out with the marks (M1i, §10), and its
// completeness half — "name the symbol of every row that repeats one" — went with it rather
// than being left asserting that no row does: `CHIP_MARKS` above already fails on the first
// mark that comes back, which is the same guard without a table standing over an empty subject.

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

/** The table itself, named rather than inline, because a second sweep below is derived from
 * it — the one that taps the chip this one deliberately never taps. */
const CHIP_WRITES = [
  ['Entry', 'Conditions', 'entry', ENTRY_VALUES],
  ['Salinity', 'Conditions', 'salinity', SALINITY_VALUES],
  ['Water body', 'Conditions', 'waterBody', WATER_BODY_VALUES],
  ['Visibility', 'Conditions', 'visibility', VISIBILITY_VALUES],
  ['Weather', 'Conditions', 'weather', WEATHER_VALUES],
  // M1h's three, joining on the commit that adds them — which is the rule this table's own
  // header states and which four fields broke last time. Each could be repointed at another
  // column and stay green without a row here: tapping *Light* under Current would write
  // `waves: 1`, and `waves` is a bare number that nothing would refuse.
  ['Waves', 'Conditions', 'waves', CONDITION_SCALE_VALUES],
  ['Current', 'Conditions', 'current', CONDITION_SCALE_VALUES],
  ['Surge', 'Conditions', 'surge', CONDITION_SCALE_VALUES],
  ['Suit', 'Equipment', 'suit', SUIT_VALUES],
  ['Weighting', 'Equipment', 'weightsFeel', WEIGHTS_FEEL_VALUES],
] as const;

it.each(CHIP_WRITES)('saves the %s a diver picked, and clears it when they pick it again', async (label, group, field, values) => {
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

// --- The chip the sweep above never taps ---
//
// **That sweep is blind to level 0 by construction, and level 0 is M1h's new semantic.** It
// taps `values[1]` on purpose — "an `onChange` hard-wired to `options[0]` would pass against
// index 0" — so the one value in the app that is *falsy* is the one value it never writes.
// The answer is not to move its index, which would hand back the defect it was written for;
// it is this second tap.
//
// What it holds is one character in `toNewDiveInput` (domain/diveFormSchema.ts): the loop
// omits a field whose value is `null`, and narrowing that to `value !== null && value !== 0`
// left the entire suite green while a diver tapping *Flat* on Waves or *None* on Current
// saved their reading as "not recorded" — the chip lit, the note absent, the column empty.
// `diveFormSchema.test.ts` pins the same line at the domain boundary; this pins the path a
// thumb actually takes, which is the half that could still break with that boundary intact
// (`OptionChips` compares with `===` today, and `value || ''` anywhere between the chip and
// the form would swallow the same 0 with the domain test still green).
//
// Derived from the table above rather than listed again, so a vocabulary that grows a zero
// joins on the day it does rather than on the day someone remembers this sweep exists.
const ZERO_LEVEL_CHIP_WRITES = CHIP_WRITES.filter(([, , , values]) =>
  (values as readonly (string | number)[]).includes(0),
);

it('sweeps every chip vocabulary that has a level 0, and there is at least one', () => {
  // A filter that matched nothing would leave `it.each` below running against an empty table
  // — the vacuous-guard failure this file has already paid for twice (the marks witness, the
  // graphics sweep). The names are asserted rather than only the count, because the point is
  // *which* rows a diver can tap a falsy value on.
  expect(ZERO_LEVEL_CHIP_WRITES.map(([label]) => label)).toEqual(['Waves', 'Current', 'Surge']);
});

it.each(ZERO_LEVEL_CHIP_WRITES)(
  'saves the level 0 a diver picked on %s, which is a reading and not an absence',
  async (label, group, field, values) => {
    // *Flat* water and *no* current are readings. A diver who looked at the sea and saw
    // nothing moving recorded that, and it has to reach the column as `0` — not be dropped
    // because zero is falsy, and not be confused with the untouched field beside it.
    expect(values[0]).toBe(0);
    mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
    const t = await render(<DiveFormScreen mode="create" />);
    await openGroup(t, group);

    await pressChip(t, label, 0);
    expect(findChip(t, label, 0)?.props?.accessibilityState?.selected).toBe(true);
    await pressSave(t);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(writtenInput(0)[field]).toBe(0);
    // ...and it is the KEY that must be there: `undefined` is falsy too, so a written
    // payload missing the field entirely would satisfy a looser assertion and mean exactly
    // the failure this test exists for.
    expect(Object.keys(writtenInput(0))).toContain(field);
  },
);

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

// --- The rating, which is not a chip row (§0.6: "Rating marks are drawn, not typed") ---
//
// It reaches the write through `ControlledRatingField` rather than through
// `ControlledOptionField`, so none of the sweep above covers it: its `name` is a per-call-site
// prop like every other, and wired at `waves` it would save a rating into the sea state with
// nothing red. That is the same hole the sweep's own header describes, one control over.

/** One rating dot's tap target, by the level it sets. Found by its announcement rather than by
 * position, because the announcement is the thing a screen reader user actually has, and a row
 * of five identical circles is exactly where "the third one" is not a usable handle. */
function findRatingDot(t: RenderResult, level: number) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === `Rating: ${level} of ${RATING_MAX}`);
}

async function pressRatingDot(t: RenderResult, level: number) {
  const dot = findRatingDot(t, level);
  if (!dot) throw new Error(`no rating dot for level ${level}`);
  await fireEvent.press(dot);
}

it('saves the rating a diver tapped, and clears it when they tap the same dot again', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Notes & rating');

  // Deliberately not the last dot: a control hard-wired to `RATING_MAX` would pass against 5
  // and be wrong for every other rating a diver can give.
  await pressRatingDot(t, 3);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(writtenInput(0).rating).toBe(3);

  // **There is deliberately no assertion here that the control wrote a NUMBER rather than the
  // string `'3'`, because no such assertion can exist**, and one was written and deleted
  // rather than left green. `optionalNumber` coerces `'3'` to `3` at the write boundary and
  // `toFormNumber` reads both back identically, so a control writing text would save the same
  // `3` and light the same dot — proven by mutation, which left `String(level)` passing every
  // test in this file. The reason the vocabulary is numeric is therefore a *compile-time* one
  // and `tsc` is what enforces it: a digit-string list would derive `'0' | '1' | '2' | '3'` as
  // the type of an integer column (see `domain/types.ts`). `types.test.ts` pins the half that
  // is checkable at runtime — that the levels really are whole ascending numbers.

  // The same "and unuse" §2.2 asks of every chip: `RatingField` hands back `''`,
  // `optionalNumber` turns that into `null`, and `toNewDiveInput` omits a null outright. A
  // rating that could only ever be set would leave a mis-tap permanent.
  await pressRatingDot(t, 3);
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(writtenInput(1)).not.toHaveProperty('rating');
});

it('fills the dots up to the rating and no further, and marks only the one that IS the rating', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Notes & rating');
  await pressRatingDot(t, 3);

  // Three filled circles are what "3" looks like...
  const sheet = makeStyles('light');
  const filled = RATING_VALUES.map((level) => {
    const dot = findRatingDot(t, level);
    const marks = dot ? dot.queryAll((n) => n.type === 'View' && [n.props?.style].flat(3).includes(sheet.ratingDotField)) : [];
    return marks.some((n) => [n.props?.style].flat(3).includes(sheet.ratingDotFilled));
  });
  expect(filled).toEqual([true, true, true, false, false]);

  // ...but only the third is the value, and a screen reader must not be told the diver picked
  // three ratings.
  const selected = RATING_VALUES.filter((level) => findRatingDot(t, level)?.props?.accessibilityState?.selected === true);
  expect(selected).toEqual([3]);
});

it('gives every dot its own 48 dp target, since each one is its own control', async () => {
  // §0.5: "Tap targets never below 48 dp." Per dot rather than per row, because tapping the
  // third dot means three — so the row being tall enough is not the same claim.
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Notes & rating');
  const sheet = makeStyles('light');
  for (const level of RATING_VALUES) {
    const worn = [findRatingDot(t, level)?.props?.style].flat(3);
    expect(worn).toContain(sheet.ratingTarget);
  }
  expect(sheet.ratingTarget.width).toBeGreaterThanOrEqual(48);
  expect(sheet.ratingTarget.height).toBeGreaterThanOrEqual(48);
});

// --- §10's "still owed", discharged: a stored value no chip can show ---

it('says out loud what a rating outside the scale actually is, since no dot can show it', async () => {
  // A dive holding 9 — from M2 sync, or typed into the text box this control replaced. Before
  // M1h it was simply visible in that box. With dots it matches nothing, so without a note the
  // row reads as "not rated" over a value that is recorded and about to be saved again.
  const target = dive({ id: 'target', date: '2026-08-16', rating: 9 });
  stubLogbookFor(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Notes & rating');

  const shown = textIn(t).join(' ');
  expect(shown).toContain('9');
  // **The schema's own sentence, asked for by calling it** — not a phrase of it copied here.
  // What this screen owes is that the note reaches the diver at all; what the note SAYS is
  // `diveFormSchema.ts`'s, and what can be checked about it is checked there against the rule
  // rather than against a spelling — that it names the number, and that it promises the value
  // is kept. Its third property, that it blames nobody, is only *approximated* there by a ban
  // on the words blame is usually written with; that test's own docblock says so and says what
  // slips past. Do not read this line as leaning on a guarantee that exists. Quoting a fragment
  // instead — this line read `toContain('saved as it is')` — made every rewording of that
  // sentence a failure on a screen test that has no opinion about the wording, which is half of
  // the defect this round is fixing.
  expect(shown).toContain(outOfScaleNote(RATING_VALUES, 9));
  // And NOT the sibling note's attribution: a 9 could have come from the diver's own keypad,
  // so blaming a newer version of Ponor would be a guess stated as a fact.
  expect(shown).not.toContain('newer version');
});

it('says the same for a condition scale, and nothing at all for a level it does offer', async () => {
  stubLogbookFor(dive({ id: 'target', date: '2026-08-16', waves: 7, current: 2 }));
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Conditions');

  const shown = textIn(t).join(' ');
  expect(shown).toContain('7');
  // `current: 2` is a level the row offers, so it is shown as a selected chip and said nothing
  // about — the half that keeps the note from firing on ordinary dives.
  expect(shown).not.toContain('2 is not one of these options');
  expect(findChip(t, 'Current', 2)?.props?.accessibilityState?.selected).toBe(true);
});

it('keeps an out-of-scale rating rather than quietly correcting it to the nearest dot', async () => {
  // The other half of §10's rule, and the one a clamp would break silently: `filledDotCount`
  // draws five filled dots for a 9, which is the only honest drawing available — but the SAVE
  // must still carry 9. A control that wrote back what it drew would round the diver's data to
  // fit its own picture.
  const target = dive({ id: 'target', date: '2026-08-16', rating: 9 });
  stubLogbookFor(target);
  mockUpdate.mockResolvedValue(target);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Notes & rating');
  await pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  // Untouched: `toDivePatch` sees no change, so `rating` is not in the patch at all — which is
  // the strongest form of "kept", since nothing was written over it.
  expect(writtenPatch()).not.toHaveProperty('rating');
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

it('saves the start pressure a diver typed, which reaches the write inside the dive’s tanks', async () => {
  // §2.2's core strip reaches into `tanks.0` for the two pressures, which makes them the only
  // rows on this form whose position is dive-level and whose column is not — so a repointed
  // `name` here writes a gauge reading into another cylinder field with the row still looking
  // perfect. `endBar` has had a payload assertion since M1d and `timeIn` has one too; this one
  // was simply absent, which is the hole this whole section exists to close.
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);

  // No group opened: the point is that it is reachable without one.
  await typeInto(t, 'Start pressure', '210');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(writtenTanks()?.[0]).toEqual(expect.objectContaining({ startBar: 210 }));
  // ...and it did not land in the field beside it, which is what a repointed `name` looks like
  // from the write side: the right value, the wrong column, nothing to say so.
  expect(writtenTanks()?.[0]?.endBar).toBeNull();

  // Emptying it is a real instruction, exactly as it is for every other optional field.
  await typeInto(t, 'Start pressure', '');
  await pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  const cleared = (mockCreate.mock.calls[1]?.[1] as { tanks?: { startBar?: unknown }[] })?.tanks;
  expect(cleared?.[0]?.startBar).toBeNull();
});

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

it('marks the cylinder row with the app’s one disclosure chevron, and rotates it with the row', async () => {
  // §0.6, as M1h generalised it: *a control that discloses further rows in place carries the
  // chevron; one that opens a picker over the row does not.* This row discloses four fields, so
  // it wears the mark — and it must be the SAME object `FormGroup`'s header wears
  // (`disclosureChevron`, renamed from `formGroupChevron` for exactly this reason), never a
  // second drawing that happens to look alike. Asserted by reference against the sheet, which
  // is what a private copy would fail.
  //
  // Found by mutation: deleting this mark from the row changed no test at all.
  stubLogbookFor(cylinderDive());
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  await openGroup(t, 'Gas & cylinders');
  const styles = makeStyles('light');

  const row = findPickerField(t, 'Cylinder');
  if (!row) throw new Error('no Cylinder row found');
  const markOf = () => {
    const current = findPickerField(t, 'Cylinder');
    return (current ? current.queryAll((n) => [n.props?.style].flat(5).includes(styles.disclosureChevron)) : [])[0];
  };
  expect(markOf()).toBeDefined();
  // Closed over a recorded spec, so the mark is in its resting rotation.
  expect([markOf()?.props?.style].flat(5)).not.toContain(styles.disclosureChevronExpanded);

  await fireEvent.press(row);
  expect([markOf()?.props?.style].flat(5)).toContain(styles.disclosureChevronExpanded);
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
  await openGroup(t, 'Gas & cylinders');
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

// --- The capture control disappears once a preset is applied (M1h) ---
//
// The owner, verbatim: "there is 'Save as preset' button even I already selected a preset.
// It's not intuitive." `presetMatching` (domain/presets.ts) owns what "applied" means and its
// own tests pin the rule; these pin that the SCREEN asks it, of the live cylinder block, in
// the diver's own units — the seam, not the rule.

/** A preset holding one fully-specified cylinder and no gauge readings, which is what
 * `createGearPreset` actually stores (§10: a preset keeps no pressures). */
const alu80 = () =>
  preset({
    name: 'alu 80',
    tanks: [tank({ material: 'alu', configuration: 'single', sizeL: 11.1, workingBar: 207, o2Pct: 32, hePct: null, startBar: null, endBar: null })],
  });

it('stops offering to save a preset the diver just applied, and offers again the moment they change it', async () => {
  stubPresets([alu80()]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  expect(findButton(t, 'Save as preset')).toBeDefined();

  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);
  expect(findButton(t, 'Save as preset')).toBeUndefined();

  // ...and back, because now there really is a new cylinder block to name. This is the half a
  // remembered "a chip was tapped" flag would get wrong.
  await openCylinder(t);
  await typeInto(t, 'Size', '15');
  expect(findButton(t, 'Save as preset')).toBeDefined();
});

it('stays hidden while the diver types the gauge readings a preset never stores', async () => {
  // The ordinary next gesture after applying a preset. `withoutPressures` on both sides is what
  // keeps this from reading as a new cylinder block (§10: a preset keeps no pressures).
  stubPresets([alu80()]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);

  await typeInto(t, 'Start pressure', '210');
  await typeInto(t, 'End pressure', '60');
  expect(findButton(t, 'Save as preset')).toBeUndefined();
});

it('hides it for a block carry-over filled, which no remembered tap could know about', async () => {
  // "Applied" is a fact about the cylinders rather than a gesture: the second dive of a trip
  // arrives holding the same cylinders as the first without anybody tapping a chip, and the
  // control has exactly as little to offer there.
  const stored = alu80();
  stubPresets([stored]);
  stubDives({ dives: [dive({ date: '2026-08-16', tanks: [{ ...stored.tanks[0]!, startBar: 200, endBar: 50 }] })] });
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');

  expect(findButton(t, 'Save as preset')).toBeUndefined();
});

it('keeps offering it over a block that records nothing, whatever presets exist', async () => {
  // A preset holding one blank cylinder is a row M2 sync can deliver, and the form's own
  // untouched block is byte-for-byte that. Matching it would take away the diver's only way to
  // author a preset at all — so the control stays, and `presetRefusal` is what explains itself
  // when they press it.
  stubPresets([preset({ name: 'from another device', tanks: [tank({ material: null, configuration: null, sizeL: null, workingBar: null, o2Pct: null, hePct: null, startBar: null, endBar: null })] })]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');

  expect(findButton(t, 'Save as preset')).toBeDefined();
});

it('compares the block as it would be stored, not as an imperial diver reads it', async () => {
  // The form holds `3002 psi` where the preset holds `207 bar`, so a comparison made against
  // the displayed figures would never match and the control would never disappear for an
  // imperial diver. `toStoredTanks` is the same conversion *Save as preset* itself makes.
  mockUseUnitSystem.mockReturnValue('imperial');
  stubPresets([alu80()]);
  const t = await render(<DiveFormScreen mode="create" />);
  await openGroup(t, 'Gas & cylinders');
  const chip = findPresetChip(t, 'alu 80');
  if (!chip) throw new Error('no preset chip found');
  await fireEvent.press(chip);

  expect(findTextInput(t, 'Working pressure')?.props?.value).toBe('3002');
  expect(findButton(t, 'Save as preset')).toBeUndefined();
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
 * belong to — so every carried mark over those fields is now offering to clear a value the
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
// the clear control. Typing and picking are pinned on the write payload above; clearing was
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

// **The form is the screen that does NOT read the device at its bottom, and this is why**
// (M1h, DESIGN.md §4.1's "a deliberate near-duplicate names its siblings"). Its scroll content
// and Settings' were one style with `paddingBottom: 40` until Settings' copy was found to be
// 43 pt short of what a screen under the tab bar reports. The obvious follow-up — give the
// form the same device-read fix — would be wrong, and wrong invisibly: this scroll is a
// SIBLING ABOVE `formFooter`, and that footer already composes `insets.bottom + 24`, so the
// scroll's frame stops at the footer's top edge and nothing the device puts at the bottom of
// the display is ever in front of it. Reading the safe area here would spend the tab bar's
// height a second time and open a gap the size of a tab bar above the save button.
//
// So the assertion is the unusual one: the scroll's own clearance must be the SAME under two
// very different devices, while the footer beside it must differ under exactly those two. One
// test, both halves, because separately either reads as an arbitrary claim about a number.
it('leaves the form scroll indifferent to the device, and its footer is what spends the inset', async () => {
  const measure = async (bottom: number) => {
    stubDives({ dives: [], numbers: new Map(), error: undefined });
    const t = await render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom } }}
      >
        <DiveFormScreen mode="create" />
      </SafeAreaProvider>,
    );
    const [scroll] = t.root ? t.root.queryAll((n) => n.props?.contentContainerStyle !== undefined) : [];
    if (!scroll) throw new Error('DiveFormScreen did not render its scroll');
    const scrollStyle = [scroll.props.contentContainerStyle].flat(5).filter(Boolean) as Record<string, unknown>[];
    const [footer] = t.root
      ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formFooter))
      : [];
    if (!footer) throw new Error('DiveFormScreen did not render its footer');
    const footerStyle = [footer.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
    // LAST wins, not first: RN resolves a style array in order, and `formFooter` carries a
    // base `paddingBottom` that the call site's device value overrides. Reading the first
    // would report the sheet's number and quietly conclude the footer ignores the device.
    const pick = (style: Record<string, unknown>[]) => {
      const value = style.reduce<unknown>((acc, s) => (s.paddingBottom !== undefined ? s.paddingBottom : acc), undefined);
      if (typeof value !== 'number') throw new Error('no paddingBottom composed');
      return value;
    };
    return { scroll: pick(scrollStyle), footer: pick(footerStyle) };
  };

  const underTabBar = await measure(83);
  const underNothing = await measure(0);

  // The scroll does not move, because what is below it is the footer and not the device.
  expect(underTabBar.scroll).toBe(underNothing.scroll);
  // The footer does, because it is the thing actually standing on the bottom edge. Without
  // this half the assertion above would also pass on a form that had simply stopped asking
  // the device anywhere at all.
  expect(underTabBar.footer).toBeGreaterThan(underNothing.footer);
  expect(underTabBar.footer).toBeGreaterThanOrEqual(83);
});
