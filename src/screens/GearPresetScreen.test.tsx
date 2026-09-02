// The package's own official Jest mock — this screen's root asks the device for its top
// clearance (`screenTopInset`, theme/styles.ts), gets a real SafeAreaProvider for free from
// expo-router's root layout in the app, and has none when rendered bare here. Imported
// first, and named `mock...`, for the babel-plugin-jest-hoist reason DiveFormScreen.test.tsx
// records: a jest.mock() factory may only close over out-of-scope identifiers starting with
// `mock`/`require`, and every jest.mock() call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';

import { softDeleteGearPreset, updateGearPreset } from '../db/gearPresets';
import { confirmDestructive, type DestructiveConfirmation } from '../platform/confirmDestructive';
import { useGearPresets } from '../db/useGearPresets';
import { useUnitSystem } from '../db/useUnitSystem';
import { db } from '../db/client';
import { formatConfiguration, formatTankMaterial, HE_LABEL, O2_LABEL } from '../format/display';
import { UNKNOWN_OPTION_NOTE } from '../domain/diveFormSchema';
import { PRESETS_UNREADABLE } from '../domain/presets';
import { CONFIGURATION_VALUES, TANK_MATERIAL_VALUES, type GearPreset, type Tank } from '../domain/types';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import GearPresetScreen from './GearPresetScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
// The two live reads, mocked per module exactly as every other screen test mocks its own:
// both are database reads, and this screen must be renderable against any stored preset, in
// either unit system, without one.
jest.mock('../db/useGearPresets', () => ({ useGearPresets: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
// Only the two WRITES are stubbed. `jest.requireActual` keeps everything else real —
// notably nothing this screen calls, but a partial mock is what stops a later import from
// silently resolving to `undefined` rather than failing loudly.
jest.mock('../db/gearPresets', () => ({
  ...jest.requireActual('../db/gearPresets'),
  updateGearPreset: jest.fn(),
  softDeleteGearPreset: jest.fn(),
}));
/**
 * **The owner of the destructive confirmation, mocked as the owner.**
 *
 * The obvious thing is to spy on `Alert.alert` and read the button list off it, which is what
 * `DiveDetailScreen.test.tsx` does — but there that spy is deliberate and means something else:
 * it was the proof that the pre-existing `Alert.alert` call had been *moved* into
 * `platform/confirmDestructive.ts` unchanged. That reasoning does not transfer to a new call
 * site, whose requirement is to USE the owner. Spying one layer down leaves the test green
 * against a screen that inlines `Alert.alert(...)` itself — and `Alert.alert` is an empty
 * function in `react-native-web`, so that screen would ship a *Delete preset* control that
 * silently deletes nothing in a browser. That is the precise regression this module was
 * created to end (*Delete dive* opened no dialog on web until it existed, DESIGN.md §9).
 *
 * What the platform actually draws is that module's own business, and is still pinned where it
 * belongs: `DiveDetailScreen.test.tsx` runs the real `confirmDestructive` and reads the
 * `cancel`/`destructive` button pair off `Alert.alert`.
 */
jest.mock('../platform/confirmDestructive', () => ({ confirmDestructive: jest.fn() }));
// Leaving the screen goes through `backToSettings` (navigation/leaveScreen.ts), which calls
// canGoBack()/back()/replace() — the same shape DiveDetailScreen.test.tsx already mocks.
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockUseGearPresets = useGearPresets as jest.Mock;
const mockUseUnitSystem = useUnitSystem as jest.Mock;
const mockUpdate = updateGearPreset as jest.Mock;
const mockSoftDelete = softDeleteGearPreset as jest.Mock;
const mockBack = router.back as jest.Mock;
const mockCanGoBack = router.canGoBack as jest.Mock;
const mockReplace = router.replace as jest.Mock;
const mockConfirm = confirmDestructive as jest.Mock;

let presetSeq = 0;
/** A `GearPreset` with only the fields a case cares about. Ids come from a counter for the
 * reason `diveFixture`'s own do: two presets built with identical arguments must still be
 * distinct, since this screen finds its subject by id. */
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

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: null,
  sizeL: null,
  configuration: null,
  workingBar: null,
  o2Pct: null,
  hePct: null,
  startBar: null,
  endBar: null,
  ...over,
});

/**
 * The same `mockImplementation`-not-`mockReturnValue` discipline every stub in this codebase
 * keeps, and for the reason `stubDives` (DiveFormScreen.test.tsx) records at length: the real
 * hook builds its list with `toGearPresets(rows)`, which is `rows.map(...).sort(...)` — a
 * brand-new array whenever the memo's input changes — so a stub handing back one
 * referentially-stable array forever would model a contract the hook does not have, and this
 * screen holds state keyed off what it reads.
 *
 * `resolved` defaults to TRUE, and every call below that omits it means exactly that: it is
 * about what this screen shows once the read has produced an answer. The renders BEFORE that
 * answer are their own describe block ("before the preset read has answered"), which passes
 * `false` explicitly — so this default cannot quietly re-hide the defect that block exists for.
 */
function stubPresets(presets: GearPreset[] = [], error?: Error, resolved = true) {
  mockUseGearPresets.mockImplementation(() => ({ presets: [...presets], error, resolved }));
}

beforeEach(() => {
  jest.clearAllMocks();
  stubPresets();
  // The owner is replaced wholesale, so nothing here draws a dialog — a test that wants the
  // diver to say yes runs the `onConfirm` the screen handed it (`confirmDelete` below).
  mockConfirm.mockImplementation(() => {});
  // Set explicitly rather than left to the module factory's own defaults: `clearAllMocks`
  // clears calls but not return values, so one test's override would otherwise leak into
  // every test declared after it.
  mockCanGoBack.mockReturnValue(true);
  mockUseUnitSystem.mockReturnValue('metric');
  mockUpdate.mockImplementation((_db: unknown, _id: string, patch: unknown) => Promise.resolve(patch));
  mockSoftDelete.mockImplementation(() => Promise.resolve());
});

// ---------------------------------------------------------------------------------------
// Queries. Every one matches a WHOLE announced label, never a substring — the trap that
// made this milestone's capture control name itself around a test helper
// (`findSaveControl`, DiveFormScreen.test.tsx). This screen shows *Save preset* and
// *Delete preset* one scroll apart, and a substring match on "preset" would find whichever
// came first in tree order.
// ---------------------------------------------------------------------------------------

function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.type === 'Text') : [])
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function buttonsOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
}

function buttonLabels(t: RenderResult): string[] {
  return buttonsOf(t).map((n) => String(n.props?.accessibilityLabel ?? ''));
}

function findControl(t: RenderResult, label: string) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === label);
}

async function press(t: RenderResult, label: string) {
  const node = findControl(t, label);
  if (!node) throw new Error(`GearPresetScreen rendered no control labelled "${label}"`);
  await fireEvent.press(node);
}

function inputsOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'TextInput') : [];
}

function findField(t: RenderResult, label: string) {
  return inputsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === label);
}

async function typeInto(t: RenderResult, label: string, value: string) {
  const input = findField(t, label);
  if (!input) throw new Error(`GearPresetScreen rendered no field labelled "${label}"`);
  await fireEvent.changeText(input, value);
}

/** The cylinders this screen asked the repository to store. */
function writtenTanks(): Tank[] | undefined {
  return (mockUpdate.mock.calls[0]?.[2] as { tanks?: Tank[] } | undefined)?.tanks;
}

/** The question this screen asked the one owner of destructive chrome. */
function askedConfirmation(): DestructiveConfirmation | undefined {
  return mockConfirm.mock.calls[0]?.[0] as DestructiveConfirmation | undefined;
}

/** Presses Delete and then answers the confirmation the way a diver who means it would — by
 * running the `onConfirm` the screen handed the owner, which is the only path that deletes
 * anything. */
async function confirmDelete(t: RenderResult) {
  await press(t, 'Delete preset');
  const asked = askedConfirmation();
  if (!asked) throw new Error('the screen asked for no confirmation at all');
  await act(async () => {
    asked.onConfirm();
  });
}

/** The one preset this screen is opened on, already stubbed as the whole live list. */
async function open(target: GearPreset, others: GearPreset[] = []) {
  stubPresets([target, ...others]);
  return render(<GearPresetScreen presetId={target.id} />);
}

const twin12 = () =>
  preset({
    name: 'twin 12 steel',
    tanks: [tank({ material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232, o2Pct: 32 })],
  });

// ---------------------------------------------------------------------------------------
// What the editor shows (DESIGN.md §3, §10: "a real editor, name and cylinders both")
// ---------------------------------------------------------------------------------------

it('seeds every field from the stored preset', async () => {
  const t = await open(twin12());
  expect(findField(t, 'Preset name')?.props?.value).toBe('twin 12 steel');
  expect(findField(t, 'Size')?.props?.value).toBe('12');
  // The rig is a chip row now, not a typed count (§10) — so the assertion is on the chip's
  // own selected state, exactly as `Material` beside it.
  expect(findControl(t, `Configuration: ${formatConfiguration('twinset')}`)?.props?.accessibilityState?.selected).toBe(true);
  expect(findControl(t, `Configuration: ${formatConfiguration('single')}`)?.props?.accessibilityState?.selected).toBe(false);
  expect(findField(t, 'Working pressure')?.props?.value).toBe('232');
  expect(findField(t, O2_LABEL)?.props?.value).toBe('32');
  // The material is a chip row, and "the chosen thing is the inverted thing" (§0.6) is what
  // a diver actually sees — so the assertion is on the chip's own selected state.
  expect(findControl(t, `Material: ${formatTankMaterial('steel')}`)?.props?.accessibilityState?.selected).toBe(true);
  expect(findControl(t, `Material: ${formatTankMaterial('alu')}`)?.props?.accessibilityState?.selected).toBe(false);
});

// A preset stores neither pressure (§10: "a preset that filled in 200 bar would be inventing
// a reading"), so offering the field would ask the diver for a value that is thrown away on
// the way to the database.
it('offers no start or end pressure, because a preset stores neither', async () => {
  const t = await open(twin12());
  expect(findField(t, 'Start pressure')).toBeUndefined();
  expect(findField(t, 'End pressure')).toBeUndefined();
});

// §4.1's one deliberate exception is duplicated field LABELS awaiting i18next — "they agree
// today, and each is one edit from becoming the `O2 %` / `O₂` drift again". This is the
// assertion that keeps them agreeing: the whole list, in order, so a renamed or added field
// fails here rather than one screen later. `O2_LABEL`/`HE_LABEL` come through the constants
// that already own those two.
it('names exactly the fields a preset holds, in the dive form’s own words', async () => {
  const t = await open(twin12());
  expect(inputsOf(t).map((n) => String(n.props?.accessibilityLabel ?? ''))).toEqual([
    'Preset name',
    'Size',
    'Working pressure',
    O2_LABEL,
    HE_LABEL,
  ]);
  expect(textIn(t)).toContain('Material');
  expect(textIn(t)).toContain('Configuration');
});

// §10: "Creation stays in the form, where the cylinders are already typed — that is the work
// the preset exists to remove." A scope assertion, and it can fail: an "Add preset" control
// added here would show up as a fifth button.
it('offers no way to create a preset here', async () => {
  const t = await open(twin12());
  const chipRows = ['Material: ', 'Configuration: '];
  expect(buttonLabels(t).filter((label) => !chipRows.some((prefix) => label.startsWith(prefix)))).toEqual([
    'Leave without saving',
    'Delete preset',
    'Save preset',
  ]);
});

// §0.6: "Leaving a screen has one treatment everywhere", and the reason it is asserted at all
// — "a form with no visible way out was shipped once and only found by using the app: swipe-
// back worked, so every test passed and nothing on screen said you could leave."
it('offers a visible way out that writes nothing', async () => {
  const t = await open(twin12());
  await typeInto(t, 'Preset name', 'something else');
  await press(t, 'Leave without saving');
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockSoftDelete).not.toHaveBeenCalled();
});

/**
 * **Which exit this screen calls, both branches.** `backToSettings` and `backToDives` are the
 * same guard over two different fallbacks (`leaveTo`, navigation/leaveScreen.ts), so the
 * `canGoBack === false` branch is the ONLY thing that tells them apart — and with `canGoBack`
 * mocked true everywhere, importing `backToDives as backToSettings` left this whole suite green
 * while a diver who deep-linked into `/preset/<id>` and left was dumped on the logbook. That is
 * the identical hole `DiveFormScreen.test.tsx` records finding and closing one screen over
 * ("`canGoBack` was mocked true everywhere, so deleting the fallback left every test green
 * while a deep-linked diver saved and then sat on the form"), and it is what the whole
 * `leaveScreen` rename exists to get right.
 *
 * Pinned on all three ways out of this screen — the way out itself, a successful save, and a
 * successful delete — because each calls the exit separately and any one of them could reach
 * for `router.back()` on its own.
 */
const exits = [
  ['the way out', async (t: RenderResult) => press(t, 'Leave without saving')],
  [
    'a save',
    async (t: RenderResult) => {
      await typeInto(t, 'Preset name', 'alu 80');
      await press(t, 'Save preset');
    },
  ],
  ['a delete', confirmDelete],
] as const;

it.each(exits)('pops the navigation stack after %s, when there is history to go back to', async (_case, leave) => {
  mockCanGoBack.mockReturnValue(true);
  const t = await open(twin12());
  await leave(t);
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockReplace).not.toHaveBeenCalled();
});

// **Settings, never the dives list.** `/preset/[id]` is a screen stacked on Settings, so a
// diver who arrived by URL belongs back on the screen holding the preset list — not on the
// logbook, which is a place they never asked to be.
it.each(exits)('replaces to Settings after %s reached by a deep link, with no history to pop', async (_case, leave) => {
  mockCanGoBack.mockReturnValue(false);
  const t = await open(twin12());
  await leave(t);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings'));
  expect(mockBack).not.toHaveBeenCalled();
});

// §3's own reason for the `error` field on `useGearPresets`: "'Couldn't load your presets'
// and 'you have none yet' are different sentences". The same holds one screen deeper — an id
// that names nothing live is not the same event as a read that failed, and telling a diver
// their preset "may have been deleted" when the database simply could not be read is a lie
// they cannot check.
it('says the id names nothing live, rather than showing a blank editor', async () => {
  stubPresets([preset({ id: 'other' })]);
  const t = await render(<GearPresetScreen presetId="gone" />);
  expect(textIn(t).join(' ')).toContain("Couldn't find that preset");
  // Not a blank form either: a screen offering fields over no preset would write nothing on
  // save, or — the danger `MISSING_DIVE_MESSAGE` records for the dive form — quietly create
  // a second one.
  expect(findField(t, 'Preset name')).toBeUndefined();
});

/**
 * M1f, and the same guard `DiveDetailScreen` carries for "Dive not found." — one rule, so the
 * two screens say nothing in the same circumstances rather than each inventing a rule.
 *
 * `useGearPresets()` answers asynchronously, and on the renders before it does this screen is
 * handed an empty list, which is indistinguishable from a diver whose preset really is gone.
 * So it said "may have been deleted" about a preset that was there, every time — and that
 * sentence sends a diver looking for something that is not lost.
 *
 * Three cases, and it needs all three: absent while there is no answer, PRESENT once there is
 * one (or a gate with its polarity reversed passes the first alone), and the way out surviving
 * both — §0.6's "a form with no visible way out was shipped once and only found by using the
 * app", which binds hardest on a screen showing nothing else at all.
 */
describe('before the preset read has answered', () => {
  it('does not claim the preset may have been deleted', async () => {
    stubPresets([], undefined, false);
    const t = await render(<GearPresetScreen presetId="target" />);
    expect(textIn(t).join(' ')).not.toContain("Couldn't find that preset");
  });

  it('does not claim the presets could not be read either', async () => {
    // The other sentence this branch can say. Neither is known yet, so neither is said.
    stubPresets([], undefined, false);
    const t = await render(<GearPresetScreen presetId="target" />);
    expect(textIn(t).join(' ')).not.toContain(PRESETS_UNREADABLE);
  });

  it('still offers the way out while it waits', async () => {
    stubPresets([], undefined, false);
    const t = await render(<GearPresetScreen presetId="target" />);
    expect(findControl(t, 'Leave without saving')).toBeDefined();
  });

  it('says it the moment the read answers and the preset really is not there', async () => {
    stubPresets([preset({ id: 'other' })], undefined, true);
    const t = await render(<GearPresetScreen presetId="target" />);
    expect(textIn(t).join(' ')).toContain("Couldn't find that preset");
  });
});

// `useGearPresets()` resolves asynchronously — the first render of this screen always sees an
// empty list, exactly as `useDives()` does one screen over — so an editor seeded once on
// mount would sit blank over a real preset for ever. Proven by rendering, then changing what
// the hook returns and re-rendering, which is the sequence the real hook produces.
it('seeds itself when the preset arrives late', async () => {
  const target = twin12();
  stubPresets([]);
  const t = await render(<GearPresetScreen presetId={target.id} />);
  expect(findField(t, 'Preset name')).toBeUndefined();

  stubPresets([target]);
  await t.rerender(<GearPresetScreen presetId={target.id} />);
  expect(findField(t, 'Preset name')?.props?.value).toBe('twin 12 steel');
  expect(findField(t, 'Working pressure')?.props?.value).toBe('232');
});

// `useUnitSystem()` resolves asynchronously too, and this half is the silent one: without it
// an imperial diver's fields would keep the bar figures they were seeded with while their
// labels changed to psi, and nothing on screen would say the number is wrong.
it('reseeds in the diver’s own units when those arrive late', async () => {
  const target = twin12();
  stubPresets([target]);
  const t = await render(<GearPresetScreen presetId={target.id} />);
  expect(findField(t, 'Working pressure')?.props?.value).toBe('232');

  mockUseUnitSystem.mockReturnValue('imperial');
  await t.rerender(<GearPresetScreen presetId={target.id} />);
  expect(findField(t, 'Working pressure')?.props?.value).toBe('3365');
});

// The other half of the same gate, and the reason it is keyed on the id rather than on the
// preset object: `useGearPresets` hands back a fresh array of fresh objects whenever the query
// re-runs, and it re-runs on any database change. Keyed on identity this would reseed on every
// re-render — blowing away what the diver was typing, and never settling at all, which is the
// shape that once made the dive form throw "Too many re-renders."
it('keeps what the diver is typing when the preset list is read again', async () => {
  const target = twin12();
  stubPresets([target]);
  const t = await render(<GearPresetScreen presetId={target.id} />);
  await typeInto(t, 'Preset name', 'alu 80');

  stubPresets([{ ...target }]);
  await t.rerender(<GearPresetScreen presetId={target.id} />);
  expect(findField(t, 'Preset name')?.props?.value).toBe('alu 80');
});

it('says the read failed, rather than blaming a deletion for it', async () => {
  stubPresets([], new Error('disk'));
  const t = await render(<GearPresetScreen presetId="p1" />);
  expect(textIn(t).join(' ')).toContain("Couldn't load your presets");
  expect(textIn(t).join(' ')).not.toContain('may have been deleted');
});

// ---------------------------------------------------------------------------------------
// The diver's own units (DESIGN.md §3, §6: SI stored, converted at display)
// ---------------------------------------------------------------------------------------

it('shows an imperial diver the working pressure in psi, and the size still in litres', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  const t = await open(twin12());
  // 232 bar is 3365 psi (format/units.ts owns the factor and the precision).
  expect(findField(t, 'Working pressure')?.props?.value).toBe('3365');
  // §10: "Cylinder volume stays litres in both systems" — the imperial counterpart is the
  // cubic foot, a different quantity rather than a conversion, so this figure must not move.
  expect(findField(t, 'Size')?.props?.value).toBe('12');
});

it('stores an imperial diver’s edit in bar, not in the psi they typed', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  const t = await open(twin12());
  await typeInto(t, 'Working pressure', '3000');
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(writtenTanks()?.[0]?.workingBar).toBeCloseTo(206.8427187950508, 10);
});

/**
 * **§10: "A display rounding may never rewrite stored data."**
 *
 * 232 bar reads as 3365 psi and 3365 psi converts back to 232.00858… bar, so an editor an
 * imperial diver merely opened and saved would erode the figure — and advance `updated_at`
 * on a write that changed nothing, which under §7's whole-row last-write-wins hands the
 * conflict to the device that did nothing. The repository's own no-op rule (`updateGearPreset`)
 * is what stops the write, and it can only fire if this screen hands back the stored figure
 * byte-identically. Pinned with `toBe`: "about 232" is exactly what the defect produces.
 */
it('hands the stored figure back untouched when the imperial diver changed nothing', async () => {
  mockUseUnitSystem.mockReturnValue('imperial');
  const t = await open(twin12());
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(writtenTanks()?.[0]?.workingBar).toBe(232);
  expect(writtenTanks()?.[0]?.sizeL).toBe(12);
});

// ---------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------

it('saves a changed name', async () => {
  const target = twin12();
  const t = await open(target);
  await typeInto(t, 'Preset name', 'twin 12 steel, nitrox');
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0]?.[0]).toBe(db);
  expect(mockUpdate.mock.calls[0]?.[1]).toBe(target.id);
  expect(mockUpdate.mock.calls[0]?.[2]?.name).toBe('twin 12 steel, nitrox');
});

// A trimmed name, because `presetNamed` (domain/presets.ts) compares trimmed keys — a preset
// stored with its whitespace would be a different name to the eye and the same one to the
// duplicate check, which is the drift that predicate exists to prevent.
it('stores the name trimmed, the way the duplicate check reads it', async () => {
  const t = await open(twin12());
  await typeInto(t, 'Preset name', '  alu 80  ');
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0]?.[2]?.name).toBe('alu 80');
});

it('saves changed cylinders', async () => {
  const t = await open(twin12());
  await typeInto(t, 'Size', '15');
  await press(t, `Material: ${formatTankMaterial('alu')}`);
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(writtenTanks()?.[0]).toMatchObject({ sizeL: 15, material: 'alu', configuration: 'twinset', workingBar: 232, o2Pct: 32 });
});

/**
 * The form shows one cylinder until "+ add cylinder" exists (§6), and so does this editor —
 * but a preset can hold several, and the dive form already applies every one of them
 * ("applies every cylinder a preset holds, not just the one the form shows"). Saving only
 * the cylinder on screen would silently delete a diver's deco gas, which is most of what a
 * multi-cylinder preset is for.
 */
it('keeps the cylinders it does not show', async () => {
  const deco = tank({ material: 'alu', configuration: 'single', sizeL: 11.1, workingBar: 207, o2Pct: 50 });
  const t = await open(preset({ tanks: [tank({ material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232 }), deco] }));
  await typeInto(t, 'Size', '15');
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(writtenTanks()).toHaveLength(2);
  expect(writtenTanks()?.[0]?.sizeL).toBe(15);
  expect(writtenTanks()?.[1]).toEqual(deco);
});

it('returns to Settings once the write lands', async () => {
  const t = await open(twin12());
  await typeInto(t, 'Preset name', 'alu 80');
  await press(t, 'Save preset');
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
});

// §10: "A local save failure is shown to the diver." Told, and the screen stays where it is
// with what the diver typed still in it — losing an edit because the disk was full is the
// other direction of the same failure.
it('says so when the write fails, and keeps what the diver typed', async () => {
  mockUpdate.mockImplementation(() => Promise.reject(new Error('disk full')));
  const t = await open(twin12());
  await typeInto(t, 'Preset name', 'alu 80');
  await press(t, 'Save preset');
  await waitFor(() => expect(textIn(t).join(' ')).toContain("Couldn't save that preset"));
  expect(findField(t, 'Preset name')?.props?.value).toBe('alu 80');
  expect(mockBack).not.toHaveBeenCalled();
});

/**
 * §10's in-flight guard, the same one the dive's own save carries and pinned the same way
 * (DiveFormScreen.test.tsx's `tapSaveAgain`). The second tap is dispatched through the
 * control's own `onClick` rather than a second `fireEvent.press`, for two reasons that
 * codebase already paid for: two overlapping presses make RTL reject outright ("You seem to
 * have overlapping act() calls") and leave the NEXT test rendering against a corrupted tree;
 * and `onClick` is the activation path that does NOT consult `disabled`, which is what makes
 * this pin the re-entrancy LATCH specifically rather than the render flag that only shows it.
 */
function tapAgain(t: RenderResult, label: string) {
  const node = findControl(t, label);
  if (!node) throw new Error(`GearPresetScreen rendered no control labelled "${label}"`);
  node.props.onClick({ nativeEvent: {}, stopPropagation() {}, preventDefault() {}, persist() {} });
}

/** Lets already-scheduled microtasks run — enough for a press's own async chain to reach (or
 * be turned away at) the latch. */
async function settle(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** An `updateGearPreset` that hangs until the test lets it finish. `release` is assigned
 * synchronously by the Promise constructor, so it is callable before the write has started. */
function hangingUpdate(): () => void {
  let release!: () => void;
  mockUpdate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return () => release();
}

// Without the latch the second write lands on a row the first has already stamped — a second
// `updated_at`, which under §7's whole-row last-write-wins is what another device compares
// against — and `backToSettings` pops the navigation stack twice.
it('writes once when the diver double-taps Save', async () => {
  const releaseWrite = hangingUpdate();
  const t = await open(twin12());
  await typeInto(t, 'Preset name', 'alu 80');

  // Deliberately not awaited: `fireEvent.press` settles only once the handler's whole chain
  // has, and this write is held open on purpose — awaiting here would rule out the very
  // overlap this test exists to create.
  const first = fireEvent.press(findControl(t, 'Save preset')!);
  // The second tap in the SAME frame, before React has re-rendered the control as disabled,
  // which is what a double-tap actually is.
  tapAgain(t, 'Save preset');
  await settle();
  // Recorded before the write is released, so this is genuinely "while in flight" rather than
  // "after the latch had already let go".
  const writesInFlight = mockUpdate.mock.calls.length;

  // Released and settled inside `act`, so the state update in `save`'s own `finally` lands
  // in a frame React is expecting one — without it the release resolves outside act and the
  // suite prints a warning about an update it cannot attribute to anything.
  await act(async () => {
    releaseWrite();
    await first;
  });

  expect(writesInFlight).toBe(1);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

// The other half, and it guards a different door: `disabled` is what stops the control being
// pressed again a tick later, once React has rendered. Pinned separately because a test
// exercising only one goes green with the other deleted.
it('marks the save control disabled while a write is in flight, and only then', async () => {
  const releaseWrite = hangingUpdate();
  const t = await open(twin12());
  await typeInto(t, 'Preset name', 'alu 80');
  // §1 binds the control itself: nothing about what the diver has filled in may disable it.
  expect(findControl(t, 'Save preset')?.props?.accessibilityState?.disabled).not.toBe(true);

  const press = fireEvent.press(findControl(t, 'Save preset')!);
  await waitFor(() => expect(findControl(t, 'Save preset')?.props?.accessibilityState?.disabled).toBe(true));

  await act(async () => {
    releaseWrite();
    await press;
  });
});

// A guard that never released would strand the diver on a screen they cannot resubmit — the
// same "told nothing, can do nothing" dead end §1 exists to prevent, reached from the
// opposite direction.
it('lets the diver try again after a failed save', async () => {
  mockUpdate.mockImplementation(() => Promise.reject(new Error('disk full')));
  const t = await open(twin12());
  await typeInto(t, 'Preset name', 'alu 80');
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
});

// ---------------------------------------------------------------------------------------
// Refusals — text under the row they belong to, never a blocked control (§0.6, §1)
// ---------------------------------------------------------------------------------------

// The whole sentence, and asserted ABSENT before the gesture: that pre-assertion is what
// makes the test a function of the message rather than of the surrounding screen, which is
// the exact hole this milestone's fix round found in three refusal tests one screen over.
async function refusalFor(t: RenderResult, sentence: string) {
  expect(textIn(t).join(' ')).not.toContain(sentence);
  await press(t, 'Save preset');
  expect(textIn(t).join(' ')).toContain(sentence);
  expect(mockUpdate).not.toHaveBeenCalled();
}

it('refuses an empty name, since the name is all a chip shows', async () => {
  const t = await open(twin12());
  await typeInto(t, 'Preset name', '');
  await refusalFor(t, 'Give this preset a name, so you can find it again.');
});

it('refuses a whitespace-only name for the same reason', async () => {
  const t = await open(twin12());
  await typeInto(t, 'Preset name', '   ');
  await refusalFor(t, 'Give this preset a name, so you can find it again.');
});

// Two chips reading "alu 80" with different cylinders is a row the diver cannot tell apart
// and cannot fix by looking. The sentence quotes the spelling the OTHER preset already has,
// not the one just typed — sending a diver to look for a chip that says no such thing would
// be its own small lie.
it('refuses a name another preset already has, whatever case it was typed in', async () => {
  const t = await open(twin12(), [preset({ name: 'alu 80' })]);
  await typeInto(t, 'Preset name', 'ALU 80');
  await refusalFor(t, 'You already have a preset called “alu 80”.');
});

// The other half of `presetNamed`'s `exceptId`: renaming a preset to the name it already has
// is not a collision with anything, and without the exception this editor would refuse every
// save that did not change the name — which is most of them.
it('lets a preset keep its own name', async () => {
  const t = await open(twin12());
  await typeInto(t, 'Size', '15');
  await press(t, 'Save preset');
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(textIn(t).join(' ')).not.toContain('You already have a preset called');
});

// A preset with nothing in it is a chip that blanks a diver's cylinder block — worse than no
// chip at all, which is why the dive form refuses to create one. An editor that could empty
// one would be the same rule with two answers, one screen apart.
it('refuses to empty the cylinders, and says what to do instead', async () => {
  const t = await open(twin12());
  for (const field of ['Size', 'Working pressure', O2_LABEL]) await typeInto(t, field, '');
  await press(t, `Material: ${formatTankMaterial('steel')}`);
  // Pressing the selected chip clears it — `OptionChips` reports `''` for that — so the rig
  // has to be emptied the same way the material is, not typed away.
  await press(t, `Configuration: ${formatConfiguration('twinset')}`);
  await refusalFor(t, 'A preset with no cylinders fills nothing in — fill the cylinder fields first.');
});

/**
 * A preset stores no pressures (§10), and the repository strips them on every write it owns —
 * but M2's `pull_changes` does not write through `createGearPreset`, so a preset delivered
 * from another client can arrive carrying a gauge reading. This editor shows neither field,
 * so such a cylinder looks completely empty on screen while `isRecordedTank` calls it
 * recorded: without the strip, saving would store a preset that fills nothing in and the
 * refusal below would never fire.
 */
it('counts a cylinder holding only the pressures it never shows as nothing to store', async () => {
  const t = await open(preset({ tanks: [tank({ startBar: 200, endBar: 60 })] }));
  // Nothing on screen, which is the point: every field this editor offers is empty.
  for (const field of ['Size', 'Working pressure', O2_LABEL, HE_LABEL]) {
    expect(findField(t, field)?.props?.value).toBe('');
  }
  await refusalFor(t, 'A preset with no cylinders fills nothing in — fill the cylinder fields first.');
});

// §10's "keep and flag": a preset synced from a newer client can carry a material this build
// has no chip for, and the chip row alone would show it as simply nothing chosen. Flagged
// rather than refused (§1), through `unknownOptionNote` — the same owner the dive form's own
// option fields ask.
it('flags a material it has no chip for, rather than showing nothing at all', async () => {
  // The known material first, so the sentence is proven ABSENT before it is asserted present
  // — otherwise a screen that showed the note unconditionally would pass the half that
  // matters. `UNKNOWN_OPTION_NOTE` comes from the file that owns what the value means
  // (diveFormSchema.ts), never a copy of the words here.
  const known = await open(twin12());
  expect(textIn(known).join(' ')).not.toContain(UNKNOWN_OPTION_NOTE);

  const t = await open(preset({ tanks: [tank({ material: 'carbon' as Tank['material'], sizeL: 12 })] }));
  expect(textIn(t).join(' ')).toContain(UNKNOWN_OPTION_NOTE);
  // ...and the chip row alone would have said nothing at all: none of them is selected, which
  // is indistinguishable from a preset whose material was never recorded.
  for (const material of TANK_MATERIAL_VALUES) {
    expect(findControl(t, `Material: ${formatTankMaterial(material)}`)?.props?.accessibilityState?.selected).toBe(false);
  }
});

// The same rule at the second call site, which is the whole point of asserting it twice:
// `unknownOptionNote` is one owner and this editor asks it about two fields, so a flag
// present on `Material` and absent on `Configuration` would look identical on screen to a
// preset whose rig was simply never recorded — and would stay that way silently.
it('flags a configuration it has no chip for, exactly as it flags a material', async () => {
  const known = await open(twin12());
  expect(textIn(known).join(' ')).not.toContain(UNKNOWN_OPTION_NOTE);

  const t = await open(preset({ tanks: [tank({ configuration: 'rebreather' as Tank['configuration'], sizeL: 12 })] }));
  expect(textIn(t).join(' ')).toContain(UNKNOWN_OPTION_NOTE);
  // ...and the chip row alone said nothing: none of the three is selected, which a diver
  // cannot tell apart from a preset that records no rig at all.
  for (const configuration of CONFIGURATION_VALUES) {
    expect(findControl(t, `Configuration: ${formatConfiguration(configuration)}`)?.props?.accessibilityState?.selected).toBe(false);
  }
});

// ---------------------------------------------------------------------------------------
// Deleting (DESIGN.md §6's tombstone, §10's OS-chrome confirmation)
// ---------------------------------------------------------------------------------------

it('asks through the one owner of destructive chrome, not through a platform call of its own', async () => {
  const t = await open(twin12());
  await press(t, 'Delete preset');
  // Asserted on `confirmDestructive` itself — see this file's mock for why spying on
  // `Alert.alert` instead would stay green against a screen that ships a control deleting
  // nothing on web.
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(askedConfirmation()).toMatchObject({
    title: 'Delete this preset?',
    body: "It will be removed from your presets. This can't be undone.",
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  });
  // Nothing yet: the first tap asks the question, it does not answer it. `confirmDestructive`
  // promises `onConfirm` "is run only if the diver confirms", and this screen must not have
  // done the work already.
  expect(mockSoftDelete).not.toHaveBeenCalled();
});

it('tombstones the preset and leaves once the diver confirms', async () => {
  const target = twin12();
  const t = await open(target);
  await confirmDelete(t);
  // `softDeleteGearPreset`, never a hard delete: it writes the `deleted_at` tombstone (§6)
  // that M2's sync needs to propagate the deletion to the diver's other devices.
  await waitFor(() => expect(mockSoftDelete).toHaveBeenCalled());
  expect(mockSoftDelete.mock.calls[0]?.[0]).toBe(db);
  expect(mockSoftDelete.mock.calls[0]?.[1]).toBe(target.id);
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
});

it('says so when the delete fails, rather than leaving a dead control', async () => {
  mockSoftDelete.mockImplementation(() => Promise.reject(new Error('disk full')));
  const t = await open(twin12());
  await confirmDelete(t);
  await waitFor(() => expect(textIn(t).join(' ')).toContain("Couldn't delete that preset"));
  expect(mockBack).not.toHaveBeenCalled();
});

/**
 * §0.6: the primary action is the app's one filled inverted-ink button, and nothing may compete
 * with it. Without this, swapping `styles.action` for `styles.presetDelete` on the save control
 * leaves the whole suite green — the primary action stops being the primary action and
 * `unexpectedGraphics` cannot see it either, because both styles are on-palette.
 *
 * Read off `makeStyles` rather than retyped, and asserted against the OTHER two controls on
 * this screen, which is where "nothing competes with it" actually lives: the way out is
 * wayfinding (`formBack` — §0.6's "leaving a screen has one treatment everywhere") and Delete
 * is a plain muted label (§10's "the app's own control stays muted"). The same three-way
 * assertion `DiveFormScreen.test.tsx` makes for its own footer.
 */
it('gives Save the one filled button, and neither of the other two controls', async () => {
  const t = await open(twin12());
  const styles = makeStyles('light');
  const styleOf = (label: string) => [findControl(t, label)?.props?.style].flat(5);

  expect(styleOf('Save preset')).toContain(styles.action);
  expect(styleOf('Leave without saving')).toContain(styles.formBack);
  expect(styleOf('Leave without saving')).not.toContain(styles.action);
  expect(styleOf('Delete preset')).toContain(styles.presetDelete);
  expect(styleOf('Delete preset')).not.toContain(styles.action);
});

// §0.1: colour encodes depth and nothing else, so this app's own surface stays monochrome —
// the destructive colour belongs to the dialog above and to nothing this screen draws.
it('keeps its own delete control muted, never coloured', async () => {
  const t = await open(twin12());
  const [label] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children.includes('Delete preset')) : [];
  expect([label?.props?.style].flat(5).map((s) => (s as { color?: string } | undefined)?.color)).toContain(
    themeFor('light').fgMuted,
  );
});

// §0.4/§0.1's shared guard, the same one every screen test in this codebase runs: nothing
// here draws a graphic, and no View is painted with anything `makeStyles(scheme)` did not
// hand out.
it('draws no graphic and paints nothing off-palette', async () => {
  const t = await open(twin12());
  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});
