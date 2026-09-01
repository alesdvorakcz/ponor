import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
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
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenTopInset, type Styles } from '../theme/styles';

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
 * **Two settings and one list, and §3 lists more on purpose.** "Fields I use", the
 * certification wallet, account and sync, data export and delete-account all belong to
 * later milestones — the wallet and export to M3, account and sync to M2, and the rest to
 * whenever the fields they configure exist. M1 is "the local logbook", and the two settings
 * below are the two that M1's own screens already depend on:
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
 * **Both write through `db/settings.ts` and never touch the `settings` row directly.** That
 * module owns the two keys, the coercion and the upsert, and it owns them precisely so the
 * read and the write cannot disagree: `readUnitSystem` only ever sees strings `setUnitSystem`
 * wrote, and `readDivesBefore`'s "anything that is not decimal digits is corruption"
 * reasoning only holds while `setDivesBefore` is the one writer. A screen writing `units`
 * itself would be the second writer that reasoning assumes does not exist.
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
   * Whether the diver has typed into the count field at all — the one thing that survives every
   * reseed below, and the reason this field is not `DiveFormScreen`'s problem all over again.
   *
   * `SeedState.typed` (DiveFormScreen.tsx) and `PresetDraft` (GearPresetScreen.tsx) both state
   * the same rule for the same reason: **once a diver has touched a field, their draft wins over
   * a later answer from the database**, because "the alternative is a diver's half-typed edit
   * being overwritten mid-keystroke". Having been typed is a fact that does not expire, so this
   * is never cleared.
   *
   * Sticky is safe here specifically because nothing else writes this row: `setDivesBefore`
   * (below) is the only writer, and it is this field's own keystrokes. A reseed after the
   * diver's own write only ever restores the text they just typed, so refusing it costs nothing;
   * `settleCount` below still reads the stored value directly, which is what restores an
   * unusable entry.
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
        contentContainerStyle={styles.settingsContent}
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
      </ScrollView>
    </View>
  );
}
