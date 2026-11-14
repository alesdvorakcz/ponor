import { useRef, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Modal, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DepthProfile } from '../components/DepthProfile';
import { DepthValue } from '../components/DepthValue';
import { MapCard } from '../components/MapCard';
import { symbolName } from '../components/symbolName';
import { db } from '../db/client';
import { softDeleteDive } from '../db/dives';
import { useDives } from '../db/useDives';
import { useDiveSamples } from '../db/useDiveSamples';
import { useUnitSystem } from '../db/useUnitSystem';
import { gasUsedLitres, mod, nitrogenPct, rmv, surfaceIntervalMin, timeOut, usedBar } from '../domain/derived';
import { importerLabelFor } from '../domain/import/registry';
import { drawsOnMap, pointOf, type MapPoint } from '../domain/mapSites';
import { splitPlanned } from '../domain/trips';
import { type Dive, type Tank } from '../domain/types';
import { backToDives } from '../navigation/leaveScreen';
import { completeDiveHref, editDiveHref } from '../navigation/editDiveLink';
import {
  diveSiteLabel,
  // The three 0–3 condition scales, in the words the form's chips offer (M1h).
  formatWaves,
  formatCurrent,
  formatSurge,
  formatCoordinates,
  HE_LABEL,
  N2_LABEL,
  O2_LABEL,
  formatConfiguration,
  formatDepth,
  formatDiveDate,
  formatDiveStatus,
  formatDuration,
  formatEntry,
  formatEquipment,
  formatGasUsed,
  formatPercent,
  formatPressure,
  formatRating,
  formatRmv,
  formatSalinity,
  formatSuit,
  formatSuitThickness,
  formatSurfaceInterval,
  formatTankMaterial,
  formatTemperature,
  formatVisibility,
  formatVolume,
  formatWaterBody,
  formatWeather,
  formatWeight,
  formatWeightsFeel,
  METADATA_SEPARATOR,
} from '../format/display';
import { type UnitSystem } from '../format/units';
import { t, useT } from '../i18n';
import { confirmDestructive } from '../platform/confirmDestructive';
import { openInMaps } from '../platform/mapsLink';
import { showOnMap } from '../platform/showOnMap';
import { resolveScheme, themeFor } from '../theme/resolve';
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
 * differs dive to dive — read at detail scale, and since issue #3 drawn as the owner's design
 * canvas draws it: the number on a line of its own, the site name, a `date · time · centre`
 * mono sub-line (`heroSubline` below), and `<DepthValue variant="hero" />`. Every piece of
 * it is independently nullable (no site name, no assigned number for a planned dive, no time,
 * no centre) except the date, which DESIGN.md §6 never allows to be null — so the sub-line
 * always has at least the date to show, and the screen never opens on a truly empty hero.
 *
 * §0.4's depth profile is drawn here, between the hero and the first cluster — the space
 * that rule reserved for it and left empty until a dive could carry a real sample series.
 * `<DepthProfile>` (components/DepthProfile.tsx) owns everything about the drawing; this
 * screen owns only the read, `useDiveSamples(id)`, because a screen reads and a component
 * takes the answer as a prop (db/useUnitSystem.ts's standing rule), and because that is what
 * keeps the card testable without a database under it.
 *
 * **What that does not license.** §0.4's other half is untouched: nothing is drawn that was
 * not measured. The card renders `null` for a dive with no series, for a series too short to
 * stroke, and for one with no elapsed time in it — no placeholder, no skeleton, and no
 * reserved space where it would have been, so a hand-logged dive opens on exactly the screen
 * it always did. That judgement lives in the component and is deliberately not repeated here:
 * this screen cannot ask "will it draw?" without owning a second copy of a rule §4.1 says has
 * one owner.
 *
 * **The first cluster sits flush under the card either way, and that is the same rule.**
 * `detailClusterHeaderFirst` drops the cluster's 22 of air because the hero and every card above
 * it close on their own; whether the profile card drew does not change that, so the screen never
 * has to ask. The one thing that does is the `Imported from` row, which is this screen's own
 * decision to draw and closes on no air of its own (issue #3).
 *
 * Beneath the card sits §7's `Imported from` row: the dive computer the dive was read off
 * (`importDevice`), falling back to the importer's own label (`importerLabelFor`) where the
 * export never named a model. That fallback is not defensive tidiness — it is the permanent
 * state of every dive imported before the column existed, because dedupe means re-running the
 * same files writes nothing. Absent entirely for a dive the diver logged by hand, like every
 * other null field on this screen, and **carrying no chevron**: §0.6 spends that mark on
 * in-place disclosure and never on navigation, and there is nowhere to navigate to. It is a
 * row of its own rather than part of the card, because the two are independent — a computer
 * can export a dive with no profile in it — and because the provenance is a fact about the
 * dive, not a caption under a drawing.
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
 * *Delete*, behind ⋯ in the record's own sheet since issue #3, which confirms through platform
 * chrome (`platform/confirmDestructive.ts`: the OS `Alert` on a device, the browser's own dialog
 * on web) and then tombstones the dive (`softDeleteDive`). All three are described where they
 * are built (`EditButton`, `CompleteButton`, `RecordActionsSheet`, `runDelete`/`confirmDelete`
 * below). The two links are `editDiveHref` and
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
  /**
   * Where pressing this row goes, for the two rows on this screen that go anywhere: the **centre**
   * (M3c) and the **site** (M3f), each when §6's `*_id` pairs the dive to a catalogue row.
   *
   * **Present only when the dive carries an id**, which is the whole rule and is worth stating
   * because the other case is the ordinary one. §6 stores each id *and* a name snapshot; a place
   * typed by hand and never published has the snapshot and no id, so there is no row to open and
   * the row stays exactly what it was — text. That is not a degraded state: §2.3 makes a name-only
   * place the normal case, and every dive logged before M2o has one.
   *
   * A dive whose id names a row this device does not hold — an admin has hidden it, or a pull has
   * not brought it down — still gets the link, and that row's page says it could not find it. That
   * is `DiveDetailScreen`'s own shape for a dive reached by an unknown id, one screen along, rather
   * than a second rule: the alternative is reading the whole catalogue here to decide whether one
   * row may be pressed, which makes the dive detail depend on tables it otherwise never touches.
   */
  opens?: Href;
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
function Row({ label, value, mono, computed, opens, styles }: Field & { styles: Styles }) {
  const valueStyle = mono
    ? computed
      ? [styles.detailValue, styles.detailValueComputed]
      : styles.detailValue
    : styles.detailValueText;
  const contents = (
    <>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>
        {computed && <Text style={styles.detailValueMark}>=</Text>}
        <Text style={valueStyle}>{value}</Text>
      </View>
    </>
  );
  // **A row that goes somewhere is a Pressable, at the same height as every other row** (M3k,
  // then issue #3). M3c shipped it with no tap target, and the owner measured a ~9 pt band
  // between the *Site* and *Centre* rows where a press was swallowed; M3k gave it §0.5's floor,
  // and since #3 every row on this screen is the canvas's 48, so the floor is simply the row. A
  // taller pressable row was tried as the cue for "this opens a page" and read as uneven spacing
  // on the device; that cue is issue #5's. The announcement says what pressing does rather than
  // what the row is called, Settings' rule for every row that opens something.
  if (opens === undefined) return <View style={styles.detailRow}>{contents}</View>;
  return (
    <Pressable
      style={styles.detailRow}
      onPress={() => router.push(opens)}
      accessibilityRole="button"
      accessibilityLabel={t('common.open', { name: value })}
    >
      {contents}
    </Pressable>
  );
}

/**
 * One titled group of rows: its label, then the rows, each of which draws its own hairline on its
 * top edge (`detailRow`) — so the first row's line is the rule under the label, and the cluster
 * ends on its last row with nothing beneath it, the next cluster's 22 of air doing the separating
 * (issue #3, the canvas's `clusterLabel.padTop 22 between groups`).
 *
 * `first` drops that 22 for the cluster that begins right under the hero or a card, both of which
 * close on their own air already. It belongs to POSITION rather than to any cluster, and is passed
 * by the one call site that knows what is above it, because this component renders one cluster at
 * a time and cannot see.
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
    <View>
      <View style={first ? [styles.detailClusterHeader, styles.detailClusterHeaderFirst] : styles.detailClusterHeader}>
        <Text style={styles.detailClusterTitle}>{title}</Text>
      </View>
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
 *
 * **It says *Back* rather than *‹ Dives*, and this screen is where that mistake started** (M3k).
 * It read *‹ Dives* from M1c, when the list was the only way in; there are five now — the list,
 * full-screen search, the Map's own sheet, a site's page and a centre's page — and `leaveTo` pops
 * the stack, so on four of them the label was naming a screen the diver had not just been on. M3c
 * then cited it as the precedent for the centre page's *‹ Centres* and M3f for the site's, which
 * is how one screen's stale label became three. **A way out names a destination only when the
 * screen has exactly one way in**; `/` inside `backToDives` is the cold-deep-link fallback, not a
 * promise this control may make. The account screen keeps *‹ Settings* on exactly that test.
 */
function BackButton({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.detailBack}
      onPress={backToDives}
      accessibilityRole="button"
      accessibilityLabel={t('back.anyLabel')}
    >
      <Text style={styles.detailBackLabel}>{t('back.any')}</Text>
    </Pressable>
  );
}

/** What the delete confirmation says. Held here rather than inline so the test can assert
 * on the same strings the diver reads, without either copy drifting. The body states the
 * consequence in the diver's terms — there is no undo in the app — rather than in the
 * schema's ("a tombstone is written", DESIGN.md §6, which is true and means nothing here). */
function deleteTitle(): string {
  return t('detail.deleteTitle');
}
function deleteBody(): string {
  return t('detail.deleteBody');
}
function deleteErrorMessage(): string {
  return t('detail.deleteFailed');
}

/**
 * The dive's own action (M1d task 7), at the trailing edge of the top bar — where the back
 * control is the leading edge of the same row. Deleting does not sit beside it: it is behind ⋯,
 * in the record's own sheet (`RecordActionsSheet`, issue #3), two deliberate presses away.
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
      accessibilityLabel={t('detail.edit')}
    >
      <Text style={styles.detailActionLabel}>{t('detail.edit')}</Text>
    </Pressable>
  );
}

/**
 * §2.4's *Complete dive* — "After surfacing, Complete dive asks only for the missing
 * numbers" — for a planned dive and no other (M1d task 8). Rendered at the END of the
 * content: an act on the whole dive belongs at the end of a deliberate reach, not in the top bar
 * where the thumb already is (`detailCompleteRow`, theme/styles.ts). Completing
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
        accessibilityLabel={t('dives.completeDive')}
      >
        <View style={styles.detailCompletePill}>
          <Text style={styles.detailCompleteLabel}>{t('dives.completeDive')}</Text>
        </View>
      </Pressable>
    </View>
  );
}

/**
 * ⋯ — the way into the record's own actions (issue #3, the owner's design canvas), beside *Edit*
 * at the trailing edge of the top bar. *Edit* changes what the dive says; what sits behind this
 * acts on the record itself, and today that is deleting it (see `RecordActionsSheet`).
 *
 * Disabled while a delete is in flight, which is the one thing this can start: the sheet has
 * closed by then, and a second press would offer to delete a dive that is already going.
 */
function MoreButton({ styles, onPress, disabled }: { styles: Styles; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      style={styles.detailMore}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t('detail.moreActions')}
      accessibilityState={{ disabled }}
    >
      <View style={styles.detailMoreDots}>
        <View style={styles.detailMoreDot} />
        <View style={styles.detailMoreDot} />
        <View style={styles.detailMoreDot} />
      </View>
    </Pressable>
  );
}

/**
 * **The record's actions, in a sheet** (issue #3; `recordSheet` in theme/styles.ts has the canvas's
 * geometry and why the destructive act is never coloured).
 *
 * The canvas draws three actions here and v1 has one. *Duplicate as new dive* was cut in M1e
 * (§10 — carry-over already prefills the next dive from the last) and *Export this dive · UDDF*
 * is on §9's post-release shelf, so neither is drawn: a sheet offering an act the app cannot do
 * is worse than a short sheet. What is left is *Delete dive*, which used to be a muted label at
 * the end of the content — the canvas's reason for moving it is that the palette cannot warn you,
 * so the one act that removes something should take two deliberate presses and the platform's
 * confirmation rather than one press at the foot of a scroll.
 *
 * The confirmation is raised OVER the sheet and the sheet closes only once it is answered yes:
 * backing out of the dialog leaves the diver where they were, one Cancel from the dive. A plain
 * React Native `Modal`, the app's first — it holds no gesture-handler gesture, which is the one
 * thing `_layout.tsx` notes a modal would need a second gesture root for.
 */
function RecordActionsSheet({
  styles,
  scheme,
  title,
  meta,
  onDelete,
  onClose,
}: {
  styles: Styles;
  scheme: ColorScheme;
  title: string;
  meta: string;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* The scrim is the whole screen behind the sheet, and pressing it closes the sheet the way
          an iOS sheet closes — a wet thumb aiming for the dive behind it should not have to find
          Cancel first. It says so to a screen reader in the app's own word for closing. */}
      <Pressable
        style={styles.recordSheetScrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />
      <View style={styles.recordSheet} accessibilityViewIsModal>
        <View style={styles.recordSheetHeader}>
          <Text style={styles.recordSheetTitle}>{title}</Text>
          <Text style={styles.recordSheetMeta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Pressable
          style={styles.recordSheetAction}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={t('detail.deleteLabel')}
          accessibilityHint={t('detail.deleteCost')}
        >
          <SymbolView name={symbolName({ ios: 'trash', android: 'delete' })} size={20} tintColor={themeFor(scheme).fg} />
          <View style={styles.recordSheetActionText}>
            <Text style={styles.recordSheetActionLabel}>{t('detail.deleteLabel')}</Text>
            <Text style={styles.recordSheetActionMeta}>{t('detail.deleteCost')}</Text>
          </View>
        </Pressable>
        <Pressable
          style={styles.recordSheetCancel}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        >
          <Text style={styles.recordSheetCancelLabel}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/**
 * **Where the dive's "Show on map" card goes** (issue #3 drew the card; issue #21 gave it Ponor's
 * own map). The card itself is `components/MapCard.tsx`, shared with a site's and a centre's page;
 * it sits in place of the GPS row that used to state the two numbers in Site & centre.
 *
 * **A dive the map draws opens Ponor's map, pointed at it** (`platform/showOnMap.ts`), with its
 * place selected and the place's sheet up. **A planned dive opens the device's maps instead**, as
 * every dive did before #21: §2.4 keeps a plan off the map, so Ponor's map has no mark to point at,
 * and a map centred on nothing would look broken — the issue's own words about a focus that is not
 * drawn. A plan is also somewhere a diver is *going*, which is what the device's maps are for.
 *
 * Whether the map draws the dive is `drawsOnMap`'s answer (domain/mapSites.ts), asked of the
 * function that does the drawing rather than restated here as a status check.
 */
function showDiveOnMap(dive: Dive, point: MapPoint): void {
  const label = diveSiteLabel(dive);
  if (drawsOnMap(dive)) showOnMap({ kind: 'dive', id: dive.id }, point, label);
  else openInMaps(point, label);
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
  if (dive.siteName !== null) {
    // **The link is the id's, never the snapshot's** (M3f, on M3c's own rule one column over).
    // §6 pairs `site_id` with a `site_name` snapshot; a site typed by hand and never published has
    // the snapshot and no id, so there is no row to open and the row stays exactly what it was —
    // text. That is the ordinary case rather than a fault: §2.3 only started publishing sites in
    // M2o, and every dive logged before it is one.
    fields.push({
      label: t('field.site'),
      value: dive.siteName,
      mono: false,
      opens: dive.siteId === null ? undefined : `/site/${dive.siteId}`,
    });
  }
  if (dive.centerName !== null) {
    // **The link is the id's, never the snapshot's** (M3c). §6 pairs `center_id` with a
    // `center_name` snapshot, and `Field.opens` above carries why a dive with only the snapshot
    // has nowhere to go: the centre was typed by hand and never published, which §2.3 makes the
    // ordinary case rather than a fault. The row is the same row either way.
    fields.push({
      label: t('field.centre'),
      value: dive.centerName,
      mono: false,
      opens: dive.centerId === null ? undefined : `/center/${dive.centerId}`,
    });
  }
  const entry = formatEntry(dive.entry);
  if (entry !== null) fields.push({ label: t('field.entry'), value: entry, mono: false });
  const salinity = formatSalinity(dive.salinity);
  if (salinity !== null) fields.push({ label: t('field.salinity'), value: salinity, mono: false });
  const waterBody = formatWaterBody(dive.waterBody);
  if (waterBody !== null) fields.push({ label: t('field.waterBody'), value: waterBody, mono: false });
  // **The position is the map card's now** (issue #3), not a row: the card carries the same two
  // numbers under "Show on map". A pair `pointOf` refuses — finite but off the globe, which only a
  // future client or a hand-edited sync could write — is not a place a map can show, so the card
  // is not drawn for it, and it stays the row it always was rather than vanishing from the dive.
  const coordinates = formatCoordinates(dive.latitude, dive.longitude);
  if (coordinates !== null && pointOf(dive) === null) {
    fields.push({ label: t('field.gps'), value: coordinates, mono: true });
  }
  return fields;
}

/**
 * DESIGN.md §6's "Profile & conditions" fields, minus max/avg depth and duration, which
 * this screen groups into its own "Depth & duration" cluster instead. Water temp, air
 * temp and the visibility distance go through `formatTemperature`/`formatDepth` (that
 * distance takes the same m/ft pair a depth does, at the same precision);
 * waves/current/surge go through `formatWaves`/`formatCurrent`/`formatSurge`, which read the
 * 0–3 scale back in the same words the form's chips offer it in (§0.6, M1h) — and which fall
 * back to the bare number for a value outside the scale, since DESIGN.md §10 keeps these
 * columns unclamped and a row that vanished would hide what the dive actually holds.
 *
 * **Two visibility rows, and they carry two different labels on purpose.** §10 keeps the
 * judgement (high · average · low) and the estimate in metres as two encodings of one
 * subject, the scale being the primary; so the scale takes the plain word a diver uses and
 * the number is named for what it actually is. Two rows both reading "Visibility" would be
 * unreadable in a column and indistinguishable to a screen reader.
 */
function conditionsFields(dive: Dive, units: UnitSystem): Field[] {
  const fields: Field[] = [];
  const waterTemp = formatTemperature(dive.waterTempC, units);
  if (waterTemp !== null) fields.push({ label: t('field.waterTemp'), value: waterTemp, mono: true });
  const airTemp = formatTemperature(dive.airTempC, units);
  if (airTemp !== null) fields.push({ label: t('field.airTemp'), value: airTemp, mono: true });
  const visibility = formatVisibility(dive.visibility);
  if (visibility !== null) fields.push({ label: t('field.visibility'), value: visibility, mono: false });
  const visibilityDistance = formatDepth(dive.visibilityM, units);
  if (visibilityDistance !== null) {
    fields.push({ label: t('field.visibilityDistance'), value: visibilityDistance, mono: true });
  }
  // `mono: false`, and that changed with the words: §0.6 splits the two faces by what a value
  // IS — "figures in mono, names in sans" — so a row now reading "Small" belongs with
  // Visibility and Weather beside it rather than with the temperatures above. While these
  // were bare digits mono was right; it is the value that moved, not the rule.
  const waves = formatWaves(dive.waves);
  if (waves !== null) fields.push({ label: t('field.waves'), value: waves, mono: false });
  const current = formatCurrent(dive.current);
  if (current !== null) fields.push({ label: t('field.current'), value: current, mono: false });
  const surge = formatSurge(dive.surge);
  if (surge !== null) fields.push({ label: t('field.surge'), value: surge, mono: false });
  const weather = formatWeather(dive.weather);
  if (weather !== null) fields.push({ label: t('field.weather'), value: weather, mono: false });
  return fields;
}

/**
 * DESIGN.md §6's "Equipment & people" fields.
 *
 * `hood`, `gloves` and `boots` were three `boolean | null` rows here until M1h, and the row
 * this file used to argue about — a recorded `false` ("no hood worn") had to render as "No"
 * rather than be swallowed the way `dive.hood && ...` swallows it. §10 replaced all three
 * with the `equipment` token set, which cannot make that mistake because it cannot express
 * that answer: a token is present or it is not. The three-way distinction genuinely went
 * (see `Dive.equipment`, domain/types.ts, where the trade is recorded), so an empty set is
 * simply an absent row here, exactly as an unrecorded suit is.
 *
 * The weighting is two rows, not one — the kilos and the judgement — for the reason §10
 * gives: "6 kg" means nothing on its own, and "6 kg, and I was over" is the fact a diver
 * actually uses.
 */
function equipmentFields(dive: Dive, units: UnitSystem): Field[] {
  const fields: Field[] = [];
  const suit = formatSuit(dive.suit);
  if (suit !== null) fields.push({ label: t('field.suit'), value: suit, mono: false });
  const thickness = formatSuitThickness(dive.suitThicknessMm);
  if (thickness !== null) fields.push({ label: t('field.suitThickness'), value: thickness, mono: true });
  const equipment = formatEquipment(dive.equipment);
  if (equipment !== null) fields.push({ label: t('field.equipment'), value: equipment, mono: false });
  const weights = formatWeight(dive.weightsKg, units);
  if (weights !== null) fields.push({ label: t('field.weights'), value: weights, mono: true });
  const weightsFeel = formatWeightsFeel(dive.weightsFeel);
  if (weightsFeel !== null) fields.push({ label: t('field.weighting'), value: weightsFeel, mono: false });
  if (dive.buddy !== null) fields.push({ label: t('field.buddy'), value: dive.buddy, mono: false });
  if (dive.guide !== null) fields.push({ label: t('field.guide'), value: dive.guide, mono: false });
  return fields;
}

/**
 * One cylinder's own fields, plus the pressure it used and that mix's own MOD.
 * `usedBar` is read from derived.ts, never recomputed here as `startBar - endBar`:
 * that arithmetic already lives there, along with the guards that make it refuse a
 * transposed or negative reading rather than report a false figure. `material`,
 * `configuration`, `sizeL`, `o2Pct` and `hePct` go through `format/display.ts`'s
 * `formatTankMaterial`/`formatConfiguration`/`formatVolume`/`formatPercent` like every
 * other field on this screen —
 * the module's own docblock is the single owner of turning an SI value into a string,
 * and a dedicated formatter per field is what closes that even for a field with no unit
 * conversion (§3's four pairs are depth, temperature, pressure and weight — `sizeL` and
 * the gas fractions are none of them, so those formatters take no
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
  if (material !== null) fields.push({ label: t('field.material'), value: material, mono: false });
  // The rig, where a numeric `Count` used to sit (§10). It is `mono: false` because it is a
  // name now, not a figure — the same line the rest of this screen draws between a word and
  // a number.
  const configuration = formatConfiguration(tank.configuration);
  if (configuration !== null) fields.push({ label: t('field.configuration'), value: configuration, mono: false });
  const size = formatVolume(tank.sizeL);
  if (size !== null) fields.push({ label: t('field.size'), value: size, mono: true });
  const working = formatPressure(tank.workingBar, units);
  if (working !== null) fields.push({ label: t('field.workingPressure'), value: working, mono: true });
  // The two label constants, not two more string literals: the form spelled these `O2 %` and
  // `He %` — one cylinder reading two ways one screen apart, the same defect
  // `formatTankMaterial` above was introduced to close. See `O2_LABEL` (format/display.ts)
  // for which spelling won and where the `%` went.
  const o2 = formatPercent(tank.o2Pct);
  if (o2 !== null) fields.push({ label: O2_LABEL, value: o2, mono: true });
  const he = formatPercent(tank.hePct);
  if (he !== null) fields.push({ label: HE_LABEL, value: he, mono: true });
  // Nitrogen is never stored — it is 100 − O₂ − He (§10) — so it is `computed: true` like
  // MOD and `Used` below, and sits with the two fractions it is derived from. An air or
  // nitrox cylinder shows it too: `nitrogenPct` reads a blank helium as none, because nobody
  // writes "He: 0" for air and requiring both fractions would show N₂ on trimix alone. That
  // function names the cost of the reading; the `=` prefix beside the value is what keeps it
  // honest here, marking it as something the app worked out rather than something recorded.
  const n2 = formatPercent(nitrogenPct(tank.o2Pct, tank.hePct));
  if (n2 !== null) fields.push({ label: N2_LABEL, value: n2, mono: true, computed: true });
  const tankMod = formatDepth(mod(tank.o2Pct), units);
  if (tankMod !== null) fields.push({ label: t('field.mod'), value: tankMod, mono: true, computed: true });
  const start = formatPressure(tank.startBar, units);
  if (start !== null) fields.push({ label: t('field.startPressure'), value: start, mono: true });
  const end = formatPressure(tank.endBar, units);
  if (end !== null) fields.push({ label: t('field.endPressure'), value: end, mono: true });
  const used = formatPressure(usedBar(tank), units);
  if (used !== null) fields.push({ label: t('field.used'), value: used, mono: true, computed: true });
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
 * The hero's mono sub-line, e.g. "22 Aug 2026 · 09:15 · Ponorka" — when and with whom, under the
 * site (issue #3, the owner's design canvas). The dive number used to lead this line and is a
 * line of its own above the site now, as it is in a dive row; the time in took its place, because
 * a date and a time are one fact about when the dive was.
 *
 * The time is `dive.timeIn` as the diver entered it, never `timeOut`'s computed figure: this line
 * carries no `=` mark, so it may only say what was typed.
 *
 * The centre is dropped when the heading above is ALREADY showing it: `diveSiteLabel` falls back to
 * the centre for a dive with no site name, so on that dive "Aqua" would otherwise appear twice, one
 * line apart. That case is recognised by comparing against the label itself rather than by
 * re-deriving "siteName is null" — the label's rule has one owner.
 *
 * Time and centre are independently omitted when absent — filtered out before joining, never an
 * empty segment or a stray separator. `formatDiveDate` never returns null (`date` is the one field
 * §6 never allows to be absent), so a dive with nothing else recorded still gets a one-part line.
 */
function heroSubline(dive: Dive): string {
  const centre = diveSiteLabel(dive) === dive.centerName ? null : dive.centerName;
  return [formatDiveDate(dive.date), dive.timeIn, centre]
    .filter((part): part is string => part !== null)
    .join(METADATA_SEPARATOR);
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
  // The subscription that repaints this screen when the diver changes the language (src/i18n) —
  // a screen root, so nothing above it re-renders on its own.
  useT();
  const scheme: ColorScheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  // How far down this screen's content begins, read off the device (`screenTopInset`,
  // theme/styles.ts — the app's one owner of that rule) rather than baked into the sheet.
  // Read here even when embedded in the wide layout's detail pane: the same provider answers
  // both, so this root and the list column beside it land on one line.
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
  // §0.4's series for the card below. Keyed on the ROUTE's id rather than on `dive.id`,
  // because the dive itself is not found until after the list has been searched and the
  // not-found branch has had its chance to return — and a hook may not sit after a
  // conditional return, the same constraint the two state declarations below record. The
  // empty string covers the render where neither an `id` prop nor a route param has arrived:
  // no row can match it, so the read answers `samples: null` and the card draws nothing,
  // which is exactly what that render should show anyway.
  const { samples } = useDiveSamples(id ?? '');
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
  // Whether the record's actions are open (issue #3). Declared with the others above the
  // not-found return, for the same reason they are.
  const [sheetOpen, setSheetOpen] = useState(false);

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
          {resolved && <Text style={styles.messageText}>{t('detail.notFound')}</Text>}
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
      setDeleteError(deleteErrorMessage());
    } finally {
      // Released on both paths, so a failed delete leaves a control the diver can press
      // again rather than one that silently stopped working.
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  // A confirmation drawn by the platform, not by this app (M1d task 7, amendment C). That
  // is what resolves the tension with §0.1: the app's own surfaces stay monochrome, and the
  // danger signal belongs to OS chrome — the same way the keyboard's colours do — so the
  // sheet's own action stays ink. Confirmation is not optional for this one: it is the only
  // action in the app that removes something.
  //
  // `platform/confirmDestructive.ts` owns *which* chrome: the platform `Alert` and its
  // `style: 'destructive'` button on a device, the browser's own dialog on web. This screen
  // states the question and what to do with the answer, and nothing about where it is drawn.
  //
  // Asked from the sheet (issue #3) and answered over it: the sheet closes on a yes, and a no
  // leaves it open, one Cancel from the dive, which is where the diver was.
  const confirmDelete = () => {
    confirmDestructive({
      title: deleteTitle(),
      body: deleteBody(),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        setSheetOpen(false);
        void runDelete();
      },
    });
  };

  const timeOutValue = timeOut(dive.timeIn, dive.durationMin);
  const previous = previousLoggedDive(dives, dive);
  const surfaceInterval = previous === undefined ? null : formatSurfaceInterval(surfaceIntervalMin(previous, dive));

  // Hero (§0.6, M1c task 5; issue #3). `number` comes from `useDives()`'s own map — the one
  // DiveRow.tsx reads — never recomputed here: a second numbering path is a second place the
  // number shown here could disagree with the one the list showed for the same dive. A planned
  // dive has none (§2.4), and then the hero has no number line and the sheet names it as a plan.
  const number = numbers.get(dive.id);
  const heroSub = heroSubline(dive);
  const recordTitle =
    number === undefined ? t('detail.plannedDiveTitle') : t('detail.recordTitle', { number });
  const recordMeta = [diveSiteLabel(dive), formatDiveDate(dive.date)].join(METADATA_SEPARATOR);
  // The map card's point and its two numbers — see `MapCard` for why the card is drawn only for
  // a point the Map itself would accept.
  const point = pointOf(dive);
  const coordinates = formatCoordinates(dive.latitude, dive.longitude);

  const maxDepth = formatDepth(dive.maxDepthM, units);
  const avgDepth = formatDepth(dive.avgDepthM, units);
  const duration = formatDuration(dive.durationMin);
  const showDepthDuration = maxDepth !== null || avgDepth !== null || duration !== null;

  const where = whereFields(dive);
  const conditions = conditionsFields(dive, units);
  const equipment = equipmentFields(dive, units);

  // Both take `units` since M3, and this screen is the reason the fix could not stop at the
  // Stats tab: these two rows sit one above the other, so converting the RMV alone would have
  // put `2382 l` directly above a `0.65 cu ft/min` — one cluster reporting the same gas in two
  // systems, which is worse than the defect it half-fixed. `format/units.ts` carries why free
  // gas converts where a cylinder's water capacity (`formatVolume`, in `tankFields` below)
  // does not.
  const gasUsed = formatGasUsed(gasUsedLitres(dive.tanks), units);
  const rmvValue = formatRmv(rmv(dive), units);
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

  // §7's row, and the whole of its rule: the device where the export named one, the importer's
  // own label where it did not, and nothing at all where the dive was typed in by hand or came
  // from a source this build's registry does not know. Deliberately NOT marked computed (§0.6):
  // that mark means "read from domain/derived.ts", and a device name is a stored fact, not
  // something this app worked out — writing `= Suunto D5` would claim otherwise.
  //
  // A blank `importDevice` reads as absent, exactly like a null one, so `??` alone is not
  // enough: today's only writer (the Suunto importer) normalises a blank name to null before it
  // ever reaches the database, but this column also arrives by sync — a row written by a future
  // client version, or by a second importer that forgot to normalise, lands in this same column
  // with this screen as its reader. Closed here, where the reading happens, rather than trusted
  // to every writer that will ever touch it.
  //
  // `trim()` and `||`, not a comparison against `''`: a name of nothing but spaces is as blank
  // as an empty one and would render the label over an invisible value, which is the very thing
  // this line exists to prevent. Trimmed before the test rather than only for it, so the row
  // never shows a name with the whitespace some export padded it with.
  const importDevice = dive.importDevice?.trim() || null;
  const importedFrom = importDevice ?? (dive.importSource === null ? null : importerLabelFor(dive.importSource));

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      {/* The way out and the dive's own actions, as one row above the hero. *Edit* and ⋯ are
          rendered regardless of `showBackButton`: on the wide layout there is nothing to go
          back TO, but editing or deleting the dive on screen is exactly as valid there. */}
      <View style={styles.detailTopBar}>
        {showBackButton && <BackButton styles={styles} />}
        <View style={styles.detailTopActions}>
          <EditButton dive={dive} styles={styles} />
          <MoreButton styles={styles} onPress={() => setSheetOpen(true)} disabled={deleting} />
        </View>
      </View>
      <ScrollView style={styles.detailScroll}>
        <View style={styles.detailHero}>
          <View style={styles.detailHeroMain}>
            {number !== undefined && <Text style={styles.detailHeroNumber}>{`#${number}`}</Text>}
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
          {/* A delete that failed, at the top of the content where the diver is looking — the
              sheet that asked closed when they said yes. */}
          {deleteError !== null && (
            <View style={styles.detailDeleteError}>
              <Text style={styles.detailDeleteErrorText}>{deleteError}</Text>
            </View>
          )}

          {/* "Show on map" (issue #3), directly under the hero where the canvas draws it. */}
          {point !== null && coordinates !== null && (
            <MapCard
              styles={styles}
              scheme={scheme}
              coordinates={coordinates}
              onPress={() => showDiveOnMap(dive, point)}
            />
          )}

          {/* §0.4's card, in the space that rule reserved for it — between the hero and the
              first cluster, with nothing above it moved by its arriving. It is handed the series
              and draws nothing at all without one; this screen never asks whether it will (see
              this file's docblock). */}
          <DepthProfile dive={dive} samples={samples} scheme={scheme} units={units} />

          {/* §7's provenance, beneath the card and independent of it: a computer can export a
              dive it recorded no profile for, and this row is a fact about the dive either
              way. A plain value row — no chevron (§0.6), nothing to press; the canvas draws one
              and opens the source, and there is no page for a source to open. */}
          {importedFrom !== null && (
            <Row label={t('field.importedFrom')} value={importedFrom} mono={false} styles={styles} />
          )}

          {/* The one cluster that always renders (Status and Date are never null, §6), so it is
              the topmost either way. It is `first` — flush under what is above it — unless the
              `Imported from` row sits between: a hero or a card closes on its own air, a row
              does not, and a label pressed against a row's foot reads as that row's caption. */}
          <Cluster title={t('group.dateTime')} styles={styles} first={importedFrom === null}>
            <Row label={t('field.status')} value={formatDiveStatus(dive.status)} mono={false} styles={styles} />
            <Row label={t('field.date')} value={formatDiveDate(dive.date)} mono styles={styles} />
            {dive.timeIn !== null && <Row label={t('field.timeIn')} value={dive.timeIn} mono styles={styles} />}
            {timeOutValue !== null && (
              <Row label={t('field.timeOut')} value={timeOutValue} mono computed styles={styles} />
            )}
            {surfaceInterval !== null && (
              <Row label={t('field.surfaceInterval')} value={surfaceInterval} mono computed styles={styles} />
            )}
          </Cluster>

          {where.length > 0 && (
            <Cluster title={t('group.siteCentre')} styles={styles}>
              {where.map((f) => (
                <Row key={f.label} {...f} styles={styles} />
              ))}
            </Cluster>
          )}

          {showDepthDuration && (
            <Cluster title={t('group.depthDuration')} styles={styles}>
              {maxDepth !== null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('field.maxDepth')}</Text>
                  <DepthValue metres={dive.maxDepthM} scheme={scheme} units={units} />
                </View>
              )}
              {avgDepth !== null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('field.avgDepth')}</Text>
                  <DepthValue metres={dive.avgDepthM} scheme={scheme} units={units} />
                </View>
              )}
              {duration !== null && <Row label={t('field.duration')} value={duration} mono styles={styles} />}
            </Cluster>
          )}

          {conditions.length > 0 && (
            <Cluster title={t('group.conditions')} styles={styles}>
              {conditions.map((f) => (
                <Row key={f.label} {...f} styles={styles} />
              ))}
            </Cluster>
          )}

          {showGasCluster && (
            <Cluster title={t('group.gas')} styles={styles}>
              {gasUsed !== null && <Row label={t('field.gasUsed')} value={gasUsed} mono computed styles={styles} />}
              {rmvValue !== null && <Row label={t('field.rmv')} value={rmvValue} mono computed styles={styles} />}
              {tankGroups.map(({ index, fields }) => {
                if (fields.length === 0) return null;
                return (
                  <View key={index}>
                    <Text style={styles.detailTankTitle}>
                      {dive.tanks.length > 1
                        ? t('field.cylinderNumbered', { number: index + 1 })
                        : t('field.cylinder')}
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
            <Cluster title={t('group.equipmentPeople')} styles={styles}>
              {equipment.map((f) => (
                <Row key={f.label} {...f} styles={styles} />
              ))}
            </Cluster>
          )}

          {hasNotes && (
            <Cluster title={t('group.notes')} styles={styles}>
              {dive.title !== null && <Row label={t('field.title')} value={dive.title} mono={false} styles={styles} />}
              {rating !== null && <Row label={t('field.rating')} value={rating} mono styles={styles} />}
              {dive.notes !== null && <Text style={styles.detailNotes}>{dive.notes}</Text>}
            </Cluster>
          )}

          {/* §2.4's *Complete dive*, for a planned dive only (M1d task 8) — see
              CompleteButton above for why it sits here rather than in the top bar, and why
              it sends `completeDiveHref` where the top bar's *Edit* sends `editDiveHref`. */}
          {dive.status === 'planned' && <CompleteButton dive={dive} styles={styles} />}
        </View>
      </ScrollView>
      {sheetOpen && (
        <RecordActionsSheet
          styles={styles}
          scheme={scheme}
          title={recordTitle}
          meta={recordMeta}
          onDelete={confirmDelete}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </View>
  );
}
