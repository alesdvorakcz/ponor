import { Controller, useForm, type Control, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '../components/FormField';
import { FormGroup } from '../components/FormGroup';
import { diveFormSchema, type DiveFormValues } from '../domain/diveFormSchema';
import { type Entry, type Salinity, type Suit, type TankMaterial, type WaterBody } from '../domain/types';
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
 * cylinder until '+ add cylinder' is tapped," DESIGN.md §6). Task 6 layers
 * `carryOverFrom(mostRecentLoggedDive)` on top of this for a real diver's second dive
 * onward; this screen does not read `useDives()` itself.
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
}

/** A free-text or numeric field, wired straight to `FormField` — `optionalNumber` and
 * `optionalText` (diveFormSchema.ts) both accept a bare string, so nothing here has to
 * pre-parse what the diver types. */
function ControlledTextField({ control, name, label, scheme, keyboardType, multiline, placeholder }: ControlledTextFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FormField
          ref={field.ref}
          label={label}
          value={toInputString(field.value)}
          onChange={field.onChange}
          onBlur={field.onBlur}
          scheme={scheme}
          keyboardType={keyboardType}
          multiline={multiline}
          placeholder={placeholder}
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
 * so a diver can always tap Save; what happens next depends on whether a real date has
 * been entered, exactly as it would once Task 6/7 wire persistence.
 *
 * Creating vs editing a specific dive (`createDive`/`updateDive`, `useDives()`,
 * `carryOverFrom` applied to a real previous dive, and navigating away after a save) are
 * Task 6 and Task 7's job, not this one's — see their own briefs. This screen shell
 * builds the form itself: the fields, the groups, and a save control that can always be
 * reached.
 */
export default function DiveFormScreen({ mode }: DiveFormScreenProps) {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();

  const { control, handleSubmit } = useForm<DiveFormInput, unknown, DiveFormValues>({
    resolver: zodResolver(diveFormSchema),
    defaultValues: blankFormValues(),
  });

  // Intentionally empty: wiring `createDive`/`updateDive` and navigating away on success
  // is Task 6 ("Creating a dive") and Task 7 ("Editing, and completing a planned dive"),
  // not this screen shell's job — see those briefs' own "Consumes" lines. What matters
  // here is that `handleSubmit` runs `zodResolver(diveFormSchema)` cleanly and the
  // control that triggers it is always reachable.
  const onValid = (_values: DiveFormValues) => {};

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.formHeading}>{mode === 'edit' ? 'Edit dive' : 'New dive'}</Text>

        {/* Core strip (§2.2) — date, site, centre, max depth, duration, always visible. */}
        <View style={styles.formCoreStrip}>
          <ControlledTextField control={control} name="date" label="Date" scheme={scheme} placeholder="YYYY-MM-DD" />
          <ControlledTextField control={control} name="siteName" label="Site" scheme={scheme} />
          <ControlledTextField control={control} name="centerName" label="Centre" scheme={scheme} />
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
          <ControlledTextField control={control} name="tanks.0.sizeL" label="Size" scheme={scheme} keyboardType="decimal-pad" placeholder="L" />
          <ControlledTextField control={control} name="tanks.0.count" label="Count" scheme={scheme} keyboardType="decimal-pad" />
          <ControlledTextField
            control={control}
            name="tanks.0.workingBar"
            label="Working pressure"
            scheme={scheme}
            keyboardType="decimal-pad"
            placeholder="bar"
          />
          <ControlledTextField control={control} name="tanks.0.o2Pct" label="O2 %" scheme={scheme} keyboardType="decimal-pad" />
          <ControlledTextField control={control} name="tanks.0.hePct" label="He %" scheme={scheme} keyboardType="decimal-pad" />
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
          <ControlledTextField control={control} name="weightsKg" label="Weights" scheme={scheme} keyboardType="decimal-pad" placeholder="kg" />
        </FormGroup>

        <FormGroup title="People" scheme={scheme}>
          <ControlledTextField control={control} name="buddy" label="Buddy" scheme={scheme} />
          <ControlledTextField control={control} name="guide" label="Guide" scheme={scheme} />
        </FormGroup>

        <FormGroup title="Notes & rating" scheme={scheme}>
          <ControlledTextField control={control} name="title" label="Title" scheme={scheme} />
          <ControlledTextField control={control} name="notes" label="Notes" scheme={scheme} multiline />
          <ControlledTextField control={control} name="rating" label="Rating" scheme={scheme} keyboardType="decimal-pad" placeholder="1-5" />
        </FormGroup>
      </ScrollView>

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
