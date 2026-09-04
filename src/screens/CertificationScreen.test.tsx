// The package's own official Jest mock — this screen's root asks the device for its top
// clearance (`screenTopInset`, theme/styles.ts), gets a real SafeAreaProvider for free from
// expo-router's root layout in the app, and has none when rendered bare here. Imported first,
// and named `mock...`, for the babel-plugin-jest-hoist reason DiveFormScreen.test.tsx records:
// a jest.mock() factory may only close over out-of-scope identifiers starting with
// `mock`/`require`, and every jest.mock() call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';

import {
  createCertification,
  softDeleteCertification,
  updateCertification,
} from '../db/certifications';
import { useCertifications } from '../db/useCertifications';
import { confirmDestructive, type DestructiveConfirmation } from '../platform/confirmDestructive';
import { EMPTY_CERTIFICATION_NOTE } from '../domain/certifications';
import { type Certification } from '../domain/types';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { makeStyles } from '../theme/styles';
import CertificationScreen from './CertificationScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
// The one live read, mocked per module exactly as every other screen test mocks its own: it is
// a database read, and this screen must be renderable against any wallet without one.
jest.mock('../db/useCertifications', () => ({ useCertifications: jest.fn() }));
// Only the three WRITES are stubbed. `jest.requireActual` keeps everything else real, which is
// what stops a later import from silently resolving to `undefined` rather than failing loudly.
jest.mock('../db/certifications', () => ({
  ...jest.requireActual('../db/certifications'),
  createCertification: jest.fn(),
  updateCertification: jest.fn(),
  softDeleteCertification: jest.fn(),
}));
/**
 * **The owner of the destructive confirmation, mocked as the owner** — `GearPresetScreen`'s
 * own call and for its stated reason: spying on `Alert.alert` one layer down would leave this
 * green against a screen that inlined it, and `Alert.alert` is an empty function in
 * `react-native-web`, so such a screen would ship a *Delete certification* control that
 * silently deletes nothing in a browser. What the platform actually draws is that module's
 * business and is pinned in `DiveDetailScreen.test.tsx`.
 */
jest.mock('../platform/confirmDestructive', () => ({ confirmDestructive: jest.fn() }));
// Leaving goes through `backToSettings` (navigation/leaveScreen.ts), which calls
// canGoBack()/back()/replace().
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockUseCertifications = useCertifications as jest.Mock;
const mockCreate = createCertification as jest.Mock;
const mockUpdate = updateCertification as jest.Mock;
const mockSoftDelete = softDeleteCertification as jest.Mock;
const mockBack = router.back as jest.Mock;
const mockCanGoBack = router.canGoBack as jest.Mock;
const mockReplace = router.replace as jest.Mock;
const mockConfirm = confirmDestructive as jest.Mock;

let cardSeq = 0;
/** A `Certification` with only the fields a case cares about. Ids come from a counter for
 * `diveFixture`'s reason: two cards built with identical arguments must still be distinct,
 * since this screen finds its subject by id. */
const card = (over: Partial<Certification> = {}): Certification => ({
  id: `cert-${String(cardSeq++).padStart(4, '0')}`,
  agency: 'PADI',
  course: 'Rescue Diver',
  cardNumber: null,
  issuedOn: null,
  expiresOn: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  // Never written by the repository, so never flagged (§7.1) — `diveFixture`'s reasoning.
  dirty: false,
  deletedAt: null,
  ...over,
});

/**
 * The same `mockImplementation`-not-`mockReturnValue` discipline every stub in this codebase
 * keeps: the real hook builds its list with `toCertifications(rows)`, a brand-new array
 * whenever the memo's input changes, so a stub handing back one referentially-stable array for
 * ever would model a contract the hook does not have — and this screen holds a draft keyed off
 * what it reads.
 *
 * `resolved` defaults to TRUE, and every call below that omits it means exactly that. The
 * renders BEFORE the answer are their own block, which passes `false` explicitly, so this
 * default cannot quietly re-hide the defect that block exists for.
 */
function stubWallet(certifications: Certification[] = [], error?: Error, resolved = true) {
  mockUseCertifications.mockImplementation(() => ({
    certifications: [...certifications],
    error,
    resolved,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  stubWallet();
  mockConfirm.mockImplementation(() => {});
  // Set explicitly rather than left to the module factory's defaults: `clearAllMocks` clears
  // calls but not return values, so one test's override would leak into every later test.
  mockCanGoBack.mockReturnValue(true);
  mockCreate.mockImplementation(() => Promise.resolve(card()));
  mockUpdate.mockImplementation(() => Promise.resolve(card()));
  mockSoftDelete.mockImplementation(() => Promise.resolve());
});

// ---------------------------------------------------------------------------------------
// Queries. Every one matches a WHOLE announced label, never a substring — the trap that made
// an earlier milestone's capture control name itself around a test helper. This screen shows
// *Save certification* and *Delete certification* one scroll apart, and a substring match on
// "certification" would find whichever came first in tree order.
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
  if (!node) throw new Error(`CertificationScreen rendered no control labelled "${label}"`);
  await act(async () => {
    fireEvent.press(node);
  });
}

function inputsOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'TextInput') : [];
}

function findField(t: RenderResult, label: string) {
  return inputsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === label);
}

async function typeInto(t: RenderResult, label: string, value: string) {
  const input = findField(t, label);
  if (!input) throw new Error(`CertificationScreen rendered no field labelled "${label}"`);
  await act(async () => {
    fireEvent.changeText(input, value);
  });
}

/** What this screen asked the repository to store — the create's input or the update's patch. */
function written(): Record<string, unknown> | undefined {
  return (mockCreate.mock.calls[0]?.[1] ?? mockUpdate.mock.calls[0]?.[2]) as
    | Record<string, unknown>
    | undefined;
}

/** The question this screen asked the one owner of destructive chrome. */
function askedConfirmation(): DestructiveConfirmation | undefined {
  return mockConfirm.mock.calls[0]?.[0] as DestructiveConfirmation | undefined;
}

/** Presses Delete and then answers the confirmation the way a diver who means it would — by
 * running the `onConfirm` the screen handed the owner, which is the only path that deletes
 * anything. */
async function confirmDelete(t: RenderResult) {
  await press(t, 'Delete certification');
  const asked = askedConfirmation();
  if (!asked) throw new Error('the screen asked for no confirmation at all');
  await act(async () => {
    asked.onConfirm();
  });
}

/** The one card this screen is opened on, already stubbed as the whole live wallet. */
function open(target: Certification, others: Certification[] = []) {
  stubWallet([target, ...others]);
  return render(<CertificationScreen mode="edit" certificationId={target.id} />);
}

function openNew() {
  stubWallet([]);
  return render(<CertificationScreen mode="create" />);
}

const rescue = () =>
  card({
    agency: 'PADI',
    course: 'Rescue Diver',
    cardNumber: '1234567',
    issuedOn: '2018-07-14',
    expiresOn: '2028-07-14',
  });

// ---------------------------------------------------------------------------------------
// What the editor shows (DESIGN.md §3, §6)
// ---------------------------------------------------------------------------------------

it('seeds every field from the stored card', async () => {
  const t = await open(rescue());

  expect(findField(t, 'Agency')?.props?.value).toBe('PADI');
  expect(findField(t, 'Course')?.props?.value).toBe('Rescue Diver');
  expect(findField(t, 'Card number')?.props?.value).toBe('1234567');
  // The two dates are the platform picker's row rather than a text field, so they are read off
  // what the row draws — `formatDiveDate`'s own words (format/display.ts, §4.1).
  expect(textIn(t)).toContain('14 Jul 2018');
  expect(textIn(t)).toContain('14 Jul 2028');
});

/**
 * §6 makes every column nullable, and this is the screen where that has to be visible: a card
 * holding only an agency opens with four empty rows rather than with a refusal or a blank
 * screen.
 */
it('opens a card that holds only one field, with the rest empty', async () => {
  const t = await open(card({ agency: 'SSI', course: null }));

  expect(findField(t, 'Agency')?.props?.value).toBe('SSI');
  expect(findField(t, 'Course')?.props?.value).toBe('');
  expect(findField(t, 'Card number')?.props?.value).toBe('');
});

/**
 * **The two date rows read differently when empty, and that is a fact rather than a
 * placeholder.** §6 gives `expires_on` to "(O₂, first aid)", so most cards genuinely do not
 * expire — a null there means *this card does not expire*, where a null issue date means
 * nobody has typed one.
 */
it('says an empty expiry does not expire, and an empty issue date is simply not set', async () => {
  const t = await open(card({ issuedOn: null, expiresOn: null }));

  const said = textIn(t).join(' ');
  expect(said).toContain('Not set');
  expect(said).toContain('Doesn’t expire');
});

it('opens create mode empty, and calls itself by a different name', async () => {
  const t = await openNew();

  expect(textIn(t)).toContain('Add certification');
  expect(textIn(t)).not.toContain('Edit certification');
  for (const label of ['Agency', 'Course', 'Card number']) {
    expect(`${label}: ${String(findField(t, label)?.props?.value)}`).toBe(`${label}: `);
  }
});

/**
 * §0.1: colour encodes depth and nothing else, and §0.4: the only graphic in this app is the
 * mark. A screen of five rows and two controls has no business drawing either.
 */
it('draws no graphic and paints nothing the theme did not hand out', async () => {
  const t = await open(rescue());

  expect(unexpectedGraphics(t, 'light')).toEqual([]);
});

// ---------------------------------------------------------------------------------------
// Saving (§3, §1, §7)
// ---------------------------------------------------------------------------------------

it('writes an edited card through the repository and leaves the screen', async () => {
  const stored = rescue();
  const t = await open(stored);

  await typeInto(t, 'Course', 'Divemaster');
  await press(t, 'Save certification');

  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockUpdate.mock.calls[0]?.[1]).toBe(stored.id);
  expect(written()).toMatchObject({ course: 'Divemaster', agency: 'PADI', cardNumber: '1234567' });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

/**
 * **Create writes a NEW card and never an update**, which is the whole reason this screen
 * takes a `mode`: with an id alone, "there is no card yet" and "the card you asked for is
 * gone" are one state, and the screen would either refuse to create or create a duplicate on
 * every attempt (`MISSING_DIVE_MESSAGE`, DiveFormScreen.tsx, records that defect).
 */
it('writes a new card in create mode, and never touches an existing one', async () => {
  const t = await openNew();

  await typeInto(t, 'Agency', 'SSI');
  await typeInto(t, 'Course', 'Open Water');
  await press(t, 'Save certification');

  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(written()).toMatchObject({ agency: 'SSI', course: 'Open Water' });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

/**
 * The values that reach the repository are `certificationRefusal`'s
 * (domain/certifications.ts), not this screen's: trimmed, with a blank meaning absent. A
 * screen that trimmed for itself would be that rule in two places, free to disagree about what
 * a field of spaces is.
 */
it('stores the values trimmed, with a blank field meaning absent', async () => {
  const t = await openNew();

  await typeInto(t, 'Agency', '  PADI  ');
  await typeInto(t, 'Course', '   ');
  await press(t, 'Save certification');

  expect(written()).toMatchObject({ agency: 'PADI', course: null });
});

/**
 * **The one thing this screen refuses**, and it says so rather than writing an unidentifiable
 * row. Everything else is saved as given — §1 binds a dive, and this is not one.
 */
it('refuses a card with nothing in it, says so, and writes nothing', async () => {
  const t = await openNew();

  await press(t, 'Save certification');

  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(textIn(t)).toContain(EMPTY_CERTIFICATION_NOTE);
});

/** The note is about a card the diver has since put something into, so it goes the moment they
 * type — a stale complaint standing over a fixed field is its own defect. */
it('drops that note as soon as the diver types something', async () => {
  const t = await openNew();
  await press(t, 'Save certification');
  expect(textIn(t)).toContain(EMPTY_CERTIFICATION_NOTE);

  await typeInto(t, 'Agency', 'S');

  expect(textIn(t)).not.toContain(EMPTY_CERTIFICATION_NOTE);
});

/**
 * §1's "never block a save" binds the control itself: a refusal is a sentence beside the rows
 * it is about, never a control that does nothing. So the save control is live on an empty
 * card, and pressing it produces the sentence above rather than silence.
 */
it('never disables the save control for validity, only while a write is in flight', async () => {
  const t = await openNew();

  expect(findControl(t, 'Save certification')?.props?.accessibilityState?.disabled).toBe(false);
});

/**
 * §10: "a local save failure is shown to the diver". The alternative is a diver believing
 * their card is stored and finding an empty wallet on the boat where they were asked for it —
 * and the screen must NOT leave, or the failure is invisible.
 */
it('says so when the write rejects, and stays put', async () => {
  mockUpdate.mockImplementation(() => Promise.reject(new Error('disk full')));
  const t = await open(rescue());

  await typeInto(t, 'Course', 'Divemaster');
  await press(t, 'Save certification');

  expect(textIn(t).join(' ')).toContain("Couldn't save that certification");
  expect(mockBack).not.toHaveBeenCalled();
});

/** §10's in-flight guard: without the synchronous ref a double-tap writes twice — two cards in
 * create mode — and pops the navigation stack twice. */
it('writes once for a double tap', async () => {
  let resolve = () => {};
  mockCreate.mockImplementation(() => new Promise<Certification>((r) => { resolve = () => { r(card()); }; }));
  const t = await openNew();
  await typeInto(t, 'Agency', 'SSI');

  const control = findControl(t, 'Save certification');
  if (!control) throw new Error('no save control');
  await act(async () => {
    fireEvent.press(control);
    fireEvent.press(control);
  });
  await act(async () => {
    resolve();
  });

  expect(mockCreate).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------------------
// Deleting (§0.6, §6)
// ---------------------------------------------------------------------------------------

it('asks the owner of destructive chrome before it deletes anything', async () => {
  const t = await open(rescue());

  await press(t, 'Delete certification');

  expect(mockSoftDelete).not.toHaveBeenCalled();
  expect(askedConfirmation()).toMatchObject({
    title: 'Delete this certification?',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  });
});

it('deletes and leaves once the diver says yes', async () => {
  const stored = rescue();
  const t = await open(stored);

  await confirmDelete(t);

  expect(mockSoftDelete).toHaveBeenCalledWith(expect.anything(), stored.id);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('says so when the delete rejects, and stays put', async () => {
  mockSoftDelete.mockImplementation(() => Promise.reject(new Error('disk full')));
  const t = await open(rescue());

  await confirmDelete(t);

  expect(textIn(t).join(' ')).toContain("Couldn't delete that certification");
  expect(mockBack).not.toHaveBeenCalled();
});

/** There is nothing yet to delete in create mode, so the control is absent rather than
 * disabled — a control that cannot act is not a control. */
it('offers no delete at all in create mode', async () => {
  const t = await openNew();

  expect(buttonLabels(t)).not.toContain('Delete certification');
  expect(buttonLabels(t)).toContain('Save certification');
});

// ---------------------------------------------------------------------------------------
// A card that is not there (§4.1, M1f)
// ---------------------------------------------------------------------------------------

/**
 * **It does not fall back to a blank new card**, which is the dangerous option: a form that
 * quietly created a NEW row because it could not find the one it was editing would duplicate
 * on the device that still has it, and again on every later attempt.
 */
it('says the card is missing rather than opening an empty one', async () => {
  stubWallet([card()]);
  const t = await render(<CertificationScreen mode="edit" certificationId="gone" />);

  expect(textIn(t).join(' ')).toContain("Couldn't find that certification");
  expect(findField(t, 'Agency')).toBeUndefined();
  expect(buttonLabels(t)).not.toContain('Save certification');
});

/** A failed read is a different sentence from a deleted card — `useCertifications`' `error`
 * exists for exactly that, and telling a diver their card may be gone when the database simply
 * could not be read sends them looking for something that is still there. */
it('says the read failed rather than that the card was deleted', async () => {
  stubWallet([], new Error('no database'));
  const t = await render(<CertificationScreen mode="edit" certificationId="gone" />);

  expect(textIn(t).join(' ')).toContain("Couldn't load your certifications");
  expect(textIn(t).join(' ')).not.toContain("Couldn't find that certification");
});

/**
 * **Neither sentence is said until there is an answer to say one about** (M1f) — the gate
 * `GearPresetScreen` and `DiveDetailScreen` both put on their own not-found lines, so all
 * three go quiet in the same circumstances instead of each inventing a rule.
 */
it('says neither before the read has answered', async () => {
  stubWallet([], undefined, false);
  const t = await render(<CertificationScreen mode="edit" certificationId="gone" />);

  const said = textIn(t).join(' ');
  expect(said).not.toContain("Couldn't find that certification");
  expect(said).not.toContain("Couldn't load your certifications");
  // The way out is rendered all the same (§0.6): a screen that could not find its card is
  // exactly the one a diver most needs to leave.
  expect(buttonLabels(t)).toContain('Leave without saving');
});

/** Create mode never reaches that branch: there is no card to be missing, so an empty wallet
 * is the ordinary case rather than a failure. */
it('opens create mode on an empty wallet without complaining', async () => {
  const t = await openNew();

  expect(textIn(t).join(' ')).not.toContain("Couldn't find that certification");
  expect(findField(t, 'Agency')).toBeDefined();
});

// ---------------------------------------------------------------------------------------
// Leaving (§0.6: "leaving a screen has one treatment everywhere")
// ---------------------------------------------------------------------------------------

it('leaves without writing anything', async () => {
  const t = await open(rescue());

  await typeInto(t, 'Course', 'Divemaster');
  await press(t, 'Leave without saving');

  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

/** A cold deep link has no history to pop, and lands on Settings rather than on the dives list
 * — `backToSettings` (navigation/leaveScreen.ts) is the one owner of that choice. */
it('lands on Settings when there is no history to go back to', async () => {
  mockCanGoBack.mockReturnValue(false);
  const t = await open(rescue());

  await press(t, 'Leave without saving');

  expect(mockBack).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith('/settings');
});

// ---------------------------------------------------------------------------------------
// Grammar (§0.6: "the form is the dive detail you can type into")
// ---------------------------------------------------------------------------------------

it('uses the form’s own rows rather than inventing a vocabulary for this screen', async () => {
  const styles = makeStyles('light');
  const t = await open(rescue());

  const rows = t.root
    ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(styles.formField))
    : [];
  // Five rows: agency, course, card number, issued, expires — three `FormField`s and two
  // `DateTimeField`s, all of them the same row.
  expect(rows).toHaveLength(5);
});

/** §0.6: "Figures in mono, names in sans." A card number is a figure; an agency and a course
 * are names. */
it('sets the card number in mono and the names in sans', async () => {
  const styles = makeStyles('light');
  const t = await open(rescue());

  expect([findField(t, 'Card number')?.props?.style].flat(5)).toContain(styles.formFieldInputMono);
  expect([findField(t, 'Agency')?.props?.style].flat(5)).not.toContain(styles.formFieldInputMono);
});

/** The way out is `formBack` — the dive form's own `‹ Cancel`, the dive detail's `‹ Dives` and
 * the preset editor's, so "this takes you back" reads the same wherever it appears. */
it('draws the way out the way every other stacked screen draws it', async () => {
  const styles = makeStyles('light');
  const t = await open(rescue());

  const back = findControl(t, 'Leave without saving');
  expect([back?.props?.style].flat(5)).toContain(styles.formBack);
  expect(textIn(t)).toContain('‹ Cancel');
});
