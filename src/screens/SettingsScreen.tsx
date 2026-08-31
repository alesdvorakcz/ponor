import { useState } from 'react';
import { ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormField } from '../components/FormField';
import { OptionChips } from '../components/OptionChips';
import { db } from '../db/client';
import { parseDiveCount, setDivesBefore, setUnitSystem } from '../db/settings';
import { useDivesBefore } from '../db/useDivesBefore';
import { useUnitSystem } from '../db/useUnitSystem';
import { isDiveCount } from '../domain/diveNumber';
import { formatUnitSystem } from '../format/display';
import { UNIT_SYSTEMS, type UnitSystem } from '../format/units';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenTopInset } from '../theme/styles';

/** Shown when a settings write rejects. §1's "never block a save" cuts both ways, and this
 * is the other one: a diver who changes a setting and is not told the change failed is
 * looking at a screen that lies to them the next time they open it. */
const SAVE_FAILED = "Couldn't save that. Try again.";

/**
 * The Settings screen (DESIGN.md §3), at route `/settings` via a thin re-export in
 * `src/app/(tabs)/settings.tsx` — this file lives outside expo-router's swept `src/app/`
 * tree for the reason `DivesScreen.tsx` records: a test colocated with a route would be
 * bundled into the app.
 *
 * **Two settings, and §3 lists many more on purpose.** "Fields I use", gear presets, the
 * certification wallet, account and sync, data export and delete-account all belong to
 * later milestones — the wallet and export to M3, account and sync to M2, and the rest to
 * whenever the fields they configure exist. M1 is "the local logbook", and the two things
 * below are the two that M1's own screens already depend on:
 *
 * - **Units** (§3's m/ft · bar/psi · °C/°F · kg/lb). `format/units.ts` owns the system and
 *   its four pairs (§4.1), so the options here are `UNIT_SYSTEMS` itself rather than a
 *   second list of the same two words — §4.1's "derive, or tie at compile time". A third
 *   system added there appears here on its own.
 * - **`dives_before`** (§2.5: "asked once at onboarding, editable in settings any time").
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
  const divesBefore = useDivesBefore();

  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  // The `dives_before` field's own text, which is NOT the stored value: a diver mid-edit has
  // typed something that may not be a count yet ("", "2" on the way to "24"), and the field
  // has to show that rather than snapping to whatever is currently in the database.
  const [countText, setCountText] = useState('');
  // What `countText` was last seeded from. `useDivesBefore()` resolves asynchronously — the
  // first render of this screen always sees the "no row yet" answer and the real value
  // arrives a moment later — so the field has to reseed when it does, or an imperial diver
  // with 247 prior dives would sit here looking at a 0 that is not what is stored. Compared
  // as a scalar and adjusted during render rather than in an Effect, which is React's own
  // documented pattern for this and is what `DiveFormScreen`'s reseed gate already does;
  // `undefined` is "never seeded", distinct from a stored `null` (unreadable) and from 0.
  const [seededFrom, setSeededFrom] = useState<number | null | undefined>(undefined);
  if (seededFrom !== divesBefore) {
    setSeededFrom(divesBefore);
    setCountText(divesBefore === null ? '' : String(divesBefore));
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
    if (isDiveCount(parseDiveCount(countText))) return;
    if (countText.trim() !== '') setCountError('Whole dives only, 0 or more — nothing was saved.');
    setCountText(divesBefore === null ? '' : String(divesBefore));
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
      </ScrollView>
    </View>
  );
}
