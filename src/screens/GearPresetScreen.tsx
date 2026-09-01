import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldNote } from '../components/FieldNote';
import { FormField } from '../components/FormField';
import { OptionChips } from '../components/OptionChips';
import { db } from '../db/client';
import { softDeleteGearPreset, updateGearPreset } from '../db/gearPresets';
import { useGearPresets } from '../db/useGearPresets';
import { useUnitSystem } from '../db/useUnitSystem';
import {
  TANK_FIELDS,
  toDisplayTank,
  toInputString,
  toStoredTanks,
  unknownOptionNote,
  type TankFormInput,
} from '../domain/diveFormSchema';
import { PRESET_SAVE_FAILED, PRESETS_UNREADABLE, presetRefusal } from '../domain/presets';
import { TANK_MATERIAL_VALUES, type GearPreset, type Tank, type TankMaterial } from '../domain/types';
import { formatTankMaterial, HE_LABEL, O2_LABEL } from '../format/display';
import { unitLabel, type UnitSystem } from '../format/units';
import { backToSettings } from '../navigation/leaveScreen';
import { confirmDestructive } from '../platform/confirmDestructive';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenTopInset, type Styles } from '../theme/styles';

/**
 * Shown when the id names nothing live — deleted on another device, or a stale deep link.
 *
 * Said rather than swallowed, and above all the screen does not fall back to an empty editor:
 * `MISSING_DIVE_MESSAGE` (DiveFormScreen.tsx) records why that second option is the dangerous
 * one — a form that quietly created a NEW row because it could not find the one it was
 * editing would duplicate on the device that still has it, and again on every later attempt.
 */
const MISSING_PRESET_MESSAGE = "Couldn't find that preset — it may have been deleted.";

/* The other reason there is no preset on screen is `PRESETS_UNREADABLE` (domain/presets.ts),
 * and it is a different sentence on purpose: `useGearPresets`' `error` exists for exactly this
 * distinction, and it holds one screen deeper than Settings — telling a diver their preset may
 * have been deleted when the database simply could not be read sends them looking for
 * something that is still there. Shared with Settings, which says the same thing about the
 * same event; the delete failure below has no twin and stays here. */

/**
 * What this editor can refuse lives in `domain/presets.ts` (`presetRefusal`), not here.
 *
 * All three sentences are the dive form's too — the same three rules asked at the other end of
 * a preset's life — and two of them shipped as byte-identical copies across the two screens,
 * one of them a copied message *formatter*. §4.1's "one deliberate exception, until i18next"
 * covers duplicated **field labels**; a sentence stating a rule's verdict is not one. They sit
 * beside `presetNamed`, which the §4.1 owner table already names as owning what counts as the
 * same preset name — the question the duplicate refusal is decided by.
 *
 * What stays this screen's own decision is WHERE each is shown: see `nameNote` below.
 */

/** Shown when `softDeleteGearPreset`'s write rejects. Its own literal, unlike the save's
 * (`PRESET_SAVE_FAILED`, domain/presets.ts): no other screen deletes a preset, so there is
 * nothing here for a second copy to drift from. §10: "A local save failure is shown to the
 * diver" — the alternative is a diver believing the preset is gone and finding it under the
 * chips on their next dive. */
const DELETE_ERROR_MESSAGE = "Couldn't delete that preset. Try again.";

/** What the delete confirmation says — `DiveDetailScreen`'s own pair, one object over. Held
 * here rather than inline so a test can assert on the same strings the diver reads. The body
 * states the consequence in the diver's terms rather than in the schema's ("a tombstone is
 * written", §6, which is true and means nothing here). */
const DELETE_TITLE = 'Delete this preset?';
const DELETE_BODY = "It will be removed from your presets. This can't be undone.";

/**
 * A cylinder with every field unrecorded, for a preset that holds none — which
 * `createGearPreset` permits and M2's `pull_changes` can deliver.
 *
 * That such a preset can *arrive* and that a diver may not *author* one (`presetRefusal`,
 * domain/presets.ts) are different claims, and both are deliberate: everything that reads a
 * preset tolerates it — §3's list omits the summary rather than drawing a dash, the dive form's
 * apply blanks the block — and this function is that tolerance on this screen.
 *
 * Built from `TANK_FIELDS` (diveFormSchema.ts) rather than written out, §4.1's "derive, or
 * tie at compile time": a cylinder field added later appears here the day it exists, instead
 * of leaving this editor silently missing one.
 */
function blankTank(): TankFormInput {
  return Object.fromEntries(TANK_FIELDS.map((field) => [field, null])) as TankFormInput;
}

/**
 * Everything this screen holds that came from the preset, keyed by where it came from.
 *
 * `sourceId` and `units` are the reseed gate, and both halves are load-bearing.
 * `useGearPresets()` resolves asynchronously — the first render always sees an empty list —
 * so an editor seeded once on mount would sit blank over a real preset for ever; and
 * `useUnitSystem()` resolves asynchronously too, so an imperial diver's first render is
 * metric and the fields would keep the bar figures they were seeded with while their labels
 * changed to psi. That second one is the same trap `DiveFormScreen`'s own gate names, and it
 * is silent: nothing on screen says the number is wrong.
 *
 * Keyed on the **id**, not on the preset object: `useGearPresets` hands back a fresh array
 * of fresh objects whenever the query re-runs, and the query re-runs on any database change
 * — including this screen's own save. An identity comparison could therefore never settle,
 * which is the shape that once made the dive form throw "Too many re-renders." A string
 * compares by value and settles on the second render.
 *
 * The consequence worth stating: once seeded, the diver's draft wins over a later change to
 * the same preset from elsewhere. That is `DiveFormScreen`'s behaviour too, and it is the
 * right one — the alternative is a diver's half-typed edit being overwritten mid-keystroke.
 */
interface PresetDraft {
  sourceId: string | null;
  units: UnitSystem;
  name: string;
  /** The first cylinder, in the diver's own units — the one this editor shows. */
  tank: TankFormInput;
}

function draftFor(preset: GearPreset | null, units: UnitSystem): PresetDraft {
  const stored = preset?.tanks[0];
  return {
    sourceId: preset?.id ?? null,
    units,
    name: preset?.name ?? '',
    // `toDisplayTank` (diveFormSchema.ts), the same owner the dive form's seeding and its
    // preset chips both convert through. A preset holds SI (§6) and this screen holds the
    // figures the diver reads, so an imperial diver editing "twin 12 steel" must find 3365
    // under a `psi` label, not 232.
    tank: stored === undefined ? blankTank() : toDisplayTank(stored, units),
  };
}

export interface GearPresetScreenProps {
  /**
   * Which preset this screen edits — `src/app/preset/[id].tsx` reading the route.
   *
   * **Optional, and that is what leaves room for creating one later.** §10 puts creation in
   * the dive form on purpose ("where the cylinders are already typed — that is the work the
   * preset exists to remove"), so there is deliberately no *New preset* control here. If it
   * is ever wanted, the shape is already the one `DiveFormScreen` uses: a `src/app/preset/new.tsx`
   * beside `[id].tsx`, a `mode` prop this file switches its write on, and no route moves —
   * exactly the relationship `dive/new.tsx` has with `dive/[id]/edit.tsx`.
   */
  presetId?: string;
}

/**
 * The cylinder-preset editor (DESIGN.md §3, and §10's owner's call: "**A preset is captured
 * in the form and edited in Settings** ... §3's Settings list is then a real editor, name and
 * cylinders both, not a list of names with a delete button"). Route `/preset/[id]` via a thin
 * re-export in `src/app/preset/[id].tsx`; this file lives outside expo-router's swept
 * `src/app/` tree so its colocated test is not bundled into the app, the same shape every
 * other screen here has.
 *
 * **Its own route and its own screen rather than an expanding row in Settings** — §10 again:
 * "a preset is edited the way everything else in this app is edited: a list, a route, a form,
 * a save."
 *
 * **The read is `useGearPresets()` and nothing else**, exactly as `DiveDetailScreen` finds its
 * dive inside `useDives()`: the preset shown here is found by id in the list the Settings row
 * was tapped from, never fetched with a second, independent query. A second read path is a
 * second place this screen could disagree with the list that opened it — the class of mistake
 * §4.1 opens with. `getGearPreset` exists in the repository for callers that have no live
 * list; a screen already holding one is not one of them.
 *
 * **It is not react-hook-form, and that is deliberate.** What that library buys the dive form
 * is a thirty-field form with per-field validation, dirty tracking and a resolver; a preset is
 * a name and one cylinder, and the only coercion involved is the cylinder's, which
 * `toStoredTanks` already performs *through `diveFormSchema`'s own `tanks` field*. A second
 * Zod schema for the same seven fields is precisely the duplicated rule §4.1 exists to stop,
 * and it would be free to disagree with the form about what an empty box means (§10: "empty
 * numeric form fields must reach the domain as `null` or `NaN`, never `0`").
 *
 * **Six fields, not eight.** A preset stores no start or end pressure (§10 — "a preset that
 * filled in 200 bar would be inventing a reading"), so offering those two would ask the diver
 * for a value the repository strips on its way to the database.
 */
export default function GearPresetScreen({ presetId }: GearPresetScreenProps) {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  // The device's own top clearance, from the app's one owner of that rule (`screenTopInset`,
  // theme/styles.ts) — never a constant, which is inside the safe area on an island phone.
  const insets = useSafeAreaInsets();
  const units = useUnitSystem();
  const { presets, error } = useGearPresets();

  const preset = presetId === undefined ? null : (presets.find((p) => p.id === presetId) ?? null);

  // React's own documented "adjusting some state when a prop changes" pattern, not the
  // effect-plus-setState round trip it replaces (which this repo's lint config rejects
  // outright). See `PresetDraft` for what the gate is keyed on and why.
  const [draft, setDraft] = useState<PresetDraft>(() => draftFor(preset, units));
  if (draft.sourceId !== (preset?.id ?? null) || draft.units !== units) {
    setDraft(draftFor(preset, units));
  }

  // Each refusal sits under the row it is about (§0.6: "a field error is text, not a field.
  // Muted, trailing, under the row it belongs to"), which is why there are two slots rather
  // than one. The dive form's capture has one because it has one row; here the name and the
  // cylinders are two places on screen, so both can be answered at once and neither has to
  // wait for the other to be fixed first.
  const [nameNote, setNameNote] = useState<string | null>(null);
  const [cylinderNote, setCylinderNote] = useState<string | null>(null);
  // Non-null only while an attempt has failed and not yet been retried — cleared at the START
  // of the next attempt, never on a timer, so it reads as "still true" for exactly as long as
  // it still is.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // §10's in-flight guard, in the two halves that must not be confused: the ref is written
  // and read synchronously, so the second tap of a double-tap is turned away before it can
  // reach the repository; `busy` is only how that is SHOWN, a render flag that by definition
  // lags a render behind and could never have enforced anything. Without the ref a double-tap
  // writes twice and pops the navigation stack twice.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const editTank = (field: keyof Tank, value: unknown) => {
    setCylinderNote(null);
    // The same `Record` shape `toStoredTank` itself uses to write a field into a cylinder — a
    // `Tank`'s fields have four different types, so a keyed write needs it.
    setDraft((current) => ({
      ...current,
      tank: { ...(current.tank as Record<string, unknown>), [field]: value } as TankFormInput,
    }));
  };

  if (preset === null) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackControl styles={styles} />
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>
            {error === undefined ? MISSING_PRESET_MESSAGE : PRESETS_UNREADABLE}
          </Text>
        </View>
      </View>
    );
  }

  /**
   * The cylinders as they will actually be stored: this editor's own, converted back to SI,
   * with every cylinder it does not show carried through untouched.
   *
   * **`preset.tanks` is passed as the third argument, and that is §10's rule rather than an
   * optimisation.** A preset stored at 232 bar reads as 3365 psi; 3365 psi converts back to
   * 232.00858…, so without it an imperial diver who merely opened this screen and saved would
   * erode the figure — and `updateGearPreset`'s no-op check would see a change where there is
   * none, advancing `updated_at` on a write that changed nothing. Under §7's whole-row
   * last-write-wins that stamp is what another device compares against.
   *
   * **The cylinders past the first ride along.** This editor shows one, as the dive form does
   * (§6: "the form shows a single cylinder until '+ add cylinder' is tapped", and that control
   * is not built yet) — but a preset may hold several, and the form already applies every one
   * of them. Saving only what is on screen would silently delete a diver's deco gas, which is
   * most of what a multi-cylinder preset is for.
   *
   * **The pressures are not stripped here, and that is deliberate rather than an omission.**
   * A preset keeps no gauge reading (§10), and `withoutPressures` (domain/carryOver.ts) is that
   * rule — with exactly the two callers that need it: `presetRefusal`, which has to judge the
   * cylinders as they will BE (a cylinder holding nothing but a pressure looks completely full
   * on this form and stores nothing at all), and `updateGearPreset`, which stores them. A third
   * call here changed nothing observable, and it used to carry a docblock saying it did — which
   * is worse than no comment, since it reads as "do not remove me".
   */
  const storedTanks = (): Tank[] =>
    [
      ...toStoredTanks([draft.tank], units, preset.tanks),
      ...preset.tanks.slice(1),
    ];

  const save = async () => {
    if (busyRef.current) return;
    const tanks = storedTanks();

    // `presetRefusal` (domain/presets.ts) decides what is wrong; this decides where to say it.
    // Asked of the live list this screen is already holding, so the answer is the one the
    // diver is looking at, with no second read and no race against their own render, and with
    // `exceptId` set: renaming a preset to the name it already has is not a collision with
    // anything, and without that exception every save that did not change the name would be
    // refused — which is most of them.
    //
    // **Both answers at once**, unlike the dive form's capture, which has one `FieldNote` under
    // one row and so must pick. Here the name and the cylinders are two places on screen, so a
    // diver who broke both is not made to fix them one at a time.
    const refusal = presetRefusal(presets, draft.name, tanks, preset.id);
    setNameNote(refusal.name);
    setCylinderNote(refusal.cylinders);
    if (refusal.refused) return;

    busyRef.current = true;
    setBusy(true);
    setSaveError(null);
    setDeleteError(null);
    try {
      // The whole preset, not a diff. `updateGearPreset`'s own docblock states why a preset
      // has nothing for a diff to express — two fields, both NOT NULL, so neither can be
      // cleared, only replaced — and it is that function, not this screen, that decides a
      // write which changes nothing is not a write.
      await updateGearPreset(db, preset.id, { name: refusal.storedName, tanks });
      backToSettings();
    } catch {
      setSaveError(PRESET_SAVE_FAILED);
    } finally {
      // Released on both paths, so a failed save leaves a control the diver can press again
      // rather than one that silently stopped working.
      busyRef.current = false;
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDeleteError(null);
    try {
      // Soft, never hard (§6): the `deleted_at` tombstone is what M2's sync needs to carry the
      // deletion to the diver's other devices. Every read already filters on it, so the preset
      // leaves this list and the dive form's chip row at once.
      await softDeleteGearPreset(db, preset.id);
      backToSettings();
    } catch {
      setDeleteError(DELETE_ERROR_MESSAGE);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // A confirmation drawn by the platform, not by this app. §0.1 reserves colour for depth,
  // which leaves nothing here to make a destructive control look destructive — so the weight
  // goes into chrome the app does not draw, and this screen's own control stays a plain muted
  // label (§10). `platform/confirmDestructive.ts` owns WHICH chrome: the platform `Alert` on a
  // device, the browser's own dialog on web, where `Alert.alert` is an empty function and
  // *Delete dive* deleted nothing at all until that module existed.
  const confirmDelete = () => {
    confirmDestructive({
      title: DELETE_TITLE,
      body: DELETE_BODY,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm: () => void runDelete(),
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      <BackControl styles={styles} />
      <ScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
        {/* What this screen is, not what the preset is called: the name is an editable field
            two rows down, and a heading repeating it would go stale the moment it is typed
            over. "Edit preset" is `headingFor`'s own shape one screen over. */}
        <Text style={styles.presetHeading}>Edit preset</Text>

        <View>
          <FormField
            label="Preset name"
            value={draft.name}
            // Typing clears the note: it described the name that was in the box, and a
            // sentence about a name the diver has already changed is a stale complaint.
            onChange={(text) => {
              setNameNote(null);
              setDraft((current) => ({ ...current, name: text }));
            }}
            scheme={scheme}
            placeholder="twin 12 steel"
          />
          <FieldNote message={nameNote ?? undefined} scheme={scheme} />
        </View>

        {/* The same six fields the dive form's Gas & cylinders group offers, with the same
            labels, the same keyboards and the same units — §0.6's grammar rather than a third
            vocabulary, through the same two components. The labels are literals for the reason
            §4.1 records (twenty-five of them across the app, awaiting i18next); the two that
            already drifted once come from `O2_LABEL`/`HE_LABEL`. */}
        <OptionChips
          label="Material"
          value={draft.tank.material as TankMaterial | '' | null | undefined}
          options={TANK_MATERIAL_VALUES}
          displayLabel={(option) => formatTankMaterial(option) ?? option}
          // `OptionChips` reports `''` when the diver presses the chip that is already
          // selected — its way of clearing the field — and a cylinder material genuinely has
          // no value, so that lands on `null` rather than on an empty string the schema would
          // have to interpret.
          onChange={(value) => editTank('material', value === '' ? null : value)}
          scheme={scheme}
        />
        {/* §10's "keep and flag": a preset synced from a newer client can carry a material
            this build has no chip for, and the row alone would show it as simply nothing
            chosen. `unknownOptionNote` (diveFormSchema.ts) is the same owner the dive form's
            own option fields ask — the sentence is that file's rule to state. */}
        <FieldNote message={unknownOptionNote(TANK_MATERIAL_VALUES, draft.tank.material)} scheme={scheme} />
        <FormField
          label="Size"
          value={toInputString(draft.tank.sizeL)}
          onChange={(text) => editTank('sizeL', text)}
          scheme={scheme}
          keyboardType="decimal-pad"
          mono
          // Litres in both systems (§10): the imperial cylinder unit is the cubic foot, which
          // measures free gas at working pressure rather than water capacity, so it is a
          // different quantity and not a conversion. Lower-case `l`, matching `formatVolume`.
          unit="l"
        />
        <FormField
          label="Count"
          value={toInputString(draft.tank.count)}
          onChange={(text) => editTank('count', text)}
          scheme={scheme}
          // Whole cylinders, so a keypad with no separator key: `decimal-pad` offers a comma
          // on a Czech device, and `derived.ts` reads a fractional count as *contradictory*,
          // which voids the whole dive's gas figure rather than skipping the cylinder.
          keyboardType="number-pad"
          mono
        />
        <FormField
          label="Working pressure"
          value={toInputString(draft.tank.workingBar)}
          onChange={(text) => editTank('workingBar', text)}
          scheme={scheme}
          keyboardType="decimal-pad"
          mono
          unit={unitLabel('pressure', units)}
        />
        <FormField
          label={O2_LABEL}
          value={toInputString(draft.tank.o2Pct)}
          onChange={(text) => editTank('o2Pct', text)}
          scheme={scheme}
          keyboardType="decimal-pad"
          mono
          unit="%"
        />
        <FormField
          label={HE_LABEL}
          value={toInputString(draft.tank.hePct)}
          onChange={(text) => editTank('hePct', text)}
          scheme={scheme}
          keyboardType="decimal-pad"
          mono
          unit="%"
        />
        <FieldNote message={cylinderNote ?? undefined} scheme={scheme} />

        {/* Deleting, at the END of the content — the position *Delete dive* occupies on the
            dive detail, for the reason that screen records: a deliberate act on the one thing
            you are looking at should take a deliberate reach, which is also why it is not on a
            row of the list that opened this. */}
        {deleteError !== null && (
          <View style={styles.presetNotice}>
            <Text style={styles.presetNoticeText}>{deleteError}</Text>
          </View>
        )}
        <Pressable
          style={styles.presetDelete}
          onPress={confirmDelete}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Delete preset"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.presetDeleteLabel}>Delete preset</Text>
        </Pressable>
      </ScrollView>

      {/* A sibling of the footer rather than scroll content, so it is visible without
          scrolling exactly as the control that produced it is. */}
      {saveError !== null && (
        <View style={styles.presetNotice}>
          <Text style={styles.presetNoticeText}>{saveError}</Text>
        </View>
      )}

      {/* §0.5: the primary action sits in the bottom third — a fixed footer outside the
          scroll, the dive form's own arrangement. `insets.bottom` is the one value here that
          cannot live in a scheme-only stylesheet. */}
      <View style={[styles.formFooter, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable
          style={styles.action}
          onPress={() => void save()}
          // Disabled only while a write is in flight, never for validity: §1's "never block a
          // save" binds the control itself, and a refusal here is a sentence next to the row
          // it is about rather than a control that does nothing. Both `disabled` and
          // `accessibilityState` are set — a control that silently ignores a tap it still
          // announces as available is its own kind of dead button.
          disabled={busy}
          accessibilityRole="button"
          // Verb plus noun, naming what it writes — the shape `Save dive`, `Delete dive` and
          // `Complete dive` already use, and the same words the dive form's capture confirms
          // with, because it is the same act on the same object.
          accessibilityLabel="Save preset"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.actionLabel}>Save preset</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The way out (§0.6: "Leaving a screen has one treatment everywhere") — `formBack`, the
 * definition the dive form's own `‹ Cancel` and the dive detail's `‹ Dives` already share, so
 * this cannot invent a second treatment for the same kind of object. Pinned above the scroll
 * rather than scrolling with it, and rendered in the not-found state too: a screen that could
 * not find its preset is exactly the one a diver most needs to leave.
 *
 * It writes NOTHING. `backToSettings` (navigation/leaveScreen.ts) pops the stack, or replaces
 * to Settings for a cold deep link — never to the dives list, which is not the screen this
 * one sits on top of.
 */
function BackControl({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.formBack}
      onPress={backToSettings}
      accessibilityRole="button"
      // Says what leaving does, which is the half a diver cannot see from the chevron —
      // deliberately free of the word "Save", so it can never be mistaken, by a screen reader
      // or by a test query, for the control at the bottom of the screen.
      accessibilityLabel="Leave without saving"
    >
      <Text style={styles.formBackLabel}>‹ Cancel</Text>
    </Pressable>
  );
}
