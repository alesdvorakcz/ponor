import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pressable, ScrollView, Text, View, useColorScheme, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { DateTimeField } from '../components/DateTimeField';
import { EntryIcon } from '../components/EntryIcon';
import { FormField } from '../components/FormField';
import { FormGroup } from '../components/FormGroup';
import { db } from '../db/client';
import { createDive, updateDive } from '../db/dives';
import { useDives } from '../db/useDives';
import { CARRIED_FIELDS, carryOverFrom } from '../domain/carryOver';
import { todayCalendarDate } from '../domain/datetime';
import {
  diveFormSchema,
  toDivePatch,
  toNewDiveInput,
  unknownBooleanNote,
  unknownOptionNote,
  type DiveFormValues,
} from '../domain/diveFormSchema';
import {
  ENTRY_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  WATER_BODY_VALUES,
  type Dive,
  type DiveStatus,
} from '../domain/types';
import {
  formatEntry,
  formatSalinity,
  formatSuit,
  formatTankMaterial,
  formatWaterBody,
  HE_LABEL,
  O2_LABEL,
} from '../format/display';
import { backToDives } from '../navigation/backToDives';
import { resolveScheme } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * The form's own **input** shape — every numeric/text field as the raw string (or
 * already-typed value) a `TextInput`/carry-over default can hold, before
 * `zodResolver(diveFormSchema)` coerces it — as opposed to `DiveFormValues`, the
 * schema's *output* type of real numbers and nulls. `diveFormSchema.ts`'s own docblock
 * draws exactly this line: "this schema... over the form's **string** values." Deriving
 * it with `z.input<>` rather than hand-typing a second copy is what keeps this screen
 * from drifting out of step with the schema the moment a field is added there.
 */
type DiveFormInput = z.input<typeof diveFormSchema>;
type TankFormInput = NonNullable<DiveFormInput['tanks']>[number];

function toInputString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

const EMPTY_TANK: TankFormInput = {
  material: null,
  sizeL: null,
  count: null,
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
 * `status` is `'logged'`, and this is the one place that decides so. **Always**, and never
 * inferred: not from the date (a dive dated next week is a perfectly ordinary backfill
 * mistake to make and an awful thing to silently reclassify), not remembered from the last
 * session, and not carried over from the previous dive — `carryOverFrom` deliberately
 * names neither `status` nor `date`, so this default survives the merge in
 * `initialFormValues` below. A diver who plans one dive on a boat does not want every
 * later entry defaulting to planned; §2.4 is the exception, not a mode.
 */
function blankFormValues(): DiveFormInput {
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
    visibilityM: null,
    waves: null,
    current: null,
    surge: null,
    entry: null,
    salinity: null,
    waterBody: null,
    latitude: null,
    longitude: null,
    tanks: [EMPTY_TANK],
    suit: null,
    hood: null,
    gloves: null,
    boots: null,
    weightsKg: null,
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

/**
 * Type-level proof that every field this form has is also a field a `Dive` has, so
 * `diveToFormValues` below can copy them across by name. A field added to
 * `diveFormSchema` that `Dive` does not carry is a compile error here rather than a field
 * that silently seeds as `undefined` when a dive is opened for editing.
 */
type Assert<T extends true> = T;
export type FormFieldsExistOnDive = Assert<keyof DiveFormValues extends keyof Dive ? true : false>;

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
 * Whether a starting value counts as something DESIGN.md §0.6's `carried ×` chip
 * should mark, as opposed to a field that merely was not touched. `0` and `false` are
 * real, meaningful carried values (a diver who dove with zero weight, or without a
 * hood, still had that as their last dive's actual answer) and must count — only
 * `null`/`undefined`/a whitespace-only string mean "carry-over had nothing to say
 * here," the same "empty means absent, not a value" line `diveFormSchema.ts`'s own
 * `optionalNumber`/`optionalText` already draw for the opposite direction (a value
 * reaching the schema, not leaving it).
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
 * `material`, which render as `OptionChips`; `hood`/`gloves`/`boots`, which render as
 * `BooleanField`) still gets a correct entry in the returned set — simply one nothing
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
  /** This form's starting values, held rather than recomputed so `useForm`'s `values`
   * option has a reference that changes only when the seed dive really does. */
  values: DiveFormInput;
  /** DESIGN.md §0.6's `carried ×` paths for `values`, minus whatever the diver has since
   * typed over (`dropCarried`, render body). Always empty in edit mode — see below. */
  paths: ReadonlySet<string>;
  /**
   * Every field the diver has typed into or cleared on this form, ever — and the one part of
   * this state that **survives a reseed**.
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
}

/**
 * This form's starting values, and DESIGN.md §0.6's `carried ×` paths for them.
 *
 * The chip means "this came from your LAST DIVE", so edit mode marks nothing at all: it
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
 * `typed` is carried in and back out untouched, and subtracted from the marks on the way:
 * see `SeedState.typed` for the race it closes. A reseed re-derives everything the SEED
 * decides and nothing the DIVER decided.
 */
function seedStateFor(
  mode: 'create' | 'edit',
  seed: Dive | null,
  openAs?: DiveStatus,
  typed: ReadonlySet<string> = new Set<string>(),
): SeedState {
  const sourceId = seed?.id ?? null;
  const withOpenAs = (values: DiveFormInput): DiveFormInput =>
    openAs === undefined ? values : { ...values, status: openAs };
  if (mode === 'edit') {
    return {
      sourceId,
      // A `null` seed in edit mode means the dive has not arrived yet (`useDives()` starts
      // empty) or the id names no live dive at all. Today's blank form is what shows in
      // that gap; `onValid` below refuses to write anything without a real dive, so a form
      // that opened blank can never save its blanks over a dive it never loaded.
      values: withOpenAs(seed === null ? blankFormValues() : diveToFormValues(seed)),
      paths: new Set<string>(),
      typed,
    };
  }
  const values = withOpenAs(initialFormValues(seed));
  const marked = seed === null ? new Set<string>() : computeCarriedPaths(values);
  for (const field of typed) marked.delete(field);
  return { sourceId, values, paths: marked, typed };
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

type FormControl = Control<DiveFormInput, unknown, DiveFormValues>;

interface ControlledTextFieldProps {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  scheme: ColorScheme;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
  placeholder?: string;
  /** §0.6's "figures in mono, names in sans" — set explicitly per field, never inferred.
   * See `FormFieldProps.mono` for why `keyboardType` is not the same question. */
  mono?: boolean;
  /** The figure's unit, drawn as a muted suffix and as the empty field's placeholder (§0.6).
   * See `FormFieldProps.unit` for why it is not `placeholder`. */
  unit?: string;
  /**
   * DESIGN.md §0.6's `carried ×` chip (M1d task 5). Both omitted at every call site
   * whose `name` is not one of `computeCarriedPaths`' own paths — `FormField` then
   * simply shows no chip, which is correct for the 18 of this screen's 28
   * `ControlledTextField`s that DESIGN §2.1 marks fresh. Reads `carried` out of
   * `carriedPaths` and hands `onDropCarried` this field's own `name` internally
   * (below) rather than asking each call site to repeat its own field name a second
   * time as a plain string next to the `name` prop it already has — the exact
   * "hand-maintained second list" shape `carryOver.ts`'s own docblock warns against,
   * just one call site over from where that module draws the line.
   */
  carriedPaths?: ReadonlySet<string>;
  onDropCarried?: (name: FieldPath<DiveFormInput>) => void;
}

/**
 * The line of text under a field that has something to say about its own value, or nothing
 * at all when it has not. Shared by every controlled field wrapper below rather than written
 * out in each, so "a field speaks next to the control it belongs to" is one rule in one
 * place.
 *
 * It carries two different kinds of sentence, and the difference is worth stating because
 * the treatment is identical (§0.6: "a field error is text, not a field").
 *
 * **A refusal.** `date` is the one field on this form that can still stop a save, and when
 * it does `handleSubmit` refuses to call `onValid` for the WHOLE form. Before this existed
 * that refusal was completely silent: type `31.8.2026`, the Czech spelling of a real date in
 * an app that ships `cs`, tap Save, and nothing happened. Since M1d's pickers the field can
 * no longer *produce* an unreadable value, and this should never fire for anything a diver
 * does here; it stays because the schema is the domain's guarantee rather than this form's,
 * and carry-over prefills this form from rows M2 sync delivered.
 *
 * **A note.** The option and boolean fields no longer refuse anything at all (DESIGN.md §10,
 * settled after M1d: "a value outside the expected range is saved and can be flagged; it is
 * not refused"). A value from a newer client is kept and saved, and `unknownOptionNote` /
 * `unknownBooleanNote` (diveFormSchema.ts) say so here — where a refusal used to be a dead
 * Save button and, before that, silence.
 *
 * Both sentences come from `diveFormSchema.ts` rather than being written here, for the same
 * reason: what a value means is that file's rule to state, and a copy here would drift the
 * first time the rule changed.
 */
function FieldNote({ message, scheme }: { message: string | undefined; scheme: ColorScheme }) {
  const styles = makeStyles(scheme);
  if (message === undefined) return null;
  return (
    <View style={styles.formFieldError}>
      <Text style={styles.formFieldErrorText}>{message}</Text>
    </View>
  );
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
  mono,
  unit,
  carriedPaths,
  onDropCarried,
}: ControlledTextFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <>
          <FormField
            ref={field.ref}
            label={label}
            value={toInputString(field.value)}
            // Typing drops the chip immediately (§0.6: "overwriting is just typing, and
            // drops the chip") — dropping first, then forwarding, so a field currently
            // showing `carried` never renders even one frame of the new text next to a
            // chip that no longer describes it.
            onChange={(text) => {
              onDropCarried?.(name);
              field.onChange(text);
            }}
            onBlur={field.onBlur}
            scheme={scheme}
            keyboardType={keyboardType}
            multiline={multiline}
            placeholder={placeholder}
            mono={mono}
            unit={unit}
            carried={carriedPaths?.has(name)}
            // The `×`: same drop, same forward, but with FormField's own `''` — never
            // this field's current (possibly numeric-looking) value — so a cleared
            // cylinder size reaches `field.onChange` (and from there `diveFormSchema.ts`'s
            // coercion contract) as the same empty string `optionalNumber` turns into
            // `null`, not a derived `0`.
            onClear={(text) => {
              onDropCarried?.(name);
              field.onChange(text);
            }}
          />
          <FieldNote message={fieldState.error?.message} scheme={scheme} />
        </>
      )}
    />
  );
}

/** What a picker field reads as while it holds nothing. Deliberately neutral — §1's "only
 * the fields you use", no form-shaming — and deliberately not blank: an empty box would read
 * as a control that failed to load rather than as a field with nothing in it. */
const NOT_RECORDED = 'Not set';

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
            placeholder={NOT_RECORDED}
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

interface OptionChipsProps<T extends string> {
  label: string;
  value: T | '' | null | undefined;
  options: readonly T[];
  displayLabel: (option: T) => string;
  onChange: (value: T | '') => void;
  scheme: ColorScheme;
  /**
   * DESIGN.md §0.6: "**An icon appears only where the value has one.** ... the icon is
   * information, not decoration, and it **supplements the label rather than replacing it** —
   * never an icon alone."
   *
   * Optional, and omitted at four of the five call sites — only `entry` has values with
   * conventional symbols (`EntryIcon`, which owns that judgement and returns nothing for
   * `other`). A render prop rather than a `Record` this component looks values up in,
   * because the mapping is per FIELD, not per chip row: a table here would have to be keyed
   * by both field and value, which is a second hand-maintained list of exactly the shape
   * §4.1 warns about, one call site away from the file that already owns it.
   *
   * `tintColor` is handed OUT rather than taken in: which ink a chip's contents wear depends
   * on whether that chip is selected, and this component is the only thing that knows. A
   * call site choosing the colour itself would have to be told the selection state, and
   * would then own a rule ("the icon matches the label beside it") that belongs here.
   */
  icon?: (option: T, tintColor: ColorValue) => ReactNode;
}

/**
 * A fixed-choice field (entry, salinity, water body, suit, cylinder material) —
 * `diveFormSchema.ts`'s own docblock on `optionalPicked` is explicit that these values
 * are "never something a diver could type... rejecting one is catching a real bug
 * upstream." That guarantee only holds if the UI actually restricts input to the fixed
 * list: a free-text field here would let a diver mistype one, `zodResolver` would fail
 * validation on that one field, and react-hook-form's `handleSubmit` would refuse to call
 * `onValid` for the WHOLE form — exactly the "never block a save" (§1) failure this
 * screen exists to avoid. Tapping the already-selected chip clears it back to `''`,
 * which `optionalPicked` treats identically to never having picked anything.
 */
function OptionChips<T extends string>({ label, value, options, displayLabel, onChange, scheme, icon }: OptionChipsProps<T>) {
  const styles = makeStyles(scheme);
  return (
    // The same `formField` row as every other field (§0.6), with the chips in the slot §0.6
    // gives a field's second line rather than in the row's trailing value slot: five suit
    // options at Czech length cannot sit beside a label without wrapping into a column two
    // words wide. `formChipRow`'s own `justifyContent: 'flex-end'` is what keeps them in the
    // value column anyway.
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
      </View>
      <View style={styles.formChipRow}>
        {options.map((option) => {
          const selected = value === option;
          // The ink the chip's own label is about to wear, read off the style rather than
          // from the theme directly — the same "take the colour from the style you are
          // matching" move `DateTimeField` makes for the native picker's `textColor`. It is
          // handed to `icon` so a symbol beside the label inverts with it (§0.6), instead of
          // staying `fg` on an `action` ground where it would vanish.
          const ink = (selected ? styles.formChipTextSelected.color : styles.formChipText.color) as ColorValue;
          return (
            <Pressable
              key={option}
              style={[styles.formChip, selected && styles.formChipSelected]}
              onPress={() => onChange(selected ? '' : option)}
              accessibilityRole="button"
              // Unchanged by the icon, deliberately: §0.6 makes the icon a supplement to the
              // label, so what a screen reader hears is exactly what it heard before — the
              // symbol adds nothing to say that the words do not already say.
              accessibilityLabel={`${label}: ${displayLabel(option)}`}
              accessibilityState={{ selected }}
            >
              {icon?.(option, ink)}
              <Text style={[styles.formChipText, selected && styles.formChipTextSelected]}>{displayLabel(option)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface ControlledOptionFieldProps<T extends string> {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  options: readonly T[];
  displayLabel: (option: T) => string;
  scheme: ColorScheme;
  /** Forwarded untouched to `OptionChips` — see that component's own prop for why an icon is
   * a render prop and why only `entry` passes one. */
  icon?: (option: T, tintColor: ColorValue) => ReactNode;
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
 * flagged: `unknownOptionNote` (diveFormSchema.ts) supplies the sentence, `FieldNote` shows
 * it, and tapping any chip replaces it.
 *
 * `fieldState.error` is still read first, and is not dead: a field that grows a blocking
 * rule later is covered without this screen keeping a second list of which fields can fail.
 */
function ControlledOptionField<T extends string>({ control, name, label, options, displayLabel, scheme, icon }: ControlledOptionFieldProps<T>) {
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
            onChange={field.onChange}
            scheme={scheme}
            icon={icon}
          />
          <FieldNote message={fieldState.error?.message ?? unknownOptionNote(options, field.value)} scheme={scheme} />
        </>
      )}
    />
  );
}

interface BooleanFieldProps {
  label: string;
  value: boolean | null | undefined;
  onChange: (value: boolean) => void;
  scheme: ColorScheme;
}

/** hood/gloves/boots (`optionalBoolean`, diveFormSchema.ts) — a single toggling chip
 * rather than RN's own `Switch`: `Switch` needs raw `trackColor`/`thumbColor` strings,
 * which have no way to come from `makeStyles(scheme)` the way every other colour in this
 * screen must (`src/screens/**`'s colour-literal lint rule scans for exactly that), where
 * a chip reuses the monochrome `formChip`/`formChipSelected` treatment already built for
 * the pick fields above. */
function BooleanField({ label, value, onChange, scheme }: BooleanFieldProps) {
  const styles = makeStyles(scheme);
  const checked = value === true;
  return (
    // The one field whose value genuinely fits the row's trailing slot as a control rather
    // than as text — so it is `formField` plus `formFieldRow` like every other field (§0.6),
    // with the chip standing where a typed value would. It used to be the bare label row with
    // no field wrapper at all, which is why hood/gloves/boots drew no hairline of their own.
    // `formFieldChoice` is the padding a 48 dp chip needs inside a 48 dp row — see that style.
    <View style={[styles.formField, styles.formFieldChoice]}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <Pressable
          style={[styles.formChip, checked && styles.formChipSelected]}
          onPress={() => onChange(!checked)}
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityState={{ checked }}
        >
          <Text style={[styles.formChipText, checked && styles.formChipTextSelected]}>{checked ? 'Yes' : 'No'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface ControlledBooleanFieldProps {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  scheme: ColorScheme;
}

/** hood/gloves/boots, and the same `FieldNote` for the same reason `ControlledOptionField`
 * above carries one: this control can only ever produce `true` or `false`, so a value that is
 * neither arrived from outside the form. It is kept and saved rather than refused (§10),
 * with `unknownBooleanNote` saying so — a refusal here was a Save button that did nothing at
 * all, on a dive whose yes/no field the diver never touched. */
function ControlledBooleanField({ control, name, label, scheme }: ControlledBooleanFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <>
          <BooleanField label={label} value={field.value as unknown as boolean | null | undefined} onChange={field.onChange} scheme={scheme} />
          <FieldNote message={fieldState.error?.message ?? unknownBooleanNote(field.value)} scheme={scheme} />
        </>
      )}
    />
  );
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
 * visual idiom, and emphatically not a sixth slot in §2.2's core strip — that strip is the
 * dive's measurements, and a status is not one of them.
 *
 * A toggle, in the same `accessibilityRole="switch"` idiom `BooleanField` above already
 * uses for hood/gloves/boots, because this is the same shape of question: one control,
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
            accessibilityLabel="Planned dive"
            accessibilityState={{ checked: planned }}
          >
            <View style={[styles.formStatusPill, planned && styles.formStatusPillOn]}>
              <Text style={[styles.formStatusLabel, planned && styles.formStatusLabelOn]}>
                {planned ? 'Planned' : 'Logged'}
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
 */
function headingFor(mode: 'create' | 'edit', stored: DiveStatus | null, chosen: DiveStatus): string {
  if (mode === 'create') return chosen === 'planned' ? 'New plan' : 'New dive';
  if (stored === 'planned' && chosen === 'logged') return 'Complete dive';
  return chosen === 'planned' ? 'Edit plan' : 'Edit dive';
}

/** What the save control says it will do — "the diver should never have to remember which
 * mode they are in to know what the button does." Both the visible label and the
 * accessibility one, from this one function, so the two cannot drift. */
function saveLabelFor(chosen: DiveStatus): string {
  return chosen === 'planned' ? 'Save plan' : 'Save dive';
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
const SAVE_ERROR_MESSAGE = "Couldn't save this dive. Try again.";

/**
 * Shown when Save is pressed in edit mode and there is no dive to write to — the id names
 * nothing live (deleted on another device, a stale deep link), or `useDives()` has not
 * resolved yet.
 *
 * Not silent, and deliberately not a `createDive` fallback either: a form that quietly
 * logged a NEW dive because it could not find the one it was editing would duplicate the
 * dive on the device that still has it, and duplicate it again on every later attempt.
 */
const MISSING_DIVE_MESSAGE = "Couldn't find that dive — it may have been deleted.";

/**
 * The dive-entry form (DESIGN.md §2.2, M1d task 4): one scrollable form with a small
 * always-visible core strip — date, site, centre, max depth, duration — and everything
 * else behind six collapsible `FormGroup`s. **Only the date is required** (§2.2); every
 * other field, including a wholly untouched one, is a legitimate save.
 *
 * The save control (`formFooter` below) is **never disabled for validity** — nothing about
 * what the diver has or has not filled in, or what the resolver makes of it, ever reaches
 * its `disabled` prop — because §1's "never block a save" binds the CONTROL itself, not
 * just what happens after it is pressed. `handleSubmit(onValid)` still runs
 * `zodResolver(diveFormSchema)` underneath, so a diver can always tap Save; a rejected
 * `createDive` says so (`SAVE_ERROR_MESSAGE`) instead of pretending it worked, and never
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
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();

  // The one read this screen needs for carry-over (useDives.ts's own "the one read every
  // screen uses") — never a second query, per this task's own brief. See
  // `initialFormValues`'s docblock for why `dives` (and therefore this) can change after
  // mount, and why that is handled below rather than assumed away.
  const { dives } = useDives();
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
  // `carried.typed` goes back in on every reseed: the seed decides the VALUES and the marks,
  // and the diver's own history of having touched a field outlives any of them — see
  // `SeedState.typed`.
  const [carried, setCarried] = useState<SeedState>(() => seedStateFor(mode, seedDive, initialStatus));
  if (carried.sourceId !== sourceId) setCarried(seedStateFor(mode, seedDive, initialStatus, carried.typed));

  const { control, handleSubmit } = useForm<DiveFormInput, unknown, DiveFormValues>({
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

  // The live value of §2.4's control, which the heading and the save's own label are the
  // other two views of. `useWatch` rather than `formState`/`getValues`: it subscribes this
  // component to that one field, so moving the control re-renders the heading and the
  // button with it — reading `getValues('status')` during render would produce the right
  // string once and then never change, which is the "says one thing, does another" defect
  // this whole control exists to end, reintroduced one layer down.
  const chosenStatus: DiveStatus = useWatch({ control, name: 'status' }) === 'planned' ? 'planned' : 'logged';

  // The date the form currently holds, watched for the same reason `chosenStatus` above is:
  // the entry-time picker is seeded onto THIS dive's day (`DateTimeField`'s `day` prop), so
  // a diver who corrects the date before setting the time must get a picker that already
  // knows it. Read through `useWatch` rather than `getValues`, which would produce the right
  // day once and then never change.
  const watchedDate = useWatch({ control, name: 'date' });
  const chosenDate = typeof watchedDate === 'string' ? watchedDate : null;

  const carriedPaths = carried.paths;

  // Shared by every carried `ControlledTextField` below (typing and the chip's `×`
  // alike) rather than one closure per field, so there is exactly one place that can
  // get a field's own drop logic wrong. Reads the LATEST state through a functional
  // updater rather than a value captured at render time — the same reasoning
  // `ReorderControls.tsx` documents for staying stateless.
  //
  // It does **two** things, and the second is what makes the chip honest. Dropping the mark
  // is the visible half ("overwriting is just typing, and drops the chip", §0.6). Recording
  // the field in `typed` is the half that has to outlive the drop: this fires on every
  // keystroke, including keystrokes that land BEFORE `useDives()` has resolved and therefore
  // before there is any mark to drop — and when carry-over lands a moment later, that is
  // exactly the field a recomputed `computeCarriedPaths` would mark as carried, over text the
  // diver typed. It used to bail out early whenever `name` was not already marked, which is
  // the same condition, so the one case that needed recording was the one case it skipped.
  //
  // The early return moved rather than disappeared: once a field is both recorded and
  // unmarked there is nothing left to change, so a second keystroke returns the same
  // reference and re-renders nothing.
  const dropCarried = useCallback((name: FieldPath<DiveFormInput>) => {
    setCarried((prev) => {
      if (prev.typed.has(name) && !prev.paths.has(name)) return prev;
      const paths = new Set(prev.paths);
      paths.delete(name);
      const typed = new Set(prev.typed);
      typed.add(name);
      return { ...prev, paths, typed };
    });
  }, []);

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
        // `createDive` — see MISSING_DIVE_MESSAGE.
        if (target === null) {
          setSaveError(MISSING_DIVE_MESSAGE);
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
        const patch = toDivePatch(target, values);
        await updateDive(db, target.id, patch);
      } else {
        await createDive(db, toNewDiveInput(values));
      }
      // `backToDives` (navigation/backToDives.ts), not a private copy of its guard: this
      // screen is reachable directly by URL exactly as DiveDetailScreen is, and a diver who
      // deep-linked into the form and saved must land on the list rather than sitting on a
      // form that has already been written.
      backToDives();
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      // Released on both paths. A failed save that left the control latched shut would
      // strand the diver on a form they cannot resubmit — the same "told nothing, can do
      // nothing" dead end §1 exists to prevent, arrived at from the opposite direction.
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* The way out (M1d task 7, amendment D — found by using the app: this screen had
          none at all). iOS's edge-swipe and Android's system back both worked, but nothing
          on screen said so, while DiveDetailScreen next door has offered a visible `‹ Dives`
          since M1c. Same treatment as that control — mono, muted, small, at §0.5's 48 dp
          floor, pinned above the scroll rather than scrolling with it (`backControl` in
          theme/styles.ts is now the one definition both share) — because it is the same kind
          of thing: a way out, not an action, and nothing here may read like the primary
          button. It writes NOTHING: `backToDives` and no save, in either mode. */}
      <Pressable
        style={styles.formBack}
        onPress={backToDives}
        accessibilityRole="button"
        // Says what leaving does, which is the half a diver cannot see from the chevron:
        // deliberately not containing the word "Save", so this can never be mistaken —
        // by a screen reader or by a test query — for the save control below.
        accessibilityLabel="Leave without saving"
      >
        <Text style={styles.formBackLabel}>‹ Cancel</Text>
      </Pressable>
      <ScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
        {/* The header row (§2.4): what this form is, and the control that decides it. The
            heading is `headingFor`'s alone — it reads what the SAVE will do, from the
            control's live value and the dive's stored status together, so it can no longer
            promise to complete a dive the save is going to leave planned. "Edit dive"
            while the dive has not loaded yet, since nothing is yet known to complete. */}
        <View style={styles.formHeadingRow}>
          <Text style={styles.formHeading}>{headingFor(mode, target?.status ?? null, chosenStatus)}</Text>
          <StatusControl control={control} scheme={scheme} />
        </View>

        {/* Core strip (§2.2) — date, site, centre, max depth, duration, always visible. */}
        <View style={styles.formCoreStrip}>
          {/* A picker, not a text field (§10, M1d): `date` carried this form's only
              blocking rule, so a mistyped one was the single thing that could refuse a save
              — and a control that cannot produce `31.8.2026` removes that case rather than
              adjudicating it. Required (§2.2), so no `optional`, and therefore no `×`. */}
          <ControlledDateTimeField control={control} name="date" label="Date" mode="date" scheme={scheme} />
          <ControlledTextField
            control={control}
            name="siteName"
            label="Site"
            scheme={scheme}
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="centerName"
            label="Centre"
            scheme={scheme}
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="maxDepthM"
            label="Max depth"
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit="m"
          />
          <ControlledTextField
            control={control}
            name="durationMin"
            label="Duration"
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit="min"
          />
        </View>

        <FormGroup title="Times & depth" scheme={scheme}>
          {/* Same treatment for a quieter version of the same defect: a typo in a typed
              `HH:MM` never blocked a save, it silently dropped the dive out of §2.5's
              time-ordering and voided its surface interval. `optional`, because `timeIn`
              stays `optionalText` — a diver who did not note an entry time saves without
              one. `timeOut` gets no control at all: it is computed from this plus duration
              (derived.ts), and §0.6 marks it as computed rather than asking for it. */}
          <ControlledDateTimeField control={control} name="timeIn" label="Time in" mode="time" scheme={scheme} optional day={chosenDate} />
          <ControlledTextField control={control} name="avgDepthM" label="Avg depth" scheme={scheme} keyboardType="decimal-pad" mono unit="m" />
        </FormGroup>

        <FormGroup title="Conditions" scheme={scheme}>
          <ControlledTextField
            control={control}
            name="waterTempC"
            label="Water temp"
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit="°C"
          />
          <ControlledTextField control={control} name="airTempC" label="Air temp" scheme={scheme} keyboardType="decimal-pad" mono unit="°C" />
          <ControlledTextField
            control={control}
            name="visibilityM"
            label="Visibility"
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit="m"
          />
          <ControlledTextField control={control} name="waves" label="Waves" scheme={scheme} keyboardType="decimal-pad" mono placeholder="0-3" />
          <ControlledTextField control={control} name="current" label="Current" scheme={scheme} keyboardType="decimal-pad" mono placeholder="0-3" />
          <ControlledTextField control={control} name="surge" label="Surge" scheme={scheme} keyboardType="decimal-pad" mono placeholder="0-3" />
          <ControlledOptionField
            control={control}
            name="entry"
            label="Entry"
            options={ENTRY_VALUES}
            displayLabel={(option) => formatEntry(option) ?? option}
            scheme={scheme}
            // The only field on this form that passes one (§0.6: "*Shore* and *boat* do.
            // *Salt*, *fresh* and *brackish* do not..."). `EntryIcon` owns which values
            // actually have a symbol and draws nothing for the ones that do not, so this
            // call site does not repeat that judgement.
            icon={(option, tintColor) => <EntryIcon entry={option} tintColor={tintColor} />}
          />
          <ControlledOptionField
            control={control}
            name="salinity"
            label="Salinity"
            options={SALINITY_VALUES}
            displayLabel={(option) => formatSalinity(option) ?? option}
            scheme={scheme}
          />
          <ControlledOptionField
            control={control}
            name="waterBody"
            label="Water body"
            options={WATER_BODY_VALUES}
            displayLabel={(option) => formatWaterBody(option) ?? option}
            scheme={scheme}
          />
          <ControlledTextField control={control} name="latitude" label="Latitude" scheme={scheme} keyboardType="decimal-pad" mono />
          <ControlledTextField control={control} name="longitude" label="Longitude" scheme={scheme} keyboardType="decimal-pad" mono />
        </FormGroup>

        {/* DESIGN.md §6: the form shows a single cylinder until "+ add cylinder" is
            tapped. That control is not built yet — nothing in M1d's seven tasks asks for
            it — so this group binds directly to `tanks.0.*` for now; a real "+ add
            cylinder" needs `useFieldArray` and is a reasonable follow-up, not a silent
            gap: `tanks` still submits as `[EMPTY_TANK]` rather than `[]` when the diver
            never opens this group, which is harmless (derived.ts skips a cylinder whose
            sizeL/count are null; only 0 is contradictory) but not byte-identical to "no
            cylinders recorded" either. */}
        <FormGroup title="Gas & cylinders" scheme={scheme}>
          <ControlledOptionField
            control={control}
            name="tanks.0.material"
            label="Material"
            options={TANK_MATERIAL_VALUES}
            displayLabel={(option) => formatTankMaterial(option) ?? option}
            scheme={scheme}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.sizeL"
            label="Size"
            scheme={scheme}
            keyboardType="decimal-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
            mono
            // Lower-case `l`, where the placeholder here used to read `L`: §0.6 asks for the
            // unit "exactly as `12.2 m` reads on the detail", and `formatVolume`
            // (format/display.ts) — the one owner of that string — prints `12 l`. The unit is
            // drawn beside the figure now rather than only inside an empty box, so the two
            // spellings would have sat one screen apart on the same cylinder. If `L` is the
            // wanted spelling it belongs in that formatter, where both screens read it.
            unit="l"
          />
          <ControlledTextField
            control={control}
            name="tanks.0.count"
            label="Count"
            scheme={scheme}
            // Whole cylinders, so a keypad with no separator key on it (§6: "count
            // (twinset = 2)"). `decimal-pad` offered one — a comma, on the Czech device
            // this app's first diver holds — and `derived.ts` reads a fractional count as
            // *contradictory*, which voids the dive's entire gas figure rather than
            // skipping the cylinder. `wholeNumber` (diveFormSchema.ts) rounds whatever
            // reaches the schema anyway; this is what stops it being typed.
            keyboardType="number-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
            mono
          />
          <ControlledTextField
            control={control}
            name="tanks.0.workingBar"
            label="Working pressure"
            scheme={scheme}
            keyboardType="decimal-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
            mono
            unit="bar"
          />
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
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
            mono
            unit="%"
          />
          <ControlledTextField
            control={control}
            name="tanks.0.hePct"
            label={HE_LABEL}
            scheme={scheme}
            keyboardType="decimal-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
            mono
            unit="%"
          />
          <ControlledTextField
            control={control}
            name="tanks.0.startBar"
            label="Start pressure"
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit="bar"
          />
          <ControlledTextField
            control={control}
            name="tanks.0.endBar"
            label="End pressure"
            scheme={scheme}
            keyboardType="decimal-pad"
            mono
            unit="bar"
          />
        </FormGroup>

        <FormGroup title="Equipment" scheme={scheme}>
          <ControlledOptionField
            control={control}
            name="suit"
            label="Suit"
            options={SUIT_VALUES}
            displayLabel={(option) => formatSuit(option) ?? option}
            scheme={scheme}
          />
          <ControlledBooleanField control={control} name="hood" label="Hood" scheme={scheme} />
          <ControlledBooleanField control={control} name="gloves" label="Gloves" scheme={scheme} />
          <ControlledBooleanField control={control} name="boots" label="Boots" scheme={scheme} />
          <ControlledTextField
            control={control}
            name="weightsKg"
            label="Weights"
            scheme={scheme}
            keyboardType="decimal-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
            mono
            unit="kg"
          />
        </FormGroup>

        <FormGroup title="People" scheme={scheme}>
          <ControlledTextField
            control={control}
            name="buddy"
            label="Buddy"
            scheme={scheme}
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="guide"
            label="Guide"
            scheme={scheme}
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
        </FormGroup>

        <FormGroup title="Notes & rating" scheme={scheme}>
          <ControlledTextField control={control} name="title" label="Title" scheme={scheme} />
          <ControlledTextField control={control} name="notes" label="Notes" scheme={scheme} multiline />
          <ControlledTextField control={control} name="rating" label="Rating" scheme={scheme} keyboardType="decimal-pad" mono placeholder="1-5" />
        </FormGroup>
      </ScrollView>

      {/* Task 6: a failed `createDive` says so, plainly, rather than pretending the save
          worked (§1's "never block a save" cutting the other way — see `SAVE_ERROR_MESSAGE`
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
          into view. `insets.bottom` (device home-indicator clearance) is the one value
          here that cannot live in `makeStyles(scheme)`, the same reasoning
          DivesScreen.tsx's own floating row gives for composing it in locally rather
          than guessing it in a scheme-only stylesheet. */}
      <View style={[styles.formFooter, { paddingBottom: insets.bottom + 24 }]}>
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
    </View>
  );
}
