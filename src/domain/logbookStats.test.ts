import { dive } from './diveFixture';
import {
  countriesVisited,
  currency,
  logbookStats,
  rmvTrend,
  sitesVisited,
  type SiteCountry,
} from './logbookStats';
import { type Dive, type Tank } from './types';

/**
 * §3's three Stats figures, computed once for both callers — the summary line under the Dives
 * title (M1l) and M3's Stats screen. What these tests are about is the three ways this figure
 * set can be wrong while looking perfectly plausible: a planned dive counted, a missing reading
 * treated as a zero, and a corrupt value poisoning the whole total.
 */

describe('logbookStats', () => {
  // **The rule most likely to ship missing** (§2.4: a planned dive is "excluded from stats and
  // dive numbering"). A test that seeds three ordinary logged dives passes whether or not the
  // exclusion exists, so every assertion here has a plan in the input.
  //
  // All three figures, not just the count: a plan set up on the boat carries a site and often a
  // cylinder, and nothing stops it carrying a depth — §1 never blocks a save — so a plan that
  // slipped into the population would drag the deepest figure as readily as the count.
  it('leaves planned dives out of all three figures', () => {
    const stats = logbookStats([
      dive({ status: 'logged', durationMin: 40, maxDepthM: 18 }),
      dive({ status: 'planned', durationMin: 60, maxDepthM: 45 }),
    ]);
    expect(stats).toEqual({ dives: 1, minutes: 40, deepestM: 18 });
  });

  // A logbook holding nothing but plans is not an empty one — it has been used — and it has no
  // logged dive to report. `0 dives` over an "Up next" section is the true reading, and it is
  // the case the screen actually renders (DivesScreen.test.tsx has the other half).
  it('reports a logbook of plans as holding no dives at all', () => {
    expect(logbookStats([dive({ status: 'planned', durationMin: 55, maxDepthM: 30 })])).toEqual({
      dives: 0,
      minutes: null,
      deepestM: null,
    });
  });

  // Exact-match on `'logged'`, the convention `assignDiveNumbers` and `splitPlanned` already
  // follow: a status this build has never heard of (an older client, M2 sync) is not
  // affirmatively logged, so it is not counted rather than being counted by default.
  it('counts only what is affirmatively logged', () => {
    const odd = { ...dive({ durationMin: 30 }), status: 'archived' } as unknown as ReturnType<typeof dive>;
    expect(logbookStats([odd]).dives).toBe(0);
  });

  it('adds up the durations and takes the deepest depth', () => {
    expect(
      logbookStats([
        dive({ durationMin: 44, maxDepthM: 12.2 }),
        dive({ durationMin: 51, maxDepthM: 41.2 }),
        dive({ durationMin: 37, maxDepthM: 31.4 }),
      ]),
    ).toEqual({ dives: 3, minutes: 132, deepestM: 41.2 });
  });

  // Order must not decide the answer: this is called during render, on a list whose order is
  // `compareDiveOrder`'s and not this module's, and a maximum written as "the last one that was
  // bigger" would already be right — a maximum written as "the last one" would not.
  it('gives the same answer whatever order the dives arrive in', () => {
    const dives = [
      dive({ durationMin: 44, maxDepthM: 41.2 }),
      dive({ durationMin: 51, maxDepthM: 12.2 }),
      dive({ durationMin: 37, maxDepthM: 31.4 }),
    ];
    expect(logbookStats([...dives].reverse())).toEqual(logbookStats(dives));
  });

  // **Nothing recorded is not zero.** All of a dive's fields except its date are nullable (§6)
  // and §1 never asks a diver to fill one in, so a logbook of real dives with no durations
  // written down is ordinary. `0 h` under it would be a claim that they were instantaneous;
  // null is what lets the caller omit the figure instead.
  it('reports no total at all when nothing recorded one', () => {
    expect(logbookStats([dive({ maxDepthM: 18 }), dive({ maxDepthM: 22 })])).toEqual({
      dives: 2,
      minutes: null,
      deepestM: 22,
    });
    expect(logbookStats([dive({ durationMin: 40 }), dive({ durationMin: 35 })])).toEqual({
      dives: 2,
      minutes: 75,
      deepestM: null,
    });
  });

  // ...and the other side of that distinction: a dive that genuinely records a zero contributes
  // it, and the total is a real `0` rather than "nothing recorded". The app shows what was
  // written down.
  it('treats a recorded zero as a reading, not as an absence', () => {
    expect(logbookStats([dive({ durationMin: 0 })]).minutes).toBe(0);
  });

  it('has nothing to say about an empty logbook', () => {
    expect(logbookStats([])).toEqual({ dives: 0, minutes: null, deepestM: null });
  });

  it('reports one dive as one dive', () => {
    expect(logbookStats([dive({ durationMin: 47, maxDepthM: 18.4 })])).toEqual({
      dives: 1,
      minutes: 47,
      deepestM: 18.4,
    });
  });

  // **One corrupt value must not delete the figure for every other dive.** NaN propagates
  // through `+`, so a single unreadable duration in a hundred would make the whole total NaN
  // and blank a line that is otherwise perfectly true. The dive is still counted — it happened
  // — and only the reading it could not supply is skipped, which is the same "degrade the field,
  // never the dive" stance `composeDives` takes about a corrupt `dives_before`.
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -30],
    ['a string', '40' as unknown as number],
  ])('ignores a %s duration without losing the rest of the total', (_label, bad) => {
    const stats = logbookStats([dive({ durationMin: 40 }), dive({ durationMin: bad })]);
    expect(stats.dives).toBe(2);
    expect(stats.minutes).toBe(40);
  });

  // Depth goes through `isDisplayableDepth` (format/display.ts) rather than a second
  // finite-and-not-negative check written here, so the deepest figure this reports is always a
  // depth the screen can actually draw. A negative is the case those two answers once differed
  // on, and the one a `Math.max` would have got wrong in the other direction as well.
  //
  // **Both orders, and a corrupt depth on its own.** A running maximum only ever compares
  // against what it already holds, so a bad value arriving SECOND is rejected by the
  // comparison whether or not the predicate is there — `NaN > 18.4` is false and so is
  // `-12 > 18.4`. Only the value arriving first, into an empty maximum, actually asks the
  // predicate anything. A one-order test here would have passed with the guard weakened to a
  // bare `typeof === 'number'`, which is the mutation that found this.
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -12],
  ])('ignores a %s depth rather than reporting it as the deepest', (_label, bad) => {
    for (const dives of [
      [dive({ maxDepthM: 18.4 }), dive({ maxDepthM: bad })],
      [dive({ maxDepthM: bad }), dive({ maxDepthM: 18.4 })],
    ]) {
      const stats = logbookStats(dives);
      expect(stats.dives).toBe(2);
      expect(stats.deepestM).toBe(18.4);
    }
    // ...and alone, it leaves the figure with nothing behind it rather than becoming it.
    expect(logbookStats([dive({ maxDepthM: bad })]).deepestM).toBeNull();
  });

  // Called during render, so it may not throw on the shapes a bad join or a partially-hydrated
  // row can produce — `assignDiveNumbers` records the same three, for the same reason.
  it('survives what a corrupt read can hand it', () => {
    expect(logbookStats(null as unknown as [])).toEqual({ dives: 0, minutes: null, deepestM: null });
    const holed = [dive({ durationMin: 20 }), null, undefined] as unknown as ReturnType<typeof dive>[];
    expect(logbookStats(holed)).toEqual({ dives: 1, minutes: 20, deepestM: null });
  });
});

/**
 * A cylinder that produces an exact RMV, so a test can name the figure it expects instead of
 * asserting its own arithmetic back at itself.
 *
 * `rmv` (domain/derived.ts) is `litres / ata / minutes`, where litres is `usedBar × sizeL ×
 * cylinders`. With a 10 l single, an average depth of 10 m (2 ata) and a 50-minute dive, a used
 * pressure of `10 × R` bar gives exactly `R` l/min — so `gasDive(12)` really is a 12 l/min dive
 * and the means below are readable rather than derived.
 */
const gasDive = (litresPerMin: number, over: Partial<Dive> = {}): Dive => {
  const tank: Tank = {
    material: null,
    configuration: 'single',
    sizeL: 10,
    workingBar: null,
    o2Pct: null,
    hePct: null,
    startBar: 200,
    endBar: 200 - litresPerMin * 10,
  };
  return dive({ avgDepthM: 10, durationMin: 50, tanks: [tank], ...over });
};

/** The two catalogue columns a country count reads (§6), and nothing else. */
const site = (id: string, country: string | null): SiteCountry => ({ id, country });

/**
 * §3's *"sites visited"*. Identity itself is `siteIdentityOf`'s and is pinned in
 * `siteIdentity.test.ts`; what is asserted here is that this figure reads it, applies the same
 * population rule as every other figure in this module, and counts a set rather than a list.
 */
describe('sitesVisited', () => {
  it('counts each place once however many dives are at it', () => {
    expect(
      sitesVisited([
        dive({ siteName: 'Kotelna' }),
        dive({ siteName: 'Kotelna' }),
        dive({ siteName: 'Divoká Šárka' }),
      ]),
    ).toBe(2);
  });

  // The fold (§2.3) reaches this figure because it reads `siteIdentityOf` rather than the raw
  // snapshot. Without it a diver who typed `kotelna` once has been to one more place.
  it('reads two spellings of one name as one site', () => {
    expect(sitesVisited([dive({ siteName: 'Kotelna' }), dive({ siteName: 'kotelna' })])).toBe(1);
  });

  // **The rule most likely to ship missing**, and it is the one figure on this screen that is a
  // claim about the diver's life rather than about their arithmetic: a site you are going to
  // dive next week is not a site visited. Seeded with a plan at a place no logged dive names,
  // so the exclusion is what the number depends on.
  it('leaves planned dives out', () => {
    expect(
      sitesVisited([
        dive({ status: 'logged', siteName: 'Kotelna' }),
        dive({ status: 'planned', siteName: 'Blue Hole' }),
      ]),
    ).toBe(1);
  });

  // A dive that names no place is nowhere, and — the half a sentinel key would get wrong —
  // several of them are not one place either.
  it('counts no site for dives that name none', () => {
    expect(sitesVisited([dive(), dive(), dive()])).toBe(0);
    expect(sitesVisited([dive({ siteName: 'Kotelna' }), dive(), dive()])).toBe(1);
  });

  it('has nothing to count in an empty logbook, and survives a corrupt read', () => {
    expect(sitesVisited([])).toBe(0);
    expect(sitesVisited(null as unknown as [])).toBe(0);
    expect(sitesVisited([dive({ siteName: 'Kotelna' }), null, undefined] as unknown as Dive[])).toBe(1);
  });
});

/**
 * §3's *"countries visited"* — the figure whose honest answer is usually **none known**, and
 * whose whole risk is inventing one. Every test below is about the app declining to guess.
 */
describe('countriesVisited', () => {
  const sites = [site('site-hr', 'HR'), site('site-eg', 'EG'), site('site-hr2', 'HR')];

  it('counts each country once however many of its sites were dived', () => {
    expect(
      countriesVisited(
        [dive({ siteId: 'site-hr' }), dive({ siteId: 'site-hr2' }), dive({ siteId: 'site-eg' })],
        sites,
      ),
    ).toBe(2);
  });

  // §2.3 stores ISO 3166-1 alpha-2, and a code is a code: `hr` and `HR` name one country. This
  // deliberately does NOT go through `foldForMatching`, which is the fold for names a diver
  // typed — see `countriesVisited`'s own docblock.
  it('reads one country code spelled two ways as one country', () => {
    expect(
      countriesVisited([dive({ siteId: 'a' }), dive({ siteId: 'b' })], [site('a', 'hr'), site('b', ' HR ')]),
    ).toBe(1);
  });

  // **The state this figure will be in for most divers** (§2.3: the country is derived from the
  // site's own pin and from nothing else, so a site created out of signal has `null` by design).
  // A site with no country is not a country; the screen turns the nought into a dash and says
  // where countries come from.
  it('learns no country from a site that does not know its own', () => {
    expect(countriesVisited([dive({ siteId: 'a' }), dive({ siteId: 'b' })], [site('a', null), site('b', '')])).toBe(0);
  });

  // A dive with only a name — every dive in a logbook that has never synced — reaches no
  // catalogue row, so it contributes nothing. Nothing here reads a site NAME or the dive's own
  // pin: a name is not a place on the earth, and `platform/geocode.ts` owns turning a pin into
  // a country (§4.1).
  it('infers nothing from a dive that names no catalogue site', () => {
    expect(countriesVisited([dive({ siteName: 'Kotelna' }), dive({ latitude: 43.5, longitude: 16.4 })], sites)).toBe(0);
  });

  // A dive pointing at a site this device has not pulled yet is not an error and not a country:
  // the app simply does not know that site.
  it('counts nothing for a site the device does not hold', () => {
    expect(countriesVisited([dive({ siteId: 'site-unknown' })], sites)).toBe(0);
  });

  // §2.4 again, and here it would be the app claiming the diver has been to a country they have
  // only booked a trip to.
  it('leaves planned dives out', () => {
    expect(
      countriesVisited(
        [dive({ status: 'logged', siteId: 'site-hr' }), dive({ status: 'planned', siteId: 'site-eg' })],
        sites,
      ),
    ).toBe(1);
  });

  it('survives an empty or corrupt read of either side', () => {
    expect(countriesVisited([], sites)).toBe(0);
    expect(countriesVisited([dive({ siteId: 'site-hr' })], [])).toBe(0);
    expect(countriesVisited(null as unknown as [], sites)).toBe(0);
    expect(countriesVisited([dive({ siteId: 'site-hr' })], null as unknown as [])).toBe(0);
    expect(
      countriesVisited(
        [dive({ siteId: 'site-hr' }), null] as unknown as Dive[],
        [site('site-hr', 'HR'), null] as unknown as SiteCountry[],
      ),
    ).toBe(1);
  });
});

/**
 * §3's *"RMV trend"*, read as §3's own *"counters first"*: a recent mean and the mean before it.
 * The three ways this goes wrong quietly are a plan in the population, a dive with no gas
 * counted as a zero, and — the one no other figure in this module can have — the answer
 * depending on the order the caller happened to hand the dives in.
 */
describe('rmvTrend', () => {
  /** Ten dives, oldest first, breathing 20 l/min for five dives and then 10. */
  const improving = [20, 20, 20, 20, 20, 10, 10, 10, 10, 10].map((value, index) =>
    gasDive(value, { date: `2026-08-${String(index + 1).padStart(2, '0')}` }),
  );

  it('averages the recent window and the window before it', () => {
    expect(rmvTrend(improving)).toEqual({ recent: 10, recentValues: [10, 10, 10, 10, 10], previous: 20 });
  });

  // **The window's own dives, oldest first** (M3d). The figure is a mean and a mean survives a
  // reversed array; the sparkline drawn from these values does not, so the direction is part of
  // the answer rather than a detail of the slice. Five distinct values, because `improving`'s
  // recent window is five identical ones and would read the same drawn backwards — which is
  // exactly the assertion that would pass while the row showed a diver their trip in reverse.
  it('hands back the dives that mean is over, oldest first', () => {
    const trip = [18, 17, 15, 14, 12].map((value, index) =>
      gasDive(value, { date: `2026-08-${String(index + 1).padStart(2, '0')}` }),
    );
    expect(rmvTrend([...trip].reverse())?.recentValues).toEqual([18, 17, 15, 14, 12]);
  });

  // **The guard the rest of this block rests on.** Every other figure in this module is
  // order-independent and says so; a trend cannot be, so it sorts by `compareDiveOrder` itself
  // rather than trusting the array. `useDives` hands back newest-first today and `MapScreen`
  // hands one site's dives, so a function reading the ends of the array would report the trend
  // backwards on one caller and correctly on the other.
  it('gives the same answer whatever order the dives arrive in', () => {
    const answer = rmvTrend(improving);
    expect(rmvTrend([...improving].reverse())).toEqual(answer);
    expect(rmvTrend([improving[3]!, improving[9]!, improving[0]!, ...improving.slice(4, 9), improving[1]!, improving[2]!])).toEqual(
      answer,
    );
  });

  // The window is five, and a longer history does not widen it — otherwise "recent" would drift
  // toward "ever" as a logbook grows, and the caption under the figure would be false.
  it('never averages more than the window, however long the logbook', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      gasDive(index < 25 ? 20 : 10, { date: `2026-08-${String(index + 1).padStart(2, '0')}` }),
    );
    expect(rmvTrend(many)).toEqual({ recent: 10, recentValues: [10, 10, 10, 10, 10], previous: 20 });
  });

  // **A dive with no gas recorded is skipped, never counted as zero** — RMV needs an average
  // depth, a duration and a cylinder size together and §1 asks for none of them, so most dives
  // have none. A zero in the mean would report a breathing rate no diver has ever had, in the
  // unsafe direction for gas planning.
  it('skips dives with no RMV rather than averaging a zero into the figure', () => {
    const dives = [
      gasDive(10, { date: '2026-08-01' }),
      dive({ date: '2026-08-02' }),
      dive({ date: '2026-08-03', durationMin: 40, maxDepthM: 18 }),
    ];
    expect(rmvTrend(dives)).toEqual({ recent: 10, recentValues: [10], previous: null });
  });

  // No earlier window means no trend — a direction stated from one figure is a direction made
  // up. The caller draws the recent figure and nothing beside it.
  it('reports no previous window when nothing precedes the recent one', () => {
    expect(rmvTrend([gasDive(14, { date: '2026-08-01' })])).toEqual({
      recent: 14,
      recentValues: [14],
      previous: null,
    });
  });

  // §2.4, on the figure where a plan can carry a full cylinder spec: a dive set up on the boat
  // has a starting pressure and no ending one, but nothing stops it carrying both.
  it('leaves planned dives out', () => {
    expect(
      rmvTrend([
        gasDive(10, { date: '2026-08-01', status: 'logged' }),
        gasDive(20, { date: '2026-08-02', status: 'planned' }),
      ]),
    ).toEqual({ recent: 10, recentValues: [10], previous: null });
  });

  it('has nothing to say about a logbook with no gas in it, and survives a corrupt read', () => {
    expect(rmvTrend([])).toBeNull();
    expect(rmvTrend([dive(), dive({ durationMin: 40 })])).toBeNull();
    expect(rmvTrend(null as unknown as [])).toBeNull();
    expect(rmvTrend([gasDive(12), null, undefined] as unknown as Dive[])).toEqual({
      recent: 12,
      recentValues: [12],
      previous: null,
    });
  });
});

/**
 * §3's *currency* — *"days since your last dive, refresher nudge after 6 months"*. The failure
 * this block exists for is the one the brief names: a plan for next week's trip answering "when
 * did you last dive", which is the difference between "you dived yesterday" and "you have a
 * dive booked".
 */
describe('currency', () => {
  const today = '2026-09-04';

  it('counts the days since the most recent logged dive', () => {
    const since = currency([dive({ date: '2026-08-25' }), dive({ date: '2026-08-31' })], today);
    expect(since).toEqual({ lastDate: '2026-08-31', days: 4, refresher: false });
  });

  it('calls a dive logged today nought days ago', () => {
    expect(currency([dive({ date: today })], today)?.days).toBe(0);
  });

  // **§2.4, and the figure it matters most on.** A plan dated today over a logged dive from
  // last winter would tell a diver they are current when they have not been wet in months —
  // which is exactly the reading a refresher nudge exists to prevent.
  it('answers from the last dive that happened, not from the next one booked', () => {
    const since = currency(
      [dive({ status: 'planned', date: today }), dive({ status: 'logged', date: '2026-01-15' })],
      today,
    );
    expect(since?.lastDate).toBe('2026-01-15');
    expect(since?.days).toBe(232);
  });

  // §10's own ruling for carry-over, applied to the question it was written about: a dive that
  // has not happened yet is not recent. A logged dive dated ahead of today is a typo or a plan
  // filed under the wrong status, and either way it cannot say how long since the diver was in
  // the water — so it is passed over rather than producing a negative count.
  it('ignores a logged dive dated ahead of today', () => {
    const since = currency([dive({ date: '2026-09-20' }), dive({ date: '2026-08-31' })], today);
    expect(since).toEqual({ lastDate: '2026-08-31', days: 4, refresher: false });
  });

  // The boundary, both sides of it, because "after 6 months" is a threshold and an off-by-one
  // here is a nudge that fires a day early for ever or never fires at all.
  it.each([
    [179, false],
    [180, true],
    [400, true],
  ])('sets the refresher nudge at %i days to %s', (days, expected) => {
    // 4 September 2026 minus `days`, computed rather than typed so the two never disagree.
    const last = new Date(Date.UTC(2026, 8, 4) - days * 86_400_000).toISOString().slice(0, 10);
    expect(currency([dive({ date: last })], today)).toEqual({ lastDate: last, days, refresher: true === expected });
  });

  // A logbook of plans has been used and still has no currency to report — the same near-empty
  // state `logbookStats` reports as `0 dives`, said in this figure's own terms.
  it('has no answer for a logbook holding nothing that has happened', () => {
    expect(currency([], today)).toBeNull();
    expect(currency([dive({ status: 'planned', date: today })], today)).toBeNull();
    expect(currency([dive({ date: '2026-09-20' })], today)).toBeNull();
  });

  // A date this build cannot read is skipped rather than guessed at — `'2026-02-30'` is the one
  // that matters, since `Date.parse` accepts it two days late.
  it('passes over a date it cannot read rather than counting from it', () => {
    expect(currency([dive({ date: '2026-02-30' }), dive({ date: '2026-08-31' })], today)?.lastDate).toBe('2026-08-31');
    expect(currency([dive({ date: 'someday' })], today)).toBeNull();
    expect(currency([dive({ date: '2026-08-31' })], 'not a date')).toBeNull();
  });

  it('survives a corrupt read', () => {
    expect(currency(null as unknown as [], today)).toBeNull();
    expect(currency([dive({ date: '2026-08-31' }), null, undefined] as unknown as Dive[], today)?.days).toBe(4);
  });
});
