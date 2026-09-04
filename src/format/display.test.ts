import {
  CONDITION_SCALE_VALUES,
  CONFIGURATION_VALUES,
  VISIBILITY_VALUES,
  WEATHER_VALUES,
  WEIGHTS_FEEL_VALUES,
  type Equipment,
  type Tank,
} from '../domain/types';
import {
  certificationLabel,
  formatCertificationSummary,
  UNTITLED_CERTIFICATION,
  formatCurrent,
  formatSurge,
  formatWaves,
  formatCommunitySummary,
  formatCoordinates,
  formatConfiguration,
  formatCylinderSpec,
  formatCylinders,
  HE_LABEL,
  O2_LABEL,
  formatDepth,
  formatDepthBandRange,
  formatDepthParts,
  formatDiveCount,
  formatMyDivesSummary,
  formatPendingChanges,
  formatSiteFacts,
  formatSiteSummary,
  formatTemperatureRange,
  formatDuration,
  formatDiveDate,
  isDisplayableDepth,
  formatDiveStatus,
  formatUnitSystem,
  formatEntry,
  formatGasUsed,
  formatPercent,
  formatPressure,
  formatRating,
  formatRmv,
  formatRmvTrend,
  formatRmvWindow,
  formatDaysSince,
  formatEquipment,
  formatEquipmentToken,
  formatSalinity,
  formatSuit,
  formatSuitThickness,
  formatTankMaterial,
  formatVisibility,
  formatWeather,
  formatWeightsFeel,
  formatLogbookSummary,
  METADATA_SEPARATOR,
  NON_BREAKING_SPACE,
  formatSurfaceInterval,
  formatTemperature,
  formatTimeUnderwater,
  formatTimeRange,
  formatVolume,
  formatWaterBody,
  formatWeight,
  diveSiteLabel,
  UNNAMED_SITE,
} from './display';
import { UNIT_SYSTEMS } from './units';

describe('formatDepth', () => {
  it('shows one decimal place', () => {
    expect(formatDepth(32.44, 'metric')).toBe('32.4 m');
    expect(formatDepth(18, 'metric')).toBe('18.0 m');
  });
  it('returns null for an unrecorded depth rather than a zero', () => {
    expect(formatDepth(null, 'metric')).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatDepth(Number.NaN, 'metric')).toBeNull();
  });
  // M1c closing fixes, Important #3: unlike formatTemperature's "keeps a negative reading
  // signed" a few describes down, a depth cannot physically be negative — nothing dives
  // above the surface. This used to be the exact input where this function and
  // theme/depth.ts's depthColorOrNull disagreed: this returned a string ("-5.0 m") while
  // depthColorOrNull already refused to colour it, so a screen gating on this function
  // alone (DiveDetailScreen.tsx's "Max depth" row, DiveRow.tsx's accessibility label) drew
  // a dangling label DepthValue then rendered nothing beside. Pinned here so the two can
  // never quietly drift apart again.
  it('returns null for a negative depth, since nothing dives above the surface', () => {
    expect(formatDepth(-5, 'metric')).toBeNull();
  });
  // The unit setting (DESIGN.md §3) reaches this function as an argument and nothing else
  // — no context, no settings read — which is what keeps it a pure function two call sites
  // can hand different systems in the same render.
  it('reads the same stored depth in the system it is given', () => {
    expect(formatDepth(24.6, 'imperial')).toBe('81 ft');
    expect(formatDepth(24.6, 'metric')).toBe('24.6 m');
  });
  it('refuses the same depths in either system, so a screen gates identically in both', () => {
    expect(formatDepth(null, 'imperial')).toBeNull();
    expect(formatDepth(Number.NaN, 'imperial')).toBeNull();
    expect(formatDepth(-5, 'imperial')).toBeNull();
  });
});

// **The one screen that prints the scale instead of a dive** (DESIGN.md §0.6's empty state,
// M1h). The boundaries come in as metres from `theme/depth.ts`; what this function decides is
// what a diver reads, which is the same split every other depth in the app already goes
// through. The exact strings are pinned because a legend is text a first-run diver is being
// taught from — an off-by-one boundary here teaches the wrong scale rather than merely
// looking wrong.
describe('formatDepthBandRange', () => {
  // Metric is the stored system, so these are the band limits themselves — and they are whole
  // metres, which is why this uses `displayNumber` rather than `displayFigure`: the padded
  // form would read `0.0–6.0` and claim a resolution the boundary does not have.
  it('reads a metric band as the metres it is', () => {
    expect(formatDepthBandRange(0, 6, 'metric')).toBe('0–6');
    expect(formatDepthBandRange(12, 20, 'metric')).toBe('12–20');
  });

  // §10: "depth takes whole feet", because that is what an imperial gauge reads to. The
  // boundaries land ragged — 6 m is 19.685 ft — and the raggedness is the honest answer: a
  // first-run screen that quietly switched a diver back to metres to get tidy numbers would be
  // teaching on a lie. 39 and 131 in particular are the ones a "nicer" rounding would move.
  it('reads an imperial band in whole feet, ragged boundaries and all', () => {
    expect(formatDepthBandRange(0, 6, 'imperial')).toBe('0–20');
    expect(formatDepthBandRange(6, 12, 'imperial')).toBe('20–39');
    expect(formatDepthBandRange(12, 20, 'imperial')).toBe('39–66');
    expect(formatDepthBandRange(20, 30, 'imperial')).toBe('66–98');
    expect(formatDepthBandRange(30, 40, 'imperial')).toBe('98–131');
  });

  // The deepest band is open-ended, and it is the label that carries the unit for the whole
  // scale — six labels each ending in `ft` do not fit a sixth of a phone's width, and this is
  // already the one label that is not a range.
  it('says the deepest band is open-ended, and names the unit there', () => {
    expect(formatDepthBandRange(40, null, 'metric')).toBe('40+ m');
    expect(formatDepthBandRange(40, null, 'imperial')).toBe('131+ ft');
  });

  // The unit word appears exactly once across a whole legend. Swept rather than asserted for
  // one label, because "put the unit on every band" is the obvious edit and it is the one that
  // silently breaks the layout the labels were sized for.
  it('names the unit once in a whole scale, never on a closed band', () => {
    for (const system of UNIT_SYSTEMS) {
      const closed = [
        formatDepthBandRange(0, 6, system),
        formatDepthBandRange(6, 12, system),
        formatDepthBandRange(12, 20, system),
        formatDepthBandRange(20, 30, system),
        formatDepthBandRange(30, 40, system),
      ];
      expect(closed.every((label) => /^[0-9.]+–[0-9.]+$/.test(label))).toBe(true);
    }
  });
});

// The predicate `formatDepthParts` is defined in terms of, and `theme/depth.ts`'s
// `depthColorOrNull` defers to — so "can this depth be shown" has one owner even though
// only one of the two knows about units. Pinned directly, because it is now the thing that
// keeps a screen's "Max depth" label and the coloured value beside it from disagreeing.
describe('isDisplayableDepth', () => {
  it('accepts a real depth', () => {
    expect(isDisplayableDepth(24.6)).toBe(true);
    expect(isDisplayableDepth(0)).toBe(true);
  });
  it('refuses what cannot be a depth', () => {
    expect(isDisplayableDepth(null)).toBe(false);
    expect(isDisplayableDepth(undefined)).toBe(false);
    expect(isDisplayableDepth(Number.NaN)).toBe(false);
    expect(isDisplayableDepth(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isDisplayableDepth(-5)).toBe(false);
  });
  // The contract the two owners share, stated as the relationship rather than as two lists
  // that happen to agree: whatever this accepts, formatDepthParts prints — in EITHER
  // system, since displayability is not a unit question.
  it('agrees with formatDepthParts in both systems', () => {
    for (const metres of [24.6, 0, -0, null, Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const displayable = isDisplayableDepth(metres);
      expect(formatDepthParts(metres, 'metric') !== null).toBe(displayable);
      expect(formatDepthParts(metres, 'imperial') !== null).toBe(displayable);
    }
  });
});

// M1c task 1 review, Important: DepthValue.tsx used to get its value/unit split by
// parsing formatDepth's string on the space it happened to always contain — a parse with
// no fallback. formatDepthParts is the structured form it reads instead, and formatDepth
// above is now defined in terms of it, so this pins the one contract both of them share.
describe('formatDepthParts', () => {
  it('splits the numeral and unit apart, matching what formatDepth joins back together', () => {
    expect(formatDepthParts(32.44, 'metric')).toEqual({ value: '32.4', unit: 'm' });
    expect(formatDepthParts(18, 'metric')).toEqual({ value: '18.0', unit: 'm' });
  });
  it('returns null for an unrecorded depth rather than a zero', () => {
    expect(formatDepthParts(null, 'metric')).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatDepthParts(Number.NaN, 'metric')).toBeNull();
  });
  it('returns null for a negative depth, since nothing dives above the surface', () => {
    expect(formatDepthParts(-5, 'metric')).toBeNull();
  });
  it('carries the imperial unit as its own field, never spliced into the numeral', () => {
    expect(formatDepthParts(24.6, 'imperial')).toEqual({ value: '81', unit: 'ft' });
  });
});

describe('formatDuration', () => {
  it('renders whole minutes', () => {
    expect(formatDuration(44)).toBe('44 min');
  });
  // Review task 7, cannot-fail #2: a whole-number fixture in, a whole-number string out —
  // deleting the `Math.round` call survived every test in the suite, even though the name
  // promises rounding. derived.ts's own comment on durationMin: "diver-entered and may
  // carry a fraction (44.5 min)" — that fraction is the boundary this needs to reach.
  it('rounds a fractional duration to the whole minute', () => {
    expect(formatDuration(44.6)).toBe('45 min');
  });
  it('renders an hour-plus dive in minutes, which is how divers log it', () => {
    expect(formatDuration(72)).toBe('72 min');
  });
  it('returns null for no duration', () => {
    expect(formatDuration(null)).toBeNull();
  });
});

describe('formatTemperature', () => {
  it('rounds to a whole degree', () => {
    expect(formatTemperature(25.6, 'metric')).toBe('26 °C');
  });
  it('keeps a negative reading signed', () => {
    expect(formatTemperature(-1.2, 'metric')).toBe('-1 °C');
  });
  it('returns null for no reading', () => {
    expect(formatTemperature(null, 'metric')).toBeNull();
  });
  it('reads the same stored temperature in the system it is given', () => {
    expect(formatTemperature(25, 'imperial')).toBe('77 °F');
    // Sub-zero water is above zero in Fahrenheit, which is exactly the point of keeping
    // the conversion out of the screens: -1 °C is 30 °F, not -1 °F.
    expect(formatTemperature(-1, 'imperial')).toBe('30 °F');
  });
});

describe('formatPressure', () => {
  it('renders whole bar', () => {
    expect(formatPressure(207.5, 'metric')).toBe('208 bar');
  });
  it('reads the same stored pressure in the system it is given', () => {
    expect(formatPressure(232, 'imperial')).toBe('3365 psi');
  });
  it('returns null for no reading', () => {
    expect(formatPressure(null, 'metric')).toBeNull();
  });
});

describe('formatDiveDate', () => {
  it('renders a stored calendar date without a timezone shift', () => {
    expect(formatDiveDate('2026-08-16')).toBe('16 Aug 2026');
  });
  it('renders 1 January without rolling to the previous year', () => {
    expect(formatDiveDate('2026-01-01')).toBe('1 Jan 2026');
  });
  it('hands back an uninterpretable value unchanged rather than inventing a date', () => {
    expect(formatDiveDate('not a date')).toBe('not a date');
  });
  // Review task 7, cannot-fail #3: 'not a date' never reaches the documented
  // `isCalendarDate` guard this test claims to cover — it's caught by the
  // `Number.isInteger(year)` backstop a few lines down regardless, so deleting the guard
  // survived every test in the suite. The guard's real job is a well-formed-but-impossible
  // date: with it removed this would return the invented "30 Feb 2026" instead.
  it('hands back a well-formed but impossible calendar date unchanged, rather than inventing one', () => {
    expect(formatDiveDate('2026-02-30')).toBe('2026-02-30');
  });
});

describe('formatTimeRange', () => {
  it('shows entry and computed exit', () => {
    expect(formatTimeRange('09:30', 44)).toBe('09:30 – 10:14');
  });
  it('shows entry alone when there is no duration', () => {
    expect(formatTimeRange('09:30', null)).toBe('09:30');
  });
  it('returns null when there is no entry time', () => {
    expect(formatTimeRange(null, 44)).toBeNull();
  });
});

// Review task 7, Minor #4: entry/salinity/waterBody/suit used to reach the screen as the
// raw stored value ("semidry", "quarry") — the database's vocabulary, not the diver's.
// Every union in domain/types.ts for these four fields is a single lowercase word, so a
// shared capitalise-first-letter formatter is enough for all of them with nothing to keep
// in sync as those unions grow — no per-value table to miss an entry in.
describe('formatEntry', () => {
  it('capitalises the stored value', () => {
    expect(formatEntry('shore')).toBe('Shore');
    expect(formatEntry('boat')).toBe('Boat');
  });
  it('returns null for an unrecorded entry', () => {
    expect(formatEntry(null)).toBeNull();
  });
});

describe('formatSalinity', () => {
  it('capitalises the stored value', () => {
    // Two values since M1h, not three: `brackish` was removed deliberately and by name
    // (§10), so a test naming it would no longer compile — which is the point of deriving
    // `Salinity` from `SALINITY_VALUES` rather than writing the union out twice.
    expect(formatSalinity('fresh')).toBe('Fresh');
    expect(formatSalinity('salt')).toBe('Salt');
  });
  it('returns null for an unrecorded salinity', () => {
    expect(formatSalinity(null)).toBeNull();
  });
});

describe('formatWaterBody', () => {
  it('capitalises the stored value', () => {
    expect(formatWaterBody('quarry')).toBe('Quarry');
  });
  it('returns null for an unrecorded water body', () => {
    expect(formatWaterBody(null)).toBeNull();
  });
});

describe('formatSuit', () => {
  it('capitalises the stored value', () => {
    expect(formatSuit('semidry')).toBe('Semidry');
  });
  it('returns null for an unrecorded suit', () => {
    expect(formatSuit(null)).toBeNull();
  });
});

// The fifth field of the same kind, added once the rule had already drifted on screen: the
// dive form's own chip said "Steel" while the detail page rendered the raw stored 'steel'.
describe('formatTankMaterial', () => {
  it('capitalises the stored value', () => {
    expect(formatTankMaterial('steel')).toBe('Steel');
    expect(formatTankMaterial('alu')).toBe('Alu');
  });
  it('returns null for a cylinder whose material was never recorded', () => {
    expect(formatTankMaterial(null)).toBeNull();
  });
});

// `status` is never null (domain/types.ts — the one exception alongside id and date), so
// unlike the four formatters above this one has no null case to return: every dive has one
// to show.
describe('formatDiveStatus', () => {
  it('capitalises a logged dive', () => {
    expect(formatDiveStatus('logged')).toBe('Logged');
  });
  it('capitalises a planned dive', () => {
    expect(formatDiveStatus('planned')).toBe('Planned');
  });
});

// One owner for what a dive is CALLED on screen. DiveRow.tsx and DiveDetailScreen.tsx each
// used to answer this themselves and had already drifted: the row showed "Unnamed site" for
// a dive with no site name while the detail screen showed no title at all. Note this is
// deliberately NOT domain/trips.ts's `tripKeyOf`, which is centre-first and may be null —
// see both docblocks.
describe('diveSiteLabel', () => {
  it('prefers the site, the name a diver would recognise the dive by', () => {
    expect(diveSiteLabel({ siteName: 'Blue Hole', centerName: 'Ponorka' })).toBe('Blue Hole');
  });
  it('falls back to the centre when no site was recorded', () => {
    expect(diveSiteLabel({ siteName: null, centerName: 'Ponorka' })).toBe('Ponorka');
  });
  // Always text, never null: a row or a hero with no heading is a blank line, which is the
  // exact defect this function exists to close. The one hard difference from `tripKeyOf`.
  it('names a dive with neither rather than returning nothing', () => {
    expect(diveSiteLabel({ siteName: null, centerName: null })).toBe(UNNAMED_SITE);
    expect(UNNAMED_SITE).toBe('Unnamed site');
  });
});

// One owner for "N dives" — the "Up next" header's trailing slot (TripHeader.tsx) and the
// day strip's own sentence (DayStrip.tsx) both need it, and the strip already carried its
// own inline copy of the singular/plural choice. Czech (i18next, en + cs) does not pluralise
// on `=== 1`, so the second copy would have had to be found and fixed too.
describe('formatDiveCount', () => {
  it('uses the singular for exactly one dive', () => {
    expect(formatDiveCount(1)).toBe('1 dive');
  });
  it('uses the plural for more than one', () => {
    expect(formatDiveCount(3)).toBe('3 dives');
  });
  // Not reachable from either caller today (the up-next section only renders with dives in
  // it, and a day strip's floor is `canReorder`'s two) — pinned because English pluralises
  // zero like the plural, not like the singular, which is the mistake a bare `count > 1`
  // would make in the other direction.
  it('uses the plural for none', () => {
    expect(formatDiveCount(0)).toBe('0 dives');
  });
});

// §7.5's quiet indicator. The two things worth pinning are the word and the silence: the count
// spans all four synced tables, so "dives" would be a claim a diver could disprove by having a
// preset in it, and zero has to produce nothing at all or the line stops being quiet.
describe('formatPendingChanges', () => {
  it('says nothing at all when the account has everything', () => {
    expect(formatPendingChanges(0)).toBeNull();
  });

  // A count cannot go negative, and a formatter that answered `-1 changes waiting` for one
  // that had would be a sentence about an impossibility rather than a caught mistake.
  it('says nothing for a nonsense count either', () => {
    expect(formatPendingChanges(-1)).toBeNull();
  });

  it('uses the singular for exactly one', () => {
    expect(formatPendingChanges(1)).toBe('1 change waiting to sync');
  });

  it('uses the plural for more than one', () => {
    expect(formatPendingChanges(4)).toBe('4 changes waiting to sync');
  });

  // The word is deliberate and is the opposite choice from §7.4's adoption sentence, which
  // counts dives and says "dives". This one counts rows across `dives`, `gear_presets`,
  // `dive_sites` and `dive_centers` (cloud/sync.ts), so it must not name any one of them.
  it('never calls them dives', () => {
    expect(formatPendingChanges(3)).not.toContain('dive');
  });
});

// Review task 7, Important #1: the eight formatters below are new — they close the seven
// fields that used to build their own `${x} unit` strings inline in DiveDetailScreen.tsx,
// bypassing this module and rendering the literal string "NaN" for exactly the input
// DESIGN.md §10's COERCION CONTRACT requires M1d's form to produce. Each gets the same two
// cases every formatter above does (a real reading, and the absent/non-finite cases this
// module exists to swallow), plus whatever is specific to its own unit.

describe('formatWeight', () => {
  it('renders kilograms unrounded — weighting is often set in half-kilos', () => {
    expect(formatWeight(6.5, 'metric')).toBe('6.5 kg');
  });
  it('returns null for an unrecorded weight rather than a zero', () => {
    expect(formatWeight(null, 'metric')).toBeNull();
  });
  it('reads the same stored weight in the system it is given', () => {
    // Whole pounds, where the metric side keeps the half-kilo it was recorded in — the one
    // pair whose two halves round differently, and deliberately so (format/units.ts).
    expect(formatWeight(6.5, 'imperial')).toBe('14 lb');
    expect(formatWeight(6, 'metric')).toBe('6 kg');
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatWeight(Number.NaN, 'metric')).toBeNull();
  });
});

describe('formatVolume', () => {
  it('renders litres unrounded, since a real cylinder size can be fractional', () => {
    expect(formatVolume(11.1)).toBe('11.1 l');
  });
  it('returns null for an unrecorded size', () => {
    expect(formatVolume(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatVolume(Number.NaN)).toBeNull();
  });
});

describe('formatGasUsed', () => {
  it('rounds a computed total to the whole litre, unlike formatVolume', () => {
    expect(formatGasUsed(2381.7)).toBe('2382 l');
  });
  it('returns null when the total could not be computed', () => {
    expect(formatGasUsed(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatGasUsed(Number.NaN)).toBeNull();
  });
});

describe('formatRmv', () => {
  it('renders to one decimal place', () => {
    expect(formatRmv(18.42)).toBe('18.4 l/min');
  });
  it('returns null when RMV could not be computed', () => {
    expect(formatRmv(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatRmv(Number.NaN)).toBeNull();
  });
});

/**
 * §3's *"RMV trend"* said as a direction. The trap this block exists for is a line that argues
 * with itself: two exact means are essentially never equal, so a raw comparison prints "up
 * from 14.8 l/min" beside a current figure that also reads `14.8 l/min`.
 */
describe('formatRmvTrend', () => {
  it('names the direction and the figure it moved from', () => {
    expect(formatRmvTrend({ recent: 14.8, previous: 16.1 })).toBe('down from 16.1 l/min');
    expect(formatRmvTrend({ recent: 16.1, previous: 14.8 })).toBe('up from 14.8 l/min');
  });

  // **Decided on the formatted figures, not the raw ones.** These two means differ by four
  // hundredths of a litre and both draw as `14.8 l/min`, so the only line that does not
  // contradict the row above it is "steady". Asserted from both sides, because a comparison
  // written the other way round would call one of them a direction.
  it('calls a difference the app cannot show steady', () => {
    expect(formatRmvTrend({ recent: 14.82, previous: 14.78 })).toBe('steady');
    expect(formatRmvTrend({ recent: 14.78, previous: 14.82 })).toBe('steady');
    expect(formatRmvTrend({ recent: 14.8, previous: 14.8 })).toBe('steady');
  });

  // ...and a difference it CAN show is never called steady, or the rule above would have
  // swallowed the whole feature.
  it('still names a direction the app can draw', () => {
    expect(formatRmvTrend({ recent: 14.74, previous: 14.91 })).toBe('down from 14.9 l/min');
  });

  // No earlier window, no direction — the caller draws the recent figure alone rather than a
  // trend stated from one dive.
  it('says nothing at all when there is no earlier window', () => {
    expect(formatRmvTrend({ recent: 14.8, previous: null })).toBeNull();
  });

  it('returns null rather than rendering NaN', () => {
    expect(formatRmvTrend({ recent: Number.NaN, previous: 16.1 })).toBeNull();
    expect(formatRmvTrend({ recent: 14.8, previous: Number.NaN })).toBeNull();
  });
});

/**
 * What "recent" covers, in the diver's own dives. An RMV figure with an unstated window is
 * unreadable, and the sentence has to hold for the small numbers too — a diver with three
 * gas-recorded dives has a mean over three.
 */
describe('formatRmvWindow', () => {
  it('states the window actually averaged, in the plural that fits it', () => {
    expect(formatRmvWindow(5)).toBe('Averaged over the last 5 dives with gas recorded.');
    expect(formatRmvWindow(1)).toBe('Averaged over the last 1 dive with gas recorded.');
  });

  // The plural is `formatDiveCount`'s, not a comparison written again here: English needs one
  // and Czech needs three (§0.5, i18next in M3), and a second copy is a second place to fix.
  it('reads its plural from the one owner of it', () => {
    for (const count of [1, 2, 5]) {
      expect(formatRmvWindow(count)).toContain(formatDiveCount(count));
    }
  });

  // "with gas recorded" is load-bearing: RMV needs an average depth, a duration and a cylinder
  // size together, so the dives behind the figure are a subset of the last five and usually a
  // small one. Without those words the sentence is false for almost every logbook.
  it('says which dives it means', () => {
    expect(formatRmvWindow(5)).toContain('with gas recorded');
  });
});

/**
 * §3's currency, as the diver reads it. The two special cases exist because "0 days ago" reads
 * as a bug and "1 days ago" as one too; everything past them reads perfectly well as itself.
 */
describe('formatDaysSince', () => {
  it('gives today and yesterday words, and everything else a count', () => {
    expect(formatDaysSince(0)).toBe('Today');
    expect(formatDaysSince(1)).toBe('Yesterday');
    expect(formatDaysSince(2)).toBe('2 days ago');
    expect(formatDaysSince(412)).toBe('412 days ago');
  });

  // A negative span is refused rather than drawn: `currency` cannot produce one — it passes over
  // a dive dated ahead of today — and "in 3 days ago" is worse than no line at all.
  it('refuses a span that has not happened, and anything unreadable', () => {
    expect(formatDaysSince(-1)).toBeNull();
    expect(formatDaysSince(null)).toBeNull();
    expect(formatDaysSince(Number.NaN)).toBeNull();
    expect(formatDaysSince(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('formatPercent', () => {
  it('renders a gas fraction unrounded', () => {
    expect(formatPercent(32)).toBe('32 %');
  });
  it('returns null for an unrecorded fraction', () => {
    expect(formatPercent(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatPercent(Number.NaN)).toBeNull();
  });
});

describe('formatConfiguration', () => {
  it('names the rig the way the rest of the vocabularies are named', () => {
    expect(formatConfiguration('single')).toBe('Single');
    expect(formatConfiguration('twinset')).toBe('Twinset');
    expect(formatConfiguration('sidemount')).toBe('Sidemount');
  });
  it('returns null for an unrecorded rig', () => {
    expect(formatConfiguration(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// formatCylinders (§3's preset list, M1e) — a whole cylinder spec on one line
// ---------------------------------------------------------------------------------------

/** One cylinder with only the fields a case cares about, the same per-file fixture shape
 * `derived.test.ts` and `diveFormSchema.test.ts` each keep for `Tank`. */
const tank = (over: Partial<Tank> = {}): Tank => ({
  material: null,
  configuration: null,
  sizeL: null,
  workingBar: null,
  o2Pct: null,
  hePct: null,
  startBar: null,
  endBar: null,
  ...over,
});

describe('formatCylinders', () => {
  // The whole line, asserted as one string rather than by substring: what this function
  // actually decides is the ORDER and the separators, and a `toContain('steel')` would pass
  // against any arrangement of the same words.
  it('reads the rig and cylinder, then its working pressure, then its mix', () => {
    expect(
      formatCylinders([tank({ material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232, o2Pct: 32 })], 'metric'),
    ).toBe('Twinset 12 l Steel · 232 bar · O₂ 32 %');
  });

  // The rule that changed with §10's `count` → `configuration`. A `2 ×` multiplier could not
  // tell a twinset from a sidemount, which is exactly the distinction that ruling made real,
  // so the rig is named rather than counted — and the two rigs must read differently here
  // even though `cylinderCount` gives them the same number.
  it('tells a twinset from a sidemount, which a multiplier could not', () => {
    expect(formatCylinders([tank({ sizeL: 12, configuration: 'twinset' })], 'metric')).toBe('Twinset 12 l');
    expect(formatCylinders([tank({ sizeL: 12, configuration: 'sidemount' })], 'metric')).toBe('Sidemount 12 l');
  });

  // `single` is shown, where a count of `1` was suppressed as noise. It is a fact the diver
  // recorded about their rig rather than arithmetic — and suppressing it would let a
  // cylinder that records nothing else summarise to nothing at all, silently losing the only
  // thing it has to say.
  it('names a single rig rather than treating it as noise', () => {
    expect(formatCylinders([tank({ material: 'steel', sizeL: 12, configuration: 'single' })], 'metric')).toBe('Single 12 l Steel');
    expect(formatCylinders([tank({ configuration: 'single' })], 'metric')).toBe('Single');
  });

  // §6 stores bar; §3 shows the diver their own units. `formatPressure` owns the conversion,
  // and this is the assertion that the summary actually goes through it.
  it('reads the working pressure in the diver’s own units', () => {
    expect(formatCylinders([tank({ sizeL: 11.1, workingBar: 207 })], 'imperial')).toBe('11.1 l · 3002 psi');
  });

  // §10: "Cylinder volume stays litres in both systems" — the imperial counterpart is the
  // cubic foot, which is a different quantity rather than a conversion. So this figure must
  // NOT move between the two cases above and this one.
  it('leaves the size in litres in both systems', () => {
    expect(formatCylinders([tank({ sizeL: 11.1 })], 'imperial')).toBe('11.1 l');
    expect(formatCylinders([tank({ sizeL: 11.1 })], 'metric')).toBe('11.1 l');
  });

  // Both fractions carry the label constants `O2_LABEL`/`HE_LABEL` rather than standing as
  // bare percentages: a trimix cylinder shows two of them, and "32 % · 21 %" says which is
  // which to nobody. Asserted through the constants themselves, so a respelling there moves
  // this line with it (that pair exists because those two labels had already drifted).
  it('names each gas fraction, since a trimix cylinder shows two', () => {
    expect(formatCylinders([tank({ o2Pct: 21, hePct: 35 })], 'metric')).toBe(
      `${O2_LABEL} 21 % · ${HE_LABEL} 35 %`,
    );
  });

  // A bottom mix and a deco gas are most of what a multi-cylinder preset is for, so both
  // are shown — joined with the `+` a diver writes them with, which also keeps the middots
  // inside one cylinder readable as belonging to it.
  it('joins several cylinders with a plus', () => {
    expect(
      formatCylinders([tank({ sizeL: 12, material: 'steel' }), tank({ sizeL: 11.1, material: 'alu', o2Pct: 50 })], 'metric'),
    ).toBe('12 l Steel + 11.1 l Alu · O₂ 50 %');
  });

  // Every field is nullable (§6) and a preset filled in halfway is ordinary, so an
  // unrecorded field is absent rather than shown as a dash or a zero.
  it('omits every field the cylinder does not record', () => {
    expect(formatCylinders([tank({ material: 'alu' })], 'metric')).toBe('Alu');
  });

  // `null`, not an empty string: the caller shows a different row entirely when a preset has
  // nothing to summarise, and an empty string would draw a blank line under the name.
  it.each([
    ['no cylinders at all', [] as Tank[]],
    ['one cylinder recording nothing', [tank()]],
    ['nothing but the gauge readings a preset never stores', [tank({ startBar: 200, endBar: 60 })]],
  ])('is null for %s', (_case, tanks) => {
    expect(formatCylinders(tanks, 'metric')).toBeNull();
  });

  // The material is the same closed vocabulary `formatTankMaterial` owns — the "Steel" on one
  // screen and "steel" on the next that §4.1 names as a shipped defect. Read through that
  // function rather than retyped, so the two cannot part company here either.
  it('spells the material the way the rest of the app does', () => {
    expect(formatCylinders([tank({ material: 'steel' })], 'metric')).toBe(formatTankMaterial('steel'));
  });
});

// ---------------------------------------------------------------------------------------
// formatCylinderSpec (the dive form's cylinder row, M1h) — the spec WITHOUT the gas
// ---------------------------------------------------------------------------------------
//
// §2.2: the form collapses rig, size, material and working pressure into one row and expands
// them when a diver wants to correct them on this dive, while the gas and the two pressures
// stay directly editable beside it. So the two lines exist for two questions — "what kind of
// cylinder is this" and "what is in it" — and the one thing that must not happen is a second
// statement of the order and the separators.
describe('formatCylinderSpec', () => {
  it('reads the rig, cylinder and working pressure, and says nothing about the gas', () => {
    const full = tank({ material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232, o2Pct: 32, hePct: 21 });
    expect(formatCylinderSpec(full, 'metric')).toBe('Twinset 12 l Steel · 232 bar');
  });

  // The composition, asserted as a composition. `formatCylinders` prefixes its line with
  // exactly this string — so a second, drifting copy of the order or the separators inside
  // either function fails here rather than showing one cylinder two ways on two screens. It
  // is the same assertion shape the material test above makes against `formatTankMaterial`.
  it('is the opening of the whole-cylinder line, not a second spelling of it', () => {
    const full = tank({ material: 'alu', configuration: 'single', sizeL: 11.1, workingBar: 207, o2Pct: 32 });
    const spec = formatCylinderSpec(full, 'metric');
    expect(spec).not.toBeNull();
    expect(formatCylinders([full], 'metric')).toBe(`${spec} · ${O2_LABEL} 32 %`);
  });

  // The pressures are a dive's gauge readings and the gas is a dive's mix; neither is part of
  // what kind of cylinder this is. A cylinder recording only those has no spec to show, and
  // the form draws its four fields rather than a summary for exactly this answer — so `null`
  // here is load-bearing rather than tidy.
  it.each([
    ['nothing at all', tank()],
    ['nothing but the gauge readings', tank({ startBar: 200, endBar: 60 })],
    ['nothing but a mix', tank({ o2Pct: 32, hePct: 21 })],
  ])('is null for a cylinder recording %s', (_case, only) => {
    expect(formatCylinderSpec(only, 'metric')).toBeNull();
  });

  // The one figure in this line that converts (§6 stores bar), through the same owner the
  // whole-cylinder line uses.
  it('reads the working pressure in the diver’s own units', () => {
    expect(formatCylinderSpec(tank({ sizeL: 11.1, workingBar: 207 }), 'imperial')).toBe('11.1 l · 3002 psi');
  });
});

describe('the M1h vocabularies', () => {
  it('names the weather, the visibility judgement and the weighting feel', () => {
    expect(formatWeather('cloudy')).toBe('Cloudy');
    expect(formatVisibility('average')).toBe('Average');
    expect(formatWeightsFeel('over')).toBe('Over');
  });

  it('returns null for each of them when nothing was recorded', () => {
    expect(formatWeather(null)).toBeNull();
    expect(formatVisibility(null)).toBeNull();
    expect(formatWeightsFeel(null)).toBeNull();
  });

  it('renders every member of every vocabulary, rather than only the ones a test named', () => {
    // The shared `capitalize` is what makes this true, and it is the reason these five
    // vocabularies cost ten lines instead of five lookup tables — so the property worth
    // pinning is that no member falls through it.
    for (const value of [...WEATHER_VALUES, ...VISIBILITY_VALUES, ...WEIGHTS_FEEL_VALUES, ...CONFIGURATION_VALUES]) {
      const rendered = [formatWeather, formatVisibility, formatWeightsFeel, formatConfiguration]
        .map((format) => format(value as never))
        .find((text) => text !== null);
      expect(rendered).toBe(value.charAt(0).toUpperCase() + value.slice(1));
    }
  });
});

describe('formatSuitThickness', () => {
  it('reads in millimetres, unrounded, since 3.5 mm suits are real', () => {
    expect(formatSuitThickness(5)).toBe('5 mm');
    expect(formatSuitThickness(3.5)).toBe('3.5 mm');
  });

  it('is null for an unrecorded thickness, and for a value that is not a real number', () => {
    expect(formatSuitThickness(null)).toBeNull();
    expect(formatSuitThickness(Number.NaN)).toBeNull();
    expect(formatSuitThickness(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('formatEquipment', () => {
  it('reads the accessory set as a middot list', () => {
    expect(formatEquipment(['hood', 'gloves', 'torch'])).toBe('Hood · Gloves · Torch');
  });

  it('keeps the array\'s own order rather than re-sorting it into the vocabulary\'s', () => {
    // Imposing the order here would be a second owner of it, and would quietly restate what
    // some other client recorded.
    expect(formatEquipment(['torch', 'hood'])).toBe('Torch · Hood');
  });

  it('is null for an empty set, so a caller omits the row instead of drawing a blank one', () => {
    expect(formatEquipment([])).toBeNull();
  });

  it('is null rather than a throw for a value that is not a set at all', () => {
    // This module's own top docblock makes that the rule for every formatter here: a value
    // that reached the database from an older or buggy client comes back as null so the
    // caller omits the element, never as an exception on a screen. The type says it cannot
    // happen; `db/dives.ts`'s `toDive` makes the same assumption explicitly and then checks
    // it anyway, for the same reason.
    expect(() => formatEquipment(null as unknown as Equipment[])).not.toThrow();
    expect(formatEquipment(null as unknown as Equipment[])).toBeNull();
    expect(formatEquipment('hood' as unknown as Equipment[])).toBeNull();
  });

  it('spells one token the same way the form\'s own chip does', () => {
    // The `Steel`/`steel` drift, one field over: the chip label and the detail row are the
    // same string by construction rather than by two authors agreeing.
    expect(formatEquipment(['camera'])).toBe(formatEquipmentToken('camera'));
  });
});

describe('the three 0–3 condition scales', () => {
  // One word per level, and **three different sets of words for the same three numbers** —
  // which is the whole reason these are three functions over one `CONDITION_SCALE_VALUES`
  // rather than one shared formatter. Level 0 is flat water and no current; level 1 is a
  // small wave, a light current and some surge. A single scale would have to pick one
  // wording and be wrong about two subjects.
  it.each([
    [0, 'Flat', 'None', 'None'],
    [1, 'Small', 'Light', 'Some'],
    [2, 'Medium', 'Medium', 'Medium'],
    [3, 'Large', 'Strong', 'Strong'],
  ])('reads level %s as its own word on each of the three scales', (level, waves, current, surge) => {
    expect(formatWaves(level as number)).toBe(waves);
    expect(formatCurrent(level as number)).toBe(current);
    expect(formatSurge(level as number)).toBe(surge);
  });

  // Every level the domain declares has a word — swept from `CONDITION_SCALE_VALUES` rather
  // than from the four rows above, so widening that list fails here instead of silently
  // rendering the new level as a bare digit through the fallback below. The fallback is for
  // values from *other* clients; it must never quietly cover one of our own.
  it.each(CONDITION_SCALE_VALUES)('gives level %s a word rather than a digit on every scale', (level) => {
    for (const format of [formatWaves, formatCurrent, formatSurge]) {
      expect(format(level)).not.toBe(String(level));
    }
  });

  it('returns null for an unrecorded reading', () => {
    expect(formatWaves(null)).toBeNull();
    expect(formatCurrent(null)).toBeNull();
    expect(formatSurge(null)).toBeNull();
  });

  it('returns null rather than rendering NaN', () => {
    expect(formatWaves(Number.NaN)).toBeNull();
  });

  // DESIGN.md §10 keeps these columns unclamped, so M2 sync can deliver a level this build
  // has no word for. It is shown **as the number it is** rather than dropped: a formatter
  // returning null here would delete the value from the dive detail, which omits a row whose
  // formatter says nothing — so the diver would see no Waves row at all over a dive that
  // records one.
  it('falls back to the bare number for a level outside the scale, rather than hiding it', () => {
    expect(formatWaves(7)).toBe('7');
    expect(formatCurrent(-1)).toBe('-1');
    // Not rounded to the nearest level either: inventing "Small" for 1.5 would be this
    // module deciding what a diver meant.
    expect(formatSurge(1.5)).toBe('1.5');
  });
});

describe('formatCoordinates', () => {
  it('renders both coordinates to five decimal places', () => {
    expect(formatCoordinates(50.123456, 14.567891)).toBe('50.12346, 14.56789');
  });
  it('returns null when either coordinate alone is missing — a lone one is not a point', () => {
    expect(formatCoordinates(null, 14.5)).toBeNull();
    expect(formatCoordinates(50.1, null)).toBeNull();
  });
  it('returns null rather than rendering half a NaN pair', () => {
    expect(formatCoordinates(Number.NaN, 14.5)).toBeNull();
    expect(formatCoordinates(50.1, Number.NaN)).toBeNull();
  });
});

describe('formatRating', () => {
  it('renders out of five', () => {
    expect(formatRating(4)).toBe('4 / 5');
  });
  it('returns null for an unrecorded rating', () => {
    expect(formatRating(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatRating(Number.NaN)).toBeNull();
  });
});

// Review task 7, Important #2: surfaceIntervalMin used to reach the screen through
// formatDuration, unbounded — two logged dives a year apart rendered "525555 min".
// derived.ts now refuses anything a day or over, so this only ever has to present a value
// under 24 h — but even well inside that bound, a raw minute count stops being readable
// long before it stops being real: "1340 min" does not read as "almost a day" the way
// "22 h 20 min" does.
describe('formatSurfaceInterval', () => {
  it('renders under an hour in plain minutes, like a short dive duration', () => {
    expect(formatSurfaceInterval(44)).toBe('44 min');
  });
  it('switches to hours and minutes at an hour and above', () => {
    expect(formatSurfaceInterval(102)).toBe('1 h 42 min');
    expect(formatSurfaceInterval(1340)).toBe('22 h 20 min');
  });
  it('drops the minutes when they are exactly zero', () => {
    expect(formatSurfaceInterval(120)).toBe('2 h');
  });
  it('returns null for no previous dive to measure from', () => {
    expect(formatSurfaceInterval(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatSurfaceInterval(Number.NaN)).toBeNull();
  });
});

// §3's "hours underwater" — a whole logbook's bottom time. Its own exported name over
// `formatSurfaceInterval`'s shape rule, because they answer different questions about different
// quantities; what they must never do is disagree about the shape, which one shared
// `hoursAndMinutes` makes impossible rather than merely tested.
describe('formatTimeUnderwater', () => {
  it('reads a career total in hours and minutes', () => {
    expect(formatTimeUnderwater(5772)).toBe('96 h 12 min');
  });
  // The span this one can take is unbounded, unlike a surface interval, which `derived.ts`
  // already refuses at a day. A logbook of a thousand dives is the ordinary case here and would
  // be a bug there.
  it('does not stop at a day the way a surface interval does', () => {
    expect(formatTimeUnderwater(60 * 24 * 3)).toBe('72 h');
  });
  it('reads a single short logbook in plain minutes', () => {
    expect(formatTimeUnderwater(47)).toBe('47 min');
  });
  it('drops the minutes when they are exactly zero', () => {
    expect(formatTimeUnderwater(120)).toBe('2 h');
  });
  // A recorded zero is a reading, not an absence — `logbookStats` keeps the two apart and this
  // is the half that has to show it.
  it('renders a recorded zero rather than dropping it', () => {
    expect(formatTimeUnderwater(0)).toBe('0 min');
  });
  it('returns null when nothing recorded a duration at all', () => {
    expect(formatTimeUnderwater(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatTimeUnderwater(Number.NaN)).toBeNull();
  });
  // The two names are one shape, and this is what would fail if a second copy of the arithmetic
  // ever appeared under one of them.
  it('reads a span exactly as a surface interval of the same length does', () => {
    for (const minutes of [0, 1, 59, 60, 61, 119, 120, 1340]) {
      expect(formatTimeUnderwater(minutes)).toBe(formatSurfaceInterval(minutes));
    }
  });
});

// **The line under the Dives large title** (§0.6): `128 dives · 96 h 12 min · deepest 41.2 m`.
// Assembled from the owners that already have each piece; what is decided here is the order,
// the word "deepest", and which figures appear at all.
describe('formatLogbookSummary', () => {
  // **The spaces inside a figure are U+00A0** (M1m), so this line — the one line in the app
  // that wraps — can only fold at a middot. Every assertion below except `breaks only between
  // figures` is a claim about WORDS, so it reads the line back with its spaces normalised: a
  // non-breaking space is indistinguishable from a space on screen and in a diff, and pasting
  // invisible ones into eight expectations would make every one of them unreadable and fragile
  // for a reason none of them is about. The rule itself gets its own test, which is where the
  // characters are named out loud.
  const words = (line: string) => line.replaceAll(NON_BREAKING_SPACE, ' ');

  it('reads the three figures §3 gives the Stats tab, in that order', () => {
    expect(words(formatLogbookSummary({ dives: 128, minutes: 5772, deepestM: 41.2 }, 'metric'))).toBe(
      '128 dives · 96 h 12 min · deepest 41.2 m',
    );
  });

  // §4.1: the depth follows the diver like every other depth in the app, through `formatDepth`
  // and never a second conversion. §10 gives imperial whole feet, so the ragged figure is what
  // proves the line went through the pair rather than round it.
  it('reads the depth in the diver own units', () => {
    expect(words(formatLogbookSummary({ dives: 128, minutes: 5772, deepestM: 41.2 }, 'imperial'))).toBe(
      '128 dives · 96 h 12 min · deepest 135 ft',
    );
  });

  // **A figure with nothing behind it is omitted, not drawn as an em dash** — this module's
  // standing rule (its own top docblock), and what every other middot list in the app does.
  it('omits a figure nothing recorded rather than printing a placeholder', () => {
    expect(words(formatLogbookSummary({ dives: 28, minutes: null, deepestM: 18 }, 'metric'))).toBe(
      '28 dives · deepest 18.0 m',
    );
    expect(words(formatLogbookSummary({ dives: 28, minutes: 640, deepestM: null }, 'metric'))).toBe(
      '28 dives · 10 h 40 min',
    );
    expect(words(formatLogbookSummary({ dives: 28, minutes: null, deepestM: null }, 'metric'))).toBe('28 dives');
  });

  // **The count never drops out**, including at zero. On the empty logbook this line is the
  // whole of what tells "read and holds nothing" apart from "has not answered yet" (§10, M1h) —
  // and it must still be exactly the words `formatDiveCount` gives it, since the screen's own
  // test asserts that pair through this function.
  it('still says how many dives when there are none, and says only that', () => {
    expect(words(formatLogbookSummary({ dives: 0, minutes: null, deepestM: null }, 'metric'))).toBe('0 dives');
    expect(words(formatLogbookSummary({ dives: 0, minutes: null, deepestM: null }, 'metric'))).toBe(formatDiveCount(0));
  });

  it('says one dive in the singular, like every other count in the app', () => {
    expect(words(formatLogbookSummary({ dives: 1, minutes: 47, deepestM: 18.4 }, 'metric'))).toBe(
      '1 dive · 47 min · deepest 18.4 m',
    );
  });

  // **Where this line is allowed to fold** (§0.6, M1m). It is the one line in the app with a
  // measure — the header column stops at the floating capsule's leading edge — so it wraps, and
  // the owner's sheet draws the fold at a middot: `128 dives · 96 h 12 min ·` above `deepest
  // 41.2 m`. Nothing in the string says that on its own; with ordinary spaces throughout, the
  // device folds wherever the width happens to run out — seen on the simulator as `8 dives · 5 h
  // 19 min · deepest 41.2` above a line holding nothing but `m`, and one word earlier at this
  // example, which tears `deepest` off the figure it labels. Either way a figure loses its unit
  // or its label, which is a worse line than the one the cap was added to prevent.
  //
  // Asserted as the SET OF BREAK OPPORTUNITIES rather than as the finished string, because that
  // is the actual rule and it holds in every language: split the line on ordinary spaces and
  // what comes back must be the figures and the middots, whole. Pasting the expected line with
  // invisible U+00A0s in it would assert the same thing in a form no reader could check.
  it('breaks only between figures, never inside one', () => {
    const line = formatLogbookSummary({ dives: 128, minutes: 5772, deepestM: 41.2 }, 'metric');
    expect(line.split(' ')).toEqual([
      `128${NON_BREAKING_SPACE}dives`,
      '·',
      `96${NON_BREAKING_SPACE}h${NON_BREAKING_SPACE}12${NON_BREAKING_SPACE}min`,
      '·',
      `deepest${NON_BREAKING_SPACE}41.2${NON_BREAKING_SPACE}m`,
    ]);
    // The separator itself keeps its ordinary spaces — it is the whole of what may break, so a
    // `METADATA_SEPARATOR` that ever went non-breaking would leave the line no fold at all and
    // put it straight back under the capsule.
    expect(METADATA_SEPARATOR).not.toContain(NON_BREAKING_SPACE);
    expect(line).toContain(METADATA_SEPARATOR);
  });

  // **The shortest possible line cannot wrap at all**, which is the empty logbook's (§10, M1h):
  // "0 dives" is two words and one space, and that space is non-breaking like every other space
  // inside a figure — so the branch whose whole job is to say the logbook was read and holds
  // nothing says it on one line, at any column width, in any language.
  it('leaves the empty logbook line with nowhere to break', () => {
    const line = formatLogbookSummary({ dives: 0, minutes: null, deepestM: null }, 'metric');
    expect(line).not.toContain(' ');
    expect(words(line)).toBe(formatDiveCount(0));
  });

  // A depth the app would refuse to draw is refused here too, because the figure goes through
  // `formatDepth` — so the line can never name a depth no screen in the app would print.
  it('drops a depth that is not a depth', () => {
    expect(words(formatLogbookSummary({ dives: 3, minutes: 120, deepestM: Number.NaN }, 'metric'))).toBe(
      '3 dives · 2 h',
    );
  });
});

// DESIGN.md §3's Settings entry: the two words a diver chooses between. Derived from
// `UNIT_SYSTEMS` rather than asserted as a hand-written pair, for the reason §4.1 gives —
// a third system added to `format/units.ts` must not be able to render as nothing here
// while a two-case test went on passing. The two spellings are then pinned individually,
// so "capitalises whatever it is given" cannot pass while returning the wrong words.
describe('formatUnitSystem', () => {
  it('names every system format/units.ts declares', () => {
    for (const system of UNIT_SYSTEMS) {
      const label = formatUnitSystem(system);
      expect(label).not.toBe('');
      expect(label).toBe(label.charAt(0).toUpperCase() + label.slice(1));
    }
  });
  it('reads "Metric" and "Imperial"', () => {
    expect(formatUnitSystem('metric')).toBe('Metric');
    expect(formatUnitSystem('imperial')).toBe('Imperial');
  });
});

// ---------------------------------------------------------------------------------------
// The Map tab's own sentences (M2n — DESIGN.md §3's Map bullet)
// ---------------------------------------------------------------------------------------

// §3 asks the site sheet for a "depth/temp summary", and the temp half is a SPAN rather than a
// mean because a mean is a reading no dive took (`waterTempRange`, domain/mapSites.ts, carries
// that argument). What this function decides is only how the two figures read.
describe('formatTemperatureRange', () => {
  it('writes the unit once, after the pair', () => {
    expect(formatTemperatureRange({ coldestC: 18, warmestC: 24 }, 'metric')).toBe('18–24 °C');
  });

  // A range with nothing in it is not a range. The comparison is on the CONVERTED, rounded
  // figures rather than on the stored Celsius, which is what a diver is actually reading.
  it('collapses to one figure when both ends print the same', () => {
    expect(formatTemperatureRange({ coldestC: 21, warmestC: 21 }, 'metric')).toBe('21 °C');
    expect(formatTemperatureRange({ coldestC: 21.2, warmestC: 21.4 }, 'metric')).toBe('21 °C');
  });

  it('converts both ends, and decides the collapse in the diver’s own system', () => {
    expect(formatTemperatureRange({ coldestC: 18, warmestC: 24 }, 'imperial')).toBe('64–75 °F');
    // 21.2 °C and 21.4 °C are one figure in Celsius and two in Fahrenheit, which is correct:
    // the figures a diver reads are what may or may not differ.
    expect(formatTemperatureRange({ coldestC: 21.2, warmestC: 21.9 }, 'imperial')).toBe('70–71 °F');
  });

  it('keeps the sign on water below zero', () => {
    expect(formatTemperatureRange({ coldestC: -1, warmestC: 4 }, 'metric')).toBe('-1–4 °C');
  });

  it('says nothing when there is no range, and nothing about a corrupt one', () => {
    expect(formatTemperatureRange(null, 'metric')).toBeNull();
    expect(formatTemperatureRange({ coldestC: Number.NaN, warmestC: 4 }, 'metric')).toBeNull();
  });
});

// §3: "tapping a site shows your dives there with a depth/temp summary". The count and the depth
// come from `logbookStats` — the same owner the Dives header asks — so the figures cannot mean
// one thing there and another here.
describe('formatSiteSummary', () => {
  it('reads count, depth and water', () => {
    expect(
      formatSiteSummary({ dives: 4, minutes: 180, deepestM: 18.2 }, { coldestC: 18, warmestC: 24 }, 'metric'),
    ).toBe('4 dives · deepest 18.2 m · 18–24 °C');
  });

  // **Not `formatLogbookSummary`, and the difference is one figure.** That line is §3's Stats
  // triple about a whole logbook; this is §3's depth/temp pair about one place, so the hours are
  // absent even when `logbookStats` has them. A near-duplicate that answers a different question
  // (§4.1) — asserted, because "reuse the other one" is the obvious wrong tidy-up.
  it('leaves the hours out, even when the stats carry them', () => {
    const line = formatSiteSummary({ dives: 4, minutes: 180, deepestM: 18.2 }, null, 'metric');
    expect(line).not.toContain('h');
    expect(line).toBe('4 dives · deepest 18.2 m');
  });

  // This module's standing rule: a figure with nothing behind it is omitted, never drawn as a
  // placeholder. The count is the one that always stays.
  it('omits a figure with nothing behind it', () => {
    expect(formatSiteSummary({ dives: 1, minutes: null, deepestM: null }, null, 'metric')).toBe('1 dive');
    expect(
      formatSiteSummary({ dives: 2, minutes: null, deepestM: null }, { coldestC: 12, warmestC: 12 }, 'metric'),
    ).toBe('2 dives · 12 °C');
  });

  it('converts to the diver’s own system', () => {
    expect(
      formatSiteSummary({ dives: 3, minutes: null, deepestM: 18.2 }, { coldestC: 18, warmestC: 24 }, 'imperial'),
    ).toBe('3 dives · deepest 60 ft · 64–75 °F');
  });

  // §0.6's rule for the Dives header applies here for the identical reason and is enforced by
  // the caller's style, not by this string — but the words must not sneak a colour in either, so
  // this is the line's own half of it: no band, no hue, just the figure.
  it('says the depth as an aggregate, with no claim about a band', () => {
    expect(formatSiteSummary({ dives: 9, minutes: null, deepestM: 41.2 }, null, 'metric')).toBe(
      '9 dives · deepest 41.2 m',
    );
  });
});

// The line under the Map tab's title. It says which layer is showing — the toggle is one glyph
// and cannot report a state, and §0.1 leaves no hue to say it with — and how much of the logbook
// is actually on the map, which is the honest half: no dive logged before M2l can carry a fix.
describe('the map layer lines', () => {
  it('names the layer and states the coverage', () => {
    expect(formatMyDivesSummary(3, 7, 24)).toBe('Your dives · 3 sites · 7 of 24 dives on the map');
  });

  // "7 of 7 dives on the map" is a sentence nobody writes, and "1 of 1 dives" is worse.
  it('drops the "of" once every dive is on the map', () => {
    expect(formatMyDivesSummary(2, 24, 24)).toBe('Your dives · 2 sites · 24 dives on the map');
    expect(formatMyDivesSummary(1, 1, 1)).toBe('Your dives · 1 site · 1 dive on the map');
  });

  // **"on the map", not "pinned"**, and the words are not interchangeable: the figure counts
  // every dive at a place the map could position, including dives there carrying no fix of their
  // own — which is exactly what the badges add up to.
  it('counts dives at a placed site, not fixes', () => {
    expect(formatMyDivesSummary(1, 4, 9)).toContain('4 of 9 dives on the map');
  });

  it('pluralises a single site', () => {
    expect(formatMyDivesSummary(1, 2, 2)).toContain('1 site ·');
    expect(formatCommunitySummary(1)).toBe('Community · 1 site');
    expect(formatCommunitySummary(12)).toBe('Community · 12 sites');
  });

  // The two lines are different shapes on purpose — a community site is not the diver's, so
  // there is no coverage figure to give and nothing that could be reported for the wrong layer.
  it('says nothing about coverage on the community layer', () => {
    expect(formatCommunitySummary(12)).not.toContain('on the map');
    expect(formatCommunitySummary(12)).not.toContain('Your dives');
  });
});

// What the catalogue knows about a site, under its name on the community layer. Every element is
// one of this module's existing formatters, so a site's `entry` reads the same word here as on
// the dive that was logged there (§4.1).
describe('formatSiteFacts', () => {
  it('reads country, entry, salinity, water body and the site’s own depth', () => {
    expect(
      formatSiteFacts(
        { country: 'Croatia', entry: 'boat', salinity: 'salt', waterBody: 'ocean', maxDepthM: 34 },
        'metric',
      ),
    ).toBe('Croatia · Boat · Salt · Ocean · 34.0 m');
  });

  // §5 asks a new site only for a name, so a row with nothing else is the expected shape rather
  // than a degraded one — null, so a caller draws no line at all rather than an empty one.
  it('says nothing at all about a site that carries nothing but a name', () => {
    expect(
      formatSiteFacts({ country: null, entry: null, salinity: null, waterBody: null, maxDepthM: null }, 'metric'),
    ).toBeNull();
    expect(
      formatSiteFacts({ country: '', entry: null, salinity: null, waterBody: null, maxDepthM: null }, 'metric'),
    ).toBeNull();
  });

  it('omits whichever facts are missing rather than reserving a slot for them', () => {
    expect(
      formatSiteFacts({ country: 'Croatia', entry: null, salinity: null, waterBody: null, maxDepthM: 34 }, 'metric'),
    ).toBe('Croatia · 34.0 m');
  });

  it('converts the site depth to the diver’s own system', () => {
    expect(
      formatSiteFacts({ country: null, entry: null, salinity: null, waterBody: null, maxDepthM: 34 }, 'imperial'),
    ).toBe('112 ft');
  });
});


/**
 * **§3's certification wallet, as a diver reads it** (M3b).
 *
 * Both of these fail quietly: a label that falls back too eagerly turns a real card into a
 * placeholder, and a summary that says "expires" over a date that has passed tells a diver
 * their O₂ card is still good. The judgement behind the second — whether the card has run out —
 * is `certificationExpiry`'s (domain/certifications.ts) and is tested there; what is tested
 * here is the wording it decides.
 */
describe('certificationLabel', () => {
  it('reads the agency and the course together, the way a diver says it', () => {
    expect(certificationLabel({ agency: 'PADI', course: 'Rescue Diver' })).toBe('PADI Rescue Diver');
  });

  it('takes whichever half the card has', () => {
    expect(certificationLabel({ agency: 'SSI', course: null })).toBe('SSI');
    expect(certificationLabel({ agency: null, course: 'Open Water' })).toBe('Open Water');
  });

  /**
   * Always a string, never null — `diveSiteLabel`'s contract, and the same reason: a row with
   * no heading is a blank line, which is the defect itself. §6 makes every column nullable, so
   * a card naming nothing can arrive from another client even though `certificationRefusal`
   * will not let a diver author one.
   */
  it('falls back for a card that names nothing, blanks included', () => {
    expect(certificationLabel({ agency: null, course: null })).toBe(UNTITLED_CERTIFICATION);
    expect(certificationLabel({ agency: '   ', course: '' })).toBe(UNTITLED_CERTIFICATION);
  });
});

describe('formatCertificationSummary', () => {
  const card = {
    cardNumber: '1234567',
    issuedOn: '2018-07-14',
    expiresOn: null as string | null,
  };

  it('lists the number and the issue date, middot-separated', () => {
    expect(formatCertificationSummary(card, null)).toBe('#1234567 · issued 14 Jul 2018');
  });

  it('says a card is still good in the present tense', () => {
    expect(formatCertificationSummary({ ...card, expiresOn: '2027-07-14' }, 'current')).toBe(
      '#1234567 · issued 14 Jul 2018 · expires 14 Jul 2027',
    );
  });

  /** The fact the diver would want to see, and nothing more: no colour (§0.1 spends hue on
   * depth alone), no icon, no nudge. §3 gives currency and its refresher sentence to the Stats
   * screen. */
  it('says a card has run out in the past tense, and nothing else happens', () => {
    expect(formatCertificationSummary({ ...card, expiresOn: '2024-07-14' }, 'expired')).toBe(
      '#1234567 · issued 14 Jul 2018 · expires 14 Jul 2024'.replace('expires', 'expired'),
    );
  });

  /** A date this build cannot judge is still the diver's, so it is shown as it stands rather
   * than judged — `certificationExpiry` answering null is the "we do not know" case. */
  it('keeps the present tense when the expiry could not be judged', () => {
    expect(formatCertificationSummary({ ...card, expiresOn: 'sometime' }, null)).toBe(
      '#1234567 · issued 14 Jul 2018 · expires sometime',
    );
  });

  it('omits every part the card has nothing behind', () => {
    expect(formatCertificationSummary({ cardNumber: null, issuedOn: null, expiresOn: '2027-07-14' }, 'current')).toBe(
      'expires 14 Jul 2027',
    );
    expect(formatCertificationSummary({ cardNumber: '  ', issuedOn: '2018-07-14', expiresOn: null }, null)).toBe(
      'issued 14 Jul 2018',
    );
  });

  /**
   * **Null rather than an em dash**, which is §3's own distinction rather than an
   * inconsistency with the Stats screen: M3a gives a dash to a screen with a fixed inventory,
   * and this is a list whose rows vary with what the diver recorded. An empty second line
   * under a name reads as a value that failed to load — `settingsPresetSummary` one section up
   * already omits its own for the same reason.
   */
  it('answers null when there is nothing to add beyond the card’s own name', () => {
    expect(formatCertificationSummary({ cardNumber: null, issuedOn: null, expiresOn: null }, null)).toBeNull();
  });
});
