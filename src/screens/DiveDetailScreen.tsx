import { type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import { DepthValue } from '../components/DepthValue';
import { useDives } from '../db/useDives';
import { gasUsedLitres, mod, rmv, surfaceIntervalMin, usedBar } from '../domain/derived';
import { splitPlanned } from '../domain/trips';
import { type Dive, type Tank } from '../domain/types';
import {
  formatDepth,
  formatDiveDate,
  formatDiveStatus,
  formatDuration,
  formatEntry,
  formatPressure,
  formatSalinity,
  formatSuit,
  formatTemperature,
  formatTimeRange,
  formatWaterBody,
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
 * (time out via `formatTimeRange`, which already wraps `derived.ts`'s `timeOut`) and
 * rendered only when the function actually returned a value. Those functions return
 * `null` precisely when their inputs were absent or contradictory; inventing a displayed
 * value in that case would defeat the safety reasoning they carry, so this screen shows
 * nothing there instead — never a NaN, never a dash standing in for the real number.
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
 */
interface Field {
  label: string;
  value: string;
  mono: boolean;
}

function Row({ label, value, mono, styles }: Field & { styles: Styles }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={mono ? styles.detailValue : styles.detailValueText}>{value}</Text>
    </View>
  );
}

function Cluster({ title, styles, children }: { title: string; styles: Styles; children: ReactNode }) {
  return (
    <View style={styles.detailCluster}>
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
  if (dive.latitude !== null && dive.longitude !== null) {
    fields.push({
      label: 'GPS',
      value: `${dive.latitude.toFixed(5)}, ${dive.longitude.toFixed(5)}`,
      mono: true,
    });
  }
  return fields;
}

/**
 * DESIGN.md §6's "Profile & conditions" fields, minus max/avg depth and duration, which
 * this screen groups into its own "Depth & duration" cluster instead. Water temp, air
 * temp and visibility all go through the same formatters this module reuses elsewhere
 * (`formatTemperature`, `formatDepth` — visibility is a metres reading at the same
 * one-decimal precision a depth is, and `format/display.ts` has no separate formatter for
 * it); waves/current/surge have no formatter of their own (a plain 0–3 rating) and are
 * shown as the bare number the diver recorded.
 */
function conditionsFields(dive: Dive): Field[] {
  const fields: Field[] = [];
  const waterTemp = formatTemperature(dive.waterTempC);
  if (waterTemp !== null) fields.push({ label: 'Water temp', value: waterTemp, mono: true });
  const airTemp = formatTemperature(dive.airTempC);
  if (airTemp !== null) fields.push({ label: 'Air temp', value: airTemp, mono: true });
  const visibility = formatDepth(dive.visibilityM);
  if (visibility !== null) fields.push({ label: 'Visibility', value: visibility, mono: true });
  if (dive.waves !== null) fields.push({ label: 'Waves', value: String(dive.waves), mono: true });
  if (dive.current !== null) fields.push({ label: 'Current', value: String(dive.current), mono: true });
  if (dive.surge !== null) fields.push({ label: 'Surge', value: String(dive.surge), mono: true });
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
  if (dive.weightsKg !== null) fields.push({ label: 'Weights', value: `${dive.weightsKg} kg`, mono: true });
  if (dive.buddy !== null) fields.push({ label: 'Buddy', value: dive.buddy, mono: false });
  if (dive.guide !== null) fields.push({ label: 'Guide', value: dive.guide, mono: false });
  return fields;
}

/**
 * One cylinder's own fields, plus the pressure it used. `usedBar` is read from
 * derived.ts, never recomputed here as `startBar - endBar`: that arithmetic already
 * lives there, along with the guards that make it refuse a transposed or negative
 * reading rather than report a false figure. `sizeL`, `count`, `o2Pct` and `hePct` have
 * no dedicated formatter in `format/display.ts`, so they render as the plain recorded
 * number with a literal unit.
 */
function tankFields(tank: Tank): Field[] {
  const fields: Field[] = [];
  if (tank.material !== null) fields.push({ label: 'Material', value: tank.material, mono: false });
  if (tank.sizeL !== null) fields.push({ label: 'Size', value: `${tank.sizeL} l`, mono: true });
  if (tank.count !== null) fields.push({ label: 'Count', value: String(tank.count), mono: true });
  const working = formatPressure(tank.workingBar);
  if (working !== null) fields.push({ label: 'Working pressure', value: working, mono: true });
  if (tank.o2Pct !== null) fields.push({ label: 'O₂', value: `${tank.o2Pct} %`, mono: true });
  if (tank.hePct !== null) fields.push({ label: 'He', value: `${tank.hePct} %`, mono: true });
  const start = formatPressure(tank.startBar);
  if (start !== null) fields.push({ label: 'Start pressure', value: start, mono: true });
  const end = formatPressure(tank.endBar);
  if (end !== null) fields.push({ label: 'End pressure', value: end, mono: true });
  const used = formatPressure(usedBar(tank));
  if (used !== null) fields.push({ label: 'Used', value: used, mono: true });
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
 * `dive`, and that guard rejects exactly that shape on every date/time combination (see
 * derived.test.ts's "transposed pair" case for a pinned example) — so the failure mode
 * stays a silently ABSENT surface-interval row, never a wrong-but-plausible number. This
 * function's own correctness doesn't lean on that happening to hold; it's named here so a
 * future change to either guard is something a reader can find, not something that has to
 * be re-derived from scratch.
 */
function previousLoggedDive(dives: Dive[], dive: Dive): Dive | undefined {
  const { logged } = splitPlanned(dives);
  const index = logged.findIndex((d) => d.id === dive.id);
  return index === -1 ? undefined : logged[index + 1];
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
  const { dives } = useDives();

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

  const timeRange = formatTimeRange(dive.timeIn, dive.durationMin);
  const previous = previousLoggedDive(dives, dive);
  const surfaceInterval = previous === undefined ? null : formatDuration(surfaceIntervalMin(previous, dive));

  const maxDepth = formatDepth(dive.maxDepthM);
  const avgDepth = formatDepth(dive.avgDepthM);
  const duration = formatDuration(dive.durationMin);
  const showDepthDuration = maxDepth !== null || avgDepth !== null || duration !== null;

  const where = whereFields(dive);
  const conditions = conditionsFields(dive);
  const equipment = equipmentFields(dive);

  const gasUsed = gasUsedLitres(dive.tanks);
  const rmvValue = rmv(dive);
  const modValue = formatDepth(mod(dive.tanks[0]?.o2Pct));

  const hasNotes = dive.title !== null || dive.notes !== null || dive.rating !== null;

  return (
    <View style={styles.screen}>
      {showBackButton && <BackButton styles={styles} />}
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        <Cluster title="Date & time" styles={styles}>
          <Row label="Status" value={formatDiveStatus(dive.status)} mono={false} styles={styles} />
          <Row label="Date" value={formatDiveDate(dive.date)} mono styles={styles} />
          {timeRange !== null && <Row label="Time" value={timeRange} mono styles={styles} />}
          {surfaceInterval !== null && (
            <Row label="Surface interval" value={surfaceInterval} mono styles={styles} />
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

        {dive.tanks.length > 0 && (
          <Cluster title="Gas & cylinders" styles={styles}>
            {gasUsed !== null && <Row label="Gas used" value={`${Math.round(gasUsed)} l`} mono styles={styles} />}
            {rmvValue !== null && <Row label="RMV" value={`${rmvValue.toFixed(1)} l/min`} mono styles={styles} />}
            {modValue !== null && <Row label="MOD" value={modValue} mono styles={styles} />}
            {dive.tanks.map((tank, index) => {
              const fields = tankFields(tank);
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
            {dive.rating !== null && <Row label="Rating" value={`${dive.rating} / 5`} mono styles={styles} />}
            {dive.notes !== null && <Text style={styles.detailNotes}>{dive.notes}</Text>}
          </Cluster>
        )}
      </ScrollView>
    </View>
  );
}
