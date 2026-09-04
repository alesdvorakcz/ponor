import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormField } from '../components/FormField';
import { OptionChips } from '../components/OptionChips';
import { db } from '../db/client';
import { parseDiveCount, setDivesBefore, setUnitSystem } from '../db/settings';
import { useDivesBefore } from '../db/useDivesBefore';
import { useGearPresets } from '../db/useGearPresets';
import { useUnitSystem } from '../db/useUnitSystem';
import { isDiveCount } from '../domain/diveNumber';
import { PRESETS_UNREADABLE } from '../domain/presets';
import { type GearPreset } from '../domain/types';
import { formatCylinders, formatUnitSystem } from '../format/display';
import { UNIT_SYSTEMS, type UnitSystem } from '../format/units';
import { useForegroundReturn } from '../hooks/useForegroundReturn';
import { locationPermission, type LocationPermissionState } from '../platform/locationPermission';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

/** Shown when a settings write rejects. §1's "never block a save" cuts both ways, and this
 * is the other one: a diver who changes a setting and is not told the change failed is
 * looking at a screen that lies to them the next time they open it. */
const SAVE_FAILED = "Couldn't save that. Try again.";

/**
 * The two things that stand where the preset rows would be, and they are different sentences
 * on purpose — `useGearPresets`' `error` field exists for exactly this distinction, and its
 * own docblock says so: "a diver who went to that screen specifically to manage presets must
 * not be shown the second when the first is true."
 *
 * The empty one names where a preset comes from, because nothing on this screen otherwise
 * would: creation lives in the dive form (§10 — "saving one takes whatever cylinders are
 * already typed into the dive you are logging"), so a diver who has never saved one is
 * looking at a section with no visible way in. Without the line the section is a mystery.
 *
 * The read-failure half is `PRESETS_UNREADABLE` (domain/presets.ts) rather than a literal
 * here, because `GearPresetScreen` says the same sentence about the same event one route
 * deeper and the two were byte-identical. A failure message normally belongs to the screen
 * that shows it — `SAVE_FAILED` above, the dive form's own save error, the detail screen's
 * delete error, all of which differ because each names a different object — and that stays
 * true; two screens naming the same object is what turns a look-alike into a copy. The empty
 * line below has no twin and stays here.
 */
const NO_PRESETS = 'Save one from a dive’s Gas & cylinders group and it will show up here.';

/** §3's own name for this row, and the leading half of what a screen reader announces about
 * it. The words are the design's ("**location access**"), not a paraphrase of them. */
const LOCATION_LABEL = 'Location access';

/**
 * The value slot before the permission has been read.
 *
 * **A screen with no answer must not state one** — M1f's rule, which the `dives_before` row
 * above keeps for the same reason and which this row can break more quietly: `denied` and
 * "not read yet" are both "not `granted`", and a row that defaulted to either would tell a
 * diver where they stand before anyone had looked. Present tense and no full stop, the same
 * shape the form's *Locating…* takes for the same kind of moment.
 */
const LOCATION_UNREAD = 'Checking…';

/**
 * What the row says when the system Settings app could not be opened at all.
 *
 * §1: **nothing here may fail silently and leave the diver stuck.** A row that reports a
 * permission and then does nothing when pressed is the dead-control shape §0.6 has already
 * recorded three times over — and there is one platform where this is not hypothetical, since
 * a browser has no per-app settings page for a page to open (`Linking.openSettings()` rejects
 * on web; §9 keeps the browser a testing target, which is a reason for it to say so rather
 * than a reason to crash in it).
 */
const SETTINGS_UNREACHABLE = 'Couldn’t open Settings from here — open it yourself and find Ponor.';

/** One state's two lines: what the row's value column says, and the sentence under it. */
interface LocationRowText {
  /** The trailing value — where the diver stands, in as few words as that takes. */
  readonly status: string;
  /** Why that matters and what can be done about it, in the caption slot under the row. */
  readonly note: string;
}

/**
 * **What each of the five permission states says to a diver, and why five and not two.**
 *
 * §3 gives this row one job — "the row states the current status and takes them to the system
 * Settings app" — and `platform/locationPermission.ts` is the owner of what the status can be
 * (§4.1). This screen reads that vocabulary and does not re-derive it: a `Record` over
 * `LocationPermissionState` rather than a chain of comparisons, so a sixth state added there
 * cannot arrive here without a sentence (§4.1's "derive, or tie at compile time"), exactly as
 * `POSITION_REFUSAL_NOTES` ties the dive form to `POSITION_REFUSALS`.
 *
 * **Collapsing them into on/off is the defect the five states exist to prevent**, and each
 * pair below is a different thing to do next:
 *
 * - `undetermined` is not `denied`. Nobody has refused anything, so the honest line is that
 *   Ponor will ask — and iOS does not even list Location under an app it has never been asked
 *   for, so telling this diver to go and change a setting would send them to a page with no
 *   such row on it.
 * - `denied` is where the row earns its place. iOS spends its permission sheet **once ever**,
 *   so no tap inside the app can ever ask again, and the device's Settings is the only place
 *   the answer can change.
 * - `servicesOff` is not about this app at all. It outranks even a granted permission (that
 *   module's own ordering rule), and the switch that fixes it is the device's rather than
 *   Ponor's, so a line about allowing Ponor would be pointing at the wrong control.
 * - `unknown` is not a refusal. The query itself failed; asserting "you said no" would accuse
 *   the diver of something they may never have done.
 *
 * **A near-duplicate that is not one** (§4.1's "a deliberate near-duplicate names its
 * siblings"): `DiveFormScreen`'s `POSITION_REFUSAL_NOTES` also has sentences about denials
 * and about Location Services. They answer a different question — *why the tap you just made
 * produced no pin*, over `PositionRefusal`, which also covers a timeout and a fix too rough
 * to keep — and they end by inviting the next tap, because that row goes on asking. These
 * describe a standing state on a screen with nothing to retry, and the row itself is the way
 * to change it. Sharing them would mean one sentence trying to do both, and neither
 * vocabulary contains the other.
 */
const LOCATION_ROW_TEXT: Record<LocationPermissionState, LocationRowText> = {
  granted: {
    status: 'Allowed',
    note: 'Ponor can pin a dive where you are. Open Settings to change that.',
  },
  denied: {
    status: 'Not allowed',
    note: 'Ponor may not use your location. iOS asks once and never again, so Settings is the only place this can change.',
  },
  undetermined: {
    status: 'Not asked yet',
    note: 'Nobody has been asked yet — Ponor asks the first time you use it on a dive.',
  },
  servicesOff: {
    status: 'Location Services off',
    note: 'Location Services are off for the whole device, so nothing on it can be located. That switch is the device’s, not Ponor’s.',
  },
  unknown: {
    status: 'Unknown',
    note: 'Ponor couldn’t check where this stands. Settings will show it.',
  },
};

/**
 * One preset: its name, and what its cylinders are (`formatCylinders`, format/display.ts —
 * the module §4.1 makes the one owner of turning a stored value into diver-facing text, built
 * from the same five formatters the dive detail's own cylinder rows use).
 *
 * **The whole row opens the editor, and the row carries no delete.** Deleting sits at the end
 * of the editor, exactly as *Delete dive* sits at the end of the dive detail rather than on a
 * row of the dive list — which is what keeps this a list rather than a control panel, and
 * what keeps the one act that removes something behind a deliberate reach.
 *
 * It is `formField`, the same row *Units* and *Dives before Ponor* are (§0.6, and this
 * screen's own rule that its rows are the form's rows). What differs is the ink: a preset's
 * name takes full `fg` where a setting's label is muted, because it is the diver's own data
 * and the thing they scan this list for — §0.6's "ink versus muted ink is the only lever",
 * used the same way `tripTitleUpNext` and `detailActionLabel` already use it.
 *
 * The summary is omitted rather than shown as a dash when there is nothing to say — a preset
 * holding no cylinders is a row `createGearPreset` permits and M2 sync can deliver, and an
 * empty second line under the name would read as a value that failed to load.
 */
function PresetRow({ preset, units, styles }: { preset: GearPreset; units: UnitSystem; styles: Styles }) {
  const summary = formatCylinders(preset.tanks, units);
  return (
    <Pressable
      style={styles.formField}
      // Absolute and interpolated, for the reason `DivesScreen`'s own `openDive` records:
      // expo-router's typed routes (app.config.ts's `experiments.typedRoutes`) check an
      // absolute path against the routes that actually exist on disk, where a relative one is
      // resolved at runtime and checked against nothing at all.
      onPress={() => router.push(`/preset/${preset.id}`)}
      accessibilityRole="button"
      // Says what pressing it does, not merely what it is called — a row announced as a bare
      // name says nothing about where a tap would land. The same shape the dive form's own
      // chips use ("Apply preset X"), and deliberately a different verb, because these two
      // rows do different things to the same preset.
      accessibilityLabel={`Edit preset ${preset.name}`}
    >
      <View style={styles.formFieldRow}>
        <Text style={styles.settingsPresetName}>{preset.name}</Text>
      </View>
      {summary !== null && <Text style={styles.settingsPresetSummary}>{summary}</Text>}
    </Pressable>
  );
}

/**
 * The Settings screen (DESIGN.md §3), at route `/settings` via a thin re-export in
 * `src/app/(tabs)/settings.tsx` — this file lives outside expo-router's swept `src/app/`
 * tree for the reason `DivesScreen.tsx` records: a test colocated with a route would be
 * bundled into the app.
 *
 * **Two settings, one list, one report and one destination, and §3 lists more on purpose.**
 * The certification wallet, data export and delete-account all belong to M3. §3's **account &
 * sync** arrived in M2e as the last item below — a row that opens `/account` and writes
 * nothing itself, which is this screen's second navigation row and the only route into the
 * account screen at all. §3's **location access** arrived in M2m, between the two: it writes
 * nothing either, and what it opens is not a screen of ours but the device's own Settings app,
 * which §3 makes the only place its answer can change.
 *
 * §3 listed a **"Fields I use"** screen here until M1i dropped it: §2.2's collapse rule
 * already hides a group nobody fills, and a carried field that keeps one open can be
 * cleared. It is on §9's shelf with the signal that would bring it back, so its absence
 * below is a decision rather than a milestone boundary:
 *
 * - **Units** (§3's m/ft · bar/psi · °C/°F · kg/lb). `format/units.ts` owns the system and
 *   its four pairs (§4.1), so the options here are `UNIT_SYSTEMS` itself rather than a
 *   second list of the same two words — §4.1's "derive, or tie at compile time". A third
 *   system added there appears here on its own.
 * - **`dives_before`** (§2.5: "asked once at onboarding, editable in settings any time").
 *
 * The third entry is §3's **cylinder presets**, which is a list rather than a setting: it is
 * where a saved preset is renamed, re-specified or deleted (§10 — "§3's Settings list is then
 * a real editor, name and cylinders both, not a list of names with a delete button"). It
 * writes nothing itself. A row opens `/preset/[id]`, and every rule about a preset — what its
 * name may be, what its cylinders convert to, whether it may be emptied — lives on that
 * screen and in `db/gearPresets.ts`, not here.
 *
 * The fourth is §3's **location access**, which is neither a setting nor a list: it is the one
 * row on this screen that only *reports*. The value belongs to the operating system, this
 * screen cannot write it and must not even ask for it — see `LOCATION_ROW_TEXT` above for the
 * five answers it can report and for why the row exists at all.
 *
 * **Both settings write through `db/settings.ts` and never touch the `settings` row
 * directly.** That module owns the two keys, the coercion and the upsert, and it owns them
 * precisely so the read and the write cannot disagree: `readUnitSystem` only ever sees
 * strings `setUnitSystem` wrote, and `readDivesBefore`'s "anything that is not decimal digits
 * is corruption" reasoning only holds while `setDivesBefore` is the one writer. A screen
 * writing `units` itself would be the second writer that reasoning assumes does not exist.
 *
 * **The rows are the form's rows** (§0.6: "a field is a row, label leading, value
 * trailing"), through the same two components the dive form uses — `OptionChips` and
 * `FormField`. Settings is a column of fields about the app rather than about a dive, and
 * inventing a third vocabulary for the same objects is what §0.6's own form section exists
 * to stop.
 */
export default function SettingsScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  // How far down this screen's content begins, from the device rather than from a constant
  // (`screenTopInset`, theme/styles.ts — the app's one owner of that rule). The reported
  // defect: with the sheet's old flat 48, "Settings" sat at 56.3 pt on an iPhone 17 Pro,
  // above the 62 pt line the Dives capsule and iOS 26's own apps both use, i.e. inside the
  // safe area and crowding the Dynamic Island.
  const insets = useSafeAreaInsets();
  // Both live reads, so this screen shows what is actually stored rather than what it last
  // wrote — the same discipline DivesScreen keeps with `useDives()`. A write below is never
  // read back from its own return value.
  const units = useUnitSystem();
  // `resolved` alongside the count for the reason that hook's own field states: `count` reads 0
  // before the read answers, which is indistinguishable from a diver who genuinely has none —
  // and this is the one screen where that 0 is not merely shown but typed over.
  const { count: divesBefore, resolved: divesBeforeResolved } = useDivesBefore();
  // The text the stored count reads as, in one place, because two things restore the field from
  // it — the reseed gate below and `settleCount` — and they must not disagree about what an
  // unknown count looks like. `''` covers all three ways there is nothing to show: a read that
  // has not answered, a stored value that could not be read (`null`), and the two together.
  // The row's `0` placeholder then says what belongs there without asserting a value (§0.6).
  const storedCountText = () =>
    !divesBeforeResolved || divesBefore === null ? '' : String(divesBefore);
  // §2.1's cylinder presets, from their own hook rather than a field on either read above —
  // see db/useGearPresets.ts for why a failed preset read must not be able to blank anything
  // else. Its `error` IS read here, and this is the screen it was carried for.
  // `resolved` is read alongside the list for the reason its own docblock gives: `presets`
  // alone cannot say whether it has been read yet, and the line below states an answer.
  const { presets, error: presetsError, resolved: presetsResolved } = useGearPresets();

  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  // The `dives_before` field's own text, which is NOT the stored value: a diver mid-edit has
  // typed something that may not be a count yet ("", "2" on the way to "24"), and the field
  // has to show that rather than snapping to whatever is currently in the database.
  const [countText, setCountText] = useState('');
  /**
   * Whether the diver has typed into the count field at all. It is what stops the reseed below
   * replacing their text when a late answer arrives, and it is this screen's own mechanism —
   * an explicit flag, because this row has neither of the two things the other seeded screens
   * lean on.
   *
   * **Three screens hold a draft over an asynchronous read, and all three protect it by
   * DIFFERENT mechanisms** (§4.1's "a deliberate near-duplicate names its siblings"). They are
   * not one rule written three times, and unifying them would be its own bug — each screen has
   * a different thing available to compare:
   *
   * - `DiveFormScreen`: **react-hook-form's `resetOptions.keepDirtyValues`** does the
   *   protecting. Its `SeedState.typed` does NOT — that set only suppresses §0.6's carried marks
   *   (see its own docblock). The form library knows which fields the diver moved, so nothing
   *   here has to.
   * - `GearPresetScreen`: **a structural gate**, no flag at all. `PresetDraft` reseeds only when
   *   `sourceId` or `units` changes, so a re-read of the SAME preset cannot disturb a draft —
   *   the identity it compares is already the answer. (Its `units` half is a different story;
   *   that docblock records it.)
   * - Here: **this flag.** There is no form library on this row, and no source identity to
   *   compare either — the stored count IS the value, so "has the answer changed" and "is this
   *   what the diver typed" cannot be told apart by comparing anything. Something has to
   *   remember the gesture, so this does.
   *
   * The principle all three serve is the same, and `PresetDraft` states it: a diver's half-typed
   * edit must not be overwritten mid-keystroke.
   *
   * Cleared by `settleCount`, and only there — see it for why a discarded draft has nothing left
   * to protect. Sticky everywhere else because `setDivesBefore` (below) is this row's only
   * writer and it is this field's own keystrokes, so a reseed after the diver's own write could
   * only ever restore the text they just typed.
   */
  const [countTyped, setCountTyped] = useState(false);
  // What `countText` was last seeded from. Compared as a scalar and adjusted during render
  // rather than in an Effect, which is React's own documented pattern for this and is what
  // `DiveFormScreen`'s reseed gate already does; `undefined` is "never seeded", distinct from a
  // stored `null` (unreadable) and from 0.
  //
  // **Both extra conditions are M1f, and between them they close a defect that DESTROYED a
  // diver's input rather than merely asserting something false.** `useDivesBefore` reported 0
  // before the read had answered, indistinguishable from a diver who never answered the
  // onboarding question — so this gate seeded the field with a `0` nobody had entered, and then
  // fired again when the real value landed and replaced whatever had been typed over it.
  // Silently, with no error and nothing on screen to say so, and §2.5 makes this row the offset
  // every dive number in the logbook is computed from, so it is not a display detail.
  //
  // `divesBeforeResolved` is what stops the false seed: until the read answers there is nothing
  // to seed FROM, and the row shows its `0` placeholder instead, which says what belongs there
  // without claiming it is the value (§0.6). `countTyped` is what stops the destruction, and it
  // is needed on its own — without it the first real answer still lands on top of anything typed
  // while waiting, and the wait is exactly what §7's sync makes longer.
  //
  // It must still reseed in the two cases it exists for, and it does: a diver who has typed
  // nothing gets the real value the moment it arrives (`countTyped` false), and a diver who
  // changes the count writes it themselves through `editCount`.
  const [seededFrom, setSeededFrom] = useState<number | null | undefined>(undefined);
  if (divesBeforeResolved && !countTyped && seededFrom !== divesBefore) {
    setSeededFrom(divesBefore);
    setCountText(storedCountText());
    // A reseed means the database's own answer changed; whatever the last write said about
    // itself is stale.
    setCountError(null);
  }

  const chooseUnits = (value: UnitSystem | '') => {
    // `OptionChips` reports `''` when the diver presses the chip that is already selected —
    // its way of saying "clear this field". A unit system has no cleared state (`readUnitSystem`
    // degrades an absent or unreadable row to metric rather than to nothing), so that press
    // leaves the choice exactly where it is. See that component's `onChange` for why the
    // caller absorbs this rather than the component growing a mode.
    if (value === '') return;
    setUnitsError(null);
    setUnitSystem(db, value).catch(() => setUnitsError(SAVE_FAILED));
  };

  const editCount = (text: string) => {
    setCountText(text);
    // From here on the field holds the diver's own text, and no later answer from the database
    // may replace it — see `countTyped` above for the rule and for the two screens that already
    // state it. Set on every keystroke, including the ones that are not yet a count, because a
    // diver halfway through "247" has typed just as surely as one who finished.
    setCountTyped(true);
    const parsed = parseDiveCount(text);
    if (!isDiveCount(parsed)) {
      // Nothing is written for text that is not yet a count, and the row keeps whatever it
      // held. A cleared field is the ordinary case here — a diver retyping 247 passes
      // through "" — so it is not an error worth shouting about until they leave the row;
      // `settleCount` below is what resolves it either way.
      setCountError(null);
      return;
    }
    setCountError(null);
    // §2.5: this offsets every dive number in the logbook, so the whole list renumbers as
    // soon as the write lands. That is the intended behaviour and it is visible immediately
    // — `useDives()` reads this same row through the same live query.
    setDivesBefore(db, parsed).catch(() => setCountError(SAVE_FAILED));
  };

  // Leaving the field is where a half-typed or unusable value is resolved: the text goes
  // back to what is actually stored, so the row can never sit showing a number the logbook
  // is not numbered from. Restoring silently would hide the fact that nothing was saved,
  // hence the note — except for a simply-empty field, which is what retyping looks like and
  // says nothing about the diver's intent.
  const settleCount = () => {
    // A valid count returns early, and `countTyped` stays set with it: that value is the
    // diver's, `editCount` has already written it, and it must keep winning over any later
    // answer from the database.
    if (isDiveCount(parseDiveCount(countText))) return;
    if (countText.trim() !== '') setCountError('Whole dives only, 0 or more — nothing was saved.');
    // Past here the draft is being DISCARDED — the text was not a count and nothing was saved —
    // so there is no draft left for `countTyped` to protect, and leaving it set would make this
    // field permanently unfillable: a diver who typed something unusable before the read
    // answered would be left with an empty row the real value could never afterwards reach.
    setCountTyped(false);
    // Through the same `storedCountText` the reseed uses, so an unusable entry left before the
    // read has answered restores to an empty row rather than to a `0` nothing has read.
    setCountText(storedCountText());
  };

  // §3's location access. `null` is "not read yet" and is a third thing beside the five
  // states, never one of them — see `LOCATION_UNREAD`.
  const [permission, setPermission] = useState<LocationPermissionState | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  /**
   * **Reading the permission, which must never ask for it.** §3: "Reading the status must not
   * request it: those are two operations and a settings row that prompts merely by being
   * looked at is a worse offence than the dead tap it fixes." `platform/locationPermission.ts`
   * is built to that — `locationPermission()` never raises a sheet and
   * `requestLocationPermission()` is the half this screen must not touch at all, because iOS
   * spends its one sheet on whoever asks first and a diver merely opening Settings would spend
   * it on a row they were reading.
   *
   * No `catch`. That module answers `unknown` on every failure of its own (its whole reason
   * for having a fifth state), so a rejection here is not a case this screen can be in — and
   * §10 declines a guard nothing could ever catch failing rather than banking it.
   */
  const readPermission = useCallback(() => {
    void locationPermission().then(setPermission);
  }, []);
  useEffect(() => {
    readPermission();
  }, [readPermission]);
  /**
   * **And re-reading it when the diver comes back, which is the whole point of the row.**
   *
   * They press it, change the switch in the system Settings app, and return — to a row still
   * showing the old answer unless something looks again. Nothing else can tell us: the change
   * happens in another app, so there is no event in this one, and the permission module caches
   * nothing precisely so that a fresh read is the truth.
   *
   * `hooks/useForegroundReturn.ts` is §7.5's own foreground trigger, moved out of
   * `cloud/syncTriggers.tsx` when this became its second caller (M2m) rather than rewritten
   * here — the "a return is a transition, not an event" rule is subtle enough that two copies
   * would have drifted, which is §4.1's defining defect.
   */
  useForegroundReturn(readPermission);

  /**
   * The one thing the row does, and the only place the answer can change (§3).
   *
   * `expo-linking`'s `openSettings` rather than `react-native`'s: on a device it *is* the same
   * call — expo delegates straight to `Linking.openSettings()` — and where the platform has no
   * such thing it rejects, where react-native-web simply does not define the function and the
   * press would die as a `TypeError` inside the handler. A promise this screen can answer, in
   * place of a crash it cannot.
   */
  const openDeviceSettings = () => {
    // Cleared at the start of the attempt, exactly as the form's own refusal note is, so the
    // sentence stands for as long as it is still true and no longer.
    setLocationError(null);
    void Linking.openSettings().catch(() => setLocationError(SETTINGS_UNREACHABLE));
  };
  // `null` until the read answers, which is what keeps the row from stating an answer it does
  // not have.
  const locationText = permission === null ? null : LOCATION_ROW_TEXT[permission];

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      {/* `keyboardShouldPersistTaps="handled"`, the same as the dive form's own ScrollView.
          RN's default is `'never'`, under which the first tap anywhere while a field has
          focus is spent dismissing the keyboard and never reaches what it landed on — so
          with the count field open, tapping Metric or Imperial would do nothing visible and
          need a second tap. `'handled'` lets a control that handles the tap have it, while
          a tap on the background still dismisses the keyboard and blurs the field, which is
          what runs `settleCount` below. */}
      <ScrollView
        style={styles.settingsScroll}
        // **The last row's clearance is the device's** (M1h — `screenBottomInset`,
        // theme/styles.ts). This ScrollView is its root's only child, so it runs to the
        // bottom of the display and its content scrolls under the tab bar; the 40 pt it
        // inherited while `settingsContent` was shared with the dive form is 43 short of the
        // 83 a screen inside `(tabs)` reports. The form's copy keeps its constant and is
        // right to: its scroll stops at `formFooter`, which spends the inset itself. Nothing
        // stops this one. Not yet visible with two settings and no presets — the content does
        // not reach the bottom — which is exactly how the same defect stayed hidden on the
        // Dives list until a logbook was long enough to scroll.
        contentContainerStyle={[styles.settingsContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.settingsHeading}>Settings</Text>

        <View>
          <OptionChips
            label="Units"
            value={units}
            options={UNIT_SYSTEMS}
            displayLabel={formatUnitSystem}
            onChange={chooseUnits}
            scheme={scheme}
          />
          {unitsError !== null && (
            <View style={styles.settingsCaption}>
              <Text style={styles.settingsCaptionText}>{unitsError}</Text>
            </View>
          )}
        </View>

        <View>
          <FormField
            label="Dives before Ponor"
            value={countText}
            onChange={editCount}
            onBlur={settleCount}
            scheme={scheme}
            // A whole count of dives, so no separator key — the same reasoning `FormField`'s
            // own `keyboardType` records for a cylinder count, and the same reason
            // `parseDiveCount` accepts decimal digits and nothing else.
            keyboardType="number-pad"
            // §0.6: "Figures in mono, names in sans." A dive count is a figure.
            mono
            placeholder="0"
          />
          <View style={styles.settingsCaption}>
            <Text style={styles.settingsCaptionText}>
              Dives you logged before Ponor. Your dive numbers start after it.
            </Text>
            {divesBefore === null && (
              // The one case `useDivesBefore` reports rather than degrading: the stored value
              // is present and is not a count, which would otherwise misnumber the whole
              // logbook by the diver's entire history with nothing on screen to say so. This
              // is the screen where that is fixable, so it says so here and nowhere else.
              <Text style={styles.settingsCaptionText}>
                Your saved count couldn&apos;t be read. Type it again to replace it.
              </Text>
            )}
            {countError !== null && <Text style={styles.settingsCaptionText}>{countError}</Text>}
          </View>
        </View>

        {/* §3's cylinder presets. A named section rather than a bare run of rows, because it
            is the first thing on this screen that is a list of the diver's own things rather
            than a setting about the app — `clusterLabel`'s treatment (§0.6: "a group header
            is a cluster label"), the same one *Conditions* and *Gas & cylinders* wear on both
            other screens. */}
        <View>
          <Text style={styles.settingsSectionTitle}>Cylinder presets</Text>
          {presets.map((preset) => (
            <PresetRow key={preset.id} preset={preset} units={units} styles={styles} />
          ))}
          {/* **Neither sentence is said until there is an answer to say one about** (M1f).
              `useGearPresets()` hands back an empty list on the renders before its query
              returns, so "save one from a dive" — a claim about what this diver has — was told
              to every diver on every open of this screen, including the ones with four presets.
              `presetsError` decides WHICH sentence; `presetsResolved` decides WHETHER there is
              one, the same two-part gate `GearPresetScreen` puts on its own pair one route
              deeper, and safe in this order only because a failed read counts as an answer
              (`isResolved`, db/liveQuery.ts).

              The heading above stays put through all of it, so this is a section filling in
              rather than one appearing: nothing on screen moves when the line or the rows land
              under it. */}
          {presetsResolved && presets.length === 0 && (
            <View style={styles.settingsPresetEmpty}>
              <Text style={styles.settingsCaptionText}>
                {presetsError === undefined ? NO_PRESETS : PRESETS_UNREADABLE}
              </Text>
            </View>
          )}
        </View>

        {/* §3's **location access**, in the place §3 lists it: after the presets and before
            account & sync.

            **A row, not a new idiom** (§0.6) — the label leading and muted like *Units*' own,
            the value trailing, the hairline on the top edge that `formField` draws, and the
            48 dp floor `formFieldRow` carries (§0.5). It is a setting about the app that
            happens to be set somewhere else, so it takes the setting's muted label rather than
            the full ink *Account & sync* wears: that row is a destination with no value, and
            this one holds one. **No chevron either way** — §0.6 spends that mark on in-place
            disclosure alone, "never on navigation".

            It announces `label: value` rather than "Open Settings", which is the other shape
            this screen's pressable rows use. The difference is what a diver needs from it:
            the account row has nothing to say but where it goes, and this row's whole reason
            to exist is the answer it carries. The caption below says what a press does, in
            the diver's own words rather than in a control's. */}
        <View>
          <Pressable
            style={styles.formField}
            onPress={openDeviceSettings}
            accessibilityRole="button"
            accessibilityLabel={`${LOCATION_LABEL}: ${locationText?.status ?? LOCATION_UNREAD}`}
          >
            <View style={styles.formFieldRow}>
              <Text style={styles.formFieldLabel}>{LOCATION_LABEL}</Text>
              <Text
                style={
                  locationText === null ? styles.settingsLocationStatusUnread : styles.settingsLocationStatus
                }
              >
                {locationText?.status ?? LOCATION_UNREAD}
              </Text>
            </View>
          </Pressable>
          {(locationText !== null || locationError !== null) && (
            <View style={styles.settingsCaption}>
              {locationText !== null && <Text style={styles.settingsCaptionText}>{locationText.note}</Text>}
              {locationError !== null && <Text style={styles.settingsCaptionText}>{locationError}</Text>}
            </View>
          )}
        </View>

        {/* §3's **account & sync**, and the only way into the account screen — §1 makes an
            account optional, so there is no launch screen, no prompt and no other route to it
            (M2e).

            **One row and no section heading**, unlike the preset list above. A cluster label
            names a *group* of rows (§0.6), and this is one row; a heading over a single row
            would be the label written twice. It is separated from the presets by this
            scroll's own gap and by the row's own top hairline, which `formField` draws.

            **It says nothing about who is signed in**, which is a decision and not a gap. That
            would need a second live read of the session on a screen that is opened on every
            app launch, and §4.1's whole subject is a second reader that is free to disagree
            with the first — `useAuthSession` is the one owner of that answer, and the account
            screen is where it is asked. */}
        <Pressable
          style={styles.formField}
          // Absolute and interpolated for `PresetRow`'s own recorded reason: expo-router's
          // typed routes check an absolute path against the routes that actually exist on
          // disk, where a relative one is resolved at runtime and checked against nothing.
          onPress={() => router.push('/account')}
          accessibilityRole="button"
          // Says what pressing it does rather than merely what it is called, the same shape
          // `Edit preset X` uses one row-type above.
          accessibilityLabel="Open account & sync"
        >
          <View style={styles.formFieldRow}>
            <Text style={styles.settingsAccountLabel}>Account &amp; sync</Text>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}
