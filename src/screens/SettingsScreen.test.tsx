// The package's own official Jest mock — this screen now calls useSafeAreaInsets() for its
// root's top clearance (`screenTopInset`, theme/styles.ts), gets a real SafeAreaProvider for
// free from expo-router's root layout in the app, and has none when rendered bare here.
// Imported first, and named `mock...`, for the babel-plugin-jest-hoist reason
// DiveFormScreen.test.tsx records: a jest.mock() factory may only close over out-of-scope
// identifiers starting with `mock`/`require`, and every jest.mock() call is hoisted above
// every import regardless. Left on the mock's own zero insets by every test in this file
// except the last, which supplies a real `SafeAreaProvider` on purpose: this screen's scroll
// runs to the bottom of the display and now spends the device's bottom inset there (M1h), and
// a zero-inset render cannot tell a screen that asks the device from one that never does.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { db } from '../db/client';
import { setDivesBefore, setUnitSystem } from '../db/settings';
import { useCertifications } from '../db/useCertifications';
import { useDivesBefore } from '../db/useDivesBefore';
import { useGearPresets } from '../db/useGearPresets';
import { useUnitSystem } from '../db/useUnitSystem';
import { todayCalendarDate } from '../domain/datetime';
import { type Certification, type GearPreset, type Tank } from '../domain/types';
import { formatCylinders } from '../format/display';
import { UNIT_SYSTEMS } from '../format/units';
import {
  LOCATION_PERMISSION_STATES,
  locationPermission,
  requestLocationPermission,
  type LocationPermissionState,
} from '../platform/locationPermission';
import { themeFor } from '../theme/resolve';
import { makeStyles, screenBottomInset } from '../theme/styles';
import SettingsScreen from './SettingsScreen';

// The two live reads, mocked per module exactly as DivesScreen.test.tsx mocks `useDives` and
// `useUnitSystem`, and for the same reason: they are database reads, and this screen must be
// renderable in either unit system, and against any stored count, without one.
//
// `mockImplementation` on every stub below, never `mockReturnValue` — the fiction of a
// referentially stable hook result is what let this repo ship a screen that looped
// infinitely on mount behind 537 green tests (stubDives, DiveFormScreen.test.tsx). These two
// return primitives, which cannot have that problem, but the discipline is the file's rather
// than the value's: a stub that models "one frozen answer forever" is the wrong shape to
// reach for at all, and this screen genuinely does adjust state when its reads change.
jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn() }));
jest.mock('../db/useDivesBefore', () => ({ useDivesBefore: jest.fn() }));
// The third live read (M1e): §3's cylinder presets, mocked per module for the same reason
// the two above are — it is a database read, and this screen must render against any list of
// presets, and against a read that failed, without one.
jest.mock('../db/useGearPresets', () => ({ useGearPresets: jest.fn() }));
// The fourth live read (M3b): §3's certification wallet, mocked per module for the same reason
// the three above are — it is a database read, and this screen must render against any wallet,
// and against a read that failed, without one.
jest.mock('../db/useCertifications', () => ({ useCertifications: jest.fn() }));
// **What day it is, faked so a wallet row can be judged against a known one** (M3b). §4.1 gives
// that question to `domain/datetime.ts`, and this screen asks it once per render and hands the
// answer down — so faking the OWNER is what proves the screen asks it, where a fixed date in a
// fixture would only prove `formatCertificationSummary` can be handed one. `requireActual`
// keeps every other date rule real: this file's own `parseDiveCount` mock records why a rule
// left stubbed leaves the test asserting against its own idea of the app.
jest.mock('../domain/datetime', () => ({
  ...jest.requireActual('../domain/datetime'),
  todayCalendarDate: jest.fn(() => '2026-09-04'),
}));
// A preset row pushes `/preset/<id>`; nothing else here navigates.
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() },
}));
// The writes. `jest.requireActual` keeps `parseDiveCount` REAL: it is the rule that decides
// what text is a dive count (db/settings.ts owns it, shared with `getDivesBefore` and
// `readDivesBefore`), and stubbing it would leave this file asserting against its own idea
// of what "247" means rather than the app's.
jest.mock('../db/settings', () => ({
  ...jest.requireActual('../db/settings'),
  setUnitSystem: jest.fn(),
  setDivesBefore: jest.fn(),
}));
// §3's location access (M2m). **Both halves are faked, and the requesting one is faked so
// that it can be witnessed NOT being called** — §3's rule is that reading the status must not
// request it, and a module left real would answer from whatever the test machine happens to
// have. `jest.requireActual` keeps `LOCATION_PERMISSION_STATES` real: it is the vocabulary
// this screen must cover, and a stubbed list would let the sweep below pass over a list of
// the states the test happens to know about.
jest.mock('../platform/locationPermission', () => ({
  ...jest.requireActual('../platform/locationPermission'),
  locationPermission: jest.fn(),
  requestLocationPermission: jest.fn(),
}));
// The way out to the device's own Settings app. Faked because there is no Settings app here,
// and because "it was asked for" is the whole of what this screen can promise about it.
jest.mock('expo-linking', () => ({ ...jest.requireActual('expo-linking'), openSettings: jest.fn() }));

const mockUseUnitSystem = useUnitSystem as jest.Mock;
const mockUseDivesBefore = useDivesBefore as jest.Mock;
const mockUseGearPresets = useGearPresets as jest.Mock;
const mockUseCertifications = useCertifications as jest.Mock;
const mockSetUnitSystem = setUnitSystem as jest.Mock;
const mockSetDivesBefore = setDivesBefore as jest.Mock;
const mockPush = router.push as jest.Mock;
const mockLocationPermission = locationPermission as jest.Mock;
const mockRequestLocationPermission = requestLocationPermission as jest.Mock;
const mockOpenSettings = Linking.openSettings as jest.Mock;

let presetSeq = 0;
/** A `GearPreset` with only the fields a case cares about. Ids come from a counter for the
 * reason `diveFixture`'s own do: two presets built with identical arguments must still be
 * distinct, since this list keys its rows by id and the editor is opened by one. */
const preset = (over: Partial<GearPreset> = {}): GearPreset => ({
  id: `preset-${String(presetSeq++).padStart(4, '0')}`,
  name: 'twin 12 steel',
  tanks: [],
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  // Never written by the repository, so never flagged (§7.1) — `diveFixture`'s reasoning.
  dirty: false,
  deletedAt: null,
  ...over,
});

let cardSeq = 0;
/** A `Certification` with only the fields a case cares about — `preset`'s own shape, and ids
 * from a counter for its reason: two cards built with identical arguments must still be
 * distinct, since this list keys its rows by id and the editor is opened by one. */
const certification = (over: Partial<Certification> = {}): Certification => ({
  id: `cert-${String(cardSeq++).padStart(4, '0')}`,
  agency: 'PADI',
  course: 'Rescue Diver',
  cardNumber: null,
  issuedOn: null,
  expiresOn: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  // Never written by the repository, so never flagged (§7.1) — `preset`'s own reasoning.
  dirty: false,
  deletedAt: null,
  ...over,
});

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: null, configuration: null, sizeL: null, workingBar: null,
  o2Pct: null, hePct: null, startBar: null, endBar: null, ...over,
});

/** All four reads at once, so no test can forget one and render against `undefined`.
 *
 * The presets stub spreads into a fresh array per call for the reason `stubDives`
 * (DiveFormScreen.test.tsx) records at length: the real hook builds its list with
 * `rows.map(...).sort(...)`, so a stub handing back one referentially-stable array forever
 * would model a contract it does not have. */
function stubSettings({
  units = 'metric',
  divesBefore = 0,
  presets = [],
  presetsError,
  presetsResolved = true,
  certifications = [],
  certificationsError,
  certificationsResolved = true,
  divesBeforeResolved = true,
  permission = 'granted',
}: {
  units?: string;
  divesBefore?: number | null;
  presets?: GearPreset[];
  presetsError?: Error;
  presetsResolved?: boolean;
  certifications?: Certification[];
  certificationsError?: Error;
  certificationsResolved?: boolean;
  divesBeforeResolved?: boolean;
  permission?: LocationPermissionState;
} = {}) {
  // A fresh promise per call, never one resolved object handed back for ever: this screen
  // reads the permission again every time the app returns to the foreground, and a stub that
  // could only answer once would model a module that caches — which is precisely what
  // `platform/locationPermission.ts` refuses to be.
  mockLocationPermission.mockImplementation(() => Promise.resolve(permission));
  mockUseUnitSystem.mockImplementation(() => units);
  // Both `*Resolved` flags default to TRUE — the read has answered — because that is what every
  // test in this file is about. Spelled out rather than left `undefined` so this stub keeps
  // modelling a state the real hooks can actually be in, and so the two describe-less cases
  // that set them `false` cannot be re-hidden by the default.
  mockUseDivesBefore.mockImplementation(() => ({ count: divesBefore, resolved: divesBeforeResolved }));
  // `presetsResolved` defaults to TRUE — the read has answered — because that is what every
  // test in this file is about. Spelled out rather than left `undefined` so this stub keeps
  // modelling a state the real hook can actually be in.
  mockUseGearPresets.mockImplementation(() => ({
    presets: [...presets],
    error: presetsError,
    resolved: presetsResolved,
  }));
  // A fresh array per call, for the reason the presets stub spreads: the real hook builds its
  // list with `rows.map(...).sort(...)`, so a stub handing back one referentially-stable array
  // for ever would model a contract it does not have.
  mockUseCertifications.mockImplementation(() => ({
    certifications: [...certifications],
    error: certificationsError,
    resolved: certificationsResolved,
  }));
}

/**
 * Every `AppState` `change` handler this screen registered while it was mounted.
 *
 * Spied rather than driven through the real `AppState`, for the reason `syncTriggers.test.tsx`
 * records: under Jest the native module behind it is a stub and nothing would ever deliver an
 * event. Whether a given event *counts* as a return to the foreground is
 * `hooks/useForegroundReturn.ts`'s rule and is tested there; what is delivered below is a
 * return, and what is asserted here is what this screen does with one.
 */
let appStateHandlers: ((state: AppStateStatus) => void)[];

/** Sends the app away and brings it back, which is what a diver does when they leave for the
 * system Settings app, change the permission and return. */
async function returnToForeground() {
  await act(async () => {
    for (const handler of appStateHandlers) handler('background');
  });
  await act(async () => {
    for (const handler of appStateHandlers) handler('active');
  });
}

beforeEach(() => {
  mockSetUnitSystem.mockImplementation(() => Promise.resolve());
  mockSetDivesBefore.mockImplementation(() => Promise.resolve());
  mockOpenSettings.mockImplementation(() => Promise.resolve());
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') appStateHandlers.push(handler as (state: AppStateStatus) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  mockUseUnitSystem.mockReset();
  mockUseDivesBefore.mockReset();
  mockUseGearPresets.mockReset();
  mockUseCertifications.mockReset();
  mockSetUnitSystem.mockReset();
  mockSetDivesBefore.mockReset();
  mockPush.mockReset();
  mockLocationPermission.mockReset();
  mockRequestLocationPermission.mockReset();
  mockOpenSettings.mockReset();
  // Spies only — `jest.spyOn`'s `AppState` stub above. The module mocks are not spies and are
  // reset by name, as this file has always done.
  jest.restoreAllMocks();
});

function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.type === 'Text') : [])
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function findChip(t: RenderResult, label: string) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === `Units: ${label}`) : [];
  if (!node) throw new Error(`SettingsScreen did not render a "${label}" chip`);
  return node;
}

function buttonLabels(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : []).map((n) =>
    String(n.props?.accessibilityLabel ?? ''),
  );
}

/** Every preset row's name, in the order the screen drew them — read off the announced
 * labels, which is also what proves each row says what pressing it DOES rather than merely
 * repeating the name it shows. Whole-label matching, never a substring: this screen's other
 * controls are the unit chips, and a loose match is what let a save control hide behind a
 * preset one earlier in this milestone. */
function presetRowNames(t: RenderResult): string[] {
  return buttonLabels(t)
    .filter((label) => label.startsWith('Edit preset '))
    .map((label) => label.slice('Edit preset '.length));
}

function findPresetRow(t: RenderResult, name: string) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === `Edit preset ${name}`) : [];
  if (!node) throw new Error(`SettingsScreen rendered no row for the preset "${name}"`);
  return node;
}

function findCertificationRow(t: RenderResult, name: string) {
  const [node] = t.root
    ? t.root.queryAll((n) => n.props?.accessibilityLabel === `Edit certification ${name}`)
    : [];
  if (!node) throw new Error(`SettingsScreen rendered no row for the certification "${name}"`);
  return node;
}

function findAddCertificationRow(t: RenderResult) {
  const [node] = t.root
    ? t.root.queryAll((n) => n.props?.accessibilityLabel === 'Add a certification')
    : [];
  if (!node) throw new Error('SettingsScreen did not render the add-a-certification row');
  return node;
}

function findCountField(t: RenderResult) {
  const [node] = t.root
    ? t.root.queryAll((n) => n.type === 'TextInput' && n.props?.accessibilityLabel === 'Dives before Ponor')
    : [];
  if (!node) throw new Error('SettingsScreen did not render the dives-before field');
  return node;
}

// ---------------------------------------------------------------------------------------
// Units (DESIGN.md §3)
// ---------------------------------------------------------------------------------------

// §4.1's "derive, or tie at compile time": `format/units.ts` owns the unit system, so the
// chips are `UNIT_SYSTEMS` itself. Asserted by LENGTH against that list rather than by
// naming two chips — a hand-written second list of the same two words would pass a
// "renders Metric and Imperial" test forever and silently miss a third system added there,
// which is the exact failure §4.1 records ("Adding a member to a hand-maintained option
// list used to produce a save-blocking rejection and a missing chip, silently").
it('offers exactly the unit systems format/units.ts declares, not a second list of them', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const chips = t.root ? t.root.queryAll((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Units: ')) : [];
  expect(chips).toHaveLength(UNIT_SYSTEMS.length);
  expect(textIn(t)).toEqual(expect.arrayContaining(['Metric', 'Imperial']));
});

// The stored preference is what the screen shows, not the last thing it wrote — both
// directions, so a screen that hard-coded "metric is selected" would fail the second.
it.each(['metric', 'imperial'] as const)('marks the stored system (%s) as the chosen chip', async (system) => {
  stubSettings({ units: system });
  const t = await render(<SettingsScreen />);
  const chosen = system === 'metric' ? 'Metric' : 'Imperial';
  const other = system === 'metric' ? 'Imperial' : 'Metric';
  expect(findChip(t, chosen).props.accessibilityState).toEqual({ selected: true });
  expect(findChip(t, other).props.accessibilityState).toEqual({ selected: false });
});

// §0.6: "`surface` behind an unselected chip, `action` ink behind the selected one — the
// same invert the save control uses". Read off makeStyles rather than retyped, so this
// cannot be satisfied by a colour that merely looks right.
it('inverts the chosen chip rather than marking it some other way', async () => {
  stubSettings({ units: 'imperial' });
  const t = await render(<SettingsScreen />);
  const styleOf = (label: string) =>
    [findChip(t, label).props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  expect(styleOf('Imperial')).toContain(makeStyles('light').formChipSelected);
  expect(styleOf('Metric')).not.toContain(makeStyles('light').formChipSelected);
  expect(styleOf('Imperial').some((s) => s.backgroundColor === themeFor('light').action)).toBe(true);
});

// **The task's own instruction, and DESIGN.md's**: the preference is written through
// `setUnitSystem`, never by touching the `settings` row. That module owns the key, and
// `readUnitSystem`'s "an unrecognised value degrades to the default" reasoning only holds
// while this is the one writer — a screen writing the row itself would be the second writer
// that reasoning assumes does not exist. Asserted on the exact function and the exact
// argument, including that it is handed the app's own `db`.
it('writes the chosen system through setUnitSystem', async () => {
  stubSettings({ units: 'metric' });
  const t = await render(<SettingsScreen />);
  await fireEvent.press(findChip(t, 'Imperial'));
  expect(mockSetUnitSystem).toHaveBeenCalledTimes(1);
  expect(mockSetUnitSystem).toHaveBeenCalledWith(db, 'imperial');
});

// `OptionChips` reports `''` when the diver presses the chip that is already selected — its
// way of offering to clear the field. A unit system has no cleared state, so that press must
// write nothing at all rather than writing an empty string into the row `readUnitSystem`
// reads. Without this the screen would store a value nothing can interpret.
it('writes nothing when the diver presses the system that is already chosen', async () => {
  stubSettings({ units: 'metric' });
  const t = await render(<SettingsScreen />);
  await fireEvent.press(findChip(t, 'Metric'));
  expect(mockSetUnitSystem).not.toHaveBeenCalled();
});

// §1's "never block a save" cuts both ways: a diver who changes a setting and is not told it
// failed sees the old value the next time they open the app with no idea why. The chip
// itself does not move, because it renders from the live read, which is correct — but a
// control that silently did nothing is exactly what this codebase has shipped before.
it('says so when a unit write fails, rather than leaving the chip to explain itself', async () => {
  stubSettings({ units: 'metric' });
  mockSetUnitSystem.mockImplementation(() => Promise.reject(new Error('disk full')));
  const t = await render(<SettingsScreen />);
  await fireEvent.press(findChip(t, 'Imperial'));
  await waitFor(() => expect(textIn(t).join(' ')).toContain("Couldn't save that"));
});

// ---------------------------------------------------------------------------------------
// dives_before (DESIGN.md §2.5: "asked once at onboarding, editable in settings any time")
// ---------------------------------------------------------------------------------------

// `useDivesBefore()` answers asynchronously — so a field seeded once on mount would leave a
// diver with 247 prior dives looking at a 0 that is not what is stored. Proven by rendering,
// then changing what the hook returns and re-rendering, which is exactly the sequence the real
// hook produces.
//
// The first render is stubbed the way the hook actually behaves there — no answer yet (M1f) —
// which is also the half this test used to model wrongly, as an answered read of a diver with
// no stored count. Those are two different facts now: `0` is a real answer, and the field shows
// it (the test below).
it('shows nothing until the stored count arrives, then shows it', async () => {
  stubSettings({ divesBefore: 0, divesBeforeResolved: false });
  const t = await render(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('');

  stubSettings({ divesBefore: 247, divesBeforeResolved: true });
  await t.rerender(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('247');
});

// The other half, and it is the common case: a diver who never answered the onboarding question
// has a genuine stored 0 (`useDivesBefore`'s own "an absent row is a diver who has never
// answered, whose honest answer is 0"), and the field must show it rather than sit empty.
it('shows a stored zero as a zero, once the read has answered', async () => {
  stubSettings({ divesBefore: 0, divesBeforeResolved: true });
  const t = await render(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('0');
});

/**
 * M1f, and the sixth site of the same rule — the one that does not merely say something false
 * but **destroys a diver's input**.
 *
 * Two halves, one guard. The field showed `0` before anything had been read, which is a number
 * nobody entered standing in a field the diver is about to act on — and §2.5 makes this one the
 * offset every dive number in the logbook is computed from, so it is not a display detail. And
 * the reseed then fired unconditionally when the real value landed, replacing whatever had been
 * typed over that fake zero. Silently, with no error and nothing on screen to say so, which is
 * the hazard `withoutUndefinedFields` (db/dives.ts) exists for one layer down.
 *
 * `useUnitSystem`'s degradation to metric is NOT the same thing and this file used to imply it
 * was: metric is a convention standing in for an absent preference and nobody typed it, where
 * `0` stands in for a number the diver entered.
 */
it('does not show a count of zero before anything has been read', async () => {
  stubSettings({ divesBefore: 0, divesBeforeResolved: false });
  const t = await render(<SettingsScreen />);
  // Empty, so §0.6's placeholder says what belongs in the row without asserting a value.
  expect(findCountField(t).props.value).toBe('');
});

/**
 * The transition the two guards have to survive TOGETHER, and the one a naive fix breaks: an
 * unanswered read reports `count: 0`, and so does the genuine answer for a diver who never
 * answered the onboarding question — which is the common case, not an edge one.
 *
 * A gate that only emptied the TEXT while unresolved, without also refusing to record what it
 * seeded from, would set `seededFrom = 0` on the first render; the real answer of 0 would then
 * compare equal, no reseed would fire, and the field would sit empty for ever over a stored
 * count of 0. This test is what fails for that, and nothing above it does — every other case
 * here either starts resolved or crosses from 0 to a different number.
 */
it('fills in a stored zero when the read answers with the same zero it showed nothing for', async () => {
  stubSettings({ divesBefore: 0, divesBeforeResolved: false });
  const t = await render(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('');

  stubSettings({ divesBefore: 0, divesBeforeResolved: true });
  await t.rerender(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('0');
});

it('does not replace a count the diver is typing when the stored one lands', async () => {
  stubSettings({ divesBefore: 0, divesBeforeResolved: false });
  const t = await render(<SettingsScreen />);
  await fireEvent.changeText(findCountField(t), '2');

  stubSettings({ divesBefore: 247, divesBeforeResolved: true });
  await t.rerender(<SettingsScreen />);

  // The diver's draft wins over a later answer — `SeedState.typed` (DiveFormScreen.tsx) and
  // `PresetDraft` (GearPresetScreen.tsx) both state the same rule for the same reason: "the
  // alternative is a diver's half-typed edit being overwritten mid-keystroke".
  expect(findCountField(t).props.value).toBe('2');
});

// §2.5's whole point: this offsets every dive number in the logbook, so it has to reach the
// database — through `setDivesBefore`, which owns the key and the "non-negative integer
// only" rule, and as a NUMBER rather than the string the field holds (that module's own
// docblock records what handing `assignDiveNumbers` a raw string costs: dive #1 instead of
// #248, silently).
it('writes a typed count through setDivesBefore, as a number', async () => {
  stubSettings({ divesBefore: 0 });
  const t = await render(<SettingsScreen />);
  await fireEvent.changeText(findCountField(t), '247');
  expect(mockSetDivesBefore).toHaveBeenCalledWith(db, 247);
});

// A diver retyping a count passes through an empty field and through half-typed values.
// Neither is a count, and writing either would renumber the whole logbook mid-keystroke —
// clearing the field would momentarily set the offset to 0. The field still shows what was
// typed, which is the other half: a field that snapped back to the stored value on every
// keystroke could not be edited at all.
it.each(['', '2.5', 'abc'])('writes nothing for text that is not a count (%p), while still showing it', async (text) => {
  stubSettings({ divesBefore: 12 });
  const t = await render(<SettingsScreen />);
  await fireEvent.changeText(findCountField(t), text);
  expect(mockSetDivesBefore).not.toHaveBeenCalled();
  expect(findCountField(t).props.value).toBe(text);
});

// Leaving the field is where an unusable value is resolved, so the row can never sit showing
// a number the logbook is not numbered from. Both halves matter: the text goes back to what
// is stored, AND the diver is told nothing was saved — restoring silently would look like
// the app had accepted and then forgotten their number.
it('restores the stored count when the diver leaves an unusable value, and says nothing was saved', async () => {
  stubSettings({ divesBefore: 12 });
  const t = await render(<SettingsScreen />);
  await fireEvent.changeText(findCountField(t), '2.5');
  await fireEvent(findCountField(t), 'blur');
  expect(findCountField(t).props.value).toBe('12');
  expect(textIn(t).join(' ')).toContain('Whole dives only');
});

/**
 * The hole that "the diver's draft wins" opens if it is left unqualified, and the reason
 * settling clears it.
 *
 * A draft is what `countTyped` protects. `settleCount` is the act of DISCARDING a draft — the
 * text was not a count and nothing was saved — so after it there is no draft left to protect,
 * and going on protecting one would leave this field permanently unfillable: a diver who typed
 * something unusable before the read answered would get an empty row that the real value could
 * never afterwards reach, for the life of the screen.
 *
 * Only the discard path clears it. A blur over a valid count returns early (the test above),
 * because that value is the diver's, is already written, and must keep winning.
 */
it('fills in the stored count after an unusable entry made before the read answered', async () => {
  stubSettings({ divesBefore: 0, divesBeforeResolved: false });
  const t = await render(<SettingsScreen />);
  await fireEvent.changeText(findCountField(t), 'abc');
  await fireEvent(findCountField(t), 'blur');
  // Nothing was read, so there is nothing to restore to — an empty row, not a `0`.
  expect(findCountField(t).props.value).toBe('');

  stubSettings({ divesBefore: 247, divesBeforeResolved: true });
  await t.rerender(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('247');
});

// An emptied field is what retyping looks like, so it restores without accusing the diver of
// anything — the one case deliberately excluded from the note above.
it('restores a simply-emptied field without a complaint', async () => {
  stubSettings({ divesBefore: 12 });
  const t = await render(<SettingsScreen />);
  await fireEvent.changeText(findCountField(t), '');
  await fireEvent(findCountField(t), 'blur');
  expect(findCountField(t).props.value).toBe('12');
  expect(textIn(t).join(' ')).not.toContain('Whole dives only');
});

// `useDivesBefore` returns `null` for the one case it will not degrade: a stored value that
// is present and is not a count. Reporting it here is the whole reason that `null` exists —
// showing 0 instead would misnumber the logbook by the diver's entire history with nothing
// on screen to say so — and Settings is the one screen where it is fixable.
it('says when the stored count could not be read, instead of showing a plausible zero', async () => {
  stubSettings({ divesBefore: null });
  const t = await render(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('');
  expect(textIn(t).join(' ')).toContain("couldn't be read");
});

it('says so when a count write fails', async () => {
  stubSettings({ divesBefore: 0 });
  mockSetDivesBefore.mockImplementation(() => Promise.reject(new Error('disk full')));
  const t = await render(<SettingsScreen />);
  await fireEvent.changeText(findCountField(t), '247');
  await waitFor(() => expect(textIn(t).join(' ')).toContain("Couldn't save that"));
});

// ---------------------------------------------------------------------------------------
// Cylinder presets (DESIGN.md §3, and §10: "§3's Settings list is then a real editor")
// ---------------------------------------------------------------------------------------

// The order is `comparePresets`' (domain/presets.ts), decided once and applied inside
// `toGearPresets` — this screen must draw the list it is handed and never re-sort it, or
// Settings and the dive form's chip row would disagree about where a preset sits.
//
// Stubbed in the order that is NOT sorted, deliberately: with `['alu 80', 'twin 12 steel']`
// — already the comparator's answer — a screen that re-sorted would pass a test named for
// not re-sorting.
it('lists every preset in the order the hook hands them, never its own', async () => {
  stubSettings({ presets: [preset({ name: 'twin 12 steel' }), preset({ name: 'alu 80' })] });
  const t = await render(<SettingsScreen />);
  expect(presetRowNames(t)).toEqual(['twin 12 steel', 'alu 80']);
});

// The summary goes through `formatCylinders` (format/display.ts), which is also what the
// dive detail's own cylinder rows are built from — never a second formatter here. Asserted as
// the whole line a diver reads, and separately against the formatter itself, so neither a
// respelling nor a screen that stopped calling it can pass.
it('shows a preset’s cylinders under its name', async () => {
  const tanks = [tank({ material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232, o2Pct: 32 })];
  stubSettings({ presets: [preset({ name: 'twin 12 steel', tanks })] });
  const t = await render(<SettingsScreen />);
  expect(textIn(t)).toContain('Twinset 12 l Steel · 232 bar · O₂ 32 %');
  expect(textIn(t)).toContain(formatCylinders(tanks, 'metric'));
});

// §3 gives Settings the unit setting, so a preset's figures are read in it too — the same
// stored preset, two systems, one owner (`formatCylinders` takes it as an argument).
it('reads a preset’s cylinders in the diver’s own units', async () => {
  stubSettings({
    units: 'imperial',
    presets: [preset({ tanks: [tank({ sizeL: 11.1, workingBar: 207 })] })],
  });
  const t = await render(<SettingsScreen />);
  expect(textIn(t)).toContain('11.1 l · 3002 psi');
});

// **The recurring defect §10 names: "a label and a link that disagree."** A row that always
// opened the first preset would be indistinguishable from this one on a one-preset list, so
// the assertion is on the id the tapped row actually sends.
it('opens the editor for the preset whose row was tapped', async () => {
  const second = preset({ name: 'alu 80' });
  stubSettings({ presets: [preset({ name: 'twin 12 steel' }), second] });
  const t = await render(<SettingsScreen />);
  await fireEvent.press(findPresetRow(t, 'alu 80'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith(`/preset/${second.id}`);
});

// The brief's own rule, and the reason it is a rule: deleting lives at the END of the editor,
// exactly as *Delete dive* sits at the end of the dive detail rather than on a row of the
// dive list. That is what keeps the list a list. Asserted as "one control per row, and it is
// the row" — a delete added beside a name would be a second button inside it.
//
// The account row (§3, M2e), the location row (§3, M2m) and the wallet's two (§3, M3b) are
// listed with it and are the reason this is an exhaustive list rather than a filter: it is the
// whole inventory of what this screen can be pressed on, so a control added anywhere on it — a
// delete on a preset row or on a certification row included — lands here.
//
// **The list grows by §3's entries arriving and never by being loosened**, which is the same
// discipline the labelled-settings assertion below keeps. M3b added two: a card's own row, and
// the *Add a certification* row the preset list has no counterpart for (§10 puts preset
// creation in the dive form; a card has nowhere else to come from).
it('carries no delete of its own, so the list stays a list', async () => {
  stubSettings({
    presets: [preset({ name: 'twin 12 steel' })],
    certifications: [certification({ agency: 'PADI', course: 'Rescue Diver' })],
  });
  const t = await render(<SettingsScreen />);
  // Waited for, because one of them announces a permission this screen has to read before it
  // can say anything about it — and an inventory taken before that read answers would be an
  // inventory of a screen mid-load.
  await waitFor(() => {
    const labels = buttonLabels(t).filter((label) => !label.startsWith('Units: '));
    expect(labels).toEqual([
      'Edit preset twin 12 steel',
      'Location access: Allowed',
      'Edit certification PADI Rescue Diver',
      'Add a certification',
      'Open account & sync',
    ]);
  });
});

// A diver who has never saved one must not find an unexplained empty section — the preset is
// captured in the dive form (§10), and nothing on this screen would otherwise say so.
it('says where presets come from when there are none', async () => {
  stubSettings({ presets: [] });
  const t = await render(<SettingsScreen />);
  expect(textIn(t).join(' ')).toContain('Save one from a dive’s Gas & cylinders group');
  expect(presetRowNames(t)).toEqual([]);
});

// The whole reason `useGearPresets` carries an `error` at all (its own docblock: "'Couldn't
// load your presets' and 'you have none yet' are different sentences, and a diver who went to
// that screen specifically to manage presets must not be shown the second when the first is
// true").
it('says the read failed rather than claiming the diver has none', async () => {
  stubSettings({ presets: [], presetsError: new Error('disk') });
  const t = await render(<SettingsScreen />);
  expect(textIn(t).join(' ')).toContain("Couldn't load your presets");
  expect(textIn(t).join(' ')).not.toContain('Save one from a dive’s Gas & cylinders group');
});

/**
 * M1f. `resolved` (useGearPresets.ts) exists because `presets: []` means "you have none" and
 * "nothing read yet" at once, and `GearPresetScreen` one route deeper asserted the first while
 * the second was true. **"You have no presets" is an answer too**, so this line waits for one
 * as well — the rule is that a screen with no answer must not state one, and it holds wherever
 * a screen would otherwise state one.
 *
 * The pair below is one guard and needs both halves. Absent while there is no answer; PRESENT
 * the instant the answer is "none", because a gate that never opens — or opens on the wrong
 * polarity — leaves the *Cylinder presets* heading standing over nothing at all. That section
 * has no other affordance: a preset is created in the dive form (§10), so this line is the only
 * thing on this screen that says where one comes from, and without it the section is a mystery.
 */
it('does not say the diver has no presets before the read has answered', async () => {
  stubSettings({ presets: [], presetsResolved: false });
  const t = await render(<SettingsScreen />);
  expect(textIn(t).join(' ')).not.toContain('Save one from a dive’s Gas & cylinders group');
  // The section still names itself, so nothing above the line moves when the line arrives.
  expect(textIn(t).join(' ')).toContain('Cylinder presets');
});

it('shows the empty line as soon as the read answers with no presets, rather than waiting for more', async () => {
  stubSettings({ presets: [], presetsResolved: true });
  const t = await render(<SettingsScreen />);
  expect(textIn(t).join(' ')).toContain('Save one from a dive’s Gas & cylinders group');
});

// The other direction of the same line: a diver who HAS presets is told nothing about where
// they come from, because the list in front of them says it.
it('drops the empty line once there is a preset to show', async () => {
  stubSettings({ presets: [preset({ name: 'twin 12 steel' })] });
  const t = await render(<SettingsScreen />);
  expect(textIn(t).join(' ')).not.toContain('Save one from a dive’s Gas & cylinders group');
});

// ---------------------------------------------------------------------------------------
// §3's certification wallet (M3b)
// ---------------------------------------------------------------------------------------

/** Every certification row's name, in the order the screen drew them — read off the announced
 * labels, which is also what proves each row says what pressing it DOES rather than merely
 * repeating the name it shows. `presetRowNames`' shape, and whole-label matching for its
 * reason: a loose match is what let a save control hide behind a preset one earlier on. */
function certificationRowNames(t: RenderResult): string[] {
  return buttonLabels(t)
    .filter((label) => label.startsWith('Edit certification '))
    .map((label) => label.slice('Edit certification '.length));
}

// The order is the hook's (`compareCertifications`, domain/certifications.ts), never this
// screen's — the same rule the preset list keeps. A screen that sorted would be a second
// comparator, free to disagree with the one the editor and the repository both read through.
it('lists every card in the order the hook hands them, never its own', async () => {
  stubSettings({
    certifications: [
      certification({ agency: 'SSI', course: 'Rescue Diver' }),
      certification({ agency: 'PADI', course: 'Open Water' }),
      certification({ agency: 'CMAS', course: 'Two Star' }),
    ],
  });
  const t = await render(<SettingsScreen />);

  expect(certificationRowNames(t)).toEqual([
    'SSI Rescue Diver',
    'PADI Open Water',
    'CMAS Two Star',
  ]);
});

// The row's name is `certificationLabel`'s (format/display.ts, §4.1), so a card holding only
// half of it still has a heading and a card holding neither is not a blank line.
it('names a card by whichever of its agency and course it has', async () => {
  stubSettings({
    certifications: [
      certification({ agency: 'SSI', course: null }),
      certification({ agency: null, course: 'Open Water' }),
      certification({ agency: null, course: null }),
    ],
  });
  const t = await render(<SettingsScreen />);

  expect(certificationRowNames(t)).toEqual(['SSI', 'Open Water', 'Certification']);
});

// The second line, from `formatCertificationSummary` — the card number and what its dates say.
it('shows a card’s number and dates under its name', async () => {
  stubSettings({
    certifications: [certification({ cardNumber: '1234567', issuedOn: '2018-07-14' })],
  });
  const t = await render(<SettingsScreen />);

  expect(textIn(t).join(' ')).toContain('#1234567 · issued 14 Jul 2018');
});

/**
 * **An expired card says so, and nothing else happens.** The fact is the whole of it: no
 * colour (§0.1 spends hue on depth alone), no icon, no banner. §3 gives *currency* and its
 * refresher sentence to the Stats screen, which is where a sentence telling a diver to go and
 * do something belongs.
 *
 * **The day comes from the mocked owner, and the two cards sit one day either side of it.**
 * That is what makes this an assertion about the SCREEN rather than about
 * `formatCertificationSummary`: a screen that read the clock itself — `new
 * Date().toISOString().slice(0, 10)`, the UTC day — would judge these rows against a different
 * day from the one the diver is having, which is the defect
 * `certifications.utc-plus-14.test.ts` demonstrates in full.
 */
it('says a card has expired, and says a live one expires, judged against the device’s day', async () => {
  (todayCalendarDate as jest.Mock).mockReturnValue('2026-09-04');
  stubSettings({
    certifications: [
      certification({ course: 'Oxygen Provider', expiresOn: '2026-09-03' }),
      certification({ course: 'First Aid', expiresOn: '2026-09-04' }),
    ],
  });
  const t = await render(<SettingsScreen />);
  const said = textIn(t).join(' ');

  expect(said).toContain('expired 3 Sep 2026');
  // The same day the device reports is still current: a certification is valid through its
  // printed date (`certificationExpiry`, domain/certifications.ts).
  expect(said).toContain('expires 4 Sep 2026');
});

/** And moving the device's day moves the verdict, which is the half that proves the screen is
 * reading it at all rather than having been handed a lucky fixture. */
it('follows the device’s day when it moves', async () => {
  (todayCalendarDate as jest.Mock).mockReturnValue('2026-09-05');
  stubSettings({ certifications: [certification({ expiresOn: '2026-09-04' })] });
  const t = await render(<SettingsScreen />);

  expect(textIn(t).join(' ')).toContain('expired 4 Sep 2026');
});

// A card holding nothing beyond its name draws no second line at all — a preset with no
// cylinders makes the same call one section up, because an empty second line under a name
// reads as a value that failed to load.
it('draws no second line for a card with nothing to put in it', async () => {
  stubSettings({ certifications: [certification({ agency: 'PADI', course: 'Rescue Diver' })] });
  const t = await render(<SettingsScreen />);

  expect(textIn(t)).toContain('PADI Rescue Diver');
  expect(textIn(t).join(' ')).not.toContain('issued');
  expect(textIn(t).join(' ')).not.toContain('#');
});

it('opens the editor for the card whose row was tapped', async () => {
  const wanted = certification({ agency: 'SSI', course: 'Rescue Diver' });
  stubSettings({ certifications: [certification({ agency: 'PADI', course: 'Open Water' }), wanted] });
  const t = await render(<SettingsScreen />);

  fireEvent.press(findCertificationRow(t, 'SSI Rescue Diver'));

  expect(mockPush).toHaveBeenCalledWith(`/certification/${wanted.id}`);
});

/**
 * **The wallet has a way in and the preset list does not**, which is the one structural
 * difference between the two sections. §10 puts preset creation in the dive form, "where the
 * cylinders are already typed"; a certification is copied off a plastic card with no dive
 * attached to it, so without this row the section would have no way to fill itself.
 */
it('offers a way to add a card, whether or not the wallet holds any', async () => {
  for (const cards of [[], [certification()]]) {
    stubSettings({ certifications: cards });
    const t = await render(<SettingsScreen />);
    expect(`${String(cards.length)}: ${String(buttonLabels(t).includes('Add a certification'))}`).toBe(
      `${String(cards.length)}: true`,
    );
  }
});

it('opens the editor in create mode from that row', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);

  fireEvent.press(findAddCertificationRow(t));

  expect(mockPush).toHaveBeenCalledWith('/certification/new');
});

/**
 * **A failed read is said, and it is not the same sentence as an empty wallet** —
 * `useCertifications`' `error` field exists for that distinction, and the sentence is the
 * editor's own (`CERTIFICATIONS_UNREADABLE`) rather than a second literal here.
 */
it('says the read failed rather than leaving an empty section', async () => {
  stubSettings({ certifications: [], certificationsError: new Error('no database') });
  const t = await render(<SettingsScreen />);

  expect(textIn(t).join(' ')).toContain("Couldn't load your certifications");
});

/**
 * **And nothing is said before there is an answer to say it about** (M1f) — the gate the
 * preset section keeps for its own pair, and the reason `resolved` exists at all. A screen
 * with no answer must not state one.
 *
 * The other half of the guard is the empty case: an unread wallet and an empty one must both
 * be silent, because the *Add* row already says what to do. That is what makes this different
 * from the presets, where the empty case has a sentence of its own.
 */
it('says nothing about the wallet before the read has answered, nor when it is simply empty', async () => {
  stubSettings({ certifications: [], certificationsResolved: false, certificationsError: new Error('x') });
  const unread = await render(<SettingsScreen />);
  expect(textIn(unread).join(' ')).not.toContain("Couldn't load your certifications");
  // The section still names itself, so nothing above the line moves when the line arrives.
  expect(textIn(unread).join(' ')).toContain('Certifications');

  stubSettings({ certifications: [], certificationsResolved: true });
  const empty = await render(<SettingsScreen />);
  expect(textIn(empty).join(' ')).not.toContain("Couldn't load your certifications");
  expect(textIn(empty).join(' ')).toContain('Certifications');
});

/**
 * **A failed read of one list must not blank the other**, which is why the two are separate
 * hooks (`useCertifications`' own docblock, quoting `useGearPresets`' at length). This is that
 * separation asserted through the screen rather than stated in a comment.
 */
it('keeps the presets when the wallet cannot be read, and the other way round', async () => {
  stubSettings({
    presets: [preset({ name: 'twin 12 steel' })],
    certifications: [],
    certificationsError: new Error('no database'),
  });
  const t = await render(<SettingsScreen />);
  expect(presetRowNames(t)).toEqual(['twin 12 steel']);

  stubSettings({
    presets: [],
    presetsError: new Error('no database'),
    certifications: [certification({ agency: 'PADI', course: 'Open Water' })],
  });
  const other = await render(<SettingsScreen />);
  expect(certificationRowNames(other)).toEqual(['PADI Open Water']);
});

// ---------------------------------------------------------------------------------------
// Scope and grammar
// ---------------------------------------------------------------------------------------

// §3 lists more under Settings — data export, delete account, language — and every one of them
// belongs to a later part of M3. This is a scope assertion, and it can fail: a stray control
// added here would show up as a fourth labelled field.
//
// **The list grows by §3's entries arriving, one deliberate edit at a time, and never by being
// loosened.** §3's location access is the third and arrived in M2m — a row whose label is a
// setting's label because it reports a value, even though the value belongs to the operating
// system and this screen cannot write it. Cylinder presets are a §3 entry too and are NOT here,
// because they are a LIST rather than a setting and carry a section heading instead of a field
// label; **§3's certification wallet arrived in M3b and is NOT here for exactly that reason**,
// which is the point of this assertion rather than an exception to it — an entry landing on
// this screen has to be classified as a setting or as a list, and the wallet is a list. Account
// & sync likewise, as a destination in full ink. "Fields I use" was on this list until M1i
// dropped it from v1 (§2.2, §9) — it is not a later milestone, it is not coming, and this test
// should not start expecting it.
it('carries §3’s three labelled settings and no more', async () => {
  stubSettings({
    presets: [preset({ name: 'twin 12 steel' })],
    certifications: [certification()],
  });
  const t = await render(<SettingsScreen />);
  const labels = t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formFieldLabel)) : [];
  expect(labels.flatMap((n) => n.children)).toEqual(['Units', 'Dives before Ponor', 'Location access']);
  expect(textIn(t)).toContain('Cylinder presets');
  // And the wallet really is on screen while that list stays at three, so this cannot pass
  // because the section failed to render at all.
  expect(textIn(t)).toContain('Certifications');
});

// §0.6, and the reason the screen borrows the form's components rather than restating them:
// "The form is the dive detail you can type into", and Settings is that same grammar asking
// about the app. Both rows must be the form's own `formField` row — a screen that drew its
// own boxes would look right in a screenshot and be a third vocabulary in the code.
// Seven rows with one preset and one card: Units, Dives before Ponor, the preset's own, §3's
// location access, the card's own, *Add a certification* and §3's account & sync — every one of
// them the same `formField` row, so a preset, a card, a report, an action and a destination are
// rows of this screen rather than new kinds of object drawn beside them.
it('uses the form’s own row grammar rather than inventing a third one', async () => {
  stubSettings({
    presets: [preset({ name: 'twin 12 steel' })],
    certifications: [certification()],
  });
  const t = await render(<SettingsScreen />);
  const rows = t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formField)) : [];
  expect(rows).toHaveLength(7);
});

// §0.6: "Figures in mono, names in sans." A dive count is a figure, and the keypad it asks
// for has no separator key — the same pairing `FormField`'s own docblock records for a
// cylinder count, and the same reason `parseDiveCount` accepts decimal digits only.
it('sets the count in mono, on a keypad with no decimal separator', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const field = findCountField(t);
  expect([field.props.style].flat(5)).toContain(makeStyles('light').formFieldInputMono);
  expect(field.props.keyboardType).toBe('number-pad');
});

// The owner's report, from the running app: "the `Units` label sits roughly 11 pt below the
// hairline above it, where `Dives before Ponor` gets roughly 24 pt. It reads as touching the
// rule."
//
// Both rows already drew their own top hairline (`formField`) — the first group was not
// exempted from anything. What differed is what each row holds. A field whose value TRAILS
// gets its label's position for free: the input's own 48 dp floor sets the line's height and
// `formField`'s `justifyContent: 'center'` centres the label in it. *Units* is a chip field,
// so its value is stacked underneath and the field's content is past 48 before the label is
// measured — the centring is a no-op and the line was as tall as the label text alone.
// `formFieldRow` carries the floor now (theme/styles.ts, and styles.test.ts ties it to the
// input's own), so the label sits in the same place in either kind of field.
//
// Asserted through the screen rather than off the sheet: what makes the difference here is
// that the chip field's label line is the SHARED row, and a component that drew its label in
// a wrapper of its own would satisfy every assertion in styles.test.ts while leaving *Units*
// exactly where the owner found it.
it('gives the first group’s label the same room off the rule as the second’s', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const styles = makeStyles('light');

  const rowOf = (label: string) => {
    const [text] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children.includes(label)) : [];
    if (!text) throw new Error(`SettingsScreen rendered no ${label} label`);
    const row = text.parent;
    if (!row) throw new Error(`the ${label} label sits in no row at all`);
    return row;
  };

  for (const label of ['Units', 'Dives before Ponor']) {
    expect([rowOf(label).props.style].flat(5)).toContain(styles.formFieldRow);
  }
  expect(styles.formFieldRow.minHeight).toBe(48);
});

// **Settings is the other screen under the tab bar, and it was carrying the form's number**
// (M1h). `settingsContent` and `formScrollContent` were one definition with `paddingBottom: 40`
// — right for the form, whose scroll stops at a `formFooter` that spends `insets.bottom + 24`
// itself, and 43 pt short here, where the ScrollView is its root's only child and runs to the
// bottom of the display. On the Dives list that same mistake put the last row under the Liquid
// Glass with its site name cut mid-word; here it is invisible today only because two settings
// and no presets do not reach the bottom of the screen. That is not a reason to leave it —
// it is precisely how the list's copy survived until a logbook grew long enough to scroll.
//
// Two devices, and the clearance required to follow both, exactly as the Dives list's own test
// does it: a constant — including a corrected constant — satisfies neither pair.
it('spends the device bottom inset on its scroll, so the last row clears the tab bar', async () => {
  const clearanceOn = async (bottom: number) => {
    stubSettings();
    const t = await render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom } }}
      >
        <SettingsScreen />
      </SafeAreaProvider>,
    );
    // Found by the prop itself rather than by `onScroll`: this is a plain ScrollView, and RN
    // attaches no scroll handler to one that was given none.
    const [scroll] = t.root ? t.root.queryAll((n) => n.props?.contentContainerStyle !== undefined) : [];
    if (!scroll) throw new Error('SettingsScreen did not render a scrollable node');
    const style = [scroll.props.contentContainerStyle].flat(5).filter(Boolean) as Record<string, unknown>[];
    // LAST wins, the order RN resolves a style array in.
    const paddingBottom = style.reduce<unknown>((acc, s) => (s.paddingBottom !== undefined ? s.paddingBottom : acc), undefined);
    // None at all is its own defect — the last row flush against the bottom of the display.
    if (typeof paddingBottom !== 'number') throw new Error('SettingsScreen composed no clearance');
    return paddingBottom;
  };

  const underTabBar = await clearanceOn(83);
  const underNothing = await clearanceOn(0);

  // The rule: at least everything the device reports as obscured. The inherited 40 fails it.
  expect(underTabBar).toBeGreaterThanOrEqual(83);
  // The floor still holds where the device reports nothing.
  expect(underNothing).toBeGreaterThanOrEqual(screenBottomInset(0));
  // ...and it tracks the device, which is the half no constant can do.
  expect(underTabBar).toBeGreaterThan(underNothing);
});

// ---------------------------------------------------------------------------------------
// Account & sync (DESIGN.md §3, M2e)
// ---------------------------------------------------------------------------------------

// **The only route into the account screen at all.** §1 makes an account optional, so there is
// deliberately no launch screen, no prompt and no other entry point — which means this one row
// is the whole of "reachable". A screen nothing opens is the same defect as a control that does
// nothing, and it is the harder one to see: every test of `AccountScreen` would stay green.
it('opens the account screen, which nothing else in the app does', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const [row] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === 'Open account & sync') : [];
  if (!row) throw new Error('SettingsScreen rendered no account row');

  await fireEvent.press(row);

  // The absolute path, which is what expo-router's typed routes check against the routes that
  // actually exist on disk.
  expect(mockPush).toHaveBeenCalledWith('/account');
});

// §3's own words. A row labelled anything else would still navigate, and a diver looking for
// where an account lives would not find it.
it('names the row the way §3 names it', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);

  expect(textIn(t)).toContain('Account & sync');
});

// **It is a destination, not a setting, and the ink is what says so** (§0.6: "ink versus muted
// ink is the only lever" — §0.1 rules out a hue, and the chevron "is never spent on
// navigation"). Asserted by identity against the sheet and CONTRASTED with a real setting's
// label, because the assertion that matters is the difference: a row that took `formFieldLabel`
// would be indistinguishable from `Units` with its value missing.
it('reads as a destination rather than as a setting with no value', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const styles = makeStyles('light');

  const labelStyleOf = (label: string) => {
    const [text] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children.includes(label)) : [];
    if (!text) throw new Error(`SettingsScreen rendered no ${label} label`);
    return text.props.style;
  };

  expect(labelStyleOf('Account & sync')).toBe(styles.settingsAccountLabel);
  expect(labelStyleOf('Account & sync')).not.toBe(labelStyleOf('Units'));
});

// ---------------------------------------------------------------------------------------
// Location access (DESIGN.md §3, M2m)
// ---------------------------------------------------------------------------------------

/** What the row announces, read off the label rather than off the value node — the same
 * `label: value` shape the form's own read-back rows announce, so this asserts the sentence a
 * screen reader hears and not merely a string that happens to be on screen somewhere. */
function locationStatus(t: RenderResult): string {
  const [node] = t.root
    ? t.root.queryAll((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Location access: '))
    : [];
  if (!node) throw new Error('SettingsScreen rendered no location row');
  return String(node.props.accessibilityLabel).slice('Location access: '.length);
}

function findLocationRow(t: RenderResult) {
  const [node] = t.root
    ? t.root.queryAll((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Location access: '))
    : [];
  if (!node) throw new Error('SettingsScreen rendered no location row');
  return node;
}

/**
 * **The five states, and the five different things they say.**
 *
 * §3's row exists because iOS asks once ever, and `platform/locationPermission.ts` answers in
 * five states because each one sends the diver somewhere different. **A row that collapsed
 * them into on/off is the defect that module's vocabulary exists to prevent**, so the words
 * are written out here rather than read back from the screen's own table: an assertion built
 * from `LOCATION_ROW_TEXT` would be satisfied by two states sharing one sentence, which is
 * exactly the failure worth catching. Distinct literals cannot be.
 */
const LOCATION_LINES: [LocationPermissionState, string, string][] = [
  ['granted', 'Allowed', 'Ponor can pin a dive where you are. Open Settings to change that.'],
  [
    'denied',
    'Not allowed',
    'Ponor may not use your location. iOS asks once and never again, so Settings is the only place this can change.',
  ],
  [
    'undetermined',
    'Not asked yet',
    'Nobody has been asked yet — Ponor asks the first time you use it on a dive.',
  ],
  [
    'servicesOff',
    'Location Services off',
    'Location Services are off for the whole device, so nothing on it can be located. That switch is the device’s, not Ponor’s.',
  ],
  ['unknown', 'Unknown', 'Ponor couldn’t check where this stands. Settings will show it.'],
];

// The completeness half, borrowed from `locationPermission.test.ts`'s own last case: a sixth
// state added to that module is a compile error inside the screen (its table is a `Record`
// over the union) and would be a silent gap here, since a sweep can only sweep what it lists.
it('covers every permission state the module declares, not the ones this file remembers', () => {
  expect(LOCATION_LINES.map(([state]) => state).sort()).toEqual([...LOCATION_PERMISSION_STATES].sort());
});

it.each(LOCATION_LINES)('reports a %s permission as “%s”, and says what that means', async (permission, status, note) => {
  stubSettings({ permission });
  const t = await render(<SettingsScreen />);

  await waitFor(() => expect(locationStatus(t)).toBe(status));
  expect(textIn(t)).toContain(note);
});

/**
 * **§3's own rule: "Reading the status must not request it."**
 *
 * iOS spends its one permission sheet on whoever asks first, so a Settings row that "checked"
 * by requesting would raise a system sheet on a screen the diver merely opened — and burn the
 * prompt §2.3's *use my location* is waiting to spend. `platform/locationPermission.ts` is
 * split into a read and an ask for exactly this, and the ask is the half this screen must not
 * touch at all.
 *
 * Every gesture the row has is made below, so this is a claim about the screen rather than
 * about one render: opening it, pressing the row, and coming back from Settings.
 */
it('never asks for the permission it is only reporting', async () => {
  stubSettings({ permission: 'undetermined' });
  const t = await render(<SettingsScreen />);
  await waitFor(() => expect(locationStatus(t)).toBe('Not asked yet'));

  await fireEvent.press(findLocationRow(t));
  await returnToForeground();

  expect(mockRequestLocationPermission).not.toHaveBeenCalled();
  // ...and the reading half really was used, so this is not a screen that asked nothing at all.
  expect(mockLocationPermission).toHaveBeenCalled();
});

/**
 * **The whole point of the row, and the thing a single render cannot show.**
 *
 * The diver presses it, changes the switch in the system Settings app, and comes back. Nothing
 * in this app observes that change — it happened in another one — so a row that read the
 * permission on mount and never again would sit reporting the old answer for as long as the
 * screen lived, which is the same dead-control shape §0.6 has recorded three times.
 *
 * **The middle assertion is what makes this falsifiable.** A test that changed the stub and
 * then asserted the new value would pass against a screen that re-read on every render, on a
 * timer, or by accident; asserting that the row does NOT move until the app comes back pins
 * the re-read to the return. Delete `useForegroundReturn` from the screen and the last
 * assertion fails; delete the mount read and the first one does.
 */
it('re-reads the permission when the diver comes back from Settings', async () => {
  stubSettings({ permission: 'denied' });
  const t = await render(<SettingsScreen />);
  await waitFor(() => expect(locationStatus(t)).toBe('Not allowed'));

  // The diver allows it in the device's Settings. Nothing has told this screen yet.
  stubSettings({ permission: 'granted' });
  expect(locationStatus(t)).toBe('Not allowed');

  await returnToForeground();

  expect(locationStatus(t)).toBe('Allowed');
  expect(textIn(t)).toContain('Ponor can pin a dive where you are. Open Settings to change that.');
  // Twice: once on arrival, once on the return. Whether a given `AppState` event counts as a
  // return is `hooks/useForegroundReturn.ts`'s rule and is tested there rather than restated
  // here.
  expect(mockLocationPermission).toHaveBeenCalledTimes(2);
});

/**
 * M1f's rule, on the one row where breaking it is quietest: **a screen with no answer must not
 * state one.** "Not read yet" and "denied" are both "not granted", so a row that defaulted to
 * either would tell a diver where they stand before anyone had looked — and this row's entire
 * job is where they stand.
 */
it('says nothing about the permission until the read answers', async () => {
  stubSettings();
  // A read that has not come back — the state every render before the first answer is in.
  mockLocationPermission.mockImplementation(() => new Promise<never>(() => {}));
  const t = await render(<SettingsScreen />);

  expect(locationStatus(t)).toBe('Checking…');
  for (const [, , note] of LOCATION_LINES) expect(textIn(t).join(' ')).not.toContain(note);
});

// §3: the row "takes them to the system Settings app", which is the only place the answer can
// change. Asserted on the call rather than on anything visible, because leaving the app is the
// one thing this screen does that leaves no mark on it.
it('opens the device’s own Settings when the row is pressed', async () => {
  stubSettings({ permission: 'denied' });
  const t = await render(<SettingsScreen />);
  await waitFor(() => expect(locationStatus(t)).toBe('Not allowed'));

  await fireEvent.press(findLocationRow(t));

  expect(mockOpenSettings).toHaveBeenCalledTimes(1);
});

/**
 * §1, in the direction this row can actually fail: **nothing here may leave a diver pressing a
 * control that does nothing.** `openSettings` rejects where the platform has no such page — a
 * browser has none at all (§9's testing target) — and a press that silently swallowed that is
 * the dead control the row was built to fix, reappearing inside the fix.
 */
it('says so when Settings could not be opened, rather than doing nothing', async () => {
  stubSettings({ permission: 'denied' });
  mockOpenSettings.mockImplementation(() => Promise.reject(new Error('no settings app')));
  const t = await render(<SettingsScreen />);
  await waitFor(() => expect(locationStatus(t)).toBe('Not allowed'));

  await fireEvent.press(findLocationRow(t));

  await waitFor(() => expect(textIn(t).join(' ')).toContain('Couldn’t open Settings from here'));
  // The status is untouched: the permission has not changed, only the way out of the app
  // failed, and a row that also blanked what it knew would be reporting the wrong failure.
  expect(locationStatus(t)).toBe('Not allowed');
});

// The other half of that sentence's life: it stands for exactly as long as it is still true.
// Cleared at the START of the next attempt, the same rule the form's own refusal note follows
// — never on a timer and never by a dismiss control, neither of which this row has.
it('drops that complaint when the next press works', async () => {
  stubSettings({ permission: 'denied' });
  mockOpenSettings.mockImplementation(() => Promise.reject(new Error('no settings app')));
  const t = await render(<SettingsScreen />);
  await waitFor(() => expect(locationStatus(t)).toBe('Not allowed'));
  await fireEvent.press(findLocationRow(t));
  await waitFor(() => expect(textIn(t).join(' ')).toContain('Couldn’t open Settings from here'));

  mockOpenSettings.mockImplementation(() => Promise.resolve());
  await fireEvent.press(findLocationRow(t));

  await waitFor(() => expect(textIn(t).join(' ')).not.toContain('Couldn’t open Settings from here'));
});

/**
 * **It is a setting that reports, and the ink is what says so** (§0.6's "ink versus muted ink
 * is the only lever"). The label is muted like *Units*' own, because this row holds a value;
 * the value is the value column's full ink, like the account screen's address. Contrasted with
 * the two rows either side of it, since the assertion that matters is the difference: a label
 * in `settingsAccountLabel` would read as a destination that had lost its value, and a value
 * left in the muted placeholder ink would read as a row still loading.
 */
it('reads as a setting with a value rather than as a destination', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const styles = makeStyles('light');
  await waitFor(() => expect(locationStatus(t)).toBe('Allowed'));

  const styleOf = (label: string) => {
    const [text] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children.includes(label)) : [];
    if (!text) throw new Error(`SettingsScreen rendered no ${label} text`);
    return text.props.style;
  };

  expect(styleOf('Location access')).toBe(styles.formFieldLabel);
  expect(styleOf('Allowed')).toBe(styles.settingsLocationStatus);
  expect(styles.settingsLocationStatus).not.toBe(styles.settingsLocationStatusUnread);
});

// And the placeholder wears the other one, which is what keeps "not read yet" from looking
// like an answer at a glance rather than only to a reader of the word.
it('draws the unread placeholder in the muted ink an answer never takes', async () => {
  stubSettings();
  mockLocationPermission.mockImplementation(() => new Promise<never>(() => {}));
  const t = await render(<SettingsScreen />);

  const [text] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children.includes('Checking…')) : [];
  if (!text) throw new Error('SettingsScreen rendered no unread placeholder');
  expect(text.props.style).toBe(makeStyles('light').settingsLocationStatusUnread);
});
