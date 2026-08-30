import { type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import { DepthValue } from '../components/DepthValue';
import { useDives } from '../db/useDives';
import { gasUsedLitres, mod, rmv, surfaceIntervalMin, timeOut, usedBar } from '../domain/derived';
import { splitPlanned } from '../domain/trips';
import { type Dive, type Tank } from '../domain/types';
import {
  diveSiteLabel,
  formatConditionScale,
  formatCoordinates,
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
  formatTemperature,
  formatVolume,
  formatWaterBody,
  formatWeight,
} from '../format/display';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, type Styles } from '../theme/styles';
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
 * **Two optional props, added for M1b's wide (tablet) layout, DivesScreen.tsx's own job to
 * use — every other caller, i.e. the real `/dive/[id]` route, passes neither and gets
 * exactly today's behaviour:**
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
 *   screen the entire time — and BackButton's `router.back()`/`canGoBack()` read the
 *   app's real navigation stack, which embedding never pushed anything onto; showing it
 *   would either do nothing a diver could make sense of or, worse, leave the Dives screen
 *   entirely, since `canGoBack()` reports on whatever brought the app to `/`, not on
 *   whether a detail pane happens to be open next to it.
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
 * `router.canGoBack()` guards which navigation actually happens: this screen is reachable
 * directly by URL (a future share link or notification), where there is no history to pop
 * and `router.back()` would have nothing to do. `router.replace` rather than `router.push`
 * for that fallback, so a cold deep-link launch doesn't grow the stack by one — landing
 * back on `/` should behave like arriving there fresh, not like a second Dives screen
 * pushed on top of a first.
 */
function BackButton({ styles }: { styles: Styles }) {
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <Pressable
      style={styles.detailBack}
      onPress={goBack}
      accessibilityRole="button"
      accessibilityLabel="Back to dives"
    >
      <Text style={styles.detailBackLabel}>‹ Dives</Text>
    </Pressable>
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
 * temp and visibility go through `formatTemperature`/`formatDepth` (visibility is a metres
 * reading at the same one-decimal precision a depth is); waves/current/surge go through
 * `formatConditionScale`, the bare 0–3 rating DESIGN.md §10 keeps unclamped, shown as the
 * diver recorded it rather than a formatted scale.
 */
function conditionsFields(dive: Dive): Field[] {
  const fields: Field[] = [];
  const waterTemp = formatTemperature(dive.waterTempC);
  if (waterTemp !== null) fields.push({ label: 'Water temp', value: waterTemp, mono: true });
  const airTemp = formatTemperature(dive.airTempC);
  if (airTemp !== null) fields.push({ label: 'Air temp', value: airTemp, mono: true });
  const visibility = formatDepth(dive.visibilityM);
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
function equipmentFields(dive: Dive): Field[] {
  const fields: Field[] = [];
  const suit = formatSuit(dive.suit);
  if (suit !== null) fields.push({ label: 'Suit', value: suit, mono: false });
  if (dive.hood !== null) fields.push({ label: 'Hood', value: dive.hood ? 'Yes' : 'No', mono: false });
  if (dive.gloves !== null) fields.push({ label: 'Gloves', value: dive.gloves ? 'Yes' : 'No', mono: false });
  if (dive.boots !== null) fields.push({ label: 'Boots', value: dive.boots ? 'Yes' : 'No', mono: false });
  const weights = formatWeight(dive.weightsKg);
  if (weights !== null) fields.push({ label: 'Weights', value: weights, mono: true });
  if (dive.buddy !== null) fields.push({ label: 'Buddy', value: dive.buddy, mono: false });
  if (dive.guide !== null) fields.push({ label: 'Guide', value: dive.guide, mono: false });
  return fields;
}

/**
 * One cylinder's own fields, plus the pressure it used and that mix's own MOD.
 * `usedBar` is read from derived.ts, never recomputed here as `startBar - endBar`:
 * that arithmetic already lives there, along with the guards that make it refuse a
 * transposed or negative reading rather than report a false figure. `sizeL`, `count`,
 * `o2Pct` and `hePct` go through `format/display.ts`'s
 * `formatVolume`/`formatCount`/`formatPercent` like every other field on this screen —
 * the module's own docblock is the single owner of turning an SI value into a string,
 * and a dedicated formatter per field is what closes that even for a field with no unit
 * conversion coming (§10's kg/lb, m/ft, bar/psi list is depth, temperature, pressure and
 * weight — not these).
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
function tankFields(tank: Tank): Field[] {
  const fields: Field[] = [];
  if (tank.material !== null) fields.push({ label: 'Material', value: tank.material, mono: false });
  const size = formatVolume(tank.sizeL);
  if (size !== null) fields.push({ label: 'Size', value: size, mono: true });
  const count = formatCount(tank.count);
  if (count !== null) fields.push({ label: 'Count', value: count, mono: true });
  const working = formatPressure(tank.workingBar);
  if (working !== null) fields.push({ label: 'Working pressure', value: working, mono: true });
  const o2 = formatPercent(tank.o2Pct);
  if (o2 !== null) fields.push({ label: 'O₂', value: o2, mono: true });
  const he = formatPercent(tank.hePct);
  if (he !== null) fields.push({ label: 'He', value: he, mono: true });
  const tankMod = formatDepth(mod(tank.o2Pct));
  if (tankMod !== null) fields.push({ label: 'MOD', value: tankMod, mono: true, computed: true });
  const start = formatPressure(tank.startBar);
  if (start !== null) fields.push({ label: 'Start pressure', value: start, mono: true });
  const end = formatPressure(tank.endBar);
  if (end !== null) fields.push({ label: 'End pressure', value: end, mono: true });
  const used = formatPressure(usedBar(tank));
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
}

export default function DiveDetailScreen({ id: idProp, showBackButton = true }: DiveDetailScreenProps = {}) {
  const scheme: ColorScheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = idProp ?? routeId;
  const { dives, numbers } = useDives();

  const dive = dives.find((d) => d.id === id);

  if (dive === undefined) {
    return (
      <View style={styles.screen}>
        {showBackButton && <BackButton styles={styles} />}
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>Dive not found.</Text>
        </View>
      </View>
    );
  }

  const timeOutValue = timeOut(dive.timeIn, dive.durationMin);
  const previous = previousLoggedDive(dives, dive);
  const surfaceInterval = previous === undefined ? null : formatSurfaceInterval(surfaceIntervalMin(previous, dive));

  // Hero (§0.6, M1c task 5) — see heroSubline's own docblock for why `number` comes from
  // useDives()'s own map rather than being recomputed here.
  const number = numbers.get(dive.id);
  const heroSub = heroSubline(dive, number);

  const maxDepth = formatDepth(dive.maxDepthM);
  const avgDepth = formatDepth(dive.avgDepthM);
  const duration = formatDuration(dive.durationMin);
  const showDepthDuration = maxDepth !== null || avgDepth !== null || duration !== null;

  const where = whereFields(dive);
  const conditions = conditionsFields(dive);
  const equipment = equipmentFields(dive);

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
  const tankGroups = dive.tanks.map((tank, index) => ({ index, fields: tankFields(tank) }));
  const showGasCluster = gasUsed !== null || rmvValue !== null || tankGroups.some((t) => t.fields.length > 0);

  const rating = formatRating(dive.rating);
  const hasNotes = dive.title !== null || dive.notes !== null || rating !== null;

  return (
    <View style={styles.screen}>
      {showBackButton && <BackButton styles={styles} />}
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
          <DepthValue metres={dive.maxDepthM} scheme={scheme} variant="hero" />
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
                  <DepthValue metres={dive.maxDepthM} scheme={scheme} />
                </View>
              )}
              {avgDepth !== null && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Avg depth</Text>
                  <DepthValue metres={dive.avgDepthM} scheme={scheme} />
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
        </View>
      </ScrollView>
    </View>
  );
}
