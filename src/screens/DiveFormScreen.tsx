import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldPath,
  type UseFormSetValue,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useColorScheme,
  type ColorValue,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// M3m's discard guard. `useNavigation` is expo-router's own public re-export of the
// navigation object; `leaveScreen.ts` still owns where a save GOES, and this owns whether a
// departure happens at all — two different questions about the same act.
import { useFocusEffect, useNavigation } from 'expo-router';
// M3m: whether the keyboard is covering the bottom edge, which is what decides whether the
// save footer still has a home indicator to clear (`liftedBottomInset`).
import { useKeyboardShown } from '../hooks/useKeyboardShown';

import { DateTimeField } from '../components/DateTimeField';
import { FieldNote } from '../components/FieldNote';
import { CarriedMark, clearedAnnouncement, clearedTag } from '../components/CarriedMark';
import { ClearFieldControl } from '../components/ClearFieldControl';
import { DepthGlyph, drawnIcon } from '../components/ConditionIcon';
import { FocusChainProvider, useFocusChainStep } from '../components/FocusChain';
import { RevealingScrollView } from '../components/FormReveal';
import { FormField, type OfferedSuggestion } from '../components/FormField';
import { FormGroup } from '../components/FormGroup';
import { OptionChips } from '../components/OptionChips';
import { RatingDot, filledDotCount } from '../components/RatingDots';
import { useAuthSession } from '../cloud/useAuthSession';
import { getDiveSite } from '../db/catalogue';
import { db } from '../db/client';
import { createDive, updateDive } from '../db/dives';
import { createGearPreset } from '../db/gearPresets';
import { useDiveCenters } from '../db/useDiveCenters';
import { useDives } from '../db/useDives';
import { useDiveSites } from '../db/useDiveSites';
import { useGearPresets } from '../db/useGearPresets';
import { setOpenFormGroups } from '../db/settings';
import { useOpenFormGroups } from '../db/useOpenFormGroups';
import { useUnitSystem } from '../db/useUnitSystem';
import {
  CARRIED_FIELDS,
  TANK_PRESSURE_FIELDS,
  carryOverFrom,
} from '../domain/carryOver';
import { todayCalendarDate } from '../domain/datetime';
import { pointOf } from '../domain/mapSites';
import { type PlaceKind } from '../domain/placePicker';
import {
  TANK_FIELDS,
  diveFormSchema,
  siteFactsFrom,
  toDisplayTank,
  toDisplayUnits,
  toDivePatch,
  toNewDiveInput,
  toInputString,
  toStoredTanks,
  optionNote,
  toFormNumber,
  type DiveFormInput,
  type DiveFormValues,
  type TankFormInput,
} from '../domain/diveFormSchema';
import { presetMatching, presetRefusal, presetSaveFailed } from '../domain/presets';
import { salinityFor, siteDefaultFills, type InheritedValues, type SiteDefaults } from '../domain/siteDefaults';
import {
  asInlineSuggestedField,
  pairedIdField,
  suggestFrom,
  suggestionHistory,
  type SuggestedField,
} from '../domain/suggest';
import {
  CONDITION_SCALE_VALUES,
  CONFIGURATION_VALUES,
  ENTRY_VALUES,
  RATING_MAX,
  RATING_VALUES,
  EQUIPMENT_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  VISIBILITY_VALUES,
  WATER_BODY_VALUES,
  WEATHER_VALUES,
  WEIGHTS_FEEL_VALUES,
  type Dive,
  type DiveStatus,
  type Equipment,
  type GearPreset,
} from '../domain/types';
import { wordsOf } from '../domain/words';
import {
  formatConfiguration,
  formatCoordinates,
  formatCurrent,
  formatCylinderSpec,
  formatDiveStatus,
  formatEntry,
  formatEquipmentToken,
  formatSalinity,
  formatSuggestionMeta,
  formatSuggestionsTitle,
  formatSurge,
  formatSuit,
  formatTankMaterial,
  formatVisibility,
  formatWaterBody,
  formatWaves,
  formatWeather,
  formatWeightsFeel,
  HE_LABEL,
  O2_LABEL,
  unnamedCenter,
  unnamedSite,
} from '../format/display';
import { positionRefusalSentence } from '../format/positionRefusal';
import { unitLabel, type UnitSystem } from '../format/units';
import { t, useT, type TranslationKey } from '../i18n';
import { backToDives } from '../navigation/leaveScreen';
import { openPlacePicker, type DiveContext, type PlacePick } from '../navigation/placePick';
import { confirmDestructive } from '../platform/confirmDestructive';
import { currentPosition } from '../platform/location';
import { resolveScheme } from '../theme/resolve';
import { liftedBottomInset, makeStyles, screenTopInset, type Styles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

const EMPTY_TANK: TankFormInput = {
  material: null,
  configuration: null,
  sizeL: null,
  workingBar: null,
  o2Pct: null,
  hePct: null,
  startBar: null,
  endBar: null,
};

/**
 * The form's own baseline, independent of carry-over. `carryOverFrom(null)` (Task 3)
 * deliberately returns `{}` for a diver's very first dive — "so a first-ever entry does
 * not overwrite whatever default the form already holds for every field" (its own
 * docblock) — and this is that default: every field `null` except `date` (today; the one
 * field §2.2 requires) and `tanks` (one blank cylinder — "the form shows a single
 * cylinder until '+ add cylinder' is tapped," DESIGN.md §6). `initialFormValues` below
 * layers `carryOverFrom(mostRecentLoggedDive)` on top of this for a real diver's second
 * dive onward (Task 6).
 *
 * `date` comes from `todayCalendarDate`, the same owner `carryOverDate` calls, and not
 * from a local `new Date().toISOString().slice(0, 10)` — that is the UTC day, and it
 * opened a night dive logged at 00:30 in Prague on *yesterday's* date (DESIGN.md §10).
 *
 * **Exported for `DiveFormScreen.test.tsx` alone**, which sweeps `defaultOpenGroups` over every
 * field the schema declares and needs the baseline those values are a departure from. Building
 * a blank in the test instead would be a second statement of what an untouched form holds — and
 * the rule under test is precisely "is there anything in this group", so a baseline that
 * disagreed with the screen's would sweep a different form than the one that ships.
 *
 * `status` is `'logged'`, and this is the one place that decides so. **Always**, and never
 * inferred: not from the date (a dive dated next week is a perfectly ordinary backfill
 * mistake to make and an awful thing to silently reclassify), not remembered from the last
 * session, and not carried over from the previous dive — `carryOverFrom` deliberately
 * names neither `status` nor `date`, so this default survives the merge in
 * `initialFormValues` below. A diver who plans one dive on a boat does not want every
 * later entry defaulting to planned; §2.4 is the exception, not a mode.
 */
export function blankFormValues(): DiveFormInput {
  return {
    status: 'logged',
    date: todayCalendarDate(),
    siteId: null,
    siteName: null,
    centerId: null,
    centerName: null,
    maxDepthM: null,
    durationMin: null,
    timeIn: null,
    avgDepthM: null,
    waterTempC: null,
    airTempC: null,
    visibility: null,
    visibilityM: null,
    waves: null,
    current: null,
    surge: null,
    weather: null,
    entry: null,
    salinity: null,
    waterBody: null,
    latitude: null,
    longitude: null,
    tanks: [EMPTY_TANK],
    suit: null,
    suitThicknessMm: null,
    // `[]`, never `null`: `equipment` is the second of the two array fields §6 makes
    // non-nullable, and an empty set already means "no accessories recorded".
    equipment: [],
    weightsKg: null,
    weightsFeel: null,
    buddy: null,
    guide: null,
    title: null,
    notes: null,
    rating: null,
  };
}

/**
 * Every field this form has, read off `diveFormSchema` itself rather than typed out here a
 * second time — the same rule `carryOver.ts`'s `FRESH_FIELDS` follows, so a field added to
 * the schema is seeded into edit mode automatically instead of silently opening blank on a
 * dive that records it.
 */
const FORM_FIELDS = Object.keys(diveFormSchema.shape) as (keyof DiveFormValues)[];

/*
 * `diveToFormValues` below copies a dive's values across by name, which is sound only
 * because every field this form has is also a field a `Dive` has. That proof is
 * `FormFieldsExistOnDive` and it lives in `diveFormSchema.ts` now — the module that
 * declares both types, and whose own unit conversion rests on the identical fact. It used
 * to be declared here, guarding one of the two casts that stand on it.
 */

/**
 * A stored dive's own values, as this form's starting point in `mode="edit"` (Task 7).
 *
 * The counterpart of `initialFormValues` below, and deliberately NOT built on top of
 * carry-over: editing shows the dive's own data (`carryOverSource` returns `null` for edit
 * mode, once, so the rule lives in one place). Every field is copied straight across by
 * name — `FORM_FIELDS` above, never a hand-written list — because `DiveFormValues` and
 * `Dive` name the same fields the same way, which the assertion above pins.
 *
 * `tanks` gets `blankFormValues()`'s single blank cylinder when the dive recorded none, for
 * exactly the reason `initialFormValues` does: this screen binds `tanks.0.*` directly, and
 * a form bound to an array element that does not exist would go on SHOWING one cylinder
 * while HOLDING none. `toDivePatch` (diveFormSchema.ts) treats a blank cylinder and no
 * cylinder as the same claim in both directions, so that blank never turns into a write.
 */
function diveToFormValues(dive: Dive): DiveFormInput {
  const blank = blankFormValues();
  const values = { ...blank } as Record<string, unknown>;
  for (const field of FORM_FIELDS) {
    values[field] = (dive as unknown as Record<string, unknown>)[field];
  }
  const seeded = values as DiveFormInput;
  return seeded.tanks !== undefined && seeded.tanks.length > 0 ? seeded : { ...seeded, tanks: blank.tanks };
}

/**
 * The one dive this form carries values forward from, or `null` when there is none.
 *
 * `dives` is `useDives()`'s own list — "the one read every screen uses" (useDives.ts's own
 * docblock) — passed in rather than read here, so this stays a plain function; finding the
 * most recent LOGGED dive is nothing more than the first `status: 'logged'` entry in it,
 * because `useDives()` already hands back every live dive newest-first (db/dives.ts's
 * `toDives`) and a planned (future-dated) dive would otherwise sort ahead of a real logged
 * one in that same order. No second sort: reusing the one order `useDives()` already
 * establishes is the whole point (this screen's own "Consumes" line, and the brief's own
 * "do not add a second read path").
 *
 * `null` in `mode="edit"`, which shows a dive's OWN stored data (Task 7) and never
 * carry-over — so "edit mode carries nothing" is decided here, once, rather than re-checked
 * at every later site that would otherwise need to know it.
 */
function carryOverSource(mode: 'create' | 'edit', dives: Dive[]): Dive | null {
  if (mode !== 'create') return null;
  return dives.find((d) => d.status === 'logged') ?? null;
}

/**
 * A fresh entry's starting values (Task 6): `blankFormValues()` — see its own docblock —
 * merged with whatever `carryOverFrom` (domain/carryOver.ts) carries forward from `source`.
 * `carryOverFrom(null)` returns `{}`, so a `null` source (a first-ever dive, or edit mode)
 * leaves the blank baseline exactly as it is.
 *
 * `tanks` is re-asserted after the merge rather than taken from the spread. `[]` is a
 * legitimate value on the previous dive — "an empty array already means no cylinders
 * recorded" (DESIGN.md §6) — and `carryOverFrom` copies it faithfully, but carrying it
 * through here would drop the single blank cylinder `blankFormValues()` guarantees and leave
 * this screen's `tanks.0.*` fields bound to an array element that does not exist: the form
 * would go on SHOWING one cylinder (§6: it shows exactly one until "+ add cylinder" exists)
 * while HOLDING none, and two divers who both left the cylinder group untouched would write
 * different data purely because of what their previous dives happened to record. What the
 * previous dive recorded is a fact about that dive, not about this one.
 *
 * Callers must not treat this as a one-shot read: `useDives()` starts empty and resolves
 * asynchronously (`useLiveQuery`'s own initial state, well after this screen's first
 * render), so `source` — and therefore this function's result — can change after mount. See
 * the render body below for how that reaches the live form via `useForm`'s `values`
 * option rather than `defaultValues` alone.
 */
function initialFormValues(source: Dive | null): DiveFormInput {
  const blank = blankFormValues();
  const values = { ...blank, ...carryOverFrom(source) };
  return values.tanks !== undefined && values.tanks.length > 0 ? values : { ...values, tanks: blank.tanks };
}

/**
 * Whether a starting value counts as something DESIGN.md §0.6's return mark
 * should mark, as opposed to a field that merely was not touched. `0` and `false` are
 * real, meaningful carried values (a diver who dove with zero weight still had that as
 * their last dive's actual answer) and must count — only
 * `null`/`undefined`/a whitespace-only string mean "carry-over had nothing to say
 * here," the same "empty means absent, not a value" line `diveFormSchema.ts`'s own
 * `optionalNumber`/`optionalText` already draw for the opposite direction (a value
 * reaching the schema, not leaving it).
 *
 * An **empty array** is deliberately not on that list, and `equipment` is the field it
 * matters for: `[]` is a real recorded value meaning "no accessories" (§6), so a previous
 * dive that recorded none genuinely carried that answer forward. Nothing reads an
 * `equipment` carried mark today — the set has five Yes/No rows and no single row for a mark
 * and a clear to sit on (`CARRIED_WITHOUT_A_MARK`) — so this is stated
 * rather than special-cased.
 */
function hasCarriedValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/**
 * Every `FieldPath<DiveFormInput>` this form's starting values actually carried
 * something into, so `ControlledTextField` below can show DESIGN.md §0.6's chip
 * without either this screen or `FormField.tsx` guessing at WHY a field is carried.
 *
 * Built from `CARRIED_FIELDS` (Task 3, `domain/carryOver.ts`) alone, never a second
 * hand-typed field list — the exact defect that module's own docblock already warns
 * against for `FRESH_FIELDS`. `tanks` is the one entry that is an array rather than a
 * leaf value ("tanks is named here, but carries only *most* of itself," per
 * `CARRIED_FIELDS`'s own docblock); its own keys are read off whatever tank object is
 * actually there rather than a hand-typed second copy of `tankFormSchema`'s shape, so
 * a cylinder field added later is covered automatically. Every other `CARRIED_FIELDS`
 * entry without a `ControlledTextField` anywhere on this screen (`siteId`/`centerId`,
 * which have no input of their own yet; `entry`/`salinity`/`waterBody`/`suit`/tank
 * `material` and `configuration`, which render as `OptionChips`; `equipment`, which renders
 * as a row of toggling chips) still gets a correct entry in the returned set — simply one nothing
 * currently reads — rather than being silently skipped here and needing this function
 * revisited the day one of those fields grows a chip of its own.
 */
function computeCarriedPaths(values: DiveFormInput): Set<string> {
  const paths = new Set<string>();
  for (const field of CARRIED_FIELDS) {
    if (field === 'tanks') {
      values.tanks?.forEach((tank, index) => {
        for (const key of Object.keys(tank)) {
          if (hasCarriedValue((tank as Record<string, unknown>)[key])) {
            paths.add(`tanks.${index}.${key}`);
          }
        }
      });
    } else if (hasCarriedValue(values[field])) {
      paths.add(field);
    }
  }
  return paths;
}

/**
 * Everything this screen derives from the one dive it was seeded by — the dive carry-over
 * came from in create mode, the dive being edited in edit mode — kept together so the three
 * pieces can never disagree about which dive they describe.
 */
interface SeedState {
  /**
   * The seed dive's own id, or `null` when there is none (a first-ever dive; an edit whose
   * dive has not arrived from `useDives()` yet) — the one **stable scalar** the render
   * body's re-derivation gate compares. Deliberately the id and not the dive, nor the
   * values derived from it: `useDives()` rebuilds every object it hands back on every
   * render, so any object here would compare unequal forever and the gate would never
   * close. See the render body for what that cost.
   */
  sourceId: string | null;
  /**
   * The unit system these `values` are expressed in — the second scalar the render body's
   * gate compares, alongside `sourceId`.
   *
   * It has to be compared, because `useUnitSystem()` resolves asynchronously exactly as
   * `useDives()` does: the first render of this screen always sees the metric default, and
   * an imperial diver's real preference arrives a moment later. Without this the form would
   * seed a dive's metre figures under `ft` labels and never correct itself — the mislabelled
   * form this whole task exists to prevent, arrived at through a race rather than a missing
   * conversion. A string, so it compares by value and the gate closes on the next render.
   */
  units: UnitSystem;
  /** This form's starting values, in the diver's own units (`toDisplayUnits`), held rather
   * than recomputed so `useForm`'s `values` option has a reference that changes only when
   * the seed dive or the unit system really does. */
  values: DiveFormInput;
  /** DESIGN.md §0.6's carried-mark paths for `values`, minus whatever the diver has since
   * typed over or cleared (`noteTouched`, render body). Always empty in edit mode — see
   * below. */
  paths: ReadonlySet<string>;
  /**
   * Every field whose carried value the diver **threw away** — with the clear control, or with
   * *No centre* over a carried centre — which is the third state §0.6 asks this form to show:
   * `— cleared`, where a field carry-over never filled shows nothing at all.
   *
   * **It is not the complement of `paths`, and that is the whole point.** A field can be
   * unmarked for three different reasons — nothing was carried into it, the diver typed over
   * what was, or the diver threw what was away — and until M1h the first and the third were
   * the same empty row. The app knew which was which and never said, so a diver who
   * deliberately discarded a carried buddy could not tell that from the form simply not having
   * one.
   *
   * **It survives a reseed, exactly as `typed` below does and for the same reason**: the seed
   * decides the values and the marks, and a gesture the diver made is not the seed's to
   * re-decide. It has one extra reason of its own, which is that `resetOptions.keepDirtyValues`
   * keeps the emptied VALUE across that reseed — so without this the row would keep the blank
   * and lose the sentence explaining it, which is precisely the state this set exists to end.
   *
   * Every gesture that puts a value into a field takes the field back out of here (typing, a
   * picked suggestion or place, an applied preset, a chosen chip), because the tag is a claim about
   * what the row holds and a claim about a row holding a value is false. `FormField` and
   * `OptionChips` refuse to draw the tag over a non-empty value regardless — see either's own
   * render body — so the two halves of that guarantee sit on both sides of the boundary.
   */
  cleared: ReadonlySet<string>;
  /**
   * Every field the diver has typed into or cleared on this form, ever — and the one part of
   * this state that **survives a reseed**.
   *
   * **It does not protect what the diver typed, and must not be read as though it did.**
   * `resetOptions.keepDirtyValues` (below) is what does that; this set feeds one thing only —
   * `paths`, and therefore §0.6's return marks. A screen elsewhere once cited it as the
   * sibling of a value-protecting flag, which is exactly the misreading this paragraph exists
   * to prevent.
   *
   * **Three screens hold a draft over an asynchronous read and protect it three different
   * ways** (§4.1's "a deliberate near-duplicate names its siblings"), because each has a
   * different thing available to compare: here, the form library already tracks which fields
   * the diver moved, so `keepDirtyValues` needs no flag; `PresetDraft` (GearPresetScreen.tsx)
   * has a stable source identity to compare and so needs no flag either; `countTyped`
   * (SettingsScreen.tsx) has neither a form library nor an identity — the stored count IS the
   * value — so it has to remember the gesture explicitly. Unifying them would be its own bug.
   *
   * The chip means "this came from your last dive" and must mean nothing else. `useDives()`
   * resolves after the first render, so a diver who taps `+` and starts typing immediately is
   * typing into a form whose carry-over has not landed yet; when it does, `keepDirtyValues`
   * correctly keeps what they typed — and `computeCarriedPaths` was then run over the
   * carry-over values and marked that field `carried` anyway, offering an `×` that would
   * clear a value the diver had entered themselves. Filtering the recomputed set by this one
   * is what stops that: a field the diver has touched can never be re-marked, whatever
   * arrives afterwards.
   *
   * Kept here rather than read from react-hook-form's `dirtyFields` because `dropCarried`
   * already runs on exactly these two gestures for exactly these fields, and one path is
   * cheaper to keep honest than two. It is also strictly the more conservative signal:
   * `dirtyFields` compares against the CURRENT defaults, so a value re-synced from carry-over
   * can stop being dirty, where having been typed is a fact that does not expire.
   */
  typed: ReadonlySet<string>;
  /**
   * **Every field the dive's paired SITE is currently answering for, rather than carry-over**
   * — §2.1's site defaults (`domain/siteDefaults.ts`), and the third thing that **survives a
   * reseed**.
   *
   * It exists for one job: a row the site filled must not wear §0.6's return mark, and
   * `paths` is re-derived from the carry-over values on every reseed. Without this set the
   * mark would come back the moment `useDives()` or `useUnitSystem()` resolved — a value the
   * catalogue supplied, wearing a mark that says it came from the diver's last dive, under a
   * caption naming a dive it has never been near. Subtracted from the marks in `seedStateFor`
   * exactly as `typed` is, and for the same reason: the seed decides the values and the marks,
   * and neither the diver nor the site is the seed's to re-decide.
   *
   * **It is not a member of `typed` and must never become one**, which is the distinction the
   * whole rule turns on. `typed` is permanent — having been typed is a fact that does not
   * expire — and this is *revisable*: switching sites recomputes it wholesale, and unpairing
   * empties it. A site fill recorded as "typed" would make the second site pick refuse to
   * overwrite the first site's answer, which is §2.1's rule failing at exactly the moment it
   * is named for. The two can never overlap either: a pick that answers for a typed field
   * releases it (`SiteDefaultAnswer.released`, #53) and the form takes it out of `typed` in the
   * same update, and `noteTouched` takes a field back out of here the moment the diver touches it.
   *
   * In edit mode it fills only when the diver moves the dive to another site (#53): opening a
   * stored dive asks the catalogue nothing — see `applySiteDefaults`.
   */
  fromSite: ReadonlySet<string>;
  /**
   * **The name each standing pair was made with** — DESIGN.md §6's `site_name` beside the
   * `site_id` the diver's own gesture set — and the fourth thing that **survives a reseed**.
   *
   * This one protects a VALUE, which none of the three above does, and it is the only thing
   * here that has to: `resetOptions.keepDirtyValues` protects everything else the diver moved,
   * and it cannot protect this. It keeps a field react-hook-form has RECORDED as dirty, and a
   * write whose value equals the current seed's records nothing at all (`setPairedId`, for the
   * mechanism read out of 7.87). So the one write that can never be recorded is the one that
   * spells a name the seed already holds — a pick, on the *Choose a site* page, of the catalogue
   * row whose name carry-over already put in the row with no id beside it.
   *
   * The id half of the pair IS recorded (`setPairedId` flags it), so without this the reseed
   * kept the id and re-synced the name, and the dive was saved holding one site's id under
   * another site's name — §10's own autocomplete defect, arriving through a race instead of
   * through a keystroke. §6's snapshot is a pair or it is nothing, so the two halves have to
   * cross a reseed together or not at all.
   *
   * **Substituted into the seed rather than written over the form**, which is what makes it a
   * member of this state and not an effect: `seedStateFor` puts the pinned name into the
   * values react-hook-form resets to, so the field is simply seeded with it and no repair has
   * to race the reset that caused the problem. §0.6's mark needs nothing from it: the pick that
   * set the pin dropped the mark and recorded the field in `typed`, which no reseed re-marks.
   *
   * **Revisable, like `fromSite` and unlike `typed`**: every gesture that unsets an id (the
   * clear ring, *No centre*, picking again) rewrites this in the same breath, so it can only
   * ever hold the name of a pair the form is actually holding. `buddy` and `guide` never
   * appear — they have no id column to pair with (`pairedIdField`).
   */
  pairedNames: ReadonlyMap<SuggestedField, string>;
  /**
   * **What the dive inherited for the three rows a site speaks for** — the previous dive's values
   * in create mode, the stored dive's in edit mode — exactly as the source said them, before the
   * water body's rule (#53) wrote anything. `siteDefaultFills` and `salinityFor` read this as
   * their `inherited`, never `values`: a salinity the rule filled in would otherwise come back as
   * one the last dive carried, and earn a carried mark it has no right to.
   */
  inherited: InheritedValues;
  /**
   * The rows whose value the **water body** supplied (#53): only ever `salinity`, drawn with
   * *from the water body* at the row's end rather than a carried mark. Revisable like `fromSite`:
   * every gesture that decides the salinity again rewrites it, and a diver's own tap removes it.
   */
  fromWaterBody: ReadonlySet<string>;
  /**
   * **The salinity a gesture last wrote** — a water-body tap or a site pick (#53) — or `undefined`
   * when none did, or the diver has since chosen one by hand. Pinned into the seed on a reseed,
   * the way `pairedNames` pins a site's name: `keepDirtyValues` keeps only a value react-hook-form
   * RECORDED as changed, and a gesture's salinity that equals the seed's never is, so without
   * this a newer dive landing (or the unit preference arriving) swapped it for the new seed's.
   */
  salinityPin: string | null | undefined;
}

/**
 * **§6's snapshot names, put back into the seed the form is about to be reset to** — the
 * `SeedState.pairedNames` half of a reseed, and the only place a seed is overruled by
 * something the diver did rather than by something the seed said.
 *
 * Values only, and §0.6's mark has nothing to ask of it: every pin is set by a pick, and the
 * pick has already dropped the mark and recorded the field in `typed`, which no reseed re-marks.
 *
 * `values` is returned unchanged when nothing is pinned, so the ordinary reseed allocates
 * nothing and `useForm`'s `values` reference is exactly what `seedStateFor` built.
 */
function pinPairedNames(values: DiveFormInput, pairedNames: ReadonlyMap<SuggestedField, string>): DiveFormInput {
  if (pairedNames.size === 0) return values;
  // The same keyed-write `Record` `applyPreset` uses, and for the same reason: these fields are
  // named by a value rather than written literally, and `DiveFormInput` has no index signature
  // to write them through.
  const pinned = { ...values } as Record<string, unknown>;
  for (const [field, name] of pairedNames) pinned[field] = name;
  return pinned as DiveFormInput;
}

/**
 * **An ocean dive is saved salt** (#53), whatever the hidden Salinity row holds — the one place a
 * gesture could not reach it: a salinity chosen by hand before carry-over landed an ocean
 * underneath it (the final review's third finding). New dives only: a stored dive is saved as the
 * diver left it, so one stored before the rule with *fresh* keeps it until its water is changed.
 */
function oceanIsSalt(values: DiveFormValues): DiveFormValues {
  return typeof values.waterBody === 'string' && values.waterBody.trim() === 'ocean' ? { ...values, salinity: 'salt' } : values;
}

/** The three rows a site speaks for, as a form holds them — what `inherited` keeps. */
function placeColumns(values: DiveFormInput): InheritedValues {
  return { entry: values.entry, salinity: values.salinity, waterBody: values.waterBody };
}

/**
 * This form's starting values, and DESIGN.md §0.6's carried-mark paths for them.
 *
 * The mark means "this came from your LAST DIVE", so edit mode marks nothing at all: it
 * shows the dive's OWN stored data (`diveToFormValues`), and a field holding what it has
 * always held is not carried from anywhere. Create mode marks whatever carry-over actually
 * filled in, and a `null` source — a diver's first-ever dive — marks nothing either.
 *
 * `mode` is read here rather than only through `carryOverSource`, because the two modes now
 * seed from different dives entirely (the previous dive versus this one); the ONE thing
 * that is not re-decided here is which dive create mode carries from, which stays
 * `carryOverSource`'s alone.
 *
 * `openAs` is §2.4's *Complete dive* arriving through the route (`editDiveLink.ts`): the
 * state the Logged/Planned control should OPEN on, overriding the dive's own stored status
 * for the control alone. It writes nothing and means nothing on its own — the diver still
 * sees the flipped control and still has to save — which is precisely why it is a starting
 * value here rather than a rule inside `onValid` about where the diver came from.
 *
 * `typed`, `cleared` and `fromSite` are carried in and back out untouched, and two of the three
 * are subtracted from the marks on the way: see `SeedState.typed` for the race that closes,
 * `SeedState.cleared` for why the third state has to outlive a reseed too, and
 * `SeedState.fromSite` for the row the catalogue is answering for. A reseed re-derives
 * everything the SEED decides and nothing the DIVER or the SITE decided. `fromWaterBody` is
 * carried in too, and is the one the seed itself adds to (#53): while no gesture has decided the
 * water body or the salinity, the seed re-derives the salinity from its own water body.
 *
 * `pairedNames` and `salinityPin` are the two that change a VALUE rather than a mark — the
 * salinity a gesture wrote, pinned the same way (#53). For `pairedNames` it is the same
 * sentence said about §6's snapshot pair: the name a diver's own gesture paired to an id
 * is not the seed's to re-decide either. `pinPairedNames` below owns what it does; see
 * `SeedState.pairedNames` for why it cannot be a `shouldDirty` flag like everything else the
 * diver moves.
 */
function seedStateFor(
  mode: 'create' | 'edit',
  seed: Dive | null,
  units: UnitSystem,
  openAs?: DiveStatus,
  typed: ReadonlySet<string> = new Set<string>(),
  cleared: ReadonlySet<string> = new Set<string>(),
  fromSite: ReadonlySet<string> = new Set<string>(),
  pairedNames: ReadonlyMap<SuggestedField, string> = new Map<SuggestedField, string>(),
  fromWaterBody: ReadonlySet<string> = new Set<string>(),
  salinityPin: string | null | undefined = undefined,
): SeedState {
  const sourceId = seed?.id ?? null;
  // Every seed goes through `toDisplayUnits` (diveFormSchema.ts) on its way in, and only
  // here: from this point down the form holds the figures the diver reads and types, and
  // SI reappears on the far side in `toNewDiveInput`/`toDivePatch`. Wrapped around
  // `openAs` rather than applied at the two call sites below, so neither branch can
  // forget it — a create-mode form seeded in metres under `ft` labels and an edit-mode one
  // are the same bug.
  const seedValues = (values: DiveFormInput): DiveFormInput =>
    toDisplayUnits(openAs === undefined ? values : { ...values, status: openAs }, units);
  if (mode === 'edit') {
    return {
      sourceId,
      units,
      // A `null` seed in edit mode means the id names no live dive at all, and the blank form
      // is what shows for it; `onValid` below refuses to write anything without a real dive,
      // so a form that opened blank can never save its blanks over a dive it never loaded.
      //
      // It used to mean one more thing — "the dive has not arrived yet" — and those two were
      // indistinguishable here, so the blank form was also what a diver saw over their own
      // real dive for the renders before `useDives()` answered. That case no longer reaches
      // this branch: the screen holds a frame instead until `resolved` (M1f, see the render
      // body), so a blank form is now only ever the answer to a dive that is genuinely gone.
      // Pinned here too, and it is not a formality: edit mode reseeds whenever the dive object
      // or the unit preference changes underneath it, so a diver who corrects a site name on a
      // stored dive and pairs it to a catalogue row can have that pair split by the same race
      // create mode can.
      values: pinPairedNames(seedValues(seed === null ? blankFormValues() : diveToFormValues(seed)), pairedNames),
      paths: new Set<string>(),
      // **Both diver-side sets pass straight through here, and `cleared` is empty in edit mode
      // by consequence rather than by decree.** It could only gain a member by emptying a carried
      // value — the ring on a marked row, or *No centre* over a carried centre — and `paths`
      // above is empty, so there is nothing to blank and blanking it would be a second statement
      // of a rule the line above already makes. (It was written as an explicit `new Set()` first;
      // deleting that line changed no test, which is what an unreachable branch looks like, and
      // §10's remedy for one is to remove it rather than to defend it.)
      cleared,
      typed,
      fromSite,
      pairedNames,
      inherited: placeColumns(seed === null ? blankFormValues() : diveToFormValues(seed)),
      fromWaterBody,
      salinityPin,
    };
  }
  const seeded = seedValues(initialFormValues(seed));
  const marked = seed === null ? new Set<string>() : computeCarriedPaths(seeded);
  for (const field of typed) marked.delete(field);
  // The site's three columns outrank carry-over's (§2.1), so a row the site is answering for
  // is not a row that came from the diver's last dive — whatever the seed values still say
  // about it. Second, and after `typed`, because the two can never name the same field.
  for (const field of fromSite) marked.delete(field);
  // §6's pair outranks carry-over's name for the same reason. Its row is already unmarked: the
  // pick that pinned it is in `typed`.
  let values = pinPairedNames(seeded, pairedNames);
  // **The water body sets the salinity** (#53): a last dive that named a lake and no salinity
  // seeds fresh, *from the water body*, and one in the ocean seeds salt behind a hidden row, even
  // over a fresh stored before the rule existed.
  //
  // **Re-derived on every seed while no gesture has decided either row** — so the unit preference
  // arriving late, or a newer dive landing, answers from the seed it brings rather than keeping
  // the last one's answer. Once a gesture has decided one (a water body tapped, a site that
  // answered, a salinity chosen), the salinity that gesture wrote is pinned into the seed instead
  // (`salinityPin`), and its caption survives through `fromWaterBody`. Trusting `keepDirtyValues`
  // for either was the final review's first finding: it keeps only what react-hook-form RECORDED
  // as changed, and the rule's value often equals the seed's.
  const waterAnswered = new Set(fromWaterBody);
  const decided = ['salinity', 'waterBody'].some((field) => typed.has(field) || fromSite.has(field));
  if (!decided) {
    const answer = salinityFor({ waterBody: seeded.waterBody, typed: undefined, site: null, inherited: placeColumns(seeded) });
    waterAnswered.delete('salinity');
    if (answer.source === 'waterBody') {
      values = { ...values, salinity: answer.value };
      marked.delete('salinity');
      waterAnswered.add('salinity');
    }
  } else {
    if (salinityPin !== undefined) values = { ...values, salinity: salinityPin };
    if (waterAnswered.has('salinity')) marked.delete('salinity');
  }
  return {
    sourceId,
    units,
    values,
    paths: marked,
    cleared,
    typed,
    fromSite,
    pairedNames,
    inherited: placeColumns(seeded),
    fromWaterBody: waterAnswered,
    salinityPin,
  };
}

/**
 * The chips each fixed-choice field offers, taken straight from `domain/types.ts`'s own
 * `*_VALUES` arrays — the same arrays `Entry`, `Salinity`, `WaterBody`, `Suit` and
 * `TankMaterial` are derived from, and the same ones `diveFormSchema.ts` builds its
 * `optionalPicked` fields out of.
 *
 * This screen used to hold a second copy of all five (`ENTRY_OPTIONS = ['shore', 'boat',
 * 'other']`, and so on), typed as `readonly Entry[]` — which type-checks a list that is
 * MISSING a member perfectly happily. Adding one to the domain therefore produced a chip
 * the diver never saw, and no build error to say so. There is one list now.
 */

/**
 * **Where every field on this form lives, as data — and the checklist a new field joins.**
 *
 * §2.2 divides the form into an always-visible core strip and seven collapsible groups, and
 * until M1h that division existed only as the shape of the JSX below. That was enough while
 * nothing had to ASK the question; §2.2's "a group opens when this dive already has a value in
 * it" is a rule about which fields belong to which group, and a rule needs something to read.
 *
 * **The JSX is still written out by hand and this does not generate it**, deliberately: every
 * row has its own props — a unit, a keyboard, an icon, an autocomplete source — and a generic
 * renderer driven by this table would trade a visible list of thirty fields for a table plus a
 * dispatcher, without removing the per-field decisions. What this buys instead is a question
 * that can be asked and an invariant that can be checked: `DiveFormScreen.test.tsx` asserts
 * that these three lists together name **every** field `diveFormSchema` declares, exactly once,
 * so a field added to the schema and rendered into a group cannot be silently absent from the
 * rule that opens that group. That assertion is the checklist; the last row of the table is
 * where a new field goes.
 *
 * `tanks` is named by its leaves (`tanks.0.*`), because that is how this form binds them: the
 * array is one value and the form gives each of its fields a row, in one group.
 *
 * **The order of this list is §2.2's table, and the screen renders in it.** The JSX below is
 * hand-written, so nothing about a `const` array *makes* it agree — what ties the two together
 * is a test reading the headers off the screen (`draws its groups in the order the layout
 * declares`), and a second one comparing that order against §2.2 written out by hand rather
 * than read back off this line. Both are needed: the first would stay green if this list and
 * the JSX were reordered together into an order §2.2 does not name.
 */
export const FORM_GROUP_IDS = ['times', 'gas', 'conditions', 'water', 'equipment', 'people', 'notes'] as const;

export type FormGroupId = (typeof FORM_GROUP_IDS)[number];

export interface FormGroupSpec {
  /**
   * What the header reads, as a KEY rather than as a word (M3h). Here rather than at the call
   * site so the persisted id and the visible word cannot drift — and a key rather than a
   * string because this `Record` is built when the module is first imported, which is before
   * the diver's language is known and for ever afterwards: a title resolved here would say
   * "Conditions" over a Czech form until the app was killed. `groupProps` resolves it per
   * render, and `useT()` on this screen is what makes that render happen.
   */
  titleKey: TranslationKey;
  /** Every field rendered inside this group. What §2.2's "already has a value in it" is asked
   * of, and nothing else — the group's contents are still the JSX below. */
  fields: readonly FieldPath<DiveFormInput>[];
  /**
   * Whether this group starts open for a diver who has never decided about it (§2.2, M1i:
   * "the groups that a diver fills on most dives open by default").
   *
   * **A starting state, not a special case** — which is the whole reason it is a field on the
   * layout rather than a branch anywhere. It is the LAST thing `defaultOpenGroups` consults:
   * the diver's own memory outranks it in both directions, so a group they collapsed stays
   * collapsed and one they opened stays open, and this answers only the case where the memory
   * says nothing at all.
   *
   * **Required rather than optional**, on §4.1's "derive, or tie at compile time": an eighth
   * group has to state its answer instead of inheriting a default nobody chose for it, and the
   * two groups that carry `true` are then visible as two deliberate calls rather than as the
   * absence of a flag.
   */
  startsOpen: boolean;
}

/**
 * A `Record` keyed by `FormGroupId` rather than an array, so TypeScript requires an entry for
 * every id and an eighth group cannot be added to the list above without one — the same
 * "derive, or tie at compile time" shape `CYLINDERS_PER_CONFIGURATION` (domain/types.ts) uses.
 *
 * **The ids are what gets persisted** (`db/settings.ts`'s `form_groups_open`), which is why
 * they are short opaque words and not the titles: a group renamed for a diver, or translated,
 * must not lose the memory of having been opened.
 */
export const FORM_GROUPS: Record<FormGroupId, FormGroupSpec> = {
  // §2.2's four measurements, and the group M1i gave them back. The strip held max depth,
  // duration and time in until this milestone; they are here with the average depth they belong
  // beside, and the group opens by default because these are what a diver fills on most dives.
  times: { titleKey: 'group.timesDepth', fields: ['maxDepthM', 'avgDepthM', 'durationMin', 'timeIn'], startsOpen: true },
  gas: {
    titleKey: 'group.gas',
    // Open by default for the same reason *Times & depth* is, and holding the two pressures
    // M1i moved back out of the strip: they are read off the cylinder they belong to, which is
    // the thing this group is about.
    //
    // **Second, above *Conditions*** (M1i, the owner's call after using the form): §2.2 records
    // why the pressures could not go back into the core strip — a *Start pressure* row there
    // describes `tanks.0` and says nothing about a second cylinder — so the group moved instead
    // of the fields, and the pressures are two rows further down the screen rather than behind
    // a tap.
    startsOpen: true,
    fields: [
      'tanks.0.material',
      'tanks.0.sizeL',
      'tanks.0.configuration',
      'tanks.0.workingBar',
      'tanks.0.o2Pct',
      'tanks.0.hePct',
      'tanks.0.startBar',
      'tanks.0.endBar',
    ],
  },
  conditions: {
    titleKey: 'group.conditions',
    startsOpen: false,
    // **Weather leads** (M1i): it is the first thing anyone notices about a dive day. What is
    // left here is what the day was like and nothing else — *entry*, *salinity*, *water body*
    // and, since M2l, the GPS pin all sit in `water` below, because where you are is a
    // different question from what the day was like.
    fields: ['weather', 'waterTempC', 'airTempC', 'visibility', 'visibilityM', 'waves', 'current', 'surge'],
  },
  // **Where you are, which *Conditions* was answering by accident** (M1i, the owner's call).
  // §2.1 gives all three away by prefilling them from the site's own defaults: they are
  // properties of the place, they carry over, and they are touched about once a trip — so they
  // sit below the group a diver actually fills, rather than above six rows of it.
  //
  // **A group id the stored memory has never heard of, and that needs no special case.** M1i
  // gave `readOpenFormGroups` a third state, and an absent id already means *never decided* —
  // so an M1i-era row saying `{"times": false, "conditions": true}` leaves this group to
  // `startsOpen` below, which is what a new group should get.
  //
  // **The GPS pin is here because a pin is a property of the place** (M2l, §2.2: this group
  // holds "where you are", which is exactly what a coordinate says). It is two fields on one
  // row — §6 stores the pair as two nullable columns because SQLite has no point type, and a
  // half-recorded point is not a place a diver could read — so both are named here: §2.2's
  // "a group opens when this dive already has a value in it" has to open *Water & entry* for a
  // dive that has nothing in it but a pin.
  water: {
    titleKey: 'group.waterEntry',
    fields: ['entry', 'waterBody', 'salinity', 'latitude', 'longitude'],
    startsOpen: false,
  },
  equipment: {
    titleKey: 'group.equipment',
    startsOpen: false,
    fields: ['suit', 'suitThicknessMm', 'equipment', 'weightsKg', 'weightsFeel'],
  },
  people: { titleKey: 'group.people', fields: ['buddy', 'guide'], startsOpen: false },
  notes: { titleKey: 'group.notesRating', fields: ['title', 'notes', 'rating'], startsOpen: false },
};

/**
 * §2.2's core strip, as M1i shrank it — always visible, so no rule ever has to ask whether one
 * of these is worth opening something for. Listed here only so the invariant above can be
 * checked; the strip's own order is the JSX's.
 *
 * **What identifies a dive, rather than what measures it.** The strip guessed twice before this
 * (§2.2 records both): five fields, which hid *time in* and the two pressures behind a collapse,
 * and then eight, which fixed the hiding by flattening structure that was doing work. Three is
 * the answer that needed the group memory to exist first — nothing is hidden, because the groups
 * that hold the measurements start open, and a diver can now collapse the ones they never fill.
 */
export const CORE_STRIP_FIELDS: readonly FieldPath<DiveFormInput>[] = ['date', 'siteName', 'centerName'];

/**
 * **Every field on the form, top to bottom** — the core strip, then each group's fields in the
 * order `FORM_GROUP_IDS` renders the groups (2026-11-14). It is what the return key walks
 * (components/FocusChain.tsx): read off the two lists that already state the order rather than
 * written out a third time, so the walk cannot disagree with the screen. It names pickers and
 * chip rows too; only text fields on screen ever register, so those are stepped over.
 */
export const FORM_FIELD_ORDER: readonly FieldPath<DiveFormInput>[] = [
  ...CORE_STRIP_FIELDS,
  ...FORM_GROUP_IDS.flatMap((id) => FORM_GROUPS[id].fields),
];

/**
 * The fields this form holds but does not put in a row of its own, named so that "every field
 * is somewhere" stays a checkable claim rather than one with a silent exception.
 *
 * `status` is §2.4's Logged/Planned control, which sits beside the heading and is emphatically
 * not a slot in the core strip — that strip identifies the dive, and a status is not one of the
 * things that says which dive this is. `siteId` and `centerId` are §6's half of the site
 * snapshot, written by the pick the *Site* and *Centre* rows hand back (`setPairedId`) and
 * shown as the name on those rows, so there is nothing for a diver to open.
 *
 * **`latitude` and `longitude` were here for two milestones and are not any more** (M2l).
 * M1i took their two decimal keypads off this form because nobody has ever typed a coordinate
 * into a phone on a boat, and recorded the consequence rather than leaving it to be
 * discovered: no dive could carry a GPS point until something else wrote one. That something
 * is now the *GPS* row in *Water & entry* (`ControlledPositionField`) — §2.3's *"pressed right
 * on the boat"*, which is the affordance the plan had always named. **What M1i actually ruled
 * out was a keypad, not a row**, so the pair leaves this list by gaining a control that takes
 * the value rather than asking for it, and `DiveFormScreen.test.tsx` still holds that half:
 * there is no text input anywhere on this form that a coordinate can be typed into.
 */
export const OFF_FORM_FIELDS: readonly FieldPath<DiveFormInput>[] = ['status', 'siteId', 'centerId'];

/**
 * Whether a field holds something a diver would expect to find behind a closed group.
 *
 * **A deliberate near-duplicate of `hasCarriedValue` above, and they differ on exactly one
 * input** (§4.1 asks for the note): an empty array. That function answers "did carry-over say
 * something here", where `[]` is a real recorded answer — a previous dive that genuinely
 * recorded no accessories carried that forward. This one answers "is there anything in this
 * group for the diver to see", and an empty accessory set shows five chips reading *No*, which
 * is what an untouched form shows too. Opening the Equipment group for it would open that group
 * on every dive ever logged, which is the same as not having the rule.
 *
 * `0` and `false` count, for the reason `hasCarriedValue` gives: a diver who dove with zero
 * weight recorded that.
 */
function holdsValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * One field's value out of the form's own values, by the dotted path `FORM_GROUPS` names it
 * with — the only reader of `tanks.0.*` as a path rather than as a `Controller` name.
 *
 * Deliberately tiny and deliberately not a dependency: the paths it walks are the ones declared
 * above, so it has to handle a numeric array index and nothing else. It returns `undefined` for
 * a path that leads nowhere, which `holdsValue` above reads as "nothing here" — the honest
 * answer for a cylinder that does not exist.
 */
function valueAtPath(values: DiveFormInput, path: string): unknown {
  let current: unknown = values;
  for (const step of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

/**
 * Which of §2.2's groups should be open, before the diver touches anything: **"a group opens
 * when the diver opened it last time, or when this dive already has a value in it"** — and,
 * where they have said neither, when the group starts open (`FormGroupSpec.startsOpen`, M1i).
 *
 * The value half is not a nicety and §2.2 says why: carry-over fills groups nobody touched, so a
 * group holding a carried value the diver cannot see is a hidden field one layer down. It is
 * computed from the form's values and never persisted — it is a fact about THIS dive.
 *
 * The remembered half arrives from `db/settings.ts` through `useOpenFormGroups`, asynchronously,
 * and now carries three states rather than two: open, collapsed, and *nothing said*. Only the
 * third defers to `startsOpen`, which is what makes "open by default" a starting state rather
 * than a rule competing with the diver's own gesture.
 *
 * **Where the two halves meet, open still wins, and that is deliberately unchanged.** A group
 * the diver collapsed opens again if this dive has a value in it — §2.2's second half is about
 * not hiding a value nobody has seen, and M1i did not relitigate it. The consequence is worth
 * knowing rather than discovering: cylinders carry over (§2.1), so on every dive after the first
 * *Gas & cylinders* holds a value and a collapse of that group will not survive to the next
 * dive. *Times & depth* is unaffected — all four of its fields are fresh every dive — which is
 * the case §10's own example is about. If that trade is ever revisited, this line is the whole
 * of it, and the alternative that costs nothing (a collapsed group saying on its header that it
 * holds carried values) is a design job rather than an inversion.
 *
 * **An empty logbook opens every group** (§2.2, M1i), and it is an addition to the *starting
 * state* rather than a change to any of the above. With no dives at all nothing carries and
 * nothing has been remembered, so the two rules that answer for an ordinary dive would leave a
 * first-time diver looking at five closed groups on the one occasion nobody knows what they
 * hold. It sits inside the same `remembered[id] === undefined` guard `startsOpen` does, which is
 * what keeps the precedence untouched: a diver who collapses a group on their very first dive
 * has decided something, and reopening it would be exactly the defect M1i's third state exists
 * to close. The condition decays on its own — it can never be true again once one dive is saved.
 *
 * `logbookEmpty` is asked of the caller rather than inferred from `values`, and the difference is
 * the point: **"the logbook is empty" is not "this form holds nothing".** A new dive on a
 * populated logbook whose previous dive recorded nothing at all holds nothing either, and it must
 * follow the ordinary rule; so must an edit of the only dive there is. The screen answers it from
 * `useDives()`, which it already reads for carry-over — see the call site for why it is gated on
 * that read having resolved. Required rather than optional for `startsOpen`'s own reason: a
 * caller has to state which world it is in instead of inheriting a default nobody chose.
 *
 * **An id in `remembered` that names no group is kept in the returned set and simply matches
 * nothing.** It is a newer build's group (§10's "kept, not refused" — see `readOpenFormGroups`),
 * and the form writes it back untouched rather than deleting a memory it does not understand.
 *
 * A pure function, so the rule can be swept over every field in the schema without a renderer;
 * the screen's own test then proves each `FormGroup` is actually wired to its own entry, which
 * is the half a pure test cannot see.
 */
export function defaultOpenGroups(
  values: DiveFormInput,
  remembered: Readonly<Record<string, boolean>>,
  logbookEmpty: boolean,
): Set<string> {
  const open = new Set<string>(Object.keys(remembered).filter((id) => remembered[id] === true));
  for (const id of FORM_GROUP_IDS) {
    if (remembered[id] === undefined && (logbookEmpty || FORM_GROUPS[id].startsOpen)) open.add(id);
    if (FORM_GROUPS[id].fields.some((field) => holdsValue(valueAtPath(values, field)))) open.add(id);
  }
  return open;
}

type FormControl = Control<DiveFormInput, unknown, DiveFormValues>;

/**
 * **DESIGN.md §0.6's carried treatment, as one prop rather than four.**
 *
 * Every field that can show the treatment needs all four pieces — which paths are marked,
 * which were cleared, and the two gestures that move a field between those states — and a row
 * given three of them is broken in a way nothing on screen shows: a field that marks but never
 * unmarks keeps offering to clear a value the diver typed, and one that clears but does not
 * record it loses the `— cleared` tag on the next reseed. Four separate optional props are
 * four chances to pass three; one is not.
 *
 * That is not hypothetical here. `suitThicknessMm` shipped in M1h with `carriedPaths` and
 * without `onDropCarried`, so its mark could be shown and never dropped, and the suite was
 * green — the same "per-call-site prop hole" the screen's own tests now name.
 *
 * **Handed to every `ControlledTextField`, `ControlledOptionField` and `ControlledPlaceField`,
 * not only the carried ones.** Which fields carry is `CARRIED_FIELDS`' answer
 * (domain/carryOver.ts, §2.1) and `computeCarriedPaths` is what asks it; a row is marked exactly
 * when its own `name` is in `paths`, so a fresh field passed this renders precisely what it
 * rendered before the prop existed. Opting in per call site would be a second, hand-written copy of §2.1's split — the
 * "hand-maintained second list" `carryOver.ts`'s own docblock warns against, one call site
 * over from the file that draws the line — and it is the copy that goes stale the day a field
 * moves from fresh to carried.
 *
 * `onDrop`/`onClear` take the field's own `name` and are given it internally (below), rather
 * than each call site repeating its field name a second time as a plain string beside the
 * `name` prop it already has.
 */
interface CarryOverControls {
  /** Every path carry-over filled that the diver has not since touched — `SeedState.paths`. */
  paths: ReadonlySet<string>;
  /** Every path whose carried value the diver threw away — `SeedState.cleared`. */
  cleared: ReadonlySet<string>;
  /** The diver put a value here (typed, picked, applied, chose), or emptied one of their own. */
  onDrop: (name: FieldPath<DiveFormInput>) => void;
  /** The diver threw a carried value away: the clear control on a carried row, or the picker's
   * *No centre* over a carried centre. */
  onClear: (name: FieldPath<DiveFormInput>) => void;
}

/**
 * **The catalogue row a dive is paired to, or `null` for every way of not having one** — the
 * read behind §2.1's site defaults (`applySiteDefaults`).
 *
 * `getDiveSite` (db/catalogue.ts) owns the read and applies `pickable`, so a row that is
 * tombstoned, merged away or hidden answers `null` exactly as one that has never been pulled
 * does. That is the right collapse rather than a loss of detail: all four mean *the catalogue
 * has nothing to tell this dive*, and §6's `site_name` snapshot is why the dive goes on reading
 * correctly regardless.
 *
 * **The catch is §1 arriving through a by-product**: the dive is the thing being logged, a
 * prefill is a convenience, and a database that could not answer must produce the answer a
 * diver at sea gets anyway rather than an error with nowhere to be shown. Nothing here reaches
 * the save path.
 */
async function pairedSite(id: string): Promise<SiteDefaults | null> {
  try {
    return await getDiveSite(db, id);
  } catch {
    return null;
  }
}

interface ControlledTextFieldProps {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  scheme: ColorScheme;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
  placeholder?: string;
  /**
   * **The keyboard's opinion about a word, switched off for the fields that hold names** (M3n).
   *
   * Forwarded straight to `FormField`, and set explicitly at the two call sites that need it
   * rather than inferred from `history` — that prop says a field autocompletes, which is a
   * different question, and `FormFieldProps.autoCapitalize` already records why these look
   * joined and are not.
   */
  autoCapitalize?: 'none' | 'sentences' | 'words';
  autoCorrect?: boolean;
  spellCheck?: boolean;
  /** §0.6's "figures in mono, names in sans" — set explicitly per field, never inferred.
   * See `FormFieldProps.mono` for why `keyboardType` is not the same question. */
  mono?: boolean;
  /** The figure's unit, drawn as a muted suffix and as the empty field's placeholder (§0.6).
   * See `FormFieldProps.unit` for why it is not `placeholder`. */
  unit?: string;
  /** DESIGN.md §0.6's carried treatment, as one prop — see `CarryOverControls`, and pass it
   * at every call site rather than only the carried ones. */
  carryOver?: CarryOverControls;
  /**
   * The dives DESIGN.md §2.3's autocomplete draws on — `useDives()`'s own list, minus the
   * dive being edited (see the render body). Passed at `buddy` and `guide` and omitted
   * everywhere else: §2.3's other two fields, site and centre, are `ControlledPlaceField`s and
   * are chosen on a page of their own (issue #19).
   *
   * **Which column it draws from is decided by `name` alone**, through
   * `asInlineSuggestedField` (domain/suggest.ts), never by a second prop spelling the field's
   * name out again beside the `name` this row already has — the same reasoning
   * `CarryOverControls` above records for its two callbacks. So a call site cannot ask for an
   * inline list on a field §2.3 does not name, or on one chosen on its own page, and cannot
   * wire a row to the wrong column.
   *
   * **A pick fills the text and nothing else.** Buddies and guides *"stay private text, not
   * user accounts"* (§2.3), so a suggestion's id is always `null` here and there is no pair for
   * this row to keep — §6's pair belongs to the two place rows.
   */
  history?: Dive[];
  /** Forwarded to `FormField.leading`: a figure glyph before the label (issue #6). */
  leading?: ReactNode;
}

/**
 * A free-text or numeric field, wired straight to `FormField` — `optionalNumber` and
 * `optionalText` (diveFormSchema.ts) both accept a bare string, so nothing here has to
 * pre-parse what the diver types.
 *
 * `fieldState.error` is read from the `Controller`'s own state rather than from
 * `formState.errors` at the call site, so a field that grows a blocking rule later is
 * covered without this screen keeping a second list of which fields can fail. Note this
 * does NOT change whether the schema accepts or rejects anything; it only makes an existing
 * rejection visible.
 */
function ControlledTextField({
  control,
  name,
  label,
  scheme,
  keyboardType,
  multiline,
  placeholder,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  mono,
  unit,
  carryOver,
  history,
  leading,
}: ControlledTextFieldProps) {
  // Which of §2.3's inline-suggested fields this row is, if it is one at all — read off the
  // `name` this row already carries. See `history` above for why it is not a prop.
  const suggested = asInlineSuggestedField(name);

  // This row's place in the form's return-key walk (2026-11-14; components/FocusChain.tsx).
  // Every text field is a place the walk can land; notes takes no step of its own, because its
  // return key writes a new line.
  const step = useFocusChainStep(name, multiline !== true);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const text = toInputString(field.value);
        // §2.3's own history, ranked by `suggestFrom` — this row decides nothing about what
        // a suggestion is or what order they come in, only that this field's current text is
        // the query. Computed per render rather than memoised: it is a sort over the diver's
        // own logbook (a few thousand dives at most, DESIGN.md §4.1's own figure), and a
        // `Controller`'s render prop is a plain function call, so a hook here would be
        // illegal rather than merely unnecessary.
        //
        // Each one is drawn with what the diver has done under it (2026-11-14, the design
        // canvas's row): `suggestionHistory` counts the same dives the list is drawn from, the
        // way the logbook counts, and `display.ts` owns the words. Only for the few rows the
        // list actually shows, so it is a pass per row over the same few thousand dives. No
        // trailing figure: the canvas draws one for a site alone, and a site is chosen on its
        // own page.
        const suggestions: OfferedSuggestion[] | undefined =
          suggested !== null && history !== undefined
            ? suggestFrom(history, suggested, text).map((suggestion) => ({
                ...suggestion,
                meta: formatSuggestionMeta(suggestionHistory(history, suggested, suggestion.value), suggested),
              }))
            : undefined;
        return (
          <>
            <FormField
              ref={field.ref}
              label={label}
              leading={leading}
              value={text}
              // Typing drops the mark immediately (§0.6: "overwriting is just typing, and
              // drops the chip") — dropping first, then forwarding, so a field currently
              // showing `carried` never renders even one frame of the new text beside a mark
              // that no longer describes it.
              onChange={(newText) => {
                carryOver?.onDrop(name);
                field.onChange(newText);
              }}
              onBlur={field.onBlur}
              scheme={scheme}
              keyboardType={keyboardType}
              multiline={multiline}
              placeholder={placeholder}
              autoCapitalize={autoCapitalize}
              autoCorrect={autoCorrect}
              spellCheck={spellCheck}
              mono={mono}
              unit={unit}
              carried={carryOver?.paths.has(name)}
              cleared={carryOver?.cleared.has(name)}
              // The ring: same forward, but through `onClear` rather than `onDrop` — the two
              // gestures are told apart here and nowhere else, and §0.6's third state is what
              // hangs on the difference (`SeedState.cleared`). The value is FormField's own
              // `''` — never this field's current (possibly numeric-looking) value — so a
              // cleared cylinder size reaches `field.onChange` (and from there
              // `diveFormSchema.ts`'s coercion contract) as the same empty string
              // `optionalNumber` turns into `null`, not a derived `0`.
              onClear={(emptied) => {
                carryOver?.onClear(name);
                field.onChange(emptied);
              }}
              suggestions={suggestions}
              suggestionsTitle={
                suggested !== null && suggestions !== undefined && suggestions.length > 0
                  ? formatSuggestionsTitle(suggested, suggestions.length)
                  : undefined
              }
              returnKeyType={step?.returnKeyType}
              onSubmitEditing={step?.onSubmitEditing}
              // Picking is overwriting by another gesture, so it drops the mark exactly as
              // typing does.
              onPickSuggestion={
                suggested === null
                  ? undefined
                  : (suggestion) => {
                      carryOver?.onDrop(name);
                      field.onChange(suggestion.value);
                    }
              }
            />
            <FieldNote message={fieldState.error?.message} scheme={scheme} />
          </>
        );
      }}
    />
  );
}

/** What an empty place row reads — §0.6's call to action for a value that is *taken* rather than
 * typed, in the words of the page it opens. */
function choosePlaceLabel(kind: PlaceKind): string {
  return t(kind === 'site' ? 'form.chooseSite' : 'form.chooseCentre');
}

/** The two columns of a catalogue row its caption is made of — a site or a centre alike. */
type CaptionedPlace = { id: string; country: string | null; dirty: boolean };

/**
 * The muted line under a paired name: where its catalogue row lives. **On this phone only** for a
 * guest's row, which nothing pushes until they sign in (§5; issue #19, where a guest creates rows
 * too); otherwise the row's country as the stored ISO code, the way `formatCenterRow` shows one;
 * and nothing for a row this device does not hold or that knows no country.
 *
 * A signed-in diver's unpushed row reads its country like any other: it is on its way to the
 * community, and a pending push is §7.5's indicator's to show rather than this row's.
 */
function placeCaption(place: CaptionedPlace | undefined, signedIn: boolean): string | null {
  if (place === undefined) return null;
  if (place.dirty && !signedIn) return t('form.onThisPhoneOnly');
  return place.country !== null && place.country !== '' ? place.country : null;
}

interface ControlledPlaceFieldProps {
  control: FormControl;
  name: 'siteName' | 'centerName';
  label: string;
  scheme: ColorScheme;
  /** §0.6's carried treatment — see `CarryOverControls`. */
  carryOver: CarryOverControls;
  /**
   * Sets, or clears, the id paired with this row's name — DESIGN.md §6's `site_id` + `site_name`
   * pair, and §10's rule that the two move together: *"otherwise a dive carries one site's id
   * under another's name."* The screen's `setPairedId`, which also runs §2.1's site defaults.
   *
   * **`name` is the whole pair, not a convenience.** A pick hands over the spelling it is leaving
   * in the row beside the id it is setting, so the screen holds §6's two halves as one fact
   * rather than reading the name back out of the form before the `Controller` has delivered it.
   * `SeedState.pairedNames` is what it feeds.
   */
  onPairedId: (field: SuggestedField, id: string | null, name: string) => void;
  /** What the picker needs to know about this dive, read at the press — the pin, water and entry
   * a new site inherits, and the paired site a centre is ranked near. */
  diveContext: () => DiveContext;
  /** Whether anyone is signed in, for the caption's *on this phone only*. */
  signedIn: boolean;
  /** The screen's one claim on the picker, shared by both rows — `true` from a press until the
   * form is focused again. See the screen's `pickerOpenRef`. */
  pickerOpenRef: RefObject<boolean>;
}

/**
 * **The Site and Centre rows** (issue #19): a row that opens *Choose a site* / *Choose a centre*
 * rather than a box to type into. Every name on a dive is a picked or created catalogue row, so
 * there is no way to leave a typed name in the field — #19's fifth defect, closed by having no
 * keyboard here at all.
 *
 * `DateTimeField`'s and the GPS row's anatomy: the label leading, the value trailing in the name's
 * own face (Archivo Medium 16, wrapping and never truncated), a hairline on the top edge, and the
 * `label: value` announcement every read-back row on this form makes. Empty, the value is the
 * call to action, muted. Paired, the caption sits under the name.
 *
 * **The whole row is the press** (§0.6: "the whole row is the field") — label and value alike,
 * as `FormField`'s card is. The card takes a press nothing inside it takes and is no control of
 * its own to a screen reader (`accessible={false}`); the value slot is the one button, carrying
 * the announcement; the ring inside the card is its own control, so a press on it empties the
 * row rather than opening the picker.
 *
 * **The ring stands at the trailing edge whenever the row holds a place** — carried or picked —
 * because a place that can only be replaced, never emptied, would make a mistaken pick
 * permanent. Beside a carried value it wears the return mark, exactly as on a carried text row.
 * Either way it empties name and id together, and it leaves `— cleared` only where the value was
 * carried: §0.6's rule that emptying your own value is an edit, not a carry-over thrown away.
 * *No centre* — the empty pick — empties by the same rule.
 *
 * **A pick goes through the one path that sets §6's pair** (`onPairedId`, the screen's
 * `setPairedId`, which applies §2.1's site defaults). The picker is a page pushed over this form,
 * which stays mounted underneath; the pick comes back through `navigation/placePick.ts`, which is
 * why this row hands it a callback.
 *
 * **One press, one picker** — for the two rows together, through the screen's `pickerOpenRef`:
 * a second tap, on this row or the other, before the page has covered the form would push a
 * second picker over the first.
 *
 * Each row reads its own catalogue table for the caption and never the other's — hence one small
 * component per table in front of `PlaceField`, rather than both hooks in every row.
 */
function ControlledPlaceField(props: ControlledPlaceFieldProps) {
  return props.name === 'siteName' ? <SitePlaceField {...props} /> : <CentrePlaceField {...props} />;
}

function SitePlaceField(props: ControlledPlaceFieldProps) {
  const { sites } = useDiveSites();
  return <PlaceField {...props} kind="site" places={sites} />;
}

function CentrePlaceField(props: ControlledPlaceFieldProps) {
  const { centers } = useDiveCenters();
  return <PlaceField {...props} kind="center" places={centers} />;
}

function PlaceField({
  control,
  name,
  label,
  scheme,
  carryOver,
  onPairedId,
  diveContext,
  signedIn,
  pickerOpenRef,
  kind,
  places,
}: ControlledPlaceFieldProps & { kind: PlaceKind; places: readonly CaptionedPlace[] }) {
  const styles = makeStyles(scheme);
  // The id half of the pair, watched rather than read once: a pick, the ring and carry-over's
  // reseed all move it, and the caption has to follow. `toInputString` is the one owner of
  // reading a raw form value as text.
  const heldId = toInputString(useWatch({ control, name: kind === 'site' ? 'siteId' : 'centerId' })).trim();
  const id = heldId === '' ? null : heldId;
  // Nothing for a name without an id — a carried value from old data names no row.
  const caption = id === null ? null : placeCaption(places.find((row) => row.id === id), signedIn);
  // §0.6's carried state as it stands when a gesture LANDS, not as it stood when the row was last
  // drawn: *No centre* arrives from a page that can stay open across a reseed, and a value that
  // carry-over has since taken away is no longer a carried value to leave `— cleared` for.
  const carryOverRef = useRef(carryOver);
  useEffect(() => {
    carryOverRef.current = carryOver;
  });

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const text = toInputString(field.value);
        // A catalogue row with no name is still a place (§6 lets the column be null), so a pair
        // with no spelling reads as the picker's *Selected* line reads it, never as an empty row.
        const unnamed = kind === 'site' ? unnamedSite : unnamedCenter;
        const placeName = text.trim() !== '' ? text : id !== null ? unnamed() : null;
        // `FormField`'s own guard: the tag is a claim about what the row holds, so it is drawn
        // only over a row that holds nothing.
        const cleared = carryOver.cleared.has(name) && placeName === null;
        const shown = placeName ?? (cleared ? clearedAnnouncement() : choosePlaceLabel(kind));

        const carried = carryOver.paths.has(name);
        // The ring's gesture, and *No centre*'s: name and id together. Throwing a carried value
        // away leaves `— cleared` (`onClear`); emptying one the diver put there is an edit, so it
        // takes the typing path and leaves the call to action (`onDrop`). Decided from the latest
        // carried state (`carryOverRef`), not from this render's.
        const empty = () => {
          const latest = carryOverRef.current;
          if (latest.paths.has(name)) latest.onClear(name);
          else latest.onDrop(name);
          onPairedId(name, null, '');
          field.onChange('');
        };
        const pick = (place: PlacePick) => {
          if (place.id === null) {
            empty();
            return;
          }
          carryOverRef.current.onDrop(name);
          onPairedId(name, place.id, place.name);
          field.onChange(place.name);
        };
        const open = () => {
          if (pickerOpenRef.current) return;
          pickerOpenRef.current = true;
          openPlacePicker({
            kind,
            // What the row holds, so the picker can mark it — as it reads, not tidied.
            selected: placeName === null ? null : { id, name: text },
            dive: diveContext(),
            onPick: pick,
          });
        };

        return (
          <View style={styles.formField}>
            <Pressable style={[styles.formFieldRow, styles.formFieldCard]} onPress={open} accessible={false}>
              <Text style={styles.formFieldLabel}>{label}</Text>
              <Pressable
                style={styles.formFieldPlace}
                onPress={open}
                accessibilityRole="button"
                accessibilityLabel={t('field.labelValue', { label, value: shown })}
                // The label hides what is drawn inside the press, so the caption is said here —
                // a screen reader hears where the row lives as a sighted diver reads it.
                accessibilityHint={caption ?? undefined}
              >
                {placeName !== null ? (
                  <Text style={styles.formFieldPlaceName}>{placeName}</Text>
                ) : cleared ? (
                  <Text style={styles.formFieldCleared}>{clearedTag()}</Text>
                ) : (
                  <Text style={styles.formFieldPlaceNameUnset}>{shown}</Text>
                )}
                {caption !== null && <Text style={styles.formFieldPlaceCaption}>{caption}</Text>}
              </Pressable>
              {carried ? (
                <View style={styles.formFieldCarryState}>
                  <CarriedMark scheme={scheme} />
                  <ClearFieldControl
                    accessibilityLabel={t('field.clearCarried', { label })}
                    onPress={empty}
                    scheme={scheme}
                  />
                </View>
              ) : (
                placeName !== null && (
                  <ClearFieldControl accessibilityLabel={t('field.clear', { label })} onPress={empty} scheme={scheme} />
                )
              )}
            </Pressable>
          </View>
        );
      }}
    />
  );
}

/** What a picker field reads as while it holds nothing. Deliberately neutral — §1's "only
 * the fields you use", no form-shaming — and deliberately not blank: an empty box would read
 * as a control that failed to load rather than as a field with nothing in it. */
function notRecorded(): string {
  return t('form.notSet');
}

interface ControlledDateTimeFieldProps {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  mode: 'date' | 'time';
  scheme: ColorScheme;
  /**
   * Whether the diver may leave this field unrecorded — which is what puts the `×` on it.
   *
   * `false` for `date`, the form's one required field (§2.2), which therefore gets no way
   * to empty itself. `true` for `timeIn`, which stays `optionalText` in the schema — a diver
   * who did not note an entry time saves without one, exactly as before.
   *
   * Note this gates the CLEAR affordance only, not the placeholder: both fields are given
   * one, because "what this control says when it holds nothing" is a question even a
   * required field has to answer if it is ever somehow empty, and an empty box would read as
   * a control that failed to load.
   */
  optional?: boolean;
  /** `mode="time"` only: the date the form currently holds, which is the day this time
   * belongs to — see `DateTimeField`'s own `day` prop for the hour a spring-forward date
   * cost when the picker was seeded on today instead. */
  day?: string | null;
}

/**
 * A field whose value comes from the platform's date/time picker (`DateTimeField`) instead
 * of the keyboard — DESIGN.md §10, M1d: "Date and time are pickers, so an invalid value
 * cannot be entered."
 *
 * **The form value stays the string.** `DiveFormValues` is untouched: `date` is still the
 * `YYYY-MM-DD` string and `timeIn` still `HH:MM`/null, and the `Date` a picker deals in
 * never reaches this screen — `DateTimeField` converts it through `domain/datetime.ts`,
 * the single owner of both forms. A second representation on the form side is exactly the
 * drift §10 exists to prevent.
 */
function ControlledDateTimeField({ control, name, label, mode, scheme, optional, day }: ControlledDateTimeFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <>
          <DateTimeField
            label={label}
            value={toInputString(field.value)}
            onChange={field.onChange}
            mode={mode}
            scheme={scheme}
            day={day}
            placeholder={notRecorded()}
            // Same split `FormField` draws between typing and clearing, and the same `''`
            // — `DateTimeField` passes the literal empty string, never a value derived from
            // what the field holds, so `optionalText` turns a cleared time into `null`
            // rather than storing a real time the diver just removed. Left `undefined` for a
            // required field, which then shows no `×` at all.
            onClear={optional === true ? field.onChange : undefined}
          />
          <FieldNote message={fieldState.error?.message} scheme={scheme} />
        </>
      )}
    />
  );
}

interface ControlledOptionFieldProps<T extends string | number> {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  options: readonly T[];
  displayLabel: (option: T) => string;
  scheme: ColorScheme;
  /** Forwarded untouched to `OptionChips` — see that component's own prop for why an icon is
   * a render prop. Since issue #6 it is `drawnIcon(field)` at the tile rows and absent elsewhere. */
  icon?: (option: T, tintColor: ColorValue, ground: ColorValue) => ReactNode;
  /** Forwarded to `OptionChips`: `'tiles'` for the fields whose values have drawings (§0.6). */
  layout?: 'chips' | 'tiles';
  columns?: 3 | 4;
  /** Forwarded to `OptionChips`: a muted word at the row's end about where the value came from —
   * *from the water body* on Salinity (#53). */
  caption?: string;
  /** Told after the field takes a new value — a chip, a deselect or the clear ring — with the value
   * it held before. The water body's call site hands it the salinity rule (#53). */
  onPicked?: (previous: unknown, chosen: T | '') => void;
  /** The same `CarryOverControls` a text field takes, at every call site for the same reason.
   * Six of this form's twelve chip rows are in §2.1's carried half (`entry`, `salinity`,
   * `waterBody`, `suit`, and the cylinder's `material` and `configuration`) and the other six
   * are fresh; which is which is `paths`' answer, not a call site's. */
  carryOver?: CarryOverControls;
}

/**
 * A fixed-choice field, plus whatever its current value has to say for itself.
 *
 * Nothing a diver can do on this screen produces a value outside `options`: `OptionChips`
 * only ever hands back a member of it or `''`. A value from anywhere else can, though, and
 * edit mode is full of values from somewhere else — M2 sync will deliver rows this form
 * never touched, from a client whose `Entry` has a member this one has never heard of, and
 * carry-over prefills a new dive from one of them.
 *
 * That value used to be REFUSED, which made `handleSubmit` decline to call `onValid` for the
 * WHOLE form: the diver tapped Save on a dive they came to fix a note on, and nothing
 * happened. Wave A gave the refusal a message; §10 has since settled the policy behind it —
 * "a value outside the expected range is saved and can be flagged; it is not refused", and
 * §1 binds this form as hard as it binds the database. So the value is now kept, saved, and
 * flagged: `optionNote` (diveFormSchema.ts) supplies the sentence, `FieldNote` shows it, and
 * tapping any chip replaces it.
 *
 * **`T` covers numbers as well as strings since M1h**, when §0.6's icon sheet turned the
 * three 0–3 condition scales into chip rows. They are the same control with the same rule and
 * they go through this same wrapper — a second one for numeric scales is §4.1's defect, not a
 * convenience — and the one thing that genuinely differs, which sentence flags a value no chip
 * matches, is decided by `optionNote` from the vocabulary itself rather than by a prop each
 * call site would get its own chance to set wrong.
 *
 * `fieldState.error` is still read first, and is not dead: a field that grows a blocking
 * rule later is covered without this screen keeping a second list of which fields can fail.
 */
function ControlledOptionField<T extends string | number>({ control, name, label, options, displayLabel, scheme, icon, layout, columns, caption, onPicked, carryOver }: ControlledOptionFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <>
          <OptionChips
            label={label}
            value={field.value as unknown as T | '' | null | undefined}
            options={options}
            displayLabel={displayLabel}
            // Choosing a chip is this row's version of typing, so it drops the mark for the
            // reason §0.6 gives for the keyboard: "overwriting is just typing, and drops the
            // chip". **Including the press that deselects** — `OptionChips` reports `''` for
            // that, and it is still the diver choosing rather than discarding, so it takes the
            // `onDrop` path and leaves no `— cleared` behind. Only the ring says "this value
            // was not mine".
            onChange={(chosen) => {
              const previous: unknown = field.value;
              carryOver?.onDrop(name);
              field.onChange(chosen);
              onPicked?.(previous, chosen);
            }}
            scheme={scheme}
            icon={icon}
            layout={layout}
            columns={columns}
            carried={carryOver?.paths.has(name)}
            cleared={carryOver?.cleared.has(name)}
            // No value to forward: a chip group's cleared state is the absence of a selection,
            // and `''` is what `optionalPicked` reads as "nothing picked" — the same value the
            // deselect press already reports, which is why the two gestures have to be told
            // apart here rather than by what they write.
            onClear={() => {
              const previous: unknown = field.value;
              carryOver?.onClear(name);
              field.onChange('');
              onPicked?.(previous, '');
            }}
            caption={caption}
          />
          <FieldNote message={fieldState.error?.message ?? optionNote(options, field.value)} scheme={scheme} />
        </>
      )}
    />
  );
}

/**
 * The label on the GPS row, and the word this form calls a pin by.
 *
 * **`DiveDetailScreen`'s own word for the same pair**, deliberately — §4.1's "one deliberate
 * exception, until i18next" scopes duplicated *field labels* as the acceptable duplication,
 * and §0.6's whole account of this form is that it is "the dive detail you can type into". A
 * diver sets `GPS` here and reads `GPS` back there.
 */
function positionLabel(): string {
  return t('field.gps');
}

/** What the row reads while it holds no pin. **An invitation rather than a placeholder**, and
 * that is the one way this row departs from `DateTimeField`'s "Not set": a date field's
 * trailing slot can say what it holds and leave the gesture to be guessed, because everyone
 * has met a date picker. Nothing about an empty coordinate row says a tap would ask the
 * device where you are, so the row says it — in §2.3's own words, which have named this
 * affordance since before any of it was built. */
function locationInvitation(): string {
  return t('form.useMyLocation');
}

/** What the row reads while the device is being asked. Present tense and no punctuation
 * beyond the ellipsis: it is a state, not a sentence, and it stands in the same slot the pin
 * will occupy so nothing moves when the answer arrives. */
function locatingLabel(): string {
  return t('form.locating');
}

/*
 * What each way of failing to get a pin says is `positionRefusalSentence`'s
 * (format/positionRefusal.ts) — the one owner this row shares with the *New dive site* page's *Use
 * current position* (issue #19), which asks the device the same question for the same purpose.
 */

/**
 * §2.3's *"a GPS pin can be set from the map or **use my location** — pressed right on the
 * boat"*, as the half that needs no map (M2l). **The only thing in the app that writes a
 * dive's `latitude`/`longitude`**, and therefore the reason the dive detail's GPS row and
 * `formatCoordinates` stop being unreachable.
 *
 * **A field row like any other** (§0.6): the label leading, the value trailing, a hairline on
 * the top edge, and the clear control in the trailing state slot every other row puts it in.
 * It is `DateTimeField`'s anatomy rather than a button bolted into the form — a value that is
 * *taken* rather than typed, with the gesture behind the value slot, and the same
 * `label: value` announcement every read-back field on this form makes. It carries **no
 * chevron**, which is §0.6's rule and not an omission: a chevron marks a control that
 * discloses further rows in place, and this one discloses nothing.
 *
 * **Two form fields, one row, and one `Controller` for neither.** §6 stores the point as two
 * nullable columns (SQLite has no point type) and a half-recorded point is not a place, so the
 * row reads both through `useWatch` and writes both through `setValue` in the same gesture —
 * the shape `ControlledCylinderSpec` above already uses for a row that reads several fields,
 * for the same reason it uses it: two `Controller`s over one row would be two subscriptions
 * that can disagree about what the row holds.
 *
 * **`shouldDirty` on every write, and it is load-bearing rather than tidy.** `useDives()` and
 * `useUnitSystem()` both resolve after this screen's first render, and a reseed re-syncs every
 * field react-hook-form does not know the diver moved (`resetOptions.keepDirtyValues`, the
 * render body). Without it a pin taken in the first moment of a new form — the exact moment a
 * diver on a boat taps it — would be silently wiped by carry-over landing a beat later. The
 * same flag is what makes a *cleared* pin survive that reseed in edit mode.
 *
 * **The pin is written whether or not a site is picked, always.** The obvious objection is
 * that the site already has one, and §6 answers it before it is raised: a dive keeps its own
 * optional point *because* a diver may disagree with the community site's pin, and §5 says the
 * personal map prefers the dive's own. So there is no rule here about `siteId`, and there
 * should not be one.
 *
 * **In flight, the control is shut, and — unlike the save control — that is the whole of the
 * guard.** §4.1 asks a deliberate near-duplicate to name its sibling, and this is the reverse:
 * a place that deliberately does *not* copy one. `onValid` below carries a `savingRef` because
 * `handleSubmit` runs an async resolver before it, so both taps of a double-tap reach it before
 * any state update renders and `disabled` could never have enforced anything. Nothing here is
 * async before the flag: `setLocating(true)` runs inside the press handler itself, React flushes
 * a discrete event's updates before the next event is delivered, and a second tap therefore
 * always meets a shut control. A ref latch here would be a guard nothing could ever catch
 * failing — §10 declines those rather than banking them, and it was written and removed on
 * exactly that ground.
 */
function ControlledPositionField({
  control,
  setValue,
  scheme,
}: {
  control: FormControl;
  setValue: UseFormSetValue<DiveFormInput>;
  scheme: ColorScheme;
}) {
  const styles = makeStyles(scheme);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // `toFormNumber` (diveFormSchema.ts) rather than a cast, for `RatingField`'s reason one
  // control over: this is the form's raw value, which is a number when this row wrote it and
  // can be anything a seeded dive held, and there is one owner of reading it as a figure.
  const latitude = toFormNumber(useWatch({ control, name: 'latitude' }));
  const longitude = toFormNumber(useWatch({ control, name: 'longitude' }));
  // §4.1's owner of how a pair reads, and the same call the dive detail's GPS row makes — so
  // a pin set here and read back there cannot be two spellings of one point. `null` unless
  // BOTH are real, which is also exactly the condition for showing the clear control.
  const pin = formatCoordinates(latitude, longitude);
  const shown = locating ? locatingLabel() : (pin ?? locationInvitation());

  const locate = async () => {
    setLocating(true);
    // Cleared at the START of the attempt, never on a timer or a dismiss tap, so the sentence
    // reads as "still true" for exactly as long as it still is — the same rule `saveError`
    // follows in the render body below.
    setNote(null);
    try {
      const outcome = await currentPosition();
      if (outcome.found) {
        setValue('latitude', outcome.latitude, { shouldDirty: true });
        setValue('longitude', outcome.longitude, { shouldDirty: true });
      } else {
        setNote(positionRefusalSentence(outcome.reason));
      }
    } finally {
      // Released on both paths, exactly as the save control's own flag is: a refusal that left
      // this shut would strand the diver on a control they cannot press again, which is the
      // dead control the sentences above exist to prevent, reached from the other side.
      setLocating(false);
    }
  };

  return (
    <>
      <View style={[styles.formField, locating && styles.formFieldFocused]}>
        <View style={[styles.formFieldRow, styles.formFieldCard, locating && styles.formFieldCardFocused]}>
          <Text style={styles.formFieldLabel}>{positionLabel()}</Text>
          <Pressable
            style={styles.formFieldPicker}
            onPress={() => void locate()}
            accessibilityRole="button"
            // The `label: value` shape every read-back field on this form announces
            // (`DateTimeField`, `ControlledCylinderSpec`), so a screen reader hears what the
            // row holds — and, while it holds nothing, hears the invitation rather than an
            // empty slot.
            accessibilityLabel={t('field.labelValue', { label: positionLabel(), value: shown })}
            // Both, never one: `disabled` is what stops the press, `accessibilityState` is
            // what stops a screen reader announcing an available control that ignores taps —
            // the save control's own rule, and `busy` is the word for a control that will
            // come back.
            disabled={locating}
            accessibilityState={{ disabled: locating, busy: locating }}
          >
            <Text style={pin === null || locating ? styles.formFieldPickerTextUnset : styles.formFieldPickerText}>
              {shown}
            </Text>
          </Pressable>
          {pin !== null && !locating && (
            <ClearFieldControl
              // `null`, never `0` and never a value derived from what the row holds (§1, §10):
              // a zero latitude is a real place in the Gulf of Guinea, and `optionalNumber`
              // would keep it. This is the form's own blank — the value `blankFormValues`
              // seeds both columns with — so a cleared pin and a pin never taken reach
              // `toNewDiveInput`/`toDivePatch` as the same absence.
              //
              // **Both columns go together**, because half a point is not a place: §6 stores
              // the pair, `formatCoordinates` refuses to draw one without the other, and a row
              // that cleared the latitude alone would leave a longitude nothing on any screen
              // would ever show.
              onPress={() => {
                setValue('latitude', null, { shouldDirty: true });
                setValue('longitude', null, { shouldDirty: true });
                setNote(null);
              }}
              // No "carried" here, for `DateTimeField`'s own stated reason: §2.1 puts the GPS
              // point in the fresh half, so nothing on this row was ever inherited and there
              // is no `— cleared` tag to leave behind. This control unsets an optional field.
              accessibilityLabel={t('field.clear', { label: positionLabel() })}
              scheme={scheme}
            />
          )}
        </View>
      </View>
      {/* §0.6: "A field error is text, not a field. Muted, trailing, under the row it belongs
          to." The same slot every other row's refusals and notes take, through the same
          component, rather than a banner over a form the diver is still filling in. */}
      <FieldNote message={note ?? undefined} scheme={scheme} />
    </>
  );
}

interface RatingFieldProps {
  label: string;
  /** The form's raw value for `rating`, unread — `RatingField` puts it through
   * `toFormNumber` itself rather than making every caller agree on how to read it. */
  value: unknown;
  /** `''` clears, exactly as `OptionChips`' does, so "tapping the chosen thing unchooses it"
   * is one behaviour across every fixed-choice control on this form and not a rule the
   * rating gets its own version of. */
  onChange: (value: number | '') => void;
  scheme: ColorScheme;
}

/**
 * The rating, as `RATING_MAX` drawn marks a diver taps — §0.6: "Rating marks are **drawn**,
 * not typed: `●` and `○` are different sizes in almost every typeface, so a rating rendered
 * from glyphs looks broken; draw both as circles of one diameter, filled or outlined."
 *
 * **The mark is `RatingDot`, the same component a dive row's metadata line uses**, and that
 * sharing is the point rather than a tidiness: §0.6 troubled itself to specify how a rating
 * is drawn, and a form that drew its own would be §4.1's defining defect on exactly the rule
 * the design bothered to write down. What this control adds is not a second mark but a tap
 * target around each one.
 *
 * **This is not an `OptionChips` row, and the difference is the sheet's own call**: the owner's
 * icon sheet says "tap a dot", and a rating drawn as five circles is the one fixed-choice
 * value in the app whose *marks are the control*. A chip row saying `1 2 3 4 5` would put
 * §0.6's drawn rating back into typed glyphs at the one place the diver actually sets it.
 *
 * Each dot is its own 48 dp target (`ratingTarget`, §0.5: "Tap targets never below 48 dp"),
 * which the sheet says too. It is per dot rather than per row because each dot is a separate
 * control — pressing the third one means three.
 *
 * **Accessibility: five circles with no text would be a dead end**, so each target announces
 * `` `${label}: ${n} of ${RATING_MAX}` `` and carries `selected` for the one that IS the
 * rating — the same shape `OptionChips` announces, deliberately, so a screen reader meets one
 * grammar for "pick one of these" across the form. Not an `adjustable` slider: that role
 * promises increment/decrement actions nothing in this app implements, and a diver would be
 * told to swipe up and down on a control that only answers taps.
 *
 * A dot is *filled* up to the rating and *selected* only at it: three filled circles are what
 * "3" looks like, but only the third one is the value, and announcing three selected controls
 * would say the diver had picked three ratings.
 */
function RatingField({ label, value, onChange, scheme }: RatingFieldProps) {
  const styles = makeStyles(scheme);
  const rating = toFormNumber(value);
  // Clamped for the DRAWING only — `filledDotCount` never touches what is stored, and a
  // stored 9 keeps being 9 (§10 keeps these columns unclamped). What tells the diver about
  // that 9 is `outOfScaleNote` under the row, not the dots, which is why five filled circles
  // are allowed to stand for it here without lying: the sentence beneath says the number.
  const filled = rating === null ? 0 : filledDotCount(rating);
  return (
    // The same `formField` + label row every other field uses, with the dots in the slot §0.6
    // gives a field's second line — where the chip rows above already put their options, for
    // the reason `formRatingRow` records: this is a set to read through, not a value to read
    // off.
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
      </View>
      <View style={styles.formRatingRow}>
        {RATING_VALUES.map((level) => {
          const selected = rating === level;
          return (
            <Pressable
              key={level}
              style={styles.ratingTarget}
              onPress={() => onChange(selected ? '' : level)}
              accessibilityRole="button"
              accessibilityLabel={t('form.ratingLevel', { label, level, max: RATING_MAX })}
              accessibilityState={{ selected }}
            >
              <RatingDot filled={level <= filled} scheme={scheme} variant="field" />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The rating bound to the form, with whatever its current value has to say for itself —
 * `ControlledOptionField`'s shape, for the same reasons, one control over.
 *
 * The note matters more here than on a chip row and is the reason this is not just
 * `<RatingField>` inside a `Controller`: a rating outside 1–5 lights no dot, so without a
 * sentence the row would read as "nothing recorded" over a value that is recorded and is
 * about to be saved again untouched. `outOfScaleNote` (via `optionNote`) is what says the
 * number out loud. Until M1h this field was a text box, where a stored 9 was simply visible.
 */
function ControlledRatingField({ control, scheme }: { control: FormControl; scheme: ColorScheme }) {
  return (
    <Controller
      control={control}
      name="rating"
      render={({ field, fieldState }) => (
        <>
          <RatingField label={t('field.rating')} value={field.value} onChange={field.onChange} scheme={scheme} />
          <FieldNote message={fieldState.error?.message ?? optionNote(RATING_VALUES, field.value)} scheme={scheme} />
        </>
      )}
    />
  );
}

interface EquipmentTokenFieldProps {
  label: string;
  worn: boolean;
  onChange: (worn: boolean) => void;
  scheme: ColorScheme;
}

/**
 * One accessory, as a single toggling Yes/No chip.
 *
 * **This is `BooleanField` under a new name and with the same body**, because the control a
 * diver touches has not changed — only what it writes. It used to be bound to a `hood`,
 * `gloves` or `boots` column of its own; §10 replaced the three with the `equipment` token
 * set, so each chip now toggles membership rather than a boolean, and two more accessories
 * (torch, camera) join at no cost — which is the whole reason a set beat three columns.
 *
 * A chip rather than RN's own `Switch`: `Switch` needs raw `trackColor`/`thumbColor`
 * strings, which have no way to come from `makeStyles(scheme)` the way every other colour in
 * this screen must (`src/screens/**`'s colour-literal lint rule scans for exactly that),
 * where a chip reuses the monochrome `formChip`/`formChipSelected` treatment already built
 * for the pick fields above.
 */
function EquipmentTokenField({ label, worn, onChange, scheme }: EquipmentTokenFieldProps) {
  const styles = makeStyles(scheme);
  return (
    // The one field whose value genuinely fits the row's trailing slot as a control rather
    // than as text — so it is `formField` plus `formFieldRow` like every other field (§0.6),
    // with the chip standing where a typed value would. It used to be the bare label row with
    // no field wrapper at all, which is why these rows drew no hairline of their own.
    // `formFieldChoice` is the padding a 48 dp chip needs inside a 48 dp row — see that style.
    <View style={[styles.formField, styles.formFieldChoice]}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <Pressable
          style={[styles.formChip, worn && styles.formChipSelected]}
          onPress={() => onChange(!worn)}
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityState={{ checked: worn }}
        >
          <Text style={[styles.formChipText, worn && styles.formChipTextSelected]}>
            {worn ? t('field.yes') : t('field.no')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Adds or removes one token from an equipment set, **without disturbing anything else in
 * it**.
 *
 * That is the whole function, and it is the one rule this control could plausibly get
 * wrong: rebuilding the array from the five chips — `EQUIPMENT_VALUES.filter(isOn)` — reads
 * as the obvious implementation and would silently DELETE any token this build has no chip
 * for. §10's "kept, not refused" policy is what makes that reachable rather than
 * theoretical: `optionalTokenSet` (diveFormSchema.ts) deliberately preserves a token written
 * by a newer client, and this is the other half of that promise. A diver who toggles their
 * gloves on a dive synced from a future build must not lose whatever that build recorded.
 *
 * The known tokens come out in `EQUIPMENT_VALUES` order — the vocabulary's own order, which
 * `domain/types.ts` says is part of what the list declares — and anything unrecognised is
 * kept, in its own order, after them. Order is not a difference `toDivePatch` can see
 * (`sameEquipment` compares sets), so this is about what the value READS like, not about
 * what gets written.
 *
 * **A member is the accessory its word is** (`wordsOf`, PR #72's re-review): a stored ` hood`
 * is the hood, as the dive's page reads it, so its row reads Yes here too, switching it off
 * takes the padded copy with it, and a press on another row writes it back as `hood`. Only a
 * member that reads as a known accessory is rewritten. Anything else, a word this build does
 * not know or a member that is no word at all, is kept exactly as stored.
 */
function withEquipmentToken(current: readonly Equipment[], token: Equipment, worn: boolean): Equipment[] {
  const held = new Set<string>(wordsOf(current));
  if (worn) held.add(token);
  else held.delete(token);
  const known = EQUIPMENT_VALUES.filter((value) => held.has(value));
  const foreign = current.filter((member) => !wordsOf([member]).some((word) => isEquipmentToken(word)));
  return [...known, ...foreign];
}

/** Whether a word is one of the accessories this build has a row for. */
function isEquipmentToken(word: string): boolean {
  return (EQUIPMENT_VALUES as readonly string[]).includes(word);
}

/**
 * DESIGN.md §6's accessory token set — one Yes/No row per accessory, all bound to the single
 * `equipment` field.
 *
 * One `Controller` for the whole set rather than one per token, because there is one form
 * field: `equipment` is an array, and five `Controller`s on the same path would each hold a
 * stale copy of it between renders and overwrite one another's toggles.
 *
 * **An unrecognised token has no chip and is not shown anywhere on this form**, which is a
 * known and deliberate gap rather than an oversight. It is *kept* — `withEquipmentToken`
 * above is what guarantees that, and it is the part that actually matters, since the failure
 * this policy exists to prevent is silent data loss. Telling the diver it is there needs a
 * sentence in the shape of `unknownOptionMessage`, and that sentence ("pick one of the
 * options to replace it") is wrong for a set, where tapping a chip adds a different token
 * rather than replacing this one. M1h's form-design task owns how this control presents
 * itself; the honest wording belongs with it rather than invented here.
 */
function ControlledEquipmentField({ control, scheme }: { control: FormControl; scheme: ColorScheme }) {
  return (
    <Controller
      control={control}
      name="equipment"
      render={({ field, fieldState }) => {
        const current = Array.isArray(field.value) ? (field.value as Equipment[]) : [];
        // Read as the dive's page reads it (`wordsOf`): a stored ` hood` is the hood.
        const held = new Set<string>(wordsOf(current));
        return (
          <>
            {EQUIPMENT_VALUES.map((token) => (
              <EquipmentTokenField
                key={token}
                label={formatEquipmentToken(token)}
                worn={held.has(token)}
                onChange={(worn) => field.onChange(withEquipmentToken(current, token, worn))}
                scheme={scheme}
              />
            ))}
            <FieldNote message={fieldState.error?.message} scheme={scheme} />
          </>
        );
      }}
    />
  );
}

/** The label on the row that reads a cylinder's specification back (`ControlledCylinderSpec`
 * below), and the word this form calls that specification by. Not "Cylinder spec": the group
 * around it is already *Gas & cylinders*, and the gas rows beside it are what make the
 * distinction visible without a second noun. */
function cylinderLabel(): string {
  return t('field.cylinder');
}

/**
 * What the cylinder block currently reads as — `Single 12 l Steel · 232 bar`, or `null` when
 * it records no specification at all.
 *
 * **Two conversions and no third statement of anything.** The form holds the figures the
 * diver types (a working pressure of `3365` under a `psi` label) and both `toStoredTanks` and
 * `formatCylinderSpec` speak SI, so this parses the raw form values into SI through the one
 * owner of that direction and hands them to the one owner of the words, the order and the
 * separators. The round trip is deliberate rather than wasteful: formatting the display
 * figures directly would need a formatter that does not convert, which is a second owner of
 * cylinder text, and §4.1 has already paid for that once with "Steel" on one screen and
 * "steel" on the next.
 *
 * `tanks.0` alone, like everything else this form binds — see the two pressures' own note in the
 * Gas & cylinders group for why that stays true when "+ add cylinder" (§6) lands.
 *
 * **A half-typed figure cannot break this**, which is worth stating because `toStoredTanks`
 * returns `[]` for values it cannot parse and that would blank the summary. It cannot happen
 * here: `optionalNumber` (diveFormSchema.ts) *transforms* rather than rejects — `"1."`, `""`
 * and even `"abc"` all become `null` — so the parse always succeeds and an unreadable field is
 * simply absent from the line, exactly as an unrecorded one is.
 */
function cylinderSpecText(tanks: DiveFormInput['tanks'], units: UnitSystem): string | null {
  const [first] = toStoredTanks(tanks, units);
  return first === undefined ? null : formatCylinderSpec(first, units);
}

/**
 * DESIGN.md §2.2's cylinder specification, read back as **one row** that expands into the four
 * fields behind it.
 *
 * §10's snapshot ruling is what makes this possible and what makes it necessary: the dive
 * stores its own full copy of the spec, and *storing and showing are different questions*. The
 * owner's complaint was that he faced six cylinder fields on a form where he changes only the
 * gas and the pressures — and the answer is not to remove any of them, because a snapshot
 * nobody can amend is not a snapshot. So the four fields a diver sets once and reuses (rig,
 * size, material, working pressure) collapse into `formatCylinderSpec`'s line, and the four
 * that describe THIS dive — the two gas fractions and the two pressures — stay directly
 * editable beside it.
 *
 * **What the row shows and what decides whether it is open are deliberately two different
 * reads.** The text follows the live form values, so correcting the size and collapsing again
 * shows the correction. The DEFAULT follows the SEED (`defaultExpanded`, computed by the
 * screen from `carried.values`): a default that followed the live values would flip to
 * "collapsed" the instant the diver typed the first digit of a size, closing the fields under
 * their thumb mid-edit.
 *
 * **Open when there is nothing to summarise, which is §2.2's group rule turned around.** A
 * group opens when it HOLDS a value; a summary row opens when it holds none — a summary can
 * only stand in for fields that have something in them, and with nothing to show this would be
 * an empty labelled row, which §0.6 says reads as a control that failed to load. It would also
 * hide the only way to enter a cylinder at all on a first-ever dive.
 *
 * `toggled` is the diver's own gesture and outranks both, for the life of this form — the same
 * shape `FormGroup` uses, and for the same reason: a default that arrives late (`useDives`
 * resolving after the first render) must reach a row nobody has touched, and must never
 * overrule one they have.
 *
 * **`useWatch` inside this component, not in the screen, and deliberately not a `Controller`.**
 * The position is what matters first: reading the cylinders here rather than in the render body
 * confines a re-render to this subtree instead of firing all thirty of the form's rows on every
 * keystroke in a cylinder field.
 *
 * Which of the two subscriptions is a **measured** finding rather than a preference, and the
 * mechanism is worth recording because it is invisible from the code. `Controller`'s own
 * `field.value` is `get(formValues, 'tanks')` — react-hook-form mutates that array **in place**
 * when a child path like `tanks.0.sizeL` is written, so the reference never changes and React
 * bails out of the re-render. It works until something calls `setValue('tanks', ...)` — which
 * applying a preset does — and from that point the summary silently freezes on the applied
 * cylinder while the diver edits the fields underneath it. `useWatch` clones what it hands back,
 * so a mutated array still arrives as a new reference and the row follows the fields. Found by a
 * test that applied a preset and then changed the size; the version without it was green
 * everywhere else.
 *
 * **Its anatomy is a field row and its behaviour is a group header, and the two halves come
 * from different places on purpose.** The anatomy is §0.6's own — a label leading, a value
 * trailing as text — and, since this value is read rather than typed, it borrows
 * `DateTimeField`'s `label: value` announcement so a screen reader hears what the cylinder IS
 * rather than that a control exists.
 *
 * What it does **not** borrow is that control's behaviour, and an earlier version of this
 * paragraph claimed it did: `DateTimeField` makes only the value SLOT pressable and fills the
 * row with `surface` while its picker is open. Here the whole 48 dp row is the target (§0.5's
 * wet thumb, and the same target a group header offers) and nothing fills, because the fill is
 * what §0.6 reserves for focus and nothing here takes focus.
 *
 * The mark is `disclosureChevron`, drawn and rotated, under the rule §0.6 now states on the
 * axis these two controls actually differ on: **a control that discloses further rows in place
 * carries the chevron; one that opens a picker over the row does not.** This discloses rows —
 * so it is a group header's kind of thing wearing a field row's clothes
 */
function ControlledCylinderSpec({
  control,
  units,
  defaultExpanded,
  scheme,
  children,
}: {
  control: FormControl;
  units: UnitSystem;
  defaultExpanded: boolean;
  scheme: ColorScheme;
  children: ReactNode;
}) {
  const styles = makeStyles(scheme);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? defaultExpanded;
  const summary = cylinderSpecText(useWatch({ control, name: 'tanks' }), units);
  return (
    <>
      <Pressable
        style={styles.formField}
        onPress={() => setToggled(!expanded)}
        accessibilityRole="button"
        // The `label: value` shape every read-back field on this form announces
        // (`DateTimeField`), so a screen reader hears what the cylinder is and not merely
        // that there is a control here. The open/closed state travels as STATE beside it,
        // exactly as `FormGroup`'s header carries it, rather than as a word in the label
        // that would then have to change out from under it.
        accessibilityLabel={t('field.labelValue', { label: cylinderLabel(), value: summary ?? notRecorded() })}
        accessibilityState={{ expanded }}
      >
        <View style={styles.formFieldRow}>
          <Text style={styles.formFieldLabel}>{cylinderLabel()}</Text>
          <View style={styles.formFieldPicker}>
            <Text style={summary === null ? styles.formFieldPickerTextUnset : styles.formFieldPickerText}>
              {summary ?? notRecorded()}
            </Text>
          </View>
          <View style={[styles.disclosureChevron, expanded && styles.disclosureChevronExpanded]} />
        </View>
      </Pressable>
      {expanded ? children : null}
    </>
  );
}

/**
 * DESIGN.md §2.1's cylinder presets, offered where the cylinders are: a row of chips at the
 * top of the Gas & cylinders group, one tap each. "Named cylinder sets ('twin 12 steel',
 * 'alu 80 nitrox') apply the whole cylinders-and-gas block in one tap."
 *
 * **Absent entirely when there are none**, label and all, so a diver who has never saved one
 * sees nothing new — and so an empty row can never read as a control that failed to load.
 *
 * **Deliberately not `OptionChips`, and the styles are still that component's.** What
 * `OptionChips` owns is §0.6's invert — "the chosen thing is the inverted thing" — and a
 * preset has no chosen state for it to express: a preset is *applied*, not *selected*, so
 * the moment after a tap the row looks exactly as it did before, and the value the diver
 * changed is in the fields below. Passing it a permanently-null `value` would render that
 * rule and then deny it, and would announce every chip to a screen reader as an unselected
 * option in a fixed-choice field for ever — a lie about what pressing one does. So these are
 * buttons ("Apply preset X"), wearing `formChip`/`formChipText` from theme/styles.ts, which
 * is where §0.6's chip treatment actually lives. What is NOT borrowed is `formChipSelected`,
 * which is the half `OptionChips` exists for.
 */
function PresetChips({
  presets,
  onApply,
  scheme,
}: {
  presets: readonly GearPreset[];
  onApply: (preset: GearPreset) => void;
  scheme: ColorScheme;
}) {
  const styles = makeStyles(scheme);
  if (presets.length === 0) return null;
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{t('preset.presets')}</Text>
      </View>
      <View style={styles.formChipRow}>
        {presets.map((preset) => (
          <Pressable
            key={preset.id}
            style={styles.formChip}
            onPress={() => onApply(preset)}
            accessibilityRole="button"
            // Says what pressing it does, not merely what it is called: a row of chips
            // announced as bare names says nothing about where a tap would land.
            accessibilityLabel={t('preset.apply', { name: preset.name })}
          >
            <Text style={styles.formChipText}>{preset.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * The other half of §2.1's presets: capturing one from the cylinders already in front of the
 * diver. §10, the owner's call — "saving one takes whatever cylinders are already typed into
 * the dive you are logging, because retyping them in Settings is the work the preset exists
 * to remove."
 *
 * **At the END of the group, and revealed rather than always open.** It is the position
 * *Delete dive* occupies on the detail screen and it is there for the same stated reason: a
 * deliberate act should take a deliberate reach, and this is not part of the flow down the
 * fields. Tapping it reveals an inline name row and a confirm — **not** a modal and not a
 * platform prompt: `Alert.prompt` is iOS-only, and `platform/confirmDestructive.ts` exists
 * for destructive chrome specifically (§10), which this is not.
 *
 * **It says "Save as preset", and it says what it saves.** This screen has a recorded rule
 * that its controls stay "deliberately free of the word 'Save', so it can never be mistaken
 * — by a screen reader or by a test query — for the save control" (`StatusControl` above),
 * and that rule is about a control whose label would name no object at all: a bare "Save" one
 * row from `Save dive` is genuinely ambiguous. `Save as preset` and `Save preset` both name
 * what they write, which is the same verb-plus-noun shape every other control in this app
 * uses (`Save dive`, `Delete dive`, `Complete dive`). The wording was briefly `Add to my
 * presets`, which dodged the collision at the cost of the only first-person possessive string
 * in the codebase — a label chosen to route around a test helper (`findButton`'s substring
 * match, since fixed) rather than for the diver reading it.
 *
 * **It decides nothing.** Whether a name is empty, whether the cylinders are worth storing
 * and whether the name is already taken are all the screen's rules (`savePreset`), because
 * two of the three need the form's values and the live preset list. This owns the reveal,
 * the name text, and where the answer is shown — under the row it belongs to, as text (§0.6:
 * "a field error is text, not a field"; it shipped once as a white box the same height as an
 * input).
 *
 * `onSave` returns the sentence to show, or `null` when the preset was written — one return
 * value for a refusal and a failed write alike, because from here they are the same event:
 * the row stays open, with what the diver typed still in it.
 */
function PresetCapture({
  onSave,
  scheme,
}: {
  onSave: (name: string) => Promise<string | null>;
  scheme: ColorScheme;
}) {
  const styles = makeStyles(scheme);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  // The same two-part in-flight guard the dive's own save carries, and for the same reason:
  // both taps of a double-tap reach the handler before React has rendered anything, so the
  // ref is the latch and `saving` is only how that state is SHOWN. Without it a double-tap
  // writes two presets under one name — which the duplicate check cannot catch, because the
  // live list has not re-rendered between the two.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const problem = await onSave(name);
      setNote(problem);
      if (problem === null) {
        setName('');
        setNaming(false);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      {naming && (
        <>
          <FormField
            label={t('field.presetName')}
            value={name}
            // Typing clears the note: it described the name that was in the box, and a
            // sentence about a name the diver has already changed is a stale complaint.
            onChange={(text) => {
              setNote(null);
              setName(text);
            }}
            scheme={scheme}
            placeholder={t('preset.namePlaceholder')}
          />
          <FieldNote message={note ?? undefined} scheme={scheme} />
        </>
      )}
      <View style={styles.formPresetActions}>
        {naming && (
          <Pressable
            style={styles.formPresetAction}
            onPress={() => {
              setNaming(false);
              setName('');
              setNote(null);
            }}
            accessibilityRole="button"
            // Announced more fully than it is written, exactly as this screen's own `‹ Cancel`
            // is ("Leave without saving"): out of context a bare "Cancel" would be
            // indistinguishable from the control that leaves the whole form.
            accessibilityLabel={t('preset.cancelSaving')}
          >
            <Text style={styles.formPresetActionLabel}>{t('common.cancel')}</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.formPresetAction}
          onPress={naming ? () => confirm() : () => setNaming(true)}
          disabled={naming && saving}
          accessibilityRole="button"
          accessibilityLabel={naming ? t('preset.save') : t('preset.saveAs')}
          accessibilityState={{ disabled: naming && saving }}
        >
          <Text style={styles.formPresetActionLabel}>{naming ? t('preset.save') : t('preset.saveAs')}</Text>
        </Pressable>
      </View>
    </>
  );
}

/**
 * *Save as preset*, offered only while there is something new to save.
 *
 * The owner's complaint, verbatim: *"there is 'Save as preset' button even I already selected a
 * preset. It's not intuitive."* He is right — a control offering to store what he had just
 * loaded from storage. `presetMatching` (domain/presets.ts) decides what "already selected" is
 * and states at length why it is a comparison rather than a remembered tap; the consequence
 * that matters here is that **editing the cylinders after applying a preset brings the control
 * back**, because at that point there really is a new cylinder block to name.
 *
 * **Absent, not disabled.** A greyed-out control still occupies the row and still invites the
 * press it will refuse, which is the "told nothing, can do nothing" shape §1 keeps ruling out;
 * and this screen already has a control that vanishes when it has nothing to offer — the preset
 * chips themselves, absent entirely for a diver who has saved none, "so an empty row can never
 * read as a control that failed to load".
 *
 * **`useWatch` in a component of its own rather than in the screen**, for both of the reasons
 * `ControlledCylinderSpec` above records at length: it keeps a cylinder keystroke from
 * re-rendering the whole form, and a `Controller` on this path would freeze on the applied
 * preset the moment one was applied.
 */
function ControlledPresetCapture({
  control,
  presets,
  units,
  onSave,
  scheme,
}: {
  control: FormControl;
  presets: readonly GearPreset[];
  units: UnitSystem;
  onSave: (name: string) => Promise<string | null>;
  scheme: ColorScheme;
}) {
  // Asked of the raw form values and the diver's own units, because `presetMatching` converts
  // each candidate preset's way (domain/presets.ts): an imperial diver's `3002` in a `psi` field
  // has to compare equal to the `207 bar` their own preset holds, and converting once here would
  // turn it into 206.98… and never match anything again.
  const applied = presetMatching(presets, useWatch({ control, name: 'tanks' }), units);
  return applied === null ? <PresetCapture onSave={onSave} scheme={scheme} /> : null;
}

/**
 * DESIGN.md §2.4's Logged/Planned control — the producer half of prepare-ahead planned
 * dives, and the app's **only** way for a dive's status to change. Everything downstream
 * of it was built first: the "Up next" section, exclusion from numbering and stats, the
 * *Complete dive* pill. Nothing could reach `status: 'planned'` until this existed.
 *
 * **Quiet, on the owner's own words** — "most of the dives will not be created as planned
 * so this feature should not scream too much." So it is §0.6's existing chip vocabulary
 * (`actionPill`: small, uppercase, tracked, muted, bordered so it reads as a control
 * rather than a label) sitting beside the heading, not a segmented control and not a new
 * visual idiom, and emphatically not a fourth slot in §2.2's core strip — that strip says which
 * dive this is, and whether it has happened yet is not one of the things that say so.
 *
 * A toggle, in the same `accessibilityRole="switch"` idiom `EquipmentTokenField` above
 * already uses for each accessory, because this is the same shape of question: one control,
 * two states, the current one written on its face. Only the unusual state fills
 * (`formStatusPillOn`) — §0.1's inverted ink, never a hue, since colour is spoken for.
 *
 * It carries no rule about what saving does. It is a plain form field
 * (`optionalStatus`, diveFormSchema.ts), so `toDivePatch` diffs it like every other
 * field: the patch names `status` when this differs from what the dive is stored with and
 * at no other time. Editing a planned dive leaves it planned; flipping this to Logged
 * *is* completing it.
 */
function StatusControl({ control, scheme }: { control: FormControl; scheme: ColorScheme }) {
  const styles = makeStyles(scheme);
  return (
    <Controller
      control={control}
      name="status"
      render={({ field }) => {
        const planned = field.value === 'planned';
        return (
          <Pressable
            style={styles.formStatus}
            onPress={() => field.onChange(planned ? 'logged' : 'planned')}
            accessibilityRole="switch"
            // Names the QUESTION, not the current answer, which `accessibilityState`
            // below carries instead — so a screen reader announces "Planned dive, switch,
            // off" rather than a label that changes out from under the state it describes.
            // Deliberately free of the word "Save", so it can never be mistaken — by a
            // screen reader or by a test query — for the save control it changes the
            // wording of.
            accessibilityLabel={t('form.plannedDive')}
            accessibilityState={{ checked: planned }}
          >
            <View style={[styles.formStatusPill, planned && styles.formStatusPillOn]}>
              {/* The word is the STORED value's, read through §4.1's owner of that
                  conversion (`formatDiveStatus`, format/display.ts) rather than spelled here —
                  the same two words the dive detail's Status row reads back. */}
              <Text style={[styles.formStatusLabel, planned && styles.formStatusLabelOn]}>
                {formatDiveStatus(planned ? 'planned' : 'logged')}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

/**
 * What this form says it is, given the mode, the dive's stored status and the state the
 * control is currently on — and it must never say more than the save will actually do.
 *
 * That is not a stylistic point. The heading used to read "Complete dive" for any planned
 * dive under edit, which was true only because the screen quietly logged it on save no
 * matter what the diver came here for. With that rule gone (see `onValid`), "Complete
 * dive" is a claim about this particular save, and it is true exactly when the control is
 * on Logged over a dive stored as planned — which is what arriving through §2.4's
 * *Complete dive* pill sets up (`editDiveLink.ts`), and what flipping the control by hand
 * sets up too. The heading, the control and the save's own label are three views of one
 * value, so they cannot disagree.
 *
 * **`stored` is never "not read yet", and the caller keeps it that way.** This function cannot
 * answer without it — `null` already means create mode, or an edit of a dive that genuinely is
 * not in the logbook — so a screen that called it while the dives read was still outstanding
 * would be told "logged" and would say "Edit dive" over what may be a plan. That is what the
 * waiting frame did until M1g. It now draws no heading at all rather than asking a question this
 * function has no answer to, which is why nothing here has a case for it.
 */
function headingFor(mode: 'create' | 'edit', stored: DiveStatus | null, chosen: DiveStatus): string {
  if (mode === 'create') return t(chosen === 'planned' ? 'form.headingNewPlan' : 'form.headingNewDive');
  // The same words the dive detail's own *Complete dive* control says, from one key: it is the
  // same act on the same object, arrived at from the other end.
  if (stored === 'planned' && chosen === 'logged') return t('dives.completeDive');
  return t(chosen === 'planned' ? 'form.headingEditPlan' : 'form.headingEditDive');
}

/** What the save control says it will do — "the diver should never have to remember which
 * mode they are in to know what the button does." Both the visible label and the
 * accessibility one, from this one function, so the two cannot drift. */
function saveLabelFor(chosen: DiveStatus): string {
  return t(chosen === 'planned' ? 'form.savePlan' : 'form.saveDive');
}

/**
 * **The sentence that names the return mark**, from the owner's design sheet: `↵ Carried from
 * #127 — clear any of them`, under the heading and above the first field.
 *
 * It is the mark's legend, and that is what earns it a row. §0.6's standing test — "a symbol
 * that needs a legend has already failed", the computed-value square's own epitaph — would
 * otherwise be a real objection to a bare `↵` down the side of a form: the `=` before a
 * computed value carries its meaning because that is literally what the value is, and a return
 * arrow is a shade less self-evident than that. Saying it once, **in the same view as the marks
 * it describes**, is the difference between a legend a diver has to remember and a caption they
 * read as the form opens. It also answers the question the mark provokes and cannot itself
 * answer: carried from *which* dive.
 *
 * **It is a caption, not a control, and that is a decision with a defect on either side of
 * it.** §0.6 records a different affordance in the same corner of this screen — "the form
 * header's 'from #6' is tappable and starts the dive blank, for the dive that has nothing in
 * common with the last" — which has never been built; there is no such control on this screen
 * today and never has been. The two are not the same thing wearing different words: this line
 * *explains* the marks below it, and that one would *discard* every one of them in a single
 * unconfirmed tap. Making this line tappable would be a caption that silently wipes a form —
 * the brief's own "a line that looks like a label but starts a blank dive" — and building it as
 * a control that reads like a caption is the same defect from the other end. So this states
 * what the marks mean and does nothing; "start this dive blank" needs a control that looks like
 * one, whenever it is wanted.
 *
 * **Two forms, because the number is not always known.** `numbers` (useDives.ts) is the offset
 * from a settings read that lands independently of the dives themselves, so for a render or
 * two after a cold start the map can be empty — and `#undefined` on a form is worse than not
 * naming the dive at all, while dropping the whole line for those renders would flicker the
 * legend out from under the marks it explains. The fallback names the dive the only other way
 * this app can: it is `carryOverSource`'s most recent logged dive, which is what "your last
 * dive" means here.
 */
function carriedFromLabel(sourceNumber: number | undefined): string {
  const from = sourceNumber === undefined ? t('form.lastDive') : `#${String(sourceNumber)}`;
  return t('form.carriedFrom', { from });
}

/**
 * The three fields `computeCarriedPaths` marks that **no row can show a mark for**, and
 * therefore the three that must not make the caption above appear.
 *
 * `siteId` and `centerId` are §6's half of the site snapshot: written by a pick on the Site or
 * Centre row, never typed, so they have no row at all (`OFF_FORM_FIELDS` already says so for a different
 * rule). `equipment` has five rows and no single one of them: it is a token set of Yes/No
 * chips, so there is nowhere for one mark and one clear to sit, and `[]` is itself a real
 * carried answer meaning "no accessories" that a clear control could not distinguish itself
 * from.
 *
 * **This list is what stands between the caption and a permanent lie**, which is why it is a
 * named rule rather than an `if`. `hasCarriedValue` counts `[]` as carried on purpose (see its
 * own docblock — an empty accessory set is an answer), and `equipment` is non-nullable (§6), so
 * **every previous dive that has ever existed carries it**: gated on `paths.size` alone the
 * caption would be permanent, standing over a form whose every visible mark the diver had
 * already dealt with, telling them to clear things that are not there.
 *
 * `computeCarriedPaths`' own docblock already anticipates exactly this: it marks these fields
 * "simply one nothing currently reads", so that a field growing a row later is covered
 * automatically. That is the right default for the SET; the caption is the one reader that has
 * to know which of its members are actually on screen.
 *
 * **Exported for `DiveFormScreen.test.tsx` alone**, which holds its own hand-written list of
 * the carried fields with no row and sweeps the rest against what the screen actually renders.
 * Comparing the two is what stops a fourth name being added here — silently turning the caption
 * off for a dive whose only carried field is that one — without the sweep noticing.
 */
export const CARRIED_WITHOUT_A_MARK: ReadonlySet<string> = new Set(['siteId', 'centerId', 'equipment']);

/** Whether any field on this form is currently wearing §0.6's return mark — which is the only
 * thing the caption above has to explain, and the only condition under which "clear any of
 * them" names anything a diver can act on. */
function hasVisibleCarryOver(paths: ReadonlySet<string>): boolean {
  for (const path of paths) if (!CARRIED_WITHOUT_A_MARK.has(path)) return true;
  return false;
}

export interface DiveFormScreenProps {
  mode: 'create' | 'edit';
  /** Which dive `mode="edit"` is for — found inside `useDives()`'s own list (Task 7), never
   * fetched with a second query, exactly as DiveDetailScreen.tsx finds the dive it shows. */
  diveId?: string;
  /**
   * Which state §2.4's Logged/Planned control OPENS on, overriding the dive's own stored
   * status — `openAsStatus` (navigation/editDiveLink.ts) reading what the *Complete dive*
   * pill put in the route. Nothing else about the form changes, and nothing is written:
   * the diver sees a flipped control, fills in the missing numbers, and saving is still
   * the one deliberate act that logs the dive.
   *
   * A prop rather than a second rule inside this screen, deliberately. "If the dive is
   * planned, log it on save" is what this milestone deleted — it turned every edit of a
   * planned dive into a completion, including the one where the diver only came back to
   * fix a typo in the site name.
   */
  initialStatus?: DiveStatus;
}

/** Shown when `createDive`'s or `updateDive`'s write rejects (`onValid` below) — see
 * `formSaveError` (theme/styles.ts) for why this is not silent, and not a `disabled` save
 * control either. */
function saveErrorMessage(): string {
  return t('form.saveFailed');
}

/**
 * Shown when Save is pressed in edit mode and there is no dive to write to — the id names
 * nothing live (deleted on another device, a stale deep link), or `useDives()` has not
 * resolved yet.
 *
 * Not silent, and deliberately not a `createDive` fallback either: a form that quietly
 * logged a NEW dive because it could not find the one it was editing would duplicate the
 * dive on the device that still has it, and duplicate it again on every later attempt.
 */
function missingDiveMessage(): string {
  return t('form.missingDive');
}

/* Nothing *Save as preset* says lives on this screen any more. The three refusals — an unnamed
 * preset, a duplicate name, a cylinder block with nothing in it — are `presetRefusal`'s
 * (domain/presets.ts), because §3's editor states exactly the same three and two of them were
 * byte-identical copies here; §4.1's "one deliberate exception, until i18next" covers duplicated
 * **field labels**, and a sentence stating a rule's verdict is not one. The failed-write
 * sentence went the same way (`presetSaveFailed`) for the plainer reason that the editor says
 * it too, about the same object, in the same words. */

/**
 * The dive-entry form (DESIGN.md §2.2, M1d task 4): one scrollable form with a small
 * always-visible core strip — date, site and centre, what identifies the dive — and everything
 * else in seven collapsible `FormGroup`s, of which the two a diver fills on most dives start open
 * (`FormGroupSpec.startsOpen`). **Only the date is required** (§2.2); every other field,
 * including a wholly untouched one, is a legitimate save.
 *
 * The save control (`formFooter` below) is **never disabled for validity** — nothing about
 * what the diver has or has not filled in, or what the resolver makes of it, ever reaches
 * its `disabled` prop — because §1's "never block a save" binds the CONTROL itself, not
 * just what happens after it is pressed. `handleSubmit(onValid)` still runs
 * `zodResolver(diveFormSchema)` underneath, so a diver can always tap Save; a rejected
 * `createDive` says so (`saveErrorMessage`) instead of pretending it worked, and never
 * touches the diver's typed values — §1's "never block a save" cuts both ways, and losing
 * what a diver already entered because the disk was full is the other direction of the same
 * failure.
 *
 * It **is** disabled while a write is in flight, and only then (§10: "the save control also
 * needs an in-flight disabled state, since the repository is safe under concurrency but a
 * double-tap would create two dives"). That is not validity blocking a save — it is one
 * save already under way. `handleSubmit` has no re-entrancy latch of its own, so `onValid`
 * below carries one; `disabled` is the visible half of it, not the enforcing half, because
 * the two taps of a double-tap can both land before any state update has rendered.
 *
 * Creating a dive (`createDive`, `useDives()`, `carryOverFrom` applied to the diver's own
 * most recent LOGGED dive, and returning to the list on success — Task 6) is wired below
 * for `mode="create"`.
 *
 * **`mode="edit"`** (Task 7) is the same form seeded from one stored dive
 * (`diveToFormValues`) instead of from carry-over, saving through `updateDive` with a patch
 * of **only what changed** (`toDivePatch`, diveFormSchema.ts) rather than the whole row —
 * see that function for why the distinction between "left alone" and "cleared" is the
 * entire point.
 *
 * **Planned dives (§2.4) are the `StatusControl` above and nothing else.** Creating one is
 * this form with the control on Planned; completing one is this form with the control
 * moved to Logged, at which point the dive gains a number and renumbers its neighbours,
 * because numbering is computed (§2.5) rather than stored. Both are the ordinary save
 * path: the control is a form field, so the patch names `status` exactly when the diver
 * moved it. What is deliberately absent is any rule keyed on the stored status or on the
 * entry point — this screen used to log any planned dive it was handed, so editing one to
 * fix a typo silently completed it.
 */
export default function DiveFormScreen({ mode, diveId, initialStatus }: DiveFormScreenProps) {
  // The subscription that repaints this screen when the diver changes the language (src/i18n) —
  // a screen root, so nothing above it re-renders on its own.
  useT();
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  // M3m — read at the screen, beside the inset it qualifies, rather than inside the footer's
  // style: the sheet is scheme-only and can know neither of these two numbers.
  const keyboardShown = useKeyboardShown();

  // The one read this screen needs for carry-over (useDives.ts's own "the one read every
  // screen uses") — never a second query, per this task's own brief. See
  // `initialFormValues`'s docblock for why `dives` (and therefore this) can change after
  // mount, and why that is handled below rather than assumed away.
  // `resolved` is read alongside the list because `dives` alone cannot say whether it has been
  // read yet — see the waiting frame below, and `DiveListState.resolved` for the mechanism.
  // `numbers` joins the two this screen already read (M1h): §2.5's computed dive numbers, so
  // the carried caption below can name the dive its values came from. Read off the same call
  // rather than recomputed, exactly as the list and the detail hero read it — a second
  // numbering here would be §2.5's rule written twice.
  const { dives, numbers, resolved } = useDives();
  // The diver's units (§3). Its own hook, never a field on `useDives()` — see
  // db/useUnitSystem.ts. It decides what this form's figures are expressed in, so it is
  // part of the reseed gate below exactly as the seed dive's id is.
  const units = useUnitSystem();
  // The dive being edited, found inside the one read every screen uses rather than through
  // a second query of this screen's own — the identical rule (and the identical `find`)
  // DiveDetailScreen.tsx follows for the dive it shows, so the form and the detail it was
  // opened from can never disagree about what the dive holds. `null` in create mode, and
  // while `useDives()` has not resolved yet.
  const target = mode === 'edit' && diveId !== undefined ? (dives.find((d) => d.id === diveId) ?? null) : null;
  // The one dive this form is seeded from: the previous dive in create mode (carry-over,
  // §2.1), this dive in edit mode (its own stored values, Task 7).
  const seedDive = mode === 'edit' ? target : carryOverSource(mode, dives);
  // The ONE value the re-derivation below is allowed to compare. `useDives()` returns a
  // brand-new object holding a brand-new array on every render (`composeDives`'s `toDives`
  // is `rows.map(toDive).sort(...)`), so every value derived from it — `dives`, `seedDive`,
  // this form's own starting values — has a fresh identity every render and can never
  // compare equal to what the previous render produced. A dive id is a string: it
  // compares by value, so it
  // settles the moment the underlying dive does, no matter how many objects were rebuilt
  // around it. `null` covers "no logged dive to carry from" and "the edited dive has not
  // arrived yet" alike.
  const sourceId = seedDive?.id ?? null;

  // Everything derived from the seed dive, held as one piece of state keyed by the id it
  // came from. React's own documented "Adjusting some state when a prop changes"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect), not the
  // effect-plus-setState round trip it exists to replace: an ESLint rule in this repo's
  // config (react-hooks/set-state-in-effect) already rejects that shape outright, and the
  // pattern below is the React team's own prescribed fix for it, not a workaround for the
  // lint rule alone. Calling `setState` during render is safe only while the gate can
  // actually close — which is exactly what the previous object-identity comparison could
  // not do: React re-runs the component after a render-phase update, that re-run produced
  // another fresh object, the gate re-opened, and create mode threw "Too many re-renders."
  // rather than ever committing a frame at all. Keyed on `sourceId`, the gate closes on the
  // second render and stays closed.
  //
  // `carried.typed` and `carried.cleared` go back in on every reseed: the seed decides the
  // VALUES and the marks, and the diver's own history of having touched or emptied a field
  // outlives any of them — see `SeedState.typed` and `SeedState.cleared`. `carried.fromSite`
  // and `carried.pairedNames` go back in for the same reason, one for the site and one for
  // §6's pair.
  //
  // **The gate still compares two scalars and must go on doing so** (§10): `sourceId` is a
  // string or null and `units` is a string, so both settle by value on the render after they
  // change. None of the collections is in it, and adding one would be the object-identity
  // comparison this gate was rewritten to stop being — a fresh `Set` every render, never equal
  // to the last, and "Too many re-renders." on mount.
  const [carried, setCarried] = useState<SeedState>(() => seedStateFor(mode, seedDive, units, initialStatus));
  if (carried.sourceId !== sourceId || carried.units !== units) {
    setCarried(
      seedStateFor(
        mode, seedDive, units, initialStatus,
        carried.typed, carried.cleared, carried.fromSite, carried.pairedNames, carried.fromWaterBody, carried.salinityPin,
      ),
    );
  }

  /**
   * The state above as the *last committed render* left it, for the one gesture that has to
   * read it **after an `await`** — §2.1's site defaults (`applySiteDefaults` below), whose
   * catalogue read sits between the diver's tap and the values it writes.
   *
   * The same "latest ref" `useForegroundReturn` (hooks/useForegroundReturn.ts) documents, and
   * here it is a correctness guard rather than a subscription convenience: what it protects is
   * `typed`, so a chip the diver pressed while the read was out is still theirs when the answer
   * lands. A closure over `carried` would hold the set as it was when they tapped the site row,
   * which is precisely the moment before the gesture that has to win.
   *
   * Written in an effect rather than in the render body, so nothing here can be read as a
   * render that depends on it: this is only ever read from an event handler, and every await it
   * sits behind resolves after a commit.
   */
  const carriedRef = useRef(carried);
  useEffect(() => {
    carriedRef.current = carried;
  });

  /**
   * The site the last pick answered with (#53), or `null` when the dive is unpaired or the
   * catalogue had nothing — what a water-body tap asks for the site's own salinity. Set only by
   * `applySiteDefaults`, so a site carry-over brought (never read, by design) counts as none.
   */
  const pairedSiteRef = useRef<SiteDefaults | null>(null);

  /**
   * The rows the diver touched since the last site pick began (#53). The pick reads its site
   * asynchronously, and a gesture made while that read is out is the latest one: the site's answer
   * must not override it, however it would override a value set before the pick.
   */
  const touchedSincePickRef = useRef<Set<string>>(new Set<string>());

  // §2.3's "your own history", out of the one read every screen uses — never a second query
  // (useDives.ts's own docblock, and this screen's for `dives` above).
  //
  // **The dive under edit is excluded, and that is a decision.** It is in `dives` like any
  // other, so without this it would suggest its own values back to the field they came from
  // — a row offering the diver what they are in the middle of replacing. Worse than useless,
  // in fact: being (usually) the most recent dive at that site, its spelling would also be
  // the one every OTHER dive's version of that name is shown under, and the dive being
  // rewritten is the wrong one to ask how a name is spelled. In create mode nothing is
  // excluded — the dive carry-over came from is exactly the history a diver reuses.
  //
  // **Planned dives count**, and deliberately: §2.4's whole point is setting up the coming
  // dives on the boat, so the site a diver queued up an hour ago is the site they are most
  // likely to type next. This is the opposite call from `carryOverSource` above, which takes
  // the most recent LOGGED dive — but that is one dive's values being copied wholesale,
  // where this is a name the diver typed themselves and may want again. Tombstoned dives are
  // already absent: `useDives()` never hands one back.
  const history = target === null ? dives : dives.filter((d) => d.id !== target.id);

  // §2.1's cylinder presets, from their own hook rather than a field on `useDives()` — see
  // db/useGearPresets.ts. **Its `error` is deliberately not read here**: the chip row is
  // absent when there are no presets, so a failed read draws exactly what a diver who has
  // never saved one sees, and a banner over the dive being logged — about a shortcut for
  // filling in a cylinder the diver can simply type — would be the failure that hook's own
  // docblock describes. §3's Settings list is where the error is worth showing.
  const { presets } = useGearPresets();

  const { control, handleSubmit, setValue, getValues, setFocus, formState } = useForm<DiveFormInput, unknown, DiveFormValues>({
    resolver: zodResolver(diveFormSchema),
    defaultValues: carried.values,
    // `values`, not a second `defaultValues`: react-hook-form only ever reads
    // `defaultValues` once, at construction, so a create-mode carry-over that resolves
    // AFTER this component's first render (`useDives()` starts empty — see
    // `initialFormValues`) would otherwise never reach the form at all. `values` is
    // react-hook-form's own mechanism for exactly this "the real default arrives
    // asynchronously" case: it re-syncs whenever this reference changes. Holding the values
    // in state above rather than recomputing them each render is what makes that reference
    // stable between real carry-over changes, so this re-syncs when the source dive
    // actually changes and not merely because `dives` was rebuilt.
    //
    // Both modes now, not create alone: edit mode reads the SAME asynchronous `useDives()`,
    // so a form opened on `/dive/<id>/edit` renders once before its dive exists, and
    // `defaultValues` (read once, at construction) would leave it showing a blank new-dive
    // form over a real dive forever.
    values: carried.values,
    // A field the diver has already typed into keeps what they typed rather than being
    // silently overwritten the moment the real carry-over data lands — only a field
    // nothing has touched yet is safe to re-sync.
    resetOptions: { keepDirtyValues: true },
  });

  /**
   * **Asking before a half-written dive is thrown away** (M3m, the owner: `‹ Cancel` and the
   * edge-swipe beside it both discarded a filled-in form without a word).
   *
   * *Delete dive* has been confirmed since M1d because it destroys something; abandoning a
   * dive being written destroys the same thing through a quieter door, and on a boat, one
   * thumb, that door is the easier one to lean on.
   *
   * **One listener, not one handler per control, because there is not one door.** `‹ Cancel`,
   * iOS' edge-swipe and Android's hardware back are three gestures that all end in a
   * navigation action removing this route, and `beforeRemove` is emitted — cancellably —
   * ahead of every one of them. A press handler bolted to `CancelControl` would have guarded
   * exactly the door a diver is least likely to hit by accident. So `CancelControl` is
   * untouched and `leaveScreen.ts` keeps owning *where* a departure lands; this owns *whether*
   * one happens.
   *
   * **`formState.isDirty`, and it has to be react-hook-form's own.** The form is re-seeded
   * from carry-over through `values` after `useDives()` resolves (see `useForm` above), which
   * is why `resetOptions: { keepDirtyValues: true }` is set: a hand-rolled "is this different
   * from the previous dive" comparison would count §2.1's prefill as the diver's work and ask
   * every dive after the first to be discarded on the way out, having had nothing typed into
   * it. That is the failure that would make the guard worse than its absence — a question
   * asked so often it is answered without reading — and it has its own test.
   *
   * **`leavingRef` is what stops the guard firing on its own success.** A saved dive leaves
   * through `backToDives()` at the exact moment the form is dirtiest, and asking whether to
   * discard the dive that was just written is the guard misreading a completed act as an
   * abandoned one. A ref rather than state, and read inside the listener: this is the event
   * handler case `onValid`'s own `savingRef` records, where `current` is the only value that
   * means anything.
   *
   * The confirmation itself goes to `confirmDestructive` (platform/confirmDestructive.ts) —
   * §10's rule that the destructive weight belongs to chrome the app does not draw, which is
   * why this screen shows no in-app modal and `‹ Cancel` stays the muted label it is.
   */
  const leavingRef = useRef(false);
  const navigation = useNavigation();
  const canDiscard = formState.isDirty;
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      // Nothing to lose, or a departure this screen already decided on — let it through
      // untouched rather than asking a question with one honest answer.
      if (!canDiscard || leavingRef.current) return;
      event.preventDefault();
      confirmDestructive({
        title: mode === 'edit' ? t('form.discardEditTitle') : t('form.discardTitle'),
        body: mode === 'edit' ? t('form.discardEditBody') : t('form.discardBody'),
        confirmLabel: t('form.discardConfirm'),
        cancelLabel: t('form.discardCancel'),
        // The SAME action that was stopped, re-dispatched — so confirming a swipe-back swipes
        // back and confirming a Cancel cancels. Re-dispatching a hard-coded `backToDives()`
        // instead would collapse three gestures into one destination and send a diver who
        // deep-linked into the form somewhere they never asked to go.
        onConfirm: () => {
          leavingRef.current = true;
          navigation.dispatch(event.data.action);
        },
      });
    });
    return unsubscribe;
  }, [navigation, canDiscard, mode]);

  /**
   * **The half the listener above cannot do, and it took the device to find it.**
   *
   * `beforeRemove` guards every exit that goes through JS — `‹ Cancel` and Android's hardware
   * back — and iOS' edge-swipe is not one of them. The native stack pops the screen on the
   * gesture *before* JS is consulted, so `preventDefault` has nothing left to prevent: the
   * form asked "discard this dive?" and left anyway, the question hanging over the list it had
   * already returned to, with React Navigation's own error underneath — *"removed natively but
   * didn't get removed from JS state… not fully supported in native-stack."*
   *
   * So the gesture is switched off for exactly as long as there is something to lose, which is
   * React Navigation's documented answer for this stack. It is not a lesser fix: the promise
   * was that no exit discards a dive silently, and a gesture that does not fire discards
   * nothing. `‹ Cancel` remains, in the same place it has always been, and it asks.
   *
   * Off only while dirty, never for the screen's whole life: a diver who opened `+` and
   * changed their mind keeps every way out they normally have, because they have nothing to
   * lose by taking one.
   */
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !canDiscard });
  }, [navigation, canDiscard]);

  // The live value of §2.4's control, which the heading and the save's own label are the
  // other two views of. `useWatch` rather than `formState`/`getValues`: it subscribes this
  // component to that one field, so moving the control re-renders the heading and the
  // button with it — reading `getValues('status')` during render would produce the right
  // string once and then never change, which is the "says one thing, does another" defect
  // this whole control exists to end, reintroduced one layer down.
  /** The water body as the form holds it now — whether the Salinity row is drawn (#53). */
  const waterBodyNow = useWatch({ control, name: 'waterBody' });
  const chosenStatus: DiveStatus = useWatch({ control, name: 'status' }) === 'planned' ? 'planned' : 'logged';

  // The date the form currently holds, watched for the same reason `chosenStatus` above is:
  // the entry-time picker is seeded onto THIS dive's day (`DateTimeField`'s `day` prop), so
  // a diver who corrects the date before setting the time must get a picker that already
  // knows it. Read through `useWatch` rather than `getValues`, which would produce the right
  // day once and then never change.
  const watchedDate = useWatch({ control, name: 'date' });
  const chosenDate = typeof watchedDate === 'string' ? watchedDate : null;

  // Whether §2.2's cylinder row starts open — see `ControlledCylinderSpec` for the rule and
  // for why a summary's default is the mirror image of a group's.
  //
  // Read off the SEED (`carried.values`) rather than the live form values, so it cannot flip
  // to "collapsed" on the first digit of a size the diver is typing; and gated on `resolved`
  // (db/liveQuery.ts) rather than computed regardless, because create mode's first render
  // always precedes carry-over. Without that gate the row would render OPEN for a frame — a
  // form that always looked as though the diver had no cylinder — and then close the four
  // fields again the moment the previous dive's cylinder landed. Collapsed is the honest
  // answer while nothing is known: the common case is a carried cylinder, which needs no
  // correction at all, and the rare one (a first-ever dive) grows content rather than hiding
  // it.
  const cylinderSpecOpen = resolved && cylinderSpecText(carried.values.tanks, units) === null;

  // §2.2's "groups remember themselves", in four layers that must be applied in this order.
  //
  // `remembered` is the persisted half — which groups the diver last left open — and it lands
  // asynchronously like every other read on this screen. **The groups are drawn before it
  // arrives rather than held back for it**, which is the one place this screen deliberately
  // does NOT follow M1f's waiting frame, and the reason is what M1f's own rule turns on: every
  // case that frame exists for was a screen STATING something untrue about the dive ("Dive not
  // found." over a dive that was there, a blank form over a real one). A collapsed group states
  // nothing — the fields are there, unexpanded, which is a state the diver reaches by hand
  // every day — and withholding seven headers until a local settings row answers would move more
  // on screen than letting a remembered group open a frame late. The half that CAN be answered
  // with no read at all, "does this dive already have a value in there", is answered
  // immediately, and that is the half carry-over makes urgent.
  //
  // `toggled` is what the diver has done on THIS form, and it outranks both rules — including
  // closing a group the value rule wants open, which is the whole point of a control.
  //
  // **The groups that start open (M1i) are drawn open on that first frame too**, rather than
  // waiting for the memory to say whether the diver collapsed them. Both flashes are one frame
  // and one of them is rarer: a diver who has collapsed *Times & depth* sees it close, where
  // gating the default on `resolved` would open a group on every diver who has not. The rule is
  // the same one this paragraph already applies to the remembered half — correct late beats
  // moving more on screen.
  //
  // **The empty logbook is the fourth layer and it is a starting state too** (§2.2, M1i): with
  // no dives at all, every group opens. It is read off `dives` — the same `useDives()` call
  // carry-over already needs, never a second query — rather than off `carried.values`, because
  // the two are not the same question: a second dive whose predecessor recorded nothing holds
  // exactly what a first dive holds, and it must follow the ordinary rule. `dives` also answers
  // it correctly in edit mode without a branch, since a dive being edited is itself in the list.
  //
  // **Gated on `resolved`, unlike the two layers above**, and the asymmetry is deliberate:
  // `dives` is `[]` before the read answers, so an ungated condition would be true for one
  // frame for EVERY diver and then close five groups under all of them — the direction this
  // screen's own rule rejects. Gated, the only frame anyone sees wrong is the first-ever
  // diver's, and it grows content rather than hiding it, which is the same call
  // `cylinderSpecOpen` above makes in the same words.
  const { remembered, resolved: rememberedResolved } = useOpenFormGroups();
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const openByRule = defaultOpenGroups(carried.values, remembered, resolved && dives.length === 0);

  /**
   * A diver's press on a group header: shown at once, and written back so the next dive opens
   * the same way.
   *
   * **The write is the stored memory with EVERY toggle of this form applied**, not just this
   * one, and that is what makes two quick presses safe. A write composed from `remembered` plus
   * the single group just pressed would be computed from a row that the first write has not
   * landed in yet, so opening Conditions and then People would store People alone.
   *
   * **A collapse is written as `false`, not as an absence** (M1i), which is the half that makes
   * "open by default" survive a diver disagreeing with it: an id simply left out means *never
   * decided*, and the group would start open again on the next dive. That is what the old
   * set-of-open-ids could not say.
   *
   * **Nothing is written until the read has answered**, because `remembered` is `{}` until then
   * and `{}` is also what "the diver has never decided about any group" looks like — so an early
   * press would store a memory built on an answer nobody has, erasing whatever was really there.
   * The press still opens the group; only the memory of it is skipped, which costs one tap on
   * the next dive and cannot destroy anything.
   *
   * The write is fire-and-forget with its failure swallowed, deliberately, and it is the same
   * line `readOpenFormGroups` draws: §10's "a local save failure is shown to the diver" is about
   * a DIVE. A notice over the form a diver is filling in, about which groups will be open next
   * time, would be the failure `useGearPresets`' docblock describes — and §1 binds hardest here,
   * since nothing about a display preference may interrupt a save.
   */
  const toggleGroup = (id: FormGroupId, open: boolean) => {
    const next = new Map(toggled);
    next.set(id, open);
    setToggled(next);
    if (!rememberedResolved) return;
    const stored = { ...remembered };
    for (const [group, isOpen] of next) stored[group] = isOpen;
    void setOpenFormGroups(db, stored).catch(() => {});
  };

  /** One group's props, from `FORM_GROUPS`' own entry — so a group's title, its persisted id
   * and the fields §2.2's value rule reads cannot be three different opinions. */
  const groupProps = (id: FormGroupId) => ({
    title: t(FORM_GROUPS[id].titleKey),
    scheme,
    expanded: toggled.get(id) ?? openByRule.has(id),
    onToggle: (open: boolean) => toggleGroup(id, open),
  });

  // Shared by every field below rather than one closure per field, so there is exactly one
  // place that can get a field's own state transition wrong. Reads the LATEST state through a
  // functional updater rather than a value captured at render time — the same reasoning
  // `ReorderControls.tsx` documents for staying stateless.
  //
  // It does **three** things, and only the first is visible on the row it fires for.
  //
  // Dropping the mark is the visible half ("overwriting is just typing, and drops the chip",
  // §0.6). Recording the field in `typed` is the half that has to outlive the drop: this fires
  // on every keystroke, including keystrokes that land BEFORE `useDives()` has resolved and
  // therefore before there is any mark to drop — and when carry-over lands a moment later,
  // that is exactly the field a recomputed `computeCarriedPaths` would mark as carried, over
  // text the diver typed. It used to bail out early whenever `name` was not already marked,
  // which is the same condition, so the one case that needed recording was the one case it
  // skipped.
  //
  // **`emptied` is the third, and it is what tells the two gestures apart** (M1h). Both drop
  // the mark, and until §0.6 asked for a cleared state that was the whole of what either
  // needed to say. Now the difference is a sentence on screen: `true` puts the field in
  // `cleared` so its row reads `— cleared`, and `false` takes it back out, because a field the
  // diver has typed a value into is not empty and a tag saying it is would be a lie the save
  // is about to contradict. The false direction matters as much as the true one: clear a
  // carried buddy, change your mind, type a name — the tag has to go with the blank it
  // described.
  //
  // The early return moved rather than disappeared, and it now has to account for that third
  // fact too: only when a field is recorded, unmarked AND already on the right side of
  // `cleared` is there nothing left to change, so a second keystroke returns the same
  // reference and re-renders nothing. **It needs no fourth condition for `fromSite`**, and
  // that is an invariant rather than an oversight: a typed field is never one the site is
  // answering for (a pick that answers for a typed field releases it from `typed`, #53), so the
  // two sets cannot both hold `name`,
  // and the delete below is what keeps it that way from the other side.
  const noteTouched = useCallback((name: FieldPath<DiveFormInput>, emptied: boolean) => {
    setCarried((prev) => {
      if (prev.typed.has(name) && !prev.paths.has(name) && prev.cleared.has(name) === emptied) return prev;
      const paths = new Set(prev.paths);
      paths.delete(name);
      const typed = new Set(prev.typed);
      typed.add(name);
      const cleared = new Set(prev.cleared);
      if (emptied) cleared.add(name);
      else cleared.delete(name);
      // A value the diver typed over the catalogue's is theirs until they pick a site that knows
      // that row (#53: a site sets what it knows), or touch it again.
      const fromSite = new Set(prev.fromSite);
      fromSite.delete(name);
      const fromWaterBody = new Set(prev.fromWaterBody);
      fromWaterBody.delete(name);
      const salinityPin = name === 'salinity' ? undefined : prev.salinityPin;
      return { ...prev, paths, cleared, typed, fromSite, fromWaterBody, salinityPin };
    });
    touchedSincePickRef.current.add(name);
  }, []);

  /** The diver put a value in this field — typed it, picked it, applied a preset over it, or
   * chose a chip — or emptied a value of their own, which is an edit too. Drops the mark and any
   * cleared tag. */
  const dropCarried = useCallback(
    (name: FieldPath<DiveFormInput>) => noteTouched(name, false),
    [noteTouched],
  );

  /** The diver threw a carried value away — the clear control, or *No centre* over a carried
   * centre. Drops the mark and leaves §0.6's `— cleared` behind, which is the one thing that
   * distinguishes it from the gesture above landing on an already-empty field. */
  const clearCarried = useCallback(
    (name: FieldPath<DiveFormInput>) => noteTouched(name, true),
    [noteTouched],
  );

  // §0.6's carried treatment, bundled once and handed to every field row — see
  // `CarryOverControls` for why it is one prop and why it goes to fresh rows too. Rebuilt each
  // render, which costs nothing: these are plain props on components nothing memoises, and the
  // two sets inside it are the very values a re-render exists to deliver.
  /**
   * **The water body sets the salinity** (#53, the owner's call): the diver tapped, deselected or
   * cleared the water body, so the salinity follows it — salt behind a hidden row for the ocean;
   * the paired site's or the inherited salinity when it was for this same water; otherwise fresh,
   * *from the water body*. A salinity set by hand was about the water the dive was in before, so it
   * goes too. `salinityFor` owns the order; this owns the write and the marks.
   */
  const onWaterBodyPicked = useCallback(
    (previous: unknown, chosen: unknown) => {
      const word = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
      if (word(previous) === word(chosen)) return;
      const answer = salinityFor({
        waterBody: chosen,
        typed: undefined,
        site: pairedSiteRef.current,
        inherited: carriedRef.current.inherited,
      });
      setValue('salinity', answer.value, { shouldDirty: true });
      setCarried((prev) => {
        const typed = new Set(prev.typed);
        const cleared = new Set(prev.cleared);
        const paths = new Set(prev.paths);
        const fromSite = new Set(prev.fromSite);
        const fromWaterBody = new Set(prev.fromWaterBody);
        for (const set of [typed, cleared, paths, fromSite, fromWaterBody]) set.delete('salinity');
        if (answer.source === 'site') fromSite.add('salinity');
        else if (answer.source === 'waterBody') fromWaterBody.add('salinity');
        else if (answer.source === 'inherited' && mode === 'create' && hasCarriedValue(answer.value)) paths.add('salinity');
        return { ...prev, typed, cleared, paths, fromSite, fromWaterBody, salinityPin: answer.value };
      });
    },
    [mode, setValue],
  );

  const carryOver: CarryOverControls = {
    paths: carried.paths,
    cleared: carried.cleared,
    onDrop: dropCarried,
    onClear: clearCarried,
  };

  // The id half of DESIGN.md §6's `site_id` + `site_name` snapshot pair, moved by whatever
  // gesture last set the name: a pick's own id, or `null` when the diver emptied the row (the
  // ring, or *No centre*). Shared by the Site and Centre rows, like `dropCarried` above, so there
  // is one place that can get the pairing wrong rather than two.
  //
  // **`siteId` and `centerId` gain no visible row from this.** They are not fields a diver
  // types — §6 stores them as the app's half of a snapshot — so they are written straight
  // into the form through `setValue`, exactly as `blankFormValues` already seeds them.
  // `shouldDirty` is what keeps a picked id through a reseed, and the mechanism is narrower
  // than "the value differs from the seed": `resetOptions.keepDirtyValues` re-syncs every
  // field react-hook-form has not RECORDED in `dirtyFields`, so a value that merely differs
  // is overwritten like any other. `useDives()` can resolve after this gesture, and an id has
  // no `Controller` of its own to record one — a flagged `setValue` is the only thing that
  // ever can.
  //
  // **Two tests reach this flag, and only one of them can fail on it.** The pick writes the
  // name through the `Controller` straight after this, and a write that differs from the seed's
  // on a form this id has just made dirty makes react-hook-form re-derive the whole dirty set
  // from the values/seed diff instead of recording the one field — which sweeps this id in
  // behind it. So *keeps a picked paired id when carry-over resolves again afterwards* stays
  // green with this flag deleted. What pins it is *keeps both halves of the pair when a newer
  // dive lands on a picked name*: the name it picks is the one the seed already holds, so that
  // write is pristine, nothing re-derives, and this flag is the only thing holding the id.
  //
  // **The name half cannot be kept by a flag at all, and that is what `name` is here for.**
  // A gesture that spells the name the seed already holds records nothing — the write is
  // pristine, and the branch above is exactly what makes it so — while the id beside it is
  // recorded like any other differing value. A reseed then kept the id and re-synced the name,
  // and the dive was saved holding one site's id under another site's name (§10). So the name
  // this gesture pairs the id with goes into `SeedState.pairedNames`, which puts it back into
  // the seed instead of trying to defend it from one; `pinPairedNames` owns the substitution.
  // Clearing an id clears the pin in the same call, because a pair is what is being recorded
  // and half of one is nothing.
  //
  // `dropCarried` goes with it so the id leaves the carried set with its name. Nothing draws
  // a chip for an id today (`computeCarriedPaths` marks it, nothing reads that mark), but a
  // set that still called the id carried after the diver replaced it would be wrong in the
  // quiet way that only shows up the day something does read it.

  // Whether anyone is signed in — for the place rows' caption alone, which says *on this phone
  // only* under a guest's own unpublished row (issue #19). `session === null` rather than
  // `resolved`: a keychain that has not answered yet reads as a guest for a frame, which costs a
  // caption, never a gesture.
  const signedIn = useAuthSession().session !== null;

  /**
   * **One picker at a time, for both place rows.** A press on Site or Centre claims this; the form
   * being focused again — the picker closed, by any of its ways out — releases it. A ref rather
   * than state, because two taps can land before the re-render a state would need; one claim for
   * the screen rather than one per row, because a tap on Site and a tap on Centre before the page
   * has covered the form would otherwise stack two pickers. It lives on the screen rather than in
   * `navigation/placePick.ts`'s registry: a request the registry never heard forgotten would wedge
   * a lock there until reload, while focus always comes back.
   */
  const pickerOpenRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      pickerOpenRef.current = false;
    }, []),
  );

  /**
   * **What the *Choose a site / Choose a centre* page is told about this dive**, read at the
   * press so the chips and the pin the diver set a moment ago are in it.
   *
   * The pin, water and entry are `siteFactsFrom`'s answer (domain/diveFormSchema.ts) — §2.3's
   * one owner of what a dive may hand a new site, pin both-or-neither, values coerced the way the
   * save path coerces them — so the *New dive site* page prefills from exactly what that rule
   * allows and from nothing else. Its name half is not the picker's business (the page names the
   * row from what the diver typed into its search) and is dropped here. `pointOf` then answers
   * whether the pair is a place at all. `siteId` is the dive's paired site, which the centre
   * picker ranks centres near. `diveId` is this dive in edit mode, which the picker leaves out of
   * *Dived here* for the reason `history` below leaves it out of the form's own suggestions.
   *
   * A plain function: it is called on a press, and nothing holds on to its identity.
   */
  const diveContext = (): DiveContext => {
    const values = getValues();
    const { latitude, longitude, entry, salinity, waterBody } = siteFactsFrom(toInputString(values.siteName), values);
    const siteId = toInputString(values.siteId).trim();
    return {
      pin: pointOf({ latitude, longitude }),
      entry,
      salinity,
      waterBody,
      siteId: siteId === '' ? null : siteId,
      diveId: mode === 'edit' && diveId !== undefined ? diveId : null,
    };
  };

  /**
   * **DESIGN.md §2.1's site defaults, applied to the three rows §2.2 calls properties of the
   * place** — *"picking a site prefills entry, salinity, and water body from the site's own
   * defaults — and those win over carry-over when you switch sites"*, which M2r found had only
   * ever been built in the direction that fills the catalogue.
   *
   * `siteDefaultFills` (domain/siteDefaults.ts) owns the precedence and the whole of what a
   * `null` column means; this owns the three things that are the screen's — **when** it runs,
   * **which** site row it asks about, and what happens to §0.6's marks.
   *
   * ── When ─────────────────────────────────────────────────────────────────────────────────
   *
   * **On a diver's own gesture, never on a seeded id.** Carry-over brings a `siteId` across
   * with the name (`CARRIED_FIELDS`), and a rule that fired on the *presence* of an id would
   * re-decide those three rows on every new dive at a site the diver has dived before — the
   * site's generic answer overwriting the answer their own last dive at that very site gave,
   * which is worse evidence, not better. §2.1's sentence says *picking*, and this is wired to
   * the gesture that pairs a dive to a site — a pick on the *Site* row — rather than to the
   * field's value.
   *
   * **On a stored dive too, but only when the diver moves it** (#53, the owner's call). Opening a
   * stored dive never runs this: its three columns are the diver's record of the water they were
   * in, and the catalogue's later opinion is not a reason to rewrite them. Moving the dive to
   * another site is the diver saying where it was, so the site sets what it knows there as on a
   * new dive, with the stored values standing in for carry-over (and no carried marks, which edit
   * mode never shows).
   *
   * ── Which row ────────────────────────────────────────────────────────────────────────────
   *
   * `getDiveSite` (db/catalogue.ts), which applies `pickable` — live and `active`. So every
   * way of not having an answer collapses into one: never pulled, tombstoned, merged away or
   * hidden, all `null`, all meaning *the catalogue does not know*, and all leaving carry-over
   * to answer. **Following a merge is deliberately not done here**: M2r owns where a merged row
   * sends a dive, it does it on the pull that delivers the merge, and a second implementation
   * on this screen is the defect that report's own §8 warns whoever builds the merge screen
   * about. A pick can barely produce one anyway — the picker lists only `pickable` rows
   * (`diveSiteRowsQuery`).
   *
   * §1, *never block a save*: the read is a by-product, so a rejection is the same answer as a
   * row that says nothing rather than something the diver has to deal with (`pairedSite`).
   *
   * ── The marks ────────────────────────────────────────────────────────────────────────────
   *
   * §0.6's return mark says *this came from your last dive*, and it is dropped exactly where
   * that stops being true: on a row whose value the site replaced (`SiteDefaultFill.fromSite`),
   * and never on one where the site merely agrees with carry-over. That second half is what
   * makes creating a site from the picker (issue #19) leave this form exactly as it found it —
   * the *New dive site* page prefilled the row *from this dive* (`diveContext`, through
   * `siteFactsFrom`), so reading it back can only say what carry-over already said unless the
   * diver changed it there, and a rule keyed on "the site supplied a value" rather than on "the
   * site replaced one" would silently strip three marks for no change in value at all.
   *
   * **A site default gets no mark of its own, and that is the decision** rather than a gap; the
   * report for this task carries the argument. The short of it: the mark's legend names a dive
   * (`carriedFromLabel`) and one mark over two sources would stop that legend answering the
   * question it exists for, a second symbol is new vocabulary for one case, and this app
   * already fills several rows from a stored record on one tap and marks none of them —
   * `applyPreset`, below.
   *
   * ── The two races, which are one guard each ───────────────────────────────────────────────
   *
   * The read is asynchronous, so two things can happen between the tap and the answer. The
   * diver can pick a *second* site, and the first read's answer must not land on top of the
   * second's — hence the id check, which is against the form's own `siteId` rather than against
   * a token, because that field is the whole of what "which site is this dive at" means. And
   * the diver can touch one of the three rows, which is why `typed` is read from
   * `carriedRef` **after** the await: a chip pressed while the read was out is the diver's, and
   * a row the diver touches while the read is out is theirs (`touchedSincePickRef`, passed as
   * `keep`), however the site would override a value set before the pick.
   */
  const applySiteDefaults = useCallback(
    async (id: string | null) => {
      // Unpairing is the same rule with nothing in the site's tier, so it needs no branch of its
      // own — but there is nothing to recompute once no site is answering for anything, which is
      // the case whenever the ring empties a site carry-over brought. A narrowing, not a rule:
      // removing it writes the same values.
      if (id === null && carriedRef.current.fromSite.size === 0) {
        pairedSiteRef.current = null;
        return;
      }
      touchedSincePickRef.current = new Set<string>();
      const site = id === null ? null : await pairedSite(id);
      // The diver moved on while the read was out — picked another site, or emptied the row,
      // which is `siteId` back to null. Either way this answer is about a site the dive is no
      // longer at.
      if (toInputString(getValues('siteId')).trim() !== (id ?? '')) return;
      pairedSiteRef.current = site;
      const { typed, inherited } = carriedRef.current;
      // What the form holds NOW, read after the await: a water body tapped while the read was out
      // is the one the salinity has to follow (#53).
      const current: InheritedValues = {
        entry: getValues('entry'),
        salinity: getValues('salinity'),
        waterBody: getValues('waterBody'),
      };
      const { fills, released } = siteDefaultFills(site, inherited, typed, current, touchedSincePickRef.current);
      // `shouldDirty`, the same declaration `setPairedId` and `applyPreset` make: this write is
      // the gesture's, not the seed's, so `resetOptions.keepDirtyValues` must keep it when
      // `useDives()` or `useUnitSystem()` resolves underneath it.
      //
      // **The mutation that drops it left the suite green until this milestone, and that was a
      // hole in the suite rather than a flag doing nothing.** *keeps the site's answers when
      // carry-over resolves again afterwards* is the reseed nothing here used to perform: pick
      // a site whose entry and salinity differ from the carried ones, let a newer dive land,
      // and without the flag all three rows go back to carry-over's answers while the diver is
      // looking at the site they picked. `keepDirtyValues` does NOT preserve the union of the
      // fields it was told are dirty and the fields whose value merely differs from the
      // defaults: 7.87 keeps what is recorded in `dirtyFields` and nothing else — `setPairedId`
      // above names the re-derivation that reading was seeing.
      for (const fill of fills) setValue(fill.field, fill.value, { shouldDirty: true });
      setCarried((prev) => {
        const paths = new Set(prev.paths);
        const fromSite = new Set(prev.fromSite);
        const fromWaterBody = new Set(prev.fromWaterBody);
        const typedNow = new Set(prev.typed);
        const cleared = new Set(prev.cleared);
        // The diver's values this pick overrode (#53) are the site's now, and the next pick
        // reads them as it reads any other.
        for (const field of released) {
          typedNow.delete(field);
          cleared.delete(field);
        }
        for (const fill of fills) {
          fromSite.delete(fill.field);
          fromWaterBody.delete(fill.field);
          paths.delete(fill.field);
          if (fill.fromSite) fromSite.add(fill.field);
          else if (fill.fromWaterBody) fromWaterBody.add(fill.field);
          // Carry-over is answering again, so §0.6's mark is right again — and it is recomputed
          // from the value rather than restored from a memory of having been there, which is the
          // same expression `seedStateFor` uses and therefore cannot disagree with it about what
          // counts as a carried value. Never in edit mode, which shows no carried marks at all:
          // its "carry-over" is the dive's own stored value.
          else if (mode === 'create' && hasCarriedValue(fill.value)) paths.add(fill.field);
        }
        const salinityFill = fills.find((fill) => fill.field === 'salinity');
        const salinityPin = salinityFill === undefined ? prev.salinityPin : salinityFill.value;
        return { ...prev, paths, fromSite, fromWaterBody, typed: typedNow, cleared, salinityPin };
      });
    },
    [mode, getValues, setValue],
  );

  const setPairedId = useCallback(
    (field: SuggestedField, id: string | null, name: string) => {
      const idField = pairedIdField(field);
      // `buddy` and `guide` have no id column at all (§2.3: "they stay private text, not
      // user accounts"), so there is nothing to pair and nothing to clear.
      if (idField === null) return;
      setValue(idField, id, { shouldDirty: true });
      dropCarried(idField);
      setCarried((prev) => {
        const pairedNames = new Map(prev.pairedNames);
        // The name is the caller's rather than `getValues(field)`, because a pick sets the id
        // first and lets the `Controller` deliver the spelling after — so reading the form here
        // would capture the name the row held before the pick.
        //
        // **The unpairing half is honesty rather than a guard, and no test can falsify it.**
        // Every gesture that reaches here with a `null` id — the ring, *No centre* — writes `''`
        // through the `Controller` straight after, and a seed holds an absent name as `null`, so
        // the field is recorded and `keepDirtyValues` keeps the blank; a stale pin could never
        // win a reseed. It is deleted because a map that still claimed a pair the form no
        // longer holds would be wrong in the quiet way `dropCarried` above is deleted for.
        if (id === null) pairedNames.delete(field);
        else pairedNames.set(field, name);
        return { ...prev, pairedNames };
      });
      // **Only the site half**, and the asymmetry is §2.3's own, read backwards: a dive knows a
      // great deal about the site it happened at and nothing about the shop on shore, so a new
      // centre inherits its name alone and a centre has nothing to give back.
      if (idField === 'siteId') void applySiteDefaults(id);
    },
    [setValue, dropCarried, applySiteDefaults],
  );

  /**
   * §2.1's "apply the whole cylinders-and-gas block in one tap".
   *
   * **Converted on the way in** (`toDisplayTank`, diveFormSchema.ts — the same function this
   * form's own seeding goes through). A preset holds SI (§6) and this form holds the figures
   * the diver reads, so an imperial diver tapping "alu 80" must see `3365` under a `psi`
   * label, not `232`. The conversion has exactly one owner and this is one of its two
   * callers; a second one here would be the mislabelled-form defect arriving through a chip.
   *
   * **A typed pressure survives the tap.** A preset stores none (§10: "a preset that filled
   * in 200 bar would be inventing a reading"), so it has nothing to say about what is left in
   * the cylinder — and clearing a gauge reading the diver typed thirty seconds ago would be
   * the silent destruction of a diver-entered value that `withoutUndefinedFields`
   * (db/dives.ts) exists to prevent, arriving through a tap instead of through a patch. The
   * pressures are preserved **index-wise**, which is the pairing `toStoredTank` and
   * `sameTanks` already use for the same arrays: cylinder 1 is cylinder 1. Which two fields
   * those are is `TANK_PRESSURE_FIELDS` (domain/carryOver.ts), never a second copy of the
   * pair here.
   *
   * A preset holding no cylinders at all leaves the block blank, pressures included: the
   * repository allows such a row and §3's editor can make one, and there is no cylinder left
   * for a pressure to belong to. `EMPTY_TANK` rather than `[]`, on `initialFormValues`'s own
   * reasoning — this screen binds `tanks.0.*`, so an empty array would leave it SHOWING one
   * cylinder while HOLDING none.
   *
   * The mirror of that: a preset holding SEVERAL cylinders applies all of them, and this
   * form shows only the first, because "+ add cylinder" is not built yet (§6, and this
   * group's own note above). They are held and saved rather than dropped — a bottom mix and
   * a deco gas are what a multi-cylinder preset is FOR, and silently keeping only the first
   * would lose gas the diver deliberately named. The dive-form UI catches up when that
   * control lands; nothing here has to change for it.
   *
   * `shouldDirty` keeps the applied cylinders through a reseed, and unlike the two site
   * writes above it needs nothing else: `useDives()`/`useUnitSystem()` can resolve
   * after this tap, `tanks` is written whole through `setValue` rather than through the
   * cylinder rows' own `Controller`s, and `resetOptions.keepDirtyValues` re-syncs every field
   * react-hook-form has not recorded as dirty — a value that merely differs from the seed is
   * not kept (`setPairedId` above). Drop the flag and *keeps applied preset cylinders when
   * carry-over resolves again afterwards* goes red immediately, with no second write to mask
   * it.
   */
  const applyPreset = useCallback(
    (preset: GearPreset) => {
      const current = getValues('tanks') ?? [];
      const applied = preset.tanks.map((tank, index) => {
        // The same `Record` shape `toStoredTank` itself uses to write a field list into a
        // cylinder — a `Tank`'s fields have four different types, so a keyed write needs it.
        const filled = { ...toDisplayTank(tank, units) } as Record<string, unknown>;
        for (const field of TANK_PRESSURE_FIELDS) filled[field] = current[index]?.[field] ?? null;
        return filled as TankFormInput;
      });
      // What the tap actually wrote — which for a preset holding no cylinders is one blank
      // cylinder, not nothing. Named rather than inlined because the marks below have to be
      // dropped for exactly this, and reading `applied` there instead was the defect: it is
      // `[]` for a cylinderless preset, so the loop ran zero times over a block the same
      // statement had just emptied.
      const written = applied.length > 0 ? applied : [EMPTY_TANK];
      setValue('tanks', written, { shouldDirty: true });

      // §0.6: "overwriting is just typing, and drops the chip". A field the diver has just
      // filled from a preset did not come from their last dive any more, and an `×` still
      // offering to clear it would be offering to clear a value they chose — or, for the
      // blanked block, a value that is no longer there at all.
      //
      // Every field the preset actually wrote: normally every cylinder field except the two
      // pressures it preserved, and ALL of them for a cylinderless preset, which blanks the
      // pressures too because there is no cylinder left for one to belong to. Read off
      // `TANK_FIELDS`/`TANK_PRESSURE_FIELDS` rather than listed here, so a cylinder field
      // added later is covered the day it exists.
      //
      // The second arm drops nothing today, and that is a fact about a rule rather than a
      // coincidence: a carried pressure cannot exist, because `carryOverFrom` strips both
      // through this same `withoutPressures` (§2.1 makes them fresh every dive), which
      // `carryOver.test.ts`'s *carries the cylinder and its gas, but not its pressures* pins.
      // It is written conditionally anyway because the rule here is "drop the mark from every
      // field the tap WROTE", and for a blanked block that is all of them — a form of the
      // sentence that stays true if carry-over's own rule ever moves.
      const preserved: readonly string[] = applied.length > 0 ? TANK_PRESSURE_FIELDS : [];
      written.forEach((_tank, index) => {
        for (const field of TANK_FIELDS) {
          if (!preserved.includes(field)) dropCarried(`tanks.${index}.${field}`);
        }
      });
    },
    [getValues, setValue, units, dropCarried],
  );

  /**
   * Captures §2.1's other half: the cylinders already typed into this dive, stored as a named
   * preset. Returns the sentence to show, or `null` when the write went through — see
   * `PresetCapture`, which owns the reveal and shows the answer but decides none of it.
   *
   * **`units` is where the diver's figures stop being true of the data**, and this is the
   * defect this task was most likely to ship. The form holds `3365` in a field labelled
   * `psi`; §6 stores SI and nothing else, so a preset captured without the conversion is
   * stored in psi — and then applied, wrongly, to every later dive, converting a second time
   * on the way back in. `toStoredTanks` (diveFormSchema.ts) is the same owner `toNewDiveInput`
   * uses for a dive's cylinders, and it takes `units` as a required argument for the reason
   * that function's own docblock gives: a defaulted `'metric'` "would let a call site that
   * forgot it write feet into a metres column with nothing failing anywhere".
   *
   * **The pressures are not stripped here.** A preset keeps none (§10), and
   * `withoutPressures` (domain/carryOver.ts) owns that rule for the two callers that need it:
   * `presetRefusal`, which must judge the cylinders as they will BE — a block holding nothing
   * but a gauge reading looks full on screen and stores nothing at all — and
   * `createGearPreset`, which stores them. A third call here changed nothing observable while
   * its docblock claimed otherwise.
   */
  const savePreset = useCallback(
    async (name: string): Promise<string | null> => {
      const tanks = toStoredTanks(getValues('tanks'), units);
      // `presetRefusal` (domain/presets.ts) decides WHAT is wrong; this decides where to say
      // it. Asked of the live list this screen is already showing, so the answer is the one
      // the diver is looking at, with no second read and no race against their own render.
      const refusal = presetRefusal(presets, name, tanks);
      // One `FieldNote` under one row, so one sentence — and the cylinders come first,
      // deliberately: with nothing to store, what the preset is called is not the diver's
      // problem yet. §3's editor has two slots and shows both; that difference is about where
      // each screen can speak, not about what is wrong.
      if (refusal.refused) return refusal.cylinders ?? refusal.name;
      try {
        await createGearPreset(db, { name: refusal.storedName, tanks });
        return null;
      } catch {
        return presetSaveFailed();
      }
    },
    [getValues, units, presets],
  );

  // Non-null only while a save attempt has failed and not yet been retried — cleared at
  // the START of the next attempt (below), never on a timer or a dismiss tap, so it
  // reads as "still true" for exactly as long as it still is.
  const [saveError, setSaveError] = useState<string | null>(null);

  // DESIGN.md §10's in-flight save guard, in two halves that must not be confused with each
  // other. `savingRef` is the guard: written and read synchronously inside `onValid`, so the
  // second tap of a double-tap is turned away before it can reach `createDive`. `saving` is
  // only how that state is SHOWN — a render-visible flag for the control's `disabled` and
  // `accessibilityState`, which by definition lags at least one render behind the ref and
  // therefore could never have enforced anything on its own.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const onValid = async (values: DiveFormValues) => {
    // The latch, not `saving` below: both taps of a double-tap reach here through
    // `handleSubmit`'s own async resolver before React has rendered anything, so a state
    // flag read at render time is still `false` for the second one. A ref is written and
    // read synchronously, which is the only thing fast enough to turn the second tap away.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'edit') {
        // Nothing to write to. Told, not swallowed, and above all not turned into a
        // `createDive` — see missingDiveMessage.
        if (target === null) {
          setSaveError(missingDiveMessage());
          return;
        }
        // Only what changed (`toDivePatch`), never the whole row: an untouched field must
        // stay untouched, and a field the diver emptied must be cleared — two different
        // instructions the repository tells apart by `undefined` versus `null`.
        //
        // **`status` is in that diff and gets no special case here.** This is where
        // `if (target.status === 'planned') patch.status = 'logged'` used to sit, and it
        // was wrong in the plainest way: found by using the app, a planned dive whose site
        // name the diver came back to correct was silently logged by the save. §2.4's
        // control is a form field now, so the patch names `status` exactly when the diver
        // moved that control and never otherwise — completing a dive is a deliberate act,
        // not a side effect of opening its form.
        // `units` is what the figures in front of the diver mean; `toDivePatch` converts
        // each back to SI before diffing it against the stored dive, so an untouched field
        // produces no patch entry at all rather than a re-quantised one. See that
        // function's own docblock — this is the one call that would silently rewrite every
        // imperial diver's stored depths if the argument were dropped.
        const patch = toDivePatch(target, values, units);
        await updateDive(db, target.id, patch);
      } else {
        await createDive(db, toNewDiveInput(oceanIsSalt(values), units));
      }
      // Set before leaving, and this is the whole of what M3m's discard guard needs from the
      // save: the form is at its dirtiest right now, and without this the guard would meet a
      // dirty form on the way out and ask whether to throw away the dive it has just written.
      // See the guard's own docblock for why the flag is a ref.
      leavingRef.current = true;
      // `backToDives` (navigation/leaveScreen.ts), not a private copy of its guard: this
      // screen is reachable directly by URL exactly as DiveDetailScreen is, and a diver who
      // deep-linked into the form and saved must land on the list rather than sitting on a
      // form that has already been written.
      backToDives();
    } catch {
      setSaveError(saveErrorMessage());
    } finally {
      // Released on both paths. A failed save that left the control latched shut would
      // strand the diver on a form they cannot resubmit — the same "told nothing, can do
      // nothing" dead end §1 exists to prevent, arrived at from the opposite direction.
      savingRef.current = false;
      setSaving(false);
    }
  };

  // What this form is, from the one owner of that string (`headingFor`). Not read by the waiting
  // frame below, which has nothing to ask it with — see that branch.
  const heading = headingFor(mode, target?.status ?? null, chosenStatus);

  // **Edit mode draws no fields until the dives read has answered** (M1f). Until it does,
  // `target` is `null` — and `null` meant "no such dive" and "not read yet" at once, so edit
  // mode seeded from `blankFormValues()` and drew thirty empty rows asserting that this dive
  // has no site, no depth and no duration. A false statement, made every time the screen
  // opened, corrected a render later; the same defect `DiveDetailScreen` showed as "Dive not
  // found." and this screen shows as a form. §7's sync makes the first read slower, which
  // makes the window this is visible in longer, not shorter.
  //
  // **Create mode never waits, and the `mode` check is the point of this line rather than a
  // detail of it.** A new dive's blank form is the honest one — there is no dive for it to be
  // blank ABOUT — and it is the app's most-used gesture (§2.2's "log a dive in under a
  // minute"). Carry-over arriving late is a FILL, handled by `keepDirtyValues`, not the
  // correction of a claim.
  //
  // What is drawn instead is this screen's frame: the way out, which is the one thing that is
  // true before anything has been read. It keeps its exact position when the fields arrive
  // under it — same root, same `‹ Cancel`, same scroll — so this is a frame filling in rather
  // than a screen replacing itself. The save control is deliberately absent: §1's "never block
  // a save" binds a control that refuses what a diver typed, and there is nothing typed and no
  // dive to write it to. What happens once the answer IS in is untouched, in both directions —
  // a real dive seeds and saves as before, and a dive that genuinely is not there still gets
  // today's blank form and `missingDiveMessage` on save, which is the direction that must
  // never loosen.
  //
  // **The heading is withheld too, and it was the last claim this branch made** (M1g). It read
  // "Edit dive" over a dive that might be a plan: `headingFor` answers from the dive's STORED
  // status, which is the very thing that has not been read yet, so with `target` still `null` it
  // was told "logged" and said so. Not a regression — it read the same before this frame existed
  // — but it is the one sentence left inside the code that exists so a screen with no answer
  // does not state one, and the correction it made a render later ("Edit plan") is the visible
  // proof it had been guessing.
  //
  // Silence rather than a fifth string, because `DiveDetailScreen` and `GearPresetScreen` both
  // answer "no answer yet" exactly this way — the frame, the way out, and nothing said — and a
  // third screen inventing a word for it would be three vocabularies for one fact (§4.1). A
  // neutral "Edit" was the alternative and it fails on its own terms: `headingFor` exists to
  // make the heading say what the save will do, and this frame has no save. §0.6's way out is
  // rendered here exactly as it is on both of those screens, so the frame still reads as a
  // screen and not as a failure.
  if (mode === 'edit' && !resolved) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <CancelControl styles={styles} />
        {/* Empty, and still here: it is the same scroll the fields mount into, so nothing that
            is on screen moves when they do. No `formHeadingRow` inside it — that row exists to
            carry the heading and §2.4's `StatusControl`, and neither can be shown from a dive
            nobody has read: the control would be sitting on a status read off nothing, and a
            diver who moved it in that moment would be moving a guess. */}
        <ScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} />
      </View>
    );
  }

  return (
    // The top clearance is the device's (`screenTopInset`, theme/styles.ts), the same owner
    // every other screen's root asks; `insets` is already read here for the footer's bottom
    // clearance below. `‹ Cancel` beneath this moves down ~14 pt on an island phone as a
    // result — the correction, not a regression: this container used to start INSIDE the
    // safe area, and the control's own 48 dp tap floor (§0.5) disguised most of it.
    //
    // **A `KeyboardAvoidingView`, and the footer below is what it exists to lift** (M3m,
    // found by the owner using the form). §0.5 puts the primary action in the bottom third,
    // and every number on this form takes a `decimal-pad` — which on iOS has no return key at
    // all — so with the keyboard up *Save dive* was not merely low, it was **behind the
    // keyboard**, and there was no key on that keyboard to put it away. The diver's only exit
    // was to find a blank strip of form to tap.
    //
    // Nothing else had to move, and that is the point: `formFooter` is already an in-flow
    // sibling BELOW `formScroll` rather than an absolutely positioned overlay, which is
    // exactly the shape a lift needs — `searchDock` (theme/styles.ts) records that
    // arrangement one screen over and names this footer as making "the same composition, for
    // the same reason". This is the wrapper that comment was assuming.
    //
    // `padding` on iOS and `height` on Android is RN's own documented pairing and the same
    // pair `SearchScreen.tsx` passes: on Android the window itself resizes, so `padding`
    // would count the keyboard twice.
    //
    // **Known cost, inherited deliberately rather than solved twice**: the footer's
    // `insets.bottom + 24` clears a home indicator, and while the keyboard is up that
    // indicator is behind the keyboard — so the button floats ~34 pt higher off the keyboard
    // than it needs to on an island phone. `searchDock` already spends the same padding for
    // the same reason, and one answer that is slightly generous beats two answers that
    // disagree (§4.1).
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <CancelControl styles={styles} />
      {/* The return key walks the form in `FORM_FIELD_ORDER`, through react-hook-form's own
          `setFocus`; past the last text field on screen it puts the keyboard away. And the
          scroll keeps whichever field is focused — its suggestion list included — in the part
          of the form the keyboard leaves visible (2026-11-14, both found on a phone; see
          components/FocusChain.tsx and components/FormReveal.tsx). */}
      <FocusChainProvider order={FORM_FIELD_ORDER} focus={(name) => setFocus(name as FieldPath<DiveFormInput>)} onEnd={Keyboard.dismiss}>
      <RevealingScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
        {/* The header row (§2.4): what this form is, and the control that decides it. The
            heading is `headingFor`'s alone — it reads what the SAVE will do, from the
            control's live value and the dive's stored status together, so it can no longer
            promise to complete a dive the save is going to leave planned. Reached only once the
            dives read has answered (the branch above), so a `null` stored status here means
            create mode or a dive that genuinely is not in the logbook — never "not looked
            yet". */}
        <View style={styles.formHeadingRow}>
          <Text style={styles.formHeading}>{heading}</Text>
          <StatusControl control={control} scheme={scheme} />
        </View>

        {/* §0.6's carried caption — see `carriedFromLabel` for why it exists, why it is not a
            control, and what the two forms of its sentence are for.

            **Drawn only while a mark is actually on screen, and gated on nothing else.**
            `paths` empties as the diver types over or clears each carried field, so the legend
            leaves with the last mark it describes rather than standing over a form with nothing
            to explain — and it never appears at all in edit mode, on a first-ever dive, or
            before `useDives()` has resolved, because in each of those `paths` is empty for a
            reason of its own. Edit mode's is `seedStateFor`'s (that branch marks nothing, ever),
            which is why there is no `mode` check here: this line had one, deleting it changed no
            test, and reading the mechanism says why — it was a second statement of a rule
            `seedStateFor` already owns, unreachable and therefore undefendable. §4.1 and §10
            agree about what to do with that.

            It is `hasVisibleCarryOver` rather than `paths.size > 0`, and that is not a
            refinement: `equipment` is non-nullable and an empty set counts as carried, so every
            previous dive that has ever existed puts a path in that set and the plain size
            check would make this line permanent. See `CARRIED_WITHOUT_A_MARK`. */}
        {hasVisibleCarryOver(carried.paths) && (
          <View style={styles.formCarriedNote}>
            {/* 12 rather than a field row's 16: the mark keeps the same relationship to the
                line it sits on that it has beside a 15 px label — a shade larger than the
                text, never large enough to become the loudest thing on the row. */}
            <CarriedMark scheme={scheme} size={12} />
            <Text style={styles.formCarriedNoteText}>
              {carriedFromLabel(carried.sourceId === null ? undefined : numbers.get(carried.sourceId))}
            </Text>
          </View>
        )}

        {/* Core strip (§2.2) — date, site and centre, always visible.

            **What identifies a dive rather than what measures it** (M1i, the owner's call after
            using the form). The strip held five fields, then eight, and the eight were a real
            answer to a real complaint — *time in* and both pressures were behind a collapse, so
            surface interval had its only input hidden — that fixed it by flattening structure
            which was doing work. The measurements went back to their groups, and the groups that
            hold them start open (`FormGroupSpec.startsOpen`), so nothing is hidden and a diver
            who never fills one can collapse it once.

            Each field lives in exactly ONE of the strip and the groups, here as everywhere: a
            field rendered twice would give one value two `Controller`s and two carried marks,
            and the one the diver did not scroll to would look empty. */}
        <View style={styles.formCoreStrip}>
          {/* A picker, not a text field (§10, M1d): `date` carried this form's only
              blocking rule, so a mistyped one was the single thing that could refuse a save
              — and a control that cannot produce `31.8.2026` removes that case rather than
              adjudicating it. Required (§2.2), so no `optional`, and therefore no `×`. */}
          <ControlledDateTimeField control={control} name="date" label={t('field.date')} mode="date" scheme={scheme} />
          {/* Chosen on a page of their own rather than typed (issue #19): each row opens *Choose
              a site* / *Choose a centre*, and the pick comes back through `setPairedId`, the one
              path that sets §6's pair and §2.1's site defaults. */}
          <ControlledPlaceField
            control={control}
            name="siteName"
            label={t('field.site')}
            scheme={scheme}
            carryOver={carryOver}
            onPairedId={setPairedId}
            diveContext={diveContext}
            signedIn={signedIn}
            pickerOpenRef={pickerOpenRef}
          />
          <ControlledPlaceField
            control={control}
            name="centerName"
            label={t('field.centre')}
            scheme={scheme}
            carryOver={carryOver}
            onPairedId={setPairedId}
            diveContext={diveContext}
            signedIn={signedIn}
            pickerOpenRef={pickerOpenRef}
          />
        </View>

        {/* §2.2's four measurements, in the order it names them — the two depths together, then
            how long and when. Open by default (`FORM_GROUPS.times.startsOpen`), so the diver who
            fills them on every dive fills them without a gesture, and collapsible for the diver
            who does not. */}
        <FormGroup {...groupProps('times')}>
          <ControlledTextField
            control={control}
            carryOver={carryOver}
            name="maxDepthM"
            label={t('field.maxDepth')}
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit={unitLabel('depth', units)}
            // Issue #6's figure glyphs: the two depths say which depth they are with a drawing as
            // well as a word, in the label's own muted ink (§0.6). Neither is ever a curve (§0.4).
            leading={<DepthGlyph depth="max" scheme={scheme} />}
          />
          <ControlledTextField
            control={control}
            carryOver={carryOver}
            name="avgDepthM"
            label={t('field.avgDepth')}
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit={unitLabel('depth', units)}
            leading={<DepthGlyph depth="avg" scheme={scheme} />}
          />
          <ControlledTextField
            control={control}
            carryOver={carryOver}
            name="durationMin"
            label={t('field.duration')}
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            // A literal, where every unit-bearing field beside it reads `unitLabel(...)`:
            // duration has no pair (§3 lists four, format/units.ts says why), and a dive is
            // 47 minutes long wherever it is dived.
            unit="min"
          />
          {/* A picker rather than a text field, for a quieter version of the defect the date
              carries (§10, M1d): a typo in a typed `HH:MM` never blocked a save, it silently
              dropped the dive out of §2.5's time-ordering and voided its surface interval.
              `optional`, because `timeIn` stays `optionalText` — a diver who did not note an
              entry time saves without one.

              **It is the ENTRY time**, which the name has been asked about: `timeOut` is
              computed from this plus duration (derived.ts) and gets no control at all, and
              §2.1's surface interval runs from one dive's end to the next one's start. §0.6
              marks both as computed rather than asking for them. */}
          <ControlledDateTimeField control={control} name="timeIn" label={t('field.timeIn')} mode="time" scheme={scheme} optional day={chosenDate} />
        </FormGroup>

        {/* DESIGN.md §6: the form shows a single cylinder until "+ add cylinder" is
            tapped. That control is not built yet — nothing in M1d's seven tasks asks for
            it — so this group binds directly to `tanks.0.*` for now; a real "+ add
            cylinder" needs `useFieldArray` and is a reasonable follow-up, not a silent
            gap: `tanks` still submits as `[EMPTY_TANK]` rather than `[]` when the diver
            never opens this group, which is harmless (derived.ts skips a cylinder whose
            sizeL is null; only 0 is contradictory) but not byte-identical to "no
            cylinders recorded" either. */}
        <FormGroup {...groupProps('gas')}>
          {/* §2.1's presets, at the top of the group they fill — and absent entirely when
              the diver has none, so a first-time diver sees nothing new. */}
          <PresetChips presets={presets} onApply={applyPreset} scheme={scheme} />
          {/* §10's snapshot ruling, as the diver meets it: the dive keeps its own full copy of
              the spec, and the four fields that make it up are shown as one line until the
              diver wants to correct them on this dive. **Not one field fewer than before** —
              a snapshot nobody can amend is not a snapshot — and the two per-dive facts, the
              gas and the pressures below, stay directly editable because they are not part of
              what kind of cylinder this is. (It read "the pressures now in the core strip"
              until this pass — they came back down here when the strip shrank, and this
              sentence went on pointing at the strip for a milestone.) */}
          <ControlledCylinderSpec control={control} units={units} defaultExpanded={cylinderSpecOpen} scheme={scheme}>
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="tanks.0.material"
            label={t('field.material')}
            options={TANK_MATERIAL_VALUES}
            displayLabel={(option) => formatTankMaterial(option) ?? option}
            scheme={scheme}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.sizeL"
            label={t('field.size')}
            scheme={scheme}
            keyboardType="decimal-pad"
            carryOver={carryOver}
            mono
            // Lower-case `l`, where the placeholder here used to read `L`: §0.6 asks for the
            // unit "exactly as `12.2 m` reads on the detail", and `formatVolume`
            // (format/display.ts) — the one owner of that string — prints `12 l`. The unit is
            // drawn beside the figure now rather than only inside an empty box, so the two
            // spellings would have sat one screen apart on the same cylinder. If `L` is the
            // wanted spelling it belongs in that formatter, where both screens read it.
            //
            // Still a literal after §3's unit setting landed, deliberately: the imperial
            // cylinder unit is the cubic foot, which measures free gas at working pressure
            // rather than the water capacity litres measure, so it is a different quantity
            // and not a conversion (format/units.ts).
            unit="l"
          />
          {/* The rig, where a numeric `Count` field sat until M1h. §10: a cylinder is steel
              or alu and a rig is single, twinset or sidemount — two facts, and the count is
              derived from the second (`cylinderCount`, domain/types.ts), so nobody types a
              count any more. That also retires the whole fractional-count hazard the old
              field carried: chips cannot produce `1.5`, so nothing here has to defend a gas
              figure against a keypad separator. */}
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="tanks.0.configuration"
            label={t('field.configuration')}
            options={CONFIGURATION_VALUES}
            displayLabel={(option) => formatConfiguration(option) ?? option}
            scheme={scheme}
            layout="tiles"
            icon={drawnIcon('configuration')}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.workingBar"
            label={t('field.workingPressure')}
            scheme={scheme}
            keyboardType="decimal-pad"
            carryOver={carryOver}
            mono
            unit={unitLabel('pressure', units)}
          />
          </ControlledCylinderSpec>
          {/* `O2 %` and `He %` until M1d's closing fixes: the same two fields the detail
              screen labels `O₂` and `He`, so one cylinder read two ways one screen apart —
              the same defect `formatTankMaterial`'s own docblock records for "Steel"/"steel".
              The label is the shared constant now and the `%` has moved onto the value as
              `unit`, where every other numeric field on this form already keeps its unit
              (`Size` `l`, `Working pressure` `bar`). `O2_LABEL` (format/display.ts) carries
              the whole decision. */}
          <ControlledTextField
            control={control}
            name="tanks.0.o2Pct"
            label={O2_LABEL}
            scheme={scheme}
            keyboardType="decimal-pad"
            carryOver={carryOver}
            mono
            unit="%"
          />
          <ControlledTextField
            control={control}
            name="tanks.0.hePct"
            label={HE_LABEL}
            scheme={scheme}
            keyboardType="decimal-pad"
            carryOver={carryOver}
            mono
            unit="%"
          />
          {/* **The two pressures, back beside the cylinder they were read off** (M1i). They sat
              here until M1h moved them into the core strip, on the complaint that a diver fills
              both on every dive and had to open a group to do it — which was true, and is
              answered now by the group opening itself rather than by the fields leaving it.

              They belong to a cylinder in the same sense its size does: a pressure is a number
              off *that* gauge, and this is the group where the cylinder summary row already
              lives. They sit outside `ControlledCylinderSpec` above, with the gas fractions,
              because that row holds what KIND of cylinder this is — the snapshot §10 rules on —
              and a pressure is a fact about this dive rather than about the cylinder.

              **`tanks.0` and not "the cylinder", deliberately, and this is what keeps §6's
              still-unbuilt "+ add cylinder" closable.** The whole form is single-cylinder today;
              the day that control lands, each cylinder's own pressures belong beside the
              cylinder they describe, where a bottom mix and a deco stage can be told apart —
              which is where they now already are. */}
          <ControlledTextField
            control={control}
            carryOver={carryOver}
            name="tanks.0.startBar"
            label={t('field.startPressure')}
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit={unitLabel('pressure', units)}
          />
          <ControlledTextField
            control={control}
            carryOver={carryOver}
            name="tanks.0.endBar"
            label={t('field.endPressure')}
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit={unitLabel('pressure', units)}
          />
          {/* And capturing one, at the END of the group — the position `Delete dive` occupies
              on the detail screen, for the same reason it does there: a deliberate act, not
              part of the flow down the fields. */}
          <ControlledPresetCapture control={control} presets={presets} units={units} onSave={savePreset} scheme={scheme} />
        </FormGroup>

        {/* What the day was like, and nothing else (M1i, the owner's call — §2.2). *Entry*,
            *salinity* and *water body* sat in here and are not conditions; they are below, in
            a group of their own. */}
        <FormGroup {...groupProps('conditions')}>
          {/* **Weather leads** (M1i): it is the first thing anyone notices about a dive day,
              and it was the last row of this group. */}
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="weather"
            label={t('field.weather')}
            options={WEATHER_VALUES}
            displayLabel={(option) => formatWeather(option) ?? option}
            scheme={scheme}
            layout="tiles"
            icon={drawnIcon('weather')}
          />
          <ControlledTextField
            control={control}
            carryOver={carryOver}
            name="waterTempC"
            label={t('field.waterTemp')}
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit={unitLabel('temperature', units)}
          />
          <ControlledTextField control={control} carryOver={carryOver} name="airTempC" label={t('field.airTemp')} scheme={scheme} keyboardType="decimal-pad" mono unit={unitLabel('temperature', units)} />
          {/* Two visibility fields, deliberately (§10): nobody measures visibility, so the
              scale is the primary and the distance is an optional refinement for divers who
              estimate one. They carry two different labels because two rows both reading
              "Visibility" would be unreadable in a column and identical to a screen reader —
              the same pair of labels `DiveDetailScreen`'s `conditionsFields` uses, so one
              subject reads the same way on both screens.

              **`Visibility distance` was re-examined in M1h and kept**, which is worth
              recording because it reads as clumsy and the clumsiness is the point. It is the
              only wording available that survives being read ALONE: a row labelled `Distance`
              means what it means only because a Visibility row happens to sit above it, which
              is the same "half a phrase" objection that moved `partly` out of `WEATHER_VALUES`
              this milestone, and a screen reader reaches this row without the one above it.
              Nothing shorter is honest, and the label lives on two screens, so a change costs a
              matched edit for a word that would still say less. `Weights`/`Weighting` is the
              same pair one group down and reads no better. */}
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="visibility"
            label={t('field.visibility')}
            options={VISIBILITY_VALUES}
            displayLabel={(option) => formatVisibility(option) ?? option}
            scheme={scheme}
          />
          <ControlledTextField
            control={control}
            carryOver={carryOver}
            name="visibilityM"
            label={t('field.visibilityDistance')}
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit={unitLabel('depth', units)}
          />
          {/* The three 0–3 scales, as chips rather than as `0-3` text boxes (M1h, the owner:
              "No one will write numbers there, we should provide chips to choose from"). The
              vocabulary is `CONDITION_SCALE_VALUES` — one list for all three, since the levels
              are one fact — and the words are display.ts's, since level 0 is *Flat* water but
              *no* current.

              **None of the three carries a mark, and neither does Visibility or Weather**
              (M1i, the owner's call, §10). They did: counted arrows, counting bars, SF
              Symbols' own skies, and they satisfied §0.6's no-legend test rather than waiving
              it. Two measured costs took them out anyway — *Current* and *Surge* wrapped to a
              second line because of them, and one bar beside *Visibility low* read as
              punctuation. §9's shelf carries what replaces them: a set drawn for this app,
              with `Entry`'s shore and boat as the standard it has to beat. This is not a row
              waiting to be finished one glyph at a time. */}
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="waves"
            label={t('field.waves')}
            options={CONDITION_SCALE_VALUES}
            displayLabel={(level) => formatWaves(level) ?? String(level)}
            scheme={scheme}
            layout="tiles"
            columns={4}
            icon={drawnIcon('waves')}
          />
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="current"
            label={t('field.current')}
            options={CONDITION_SCALE_VALUES}
            displayLabel={(level) => formatCurrent(level) ?? String(level)}
            scheme={scheme}
          />
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="surge"
            label={t('field.surge')}
            options={CONDITION_SCALE_VALUES}
            displayLabel={(level) => formatSurge(level) ?? String(level)}
            scheme={scheme}
          />
        </FormGroup>

        {/* §2.2's *Water & entry* (M1i, the owner's call): where you are, which *Conditions*
            was answering by accident. All three are properties of the PLACE — §2.1 prefills
            them from the site's own defaults and carries them from the previous dive — so
            they are touched about once a trip and sit below the group a diver actually fills
            on every dive.

            **The GPS row is last, and it is the only one here that is not carried** (M2l).
            The three above it come from the site and from the previous dive; a pin is fresh
            every dive (§2.1) and taken on the spot, so it sits at the end of the group where
            a diver reaches for it deliberately rather than passing it on the way down. It is
            what M1i's two coordinate keypads were removed in favour of — §2.3 has named this
            affordance since before any of this was built. */}
        <FormGroup {...groupProps('water')}>
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="entry"
            label={t('field.entry')}
            options={ENTRY_VALUES}
            displayLabel={(option) => formatEntry(option) ?? option}
            scheme={scheme}
            // A tile row since issue #6, with Ponor's own drawings in place of the SF Symbols
            // `EntryIcon` used to fetch. `drawnIcon` owns which values have one (*other* does
            // not), so this call site does not repeat that judgement.
            layout="tiles"
            icon={drawnIcon('entry')}
          />
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="waterBody"
            label={t('field.waterBody')}
            options={WATER_BODY_VALUES}
            displayLabel={(option) => formatWaterBody(option) ?? option}
            scheme={scheme}
            layout="tiles"
            icon={drawnIcon('waterBody')}
            onPicked={onWaterBodyPicked}
          />
          {/* **Salinity after the water body, and not at all for the ocean** (#53, the owner's
              call): the water body sets the salinity, so the answer sits under the question that
              decides it. The ocean's is salt and nothing to ask — the value is still the form's,
              written by `onWaterBodyPicked` or the seed, and a new dive is saved salt whatever it
              holds (`oceanIsSalt`). Any other water body shows the
              row, with *from the water body* at its end while the rule is what chose it. */}
          {waterBodyNow !== 'ocean' && (
            <ControlledOptionField
              control={control}
              carryOver={carryOver}
              name="salinity"
              label={t('field.salinity')}
              options={SALINITY_VALUES}
              displayLabel={(option) => formatSalinity(option) ?? option}
              scheme={scheme}
              caption={carried.fromWaterBody.has('salinity') ? t('field.fromWaterBody') : undefined}
            />
          )}
          {/* No `carryOver` prop, and that is the one call site on this form where its absence
              is the point rather than an oversight: §2.1 puts the exact GPS point in the fresh
              half, so there is never a mark to show or a carried value to clear. The row has
              its own clear control for the pin the diver just took. */}
          <ControlledPositionField control={control} setValue={setValue} scheme={scheme} />
        </FormGroup>

        <FormGroup {...groupProps('equipment')}>
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="suit"
            label={t('field.suit')}
            options={SUIT_VALUES}
            displayLabel={(option) => formatSuit(option) ?? option}
            scheme={scheme}
            layout="tiles"
            icon={drawnIcon('suit')}
          />
          {/* Thickness is a NUMBER, not a token (§10): a list offering 3 mm and 7 mm makes a
              5 mm suit unsayable, and a diver forced to pick the nearest wrong value is the
              failure §1 exists to prevent. Millimetres in both unit systems, so the unit is a
              literal here exactly as `min` is on Duration — format/units.ts's top docblock is
              where the four no-pair quantities are declared together. */}
          <ControlledTextField
            control={control}
            name="suitThicknessMm"
            label={t('field.suitThickness')}
            scheme={scheme}
            keyboardType="decimal-pad"
            carryOver={carryOver}
            mono
            unit="mm"
          />
          {/* The non-exclusive half of what used to be one control: you wear one suit and any
              number of accessories (§10). Five rows where there were three, and the two new
              ones cost no columns — which is the point of a token set. */}
          <ControlledEquipmentField control={control} scheme={scheme} />
          <ControlledTextField
            control={control}
            name="weightsKg"
            label={t('field.weights')}
            scheme={scheme}
            keyboardType="decimal-pad"
            carryOver={carryOver}
            mono
            unit={unitLabel('weight', units)}
          />
          {/* The judgement beside the number, and §10's sharper example of why both: "6 kg"
              means nothing on its own, and "6 kg, and I was over" is what a diver uses to dial
              in the next dive. Fresh every dive, unlike the kilos beside it — a weighting that
              felt right in a 7 mm suit in fresh water is the most misleading thing this form
              could prefill (carryOver.ts). */}
          <ControlledOptionField
            control={control}
            carryOver={carryOver}
            name="weightsFeel"
            label={t('field.weighting')}
            options={WEIGHTS_FEEL_VALUES}
            displayLabel={(option) => formatWeightsFeel(option) ?? option}
            scheme={scheme}
          />
        </FormGroup>

        <FormGroup {...groupProps('people')}>
          {/* §2.3's other two: "Buddies and guides autocomplete from your own past entries
              only — they stay private text, not user accounts." So they keep the inline list
              under the row, from their own column of the diver's history (`history`), and
              nothing on them pairs with a catalogue row. */}
          <ControlledTextField
            control={control}
            name="buddy"
            label={t('field.buddy')}
            scheme={scheme}
            carryOver={carryOver}
            history={history}
            autoCapitalize="words"
            autoCorrect={false}
            spellCheck={false}
          />
          <ControlledTextField
            control={control}
            name="guide"
            label={t('field.guide')}
            scheme={scheme}
            carryOver={carryOver}
            history={history}
            autoCapitalize="words"
            autoCorrect={false}
            spellCheck={false}
          />
        </FormGroup>

        <FormGroup {...groupProps('notes')}>
          <ControlledTextField control={control} carryOver={carryOver} name="title" label={t('field.title')} scheme={scheme} />
          <ControlledTextField control={control} carryOver={carryOver} name="notes" label={t('field.notes')} scheme={scheme} multiline />
          <ControlledRatingField control={control} scheme={scheme} />
        </FormGroup>
      </RevealingScrollView>
      </FocusChainProvider>

      {/* Task 6: a failed `createDive` says so, plainly, rather than pretending the save
          worked (§1's "never block a save" cutting the other way — see `saveErrorMessage`
          above). A sibling of `formFooter` below, not nested inside it or `formScroll`
          above, so it is visible without scrolling exactly as the save control itself
          always is. */}
      {saveError !== null && (
        <View style={styles.formSaveError}>
          <Text style={styles.formSaveErrorText}>{saveError}</Text>
        </View>
      )}

      {/* §0.5: the primary action sits in the bottom third — a fixed footer outside
          `formScroll` above, not the scrolling content, so it never needs to be scrolled
          into view. The device's home-indicator clearance is the one value here that cannot
          live in `makeStyles(scheme)`, the same reasoning DivesScreen.tsx's own floating row
          gives for composing it in locally rather than guessing it in a scheme-only sheet.

          **And it is spent only while there is an indicator left to clear** (M3m). It used to
          be a flat `insets.bottom + 24`, which is right with the keyboard down and wrong with
          it up: the keys are drawn over the indicator, so 34 pt on an island phone went on
          clearing something nothing could reach and this button floated that far above the
          keyboard it had just been lifted onto. Named as an accepted cost when the lift
          landed, and closed here rather than left — because `SearchScreen`'s dock had the
          identical padding for the identical reason, and two call sites with one rule between
          them is the shape §4.1 exists for. `liftedBottomInset` (theme/styles.ts) is the
          owner; both ask it. */}
      <View style={[styles.formFooter, { paddingBottom: liftedBottomInset(insets.bottom, 24, keyboardShown) }]}>
        {/* `disabled`/`accessibilityState` from `saving`, never from form validity (§1;
            see this screen's own docblock above). Both are set, not just one: `disabled`
            is what stops the press, `accessibilityState.disabled` is what tells a screen
            reader the same thing — a control that silently ignores a tap it still
            announces as available is its own kind of dead button. */}
        <Pressable
          style={styles.action}
          // `handleSubmit(onValid)` is built inside the press handler rather than during
          // render: `onValid` reads `savingRef.current`, and handing a ref-reading function
          // to another function during render is exactly what `react-hooks/refs` rejects —
          // rightly, since a ref read at render time is a value React makes no promises
          // about. Built on the press, it is read in an event handler, which is the only
          // place a ref's `current` means anything.
          onPress={() => handleSubmit(onValid)()}
          disabled={saving}
          accessibilityRole="button"
          // "Save dive" or "Save plan", from the one place that decides (`saveLabelFor`) —
          // the button says what it will do, so the diver never has to remember which state
          // the control above is in to know what pressing this means. The visible label and
          // the announced one are the same string for the same reason.
          accessibilityLabel={saveLabelFor(chosenStatus)}
          accessibilityState={{ disabled: saving }}
        >
          <Text style={styles.actionLabel}>{saveLabelFor(chosenStatus)}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * The way out (M1d task 7, amendment D — found by using the app: this screen had none at all).
 * iOS's edge-swipe and Android's system back both worked, but nothing on screen said so, while
 * DiveDetailScreen next door has offered a visible way out since M1c. Same treatment as that
 * control — mono, muted, small, at §0.5's 48 dp floor, pinned above the scroll rather than
 * scrolling with it (`backControl` in theme/styles.ts is the one definition all three screens
 * share) — because it is the same kind of thing: a way out, not an action, and nothing here may
 * read like the primary button. It writes NOTHING: `backToDives` and no save, in either mode.
 *
 * **A component rather than JSX inline in the render, because this screen now has two frames
 * that must both offer it** (M1f): the form itself, and the frame edit mode draws while the
 * dives read has not answered. §0.6's "a form with no visible way out was shipped once and only
 * found by using the app" binds hardest on the second of those — a screen showing nothing else
 * at all — and a second copy of this control is exactly how one of the two frames ends up
 * quietly losing it. `GearPresetScreen`'s own `BackControl` is the same shape one route over,
 * kept separate only because it leaves to a different destination (`backToSettings`).
 */
function CancelControl({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.formBack}
      onPress={backToDives}
      accessibilityRole="button"
      // Says what leaving does, which is the half a diver cannot see from the chevron:
      // deliberately not containing the word "Save", so this can never be mistaken — by a
      // screen reader or by a test query — for the save control at the bottom of the form.
      accessibilityLabel={t('back.cancelLabel')}
    >
      <Text style={styles.formBackLabel}>{t('back.cancel')}</Text>
    </Pressable>
  );
}
