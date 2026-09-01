import { useRef, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DepthValue } from '../components/DepthValue';
import { db } from '../db/client';
import { softDeleteDive } from '../db/dives';
import { useDives } from '../db/useDives';
import { useUnitSystem } from '../db/useUnitSystem';
import { gasUsedLitres, mod, rmv, surfaceIntervalMin, timeOut, usedBar } from '../domain/derived';
import { splitPlanned } from '../domain/trips';
import { type Dive, type Tank } from '../domain/types';
import { backToDives } from '../navigation/leaveScreen';
import { completeDiveHref, editDiveHref } from '../navigation/editDiveLink';
import {
  diveSiteLabel,
  formatConditionScale,
  formatCoordinates,
  HE_LABEL,
  O2_LABEL,
  formatCount,
  formatDepth,
  formatDiveDate,
  formatDiveStatus,
  formatDuration,
  formatEntry,
  formatGasUsed,
  formatPercent,
  formatPressure,
  formatRating,
  formatRmv,
  formatSalinity,
  formatSuit,
  formatSurfaceInterval,
  formatTankMaterial,
  formatTemperature,
  formatVolume,
  formatWaterBody,
  formatWeight,
} from '../format/display';
import { type UnitSystem } from '../format/units';
import { confirmDestructive } from '../platform/confirmDestructive';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenTopInset, type Styles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * The dive detail screen (DESIGN.md §3) — rendered at route `/dive/[id]` via a thin
 * re-export in `src/app/dive/[id].tsx`; this file itself lives outside expo-router's
 * swept `src/app/` tree on purpose, so its colocated test isn't swept into the app
 * bundle too (see DivesScreen.tsx for the same shape and why it matters).
 *
 * The read is `useDives()` and nothing else, exactly as DivesScreen.tsx documents: the
 * dive shown here is found by `id` inside the list `useDives()` already returns, never
 * fetched with a second, independent query. A second read path is a second place the
 * dive shown here could disagree with the dive shown in the list it was tapped from —
 * this codebase has already paid for that class of mistake three times (diveNumber.ts's
 * docblock: "a logbook rendering dives numbered #2, #1, #3").
 *
 * Every field below is nullable except `date` and `status` (DESIGN.md §6), and a dive
 * carrying only a date is a normal, expected case (§1 — no form-shaming), not a broken
 * one: a field that is `null` is omitted outright, and a cluster whose every field is
 * `null` is omitted entirely, rather than either rendering as a placeholder dash or a
 * heading with nothing under it. `status` is shown unconditionally for the same reason
 * `date` is — there is always a real value to show, so there is nothing to omit — and is
 * what tells a planned dive's otherwise-sparse fields apart from a logged dive's.
 *
 * The six values `src/domain/derived.ts` computes (used pressure, gas used, RMV, MOD,
 * time out, surface interval) are never recomputed here — each is read from that module
 * directly (time out via `timeOut`, called once per tank for MOD and once for the dive for
 * the rest) and rendered only when the function actually returned a value. Those functions
 * return `null` precisely when their inputs were absent or contradictory; inventing a
 * displayed value in that case would defeat the safety reasoning they carry, so this
 * screen shows nothing there instead — never a NaN, never a dash standing in for the real
 * number. MOD is the one exception to "one row per value": `mod()` is called once per
 * tank, not once for the dive (DESIGN.md §10, "MOD is per cylinder, and there is no single
 * 'dive MOD'"), so it is read inside `tankFields` below rather than alongside gas-used/RMV.
 *
 * Time in and time out are two separate rows (M1c task 5), not the one merged
 * "09:15 – 09:59" range this screen used to show via `formatTimeRange`: half of that range
 * was the diver's own entry and half was worked out from it, and a single row can't be
 * marked as partly computed. `dive.timeIn` renders as-is — already the diver's own
 * "HH:MM", no formatter needed, the same way `whereFields` below renders `siteName`
 * straight — while "Time out" reads `timeOut()`'s own return.
 *
 * Every one of the six derived values carries the computed-value marker (§0.6): the rule
 * is *derived or entered*, with no exception for arithmetic simple enough to do in your
 * head — anything read from `src/domain/derived.ts` is marked, used pressure included,
 * for the same reason RMV is. `Row`'s `computed` prop (see below) is what turns the marker
 * on; it is independent of `mono` even though, on this screen today, every computed field
 * also happens to be one.
 *
 * The hero at the top of the screen (also M1c task 5, §0.6) is the same anchor idea
 * DiveRow.tsx's row gives a dive — depth, in its band colour, is the value that actually
 * differs dive to dive — read at detail scale: the site name, a `#number · date · centre`
 * mono sub-line (`heroSubline` below), and `<DepthValue variant="hero" />`. Every piece of
 * it is independently nullable (no site name, no assigned number for a planned dive, no
 * centre) except the date, which DESIGN.md §6 never allows to be null — so the sub-line
 * always has at least the date to show, and the screen never opens on a truly empty hero.
 *
 * No profile chart, sparkline, or other graphic is drawn (§0.4): no dive in this version
 * carries a real sample series, and this screen does not import anything that could draw
 * one.
 *
 * The screen supplies its own back control (BackButton, below) rather than relying on a
 * native header: `_layout.tsx` sets `headerShown: false` for the whole app, and flipping
 * that globally would also put a header on the Dives list, which the design does not call
 * for. See BackButton's own docblock for the rest of the reasoning.
 *
 * The screen also owns the dive's write actions (M1d tasks 7 and 8), and each says one thing:
 * *Edit* at the trailing edge of the top bar, for **every** dive, opening `/dive/[id]/edit` on
 * the dive's own status; *Complete dive* (§2.4) at the end of the content for a **planned**
 * dive only, opening that same form with the Logged/Planned control already on Logged; and
 * *Delete*, last, which confirms through platform chrome (`platform/confirmDestructive.ts`:
 * the OS `Alert` on a device, the browser's own dialog on web) and then tombstones the
 * dive (`softDeleteDive`). All three are described where they are built (`EditButton`,
 * `CompleteButton`, `runDelete`/`confirmDelete` below). The two links are `editDiveHref` and
 * `completeDiveHref` respectively — one module owns both ends of each (editDiveLink.ts), and
 * which control sends which is the single fact this area's tests exist to pin.
 *
 * **Three optional props, the first two added for M1b's wide (tablet) layout and the third
 * for the delete it needs, DivesScreen.tsx's own job to use — every other caller, i.e. the
 * real `/dive/[id]` route, passes none and gets exactly today's behaviour:**
 *
 * - `id` overrides the route's own `id` param. On a wide layout the diver never navigates
 *   to `/dive/[id]` at all — DivesScreen.tsx renders this component directly, beside the
 *   list, for whichever row is selected — so there is no route match to read an `id` from.
 *   This is the ONLY change that reuse needed: the search (`useDives()`, unchanged), the
 *   formatting and every cluster below are exactly the same code either way. The
 *   alternative — a second, list-aware detail view that duplicates this file's rendering —
 *   is exactly what this task's own brief rules out, and what this codebase's docblocks
 *   elsewhere already name as a repeat mistake.
 * - `showBackButton` (default `true`, so the routed case is unaffected) hides BackButton
 *   when `false`. Side by side, there is nothing to go back TO — the list is still on
 *   screen the entire time — and the `router.back()`/`canGoBack()` behind BackButton
 *   (`backToDives`, navigation/leaveScreen.ts) reads the app's real navigation stack,
 *   which embedding never pushed anything onto; showing it
 *   would either do nothing a diver could make sense of or, worse, leave the Dives screen
 *   entirely, since `canGoBack()` reports on whatever brought the app to `/`, not on
 *   whether a detail pane happens to be open next to it.
 * - `onDeleted` (default `backToDives`) replaces what happens after a successful delete,
 *   for the same reason and in the same one case: side by side there is nowhere to navigate
 *   to, so the embedded pane clears its own selection instead of leaving the Dives screen.
 */

/**
 * A label/value pair for one raw field, already formatted for display. `mono` selects IBM
 * Plex Mono for a data figure (a depth, pressure, duration, or timestamp — DESIGN.md
 * §0.2) versus Archivo for free text or a categorical label ("wet", a site name, a
 * buddy's name) — decided explicitly at each call site below rather than inferred from
 * the value's type, so a new field can't silently pick up the wrong one.
 *
 * `computed` (M1c task 5, default falsy) marks a value DESIGN.md §0.6 calls derived rather
 * than diver-entered: the rule is anything read from `src/domain/derived.ts`, with no
 * exception for arithmetic simple enough to do in your head — named here as the module,
 * not as a list of the values it currently exports, so this docblock can't go stale the
 * next time one is added. Set explicitly at each call site, the same reasoning `mono`
 * above already uses, rather than inferred from anything about the field itself.
 */
interface Field {
  label: string;
  value: string;
  mono: boolean;
  computed?: boolean;
}

/**
 * `computed` prefixes the value with a muted `=` and mutes+shrinks the value itself (§0.6,
 * revised M1c task 7: "prefixed with a muted `=`... a symbol that needs a legend has
 * already failed" — replacing an earlier 6 px outlined square that the owner read as a
 * broken glyph in the running app, DESIGN.md §10). The mark is a real sibling `Text`
 * reading exactly `=` — `styles.detailValueMark` — placed immediately before the value's
 * own `Text` inside one `detailValueWrap` row, never concatenated into the value's own
 * string: `value` reaches this component already formatted by `format/display.ts`, and
 * stays exactly that string whether or not `computed` is set, so nothing here can turn a
 * real "09:59" into an unparseable "= 09:59" for anything downstream that reads it back
 * out. `detailValueMark`'s fixed `width` is what keeps it a slot rather than letting it
 * push the value around — see that style's own comment in theme/styles.ts.
 */
function Row({ label, value, mono, computed, styles }: Field & { styles: Styles }) {
  const valueStyle = mono
    ? computed
      ? [styles.detailValue, styles.detailValueComputed]
      : styles.detailValue
    : styles.detailValueText;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>
        {computed && <Text style={styles.detailValueMark}>=</Text>}
        <Text style={valueStyle}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * One titled group of rows. Every cluster carries §0.6's hairline on its TOP edge, the same
 * rule `diveRow`/`dayStrip` follow in the list — so the line reads as the rule under the
 * cluster before it, and the last cluster closes on whitespace rather than a rule.
 *
 * `first` is the one exception, and it belongs to POSITION, not to any particular cluster:
 * the topmost cluster sits directly under the hero, which draws its own bottom border, so a
 * rule there too would render as a visible double line. Passed explicitly at the one call
 * site that is first rather than inferred here, because this component renders one cluster
 * at a time and has no way to know where it sits. (The alternative — the hero dropping its
 * own bottom border — is deliberately not taken: the hero is a full-bleed banner at 16 and
 * the clusters are an indented column at 20, and those two lines are not the same line.)
 */
function Cluster({
  title,
  styles,
  first,
  children,
}: {
  title: string;
  styles: Styles;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={first ? [styles.detailCluster, styles.detailClusterFirst] : styles.detailCluster}>
      <Text style={styles.detailClusterTitle}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * The screen's only exit besides the iOS edge-swipe gesture, which has no on-screen
 * affordance at all — undiscoverable, and the swipe itself isn't a 48 dp tap target
 * either way (§0.5). Rendered in both of this screen's branches (found and not-found):
 * a dive reached by an unknown id is exactly as much a dead end without this as a real
 * one would be, maybe more so since there's no content to scroll through either.
 *
 * Which navigation that actually performs — pop the stack, or replace to `/` when a deep
 * link left nothing to pop — belongs to `backToDives` (navigation/leaveScreen.ts), not to
 * this component. DiveFormScreen needs the identical rule on a successful save and used to
 * hold a character-for-character copy of it, under its own paragraph of the same reasoning;
 * that copy is gone and both screens call the one owner.
 */
function BackButton({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.detailBack}
      onPress={backToDives}
      accessibilityRole="button"
      accessibilityLabel="Back to dives"
    >
      <Text style={styles.detailBackLabel}>‹ Dives</Text>
    </Pressable>
  );
}

/** What the delete confirmation says. Held here rather than inline so the test can assert
 * on the same strings the diver reads, without either copy drifting. The body states the
 * consequence in the diver's terms — there is no undo in the app — rather than in the
 * schema's ("a tombstone is written", DESIGN.md §6, which is true and means nothing here). */
const DELETE_TITLE = 'Delete this dive?';
const DELETE_BODY = "It will be removed from your logbook. This can't be undone.";
const DELETE_ERROR_MESSAGE = "Couldn't delete this dive. Try again.";

/**
 * The dive's own action (M1d task 7), at the trailing edge of the top bar — where the back
 * control is the leading edge of the same row. Deleting deliberately does NOT sit beside it:
 * see `detailDelete` (theme/styles.ts) for why it lives at the end of the content instead.
 *
 * **It reads *Edit* for every dive, and sends `editDiveHref` for every dive** (M1d task 8).
 * There is no conditional here any more. It used to read *Complete dive* over
 * `completeDiveHref` for a planned dive, which left a planned dive with **no plain-edit
 * affordance at all**: a diver fixing a typo in a plan had to press "Complete dive" and then
 * flip the form's §2.4 control back to Planned. Reversible, and still the only button on the
 * screen saying something other than what they wanted. §2.4's *Complete dive* is now its own
 * control — `CompleteButton` below — so each label states one act and this one is honest for
 * a planned dive and a logged one alike.
 *
 * `editDiveHref` carries no `openAs`, which is exactly what "Edit" means: the form's
 * Logged/Planned control opens on whatever the dive already is, so editing a planned dive
 * leaves it planned. `editDiveLink.ts` owns both ends of that link — nothing here hand-builds
 * a route, and the form's own control is still the one place a status changes.
 *
 * The route is a typed template plus params rather than an interpolated path, and that is
 * the point: expo-router's typed routes (app.config.ts) check it against the routes that
 * actually exist on disk — and additionally require `id` — where a relative or hand-built
 * string is resolved at runtime and checked against nothing. Same reasoning
 * DivesScreen.tsx's own `logDive` records, and the same reason this pushes rather than
 * replaces (the diver goes back to this dive, not past it).
 */
function EditButton({ dive, styles }: { dive: Dive; styles: Styles }) {
  return (
    <Pressable
      style={styles.detailAction}
      onPress={() => router.push(editDiveHref(dive.id))}
      accessibilityRole="button"
      accessibilityLabel="Edit"
    >
      <Text style={styles.detailActionLabel}>Edit</Text>
    </Pressable>
  );
}

/**
 * §2.4's *Complete dive* — "After surfacing, Complete dive asks only for the missing
 * numbers" — for a planned dive and no other (M1d task 8). Rendered at the END of the
 * content, immediately above *Delete dive*, on the reasoning `detailDelete` (theme/styles.ts)
 * already records for itself: the two acts that operate on the whole dive belong together at
 * the end of a deliberate reach, not in the top bar where the thumb already is. Completing
 * does not thereby become harder to reach — the prominent pill on an "Up next" row in
 * DivesScreen is untouched, and that is the on-the-boat path.
 *
 * **It sends `completeDiveHref`, and that is the difference that matters.** That href puts
 * the form's Logged/Planned control on Logged, so saving actually finishes the dive; the
 * *Edit* control above sends `editDiveHref`, which carries no `openAs` at all. Sending the
 * plain edit link from under a "Complete dive" label would complete nothing while saying it
 * did — twice-shipped, and the whole defect this pair exists to close (DESIGN.md §10).
 * `editDiveLink.ts` owns both ends of both links; neither is hand-built here, and neither is
 * a second write path — the form's own §2.4 control remains the one place a status changes.
 *
 * Whether it renders at all is keyed at the call site on the dive's own `status`, never on
 * any display string, for the reason DESIGN.md §10 records for `splitPlanned`: that text is
 * bound for i18next and a rule reading it would stop firing the day it becomes Czech.
 *
 * The label is plain *Complete dive*, where DivesScreen's own pill names the dive it belongs
 * to (`Complete dive: Blue Hole`): there, a screen reader moves down a queue of planned dives
 * and needs to tell one from the next; here there is exactly one dive on screen, and it is
 * the one the heading above already named.
 */
function CompleteButton({ dive, styles }: { dive: Dive; styles: Styles }) {
  return (
    <View style={styles.detailCompleteRow}>
      <Pressable
        style={styles.detailComplete}
        onPress={() => router.push(completeDiveHref(dive.id))}
        accessibilityRole="button"
        accessibilityLabel="Complete dive"
      >
        <View style={styles.detailCompletePill}>
          <Text style={styles.detailCompleteLabel}>Complete dive</Text>
        </View>
      </Pressable>
    </View>
  );
}

/**
 * DESIGN.md §6's "Where" fields, under this screen's own cluster name "Site & centre". A
 * GPS row needs both coordinates together — a lone latitude or longitude isn't a point a
 * diver could read. `entry`/`salinity`/`waterBody` go through format/display.ts's
 * formatters rather than rendering the stored value directly — "shore"/"salt"/"quarry" are
 * the database's vocabulary, not the diver's.
 */
function whereFields(dive: Dive): Field[] {
  const fields: Field[] = [];
  if (dive.siteName !== null) fields.push({ label: 'Site', value: dive.siteName, mono: false });
  if (dive.centerName !== null) fields.push({ label: 'Centre', value: dive.centerName, mono: false });
  const entry = formatEntry(dive.entry);
  if (entry !== null) fields.push({ label: 'Entry', value: entry, mono: false });
  const salinity = formatSalinity(dive.salinity);
  if (salinity !== null) fields.push({ label: 'Salinity', value: salinity, mono: false });
  const waterBody = formatWaterBody(dive.waterBody);
  if (waterBody !== null) fields.push({ label: 'Water body', value: waterBody, mono: false });
  const coordinates = formatCoordinates(dive.latitude, dive.longitude);
  if (coordinates !== null) fields.push({ label: 'GPS', value: coordinates, mono: true });
  return fields;
}

/**
 * DESIGN.md §6's "Profile & conditions" fields, minus max/avg depth and duration, which
 * this screen groups into its own "Depth & duration" cluster instead. Water temp, air
 * temp and visibility go through `formatTemperature`/`formatDepth` (visibility is a
 * distance and therefore takes the same m/ft pair a depth does, at the same precision);
 * waves/current/surge go through
 * `formatConditionScale`, the bare 0–3 rating DESIGN.md §10 keeps unclamped, shown as the
 * diver recorded it rather than a formatted scale.
 */
function conditionsFields(dive: Dive, units: UnitSystem): Field[] {
  const fields: Field[] = [];
  const waterTemp = formatTemperature(dive.waterTempC, units);
  if (waterTemp !== null) fields.push({ label: 'Water temp', value: waterTemp, mono: true });
  const airTemp = formatTemperature(dive.airTempC, units);
  if (airTemp !== null) fields.push({ label: 'Air temp', value: airTemp, mono: true });
  const visibility = formatDepth(dive.visibilityM, units);
  if (visibility !== null) fields.push({ label: 'Visibility', value: visibility, mono: true });
  const waves = formatConditionScale(dive.waves);
  if (waves !== null) fields.push({ label: 'Waves', value: waves, mono: true });
  const current = formatConditionScale(dive.current);
  if (current !== null) fields.push({ label: 'Current', value: current, mono: true });
  const surge = formatConditionScale(dive.surge);
  if (surge !== null) fields.push({ label: 'Surge', value: surge, mono: true });
  return fields;
}

/**
 * DESIGN.md §6's "Equipment & people" fields. `hood`/`gloves`/`boots` are `boolean |
 * null`, and a recorded `false` ("no hood worn") is real diver-entered data, not the
 * absence of an answer — each is checked against `null` explicitly so a `false` still
 * renders as "No" instead of being swallowed the way `dive.hood && ...` would swallow it,
 * indistinguishable on screen from a field nobody ever filled in. That silent conflation
 * is exactly the form-shaming §1 rules out, just for a boolean instead of a number.
 */
function equipmentFields(dive: Dive, units: UnitSystem): Field[] {
  const fields: Field[] = [];
  const suit = formatSuit(dive.suit);
  if (suit !== null) fields.push({ label: 'Suit', value: suit, mono: false });
  if (dive.hood !== null) fields.push({ label: 'Hood', value: dive.hood ? 'Yes' : 'No', mono: false });
  if (dive.gloves !== null) fields.push({ label: 'Gloves', value: dive.gloves ? 'Yes' : 'No', mono: false });
  if (dive.boots !== null) fields.push({ label: 'Boots', value: dive.boots ? 'Yes' : 'No', mono: false });
  const weights = formatWeight(dive.weightsKg, units);
  if (weights !== null) fields.push({ label: 'Weights', value: weights, mono: true });
  if (dive.buddy !== null) fields.push({ label: 'Buddy', value: dive.buddy, mono: false });
  if (dive.guide !== null) fields.push({ label: 'Guide', value: dive.guide, mono: false });
  return fields;
}

/**
 * One cylinder's own fields, plus the pressure it used and that mix's own MOD.
 * `usedBar` is read from derived.ts, never recomputed here as `startBar - endBar`:
 * that arithmetic already lives there, along with the guards that make it refuse a
 * transposed or negative reading rather than report a false figure. `material`, `sizeL`,
 * `count`, `o2Pct` and `hePct` go through `format/display.ts`'s `formatTankMaterial`/
 * `formatVolume`/`formatCount`/`formatPercent` like every other field on this screen —
 * the module's own docblock is the single owner of turning an SI value into a string,
 * and a dedicated formatter per field is what closes that even for a field with no unit
 * conversion (§3's four pairs are depth, temperature, pressure and weight — `sizeL`,
 * `count` and the two gas fractions are none of them, so those three formatters take no
 * `units`; see format/units.ts for why a cylinder's size has no imperial counterpart).
 *
 * MOD is computed here, per tank, from that tank's own `o2Pct` — never once for the
 * dive. DESIGN.md §10: "MOD is per cylinder, and there is no single 'dive MOD'." A
 * bottom mix and a deco gas carry two different limits, both true at once; showing one
 * of them above the tank list (as M1b did, reading `tanks[0]` only) hid the other
 * silently. It sits right after O₂/He — the mix that produces it — and before the
 * pressure fields, which describe consumption, not the mix's own limit.
 *
 * MOD and `Used` (a few lines down) both carry `computed: true` (M1c task 5, §0.6): both
 * are read from derived.ts (`mod`, `usedBar`) rather than typed by the diver, and §0.6
 * draws no exception for either — anything in derived.ts is marked, full stop.
 */
function tankFields(tank: Tank, units: UnitSystem): Field[] {
  const fields: Field[] = [];
  // `formatTankMaterial`, never the raw stored word: `material` is the same closed
  // lowercase vocabulary as entry/salinity/suit, and this line used to render it as it is
  // stored while the form's own chip said "Steel" — the same cylinder reading two ways one
  // screen apart. format/display.ts owns that string for all five now.
  const material = formatTankMaterial(tank.material);
  if (material !== null) fields.push({ label: 'Material', value: material, mono: false });
  const size = formatVolume(tank.sizeL);
  if (size !== null) fields.push({ label: 'Size', value: size, mono: true });
  const count = formatCount(tank.count);
  if (count !== null) fields.push({ label: 'Count', value: count, mono: true });
  const working = formatPressure(tank.workingBar, units);
  if (working !== null) fields.push({ label: 'Working pressure', value: working, mono: true });
  // The two label constants, not two more string literals: the form spelled these `O2 %` and
  // `He %` — one cylinder reading two ways one screen apart, the same defect
  // `formatTankMaterial` above was introduced to close. See `O2_LABEL` (format/display.ts)
  // for which spelling won and where the `%` went.
  const o2 = formatPercent(tank.o2Pct);
  if (o2 !== null) fields.push({ label: O2_LABEL, value: o2, mono: true });
  const he = formatPercent(tank.hePct);
  if (he !== null) fields.push({ label: HE_LABEL, value: he, mono: true });
  const tankMod = formatDepth(mod(tank.o2Pct), units);
  if (tankMod !== null) fields.push({ label: 'MOD', value: tankMod, mono: true, computed: true });
  const start = formatPressure(tank.startBar, units);
  if (start !== null) fields.push({ label: 'Start pressure', value: start, mono: true });
  const end = formatPressure(tank.endBar, units);
  if (end !== null) fields.push({ label: 'End pressure', value: end, mono: true });
  const used = formatPressure(usedBar(tank), units);
  if (used !== null) fields.push({ label: 'Used', value: used, mono: true, computed: true });
  return fields;
}

/**
 * The chronologically previous LOGGED dive, for `surfaceIntervalMin` — or `undefined`
 * when there isn't one (the oldest dive in the logbook, or `dive` itself is planned and
 * so has no place in the logged sequence at all).
 *
 * `useDives()` hands back every live dive newest-date-first (db/dives.ts's `toDives`);
 * `splitPlanned` — already the one place that separates planned dives from logged ones,
 * reused rather than re-filtering by `status` here — preserves that order across its
 * `logged` half. So the dive that happened immediately BEFORE `dive` sits at the NEXT
 * index, not the previous one: `logged[i + 1]`, not `logged[i - 1]`. Getting this
 * backwards would silently pair `dive` with the dive that came after it instead of
 * before it — the same reversed-order shape diveNumber.ts's docblock names as the
 * milestone's recurring mistake ("a logbook rendering dives numbered #2, #1, #3").
 *
 * If the index direction above were ever wrong regardless, `surfaceIntervalMin`'s own
 * `interval >= 0` guard (derived.ts) is a second, independent line of defence: a reversed
 * index here can only ever hand it a "previous" dive that is chronologically AFTER
 * `dive`, and the guard rejects that for every pair whose date or time actually orders
 * them (see derived.test.ts's "transposed pair" case for a pinned example) — so the
 * failure mode stays a silently ABSENT surface-interval row, never a wrong-but-plausible
 * number.
 *
 * It does NOT reject a same-date, same-time pair — that is not a gap in the guard, it is
 * the guard being right. `compareDiveOrder`'s date and time tiers tie in that case, which
 * means the two dives carry no recorded chronology for any index direction to get right or
 * wrong; the 0-minute interval `surfaceIntervalMin` then returns is the truthful reading of
 * that, not a mis-pairing let through. (An earlier version of this comment claimed the
 * guard rejects "on every date/time combination" — that overstated it; this tie is the one
 * combination it was never meant to reject.)
 */
function previousLoggedDive(dives: Dive[], dive: Dive): Dive | undefined {
  const { logged } = splitPlanned(dives);
  const index = logged.findIndex((d) => d.id === dive.id);
  return index === -1 ? undefined : logged[index + 1];
}

/**
 * The hero's mono sub-line, e.g. "#6 · 22 Aug 2026 · Ponorka" — dive number, date, dive
 * centre, middot-separated. `number` comes from `useDives()`'s own `numbers` map (the same
 * one DiveRow.tsx and ReorderControls.tsx already read `numbers.get(dive.id)` from), not
 * recomputed here, for the identical reason this file's own top docblock gives for reading
 * the dive itself from that one hook: a second numbering path is a second place a number
 * shown here could disagree with the number the list showed for the same dive.
 *
 * The centre is also dropped when the heading above is ALREADY showing it: `diveSiteLabel`
 * falls back to the centre for a dive with no site name, so on that dive "Aqua" would
 * otherwise appear twice, one line apart. That case is recognised by comparing against the
 * label itself rather than by re-deriving "siteName is null" — the label's rule has one
 * owner, and a second statement of it here is exactly the drift item 5 exists to end.
 *
 * Number and centre are independently omitted when absent (`undefined` for a planned dive
 * per §2.4, `null` for a dive with no recorded centre) — filtered out before joining,
 * never rendered as an empty segment or a stray leading/trailing " · ". `formatDiveDate`
 * never returns null (`date` is the one field DESIGN.md §6 never allows to be absent), so
 * this is never itself the empty string: a dive with nothing else recorded still gets a
 * one-part sub-line, exactly the "only the date" case this file's own docblock (and its
 * test "shows nothing but the date and status for a dive with only a date") already treats
 * as a normal, expected dive rather than a broken one.
 */
function heroSubline(dive: Dive, number: number | undefined): string {
  const centre = diveSiteLabel(dive) === dive.centerName ? null : dive.centerName;
  return [number !== undefined ? `#${number}` : null, formatDiveDate(dive.date), centre]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

interface DiveDetailScreenProps {
  /** Overrides the route's own `id` param — see this file's top docblock. Absent (the real
   * `/dive/[id]` route) falls back to `useLocalSearchParams()`, exactly as before this prop
   * existed. */
  id?: string;
  /** Hides BackButton when `false`. Defaults to `true`, so the routed case is unaffected;
   * DivesScreen.tsx passes `false` for its embedded, side-by-side instance. See this file's
   * top docblock for why that instance has nothing for the control to go back to. */
  showBackButton?: boolean;
  /**
   * What happens after a successful delete (M1d task 7). Defaults to `backToDives` — the
   * routed case, where this screen sits on top of the list and the deleted dive must not be
   * left on screen.
   *
   * The wide (tablet) layout needs the other answer for the same reason `showBackButton`
   * exists: there is nothing to navigate away from, the list is already beside this pane,
   * and `router.back()` would leave the Dives screen entirely. DivesScreen.tsx passes a
   * callback that clears its own selection instead, so the pane returns to "Select a dive"
   * rather than sitting on "Dive not found."
   */
  onDeleted?: () => void;
}

export default function DiveDetailScreen({
  id: idProp,
  showBackButton = true,
  onDeleted = backToDives,
}: DiveDetailScreenProps = {}) {
  const scheme: ColorScheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  // How far down this screen's content begins, read off the device (`screenTopInset`,
  // theme/styles.ts — the app's one owner of that rule) rather than baked into the sheet.
  // Read here even when embedded in the wide layout's detail pane: the same provider answers
  // both, so this root and the list column's pinned bar beside it land on one line.
  //
  // The back control moves down ~14 pt on an island phone as a result. That is the
  // correction, not a regression: this container used to START inside the safe area, and the
  // control's own 48 dp tap floor (§0.5) absorbed enough of the difference to disguise it.
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = idProp ?? routeId;
  // `resolved` is read alongside the list because `dives` alone cannot say whether it has been
  // read yet — see the not-found branch below, and `DiveListState.resolved` for the mechanism.
  const { dives, numbers, resolved } = useDives();
  // The diver's units (§3), read here rather than taken as a prop even on the wide layout,
  // where DivesScreen renders this component directly: it is a preference, not something
  // the embedding screen decides, and a prop would be a second place that could disagree
  // with the rows beside it. Its own hook, never a field on `useDives()` — see
  // db/useUnitSystem.ts for why those two reads stay apart.
  const units = useUnitSystem();
  // Both halves of DESIGN.md §10's in-flight guard, for the same reason DiveFormScreen's
  // save carries them: `deletingRef` is what actually turns a second confirmation away
  // (written and read synchronously), and `deleting` is only how that is SHOWN, a render
  // flag that by definition lags a render behind. Declared before the not-found return
  // below, because a hook may not sit after a conditional return.
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  // Non-null only while a delete has failed and not yet been retried. A failed LOCAL write
  // is shown to the diver (§10: "A local save failure is shown to the diver") — the dive is
  // still here, and silently leaving it on screen as though nothing had been asked for
  // would be indistinguishable from a dead control.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dive = dives.find((d) => d.id === id);

  if (dive === undefined) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        {showBackButton && <BackButton styles={styles} />}
        <View style={styles.centerFill}>
          {/* **The sentence waits for an answer; the frame does not** (M1f). `useDives()` hands
              back an empty list on the renders before its query returns, which is why this
              branch is reached for a dive that exists — and "Dive not found." is then a claim
              about the database that nothing has yet asked the database. Said for a frame every
              time this screen opened, and correct only by accident: it was followed by the dive
              itself. M2 is what makes it dangerous rather than merely wrong — sync makes the
              first read slower, and §7's tombstones make "deleted on another device" a real
              answer, so the same sentence becomes plausible exactly when it is still a guess.

              What is drawn instead is this screen's frame with nothing in the middle of it,
              which is the honest render for "no answer yet": the way out above is rendered on
              BOTH branches and in both states (§0.6 — "a form with no visible way out was
              shipped once and only found by using the app"), and nothing moves when the sentence
              or the dive arrives under it. */}
          {resolved && <Text style={styles.messageText}>Dive not found.</Text>}
        </View>
      </View>
    );
  }

  // Soft, never hard (DESIGN.md §6): `softDeleteDive` writes the `deleted_at` tombstone
  // M2's sync needs to propagate the deletion, and every read already filters on it
  // (`liveDives`), so the dive disappears from the list and from numbering — every dive
  // above it renumbers, which is correct, because dive numbers are computed and never
  // stored (§2.5).
  const runDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await softDeleteDive(db, dive.id);
      onDeleted();
    } catch {
      setDeleteError(DELETE_ERROR_MESSAGE);
    } finally {
      // Released on both paths, so a failed delete leaves a control the diver can press
      // again rather than one that silently stopped working.
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  // A confirmation drawn by the platform, not by this app (M1d task 7, amendment C). That
  // is what resolves the tension with §0.1: the app's own surfaces stay monochrome, and the
  // danger signal belongs to OS chrome — the same way the keyboard's colours do — so this
  // screen's own control stays a plain muted label. Confirmation is not optional for this
  // one: it is the only action in the app that removes something.
  //
  // `platform/confirmDestructive.ts` owns *which* chrome: the platform `Alert` and its
  // `style: 'destructive'` button on a device, the browser's own dialog on web, where
  // `Alert` is an empty function and the dive was never deleted at all. This screen states
  // the question and what to do with the answer, and nothing about where it is drawn.
  const confirmDelete = () => {
    confirmDestructive({
      title: DELETE_TITLE,
      body: DELETE_BODY,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm: () => void runDelete(),
    });
  };

  const timeOutValue = timeOut(dive.timeIn, dive.durationMin);
  const previous = previousLoggedDive(dives, dive);
  const surfaceInterval = previous === undefined ? null : formatSurfaceInterval(surfaceIntervalMin(previous, dive));

  // Hero (§0.6, M1c task 5) — see heroSubline's own docblock for why `number` comes from
  // useDives()'s own map rather than being recomputed here.
  const number = numbers.get(dive.id);
  const heroSub = heroSubline(dive, number);

  const maxDepth = formatDepth(dive.maxDepthM, units);
  const avgDepth = formatDepth(dive.avgDepthM, units);
  const duration = formatDuration(dive.durationMin);
  const showDepthDuration = maxDepth !== null || avgDepth !== null || duration !== null;

  const where = whereFields(dive);
  const conditions = conditionsFields(dive, units);
  const equipment = equipmentFields(dive, units);

  const gasUsed = formatGasUsed(gasUsedLitres(dive.tanks));
  const rmvValue = formatRmv(rmv(dive));
  // No dive-level MOD here — DESIGN.md §10: "MOD is per cylinder, and there is no single
  // 'dive MOD'." Each tank computes its own inside tankFields below, from that tank's own
  // o2Pct; a multi-gas dive has as many MODs as it has distinct mixes, and picking one
  // (M1b read tanks[0] only) silently hid the rest.
  //
  // Tank rows and the two summary rows above are all formatted before this decides whether
  // the cluster shows at all. Every other cluster on this screen already gates on computed
  // presence (where.length, showDepthDuration, conditions.length, hasNotes below); this one
  // used to be the exception, gating on raw `dive.tanks.length > 0` instead — safe only
  // while every tank field rendered unconditionally. Now that non-finite fields correctly
  // disappear (Important #1), a tank whose only recorded fields were non-finite would
  // otherwise leave this heading standing over zero rows, the same "heading with nothing
  // under it" shape this screen's own "omits a cluster heading entirely..." test already
  // guards for its siblings.
  const tankGroups = dive.tanks.map((tank, index) => ({ index, fields: tankFields(tank, units) }));
  const showGasCluster = gasUsed !== null || rmvValue !== null || tankGroups.some((t) => t.fields.length > 0);

  const rating = formatRating(dive.rating);
  const hasNotes = dive.title !== null || dive.notes !== null || rating !== null;

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      {/* The way out and the dive's own action, as one row above the hero. `EditButton` is
          rendered regardless of `showBackButton`: on the wide layout there is nothing to go
          back TO, but editing the dive on screen is exactly as valid there as it is here. */}
      <View style={styles.detailTopBar}>
        {showBackButton && <BackButton styles={styles} />}
        <EditButton dive={dive} styles={styles} />
      </View>
      <ScrollView style={styles.detailScroll}>
        <View style={styles.detailHero}>
          <View style={styles.detailHeroMain}>
            {/* Unconditional, and `diveSiteLabel` rather than `dive.siteName`: this screen
                used to render a heading only `if (dive.siteName !== null)`, so a dive the
                list called "Unnamed site" opened on a page with no title at all. That rule
                has one owner now (format/display.ts), which always produces text — see its
                docblock for why it is not the same rule as `tripKeyOf`. */}
            <Text style={styles.detailHeroSite}>{diveSiteLabel(dive)}</Text>
            <Text style={styles.detailHeroSub}>{heroSub}</Text>
          </View>
          <DepthValue metres={dive.maxDepthM} scheme={scheme} units={units} variant="hero" />
        </View>

        <View style={styles.detailContent}>
          {/* The one cluster that always renders (Status and Date are never null, §6), so
              `first` is a fixed prop here rather than an index the list of clusters below
              would have to compute — every other cluster is conditional, and the topmost
              one is this one either way. */}
          <Cluster title="Date & time" styles={styles} first>
            <Row label="Status" value={formatDiveStatus(dive.status)} mono={false} styles={styles} />
            <Row label="Date" value={formatDiveDate(dive.date)} mono styles={styles} />
            {dive.timeIn !== null && <Row label="Time in" value={dive.timeIn} mono styles={styles} />}
            {timeOutValue !== null && (
              <Row label="Time out" value={timeOutValue} mono computed styles={styles} />
            )}
            {surfaceInterval !== null && (
              <Row label="Surface interval" value={surfaceInterval} mono computed styles={styles} />
            )}
          </Cluster>

          {where.length > 0 && (
            <Cluster title="Site & centre" styles={styles}>
              {where.map((f) => (
                <Row key={f.label} {...f} styles={styles} />
              ))}
            </Cluster>
          )}

          {showDepthDuration && (
            <Cluster title="Depth & duration" styles={styles}>
              {maxDepth !== null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Max depth</Text>
                  <DepthValue metres={dive.maxDepthM} scheme={scheme} units={units} />
                </View>
              )}
              {avgDepth !== null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Avg depth</Text>
                  <DepthValue metres={dive.avgDepthM} scheme={scheme} units={units} />
                </View>
              )}
              {duration !== null && <Row label="Duration" value={duration} mono styles={styles} />}
            </Cluster>
          )}

          {conditions.length > 0 && (
            <Cluster title="Conditions" styles={styles}>
              {conditions.map((f) => (
                <Row key={f.label} {...f} styles={styles} />
              ))}
            </Cluster>
          )}

          {showGasCluster && (
            <Cluster title="Gas & cylinders" styles={styles}>
              {gasUsed !== null && <Row label="Gas used" value={gasUsed} mono computed styles={styles} />}
              {rmvValue !== null && <Row label="RMV" value={rmvValue} mono computed styles={styles} />}
              {tankGroups.map(({ index, fields }) => {
                if (fields.length === 0) return null;
                return (
                  <View key={index} style={styles.detailTank}>
                    <Text style={styles.detailTankTitle}>
                      {dive.tanks.length > 1 ? `Cylinder ${index + 1}` : 'Cylinder'}
                    </Text>
                    {fields.map((f) => (
                      <Row key={f.label} {...f} styles={styles} />
                    ))}
                  </View>
                );
              })}
            </Cluster>
          )}

          {equipment.length > 0 && (
            <Cluster title="Equipment & people" styles={styles}>
              {equipment.map((f) => (
                <Row key={f.label} {...f} styles={styles} />
              ))}
            </Cluster>
          )}

          {hasNotes && (
            <Cluster title="Notes" styles={styles}>
              {dive.title !== null && <Row label="Title" value={dive.title} mono={false} styles={styles} />}
              {rating !== null && <Row label="Rating" value={rating} mono styles={styles} />}
              {dive.notes !== null && <Text style={styles.detailNotes}>{dive.notes}</Text>}
            </Cluster>
          )}

          {/* §2.4's *Complete dive*, for a planned dive only (M1d task 8) — see
              CompleteButton above for why it sits here rather than in the top bar, and why
              it sends `completeDiveHref` where the top bar's *Edit* sends `editDiveHref`.
              Above Delete, not below it: finishing a dive is the ordinary next thing to do
              with a plan, and the one destructive act stays last. */}
          {dive.status === 'planned' && <CompleteButton dive={dive} styles={styles} />}

          {/* Deleting (M1d task 7, amendment C). At the END of the content and inside the
              scroll, below every cluster: a deliberate act on one dive you are looking at,
              which is also why it lives here rather than on a row in the list. A plain muted
              label — the red is the confirmation dialog's, not this app's (§0.1). */}
          {deleteError !== null && (
            <View style={styles.detailDeleteError}>
              <Text style={styles.detailDeleteErrorText}>{deleteError}</Text>
            </View>
          )}
          <Pressable
            style={styles.detailDelete}
            onPress={confirmDelete}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel="Delete dive"
            accessibilityState={{ disabled: deleting }}
          >
            <Text style={styles.detailDeleteLabel}>Delete dive</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
