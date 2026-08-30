import { useCallback, useMemo, useState } from 'react';
import { Controller, useForm, type Control, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '../components/FormField';
import { FormGroup } from '../components/FormGroup';
import { db } from '../db/client';
import { createDive } from '../db/dives';
import { useDives } from '../db/useDives';
import { CARRIED_FIELDS, carryOverFrom } from '../domain/carryOver';
import { diveFormSchema, toNewDiveInput, type DiveFormValues } from '../domain/diveFormSchema';
import { type Dive, type Entry, type Salinity, type Suit, type TankMaterial, type WaterBody } from '../domain/types';
import { formatEntry, formatSalinity, formatSuit, formatWaterBody } from '../format/display';
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

/** UTC calendar day, matching `carryOver.ts`'s own `carryOverDate` — the one other place
 * in this codebase that needs "today" rather than a stored date string, which
 * `domain/datetime.ts` deliberately does not own (it owns what a date STRING means, not
 * what today's date is). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
 */
function blankFormValues(): DiveFormInput {
  return {
    date: todayIso(),
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
 * A fresh entry's starting values (Task 6): `blankFormValues()` for `mode="edit"` — a
 * dive's OWN stored data is Task 7's job, not carry-over, see `blankFormValues`'s own
 * docblock — merged with whatever `carryOverFrom` (domain/carryOver.ts) carries forward
 * from `mostRecentLoggedDive`, the diver's own most recently logged dive.
 *
 * `dives` is `useDives()`'s own list — "the one read every screen uses" (useDives.ts's own
 * docblock) — passed in rather than read here, so this stays a plain function the render
 * body below can memoise; finding the most recent LOGGED dive is nothing more than the
 * first `status: 'logged'` entry in it, because `useDives()` already hands back every live
 * dive newest-first (db/dives.ts's `toDives`) and a planned (future-dated) dive would
 * otherwise sort ahead of a real logged one in that same order. No second sort: reusing
 * the one order `useDives()` already establishes is the whole point (this screen's own
 * "Consumes" line, and the brief's own "do not add a second read path").
 *
 * Callers must not treat this as a one-shot read: `useDives()` starts empty and resolves
 * asynchronously (`useLiveQuery`'s own initial state, well after this screen's first
 * render), so `dives` — and therefore this function's result — can change after mount. See
 * the render body below for how that reaches the live form via `useForm`'s `values`
 * option rather than `defaultValues` alone.
 */
function initialFormValues(mode: 'create' | 'edit', dives: Dive[]): DiveFormInput {
  if (mode !== 'create') return blankFormValues();
  const mostRecentLoggedDive = dives.find((d) => d.status === 'logged') ?? null;
  return { ...blankFormValues(), ...carryOverFrom(mostRecentLoggedDive) };
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

const ENTRY_OPTIONS: readonly Entry[] = ['shore', 'boat', 'other'];
const SALINITY_OPTIONS: readonly Salinity[] = ['salt', 'fresh', 'brackish'];
const WATER_BODY_OPTIONS: readonly WaterBody[] = ['ocean', 'lake', 'river', 'quarry', 'cave', 'pool'];
const SUIT_OPTIONS: readonly Suit[] = ['none', 'shorty', 'wet', 'semidry', 'dry'];
const MATERIAL_OPTIONS: readonly TankMaterial[] = ['steel', 'alu'];

function materialLabel(material: TankMaterial): string {
  return material === 'alu' ? 'Alu' : 'Steel';
}

type FormControl = Control<DiveFormInput, unknown, DiveFormValues>;

interface ControlledTextFieldProps {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  scheme: ColorScheme;
  keyboardType?: 'default' | 'decimal-pad';
  multiline?: boolean;
  placeholder?: string;
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

/** A free-text or numeric field, wired straight to `FormField` — `optionalNumber` and
 * `optionalText` (diveFormSchema.ts) both accept a bare string, so nothing here has to
 * pre-parse what the diver types. */
function ControlledTextField({
  control,
  name,
  label,
  scheme,
  keyboardType,
  multiline,
  placeholder,
  carriedPaths,
  onDropCarried,
}: ControlledTextFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
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
function OptionChips<T extends string>({ label, value, options, displayLabel, onChange, scheme }: OptionChipsProps<T>) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldHeader}>
        <Text style={styles.formFieldLabel}>{label}</Text>
      </View>
      <View style={styles.formChipRow}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <Pressable
              key={option}
              style={[styles.formChip, selected && styles.formChipSelected]}
              onPress={() => onChange(selected ? '' : option)}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${displayLabel(option)}`}
              accessibilityState={{ selected }}
            >
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
}

function ControlledOptionField<T extends string>({ control, name, label, options, displayLabel, scheme }: ControlledOptionFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <OptionChips
          label={label}
          value={field.value as unknown as T | '' | null | undefined}
          options={options}
          displayLabel={displayLabel}
          onChange={field.onChange}
          scheme={scheme}
        />
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
    <View style={styles.formFieldHeader}>
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
  );
}

interface ControlledBooleanFieldProps {
  control: FormControl;
  name: FieldPath<DiveFormInput>;
  label: string;
  scheme: ColorScheme;
}

function ControlledBooleanField({ control, name, label, scheme }: ControlledBooleanFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <BooleanField label={label} value={field.value as unknown as boolean | null | undefined} onChange={field.onChange} scheme={scheme} />
      )}
    />
  );
}

export interface DiveFormScreenProps {
  mode: 'create' | 'edit';
  /** Which dive `mode="edit"` is for. Unused until Task 7 wires real loading via
   * `useDives()` — this screen shell does not read it yet. */
  diveId?: string;
}

/** Shown when `createDive`'s write rejects (`onValid` below) — see `formSaveError`
 * (theme/styles.ts) for why this is not silent, and not a `disabled` save control either. */
const SAVE_ERROR_MESSAGE = "Couldn't save this dive. Try again.";

/**
 * The dive-entry form (DESIGN.md §2.2, M1d task 4): one scrollable form with a small
 * always-visible core strip — date, site, centre, max depth, duration — and everything
 * else behind six collapsible `FormGroup`s. **Only the date is required** (§2.2); every
 * other field, including a wholly untouched one, is a legitimate save.
 *
 * The save control (`formFooter` below) is never disabled — no `disabled` prop, no
 * `accessibilityState.disabled`, nothing computed from form validity — because §1's
 * "never block a save" binds the CONTROL itself, not just what happens after it is
 * pressed. `handleSubmit(onValid)` still runs `zodResolver(diveFormSchema)` underneath,
 * so a diver can always tap Save; a rejected `createDive` says so (`SAVE_ERROR_MESSAGE`)
 * instead of pretending it worked, and never touches the diver's typed values — §1's
 * "never block a save" cuts both ways, and losing what a diver already entered because
 * the disk was full is the other direction of the same failure.
 *
 * Creating a dive (`createDive`, `useDives()`, `carryOverFrom` applied to the diver's own
 * most recent LOGGED dive, and returning to the list on success — Task 6) is wired below
 * for `mode="create"`. `mode="edit"` (Task 7: editing, and completing a planned dive) is
 * still shell-only — `onValid` below does not write anything for it yet.
 */
export default function DiveFormScreen({ mode }: DiveFormScreenProps) {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();

  // The one read this screen needs for carry-over (useDives.ts's own "the one read every
  // screen uses") — never a second query, per this task's own brief. See
  // `initialFormValues`'s docblock for why `dives` (and therefore this) can change after
  // mount, and why that is handled below rather than assumed away.
  const { dives } = useDives();
  const initialValues = useMemo(() => initialFormValues(mode, dives), [mode, dives]);

  const { control, handleSubmit } = useForm<DiveFormInput, unknown, DiveFormValues>({
    resolver: zodResolver(diveFormSchema),
    defaultValues: initialValues,
    // `values`, not a second `defaultValues`: react-hook-form only ever reads
    // `defaultValues` once, at construction, so a create-mode carry-over that resolves
    // AFTER this component's first render (`useDives()` starts empty — see
    // `initialFormValues`) would otherwise never reach the form at all. `values` is
    // react-hook-form's own mechanism for exactly this "the real default arrives
    // asynchronously" case: it re-syncs whenever this reference changes (deep-equal
    // checked internally, so the fresh object `useMemo` returns each render is a no-op
    // once `dives` stops changing). `undefined` in edit mode leaves this exactly as inert
    // as it was before this task — Task 7's job, not this one's.
    values: mode === 'create' ? initialValues : undefined,
    // A field the diver has already typed into keeps what they typed rather than being
    // silently overwritten the moment the real carry-over data lands — only a field
    // nothing has touched yet is safe to re-sync.
    resetOptions: { keepDirtyValues: true },
  });

  // DESIGN.md §0.6's chip means "this came from your LAST DIVE" — that only applies to
  // a fresh entry. `mode="edit"` shows a dive's OWN stored data (Task 7), never
  // carry-over, so it starts (and, since nothing here ever adds to the set in edit
  // mode, stays) with nothing marked, regardless of what Task 7 later points
  // `defaultValues` at. Computed from THIS render's `initialValues`, exactly like
  // `useForm`'s own `values` above and for the same reason: `dives` (and so
  // `initialValues`) can still be the pre-load empty case the first time this runs.
  const [carriedPaths, setCarriedPaths] = useState<ReadonlySet<string>>(() =>
    mode === 'create' ? computeCarriedPaths(initialValues) : new Set<string>(),
  );
  // Which `initialValues` the `carriedPaths` state above was last derived from — lets the
  // block below tell "`useDives()`'s async read just resolved, re-derive" from "an ordinary
  // re-render" (a diver's own keystroke) without a `useEffect`. This is React's own
  // documented "Adjusting some state when a prop changes" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect), not the effect-plus-setState
  // round trip it exists to replace: an ESLint rule in this repo's config
  // (react-hooks/set-state-in-effect) already rejects that shape outright, and the pattern
  // below is the React team's own prescribed fix for it, not a workaround for the lint rule
  // alone. Calling `setState` here, during render rather than inside an effect, is safe
  // specifically because it is gated behind the reference check immediately below: React
  // discards this render and re-runs the component with the new state before anything
  // commits, rather than ever painting a stale frame.
  const [carriedPathsSource, setCarriedPathsSource] = useState(initialValues);
  if (initialValues !== carriedPathsSource) {
    setCarriedPathsSource(initialValues);
    setCarriedPaths(mode === 'create' ? computeCarriedPaths(initialValues) : new Set<string>());
  }

  // Shared by every carried `ControlledTextField` below (typing and the chip's `×`
  // alike) rather than one closure per field, so there is exactly one place that can
  // get a field's own drop logic wrong. Bails out via the setter's own no-op-on-same-
  // reference return when `name` was never in the set, rather than checking first and
  // conditionally calling `setCarriedPaths` — the same "read the LATEST state, don't
  // trust a value captured at render time" reasoning `ReorderControls.tsx` documents
  // for staying stateless, applied to a functional updater instead of a prop.
  const dropCarried = useCallback((name: FieldPath<DiveFormInput>) => {
    setCarriedPaths((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  // Non-null only while a save attempt has failed and not yet been retried — cleared at
  // the START of the next attempt (below), never on a timer or a dismiss tap, so it
  // reads as "still true" for exactly as long as it still is.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Same "no history to pop" guard `DiveDetailScreen.tsx`'s own `BackButton` uses
  // (`router.canGoBack()`), and for the same reason: this screen is reachable directly by
  // URL (a future share link or notification), where `router.back()` would have nothing
  // to do. `router.replace`, not `router.push`, so that fallback does not grow the stack.
  const returnToList = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  // `mode === 'edit'` is Task 7's job — completing/editing a specific dive via
  // `updateDive` — not this one's; this screen shell still runs `zodResolver` and reaches
  // this handler for it, but writes nothing yet, matching the shell's own docblock above.
  const onValid = async (values: DiveFormValues) => {
    if (mode !== 'create') return;
    setSaveError(null);
    try {
      await createDive(db, toNewDiveInput(values));
      returnToList();
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.formHeading}>{mode === 'edit' ? 'Edit dive' : 'New dive'}</Text>

        {/* Core strip (§2.2) — date, site, centre, max depth, duration, always visible. */}
        <View style={styles.formCoreStrip}>
          <ControlledTextField control={control} name="date" label="Date" scheme={scheme} placeholder="YYYY-MM-DD" />
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
            placeholder="m"
          />
          <ControlledTextField
            control={control}
            name="durationMin"
            label="Duration"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="min"
          />
        </View>

        <FormGroup title="Times & depth" scheme={scheme}>
          <ControlledTextField control={control} name="timeIn" label="Time in" scheme={scheme} placeholder="HH:MM" />
          <ControlledTextField control={control} name="avgDepthM" label="Avg depth" scheme={scheme} keyboardType="decimal-pad" placeholder="m" />
        </FormGroup>

        <FormGroup title="Conditions" scheme={scheme}>
          <ControlledTextField
            control={control}
            name="waterTempC"
            label="Water temp"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="°C"
          />
          <ControlledTextField control={control} name="airTempC" label="Air temp" scheme={scheme} keyboardType="decimal-pad" placeholder="°C" />
          <ControlledTextField
            control={control}
            name="visibilityM"
            label="Visibility"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="m"
          />
          <ControlledTextField control={control} name="waves" label="Waves" scheme={scheme} keyboardType="decimal-pad" placeholder="0-3" />
          <ControlledTextField control={control} name="current" label="Current" scheme={scheme} keyboardType="decimal-pad" placeholder="0-3" />
          <ControlledTextField control={control} name="surge" label="Surge" scheme={scheme} keyboardType="decimal-pad" placeholder="0-3" />
          <ControlledOptionField
            control={control}
            name="entry"
            label="Entry"
            options={ENTRY_OPTIONS}
            displayLabel={(option) => formatEntry(option) ?? option}
            scheme={scheme}
          />
          <ControlledOptionField
            control={control}
            name="salinity"
            label="Salinity"
            options={SALINITY_OPTIONS}
            displayLabel={(option) => formatSalinity(option) ?? option}
            scheme={scheme}
          />
          <ControlledOptionField
            control={control}
            name="waterBody"
            label="Water body"
            options={WATER_BODY_OPTIONS}
            displayLabel={(option) => formatWaterBody(option) ?? option}
            scheme={scheme}
          />
          <ControlledTextField control={control} name="latitude" label="Latitude" scheme={scheme} keyboardType="decimal-pad" />
          <ControlledTextField control={control} name="longitude" label="Longitude" scheme={scheme} keyboardType="decimal-pad" />
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
            options={MATERIAL_OPTIONS}
            displayLabel={materialLabel}
            scheme={scheme}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.sizeL"
            label="Size"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="L"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.count"
            label="Count"
            scheme={scheme}
            keyboardType="decimal-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.workingBar"
            label="Working pressure"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="bar"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.o2Pct"
            label="O2 %"
            scheme={scheme}
            keyboardType="decimal-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.hePct"
            label="He %"
            scheme={scheme}
            keyboardType="decimal-pad"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
          />
          <ControlledTextField
            control={control}
            name="tanks.0.startBar"
            label="Start pressure"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="bar"
          />
          <ControlledTextField
            control={control}
            name="tanks.0.endBar"
            label="End pressure"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="bar"
          />
        </FormGroup>

        <FormGroup title="Equipment" scheme={scheme}>
          <ControlledOptionField
            control={control}
            name="suit"
            label="Suit"
            options={SUIT_OPTIONS}
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
            placeholder="kg"
            carriedPaths={carriedPaths}
            onDropCarried={dropCarried}
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
          <ControlledTextField control={control} name="rating" label="Rating" scheme={scheme} keyboardType="decimal-pad" placeholder="1-5" />
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
        <Pressable style={styles.action} onPress={handleSubmit(onValid)} accessibilityRole="button" accessibilityLabel="Save dive">
          <Text style={styles.actionLabel}>Save dive</Text>
        </Pressable>
      </View>
    </View>
  );
}
