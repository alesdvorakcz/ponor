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

import { db } from '../db/client';
import { setDivesBefore, setUnitSystem } from '../db/settings';
import { useDivesBefore } from '../db/useDivesBefore';
import { useUnitSystem } from '../db/useUnitSystem';
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
const mockSetUnitSystem = setUnitSystem as jest.Mock;
const mockSetDivesBefore = setDivesBefore as jest.Mock;

/** Both reads at once, so no test can forget one and render against `undefined`. */
function stubSettings({ units = 'metric', divesBefore = 0 }: { units?: string; divesBefore?: number | null } = {}) {
  mockUseUnitSystem.mockImplementation(() => units);
  mockUseDivesBefore.mockImplementation(() => divesBefore);
}

beforeEach(() => {
  mockSetUnitSystem.mockImplementation(() => Promise.resolve());
  mockSetDivesBefore.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  mockUseUnitSystem.mockReset();
  mockUseDivesBefore.mockReset();
  mockSetUnitSystem.mockReset();
  mockSetDivesBefore.mockReset();
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

// `useDivesBefore()` resolves asynchronously — the first render always sees the "no row yet"
// answer and the real value arrives a moment later — so a field seeded once on mount would
// leave a diver with 247 prior dives looking at a 0 that is not what is stored. Proven by
// rendering, then changing what the hook returns and re-rendering, which is exactly the
// sequence the real hook produces.
it('shows the stored count, and follows it when it arrives late', async () => {
  stubSettings({ divesBefore: 0 });
  const t = await render(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('0');

  stubSettings({ divesBefore: 247 });
  await t.rerender(<SettingsScreen />);
  expect(findCountField(t).props.value).toBe('247');
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
// Scope and grammar
// ---------------------------------------------------------------------------------------

// §3 lists far more under Settings — "Fields I use", gear presets, the certification
// wallet, account and sync, export, delete account — and every one of them belongs to a
// later milestone. This is a scope assertion, and it can fail: a stray control added here
// would show up as a third labelled field.
it('carries M1’s two settings and no more', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const labels = t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formFieldLabel)) : [];
  expect(labels.flatMap((n) => n.children)).toEqual(['Units', 'Dives before Ponor']);
});

// §0.6, and the reason the screen borrows the form's components rather than restating them:
// "The form is the dive detail you can type into", and Settings is that same grammar asking
// about the app. Both rows must be the form's own `formField` row — a screen that drew its
// own boxes would look right in a screenshot and be a third vocabulary in the code.
it('uses the form’s own row grammar rather than inventing a third one', async () => {
  stubSettings();
  const t = await render(<SettingsScreen />);
  const rows = t.root ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formField)) : [];
  expect(rows).toHaveLength(2);
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
