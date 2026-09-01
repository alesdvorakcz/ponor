// The package's own official Jest mock — this screen now calls useSafeAreaInsets() for its
// root's top clearance (`screenTopInset`, theme/styles.ts), gets a real SafeAreaProvider for
// free from expo-router's root layout in the app, and has none when rendered bare here.
// Imported first, and named `mock...`, for the babel-plugin-jest-hoist reason
// DiveFormScreen.test.tsx records: a jest.mock() factory may only close over out-of-scope
// identifiers starting with `mock`/`require`, and every jest.mock() call is hoisted above
// every import regardless. Left on the mock's own zero insets by every test in this file:
// where the clearance actually LANDS is `styles.test.ts`'s rule to pin, not a number to
// restate here.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';

import { db } from '../db/client';
import { setDivesBefore, setUnitSystem } from '../db/settings';
import { useDivesBefore } from '../db/useDivesBefore';
import { useGearPresets } from '../db/useGearPresets';
import { useUnitSystem } from '../db/useUnitSystem';
import { type GearPreset, type Tank } from '../domain/types';
import { formatCylinders } from '../format/display';
import { UNIT_SYSTEMS } from '../format/units';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
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

const mockUseUnitSystem = useUnitSystem as jest.Mock;
const mockUseDivesBefore = useDivesBefore as jest.Mock;
const mockUseGearPresets = useGearPresets as jest.Mock;
const mockSetUnitSystem = setUnitSystem as jest.Mock;
const mockSetDivesBefore = setDivesBefore as jest.Mock;
const mockPush = router.push as jest.Mock;

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
  deletedAt: null,
  ...over,
});

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: null, sizeL: null, count: null, workingBar: null,
  o2Pct: null, hePct: null, startBar: null, endBar: null, ...over,
});

/** All three reads at once, so no test can forget one and render against `undefined`.
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
  divesBeforeResolved = true,
}: {
  units?: string;
  divesBefore?: number | null;
  presets?: GearPreset[];
  presetsError?: Error;
  presetsResolved?: boolean;
  divesBeforeResolved?: boolean;
} = {}) {
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
}

beforeEach(() => {
  mockSetUnitSystem.mockImplementation(() => Promise.resolve());
  mockSetDivesBefore.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  mockUseUnitSystem.mockReset();
  mockUseDivesBefore.mockReset();
  mockUseGearPresets.mockReset();
  mockSetUnitSystem.mockReset();
  mockSetDivesBefore.mockReset();
  mockPush.mockReset();
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
  const tanks = [tank({ material: 'steel', sizeL: 12, count: 2, workingBar: 232, o2Pct: 32 })];
  stubSettings({ presets: [preset({ name: 'twin 12 steel', tanks })] });
  const t = await render(<SettingsScreen />);
  expect(textIn(t)).toContain('2 × 12 l Steel · 232 bar · O₂ 32 %');
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
it('carries no delete of its own, so the list stays a list', async () => {
  stubSettings({ presets: [preset({ name: 'twin 12 steel' })] });
  const t = await render(<SettingsScreen />);
  const labels = buttonLabels(t).filter((label) => !label.startsWith('Units: '));
  expect(labels).toEqual(['Edit preset twin 12 steel']);
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
// Scope and grammar
// ---------------------------------------------------------------------------------------

// §3 lists far more under Settings — "Fields I use", the certification wallet, account and
// sync, export, delete account — and every one of them belongs to a later milestone. This is
// a scope assertion, and it can fail: a stray control added here would show up as a third
// labelled field. Cylinder presets are the one §3 entry that has arrived, and they are a
// LIST rather than a setting, so they carry a section heading instead of a field label.
it('carries M1’s two settings and no more', async () => {
  stubSettings({ presets: [preset({ name: 'twin 12 steel' })] });
  const t = await render(<SettingsScreen />);
  const labels = t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formFieldLabel)) : [];
  expect(labels.flatMap((n) => n.children)).toEqual(['Units', 'Dives before Ponor']);
  expect(textIn(t)).toContain('Cylinder presets');
});

// §0.6, and the reason the screen borrows the form's components rather than restating them:
// "The form is the dive detail you can type into", and Settings is that same grammar asking
// about the app. Both rows must be the form's own `formField` row — a screen that drew its
// own boxes would look right in a screenshot and be a third vocabulary in the code.
// Three rows with one preset: Units, Dives before Ponor, and the preset's own — which wears
// the same `formField` row as the two settings above it, so a preset is a row of this screen
// rather than a new kind of object drawn beside them.
it('uses the form’s own row grammar rather than inventing a third one', async () => {
  stubSettings({ presets: [preset({ name: 'twin 12 steel' })] });
  const t = await render(<SettingsScreen />);
  const rows = t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formField)) : [];
  expect(rows).toHaveLength(3);
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
