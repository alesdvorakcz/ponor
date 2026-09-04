import { type ReactNode } from 'react';
import { ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDives } from '../db/useDives';
import { LOGBOOK_UNREADABLE } from '../domain/logbook';
import { useDiveSites } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { todayCalendarDate } from '../domain/datetime';
import {
  countriesVisited,
  currency,
  logbookStats,
  rmvTrend,
  sitesVisited,
} from '../domain/logbookStats';
import {
  formatDaysSince,
  formatDepth,
  formatRmv,
  formatRmvTrend,
  formatRmvWindow,
  formatTimeUnderwater,
} from '../format/display';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

/**
 * **A counter with nothing behind it**, in the slot its figure would occupy.
 *
 * §0.6 draws the line this screen sits on the other side of: *"A figure with nothing behind it
 * is omitted, not drawn as an em dash — the dash belongs to a labelled row that is drawn
 * whether or not it holds a value."* The Dives header line omits, because it has no labels; the
 * dive detail omits too, and correctly, because **its** row set varies per dive — a dive that
 * recorded no water temperature is a dive with nothing to say about water temperature, and a
 * dangling "Max depth" label with nothing beside it has shipped here once already.
 *
 * This screen is the other kind. It has exactly one subject — the logbook — and a fixed
 * inventory of figures about it, so a row that vanished would be indistinguishable from the app
 * having dropped it: a diver looking for "Deepest" would find the label missing and have no way
 * to tell "nothing recorded" from "this screen forgot". The dash says which, in the one place
 * §0.6 sanctions it, and the rows stay in the same order at the same height however empty a
 * logbook is.
 *
 * Exported so its test reads the same character a diver does. `CLEARED_TAG`
 * (components/CarriedMark.tsx) is its sibling and the app's only other em dash — that one is a
 * *gesture* ("you cleared this"), this one is an *absence* ("nothing recorded"), which is why
 * neither may become the other's constant.
 */
export const NO_FIGURE = '—';

/**
 * **What this screen says when the logbook has no dives in it** — and there are two answers,
 * because there are two ways to have none.
 *
 * §0.6 takes the first-run screen seriously enough to make the empty logbook the one place the
 * depth palette is taught, and §1 forbids blocking; this screen is the second thing a new diver
 * meets and it has nothing to count. It could draw its whole inventory as dashes, and that was
 * rejected: eight dashes is a reproach, and the honest thing to say is not "nothing" but "log a
 * dive and this fills itself in".
 *
 * **The second sentence is §2.4 made visible**, and it is the near-empty case the rest of this
 * screen is built to get right. A logbook holding nothing but a plan has been *used* — the
 * diver set up tomorrow's dive on the boat — and telling them "log a dive" would be telling
 * them to do the thing they just did. What is true is that a plan is not a dive yet, which is
 * the same rule that keeps it out of every figure here (`logbookStats`, §2.4), said once in
 * words where a diver can see it rather than only enforced in arithmetic.
 *
 * Neither names the `+`, deliberately: it is on the Dives tab and this screen has no capsule of
 * its own (see the screen's own docblock), so a sentence pointing at a control that is not on
 * screen would be worse than one that simply says what is missing.
 */
export const NOTHING_LOGGED_MESSAGE = 'Nothing to count yet. Log a dive and this fills itself in.';
export const ONLY_PLANNED_MESSAGE =
  'Nothing to count yet. A planned dive isn’t one you’ve done — complete it after surfacing and it lands here.';

/**
 * **Why the countries figure is a dash**, said once under the row rather than left as a mystery
 * that never resolves.
 *
 * Every other empty figure on this screen is a diver's own omission — they did not write down a
 * duration — and needs no explanation. This one is **structural**: §2.3 gives a country exactly
 * one path onto a dive (`site_id` → the catalogue row's own `country`, derived from that row's
 * pin and from nothing else), sites are new as of M2o, and a site created out of signal has
 * `null` by design. So the ordinary state of this row for a while is a dash on a logbook full
 * of real dives in real countries, and a diver has no way to guess why.
 *
 * It says where the figure comes from and stops there. It does not tell the diver to go and add
 * sites: §2.3 makes that a deliberate act behind a sign-in, this screen cannot perform it, and
 * §1's stance is that the app states what is true rather than what the diver has failed to do.
 */
export const COUNTRIES_UNKNOWN_NOTE =
  'Countries come from the map’s own sites. None of your dives names one that knows its country yet.';

/**
 * **§3's refresher nudge** — *"currency (days since your last dive, refresher nudge after 6
 * months)"*. `REFRESHER_AFTER_DAYS` (domain/logbookStats.ts) decides when; this is what it says.
 *
 * A suggestion, not a warning. §1's never-shame-the-form stance is about a diver's data and
 * this is about their diving, where the temptation to scold is stronger and the app has even
 * less standing: a diver out of the water for six months may have been ill, pregnant, or broke.
 * So it states the fact, offers the thing most agencies would offer, and does not say "you
 * should" — and it is a caption under the figure rather than a banner, because §0.6 gives a
 * sentence about a row the slot under that row.
 */
export const REFRESHER_MESSAGE =
  'Over six months since your last dive. A refresher is worth booking before the next one.';

/* What a failed logbook read says is `LOGBOOK_UNREADABLE` (db/useDives.ts) now, and this is
 * the note M3a left here being discharged. It read: "the same sentence the Dives list, the
 * search screen and the Map tab each say for the same failure — and therefore a **fourth
 * literal copy** of it, which §4.1 would rather see given one owner… the four are one sentence
 * and are now four edits away from disagreeing." They had already disagreed: this copy spelled
 * the apostrophe `’` and the other three `'`, so the four were not one sentence when the note
 * was written. The owner is the hook whose `error` all four dispatch on. */

/**
 * One counter: a label at the leading edge, its figure trailing, and §0.6's hairline on the
 * row's top edge.
 *
 * **The row is `formField`/`formFieldRow`/`formFieldLabel` — the form's own, read directly**,
 * exactly as Settings reads them and for the reason Settings records: §0.6 already has one
 * definition of "a field is a row, not a box", and this screen is a column of that same object
 * with a figure where an input would be. §0.6's brief for this screen said not to invent a
 * card; inventing a fourth label/value row would have been the same mistake in smaller print.
 *
 * `value` is `string | null` because every formatter in `format/display.ts` answers null for a
 * figure with nothing behind it, and this is the one place that decides what null looks like
 * (`NO_FIGURE`) — so no caller has to remember, and no two rows can disagree.
 */
function Counter({ label, value, styles }: { label: string; value: string | null; styles: Styles }) {
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <Text style={styles.statsValue}>{value ?? NO_FIGURE}</Text>
      </View>
    </View>
  );
}

/** A named group of counters — §0.6's cluster label over its rows, the same object *Conditions*
 * and *Cylinder presets* are on the three screens that already draw one. The first row's own
 * top hairline is what separates the heading from it, which is why the heading carries only its
 * bottom padding (`statsSectionTitle`, theme/styles.ts). */
function Group({ title, styles, children }: { title: string; styles: Styles; children: ReactNode }) {
  return (
    <View>
      <Text style={styles.statsSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** A sentence under a group, or nothing — §0.6's "a field speaks next to the control it belongs
 * to", one level up, since these sentences are about a figure rather than about an input. */
function Note({ message, styles }: { message: string | null; styles: Styles }) {
  if (message === null) return null;
  return (
    <View style={styles.statsCaption}>
      <Text style={styles.statsCaptionText}>{message}</Text>
    </View>
  );
}

/**
 * **The Stats tab** (DESIGN.md §3): *"total dives, hours underwater, deepest dive; countries and
 * sites visited; RMV trend; currency (days since your last dive, refresher nudge after 6
 * months); charts later, counters first."*
 *
 * Lives outside `src/app/` like every other screen, because expo-router sweeps that tree as
 * routes and a test file in it would ship to a diver's phone; `src/app/(tabs)/stats.tsx` is the
 * one-line re-export that puts it in the bar.
 *
 * ── What this screen owns, and what it hands over ─────────────────────────────────────────
 *
 * It owns the branches and the order of the groups, and nothing else. Every number is
 * `domain/logbookStats.ts`'s — the same module the Dives header asks for its three figures, so
 * "how many dives have I done" cannot mean two things on two screens (§4.1, and the module's own
 * docblock names that as the defect it exists to prevent). Every sentence with a figure in it is
 * `format/display.ts`'s. There is no `db.select()` here, no second reading of anything, and no
 * arithmetic at all: the one expression in this file that looks like a decision — whether a
 * country count is a figure or a dash — is a decision about *words*, and it is stated below.
 *
 * ── Counters, not charts ──────────────────────────────────────────────────────────────────
 *
 * §3 says so outright, and the RMV row is where that had to be interpreted: a *trend* drawn as
 * counters is a direction and a recent average, so it is two rows — where the diver is now, and
 * which way it moved from the window before — plus a caption saying what "recent" covers.
 * `rmvTrend` computes the pair and `formatRmvTrend` says the direction; nothing here plots
 * anything, and §9's shelf is where a chart would go.
 *
 * ── The mark that is deliberately absent ──────────────────────────────────────────────────
 *
 * §0.6 marks a derived value with a muted `=`, "with no exception for arithmetic simple enough
 * to do in your head", and by the letter of it the RMV rows qualify — `rmv` is in
 * `domain/derived.ts`, which is the rule's own test. **No row on this screen carries the mark**,
 * and that is a reading of the rule rather than a lapse from it. The mark exists so that "a
 * diver should never have to wonder which numbers came off their computer and which the app
 * worked out" — a distinction between the rows of *one screen*, where some values were typed
 * and others were not. On this screen nothing was typed: every figure is worked out, so the
 * distinction has no work to do, and marking the two gas rows would say the opposite of the
 * truth about the six beside them. Recorded here rather than decided quietly, because it is
 * §0.6's sentence being read against a screen it did not have when it was written.
 *
 * ── No capsule, and no colour ─────────────────────────────────────────────────────────────
 *
 * The Dives and Map tabs float an `ActionCapsule` beside their titles because each has
 * something to do to its data — search it, add to it, switch its layer. This screen has
 * nothing: it is a read of a logbook that is written elsewhere. So there is no capsule, the
 * title takes the full content column with no trailing cap, and §3's own note about the `+`
 * moving into the capsule is untouched by that.
 *
 * And nothing here is coloured, including the deepest-dive figure, though it is a real depth
 * and §0.1 makes colour encode depth. It is an aggregate over a whole logbook, and §10 has now
 * ruled twice that no single band is true of a set — M1l's summary line, which states the same
 * three figures this screen's first group does, and M2n's map pins. `theme/styles.ts` carries
 * the same note where the styles are.
 */
export default function StatsScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  // The diver's units (§3), read once here and passed into the formatters — depths follow the
  // diver, hours do not (`format/units.ts` is §4.1's owner of which quantities have a system at
  // all, and time is not one of them).
  const units = useUnitSystem();
  const insets = useSafeAreaInsets();
  // `resolved` alongside the list for the reason every screen in this app reads it: `dives`
  // alone cannot say whether the read has answered, and an unread logbook and an empty one are
  // the same `[]` (db/liveQuery.ts).
  const { dives, resolved, error } = useDives();
  // **The catalogue, and only for the countries figure.** A dive carries a `site_id`; the
  // country lives on the catalogue row that id names (§2.3, §6), so this is the only way to the
  // figure at all. Its own hook rather than a field on `useDives()`, exactly as the Map tab
  // reads it: a failed catalogue read must not take the diver's own totals off this screen.
  const catalogue = useDiveSites();

  const root = [styles.screen, { paddingTop: screenTopInset(insets.top) }];

  /**
   * The large title, drawn on every branch — this screen names itself in the same words, the
   * same treatment and the same place whether it is showing figures, a message or nothing yet,
   * exactly as `DivesScreen`'s and `MapScreen`'s do. It carries its own top clearance
   * (`statsHeading`), so it lands in the same place on the branches that draw no scroll.
   */
  const title = <Text style={styles.statsHeading}>Stats</Text>;

  if (error) {
    return (
      <View style={root}>
        {title}
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>{LOGBOOK_UNREADABLE}</Text>
        </View>
      </View>
    );
  }

  // **A screen with no answer must not state one** (§10, M1f). `useDives()` hands back an empty
  // list on the renders before its query returns, and every figure below would read `0` or a
  // dash for those frames — a whole screen of confident falsehoods about a logbook nothing has
  // looked at yet, and the exact defect that rule was written for. The title alone, so nothing
  // moves when the figures land under it.
  if (!resolved) {
    return <View style={root}>{title}</View>;
  }

  const stats = logbookStats(dives);

  // **Nothing to count, and two ways to have nothing** — see `NOTHING_LOGGED_MESSAGE`. Keyed on
  // `stats.dives`, the logged count, rather than on `dives.length`: §2.4 keeps a plan out of
  // every figure on this screen, so a logbook of plans has nothing to show here even though it
  // is not empty. `dives.length` is then what tells the two sentences apart, and it is the only
  // thing on this screen that reads the raw list.
  if (stats.dives === 0) {
    return (
      <View style={root}>
        {title}
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>
            {dives.length === 0 ? NOTHING_LOGGED_MESSAGE : ONLY_PLANNED_MESSAGE}
          </Text>
        </View>
      </View>
    );
  }

  const countries = countriesVisited(dives, catalogue.sites);
  const trend = rmvTrend(dives);
  // `todayCalendarDate()` reads the device's LOCAL calendar day (domain/datetime.ts, §4.1's
  // owner) — never `toISOString().slice(0, 10)`, which is the UTC day and told a diver in
  // Prague logging a night dive at 00:30 that it was yesterday. Passed in rather than read
  // inside `currency`, so that function stays a pure function of two values.
  const since = currency(dives, todayCalendarDate());

  return (
    <View style={root}>
      <ScrollView
        style={styles.statsScroll}
        // The last row's clearance is the device's, not a constant (`screenBottomInset`,
        // theme/styles.ts). This ScrollView is its root's only child, so it runs to the bottom
        // of the display and what it reports on a screen inside `(tabs)` already contains the
        // Liquid Glass bar — without it the last counter scrolls under the glass, which is the
        // defect that owner was written for, arriving on a third screen.
        contentContainerStyle={[styles.statsContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
      >
        {title}

        {/* §3's first three, and the same three the Dives header states under its own title —
            one owner, rendered twice, never computed twice (§4.1). */}
        <Group title="Logbook" styles={styles}>
          <Counter label="Dives" value={String(stats.dives)} styles={styles} />
          <Counter label="Underwater" value={formatTimeUnderwater(stats.minutes)} styles={styles} />
          <Counter label="Deepest" value={formatDepth(stats.deepestM, units)} styles={styles} />
        </Group>

        <Group title="Places" styles={styles}>
          {/* A count, so `0` is a figure rather than an absence — the rule `formatDiveCount`
              states for the same reason ("the count is always present, including `0 dives`"): a
              logbook whose dives name no place has been read, and nought is what it says. */}
          <Counter label="Sites" value={String(sitesVisited(dives))} styles={styles} />
          {/* **And this one is the opposite, which is why the two sit side by side.** `0`
              countries would read as "you have dived in no countries", which is false of anyone
              with a dive; what the figure actually reports is how many the app KNOWS, and today
              that is usually none — §2.3 gives a country one path onto a dive and sites are new.
              So nothing known is a dash with a sentence under it, and the count appears the day
              a dive names a site that knows its own country. `countriesVisited`'s own docblock
              carries the reasoning; this is the half a `number` cannot say. */}
          <Counter
            label="Countries"
            value={countries === 0 ? null : String(countries)}
            styles={styles}
          />
          <Note message={countries === 0 ? COUNTRIES_UNKNOWN_NOTE : null} styles={styles} />
        </Group>

        {/* §3's "RMV trend", as counters: where it is now, and which way it moved. Both rows are
            drawn whether or not there is a figure, exactly as the logbook's three are — an RMV
            needs an average depth, a duration and a cylinder size together (§2.2 asks for none
            of them), so a dash here is the ordinary state of a perfectly good logbook rather
            than a fault. */}
        <Group title="Gas" styles={styles}>
          <Counter label="RMV" value={trend === null ? null : formatRmv(trend.recent)} styles={styles} />
          <Counter label="Trend" value={trend === null ? null : formatRmvTrend(trend)} styles={styles} />
          {/* Only when there is a figure to qualify. An unstated window makes an RMV
              unreadable — five dives and fifty answer different questions — and a caption
              explaining the window of a dash would be explaining nothing. */}
          <Note
            message={trend === null ? null : formatRmvWindow(trend.recentCount)}
            styles={styles}
          />
        </Group>

        {/* §3's currency. The dash here means every logged dive is dated ahead of today, which
            `currency` refuses to read as "you dived in the future" (§10: a dive that has not
            happened yet is not recent) — rare, and the only honest answer when it happens. */}
        <Group title="Currency" styles={styles}>
          <Counter
            label="Last dive"
            value={since === null ? null : formatDaysSince(since.days)}
            styles={styles}
          />
          <Note message={since !== null && since.refresher ? REFRESHER_MESSAGE : null} styles={styles} />
        </Group>
      </ScrollView>
    </View>
  );
}
