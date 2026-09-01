/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Kiritimati"}
 */

import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { DateTimeField } from './DateTimeField';

/**
 * Run in UTC+14 rather than in the machine's own zone, for the same reason
 * `datetime.utc-plus-14.test.ts` is: this component's whole job is turning the `Date` a
 * native picker hands back into the `YYYY-MM-DD`/`HH:MM` string the app stores, and the
 * wrong (UTC) spelling of that conversion is invisible in UTC and on any CI box. Here a
 * local midnight is still the previous day in UTC, so a component wired to the wrong
 * converter — or to `toISOString()` inline, which is what the brief for this task warns
 * against — reddens instead of passing. The first test pins the zone itself, because
 * `process.env.TZ` set from inside a test file silently does nothing (Jest sandboxes
 * `process`), which is exactly how an earlier draft of these tests ran in Europe/Prague
 * while claiming otherwise.
 */

// Same RTL adaptation every test file in this codebase uses (FormField.test.tsx,
// DiveRow.test.tsx): `render` is async and `root` is a `TestInstance` exposing
// `queryAll(predicate)`, not `findAllByType`.
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

/** The field's own control — the 48 dp row that opens the picker, found by the
 * `` `${label}: ${value}` `` shape this component announces (the same shape `OptionChips`
 * on the dive form already uses). */
function triggerOf(t: RenderResult, label: string) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '').startsWith(`${label}:`));
}

function clearOf(t: RenderResult, label: string) {
  return buttonsOf(t).find((n) => String(n.props?.accessibilityLabel ?? '') === `Clear ${label}`);
}

/** The native control itself. Queried by the host name the library's own iOS component
 * renders under (`RNDateTimePicker`) rather than a testID, so this can only pass while a
 * REAL picker is in the tree — a hand-rolled replacement would not answer to it. */
function pickerOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'RNDateTimePicker')[0] : undefined;
}

async function openPicker(t: RenderResult, label: string) {
  const trigger = triggerOf(t, label);
  if (!trigger) throw new Error(`no ${label} field found`);
  await fireEvent.press(trigger);
  const picker = pickerOf(t);
  if (!picker) throw new Error(`${label} did not open a picker`);
  return picker;
}

/**
 * What the OS does when the diver picks a value: the native side posts a `change` event
 * carrying an epoch timestamp, and the library's own JS layer turns it into the `Date` this
 * component receives. Driven through that real layer rather than by calling the component's
 * prop directly, so the test exercises the same path the device does.
 */
async function choose(picker: ReturnType<typeof pickerOf>, moment: Date) {
  if (!picker) throw new Error('no picker to choose in');
  await fireEvent(picker, 'change', { nativeEvent: { timestamp: moment.getTime(), utcOffset: 14 * 60 } });
}

// The §0.4/§0.1 guard now lives in `src/testing/unexpectedGraphics.ts` — one owner, because
// five files carried the same copy and all five were wrong in the same way: the check read
// `!style.some(known.includes)`, so one known style excused every literal beside it and
// `[styles.x, { backgroundColor: '#f00' }]` — the only shape anyone writes — passed. See that
// module and its own test for what it enforces and why the scheme is now explicit here.

const noop = () => {};

it('is really running in UTC+14, so the day-boundary assertions below mean what they say', () => {
  expect(-new Date(2026, 7, 31, 12).getTimezoneOffset()).toBe(14 * 60);
  // The trap itself, as a fact about the platform: the instant a date picker returns for
  // "31 August" is still 30 August in UTC.
  expect(new Date(2026, 7, 31, 0, 0).toISOString().slice(0, 10)).toBe('2026-08-30');
});

it('reads a stored date the way a diver writes one, not the way it is stored', async () => {
  const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme="light" />);
  // format/display.ts's formatDiveDate is the single owner of this text (§10).
  expect(textIn(t)).toContain('31 Aug 2026');
  expect(textIn(t).join(' ')).not.toContain('2026-08-31');
  expect(textIn(t)).toContain('Date');
});

it('reads a stored time as the 24-hour clock this app stores, canonicalised', async () => {
  const t = await render(<DateTimeField label="Time in" value="7:30" onChange={noop} mode="time" scheme="light" />);
  // datetime.ts is lenient about spelling, so a value that reached the row as '7:30' still
  // reads as the canonical 07:30 rather than sorting-hostile text.
  expect(textIn(t)).toContain('07:30');
});

it('says a field is not recorded rather than showing an invented value', async () => {
  const t = await render(
    <DateTimeField label="Time in" value={null} onChange={noop} mode="time" scheme="light" placeholder="Not set" onClear={noop} />,
  );
  expect(textIn(t)).toContain('Not set');
  const styles = makeStyles('light');
  const unset = textNodesOf(t).find((n) => String(n.children[0] ?? '') === 'Not set');
  // In the muted treatment an empty text field's placeholder uses, so an unrecorded field
  // does not read as a filled-in one.
  expect(unset?.props?.style).toBe(styles.formFieldPickerTextUnset);
});

it('opens a real platform picker on the field, and closes it again', async () => {
  const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme="light" />);
  expect(pickerOf(t)).toBeUndefined();
  const trigger = triggerOf(t, 'Date');
  if (!trigger) throw new Error('no Date field found');
  await fireEvent.press(trigger);
  expect(pickerOf(t)).toBeDefined();
  await fireEvent.press(trigger);
  expect(pickerOf(t)).toBeUndefined();
});

it('opens the picker on the day already stored, in local time', async () => {
  const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme="light" />);
  const picker = await openPicker(t, 'Date');
  const seeded = new Date(picker.props.date);
  expect(seeded.getFullYear()).toBe(2026);
  expect(seeded.getMonth()).toBe(7);
  expect(seeded.getDate()).toBe(31);
  // The hour matters as much as the day, and is what this zone can actually discriminate:
  // `new Date('2026-08-31')` is UTC midnight, which lands on the RIGHT day here (14:00
  // local) and on the previous day west of Greenwich. Verified by mutation — seeding that
  // way passes the three assertions above and fails this one.
  expect(seeded.getHours()).toBe(0);
  expect(seeded.getMinutes()).toBe(0);
  expect(picker.props.mode).toBe('date');
});

it("opens a time picker on the dive's own day, which is the only day that time is true of", async () => {
  // The seed's DATE half never reaches storage — only the clock is read back off it — and
  // that is exactly why it went unnoticed that it was today's. A wall-clock time is not
  // independent of its day: on a spring-forward date there is no 02:30, so a seed built on
  // that day normalises to 03:30 and an Android picker confirmed unchanged writes the hour
  // back changed. Seeded from today, that hit any dive edited on one of the two transition
  // Sundays; from the dive's own date it can only reach a dive whose own day lacked the
  // hour it records. `datetime.dst.test.ts` covers the hour, in a zone whose clocks move.
  const t = await render(
    <DateTimeField label="Time in" value="02:30" onChange={noop} mode="time" scheme="light" day="2026-08-16" />,
  );
  const picker = await openPicker(t, 'Time in');
  const seeded = new Date(picker.props.date);
  expect(seeded.getFullYear()).toBe(2026);
  expect(seeded.getMonth()).toBe(7);
  expect(seeded.getDate()).toBe(16);
  // Today is not 2026-08-16 on any day this suite will ever run, so the three assertions
  // above fail outright for a seed built on `new Date()`. The hour is checked too, because a
  // seed on the right day at the wrong time would be its own bug.
  expect(seeded.getHours()).toBe(2);
  expect(seeded.getMinutes()).toBe(30);
});

it('falls back to today when it is given no day, rather than inventing one', async () => {
  // The default still has to be usable: a caller with no date to offer gets a picker that
  // opens at the stored time on the current day, exactly as before.
  const t = await render(<DateTimeField label="Time in" value="07:05" onChange={noop} mode="time" scheme="light" />);
  const picker = await openPicker(t, 'Time in');
  const seeded = new Date(picker.props.date);
  const today = new Date();
  expect(seeded.getDate()).toBe(today.getDate());
  expect(seeded.getHours()).toBe(7);
  expect(seeded.getMinutes()).toBe(5);
});

it('stores the day the diver picked, not the UTC day that instant falls in', async () => {
  const onChange = jest.fn();
  const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={onChange} mode="date" scheme="light" />);
  const picker = await openPicker(t, 'Date');
  // What an iOS date picker returns for "1 September": local midnight on that day, which in
  // this zone is still 31 August in UTC.
  await choose(picker, new Date(2026, 8, 1, 0, 0));
  expect(onChange).toHaveBeenCalledWith('2026-09-01');
});

it('stores the wall-clock time the diver picked, in canonical HH:MM', async () => {
  const onChange = jest.fn();
  const t = await render(<DateTimeField label="Time in" value={null} onChange={onChange} mode="time" scheme="light" placeholder="Not set" />);
  const picker = await openPicker(t, 'Time in');
  expect(picker.props.mode).toBe('time');
  await choose(picker, new Date(2026, 7, 31, 7, 5));
  expect(onChange).toHaveBeenCalledWith('07:05');
});

it('sets no minimum or maximum date, so a planned dive and a backfilled one both fit', async () => {
  // DESIGN.md §2.4: logs are half-written in advance, so a dive's date is routinely in the
  // future; divers also backfill paper logbooks decades old. A clamp to today would make
  // planning a dive impossible, which is why this is asserted rather than left to whoever
  // reads the component next.
  const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme="light" />);
  const picker = await openPicker(t, 'Date');
  expect(picker.props.maximumDate).toBeUndefined();
  expect(picker.props.minimumDate).toBeUndefined();

  // And the value itself: a date years ahead is shown and seeded like any other.
  const planned = await render(<DateTimeField label="Date" value="2031-04-05" onChange={noop} mode="date" scheme="light" />);
  expect(textIn(planned)).toContain('5 Apr 2031');
  expect(new Date((await openPicker(planned, 'Date')).props.date).getFullYear()).toBe(2031);
});

it('takes every colour it gives the OS control from the theme, in both schemes', async () => {
  for (const scheme of ['light', 'dark'] as const) {
    const styles = makeStyles(scheme);
    const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme={scheme} />);
    const picker = await openPicker(t, 'Date');
    // §0.1: colour encodes depth and nothing else, so the OS control must not bring iOS's
    // own accent blue into a form. Compared against the token values rather than literals,
    // so this keeps holding if the palette moves.
    expect(picker.props.textColor).toBe(styles.formFieldPickerInk.color);
    expect(picker.props.accentColor).toBe(styles.formFieldPickerAccent.color);
    expect(picker.props.themeVariant).toBe(scheme);
    // No depth-scale hue anywhere near it: both are plain ink from the theme.
    expect(picker.props.textColor).not.toBeUndefined();
  }
});

// §0.5's floor, met the way M1h's design sheet asks for it: **a 20 pt ring in a real 48 dp
// box**, not a compact chip stretched to the floor by `hitSlop`.
//
// The pair of assertions is the point rather than the first one alone. A box that reaches 48
// is half of it; the other half is that the box is ALL of the target, because an invisible
// extension is free to point anywhere and this control's did — `{ left: 21 }`, 21 dp inward,
// which on THIS row falls squarely on the picker's own trigger sitting immediately to its
// left. "Clear this field" delivered over "open this picker" is a defect no assertion about
// the number 48 can see.
//
// There is no Yoga in this environment (react-test-renderer lays nothing out), so the geometry
// is read off the styles the component composes, exactly as `ReorderControls.test.tsx` reads
// its arrows'.
it('gives the clear control a 48 dp box and no invisible target beyond it', async () => {
  const t = await render(
    <DateTimeField label="Time in" value="07:30" onChange={noop} mode="time" scheme="light" onClear={noop} />,
  );
  const clear = clearOf(t, 'Time in');
  if (!clear) throw new Error('no clear control on a set optional field');
  const styles = makeStyles('light');

  // The same style `FormField`'s own clear wears, not a second one that happens to hold the
  // same numbers (§4.1: one owner). Reference equality is the assertion, because value
  // equality is exactly what the two byte-identical declarations this replaced already had —
  // right up until one of them was retuned.
  expect([clear.props.style].flat(5).filter(Boolean)).toContain(styles.clearFieldControl);
  expect(styles.clearFieldControl.minWidth).toBeGreaterThanOrEqual(48);
  expect(styles.clearFieldControl.minHeight).toBeGreaterThanOrEqual(48);

  // Nothing beyond the box. This is the assertion the redesign is: with no slop there is no
  // direction for it to point, and the target cannot reach back over the trigger beside it.
  expect(clear.props.hitSlop).toBeUndefined();
});

it('clears an optional field back to unrecorded, with the empty string and never a value', async () => {
  const onClear = jest.fn();
  const t = await render(
    <DateTimeField label="Time in" value="07:30" onChange={noop} mode="time" scheme="light" placeholder="Not set" onClear={onClear} />,
  );
  const clear = clearOf(t, 'Time in');
  if (!clear) throw new Error('no clear control on a set optional field');
  await fireEvent.press(clear);
  // DESIGN.md §10's coercion contract: `''` is what `optionalText` turns into `null`. A
  // value derived from the field's own contents would be a real time, i.e. not cleared.
  expect(onClear).toHaveBeenCalledWith('');
});

it('offers nothing to clear on a required field, or on one already unrecorded', async () => {
  // `date` is the form's one required field (§2.2), so it is rendered without `onClear` and
  // must show no `×` — an affordance that empties a field the form cannot save without is
  // worse than none.
  const required = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme="light" />);
  expect(clearOf(required, 'Date')).toBeUndefined();

  const empty = await render(
    <DateTimeField label="Time in" value="" onChange={noop} mode="time" scheme="light" placeholder="Not set" onClear={noop} />,
  );
  expect(clearOf(empty, 'Time in')).toBeUndefined();
});

it('leaves the recorded value alone when the picker is dismissed without a choice', async () => {
  const onChange = jest.fn();
  const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={onChange} mode="date" scheme="light" />);
  const picker = await openPicker(t, 'Date');
  // A change event carrying no timestamp: the library's own JS layer drops this one before
  // it reaches this component, and pinning that is what makes the next case meaningful
  // rather than a duplicate of it.
  await fireEvent(picker, 'change', { nativeEvent: {} });
  expect(onChange).not.toHaveBeenCalled();
  // A change event carrying an unusable timestamp DOES reach this component, as a `Date`
  // whose every getter is NaN — and it must leave the recorded date alone rather than
  // overwrite it with an empty value. Verified by mutation: an implementation that forwards
  // `next ?? ''` passes the assertion above and fails this one, having silently erased a
  // date the diver had already set.
  await fireEvent(picker, 'change', { nativeEvent: { timestamp: Number.NaN, utcOffset: 0 } });
  expect(onChange).not.toHaveBeenCalled();
  // And the explicit dismissal closes the field without writing anything.
  await fireEvent(picker, 'pickerDismiss', { nativeEvent: {} });
  expect(onChange).not.toHaveBeenCalled();
  expect(pickerOf(t)).toBeUndefined();
});

it('announces what it holds, not only what it is for', async () => {
  const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme="light" />);
  expect(triggerOf(t, 'Date')?.props?.accessibilityLabel).toBe('Date: 31 Aug 2026');
  expect(triggerOf(t, 'Date')?.props?.accessibilityState?.expanded).toBe(false);
  await openPicker(t, 'Date');
  expect(triggerOf(t, 'Date')?.props?.accessibilityState?.expanded).toBe(true);
});

it('draws nothing outside its own makeStyles treatment, open or closed', async () => {
  for (const scheme of ['light', 'dark'] as const) {
    const t = await render(<DateTimeField label="Date" value="2026-08-31" onChange={noop} mode="date" scheme={scheme} />);
    expect(unexpectedGraphics(t, scheme)).toHaveLength(0);
    await openPicker(t, 'Date');
    expect(unexpectedGraphics(t, scheme)).toHaveLength(0);
  }
});

it('shows a value it cannot read as it stands, rather than claiming the field is empty', async () => {
  // Not reachable from this control — that is the point of it — but reachable from a row
  // another client wrote (M2 sync) or a hand-edited one, which carry-over then prefills this
  // form from. Saying "Not set" for a field that holds `31.8.2026` would hide the very value
  // the schema's message underneath is complaining about.
  const onClear = jest.fn();
  const t = await render(
    <DateTimeField label="Date" value="31.8.2026" onChange={noop} mode="date" scheme="light" placeholder="Not set" onClear={onClear} />,
  );
  expect(textIn(t)).toContain('31.8.2026');
  expect(textIn(t)).not.toContain('Not set');
  // It is still clearable, and the picker still opens — on today, since there is no readable
  // day to open on, and never on an invented one.
  expect(clearOf(t, 'Date')).toBeDefined();
  const picker = await openPicker(t, 'Date');
  expect(Number.isFinite(picker.props.date)).toBe(true);
});
